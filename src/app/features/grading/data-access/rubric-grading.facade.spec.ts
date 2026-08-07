import { signal, type WritableSignal } from '@angular/core';
import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { DEMO_ACCOUNTS, type AuthSession } from '../../../core/auth/authorization';
import type { SessionStore } from '../../../core/auth/session.store';
import { ApiTransportError } from '../../../core/api/api-error';
import { MockTransport } from '../../../core/api/mock-transport';
import { NotificationPort, type NotificationMessage } from '../../../core/observability/notification.port';
import type { AuditEventDraft, AuditPort } from '../../../core/observability/observability.ports';
import { RubricGradingFacade } from './rubric-grading.facade';
import { createNeutralFixture, RubricGradingRepository } from './rubric-grading.repository';
import { SCORE_CHANGE_ERROR_CODES, ScoreChangeError } from '../models/score-change.models';

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

class RecordingAuditPort {
  readonly events: AuditEventDraft[] = [];
  record(event: AuditEventDraft): void {
    this.events.push(event);
  }
}

describe('RubricGradingRepository score changes', () => {
  it('rejects a blank reason with reasonRequired, leaves history and points unchanged, and records no audit event', async () => {
    const audit = new RecordingAuditPort();
    const repository = new RubricGradingRepository(new MockTransport(), audit as unknown as AuditPort);
    await expect(
      firstValueFrom(repository.submitScoreChange('attempt-blank', { reason: '   ', nextPoints: 80, previousPoints: 60 }, { actorId: 'instructor-1' }))
    ).rejects.toMatchObject({ code: SCORE_CHANGE_ERROR_CODES.reasonRequired });
    expect(repository.listScoreChanges('attempt-blank')).toEqual([]);
    expect(audit.events).toHaveLength(0);
  });

  it('normalizes reason whitespace, appends the entry, and records exactly one readable audit event', async () => {
    const audit = new RecordingAuditPort();
    const repository = new RubricGradingRepository(new MockTransport(), audit as unknown as AuditPort);
    const entry = await firstValueFrom(
      repository.submitScoreChange('attempt-audit', { reason: '  Adjusted   after   re-read.  ', nextPoints: 82, previousPoints: 60 }, { actorId: 'instructor-9' })
    );
    expect(entry.reason).toBe('Adjusted after re-read.');
    expect(entry.evaluationNumber).toBe(2);
    expect(repository.listScoreChanges('attempt-audit')).toEqual([entry]);
    expect(audit.events).toHaveLength(1);
    const [event] = audit.events;
    expect(event.action).toBe('grading.score-change');
    expect(event.actor).toBe('instructor-9');
    expect(event.targetType).toBe('grading-attempt');
    expect(event.targetId).toBe('attempt-audit');
    expect(() => new Date(event.occurredAt).toISOString()).not.toThrow();
    expect(event.before).toMatchObject({ points: 60 });
    expect(event.after).toMatchObject({ points: 82 });
    expect(event.mandatoryReason).toBe('Adjusted after re-read.');
  });

  it('records no audit event when the mock transport reports service-error, unauthorized, or conflict', async () => {
    for (const outcome of ['service-error', 'unauthorized', 'conflict'] as const) {
      const audit = new RecordingAuditPort();
      const repository = new RubricGradingRepository(new MockTransport(), audit as unknown as AuditPort);
      repository.setMockScenario({ outcome });
      await expect(
        firstValueFrom(repository.submitScoreChange('attempt-fail', { reason: 'Valid reason for a retry.', nextPoints: 80, previousPoints: 60 }, { actorId: 'instructor-1' }))
      ).rejects.toBeTruthy();
      expect(audit.events).toHaveLength(0);
      expect(repository.listScoreChanges('attempt-fail')).toEqual([]);
    }
  });
});

describe('RubricGradingFacade score changes', () => {
  it('reports re-evaluated once every criterion is scored after one persisted score change', async () => {
    const scoredFixture = createNeutralFixture('attempt-flow');
    const scoredGrading = {
      ...scoredFixture,
      selectedLevelIds: Object.fromEntries(scoredFixture.rubric.criteria.map((criterion) => [criterion.id, criterion.levels.at(-1)!.id]))
    };
    const changeEntry = {
      id: 'attempt-flow-change-2',
      attemptId: 'attempt-flow',
      previousPoints: 60,
      nextPoints: 90,
      delta: 30,
      reason: 'Reconsidered the reasoning score.',
      actorId: instructorAccount.id,
      occurredAt: new Date().toISOString(),
      evaluationNumber: 2
    };
    let history: typeof changeEntry[] = [];
    const stubRepository = {
      getByAttemptId: () => of(scoredGrading),
      listScoreChanges: () => history,
      submitScoreChange: () => {
        history = [changeEntry];
        return of(changeEntry);
      }
    } as unknown as RubricGradingRepository;
    const { store } = fakeSessionStore(authorizedInstructorSession());
    const facade = new RubricGradingFacade(stubRepository, store);
    await firstValueFrom(facade.load('attempt-flow'));
    expect(facade.workflowStatus()).toBe('graded');

    await firstValueFrom(facade.submitScoreChange({ reason: 'Reconsidered the reasoning score.', nextPoints: 90 }));
    expect(facade.scoreChangeHistory()).toHaveLength(1);
    expect(facade.scoreChangeState().status).toBe('saved');
    expect(facade.reEvaluationTimeline()).toHaveLength(1);
    expect(facade.workflowStatus()).toBe('re-evaluated');
  });

  it('denies a score-change submission for a session without grading access and never calls the repository', async () => {
    const repository = new RubricGradingRepository(new MockTransport());
    const submitSpy = repository.submitScoreChange.bind(repository);
    let called = false;
    repository.submitScoreChange = ((...args: Parameters<typeof submitSpy>) => {
      called = true;
      return submitSpy(...args);
    }) as typeof submitSpy;
    const { store, sessionSignal } = fakeSessionStore(authorizedInstructorSession());
    const facade = new RubricGradingFacade(repository, store);
    await firstValueFrom(facade.load('attempt-deny'));
    sessionSignal.set(studentSession());
    await expect(firstValueFrom(facade.submitScoreChange({ reason: 'Attempted change.', nextPoints: 90 }))).rejects.toBeTruthy();
    expect(called).toBe(false);
    expect(facade.scoreChangeState().status).toBe('error');
  });

  it('never lets a stale score-change submission overwrite a newer state', async () => {
    const repository = new RubricGradingRepository(new MockTransport());
    const { store } = fakeSessionStore(authorizedInstructorSession());
    const facade = new RubricGradingFacade(repository, store);
    await firstValueFrom(facade.load('attempt-stale'));
    const stale = facade.submitScoreChange({ reason: 'First stale attempt.', nextPoints: 70 });
    const current = facade.submitScoreChange({ reason: 'Second, newer attempt.', nextPoints: 95 });
    await firstValueFrom(current);
    await firstValueFrom(stale).catch(() => undefined);
    expect(facade.scoreChangeHistory()).toHaveLength(1);
    expect(facade.scoreChangeHistory()[0].nextPoints).toBe(95);
  });

  it('rejects a blank or whitespace-only reason without touching pending state or calling the repository', async () => {
    const repository = new RubricGradingRepository(new MockTransport());
    const submitSpy = repository.submitScoreChange.bind(repository);
    let called = false;
    repository.submitScoreChange = ((...args: Parameters<typeof submitSpy>) => {
      called = true;
      return submitSpy(...args);
    }) as typeof submitSpy;
    const { store } = fakeSessionStore(authorizedInstructorSession());
    const facade = new RubricGradingFacade(repository, store);
    await firstValueFrom(facade.load('attempt-blank-reason'));

    await expect(firstValueFrom(facade.submitScoreChange({ reason: '   ', nextPoints: 90 }))).rejects.toBeTruthy();
    expect(called).toBe(false);
    expect(facade.pendingScoreChange()).toBeNull();
    expect(facade.scoreChangeState().status).toBe('error');
  });

  it('normalizes a padded, internally spaced reason before recording the pending change and calling the repository', async () => {
    const repository = new RubricGradingRepository(new MockTransport());
    const submitSpy = repository.submitScoreChange.bind(repository);
    let capturedReason: string | undefined;
    repository.submitScoreChange = ((...args: Parameters<typeof submitSpy>) => {
      capturedReason = args[1].reason;
      return submitSpy(...args);
    }) as typeof submitSpy;
    const { store } = fakeSessionStore(authorizedInstructorSession());
    const facade = new RubricGradingFacade(repository, store);
    await firstValueFrom(facade.load('attempt-padded-reason'));

    const submission = facade.submitScoreChange({ reason: '  Second   reader  ', nextPoints: 90 });
    expect(facade.pendingScoreChange()?.reason).toBe('Second reader');

    await firstValueFrom(submission);
    expect(capturedReason).toBe('Second reader');
  });
});

class RecordingNotificationPort extends NotificationPort {
  readonly messages: NotificationMessage[] = [];
  override notify(message: NotificationMessage): void {
    this.messages.push(message);
  }
}

class ThrowingNotificationPort extends NotificationPort {
  override notify(): void {
    throw new Error('Notification delivery failed.');
  }
}

describe('RubricGradingFacade optimistic score changes', () => {
  it('shows the pending change while saving, clears it on success, appends exactly one history entry, and emits no notification', async () => {
    const repository = new RubricGradingRepository(new MockTransport());
    const { store } = fakeSessionStore(authorizedInstructorSession());
    const notifications = new RecordingNotificationPort();
    const facade = new RubricGradingFacade(repository, store, notifications);
    await firstValueFrom(facade.load('attempt-optimistic-success'));

    const submission = facade.submitScoreChange({ reason: 'Reconsidered after a re-read.', nextPoints: 88 });
    expect(facade.pendingScoreChange()).toEqual({
      previousPoints: 0,
      nextPoints: 88,
      reason: 'Reconsidered after a re-read.',
      actorId: instructorAccount.id
    });
    expect(facade.scoreChangeState().status).toBe('saving');
    expect(facade.displayedScoreTotal()).toBe(88);

    await firstValueFrom(submission);
    expect(facade.pendingScoreChange()).toBeNull();
    expect(facade.scoreChangeHistory()).toHaveLength(1);
    expect(facade.scoreChangeState().status).toBe('saved');
    expect(facade.lastNotification()).toBeNull();
    expect(notifications.messages).toHaveLength(0);
  });

  it('rolls back a service-error failure from a zero baseline to an empty history and notifies with a retry action', async () => {
    const repository = new RubricGradingRepository(new MockTransport());
    const { store } = fakeSessionStore(authorizedInstructorSession());
    const notifications = new RecordingNotificationPort();
    const facade = new RubricGradingFacade(repository, store, notifications);
    await firstValueFrom(facade.load('attempt-rollback-zero'));
    repository.setMockScenario({ outcome: 'service-error' });

    await expect(
      firstValueFrom(facade.submitScoreChange({ reason: 'Reconsidered after a re-read.', nextPoints: 90 }))
    ).rejects.toBeTruthy();

    expect(facade.pendingScoreChange()).toBeNull();
    expect(facade.previousScoreChangeTotal()).toBe(0);
    expect(facade.displayedScoreTotal()).toBe(0);
    expect(facade.scoreChangeHistory()).toEqual([]);
    expect(facade.scoreChangeState().status).toBe('error');
    expect(notifications.messages).toHaveLength(1);
    expect(notifications.messages[0].kind).toBe('service');
    expect(notifications.messages[0].actions.some((action) => action.type === 'retry')).toBe(true);
    expect(facade.lastNotification()).toEqual(notifications.messages[0]);
  });

  it('rolls back a failed second change to the exact total left by an earlier successful change, leaving persisted history unchanged', async () => {
    const repository = new RubricGradingRepository(new MockTransport());
    const { store } = fakeSessionStore(authorizedInstructorSession());
    const facade = new RubricGradingFacade(repository, store);
    await firstValueFrom(facade.load('attempt-rollback-second'));
    await firstValueFrom(facade.submitScoreChange({ reason: 'First reconsideration after a re-read.', nextPoints: 72 }));
    expect(facade.scoreChangeHistory()).toHaveLength(1);
    expect(facade.previousScoreChangeTotal()).toBe(72);

    repository.setMockScenario({ outcome: 'service-error' });
    await expect(
      firstValueFrom(facade.submitScoreChange({ reason: 'Second reconsideration, which fails.', nextPoints: 95 }))
    ).rejects.toBeTruthy();

    expect(facade.pendingScoreChange()).toBeNull();
    expect(facade.previousScoreChangeTotal()).toBe(72);
    expect(facade.scoreChangeHistory()).toHaveLength(1);
    expect(facade.scoreChangeHistory()[0].nextPoints).toBe(72);
  });

  it('rolls back unauthorized and conflict failures and maps each to a non-retryable notification', async () => {
    const expectedText: Record<'unauthorized' | 'conflict', string> = {
      unauthorized: 'You are not authorized to perform this action.',
      conflict: 'This change conflicts with a newer version. Refresh before trying again.'
    };
    for (const outcome of ['unauthorized', 'conflict'] as const) {
      const repository = new RubricGradingRepository(new MockTransport());
      const { store } = fakeSessionStore(authorizedInstructorSession());
      const notifications = new RecordingNotificationPort();
      const facade = new RubricGradingFacade(repository, store, notifications);
      await firstValueFrom(facade.load(`attempt-${outcome}-rollback`));
      repository.setMockScenario({ outcome });

      await expect(
        firstValueFrom(facade.submitScoreChange({ reason: 'Attempted change.', nextPoints: 80 }))
      ).rejects.toBeTruthy();

      expect(facade.pendingScoreChange()).toBeNull();
      expect(facade.scoreChangeHistory()).toEqual([]);
      expect(notifications.messages).toHaveLength(1);
      expect(notifications.messages[0].actions).toEqual([]);
      expect(notifications.messages[0].text).toBe(expectedText[outcome]);
    }
  });

  it('still rolls back when the notification port throws', async () => {
    const repository = new RubricGradingRepository(new MockTransport());
    const { store } = fakeSessionStore(authorizedInstructorSession());
    const stubRepository = {
      getByAttemptId: repository.getByAttemptId.bind(repository),
      listScoreChanges: repository.listScoreChanges.bind(repository),
      submitScoreChange: () => throwError(() => new ApiTransportError('service', 1))
    } as unknown as RubricGradingRepository;
    const facade = new RubricGradingFacade(stubRepository, store, new ThrowingNotificationPort());
    await firstValueFrom(facade.load('attempt-throwing-port'));

    await expect(
      firstValueFrom(facade.submitScoreChange({ reason: 'Attempted change.', nextPoints: 80 }))
    ).rejects.toBeTruthy();

    expect(facade.pendingScoreChange()).toBeNull();
    expect(facade.scoreChangeHistory()).toEqual([]);
    expect(facade.scoreChangeState().status).toBe('error');
    expect(facade.lastNotification()).not.toBeNull();
  });

  it('shows the optimistic re-evaluated workflow status while pending and reverts to the pre-submit status after rollback', async () => {
    const scoredFixture = createNeutralFixture('attempt-workflow-rollback');
    const scoredGrading = {
      ...scoredFixture,
      selectedLevelIds: Object.fromEntries(scoredFixture.rubric.criteria.map((criterion) => [criterion.id, criterion.levels.at(-1)!.id]))
    };
    const stubRepository = {
      getByAttemptId: () => of(scoredGrading),
      listScoreChanges: () => [],
      submitScoreChange: () => throwError(() => new ApiTransportError('service', 1))
    } as unknown as RubricGradingRepository;
    const { store } = fakeSessionStore(authorizedInstructorSession());
    const facade = new RubricGradingFacade(stubRepository, store);
    await firstValueFrom(facade.load('attempt-workflow-rollback'));
    expect(facade.workflowStatus()).toBe('graded');

    const submission = facade.submitScoreChange({ reason: 'Reconsidered the reasoning score.', nextPoints: 92 });
    expect(facade.workflowStatus()).toBe('re-evaluated');

    await firstValueFrom(submission).catch(() => undefined);
    expect(facade.workflowStatus()).toBe('graded');
  });

  it('rejects a denied session or a missing actor without ever setting a pending change', async () => {
    const repository = new RubricGradingRepository(new MockTransport());
    const { store, sessionSignal } = fakeSessionStore(authorizedInstructorSession());
    const facade = new RubricGradingFacade(repository, store);
    await firstValueFrom(facade.load('attempt-denied-pending'));

    sessionSignal.set(studentSession());
    await expect(firstValueFrom(facade.submitScoreChange({ reason: 'Attempted change.', nextPoints: 90 }))).rejects.toBeTruthy();
    expect(facade.pendingScoreChange()).toBeNull();

    sessionSignal.set(Object.freeze({ ...authorizedInstructorSession(), accountId: '   ' }) as unknown as AuthSession);
    await expect(firstValueFrom(facade.submitScoreChange({ reason: 'Attempted change.', nextPoints: 90 }))).rejects.toBeTruthy();
    expect(facade.pendingScoreChange()).toBeNull();
  });

  it('never lets a stale, later-failing submission clear a newer pending change or overwrite its outcome', async () => {
    const repository = new RubricGradingRepository(new MockTransport());
    const { store } = fakeSessionStore(authorizedInstructorSession());
    const facade = new RubricGradingFacade(repository, store);
    await firstValueFrom(facade.load('attempt-stale-pending'));

    repository.setMockScenario({ outcome: 'service-error' });
    const stale = facade.submitScoreChange({ reason: 'First, stale, and it will fail.', nextPoints: 70 });
    repository.resetMockScenario();
    const current = facade.submitScoreChange({ reason: 'Second, newer, and it will succeed.', nextPoints: 95 });
    expect(facade.pendingScoreChange()?.nextPoints).toBe(95);

    await firstValueFrom(current);
    expect(facade.pendingScoreChange()).toBeNull();
    expect(facade.scoreChangeHistory()).toHaveLength(1);
    expect(facade.scoreChangeHistory()[0].nextPoints).toBe(95);

    await firstValueFrom(stale).catch(() => undefined);
    expect(facade.pendingScoreChange()).toBeNull();
    expect(facade.scoreChangeHistory()).toHaveLength(1);
    expect(facade.scoreChangeHistory()[0].nextPoints).toBe(95);
  });
});
