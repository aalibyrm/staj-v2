import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiTransportError,
  normalizeApplicationError,
  TRANSPORT_ERROR_STATUS
} from './api-error';
import { mapApplicationErrorToNotification } from '../observability/notification.port';
import { MockTransport } from './mock-transport';
import type { MockRequest } from './mock-transport';

describe('MockTransport', () => {
  let transport: MockTransport;
  const request: MockRequest = { method: 'GET', url: '/items/42' };

  beforeEach(() => {
    vi.useFakeTimers();
    transport = new MockTransport();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits a successful response only after the configured latency', () => {
    const responses: Array<{ attempt: number; body: { ok: boolean } }> = [];

    transport
      .execute(request, () => ({ ok: true }), { latencyMs: 25 })
      .subscribe((response) => responses.push({ attempt: response.attempt, body: response.body }));

    expect(responses).toEqual([]);
    vi.advanceTimersByTime(24);
    expect(responses).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(responses).toEqual([{ attempt: 1, body: { ok: true } }]);
  });

  it('retries transient service failures and succeeds on the expected attempt', () => {
    const responses: Array<{ attempt: number }> = [];
    const errors: unknown[] = [];

    transport
      .execute(
        request,
        () => ({ ok: true }),
        {
          latencyMs: 10,
          outcome: 'service-error',
          transientServiceFailures: 2,
          retryLimit: 2,
          retryDelayMs: 5
        }
      )
      .subscribe({
        next: (response) => responses.push({ attempt: response.attempt }),
        error: (error: unknown) => errors.push(error)
      });

    vi.advanceTimersByTime(39);
    expect(responses).toEqual([]);
    expect(errors).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(responses).toEqual([{ attempt: 3 }]);
    expect(errors).toEqual([]);
  });

  it('stops an insufficient retry budget at the exact attempt and maps the error', () => {
    const errors: unknown[] = [];

    transport
      .execute(
        request,
        () => ({ ok: true }),
        {
          latencyMs: 10,
          outcome: 'service-error',
          transientServiceFailures: 3,
          retryLimit: 1,
          retryDelayMs: 5
        }
      )
      .subscribe({ error: (error: unknown) => errors.push(error) });

    vi.advanceTimersByTime(24);
    expect(errors).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(ApiTransportError);

    const normalized = normalizeApplicationError(errors[0]);
    expect(normalized).toEqual({
      kind: 'service',
      status: TRANSPORT_ERROR_STATUS.service,
      attempt: 2,
      retryable: true,
      userMessage: 'The service is temporarily unavailable.'
    });
    expect(mapApplicationErrorToNotification(normalized)).toEqual({
      kind: 'service',
      text: 'The service is temporarily unavailable. Retry the request.',
      actions: [{ type: 'retry', label: 'Retry' }]
    });
  });

  it('exhausts the retry limit for a permanent service error', () => {
    const errors: unknown[] = [];
    const successBodyFactory = vi.fn(() => ({ ok: true }));

    transport
      .execute(
        request,
        successBodyFactory,
        {
          latencyMs: 7,
          outcome: 'service-error',
          retryLimit: 2,
          retryDelayMs: 3
        }
      )
      .subscribe({ error: (error: unknown) => errors.push(error) });

    vi.advanceTimersByTime(26);
    expect(errors).toEqual([]);
    expect(successBodyFactory).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(errors).toHaveLength(1);
    expect(normalizeApplicationError(errors[0]).attempt).toBe(3);
    expect(successBodyFactory).not.toHaveBeenCalled();
  });

  it.each([
    ['unauthorized', 401],
    ['conflict', 409]
  ] as const)('does not retry %s outcomes despite a retry limit', (outcome, status) => {
    const errors: unknown[] = [];

    transport
      .execute(request, () => ({ ok: true }), {
        latencyMs: 8,
        outcome,
        retryLimit: 4,
        retryDelayMs: 100
      })
      .subscribe({ error: (error: unknown) => errors.push(error) });

    vi.advanceTimersByTime(7);
    expect(errors).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(errors).toHaveLength(1);
    vi.advanceTimersByTime(500);
    expect(errors).toHaveLength(1);

    const normalized = normalizeApplicationError(errors[0]);
    expect(normalized.status).toBe(status);
    expect(normalized.attempt).toBe(1);
    expect(normalized.retryable).toBe(false);
    expect(mapApplicationErrorToNotification(normalized).actions).toEqual([]);
    expect(mapApplicationErrorToNotification(normalized).kind).toBe(outcome);
  });

  it('rejects an empty URL and invalid controls synchronously', () => {
    const invalidControls = [
      { latencyMs: -1 },
      { latencyMs: 1.5 },
      { transientServiceFailures: Number.NaN },
      { retryLimit: Number.POSITIVE_INFINITY },
      { retryDelayMs: 2.5 }
    ] as const;

    expect(() => transport.execute({ method: 'GET', url: '   ' }, () => null)).toThrow(TypeError);

    for (const controls of invalidControls) {
      expect(() => transport.execute(request, () => null, controls)).toThrow(TypeError);
    }
  });

  it('does not call the success factory when the request fails', () => {
    const errors: unknown[] = [];
    const successBodyFactory = vi.fn(() => ({ ok: true }));

    transport
      .execute(request, successBodyFactory, { outcome: 'unauthorized', latencyMs: 4 })
      .subscribe({ error: (error: unknown) => errors.push(error) });

    vi.advanceTimersByTime(4);
    expect(errors).toHaveLength(1);
    expect(successBodyFactory).not.toHaveBeenCalled();
  });

  it('starts each subscription at attempt one without shared state', () => {
    const attempts: number[] = [];
    const observable = transport.execute(request, () => ({ ok: true }), { latencyMs: 6 });

    observable.subscribe((response) => attempts.push(response.attempt));
    vi.advanceTimersByTime(6);
    observable.subscribe((response) => attempts.push(response.attempt));
    vi.advanceTimersByTime(6);

    expect(attempts).toEqual([1, 1]);
  });
});

describe('normalizeApplicationError', () => {
  it('maps unknown values to a safe non-retryable unexpected error', () => {
    const normalized = normalizeApplicationError(new Error('unsafe backend details'));

    expect(normalized).toEqual({
      kind: 'unexpected',
      status: TRANSPORT_ERROR_STATUS.unexpected,
      attempt: 1,
      retryable: false,
      userMessage: 'Something unexpected happened.'
    });
    expect(normalized.userMessage).not.toContain('unsafe backend details');

    const notification = mapApplicationErrorToNotification(normalized);
    expect(notification.text).toBe('An unexpected error occurred.');
    expect(notification.actions).toEqual([]);
  });
});
