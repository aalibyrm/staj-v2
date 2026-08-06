import { describe, expect, it } from 'vitest';

import { GradingWorkflowError } from '../models/grading-workflow.models';
import type { RubricCriterion, RubricGrading, RubricLevel } from '../models/rubric.models';
import {
  GRADING_WORKFLOW_TRANSITIONS,
  assertWorkflowTransition,
  canTransitionWorkflow,
  deriveGradingWorkflowState,
  deriveGradingWorkflowStatus
} from './grading-workflow';

const level = (id: string): RubricLevel =>
  Object.freeze({ id, label: id, description: '', score: id.endsWith('1') ? 1 : 0 });

const criterion = (id: string, levelIds: readonly string[]): RubricCriterion =>
  Object.freeze({
    id,
    title: id,
    description: '',
    weight: 0.5,
    maxScore: 1,
    levels: Object.freeze(levelIds.map((levelId) => level(levelId))),
    comment: ''
  });

const gradingFixture = (
  criteria: readonly RubricCriterion[],
  selectedLevelIds: Readonly<Record<string, string | null>>
): RubricGrading =>
  Object.freeze({
    context: Object.freeze({
      attemptId: 'attempt-1',
      studentId: 'student-1',
      studentName: 'Learner One',
      examId: 'exam-1',
      examTitle: 'Exam',
      courseTitle: 'Course',
      questionNumber: 1,
      questionCount: 1
    }),
    responsePreview: Object.freeze({
      questionId: 'question-1',
      questionPrompt: 'Prompt',
      responseText: 'Response',
      wordCount: 1,
      attachmentCount: 0,
      submittedAt: null
    }),
    rubric: Object.freeze({
      id: 'rubric-1',
      title: 'Rubric',
      description: '',
      maximumPoints: 100,
      criteria: Object.freeze(criteria)
    }),
    selectedLevelIds: Object.freeze({ ...selectedLevelIds }),
    criterionComments: Object.freeze({}),
    overallFeedback: ''
  }) as RubricGrading;

describe('deriveGradingWorkflowStatus', () => {
  it('reports pending for zero criteria regardless of evaluation count', () => {
    expect(deriveGradingWorkflowStatus({ criterionCount: 0, scoredCriterionCount: 0, evaluationCount: 5 })).toBe(
      'pending'
    );
  });

  it('reports pending when no criteria are scored yet', () => {
    expect(deriveGradingWorkflowStatus({ criterionCount: 3, scoredCriterionCount: 0, evaluationCount: 1 })).toBe(
      'pending'
    );
  });

  it('reports partial when some but not all criteria are scored', () => {
    expect(deriveGradingWorkflowStatus({ criterionCount: 3, scoredCriterionCount: 2, evaluationCount: 1 })).toBe(
      'partial'
    );
  });

  it('reports graded when all criteria are scored and evaluation count is zero or one', () => {
    expect(deriveGradingWorkflowStatus({ criterionCount: 3, scoredCriterionCount: 3, evaluationCount: 0 })).toBe(
      'graded'
    );
    expect(deriveGradingWorkflowStatus({ criterionCount: 3, scoredCriterionCount: 3, evaluationCount: 1 })).toBe(
      'graded'
    );
  });

  it('reports re-evaluated when all criteria are scored and evaluation count is two or more', () => {
    expect(deriveGradingWorkflowStatus({ criterionCount: 3, scoredCriterionCount: 3, evaluationCount: 2 })).toBe(
      're-evaluated'
    );
  });
});

describe('deriveGradingWorkflowState', () => {
  it('treats an empty rubric as pending, not graded', () => {
    const grading = gradingFixture([], {});
    const state = deriveGradingWorkflowState(grading);
    expect(state.status).toBe('pending');
    expect(state.criterionCount).toBe(0);
    expect(state.scoredCriterionCount).toBe(0);
    expect(state.isComplete).toBe(false);
  });

  it('does not count a selection referencing a level id from a different criterion', () => {
    const criteria = [criterion('criterion-a', ['a-0', 'a-1']), criterion('criterion-b', ['b-0', 'b-1'])];
    const grading = gradingFixture(criteria, { 'criterion-a': 'b-0', 'criterion-b': null });
    const state = deriveGradingWorkflowState(grading);
    expect(state.scoredCriterionCount).toBe(0);
    expect(state.status).toBe('pending');
  });

  it('does not count an unknown level id', () => {
    const criteria = [criterion('criterion-a', ['a-0', 'a-1'])];
    const grading = gradingFixture(criteria, { 'criterion-a': 'unknown-level' });
    const state = deriveGradingWorkflowState(grading);
    expect(state.scoredCriterionCount).toBe(0);
  });

  it('reaches graded with a zero evaluation count once every criterion is validly scored', () => {
    const criteria = [criterion('criterion-a', ['a-0', 'a-1']), criterion('criterion-b', ['b-0', 'b-1'])];
    const grading = gradingFixture(criteria, { 'criterion-a': 'a-1', 'criterion-b': 'b-0' });
    const state = deriveGradingWorkflowState(grading, { evaluationCount: 0 });
    expect(state.scoredCriterionCount).toBe(2);
    expect(state.status).toBe('graded');
    expect(state.isComplete).toBe(true);
  });

  it('defaults the evaluation count to one and returns a frozen state', () => {
    const criteria = [criterion('criterion-a', ['a-0', 'a-1'])];
    const grading = gradingFixture(criteria, { 'criterion-a': 'a-1' });
    const state = deriveGradingWorkflowState(grading);
    expect(state.evaluationCount).toBe(1);
    expect(state.status).toBe('graded');
    expect(Object.isFrozen(state)).toBe(true);
  });
});

describe('workflow transitions', () => {
  it('allows the documented forward transitions', () => {
    expect(canTransitionWorkflow('pending', 'partial')).toBe(true);
    expect(canTransitionWorkflow('pending', 'graded')).toBe(true);
    expect(canTransitionWorkflow('partial', 'partial')).toBe(true);
    expect(canTransitionWorkflow('partial', 'graded')).toBe(true);
    expect(canTransitionWorkflow('graded', 're-evaluated')).toBe(true);
    expect(canTransitionWorkflow('re-evaluated', 're-evaluated')).toBe(true);
  });

  it('forbids regressions back to pending, graded to partial, and re-evaluated regressions', () => {
    expect(canTransitionWorkflow('partial', 'pending')).toBe(false);
    expect(canTransitionWorkflow('graded', 'pending')).toBe(false);
    expect(canTransitionWorkflow('re-evaluated', 'pending')).toBe(false);
    expect(canTransitionWorkflow('graded', 'partial')).toBe(false);
    expect(canTransitionWorkflow('re-evaluated', 'graded')).toBe(false);
    expect(canTransitionWorkflow('re-evaluated', 'partial')).toBe(false);
    expect(canTransitionWorkflow('pending', 're-evaluated')).toBe(false);
  });

  it('throws a GradingWorkflowError for a forbidden graded to partial transition', () => {
    expect(() => assertWorkflowTransition('graded', 'partial')).toThrow(GradingWorkflowError);
    try {
      assertWorkflowTransition('graded', 'partial');
      throw new Error('expected assertWorkflowTransition to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(GradingWorkflowError);
      expect((error as GradingWorkflowError).code).toBe('invalid-transition');
    }
  });

  it('does not throw for an allowed transition', () => {
    expect(() => assertWorkflowTransition('pending', 'partial')).not.toThrow();
  });

  it('exposes an immutable transition table', () => {
    expect(Object.isFrozen(GRADING_WORKFLOW_TRANSITIONS)).toBe(true);
    expect(Object.isFrozen(GRADING_WORKFLOW_TRANSITIONS.pending)).toBe(true);
  });
});
