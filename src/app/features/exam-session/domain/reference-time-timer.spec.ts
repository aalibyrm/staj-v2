import { describe, expect, it } from 'vitest';

import {
  computeReferenceTimeDeadline,
  createReferenceTimeAnchor,
  deriveCurrentReferenceTime,
  ReferenceTimeTimerDomainError,
  selectReferenceTimeTimer
} from './reference-time-timer';

const anchor = createReferenceTimeAnchor(1_000, 500);
const selection = (overrides: Record<string, unknown> = {}) => ({
  anchor,
  monotonicNowMs: 500,
  sessionStartReferenceTime: 1_000,
  durationMs: 10_000,
  warningThresholdMs: 3_000,
  ...overrides
});

describe('reference-time timer', () => {
  it('selects the exact initial remaining time from the synchronized reference', () => {
    expect(selectReferenceTimeTimer(selection())).toEqual({
      deadlineMs: 11_000,
      remainingMs: 10_000,
      warning: false,
      expired: false
    });
  });

  it('subtracts monotonic elapsed time without reading a device clock', () => {
    expect(selectReferenceTimeTimer(selection({ monotonicNowMs: 2_500 }))).toMatchObject({
      deadlineMs: 11_000,
      remainingMs: 8_000,
      expired: false
    });
    expect(selectReferenceTimeTimer(selection({ monotonicNowMs: 2_500 }))).toEqual(
      selectReferenceTimeTimer(selection({ monotonicNowMs: 2_500 }))
    );
  });

  it('uses an inclusive warning boundary and keeps the pre-warning state clear', () => {
    expect(selectReferenceTimeTimer(selection({ monotonicNowMs: 7_499 })).warning).toBe(false);
    expect(selectReferenceTimeTimer(selection({ monotonicNowMs: 7_500 })).warning).toBe(true);
  });

  it('clamps exact-zero and post-deadline remaining time and exposes expiry', () => {
    expect(selectReferenceTimeTimer(selection({ monotonicNowMs: 10_500 }))).toMatchObject({
      remainingMs: 0,
      expired: true
    });
    expect(selectReferenceTimeTimer(selection({ monotonicNowMs: 50_500 }))).toMatchObject({
      remainingMs: 0,
      expired: true
    });
  });

  it('handles a large inactive-tab monotonic jump immediately', () => {
    const snapshot = selectReferenceTimeTimer(selection({ monotonicNowMs: Number.MAX_SAFE_INTEGER / 2 }));
    expect(snapshot.expired).toBe(true);
    expect(snapshot.remainingMs).toBe(0);
  });

  it('does not accept a device wall-clock reading in the selector', () => {
    expect(() => selectReferenceTimeTimer(selection({ wallClockMs: 999_999_999 }))).toThrowError(
      ReferenceTimeTimerDomainError
    );
  });

  it('computes a deterministic fixed deadline from a timestamp and duration', () => {
    expect(computeReferenceTimeDeadline('2026-08-05T10:00:00.000Z', 90_000)).toBe(
      Date.parse('2026-08-05T10:01:30.000Z')
    );
    expect(computeReferenceTimeDeadline('2026-08-05T10:00:00.000Z', 90_000)).toBe(
      computeReferenceTimeDeadline('2026-08-05T10:00:00.000Z', 90_000)
    );
  });
  it('accepts an explicit numeric timezone offset', () => {
    expect(computeReferenceTimeDeadline('2026-08-05T10:00:00.000+02:00', 90_000)).toBe(
      Date.parse('2026-08-05T08:01:30.000Z')
    );
  });

  it.each([
    ['reference epoch', () => createReferenceTimeAnchor(Number.NaN, 0)],
    ['monotonic epoch', () => createReferenceTimeAnchor(0, Number.POSITIVE_INFINITY)],
    ['monotonic regression', () => deriveCurrentReferenceTime(anchor, 499)],
    ['nonfinite observation', () => deriveCurrentReferenceTime(anchor, Number.NaN)],
    ['unsafe observation', () => deriveCurrentReferenceTime(anchor, Number.MAX_SAFE_INTEGER + 1)]
  ])('rejects invalid synchronization input: %s', (_label, operation) => {
    expect(operation).toThrowError(ReferenceTimeTimerDomainError);
  });

  it.each([
    ['timestamp', { sessionStartReferenceTime: 'not-a-timestamp' }],
    ['timezone-less timestamp', { sessionStartReferenceTime: '2026-08-05T10:00:00.000' }],
    ['zero duration', { durationMs: 0 }],
    ['negative duration', { durationMs: -1 }],
    ['unsafe duration', { durationMs: Number.MAX_SAFE_INTEGER + 1 }],
    ['negative threshold', { warningThresholdMs: -1 }],
    ['nonfinite threshold', { warningThresholdMs: Number.POSITIVE_INFINITY }],
    ['unsafe threshold', { warningThresholdMs: Number.MAX_SAFE_INTEGER + 1 }]
  ])('rejects invalid timer input: %s', (_label, overrides) => {
    expect(() => selectReferenceTimeTimer(selection(overrides))).toThrowError(ReferenceTimeTimerDomainError);
  });

  it('returns an immutable snapshot and anchor', () => {
    const snapshot = selectReferenceTimeTimer(selection());
    expect(Object.isFrozen(anchor)).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });
});
