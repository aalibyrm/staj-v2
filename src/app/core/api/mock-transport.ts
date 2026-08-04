import { Injectable } from '@angular/core';
import { defer, mergeMap, Observable, of, throwError, timer } from 'rxjs';

import { ApiTransportError } from './api-error';

export const MOCK_HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type MockHttpMethod = (typeof MOCK_HTTP_METHODS)[number];

export interface MockRequest<TBody = unknown> {
  readonly method: MockHttpMethod;
  readonly url: string;
  readonly body?: TBody;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface MockResponse<TBody = unknown, TRequestBody = unknown> {
  readonly request: MockRequest<TRequestBody>;
  readonly status: 200;
  readonly body: TBody;
  readonly attempt: number;
}

export type MockScenarioOutcome = 'success' | 'service-error' | 'unauthorized' | 'conflict';

export interface MockScenarioControls {
  readonly latencyMs: number;
  readonly outcome: MockScenarioOutcome;
  readonly transientServiceFailures: number;
  readonly retryLimit: number;
  readonly retryDelayMs: number;
}

export const DEFAULT_MOCK_SCENARIO: Readonly<MockScenarioControls> = Object.freeze({
  latencyMs: 0,
  outcome: 'success',
  transientServiceFailures: 0,
  retryLimit: 0,
  retryDelayMs: 0
});

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

@Injectable({ providedIn: 'root' })
export class MockTransport {
  execute<TRequestBody = unknown, TResponseBody = unknown>(
    request: MockRequest<TRequestBody>,
    successBodyFactory: () => TResponseBody,
    controls: Partial<MockScenarioControls> = {}
  ): Observable<MockResponse<TResponseBody, TRequestBody>> {
    if (request === null || typeof request !== 'object') {
      throw new TypeError('Mock request must be an object.');
    }
    if (typeof request.url !== 'string' || request.url.trim().length === 0) {
      throw new TypeError('Mock request URL must not be empty.');
    }
    if (!(MOCK_HTTP_METHODS as readonly string[]).includes(request.method)) {
      throw new TypeError(`Unsupported mock HTTP method: ${String(request.method)}.`);
    }
    if (typeof successBodyFactory !== 'function') {
      throw new TypeError('A success body factory is required.');
    }
    if (controls === null || typeof controls !== 'object') {
      throw new TypeError('Mock scenario controls must be an object.');
    }

    const scenario: MockScenarioControls = {
      ...DEFAULT_MOCK_SCENARIO,
      ...controls
    };

    if (!isNonNegativeInteger(scenario.latencyMs)) {
      throw new TypeError('latencyMs must be a non-negative integer.');
    }
    if (!isNonNegativeInteger(scenario.transientServiceFailures)) {
      throw new TypeError('transientServiceFailures must be a non-negative integer.');
    }
    if (!isNonNegativeInteger(scenario.retryLimit)) {
      throw new TypeError('retryLimit must be a non-negative integer.');
    }
    if (!isNonNegativeInteger(scenario.retryDelayMs)) {
      throw new TypeError('retryDelayMs must be a non-negative integer.');
    }
    if (!(['success', 'service-error', 'unauthorized', 'conflict'] as const).includes(scenario.outcome)) {
      throw new TypeError(`Unsupported mock scenario outcome: ${String(scenario.outcome)}.`);
    }

    return defer(() => this.executeAttempt(request, successBodyFactory, scenario, 1));
  }

  private executeAttempt<TRequestBody, TResponseBody>(
    request: MockRequest<TRequestBody>,
    successBodyFactory: () => TResponseBody,
    scenario: MockScenarioControls,
    attempt: number
  ): Observable<MockResponse<TResponseBody, TRequestBody>> {
    return timer(scenario.latencyMs).pipe(
      mergeMap(() => {
        const succeeds =
          scenario.outcome === 'success' ||
          (scenario.outcome === 'service-error' &&
            scenario.transientServiceFailures > 0 &&
            attempt > scenario.transientServiceFailures);

        if (succeeds) {
          return defer(() =>
            of({
              request,
              status: 200 as const,
              body: successBodyFactory(),
              attempt
            })
          );
        }

        let kind: 'service' | 'unauthorized' | 'conflict';
        switch (scenario.outcome) {
          case 'service-error':
            kind = 'service';
            break;
          case 'unauthorized':
            kind = 'unauthorized';
            break;
          case 'conflict':
            kind = 'conflict';
            break;
        }

        const error = new ApiTransportError(kind, attempt);

        if (scenario.outcome === 'service-error' && attempt <= scenario.retryLimit) {
          return timer(scenario.retryDelayMs).pipe(
            mergeMap(() => this.executeAttempt(request, successBodyFactory, scenario, attempt + 1))
          );
        }

        return throwError(() => error);
      })
    );
  }
}
