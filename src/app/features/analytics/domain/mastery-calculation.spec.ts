import { describe, expect, it } from 'vitest';

import type {
  LearningOutcomeId,
  LearningOutcomeMasteryById,
  LearningPathRecommendationInput
} from '../../learning-domain/models/learning-domain.models';
import {
  MASTERY_ERROR_CODES,
  MasteryError,
  createMasteryAttempt,
  type MasteryAttempt,
  type MasteryOutcomeScore
} from '../models/mastery.models';
import {
  MASTERY_DEFAULTS,
  resolveMasteryOptions,
  selectMasteryByOutcomeId,
  selectOutcomeMastery,
  selectOutcomeMasteryById
} from './mastery-calculation';

const outcome = (value: string): LearningOutcomeId => value as LearningOutcomeId;

const mk = (
  outcomeId: string,
  questionId: string,
  difficulty: MasteryAttempt['difficulty'],
  earnedFraction: number,
  answeredAt: string
): MasteryAttempt =>
  createMasteryAttempt({ outcomeId: outcome(outcomeId), questionId, difficulty, earnedFraction, answeredAt });

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

const scoreFor = (
  scores: readonly MasteryOutcomeScore[],
  outcomeId: string
): MasteryOutcomeScore => {
  const found = scores.find((score) => score.outcomeId === outcomeId);
  if (found === undefined) throw new Error(`No score for outcome ${outcomeId}`);
  return found;
};

describe('MASTERY_DEFAULTS', () => {
  it('matches the documented constants', () => {
    expect(MASTERY_DEFAULTS).toEqual({
      recencyWindow: 10,
      difficultyWeights: { easy: 0.8, medium: 1, hard: 1.3 },
      recencyDecay: 0.15,
      repetitionDecay: 0.5
    });
  });
});

describe('resolveMasteryOptions', () => {
  it('returns the defaults when no options are supplied', () => {
    expect(resolveMasteryOptions()).toEqual(MASTERY_DEFAULTS);
  });

  it('rejects a zero recencyWindow', () => {
    expectMasteryError(() => resolveMasteryOptions({ recencyWindow: 0 }), MASTERY_ERROR_CODES.invalidOptions);
  });

  it('rejects a fractional recencyWindow', () => {
    expectMasteryError(() => resolveMasteryOptions({ recencyWindow: 2.5 }), MASTERY_ERROR_CODES.invalidOptions);
  });

  it('rejects a recencyDecay above 1', () => {
    expectMasteryError(() => resolveMasteryOptions({ recencyDecay: 2 }), MASTERY_ERROR_CODES.invalidOptions);
  });

  it('rejects a non-finite decay', () => {
    expectMasteryError(() => resolveMasteryOptions({ recencyDecay: Number.NaN }), MASTERY_ERROR_CODES.invalidOptions);
    expectMasteryError(() => resolveMasteryOptions({ repetitionDecay: Number.POSITIVE_INFINITY }), MASTERY_ERROR_CODES.invalidOptions);
  });
});

describe('selectOutcomeMastery — empty input', () => {
  it('returns an empty frozen array', () => {
    const scores = selectOutcomeMastery([]);
    expect(scores).toEqual([]);
    expect(Object.isFrozen(scores)).toBe(true);
  });
});

describe('selectOutcomeMastery — measured vs unmeasured', () => {
  it('scores one perfect hard attempt as 1 and advanced', () => {
    const scores = selectOutcomeMastery([mk('perfect', 'q1', 'hard', 1, '2024-01-01T00:00:00.000Z')]);
    const score = scoreFor(scores, 'perfect');
    expect(score.score).toBe(1);
    expect(score.band).toBe('advanced');
    expect(score.isMeasured).toBe(true);
  });

  it('scores one zero-credit attempt as 0 and developing, not unmeasured', () => {
    const scores = selectOutcomeMastery([mk('zero', 'q1', 'medium', 0, '2024-01-01T00:00:00.000Z')]);
    const score = scoreFor(scores, 'zero');
    expect(score.score).toBe(0);
    expect(score.band).toBe('developing');
    expect(score.isMeasured).toBe(true);
  });
});

describe('selectOutcomeMastery — difficulty weighting', () => {
  it('scores a hard correct answer higher than an easy correct answer mixed with the same wrong answers', () => {
    const wrongs = (o: string): MasteryAttempt[] => [
      mk(o, 'w1', 'medium', 0, '2024-01-02T00:00:00.000Z'),
      mk(o, 'w2', 'medium', 0, '2024-01-01T00:00:00.000Z')
    ];
    const scores = selectOutcomeMastery([
      mk('hard-outcome', 'correct', 'hard', 1, '2024-01-03T00:00:00.000Z'),
      ...wrongs('hard-outcome'),
      mk('easy-outcome', 'correct', 'easy', 1, '2024-01-03T00:00:00.000Z'),
      ...wrongs('easy-outcome')
    ]);
    const hardScore = scoreFor(scores, 'hard-outcome').score;
    const easyScore = scoreFor(scores, 'easy-outcome').score;
    expect(hardScore).toBeGreaterThan(easyScore);
  });
});

describe('selectOutcomeMastery — recency', () => {
  it('scores above 0.5 when the newer attempt is correct and the older is wrong', () => {
    const scores = selectOutcomeMastery([
      mk('recency', 'newer', 'medium', 1, '2024-01-02T00:00:00.000Z'),
      mk('recency', 'older', 'medium', 0, '2024-01-01T00:00:00.000Z')
    ]);
    expect(scoreFor(scores, 'recency').score).toBeGreaterThan(0.5);
  });

  it('scores below 0.5 when the timestamps are reversed (older correct, newer wrong)', () => {
    const scores = selectOutcomeMastery([
      mk('recency', 'newer', 'medium', 0, '2024-01-02T00:00:00.000Z'),
      mk('recency', 'older', 'medium', 1, '2024-01-01T00:00:00.000Z')
    ]);
    expect(scoreFor(scores, 'recency').score).toBeLessThan(0.5);
  });
});

describe('selectOutcomeMastery — repetition', () => {
  it('damps older sightings of the same question and reports a nonzero repetitionPenalty', () => {
    const scores = selectOutcomeMastery([
      mk('repeat', 'q1', 'medium', 1, '2024-01-03T00:00:00.000Z'),
      mk('repeat', 'q1', 'medium', 1, '2024-01-02T00:00:00.000Z'),
      mk('repeat', 'q1', 'medium', 1, '2024-01-01T00:00:00.000Z')
    ]);
    expect(scoreFor(scores, 'repeat').repetitionPenalty).toBeGreaterThan(0);
  });

  it('reports a repetitionPenalty of 0 for three different questions with identical results', () => {
    const scores = selectOutcomeMastery([
      mk('distinct', 'q1', 'medium', 1, '2024-01-03T00:00:00.000Z'),
      mk('distinct', 'q2', 'medium', 1, '2024-01-02T00:00:00.000Z'),
      mk('distinct', 'q3', 'medium', 1, '2024-01-01T00:00:00.000Z')
    ]);
    expect(scoreFor(scores, 'distinct').repetitionPenalty).toBe(0);
  });
});

describe('selectOutcomeMastery — recency window', () => {
  it('keeps only the newest recencyWindow attempts and reports attemptCount greater than consideredCount', () => {
    const attempts = Array.from({ length: 12 }, (_, index) =>
      mk('windowed', `q${String(index)}`, 'medium', 1, `2024-02-${String(20 - index).padStart(2, '0')}T00:00:00.000Z`)
    );
    const score = scoreFor(selectOutcomeMastery(attempts), 'windowed');
    expect(score.attemptCount).toBe(12);
    expect(score.consideredCount).toBe(10);
    expect(score.attemptCount).toBeGreaterThan(score.consideredCount);
  });
});

describe('selectOutcomeMastery — deterministic tie-break', () => {
  it('breaks equal answeredAt ties by questionId so repeated runs give identical output', () => {
    const sameTime = '2024-01-01T00:00:00.000Z';
    const earnedFractionByQuestionId: Readonly<Record<string, number>> = { a: 0.1, b: 0.5, c: 0.9 };
    const buildAttempts = (order: readonly string[]): readonly MasteryAttempt[] =>
      order.map((questionId) => mk('tie', questionId, 'medium', earnedFractionByQuestionId[questionId] ?? 0, sameTime));

    const first = selectOutcomeMastery(buildAttempts(['c', 'a', 'b']));
    const second = selectOutcomeMastery(buildAttempts(['b', 'c', 'a']));
    expect(first).toEqual(second);
  });
});

describe('selectOutcomeMastery — band boundaries', () => {
  it('assigns a single attempt scoring exactly 0.4, 0.6, or 0.85 to the higher band', () => {
    const scores = selectOutcomeMastery([
      mk('b40', 'q', 'medium', 0.4, '2024-01-01T00:00:00.000Z'),
      mk('b60', 'q', 'medium', 0.6, '2024-01-01T00:00:00.000Z'),
      mk('b85', 'q', 'medium', 0.85, '2024-01-01T00:00:00.000Z')
    ]);
    expect(scoreFor(scores, 'b40').band).toBe('approaching');
    expect(scoreFor(scores, 'b60').band).toBe('proficient');
    expect(scoreFor(scores, 'b85').band).toBe('advanced');
  });
});

describe('selectOutcomeMastery — immutability and freezing', () => {
  it('does not mutate the input attempts array', () => {
    const attempts = [
      mk('frozen', 'q1', 'hard', 1, '2024-01-02T00:00:00.000Z'),
      mk('frozen', 'q2', 'easy', 0, '2024-01-01T00:00:00.000Z')
    ];
    const before = JSON.stringify(attempts);
    selectOutcomeMastery(attempts);
    expect(JSON.stringify(attempts)).toBe(before);
  });

  it('freezes the returned array and every element', () => {
    const scores = selectOutcomeMastery([mk('frozen', 'q1', 'hard', 1, '2024-01-01T00:00:00.000Z')]);
    expect(Object.isFrozen(scores)).toBe(true);
    expect(Object.isFrozen(scores[0])).toBe(true);
  });
});

describe('selectMasteryByOutcomeId', () => {
  it('returns an empty frozen map for an empty attempt list', () => {
    const map = selectMasteryByOutcomeId([]);
    expect(map).toEqual({});
    expect(Object.isFrozen(map)).toBe(true);
  });

  it('contains only attempted outcomes with finite scores in 0..1, and is frozen', () => {
    const map = selectMasteryByOutcomeId([
      mk('outcome-a', 'q1', 'hard', 1, '2024-01-01T00:00:00.000Z'),
      mk('outcome-b', 'q1', 'easy', 0, '2024-01-01T00:00:00.000Z')
    ]);
    expect(Object.keys(map).sort()).toEqual(['outcome-a', 'outcome-b']);
    for (const value of Object.values(map)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(Object.isFrozen(map)).toBe(true);
  });

  it('is type-assignable to LearningOutcomeMasteryById and LearningPathRecommendationInput.masteryByOutcomeId without a cast', () => {
    const attempts = [mk('outcome-a', 'q1', 'hard', 1, '2024-01-01T00:00:00.000Z')];
    const masteryByOutcomeId: LearningOutcomeMasteryById = selectMasteryByOutcomeId(attempts);
    const recommendationInput: LearningPathRecommendationInput = {
      courseId: 'course-1' as LearningPathRecommendationInput['courseId'],
      masteryByOutcomeId: selectMasteryByOutcomeId(attempts),
      completedContentIds: [],
      lockedContentIds: []
    };
    expect(masteryByOutcomeId).toEqual(recommendationInput.masteryByOutcomeId);
  });
});

describe('selectOutcomeMasteryById', () => {
  it('returns a frozen full record keyed by outcomeId', () => {
    const record = selectOutcomeMasteryById([mk('outcome-a', 'q1', 'hard', 1, '2024-01-01T00:00:00.000Z')]);
    expect(record['outcome-a' as LearningOutcomeId]?.isMeasured).toBe(true);
    expect(Object.isFrozen(record)).toBe(true);
  });
});
