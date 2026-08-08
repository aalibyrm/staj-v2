import { describe, expect, it } from 'vitest';

import {
  asCourseId,
  asLearningOutcomeId,
  asQuestionId,
  type Question
} from '../../question-bank/models/question.models';
import {
  ITEM_ANALYSIS_ERROR_CODES,
  ItemAnalysisError,
  selectItemAnalysis,
  type ItemAnalysisEvidence
} from './item-analysis';

const makeQuestion = (id: string, type: Question['type'] = 'single-choice'): Question => {
  const questionId = asQuestionId(id);
  const courseId = asCourseId('COURSE-TEST');
  const outcomeId = asLearningOutcomeId('OUTCOME-TEST');
  const options = Object.freeze([
    Object.freeze({ id: `${id}-a`, label: 'Option A' }),
    Object.freeze({ id: `${id}-b`, label: 'Option B' }),
    Object.freeze({ id: `${id}-c`, label: 'Option C' })
  ]);
  const answer: Question['answer'] = type === 'single-choice'
    ? Object.freeze({ kind: 'choice' as const, optionIds: Object.freeze([`${id}-a`]) })
    : type === 'multiple-choice'
      ? Object.freeze({ kind: 'choice' as const, optionIds: Object.freeze([`${id}-a`, `${id}-b`]) })
      : Object.freeze({ kind: 'essay' as const, rubricHint: 'Use evidence.' });
  return Object.freeze({
    id: questionId,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    status: 'published' as const,
    courseId,
    outcomeId,
    course: Object.freeze({ id: courseId, code: 'TEST', title: 'Test course' }),
    outcome: Object.freeze({ id: outcomeId, code: 'OUT-1', title: 'Test outcome' }),
    title: `Question ${id}`,
    stem: 'Stem',
    explanation: 'Explanation',
    tags: Object.freeze(['test']),
    difficulty: 'medium' as const,
    points: 1,
    grade: 'foundation' as const,
    type,
    options,
    answer
  });
};

const evidenceFor = (
  questionId: string,
  learnerId: string,
  totalScoreFraction: number,
  earnedFraction: number,
  selectedOptionIds: readonly string[] = []
): ItemAnalysisEvidence => Object.freeze({ questionId, learnerId, learnerTotalScoreFraction: totalScoreFraction, earnedFraction, selectedOptionIds });

describe('selectItemAnalysis', () => {
  it('computes facility and the exact 27% discrimination boundary with deterministic tie order', () => {
    const questions = [makeQuestion('Q-2'), makeQuestion('Q-1')];
    const evidence = [
      evidenceFor('Q-1', 'learner-c', 0.9, 0.8),
      evidenceFor('Q-1', 'learner-a', 0.9, 0.2),
      evidenceFor('Q-1', 'learner-d', 0.4, 0.1),
      evidenceFor('Q-1', 'learner-b', 0.5, 0.3)
    ];
    const rows = selectItemAnalysis(questions, evidence);

    expect(rows.map((row) => row.questionId)).toEqual(['Q-1']);
    expect(rows[0]?.responseCount).toBe(4);
    expect(rows[0]?.facilityIndex).toBe(0.35);
    expect(rows[0]?.discrimination).toBe(0.1);
    expect(rows[0]?.discriminationLabel).toBe('weak');
  });

  it('includes configured zero options and counts unlisted selections for choice items', () => {
    const question = makeQuestion('Q-choice', 'multiple-choice');
    const rows = selectItemAnalysis([question], [
      evidenceFor('Q-choice', 'learner-a', 0.8, 0.5, ['Q-choice-a', 'Q-choice-retired']),
      evidenceFor('Q-choice', 'learner-b', 0.2, 0.25, ['Q-choice-a'])
    ]);
    const optionAnalysis = rows[0]?.optionAnalysis;

    expect(optionAnalysis?.status).toBe('applicable');
    expect(optionAnalysis?.rows.map((option) => option.selectionCount)).toEqual([2, 0, 0]);
    expect(optionAnalysis?.rows.map((option) => option.respondentPercentage)).toEqual([100, 0, 0]);
    expect(optionAnalysis?.rows.map((option) => option.isCorrect)).toEqual([true, true, false]);
    expect(optionAnalysis?.unlistedSelectionCount).toBe(1);
  });

  it('returns non-choice analysis as explicit not-applicable with no option rows', () => {
    const rows = selectItemAnalysis([makeQuestion('Q-essay', 'essay')], [evidenceFor('Q-essay', 'learner-a', 0.5, 0.5, ['retired'])]);
    expect(rows[0]?.optionAnalysis).toEqual({ status: 'not-applicable', rows: [], unlistedSelectionCount: 0, allowsMultipleSelections: false });
    expect(rows[0]?.discrimination).toBeNull();
    expect(rows[0]?.discriminationLabel).toBe('insufficient-data');
  });

  it('rejects stable validation, unknown-question, and duplicate-evidence codes', () => {
    const question = makeQuestion('Q-1');
    const expectCode = (callback: () => unknown, code: string): void => {
      try {
        callback();
        throw new Error('Expected selector to throw.');
      } catch (error) {
        if (!(error instanceof ItemAnalysisError)) throw error;
        expect(error.code).toBe(code);
      }
    };

    expectCode(() => selectItemAnalysis([question], [evidenceFor('Q-1', 'learner-a', 1.1, 0.5)]), ITEM_ANALYSIS_ERROR_CODES.invalidFraction);
    expectCode(() => selectItemAnalysis([question], [evidenceFor('Q-other', 'learner-a', 0.5, 0.5)]), ITEM_ANALYSIS_ERROR_CODES.unknownQuestion);
    expectCode(() => selectItemAnalysis([question], [evidenceFor('Q-1', 'learner-a', 0.5, 0.5), evidenceFor('Q-1', 'learner-a', 0.6, 0.6)]), ITEM_ANALYSIS_ERROR_CODES.duplicateEvidence);
  });

  it('returns repeatable frozen output without mutating evidence', () => {
    const question = makeQuestion('Q-1');
    const evidence = [evidenceFor('Q-1', 'learner-a', 0.5, 0.5, ['Q-1-a'])];
    const before = JSON.stringify(evidence);
    const first = selectItemAnalysis([question], evidence);
    const second = selectItemAnalysis([question], evidence);

    expect(JSON.stringify(evidence)).toBe(before);
    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first[0])).toBe(true);
    expect(Object.isFrozen(first[0]?.optionAnalysis)).toBe(true);
    expect(Object.isFrozen(first[0]?.optionAnalysis.rows)).toBe(true);
  });
});
