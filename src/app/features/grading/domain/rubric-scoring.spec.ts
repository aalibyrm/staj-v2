import { describe, expect, it } from 'vitest';

import {
  RUBRIC_ERROR_CODES,
  RubricDomainError,
  createRubric,
  type RubricInput
} from '../models/rubric.models';
import { selectRubricScore } from './rubric-scoring';

const rubricInput = (): RubricInput => ({
  id: 'rubric-test',
  title: 'Test rubric',
  maximumPoints: 100,
  criteria: [
    {
      id: 'criterion-one',
      title: 'Criterion one',
      weight: 0.25,
      maxScore: 4,
      levels: [
        { id: 'zero', label: 'Zero', score: 0 },
        { id: 'mid', label: 'Mid', score: 3 },
        { id: 'max', label: 'Max', score: 4 }
      ]
    },
    {
      id: 'criterion-two',
      title: 'Criterion two',
      weight: 0.75,
      maxScore: 4,
      levels: [
        { id: 'zero', label: 'Zero', score: 0 },
        { id: 'mid', label: 'Mid', score: 2 },
        { id: 'max', label: 'Max', score: 4 }
      ]
    }
  ]
});

const expectDomainError = (operation: () => unknown, code: string): void => {
  let caught: unknown;
  try { operation(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(RubricDomainError);
  expect(caught).toMatchObject({ code });
};

describe('selectRubricScore', () => {
  it('calculates 3/4 at 25 percent of 100 as 18.75 and keeps an exact total', () => {
    const result = selectRubricScore({
      rubric: rubricInput(),
      selectedLevelIds: { 'criterion-one': 'mid', 'criterion-two': 'zero' }
    });
    expect(result.criterionScores[0]?.awardedPoints).toBe(18.75);
    expect(result.total).toBe(18.75);
    expect(result.maximumPoints).toBe(100);
    expect(result.completion).toBe('complete');
  });

  it('does not mutate caller data and freezes the returned graph', () => {
    const input = rubricInput();
    const before = JSON.stringify(input);
    const rubric = createRubric(input);
    const result = selectRubricScore({ rubric, selectedLevelIds: { 'criterion-one': 'max', 'criterion-two': 'max' } });
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(rubric)).toBe(true);
    expect(Object.isFrozen(rubric.criteria)).toBe(true);
    expect(Object.isFrozen(rubric.criteria[0])).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.criterionScores)).toBe(true);
  });

  it('reports incomplete selection without inventing points', () => {
    const result = selectRubricScore({ rubric: rubricInput(), selectedLevelIds: { 'criterion-one': null } });
    expect(result.isComplete).toBe(false);
    expect(result.total).toBe(0);
    expect(result.validation.issues.map((issue) => issue.criterionId)).toEqual(['criterion-one', 'criterion-two']);
  });

  it('rejects malformed, duplicate, invalid-weight, invalid-score, and unknown-selection inputs', () => {
    expectDomainError(() => selectRubricScore({ rubric: null as unknown as RubricInput }), RUBRIC_ERROR_CODES.malformedInput);
    const base = rubricInput();
    const duplicate: RubricInput = {
      ...base,
      criteria: base.criteria.map((criterion, index) =>
        index === 1 ? { ...criterion, id: base.criteria[0]?.id ?? 'criterion-one' } : criterion
      )
    };
    expectDomainError(() => createRubric(duplicate), RUBRIC_ERROR_CODES.duplicateCriterionId);
    const invalidWeight: RubricInput = {
      ...base,
      criteria: base.criteria.map((criterion, index) => index === 0 ? { ...criterion, weight: 0 } : criterion)
    };
    expectDomainError(() => createRubric(invalidWeight), RUBRIC_ERROR_CODES.invalidCriterionWeight);
    const invalidScore: RubricInput = {
      ...base,
      criteria: base.criteria.map((criterion, index) => index === 0
        ? { ...criterion, levels: [{ id: 'zero', label: 'Zero', score: 0 }, { id: 'max', label: 'Max', score: 5 }] }
        : criterion)
    };
    expectDomainError(() => createRubric(invalidScore), RUBRIC_ERROR_CODES.invalidLevelScore);
    expectDomainError(() => selectRubricScore({ rubric: rubricInput(), selectedLevelIds: { 'criterion-one': 'missing' } }), RUBRIC_ERROR_CODES.unknownSelection);
  });
});
