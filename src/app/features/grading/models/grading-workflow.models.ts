/**
 * Pure grading workflow status model. Mirrors the immutability, frozen-record,
 * and typed-error conventions established by `rubric.models.ts`.
 */

export const GRADING_WORKFLOW_STATUSES = Object.freeze([
  'pending',
  'partial',
  'graded',
  're-evaluated'
] as const);

export type GradingWorkflowStatus = (typeof GRADING_WORKFLOW_STATUSES)[number];

export const GRADING_WORKFLOW_ERROR_CODES = Object.freeze({
  malformedInput: 'malformed-input',
  invalidStatus: 'invalid-status',
  invalidCriterionCount: 'invalid-criterion-count',
  invalidScoredCriterionCount: 'invalid-scored-criterion-count',
  invalidEvaluationCount: 'invalid-evaluation-count',
  invalidTransition: 'invalid-transition'
} as const);

export type GradingWorkflowErrorCode =
  (typeof GRADING_WORKFLOW_ERROR_CODES)[keyof typeof GRADING_WORKFLOW_ERROR_CODES];

export class GradingWorkflowError extends Error {
  override readonly name = 'GradingWorkflowError';

  constructor(
    readonly code: GradingWorkflowErrorCode,
    message: string,
    readonly target?: string
  ) {
    super(message);
  }
}

export type GradingWorkflowStateInput = Readonly<{
  readonly status: GradingWorkflowStatus;
  readonly criterionCount: number;
  readonly scoredCriterionCount: number;
  readonly evaluationCount: number;
}>;

export type GradingWorkflowState = Readonly<{
  readonly status: GradingWorkflowStatus;
  readonly criterionCount: number;
  readonly scoredCriterionCount: number;
  readonly evaluationCount: number;
  readonly isComplete: boolean;
}>;

type UnknownRecord = Record<string, unknown>;

const fail = (code: GradingWorkflowErrorCode, message: string, target?: string): never => {
  throw new GradingWorkflowError(code, message, target);
};

const nonNegativeInteger = (
  value: unknown,
  code: GradingWorkflowErrorCode,
  message: string,
  target: string
): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return fail(code, message, target);
  }
  return value;
};

/**
 * Validates and freezes a grading workflow state snapshot. Rejects malformed
 * input with a `GradingWorkflowError` rather than coercing it silently.
 */
export const createGradingWorkflowState = (input: GradingWorkflowStateInput): GradingWorkflowState => {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return fail(GRADING_WORKFLOW_ERROR_CODES.malformedInput, 'Grading workflow state input must be an object.');
  }

  const source = input as UnknownRecord;
  const status = source['status'];
  if (typeof status !== 'string' || !GRADING_WORKFLOW_STATUSES.includes(status as GradingWorkflowStatus)) {
    return fail(
      GRADING_WORKFLOW_ERROR_CODES.invalidStatus,
      `Unknown grading workflow status: ${String(status)}.`,
      'status'
    );
  }

  const criterionCount = nonNegativeInteger(
    source['criterionCount'],
    GRADING_WORKFLOW_ERROR_CODES.invalidCriterionCount,
    'criterionCount must be a non-negative integer.',
    'criterionCount'
  );
  const scoredCriterionCount = nonNegativeInteger(
    source['scoredCriterionCount'],
    GRADING_WORKFLOW_ERROR_CODES.invalidScoredCriterionCount,
    'scoredCriterionCount must be a non-negative integer.',
    'scoredCriterionCount'
  );
  if (scoredCriterionCount > criterionCount) {
    return fail(
      GRADING_WORKFLOW_ERROR_CODES.invalidScoredCriterionCount,
      'scoredCriterionCount cannot exceed criterionCount.',
      'scoredCriterionCount'
    );
  }
  const evaluationCount = nonNegativeInteger(
    source['evaluationCount'],
    GRADING_WORKFLOW_ERROR_CODES.invalidEvaluationCount,
    'evaluationCount must be a non-negative integer.',
    'evaluationCount'
  );

  return Object.freeze({
    status: status as GradingWorkflowStatus,
    criterionCount,
    scoredCriterionCount,
    evaluationCount,
    isComplete: criterionCount > 0 && scoredCriterionCount === criterionCount
  });
};
