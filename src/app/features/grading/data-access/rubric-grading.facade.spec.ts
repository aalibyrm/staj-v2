import { firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { MockTransport } from '../../../core/api/mock-transport';
import { RubricGradingFacade } from './rubric-grading.facade';
import { RubricGradingRepository } from './rubric-grading.repository';

describe('RubricGradingFacade', () => {
  it('loads an immutable context and exposes computed rubric state', async () => {
    const repository = new RubricGradingRepository(new MockTransport());
    const facade = new RubricGradingFacade(repository);
    const grading = await firstValueFrom(facade.load('attempt-alpha'));
    expect(grading?.context.attemptId).toBe('attempt-alpha');
    expect(facade.requestState().status).toBe('ready');
    expect(facade.context()?.studentName).toContain('Learner');
    expect(facade.criterionCount()).toBe(3);
    expect(Object.isFrozen(grading)).toBe(true);
  });

  it('keeps empty and unauthorized states inside the facade request state', async () => {
    const repository = new RubricGradingRepository(new MockTransport());
    const facade = new RubricGradingFacade(repository);
    await firstValueFrom(facade.load('empty-attempt', { empty: true }));
    expect(facade.requestState().status).toBe('empty');
    repository.setMockScenario({ outcome: 'unauthorized' });
    await expect(firstValueFrom(facade.load('restricted-attempt'))).rejects.toBeTruthy();
    expect(facade.requestState().status).toBe('unauthorized');
    expect(facade.grading()).toBeNull();
  });

  it('retries deterministic service failures and protects newer loads from stale results', async () => {
    const repository = new RubricGradingRepository(new MockTransport());
    repository.setMockScenario({ outcome: 'service-error', transientServiceFailures: 1, retryLimit: 1 });
    const facade = new RubricGradingFacade(repository);
    const recovered = await firstValueFrom(facade.load('retry-attempt'));
    expect(recovered?.context.attemptId).toBe('retry-attempt');
    expect(facade.requestState().status).toBe('ready');

    repository.resetMockScenario();
    const stale = facade.load('slow-attempt', { latencyMs: 10 });
    const current = facade.load('current-attempt');
    await firstValueFrom(current);
    await firstValueFrom(stale);
    expect(facade.context()?.attemptId).toBe('current-attempt');
    expect(facade.requestState().status).toBe('ready');
  });
});
