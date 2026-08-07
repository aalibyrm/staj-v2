import { describe, expect, it } from 'vitest';

import type { LearningOutcomeId } from '../../learning-domain/models/learning-domain.models';
import {
  MASTERY_BANDS,
  MASTERY_ERROR_CODES,
  MasteryError,
  createMasteryAttempt,
  masteryBandFor,
  type MasteryAttemptInput
} from './mastery.models';

const outcome = (value: string): LearningOutcomeId => value as LearningOutcomeId;

const validInput = (): MasteryAttemptInput => ({
  outcomeId: outcome('outcome-1'),
  questionId: 'question-1',
  difficulty: 'medium',
  earnedFraction: 0.5,
  answeredAt: '2024-01-01T00:00:00.000Z'
});

const expectMasteryError = (operation: () => unknown, code: string): void => {
  let caught: unknown;
  try {
    operation();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(MasteryError);
  expect(caught).toMatchObject({ code });
};

describe('MASTERY_BANDS', () => {
  it('is a frozen tuple in ascending order', () => {
    expect(MASTERY_BANDS).toEqual(['unmeasured', 'developing', 'approaching', 'proficient', 'advanced']);
    expect(Object.isFrozen(MASTERY_BANDS)).toBe(true);
  });
});

describe('masteryBandFor', () => {
  it('reports unmeasured whenever isMeasured is false, regardless of score', () => {
    expect(masteryBandFor(0.99, false)).toBe('unmeasured');
    expect(masteryBandFor(0, false)).toBe('unmeasured');
  });

  it('puts boundary scores in the higher band', () => {
    expect(masteryBandFor(0.3999, true)).toBe('developing');
    expect(masteryBandFor(0.4, true)).toBe('approaching');
    expect(masteryBandFor(0.5999, true)).toBe('approaching');
    expect(masteryBandFor(0.6, true)).toBe('proficient');
    expect(masteryBandFor(0.8499, true)).toBe('proficient');
    expect(masteryBandFor(0.85, true)).toBe('advanced');
    expect(masteryBandFor(1, true)).toBe('advanced');
  });
});

describe('createMasteryAttempt', () => {
  it('normalizes ids and the timestamp, and freezes the result without mutating the input', () => {
    const input = { ...validInput(), outcomeId: outcome('  outcome-1  '), questionId: '  question-1  ', answeredAt: '2024-01-01T00:00:00Z' };
    const before = JSON.stringify(input);
    const attempt = createMasteryAttempt(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(attempt.outcomeId).toBe('outcome-1');
    expect(attempt.questionId).toBe('question-1');
    expect(attempt.answeredAt).toBe('2024-01-01T00:00:00.000Z');
    expect(Object.isFrozen(attempt)).toBe(true);
  });

  it('rejects a blank outcomeId', () => {
    expectMasteryError(
      () => createMasteryAttempt({ ...validInput(), outcomeId: outcome('   ') }),
      MASTERY_ERROR_CODES.invalidOutcomeId
    );
  });

  it('rejects a blank questionId', () => {
    expectMasteryError(
      () => createMasteryAttempt({ ...validInput(), questionId: '   ' }),
      MASTERY_ERROR_CODES.invalidQuestionId
    );
  });

  it('rejects an unknown difficulty', () => {
    expectMasteryError(
      () => createMasteryAttempt({ ...validInput(), difficulty: 'trivial' as MasteryAttemptInput['difficulty'] }),
      MASTERY_ERROR_CODES.invalidDifficulty
    );
  });

  it('rejects an earnedFraction below 0, above 1, or NaN', () => {
    expectMasteryError(() => createMasteryAttempt({ ...validInput(), earnedFraction: -0.1 }), MASTERY_ERROR_CODES.invalidEarnedFraction);
    expectMasteryError(() => createMasteryAttempt({ ...validInput(), earnedFraction: 1.1 }), MASTERY_ERROR_CODES.invalidEarnedFraction);
    expectMasteryError(() => createMasteryAttempt({ ...validInput(), earnedFraction: Number.NaN }), MASTERY_ERROR_CODES.invalidEarnedFraction);
  });

  it('accepts earnedFraction at the inclusive boundaries 0 and 1', () => {
    expect(createMasteryAttempt({ ...validInput(), earnedFraction: 0 }).earnedFraction).toBe(0);
    expect(createMasteryAttempt({ ...validInput(), earnedFraction: 1 }).earnedFraction).toBe(1);
  });

  it('rejects an unparseable timestamp', () => {
    expectMasteryError(
      () => createMasteryAttempt({ ...validInput(), answeredAt: 'not-a-date' }),
      MASTERY_ERROR_CODES.invalidTimestamp
    );
  });

  it('rejects a non-object input', () => {
    expectMasteryError(() => createMasteryAttempt(null as unknown as MasteryAttemptInput), MASTERY_ERROR_CODES.malformedInput);
  });
});
