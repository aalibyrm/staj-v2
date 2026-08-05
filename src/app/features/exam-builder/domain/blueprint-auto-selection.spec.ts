import { describe, expect, it } from 'vitest';

import {
  asLearningOutcomeId,
  asQuestionId,
  asQuestionVersionId
} from '../../question-bank/models/question.models';
import { createExamBlueprint, type ExamBlueprint } from '../models/exam-blueprint.models';
import {
  selectQuestionsForBlueprint,
  type BlueprintSelectionCandidate
} from './blueprint-auto-selection';

const outcome = (value: string) => asLearningOutcomeId(value);

const blueprint = (input: {
  readonly targetQuestionCount: number;
  readonly targetPoints: number;
  readonly outcomes: readonly (readonly [string, number, number])[];
  readonly difficulties: readonly (readonly ['easy' | 'medium' | 'hard', number, number])[];
  readonly types: readonly (readonly ['single-choice' | 'multiple-choice' | 'true-false' | 'matching' | 'short-answer' | 'essay', number, number])[];
}): ExamBlueprint => {
  const result = createExamBlueprint({
    targetQuestionCount: input.targetQuestionCount,
    targetPoints: input.targetPoints,
    outcomeBuckets: input.outcomes.map(([key, targetQuestionCount, targetPoints]) => ({
      key: outcome(key),
      targetQuestionCount,
      targetPoints
    })),
    difficultyBuckets: input.difficulties.map(([key, targetQuestionCount, targetPoints]) => ({
      key,
      targetQuestionCount,
      targetPoints
    })),
    questionTypeBuckets: input.types.map(([key, targetQuestionCount, targetPoints]) => ({
      key,
      targetQuestionCount,
      targetPoints
    }))
  });
  if (result === null) throw new Error('Expected a valid blueprint fixture.');
  return result;
};

const candidate = (
  questionId: string,
  outcomeId: string,
  difficulty: 'easy' | 'medium' | 'hard',
  type: 'single-choice' | 'multiple-choice' | 'true-false' | 'matching' | 'short-answer' | 'essay',
  points: number,
  versionId = `${questionId}-v1`
): BlueprintSelectionCandidate => ({
  questionId: asQuestionId(questionId),
  versionId: asQuestionVersionId(versionId),
  status: 'published',
  outcomeId: outcome(outcomeId),
  difficulty,
  type,
  points
});

const twoDimensionalBlueprint = (): ExamBlueprint => blueprint({
  targetQuestionCount: 2,
  targetPoints: 3,
  outcomes: [['OUT-1', 1, 1], ['OUT-2', 1, 2]],
  difficulties: [['easy', 1, 1], ['hard', 1, 2]],
  types: [['single-choice', 1, 1], ['multiple-choice', 1, 2]]
});

describe('selectQuestionsForBlueprint', () => {
  it('finds an exact multi-dimensional solution and retains pinned versions', () => {
    const result = selectQuestionsForBlueprint(twoDimensionalBlueprint(), [
      candidate('q-2', 'OUT-2', 'hard', 'multiple-choice', 2, 'q-2-v7'),
      candidate('q-1', 'OUT-1', 'easy', 'single-choice', 1, 'q-1-v3')
    ]);

    expect(result.status).toBe('complete');
    expect(result.unmetReasons).toEqual([]);
    expect(result.selected.map(({ questionId, versionId }) => [questionId, versionId])).toEqual([
      ['q-1', 'q-1-v3'],
      ['q-2', 'q-2-v7']
    ]);
    expect(new Set(result.selected.map(({ questionId }) => questionId)).size).toBe(result.selected.length);
  });

  it('backtracks across simultaneous dimensions instead of accepting an early greedy block', () => {
    const result = selectQuestionsForBlueprint(twoDimensionalBlueprint(), [
      candidate('q-e', 'OUT-2', 'hard', 'multiple-choice', 2),
      candidate('q-d', 'OUT-2', 'hard', 'single-choice', 2),
      candidate('q-c', 'OUT-2', 'easy', 'multiple-choice', 1),
      candidate('q-b', 'OUT-1', 'hard', 'multiple-choice', 1),
      candidate('q-a', 'OUT-1', 'easy', 'single-choice', 1)
    ]);

    expect(result.status).toBe('complete');
    expect(result.selected.map(({ questionId }) => questionId)).toEqual(['q-a', 'q-e']);
  });

  it('returns every remaining overall and bucket deficit for an insufficient bank', () => {
    const result = selectQuestionsForBlueprint(twoDimensionalBlueprint(), [
      candidate('q-1', 'OUT-1', 'easy', 'single-choice', 1)
    ]);

    expect(result.status).toBe('partial');
    expect(result.selected.map(({ questionId }) => questionId)).toEqual(['q-1']);
    expect(result.unmetReasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: 'overall', missingCount: 1, missingPoints: 2 }),
      expect.objectContaining({ dimension: 'outcome', key: 'OUT-2', missingCount: 1, missingPoints: 2 }),
      expect.objectContaining({ dimension: 'difficulty', key: 'hard', missingCount: 1, missingPoints: 2 }),
      expect.objectContaining({ dimension: 'questionType', key: 'multiple-choice', missingCount: 1, missingPoints: 2 })
    ]));
    expect(result.unmetReasons.every(({ missingCount, missingPoints, message }) =>
      missingCount >= 0 && missingPoints >= 0 && message.length > 0
    )).toBe(true);
  });

  it('is independent of candidate input ordering', () => {
    const source = [
      candidate('q-2', 'OUT-2', 'hard', 'multiple-choice', 2),
      candidate('q-1', 'OUT-1', 'easy', 'single-choice', 1)
    ];
    const first = selectQuestionsForBlueprint(twoDimensionalBlueprint(), source);
    const second = selectQuestionsForBlueprint(twoDimensionalBlueprint(), [...source].reverse());
    expect(second).toEqual(first);
  });

  it('deduplicates rows and never selects multiple versions of one stable question', () => {
    const target = blueprint({
      targetQuestionCount: 1,
      targetPoints: 2,
      outcomes: [['OUT-1', 1, 2]],
      difficulties: [['easy', 1, 2]],
      types: [['single-choice', 1, 2]]
    });
    const versionOne = candidate('q-1', 'OUT-1', 'easy', 'single-choice', 1, 'q-1-v1');
    const versionTwo = candidate('q-1', 'OUT-1', 'easy', 'single-choice', 2, 'q-1-v2');
    const result = selectQuestionsForBlueprint(target, [versionTwo, versionTwo, versionOne, candidate('q-2', 'OUT-1', 'easy', 'single-choice', 2)]);

    expect(result.status).toBe('complete');
    expect(result.selected).toHaveLength(1);
    expect(result.selected[0]).toMatchObject({ questionId: 'q-1', versionId: 'q-1-v2', points: 2 });
    expect(new Set(result.selected.map(({ questionId }) => questionId)).size).toBe(1);
  });

  it('excludes malformed, non-published, and absent-key runtime rows', () => {
    const target = blueprint({
      targetQuestionCount: 1,
      targetPoints: 1,
      outcomes: [['OUT-1', 1, 1]],
      difficulties: [['easy', 1, 1]],
      types: [['single-choice', 1, 1]]
    });
    const malformed = [
      { ...candidate('draft', 'OUT-1', 'easy', 'single-choice', 1), status: 'draft' },
      { ...candidate('nan', 'OUT-1', 'easy', 'single-choice', 1), points: Number.NaN },
      { ...candidate('bad-difficulty', 'OUT-1', 'easy', 'single-choice', 1), difficulty: 'impossible' },
      { ...candidate('bad-type', 'OUT-1', 'easy', 'single-choice', 1), type: 'free-form' },
      { ...candidate('absent-outcome', 'OUT-2', 'easy', 'single-choice', 1) },
      { ...candidate('absent-difficulty', 'OUT-1', 'hard', 'single-choice', 1) },
      { ...candidate('absent-type', 'OUT-1', 'easy', 'essay', 1) },
      { questionId: 'missing-fields' }
    ] as unknown as readonly BlueprintSelectionCandidate[];
    const result = selectQuestionsForBlueprint(target, [...malformed, candidate('valid', 'OUT-1', 'easy', 'single-choice', 1)]);

    expect(result.status).toBe('complete');
    expect(result.selected.map(({ questionId }) => questionId)).toEqual(['valid']);
  });

  it('uses six-decimal point units rather than raw floating equality', () => {
    const target = blueprint({
      targetQuestionCount: 2,
      targetPoints: 0.3,
      outcomes: [['OUT-1', 2, 0.3]],
      difficulties: [['easy', 2, 0.3]],
      types: [['single-choice', 2, 0.3]]
    });
    const result = selectQuestionsForBlueprint(target, [
      candidate('q-2', 'OUT-1', 'easy', 'single-choice', 0.2),
      candidate('q-1', 'OUT-1', 'easy', 'single-choice', 0.1)
    ]);

    expect(result.status).toBe('complete');
    expect(result.selected).toHaveLength(2);
  });

  it('uses stable identity order to break equal best-partial ties', () => {
    const target = blueprint({
      targetQuestionCount: 1,
      targetPoints: 2,
      outcomes: [['OUT-1', 1, 2]],
      difficulties: [['easy', 1, 2]],
      types: [['single-choice', 1, 2]]
    });
    const result = selectQuestionsForBlueprint(target, [
      candidate('q-b', 'OUT-1', 'easy', 'single-choice', 1),
      candidate('q-a', 'OUT-1', 'easy', 'single-choice', 1)
    ]);

    expect(result.status).toBe('partial');
    expect(result.selected.map(({ questionId }) => questionId)).toEqual(['q-a']);
  });

  it('deeply freezes outward data and leaves inputs unchanged', () => {
    const target = blueprint({
      targetQuestionCount: 1,
      targetPoints: 2,
      outcomes: [['OUT-1', 1, 2]],
      difficulties: [['easy', 1, 2]],
      types: [['single-choice', 1, 2]]
    });
    const input = [candidate('q-1', 'OUT-1', 'easy', 'single-choice', 1)];
    const before = JSON.stringify(input);
    const result = selectQuestionsForBlueprint(target, input);

    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.selected)).toBe(true);
    expect(Object.isFrozen(result.selected[0])).toBe(true);
    expect(Object.isFrozen(result.unmetReasons)).toBe(true);
    expect(Object.isFrozen(result.unmetReasons[0])).toBe(true);
  });
});
