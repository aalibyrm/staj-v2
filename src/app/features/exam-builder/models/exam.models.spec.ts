import { describe, expect, it } from 'vitest';

import { createExamBlueprint } from './exam-blueprint.models';
import {
  asCourseId,
  asLearningOutcomeId,
  asQuestionId,
  asQuestionVersionId,
  type QuestionVersion
} from '../../question-bank/models/question.models';
import {
  asExamId,
  asExamVersionId,
  createExam,
  normalizeExamSettings,
  questionCoverageFromVersions,
  validateExamQuestionVersions
} from './exam.models';

const blueprint = () => createExamBlueprint({
  targetQuestionCount: 1,
  targetPoints: 2,
  outcomeBuckets: [{ key: 'OUT-1', targetQuestionCount: 1, targetPoints: 2 }],
  difficultyBuckets: [{ key: 'easy', targetQuestionCount: 1, targetPoints: 2 }],
  questionTypeBuckets: [{ key: 'single-choice', targetQuestionCount: 1, targetPoints: 2 }]
});

const snapshot = (overrides: Record<string, unknown> = {}): QuestionVersion => ({
  id: asQuestionId('Q-1'), questionId: asQuestionId('Q-1'), version: 1, versionId: asQuestionVersionId('Q-1-v1'), status: 'published',
  courseId: asCourseId('COURSE-1'), outcomeId: asLearningOutcomeId('OUT-1'), course: { id: asCourseId('COURSE-1'), code: 'C', title: 'Course' },
  outcome: { id: asLearningOutcomeId('OUT-1'), code: 'O', title: 'Outcome' }, title: 'Question', stem: 'Stem', explanation: '', tags: [], difficulty: 'easy', points: 2,
  grade: 'foundation', type: 'single-choice', options: [{ id: 'A', label: 'A' }], answer: { kind: 'choice', optionIds: ['A'] },
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', publishedAt: '2026-01-01T00:00:00.000Z', changeNote: 'seed', ...overrides
} as QuestionVersion);

describe('exam aggregate model', () => {
  it('normalizes settings and copies/freezes nested input and output', () => {
    const rules = [{ key: ' shuffle ', value: ' true ' }];
    const input = { title: '  Algebra  ', durationMinutes: 45, rules, blueprint: blueprint()!, questionVersions: [snapshot()] };
    const exam = createExam({ id: asExamId('EXAM-1'), versionId: asExamVersionId('EXAM-1-v1'), version: 1, status: 'draft', ...input, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
    expect(exam?.title).toBe('Algebra');
    expect(exam?.rules).toEqual([{ key: 'shuffle', value: 'true' }]);
    expect(Object.isFrozen(exam)).toBe(true);
    expect(Object.isFrozen(exam?.rules)).toBe(true);
    expect(Object.isFrozen(exam?.rules[0])).toBe(true);
    expect(Object.isFrozen(exam?.questionVersions[0]?.options)).toBe(true);
    rules[0]!.key = 'mutated';
    expect(exam?.rules[0]?.key).toBe('shuffle');
  });

  it('rejects invalid settings and duplicate/nonpublished snapshots', () => {
    expect(normalizeExamSettings({ title: ' ', durationMinutes: 0, rules: [] })).toBeNull();
    expect(validateExamQuestionVersions([snapshot(), snapshot()])).toEqual(expect.arrayContaining([{ code: 'duplicate-question', path: 'questionVersions[1].questionId', message: expect.any(String) }]));
    expect(validateExamQuestionVersions([snapshot({ status: 'draft' })])[0]?.code).toBe('invalid-snapshot');
  });
  it('accepts every legitimate question answer shape and rejects incomplete snapshots', () => {
    const variants = [
      snapshot(),
      snapshot({ type: 'multiple-choice', options: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }], answer: { kind: 'choice', optionIds: ['A', 'B'] } }),
      snapshot({ type: 'true-false', answer: { kind: 'boolean', value: true } }),
      snapshot({ type: 'matching', options: [], answer: { kind: 'matching', pairs: [{ prompt: 'One', answer: 'A' }, { prompt: 'Two', answer: 'B' }] } }),
      snapshot({ type: 'short-answer', options: [], answer: { kind: 'short-answer', acceptedAnswers: ['accepted'] } }),
      snapshot({ type: 'essay', options: [], answer: { kind: 'essay', rubricHint: 'Use evidence.' } })
    ];
    for (const candidate of variants) expect(validateExamQuestionVersions([candidate])).toEqual([]);
    expect(validateExamQuestionVersions([snapshot({ stem: undefined })])[0]?.code).toBe('invalid-snapshot');
    expect(validateExamQuestionVersions([snapshot({ answer: { kind: 'boolean', value: 'yes' } })])[0]?.code).toBe('invalid-snapshot');
  });

  it('derives exact count and point coverage from pinned versions', () => {
    const coverage = questionCoverageFromVersions([snapshot()] as never);
    expect(coverage.outcomeBuckets).toEqual([{ key: 'OUT-1', currentQuestionCount: 1, currentPoints: 2 }]);
    expect(coverage.difficultyBuckets[0]?.currentQuestionCount).toBe(1);
    expect(coverage.questionTypeBuckets[0]?.currentPoints).toBe(2);
  });
});
