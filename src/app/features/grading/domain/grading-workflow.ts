import {
  GRADING_WORKFLOW_ERROR_CODES,
  GradingWorkflowError,
  createGradingWorkflowState,
  type GradingWorkflowState,
  type GradingWorkflowStatus
} from '../models/grading-workflow.models';
import type { RubricGrading } from '../models/rubric.models';

export type GradingWorkflowCounts = Readonly<{
  readonly criterionCount: number;
  readonly scoredCriterionCount: number;
  readonly evaluationCount: number;
}>;

export type GradingWorkflowOptions = Readonly<{
  readonly evaluationCount?: number;
}>;

const DEFAULT_EVALUATION_COUNT = 1;

/** Derives the workflow status from criterion/evaluation counts without mutating the input. */
export const deriveGradingWorkflowStatus = (counts: GradingWorkflowCounts): GradingWorkflowStatus => {
  const { criterionCount, scoredCriterionCount, evaluationCount } = counts;

  if (criterionCount === 0 || scoredCriterionCount === 0) {
    return 'pending';
  }
  if (scoredCriterionCount < criterionCount) {
    return 'partial';
  }
  return evaluationCount >= 2 ? 're-evaluated' : 'graded';
};

/**
 * Counts criteria whose selection is a nonblank string matching one of that
 * criterion's own level ids. Unknown or foreign level ids are not scored.
 */
export const deriveGradingWorkflowState = (
  grading: RubricGrading,
  options: GradingWorkflowOptions = {}
): GradingWorkflowState => {
  const criterionCount = grading.rubric.criteria.length;
  const scoredCriterionCount = grading.rubric.criteria.reduce((count, criterion) => {
    const selectedLevelId = grading.selectedLevelIds[criterion.id];
    const isScored =
      typeof selectedLevelId === 'string' &&
      selectedLevelId.trim().length > 0 &&
      criterion.levels.some((level) => level.id === selectedLevelId);
    return isScored ? count + 1 : count;
  }, 0);
  const evaluationCount = options.evaluationCount ?? DEFAULT_EVALUATION_COUNT;

  return createGradingWorkflowState({
    status: deriveGradingWorkflowStatus({ criterionCount, scoredCriterionCount, evaluationCount }),
    criterionCount,
    scoredCriterionCount,
    evaluationCount
  });
};

export const GRADING_WORKFLOW_TRANSITIONS: Readonly<Record<GradingWorkflowStatus, readonly GradingWorkflowStatus[]>> =
  Object.freeze({
    pending: Object.freeze<GradingWorkflowStatus[]>(['partial', 'graded']),
    partial: Object.freeze<GradingWorkflowStatus[]>(['partial', 'graded']),
    graded: Object.freeze<GradingWorkflowStatus[]>(['re-evaluated']),
    're-evaluated': Object.freeze<GradingWorkflowStatus[]>(['re-evaluated'])
  });

export const canTransitionWorkflow = (from: GradingWorkflowStatus, to: GradingWorkflowStatus): boolean =>
  GRADING_WORKFLOW_TRANSITIONS[from].includes(to);

/** Throws a `GradingWorkflowError` when the requested transition is not permitted. */
export const assertWorkflowTransition = (from: GradingWorkflowStatus, to: GradingWorkflowStatus): void => {
  if (!canTransitionWorkflow(from, to)) {
    throw new GradingWorkflowError(
      GRADING_WORKFLOW_ERROR_CODES.invalidTransition,
      `Cannot transition grading workflow from "${from}" to "${to}".`,
      'status'
    );
  }
};
