import { firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { createAnswerDraft } from '../models/answer-draft.models';
import type { ExamSession, ExamSessionState } from '../models/exam-session.models';
import {
  ExamSessionRepository,
  type ExamSessionOpenInput,
  type ExamSessionRepositoryOptions
} from './exam-session.repository';

const sequence = (...values: string[]): (() => string) => {
  let index = 0;
  return () => values[index++] ?? values[values.length - 1] ?? '';
};

const repositoryWithSources = (
  options: Readonly<{
    readonly ids?: readonly string[];
    readonly tokens?: readonly string[];
    readonly referenceTimes?: readonly string[];
  }> = {}
): ExamSessionRepository => {
  const ids = options.ids ?? ['session-1', 'session-2', 'session-3'];
  const tokens = options.tokens ?? ['opaque-token-1', 'opaque-token-2', 'opaque-token-3'];
  const referenceTimes = options.referenceTimes ?? ['2026-08-05T10:00:00.000Z'];
  const repositoryOptions: ExamSessionRepositoryOptions = {
    idSource: sequence(...ids),
    tokenSource: sequence(...tokens),
    referenceTimeSource: sequence(...referenceTimes)
  };
  return new ExamSessionRepository(repositoryOptions);
};

const openInput = (overrides: Partial<ExamSessionOpenInput> = {}): ExamSessionOpenInput => ({
  studentId: 'student-1',
  examId: 'exam-1',
  durationMs: 90_000,
  ...overrides
});

const advance = async (
  repository: ExamSessionRepository,
  session: ExamSession,
  states: readonly ExamSessionState[]
): Promise<ExamSession> => {
  let current = session;
  for (const state of states) {
    current = await firstValueFrom(repository.transition(current.id, state, { expectedVersion: current.version }));
  }
  return current;
};

describe('ExamSessionRepository', () => {
  it('opens immutable normalized sessions with injected identity and reference sources', async () => {
    const repository = repositoryWithSources({
      ids: ['session-a'],
      tokens: ['opaque-a'],
      referenceTimes: ['reference-a']
    });

    const session = await firstValueFrom(repository.open(openInput({ studentId: '  student-a  ', examId: '  exam-a  ' })));

    expect(session).toMatchObject({
      id: 'session-a',
      routeToken: 'opaque-a',
      studentId: 'student-a',
      examId: 'exam-a',
      state: 'created',
      version: 1,
      createdAt: 'reference-a',
      startedAt: 'reference-a',
      referenceTime: 'reference-a',
      durationMs: 90_000
    });
    expect(Object.isFrozen(session)).toBe(true);
  });
  it('retains duration through immutable lifecycle transitions', async () => {
    const repository = repositoryWithSources();
    const created = await firstValueFrom(repository.open(openInput({ durationMs: 120_000 })));
    const active = await firstValueFrom(repository.transition(created.id, 'active', { expectedVersion: created.version }));

    expect(active.durationMs).toBe(120_000);
    expect(Object.isFrozen(active)).toBe(true);
    expect(active).not.toBe(created);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid open duration %s without storing a session',
    async (durationMs) => {
      const repository = repositoryWithSources();

      await expect(firstValueFrom(repository.open(openInput({ durationMs })))).rejects.toMatchObject({ code: 'validation' });
      expect(repository.getSnapshot().sessions).toHaveLength(0);
    }
  );

  it('resolves a token, rejects missing tokens, and keeps generated tokens unique', async () => {
    const repository = repositoryWithSources({
      ids: ['session-a', 'session-b'],
      tokens: ['opaque-token'],
      referenceTimes: ['reference-a', 'reference-b']
    });
    const first = await firstValueFrom(repository.open(openInput()));
    const second = await firstValueFrom(repository.open(openInput({ studentId: 'student-2' })));

    expect(second.routeToken).not.toBe(first.routeToken);
    expect(await firstValueFrom(repository.resolveByToken(`  ${first.routeToken}  `))).toBe(first);
    await expect(firstValueFrom(repository.resolveByToken('missing-token'))).rejects.toMatchObject({ code: 'not-found' });
  });

  it.each([
    ['created', []],
    ['active', ['active']],
    ['disconnected', ['active', 'disconnected']],
    ['reconnecting', ['active', 'disconnected', 'reconnecting']]
  ] as const)('rejects a duplicate normalized student/exam pair while %s is nonterminal', async (_state, path) => {
    const repository = repositoryWithSources({ ids: ['session-1', 'session-2'], tokens: ['token-1', 'token-2'] });
    const current = await firstValueFrom(repository.open(openInput({ studentId: ' student-1 ', examId: ' exam-1 ' })));
    const nonterminal = await advance(repository, current, path);
    const before = repository.getSnapshot();

    await expect(firstValueFrom(repository.open(openInput({ studentId: 'student-1', examId: '  exam-1  ' })))).rejects.toMatchObject({
      code: 'conflict',
      reason: 'duplicate-active-session'
    });
    expect(repository.getSnapshot()).toEqual(before);
    expect(nonterminal.state).toBe(_state);
  });

  it('accepts distinct student or exam pairs', async () => {
    const repository = repositoryWithSources({
      ids: ['session-1', 'session-2', 'session-3'],
      tokens: ['token-1', 'token-2', 'token-3']
    });

    const first = await firstValueFrom(repository.open(openInput()));
    const differentStudent = await firstValueFrom(repository.open(openInput({ studentId: 'student-2' })));
    const differentExam = await firstValueFrom(repository.open(openInput({ examId: 'exam-2' })));

    expect([first, differentStudent, differentExam].map((session) => session.id)).toEqual([
      'session-1',
      'session-2',
      'session-3'
    ]);
    expect(repository.getSnapshot().sessions).toHaveLength(3);
  });

  it.each([
    ['submitted', ['active', 'submitted']],
    ['expired', ['active', 'expired']],
    ['terminated', ['terminated']]
  ] as const)('allows reopening after %s', async (terminalState, path) => {
    const repository = repositoryWithSources({
      ids: ['session-1', 'session-2'],
      tokens: ['token-1', 'token-2'],
      referenceTimes: ['reference-1', 'reference-2']
    });
    const original = await firstValueFrom(repository.open(openInput()));
    const terminal = await advance(repository, original, path);
    const reopened = await firstValueFrom(repository.open(openInput({ studentId: ' student-1 ', examId: ' exam-1 ' })));

    expect(terminal.state).toBe(terminalState);
    expect(reopened).toMatchObject({ id: 'session-2', routeToken: 'token-2', state: 'created', version: 1 });
    expect(reopened.id).not.toBe(original.id);
    expect(repository.getSnapshot().sessions).toHaveLength(2);
  });

  it('rejects stale expected versions without changing the record or pair index', async () => {
    const repository = repositoryWithSources();
    const created = await firstValueFrom(repository.open(openInput()));
    const before = repository.getSnapshot();

    await expect(firstValueFrom(repository.transition(created.id, 'active', { expectedVersion: created.version + 1 }))).rejects.toMatchObject({
      code: 'conflict',
      reason: 'stale-version'
    });
    expect(repository.getSnapshot()).toEqual(before);

    const active = await firstValueFrom(repository.transition(created.id, 'active', { expectedVersion: created.version }));
    const afterActive = repository.getSnapshot();
    await expect(firstValueFrom(repository.transition(active.routeToken, 'disconnected', { expectedVersion: created.version }))).rejects.toMatchObject({
      code: 'conflict',
      reason: 'stale-version'
    });
    expect(repository.getSnapshot()).toEqual(afterActive);
    await expect(firstValueFrom(repository.open(openInput({ studentId: 'student-1', examId: 'exam-1' })))).rejects.toMatchObject({
      code: 'conflict',
      reason: 'duplicate-active-session'
    });
  });

  it('preserves records and indexes on duplicate, invalid, and stale failures', async () => {
    const repository = repositoryWithSources({ ids: ['session-1', 'session-2'], tokens: ['token-1', 'token-2'] });
    const created = await firstValueFrom(repository.open(openInput()));
    const before = repository.getSnapshot();

    await expect(firstValueFrom(repository.open(openInput({ studentId: ' ' })))).rejects.toMatchObject({ code: 'validation' });
    expect(repository.getSnapshot()).toEqual(before);

    await expect(firstValueFrom(repository.open(openInput({ studentId: 'student-2', routeToken: created.routeToken })))).rejects.toMatchObject({
      code: 'conflict',
      reason: 'duplicate-token'
    });
    expect(repository.getSnapshot()).toEqual(before);

    await expect(firstValueFrom(repository.open(openInput({ studentId: 'student-2', id: created.id })))).rejects.toMatchObject({
      code: 'conflict',
      reason: 'duplicate-id'
    });
    expect(repository.getSnapshot()).toEqual(before);

    await expect(firstValueFrom(repository.transition(created.id, 'submitted', { expectedVersion: created.version }))).rejects.toMatchObject({
      code: 'invalid-transition'
    });
    const sameState = await firstValueFrom(repository.transition(created.id, 'created', { expectedVersion: created.version }));
    expect(sameState).toBe(created);
    expect(sameState.state).toBe('created');
    expect(sameState.version).toBe(created.version);
    expect(Object.isFrozen(sameState)).toBe(true);
    expect(repository.getSnapshot()).toEqual(before);
    await expect(firstValueFrom(repository.transition(created.id, 'active', { expectedVersion: created.version + 1 }))).rejects.toMatchObject({
      code: 'conflict',
      reason: 'stale-version'
    });
    expect(repository.getSnapshot()).toEqual(before);
  });
  it('saves immutable versioned drafts by id or token and hydrates them', async () => {
    const repository = repositoryWithSources({ referenceTimes: ['saved-at-1'] });
    const session = await firstValueFrom(repository.open(openInput()));
    const draft = createAnswerDraft('question-a', 'answer');

    const saved = await firstValueFrom(repository.saveDraft(session.routeToken, 'question-a', draft, {
      expectedVersion: 0,
      latencyMs: 1
    }));
    const hydrated = await firstValueFrom(repository.listDrafts(session.id));

    expect(saved).toMatchObject({ questionId: 'question-a', value: 'answer', version: 1, savedAt: 'saved-at-1' });
    expect(Object.isFrozen(saved)).toBe(true);
    expect(hydrated).toEqual([saved]);
    expect(Object.isFrozen(hydrated)).toBe(true);
    await expect(firstValueFrom(repository.saveDraft(session.id, 'question-a', draft, { expectedVersion: 0 }))).rejects.toMatchObject({
      code: 'conflict',
      reason: 'stale-version'
    });
  });

  it('retries one transient service failure and commits one persisted version increment', async () => {
    vi.useFakeTimers();
    try {
      const referenceTimeSource = vi.fn(() => 'saved-at-1');
      const repository = new ExamSessionRepository({
        idSource: sequence('session-1'),
        tokenSource: sequence('token-1'),
        referenceTimeSource
      });
      const session = await firstValueFrom(repository.open(openInput({ referenceTime: 'session-reference' })));
      repository.setMockScenario({
        outcome: 'service-error',
        transientServiceFailures: 1,
        retryLimit: 1,
        latencyMs: 10,
        retryDelayMs: 5
      });

      const pending = firstValueFrom(repository.saveDraft(
        session.id,
        'question-a',
        createAnswerDraft('question-a', 'answer'),
        { expectedVersion: 0 }
      ));
      await vi.advanceTimersByTimeAsync(25);
      const saved = await pending;

      expect(saved).toMatchObject({ questionId: 'question-a', value: 'answer', version: 1, savedAt: 'saved-at-1' });
      expect(referenceTimeSource).toHaveBeenCalledTimes(1);
      expect(repository.getSnapshot().drafts).toEqual([{
        sessionId: session.id,
        drafts: [saved]
      }]);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it.each([
    ['missing', undefined],
    ['negative', -1],
    ['fractional', 1.5],
    ['nan', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['unsafe', Number.MAX_SAFE_INTEGER + 1],
    ['string', '0']
  ] as const)('rejects %s expectedVersion without mutating persisted drafts', async (_label, expectedVersion) => {
    const repository = repositoryWithSources();
    const session = await firstValueFrom(repository.open(openInput()));
    const before = repository.getSnapshot();

    await expect(firstValueFrom(repository.saveDraft(
      session.id,
      'question-a',
      createAnswerDraft('question-a', 'answer'),
      { expectedVersion: expectedVersion as number }
    ))).rejects.toMatchObject({ code: 'validation' });
    expect(repository.getSnapshot()).toEqual(before);
  });

  it('rejects a draft question mismatch without mutating persisted drafts', async () => {
    const repository = repositoryWithSources();
    const session = await firstValueFrom(repository.open(openInput()));
    const before = repository.getSnapshot();

    await expect(firstValueFrom(repository.saveDraft(
      session.id,
      'question-a',
      createAnswerDraft('question-b', 'answer'),
      { expectedVersion: 0 }
    ))).rejects.toMatchObject({ code: 'validation' });
    expect(repository.getSnapshot()).toEqual(before);
  });

  it('rejects a draft version mismatch without mutating persisted drafts', async () => {
    const repository = repositoryWithSources();
    const session = await firstValueFrom(repository.open(openInput()));
    const before = repository.getSnapshot();

    await expect(firstValueFrom(repository.saveDraft(
      session.id,
      'question-a',
      createAnswerDraft('question-a', 'answer', false, 1),
      { expectedVersion: 0 }
    ))).rejects.toMatchObject({ code: 'conflict', reason: 'stale-version' });
    expect(repository.getSnapshot()).toEqual(before);
  });

  it('does not mutate persisted drafts on terminal transport failure', async () => {
    const repository = repositoryWithSources({ referenceTimes: ['saved-at-1'] });
    const session = await firstValueFrom(repository.open(openInput()));
    const before = repository.getSnapshot();
    repository.setMockScenario({ outcome: 'service-error', retryLimit: 0 });

    await expect(firstValueFrom(repository.saveDraft(session.id, 'question-a', createAnswerDraft('question-a', 'answer'), {
      expectedVersion: 0
    }))).rejects.toMatchObject({ kind: 'service' });
    expect(repository.getSnapshot()).toEqual(before);
  });


  it('rejects blank generated identity sources without mutating repository state', async () => {
    const repository = repositoryWithSources({ ids: [' '], tokens: ['token-1'] });

    await expect(firstValueFrom(repository.open(openInput()))).rejects.toMatchObject({ code: 'validation' });
    expect(repository.getSnapshot().sessions).toHaveLength(0);
  });
});
