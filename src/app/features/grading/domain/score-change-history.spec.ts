import { describe, expect, it } from 'vitest';

import {
  MAX_SCORE_CHANGE_REASON_LENGTH,
  SCORE_CHANGE_ERROR_CODES,
  ScoreChangeError,
  createScoreChangeEntry,
  type ScoreChangeEntryInput
} from '../models/score-change.models';
import {
  appendScoreChange,
  buildScoreChangeAuditDraft,
  deriveEvaluationCount,
  selectReEvaluationTimeline
} from './score-change-history';

const baseInput = (overrides: Partial<ScoreChangeEntryInput> = {}): ScoreChangeEntryInput => ({
  id: 'attempt-1-change-2',
  attemptId: 'attempt-1',
  previousPoints: 60,
  nextPoints: 75,
  reason: 'Reconsidered the reasoning criterion after a re-read.',
  actorId: 'instructor-1',
  occurredAt: '2026-01-01T00:00:00.000Z',
  evaluationNumber: 2,
  ...overrides
});

describe('createScoreChangeEntry', () => {
  it('rejects a missing, blank, or whitespace-only reason with reasonRequired and never accepts a delta from input', () => {
    for (const reason of [undefined, '', '   ', '\n\t ']) {
      expect(() => createScoreChangeEntry(baseInput({ reason }))).toThrow(ScoreChangeError);
      try {
        createScoreChangeEntry(baseInput({ reason }));
      } catch (error) {
        expect((error as ScoreChangeError).code).toBe(SCORE_CHANGE_ERROR_CODES.reasonRequired);
      }
    }
  });

  it('rejects a reason longer than the maximum after normalization', () => {
    const reason = `${'a'.repeat(MAX_SCORE_CHANGE_REASON_LENGTH)}  b`;
    expect(() => createScoreChangeEntry(baseInput({ reason }))).toThrowError(
      expect.objectContaining({ code: SCORE_CHANGE_ERROR_CODES.reasonTooLong })
    );
  });

  it('trims and collapses internal whitespace runs in the stored reason', () => {
    const entry = createScoreChangeEntry(baseInput({ reason: '  Needed   a   second   look.  \n\t' }));
    expect(entry.reason).toBe('Needed a second look.');
  });

  it('derives delta from nextPoints minus previousPoints, ignoring any delta on the input', () => {
    const entry = createScoreChangeEntry({ ...baseInput(), delta: 999 } as ScoreChangeEntryInput);
    expect(entry.delta).toBe(15);
    expect(entry.previousPoints).toBe(60);
    expect(entry.nextPoints).toBe(75);
    expect(Object.isFrozen(entry)).toBe(true);
  });

  it('rejects non-finite, negative, or non-numeric points with invalidPoints', () => {
    for (const nextPoints of [-1, Number.NaN, Number.POSITIVE_INFINITY, 'ten' as unknown as number]) {
      expect(() => createScoreChangeEntry(baseInput({ nextPoints }))).toThrowError(
        expect.objectContaining({ code: SCORE_CHANGE_ERROR_CODES.invalidPoints })
      );
    }
  });

  it('rejects a blank actorId with invalidActor and a blank attemptId or id with invalidAttempt', () => {
    expect(() => createScoreChangeEntry(baseInput({ actorId: '  ' }))).toThrowError(
      expect.objectContaining({ code: SCORE_CHANGE_ERROR_CODES.invalidActor })
    );
    expect(() => createScoreChangeEntry(baseInput({ attemptId: '' }))).toThrowError(
      expect.objectContaining({ code: SCORE_CHANGE_ERROR_CODES.invalidAttempt })
    );
    expect(() => createScoreChangeEntry(baseInput({ id: '' }))).toThrowError(
      expect.objectContaining({ code: SCORE_CHANGE_ERROR_CODES.invalidAttempt })
    );
  });

  it('rejects an unparseable occurredAt with invalidTimestamp and otherwise normalizes it to ISO 8601', () => {
    expect(() => createScoreChangeEntry(baseInput({ occurredAt: 'not-a-date' }))).toThrowError(
      expect.objectContaining({ code: SCORE_CHANGE_ERROR_CODES.invalidTimestamp })
    );
    const entry = createScoreChangeEntry(baseInput({ occurredAt: '2026-01-02' }));
    expect(entry.occurredAt).toBe(new Date('2026-01-02').toISOString());
  });

  it('rejects an evaluationNumber below 2 or non-integer values', () => {
    for (const evaluationNumber of [1, 0, 1.5, 'two' as unknown as number]) {
      expect(() => createScoreChangeEntry(baseInput({ evaluationNumber }))).toThrow(ScoreChangeError);
    }
  });
});

describe('appendScoreChange', () => {
  it('appends in chronological order and rejects a duplicate id', () => {
    const first = createScoreChangeEntry(baseInput());
    const history = appendScoreChange([], first);
    expect(history).toEqual([first]);
    expect(Object.isFrozen(history)).toBe(true);
    expect(() => appendScoreChange(history, first)).toThrowError(
      expect.objectContaining({ code: SCORE_CHANGE_ERROR_CODES.duplicateEntry })
    );
  });

  it('rejects an entry timestamped strictly before the last entry but allows an equal timestamp', () => {
    const first = createScoreChangeEntry(baseInput());
    const history = appendScoreChange([], first);
    const earlier = createScoreChangeEntry(baseInput({ id: 'attempt-1-change-3', evaluationNumber: 3, occurredAt: '2025-12-31T00:00:00.000Z' }));
    expect(() => appendScoreChange(history, earlier)).toThrowError(
      expect.objectContaining({ code: SCORE_CHANGE_ERROR_CODES.outOfOrder })
    );
    const sameInstant = createScoreChangeEntry(baseInput({ id: 'attempt-1-change-3', evaluationNumber: 3 }));
    const nextHistory = appendScoreChange(history, sameInstant);
    expect(nextHistory).toHaveLength(2);
  });
});

describe('deriveEvaluationCount', () => {
  it('reports 1 for an untouched attempt and 2 after one persisted change', () => {
    expect(deriveEvaluationCount([])).toBe(1);
    const entry = createScoreChangeEntry(baseInput());
    expect(deriveEvaluationCount([entry])).toBe(2);
  });
});

describe('selectReEvaluationTimeline', () => {
  it('returns a frozen empty array for an empty history', () => {
    const timeline = selectReEvaluationTimeline([]);
    expect(timeline).toEqual([]);
    expect(Object.isFrozen(timeline)).toBe(true);
  });

  it('orders entries newest first and exposes the readable fields', () => {
    const first = createScoreChangeEntry(baseInput());
    const second = createScoreChangeEntry(baseInput({ id: 'attempt-1-change-3', evaluationNumber: 3, occurredAt: '2026-01-02T00:00:00.000Z', previousPoints: 75, nextPoints: 70 }));
    const timeline = selectReEvaluationTimeline([first, second]);
    expect(timeline.map((item) => item.id)).toEqual([second.id, first.id]);
    expect(timeline[0]).toMatchObject({
      actorId: second.actorId,
      previousPoints: 75,
      nextPoints: 70,
      delta: -5,
      reason: second.reason,
      evaluationNumber: 3
    });
  });
});

describe('buildScoreChangeAuditDraft', () => {
  it('builds a single readable audit draft with the mandatory reason and never leaks the student id beyond targetId', () => {
    const entry = createScoreChangeEntry(baseInput());
    const draft = buildScoreChangeAuditDraft(entry, { attemptId: 'attempt-1', studentId: 'STUDENT-SECRET-01', examId: 'written-response-assessment' });
    expect(draft.action).toBe('grading.score-change');
    expect(draft.actor).toBe(entry.actorId);
    expect(draft.targetType).toBe('grading-attempt');
    expect(draft.targetId).toBe('attempt-1');
    expect(draft.occurredAt).toBe(entry.occurredAt);
    expect(draft.before).toMatchObject({ points: 60 });
    expect(draft.after).toMatchObject({ points: 75 });
    expect(draft.mandatoryReason).toBe(entry.reason);
    expect(JSON.stringify(draft)).not.toContain('STUDENT-SECRET-01');
  });
});
