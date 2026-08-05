import { describe, expect, it } from 'vitest';

import type { LearningOutcomeId } from '../../adaptive-learning/models/seed-domain.models';
import {
  createExamBlueprint,
  validateExamBlueprint,
  type ExamBlueprintInput
} from './exam-blueprint.models';

const outcome = (value: string): LearningOutcomeId => value as LearningOutcomeId;

const validInput = (): ExamBlueprintInput => ({
  targetQuestionCount: 3,
  targetPoints: 0.3,
  outcomeBuckets: [
    { key: outcome('OUT-1'), targetQuestionCount: 1, targetPoints: 0.1 },
    { key: outcome('OUT-2'), targetQuestionCount: 2, targetPoints: 0.2 }
  ],
  difficultyBuckets: [
    { key: 'easy', targetQuestionCount: 1, targetPoints: 0.1 },
    { key: 'medium', targetQuestionCount: 2, targetPoints: 0.2 }
  ],
  questionTypeBuckets: [
    { key: 'single-choice', targetQuestionCount: 1, targetPoints: 0.1 },
    { key: 'multiple-choice', targetQuestionCount: 2, targetPoints: 0.2 }
  ]
});

const issueCodes = (input: unknown): readonly string[] => validateExamBlueprint(input).map((issue) => issue.code);

const withChange = (change: Partial<ExamBlueprintInput>): ExamBlueprintInput => ({ ...validInput(), ...change });

describe('exam blueprint model', () => {
  it('normalizes a complete target and deeply freezes every level', () => {
    const input = validInput();
    const blueprint = createExamBlueprint(input);

    expect(blueprint).not.toBeNull();
    expect(blueprint).toEqual(input);
    expect(Object.isFrozen(blueprint)).toBe(true);
    expect(Object.isFrozen(blueprint?.outcomeBuckets)).toBe(true);
    expect(Object.isFrozen(blueprint?.outcomeBuckets[0])).toBe(true);
    expect(Object.isFrozen(blueprint?.difficultyBuckets)).toBe(true);
    expect(Object.isFrozen(blueprint?.questionTypeBuckets)).toBe(true);
    expect(input.outcomeBuckets[0]).not.toBe(blueprint?.outcomeBuckets[0]);
  });

  it('rejects invalid overall question count values', () => {
    expect(issueCodes(withChange({ targetQuestionCount: 0 }))).toContain('invalid-target-question-count');
    expect(issueCodes(withChange({ targetQuestionCount: 1.5 }))).toContain('invalid-target-question-count');
    expect(issueCodes(withChange({ targetQuestionCount: Number.MAX_SAFE_INTEGER + 1 }))).toContain('invalid-target-question-count');
  });

  it('rejects invalid overall points values', () => {
    expect(issueCodes(withChange({ targetPoints: 0 }))).toContain('invalid-target-points');
    expect(issueCodes(withChange({ targetPoints: Number.NaN }))).toContain('invalid-target-points');
    expect(issueCodes(withChange({ targetPoints: Number.POSITIVE_INFINITY }))).toContain('invalid-target-points');
  });

  it('rejects empty distributions and invalid bucket values', () => {
    expect(issueCodes(withChange({ outcomeBuckets: [] }))).toContain('distribution-required');
    expect(issueCodes(withChange({ outcomeBuckets: [{ key: outcome('  '), targetQuestionCount: 1, targetPoints: 0.3 }] }))).toContain('blank-bucket-key');
    expect(issueCodes(withChange({ outcomeBuckets: [{ key: outcome('OUT-1'), targetQuestionCount: 0, targetPoints: 0.3 }] }))).toContain('invalid-bucket-question-count');
    expect(issueCodes(withChange({ outcomeBuckets: [{ key: outcome('OUT-1'), targetQuestionCount: 1.5, targetPoints: 0.3 }] }))).toContain('invalid-bucket-question-count');
    expect(issueCodes(withChange({ outcomeBuckets: [{ key: outcome('OUT-1'), targetQuestionCount: 1, targetPoints: 0 }] }))).toContain('invalid-bucket-points');
    expect(issueCodes(withChange({ outcomeBuckets: [{ key: outcome('OUT-1'), targetQuestionCount: 1, targetPoints: Number.POSITIVE_INFINITY }] }))).toContain('invalid-bucket-points');
  });

  it('rejects noncanonical and duplicate difficulty/type keys', () => {
    expect(issueCodes(withChange({ difficultyBuckets: [{ key: 'trivial' as 'easy', targetQuestionCount: 3, targetPoints: 0.3 }] }))).toContain('noncanonical-bucket-key');
    expect(issueCodes(withChange({ questionTypeBuckets: [{ key: 'free-form' as 'essay', targetQuestionCount: 3, targetPoints: 0.3 }] }))).toContain('noncanonical-bucket-key');
    expect(issueCodes(withChange({ difficultyBuckets: [{ key: 'easy', targetQuestionCount: 1, targetPoints: 0.1 }, { key: ' easy ' as 'easy', targetQuestionCount: 2, targetPoints: 0.2 }] }))).toContain('duplicate-bucket-key');
  });

  it('rejects inconsistent count and point totals for every independent distribution', () => {
    const input = validInput();
    const countMismatch = withChange({
      outcomeBuckets: [{ key: outcome('OUT-1'), targetQuestionCount: 2, targetPoints: 0.3 }]
    });
    const pointMismatch = withChange({
      difficultyBuckets: [{ key: 'easy', targetQuestionCount: 3, targetPoints: 0.29 }]
    });
    const typeMismatch = withChange({
      questionTypeBuckets: [{ key: 'essay', targetQuestionCount: 2, targetPoints: 0.3 }]
    });

    expect(validateExamBlueprint(countMismatch).some((issue) => issue.path.startsWith('outcomeBuckets'))).toBe(true);
    expect(validateExamBlueprint(pointMismatch).some((issue) => issue.path.startsWith('difficultyBuckets'))).toBe(true);
    expect(validateExamBlueprint(typeMismatch).some((issue) => issue.path.startsWith('questionTypeBuckets'))).toBe(true);
    expect(input.outcomeBuckets).toHaveLength(2);
  });

  it('compares decimal point sums at stable precision', () => {
    const blueprint = createExamBlueprint(validInput());
    expect(blueprint).not.toBeNull();
    expect(validateExamBlueprint(validInput())).toEqual([]);
  });

  it('returns deterministic structured issues with paths and messages without throwing', () => {
    const invalid = withChange({
      targetQuestionCount: 2,
      difficultyBuckets: [
        { key: 'bad' as 'easy', targetQuestionCount: 1, targetPoints: 0.1 },
        { key: 'bad' as 'easy', targetQuestionCount: 1, targetPoints: 0.1 }
      ]
    });

    const first = validateExamBlueprint(invalid);
    const second = validateExamBlueprint(invalid);
    expect(first).toEqual(second);
    expect(first.every((issue) => issue.code && issue.path !== undefined && issue.message.length > 0)).toBe(true);
    expect(first.some((issue) => issue.path === 'difficultyBuckets[0].key')).toBe(true);
    expect(() => validateExamBlueprint(null)).not.toThrow();
    expect(createExamBlueprint(invalid)).toBeNull();
  });
});
