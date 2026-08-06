import { signal, type WritableSignal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { DEMO_ACCOUNTS, type AuthSession } from '../../../core/auth/authorization';
import type { SessionStore } from '../../../core/auth/session.store';
import { MockTransport } from '../../../core/api/mock-transport';
import { RubricGradingFacade } from './rubric-grading.facade';
import { createNeutralFixture, RubricGradingRepository } from './rubric-grading.repository';

const instructorAccount = DEMO_ACCOUNTS.find((account) => account.roleCode === 'INSTRUCTOR')!;
const studentAccount = DEMO_ACCOUNTS.find((account) => account.roleCode === 'STUDENT')!;

/** An instructor session whose student-scope grant is global, so it matches any fixture attempt's student. */
const authorizedInstructorSession = (): AuthSession =>
  Object.freeze({
    accountId: instructorAccount.id,
    account: Object.freeze({
      ...instructorAccount,
      scopeGrants: Object.freeze([Object.freeze({ kind: 'student' as const, ids: [], global: true })])
    })
  });

/** The demo instructor's student-scope grant ids, duplicated here (not imported from core/auth) per repository fixture convention. */
const DEMO_SCOPED_STUDENT_IDS = [
  'STUDENT-MATH101-2025-FALL-A-01',
  'STUDENT-MATH101-2025-FALL-A-02',
  'STUDENT-MATH101-2025-FALL-A-03'
];

/** An instructor session scoped to exactly the demo cohort's students, not globally. */
const inScopeInstructorSession = (): AuthSession =>
  Object.freeze({
    accountId: instructorAccount.id,
    account: Object.freeze({
      ...instructorAccount,
      scopeGrants: Object.freeze([Object.freeze({ kind: 'student' as const, ids: DEMO_SCOPED_STUDENT_IDS })])
    })
  });

/** An instructor session whose scope grant never matches a demo-scoped student id, so every fixture attempt is denied. */
const outOfScopeInstructorSession = (): AuthSession =>
  Object.freeze({
    accountId: instructorAccount.id,
    account: Object.freeze({
      ...instructorAccount,
      scopeGrants: Object.freeze([Object.freeze({ kind: 'student' as const, ids: ['STUDENT-OUTSIDE-SCOPE'] })])
    })
  });

const studentSession = (): AuthSession => Object.freeze({ accountId: studentAccount.id, account: studentAccount });

/** A minimal double implementing only the `session` signal the facade reads. */
const fakeSessionStore = (initial: AuthSession | null): { store: SessionStore; sessionSignal: WritableSignal<AuthSession | null> } => {
  const sessionSignal = signal<AuthSession | null>(initial);
  return { store: { session: sessionSignal } as unknown as SessionStore, sessionSignal };
};

describe('RubricGradingFacade', () => {
  it('loads an immutable context and exposes computed rubric state for an authorized instructor', async () => {
    const repository = new RubricGradingRepository(new MockTransport());
    const { store } = fakeSessionStore(authorizedInstructorSession());
    const facade = new RubricGradingFacade(repository, store);
    const grading = await firstValueFrom(facade.load('attempt-alpha'));
    expect(grading?.context.attemptId).toBe('attempt-alpha');
    expect(facade.requestState().status).toBe('ready');
    expect(facade.context()?.studentName).toContain('Student');
    expect(facade.criterionCount()).toBe(3);
    expect(Object.isFrozen(grading)).toBe(true);
    expect(facade.isGradable()).toBe(true);
    expect(facade.workflowStatus()).toBe('pending');
  });

  it('keeps empty and transport-level unauthorized states inside the facade request state', async () => {
    const repository = new RubricGradingRepository(new MockTransport());
    const { store } = fakeSessionStore(authorizedInstructorSession());
    const facade = new RubricGradingFacade(repository, store);
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
    const { store } = fakeSessionStore(authorizedInstructorSession());
    const facade = new RubricGradingFacade(repository, store);
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

  it('denies a null session as unauthenticated and suppresses the grading payload', async () => {
    const repository = new RubricGradingRepository(new MockTransport());
    const { store } = fakeSessionStore(null);
    const facade = new RubricGradingFacade(repository, store);
    const result = await firstValueFrom(facade.load('attempt-unauth'));
    expect(result).toBeNull();
    expect(facade.requestState().status).toBe('unauthorized');
    expect(facade.requestState().retryable).toBe(false);
    expect(facade.grading()).toBeNull();
    expect(facade.context()).toBeNull();
    expect(facade.isGradable()).toBe(false);
  });

  it('denies a non-instructor role and suppresses the grading payload', async () => {
    const repository = new RubricGradingRepository(new MockTransport());
    const { store } = fakeSessionStore(studentSession());
    const facade = new RubricGradingFacade(repository, store);
    const result = await firstValueFrom(facade.load('attempt-role-denied'));
    expect(result).toBeNull();
    expect(facade.requestState().status).toBe('unauthorized');
    expect(facade.grading()).toBeNull();
  });

  it('denies an instructor whose scope grant excludes the attempt student and suppresses the grading payload', async () => {
    const repository = new RubricGradingRepository(new MockTransport());
    const { store } = fakeSessionStore(outOfScopeInstructorSession());
    const facade = new RubricGradingFacade(repository, store);
    const result = await firstValueFrom(facade.load('attempt-scope-denied'));
    expect(result).toBeNull();
    expect(facade.requestState().status).toBe('unauthorized');
    expect(facade.grading()).toBeNull();
    const deniedStudentId = createNeutralFixture('attempt-scope-denied').context.studentId;
    expect(facade.requestState().message).not.toContain(deniedStudentId);
  });

  it('reaches ready with a non-null grading for an in-scope instructor loading attempt-12', async () => {
    const repository = new RubricGradingRepository(new MockTransport());
    const { store } = fakeSessionStore(inScopeInstructorSession());
    const facade = new RubricGradingFacade(repository, store);
    const result = await firstValueFrom(facade.load('attempt-12'));
    expect(result).not.toBeNull();
    expect(facade.requestState().status).toBe('ready');
    expect(facade.grading()).not.toBeNull();
    expect(DEMO_SCOPED_STUDENT_IDS).toContain(facade.context()?.studentId);
  });

  it('never lets a stale, later-arriving response overwrite a newer state, even a denied one', async () => {
    const repository = new RubricGradingRepository(new MockTransport());
    const { store, sessionSignal } = fakeSessionStore(null);
    const facade = new RubricGradingFacade(repository, store);

    const stale = facade.load('stale-attempt', { latencyMs: 20 });
    sessionSignal.set(authorizedInstructorSession());
    const current = facade.load('current-attempt');
    await firstValueFrom(current);
    expect(facade.requestState().status).toBe('ready');
    expect(facade.context()?.attemptId).toBe('current-attempt');

    sessionSignal.set(null);
    await firstValueFrom(stale);
    expect(facade.requestState().status).toBe('ready');
    expect(facade.context()?.attemptId).toBe('current-attempt');
    expect(facade.grading()).not.toBeNull();
  });
});
