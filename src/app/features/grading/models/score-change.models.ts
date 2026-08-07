/**
 * Score-change domain model: an immutable, mandatory-reason record of a rubric
 * grading attempt's total moving from one value to another. Mirrors the
 * immutability/validation conventions in `rubric.models.ts` (frozen objects,
 * frozen error-code record, typed domain error, `fail()`-style helpers).
 */

export const SCORE_CHANGE_ERROR_CODES = Object.freeze({
  reasonRequired: 'reason-required',
  reasonTooLong: 'reason-too-long',
  invalidPoints: 'invalid-points',
  invalidActor: 'invalid-actor',
  invalidTimestamp: 'invalid-timestamp',
  invalidAttempt: 'invalid-attempt',
  invalidEvaluationNumber: 'invalid-evaluation-number',
  duplicateEntry: 'duplicate-entry',
  outOfOrder: 'out-of-order'
} as const);

export type ScoreChangeErrorCode = (typeof SCORE_CHANGE_ERROR_CODES)[keyof typeof SCORE_CHANGE_ERROR_CODES];

export class ScoreChangeError extends Error {
  override readonly name = 'ScoreChangeError';

  constructor(
    readonly code: ScoreChangeErrorCode,
    message: string,
    readonly target?: string
  ) {
    super(message);
  }
}

/** The first persisted score change is always the second evaluation of an attempt. */
export const MIN_SCORE_CHANGE_EVALUATION_NUMBER = 2;
export const MAX_SCORE_CHANGE_REASON_LENGTH = 500;

export type ScoreChangeEntry = Readonly<{
  readonly id: string;
  readonly attemptId: string;
  readonly previousPoints: number;
  readonly nextPoints: number;
  readonly delta: number;
  readonly reason: string;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly evaluationNumber: number;
}>;

export type ScoreChangeEntryInput = Readonly<{
  readonly id: unknown;
  readonly attemptId: unknown;
  readonly previousPoints: unknown;
  readonly nextPoints: unknown;
  readonly reason: unknown;
  readonly actorId: unknown;
  readonly occurredAt: unknown;
  readonly evaluationNumber: unknown;
}>;

const ROUNDING_FACTOR = 100;

const fail = (code: ScoreChangeErrorCode, message: string, target?: string): never => {
  throw new ScoreChangeError(code, message, target);
};

const roundPoints = (value: number): number => Math.round(value * ROUNDING_FACTOR) / ROUNDING_FACTOR;

/** Trims and collapses internal whitespace runs to a single space; blank input is rejected, not defaulted. */
const normalizeReason = (value: unknown): string => {
  if (typeof value !== 'string') {
    return fail(SCORE_CHANGE_ERROR_CODES.reasonRequired, 'A score-change reason is required.', 'reason');
  }
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (normalized.length === 0) {
    return fail(SCORE_CHANGE_ERROR_CODES.reasonRequired, 'A score-change reason is required.', 'reason');
  }
  if (normalized.length > MAX_SCORE_CHANGE_REASON_LENGTH) {
    return fail(
      SCORE_CHANGE_ERROR_CODES.reasonTooLong,
      `A score-change reason must be ${MAX_SCORE_CHANGE_REASON_LENGTH} characters or fewer.`,
      'reason'
    );
  }
  return normalized;
};

const requirePoints = (value: unknown, target: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fail(SCORE_CHANGE_ERROR_CODES.invalidPoints, `${target} must be a finite number that is zero or greater.`, target);
  }
  return roundPoints(value);
};

const requireNonblankText = (value: unknown, code: ScoreChangeErrorCode, target: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fail(code, `A nonblank ${target} is required.`, target);
  }
  return value.trim();
};

const requireTimestamp = (value: unknown): string => {
  if (typeof value !== 'string' || value.trim().length === 0 || Number.isNaN(Date.parse(value))) {
    return fail(SCORE_CHANGE_ERROR_CODES.invalidTimestamp, 'A valid occurredAt timestamp is required.', 'occurredAt');
  }
  return new Date(value).toISOString();
};

const requireEvaluationNumber = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < MIN_SCORE_CHANGE_EVALUATION_NUMBER) {
    return fail(
      SCORE_CHANGE_ERROR_CODES.invalidEvaluationNumber,
      `evaluationNumber must be an integer of ${MIN_SCORE_CHANGE_EVALUATION_NUMBER} or greater.`,
      'evaluationNumber'
    );
  }
  return value;
};

/**
 * Builds an immutable score-change entry. `delta` is always derived from
 * `nextPoints - previousPoints`; it is never accepted from the input. A
 * missing, non-string, empty, or whitespace-only reason always throws —
 * there is no default reason and no bypass flag.
 */
export const createScoreChangeEntry = (input: ScoreChangeEntryInput): ScoreChangeEntry => {
  const reason = normalizeReason(input.reason);
  const previousPoints = requirePoints(input.previousPoints, 'previousPoints');
  const nextPoints = requirePoints(input.nextPoints, 'nextPoints');
  const actorId = requireNonblankText(input.actorId, SCORE_CHANGE_ERROR_CODES.invalidActor, 'actorId');
  const attemptId = requireNonblankText(input.attemptId, SCORE_CHANGE_ERROR_CODES.invalidAttempt, 'attemptId');
  const id = requireNonblankText(input.id, SCORE_CHANGE_ERROR_CODES.invalidAttempt, 'id');
  const occurredAt = requireTimestamp(input.occurredAt);
  const evaluationNumber = requireEvaluationNumber(input.evaluationNumber);
  const delta = roundPoints(nextPoints - previousPoints);

  return Object.freeze({
    id,
    attemptId,
    previousPoints,
    nextPoints,
    delta,
    reason,
    actorId,
    occurredAt,
    evaluationNumber
  });
};
