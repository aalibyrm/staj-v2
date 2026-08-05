import type { QuestionAnswer } from '../../question-bank/models/question.models';

export const OBJECTIVE_SCORING_RULES = Object.freeze(['all-or-nothing', 'proportional'] as const);
export type ObjectiveScoringRule = (typeof OBJECTIVE_SCORING_RULES)[number];

export const OBJECTIVE_SCORING_STATUSES = Object.freeze([
  'correct',
  'partial',
  'incorrect',
  'unanswered'
] as const);
export type ObjectiveScoringStatus = (typeof OBJECTIVE_SCORING_STATUSES)[number];

export const OBJECTIVE_SCORING_ERROR_CODES = Object.freeze({
  malformedInput: 'malformed-input',
  invalidMaximumPoints: 'invalid-maximum-points',
  invalidRule: 'invalid-rule',
  emptyConfiguredAnswer: 'empty-configured-answer',
  duplicateConfiguredAnswer: 'duplicate-configured-answer',
  malformedConfiguredAnswer: 'malformed-configured-answer',
  responseKindMismatch: 'response-kind-mismatch',
  malformedResponse: 'malformed-response',
  manualGradingRequired: 'manual-grading-required'
} as const);
export type ObjectiveScoringErrorCode =
  (typeof OBJECTIVE_SCORING_ERROR_CODES)[keyof typeof OBJECTIVE_SCORING_ERROR_CODES];

export class ObjectiveScoringDomainError extends Error {
  override readonly name = 'ObjectiveScoringDomainError';

  constructor(
    readonly code: ObjectiveScoringErrorCode,
    message: string,
    readonly target?: string
  ) {
    super(message);
  }
}

export type ObjectiveChoiceResponse = Readonly<{
  readonly kind: 'choice';
  readonly optionIds: readonly string[];
}>;

export type ObjectiveBooleanResponse = Readonly<{
  readonly kind: 'boolean';
  readonly value: boolean;
}>;

export type ObjectiveMatchingResponse = Readonly<{
  readonly kind: 'matching';
  readonly pairs: readonly Readonly<{
    readonly prompt: string;
    readonly answer: string;
  }>[];
}>;

export type ObjectiveShortAnswerResponse = Readonly<{
  readonly kind: 'short-answer';
  readonly value: string;
}>;

export type ObjectiveUnansweredResponse = Readonly<{
  readonly kind: 'unanswered';
}>;

export type ObjectiveResponse =
  | ObjectiveChoiceResponse
  | ObjectiveBooleanResponse
  | ObjectiveMatchingResponse
  | ObjectiveShortAnswerResponse
  | ObjectiveUnansweredResponse;

export type ObjectiveScoringInput = Readonly<{
  /** The published configured answer. It is intentionally reused, not copied into a second answer model. */
  readonly answer: QuestionAnswer;
  readonly response?: ObjectiveResponse | null;
  readonly maximumPoints: number;
  readonly rule: ObjectiveScoringRule;
}>;

export type ObjectiveScoringResult = Readonly<{
  readonly awardedPoints: number;
  readonly maximumPoints: number;
  readonly earnedFraction: number;
  readonly status: ObjectiveScoringStatus;
}>;
