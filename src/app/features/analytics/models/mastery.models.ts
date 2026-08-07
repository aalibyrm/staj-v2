import type { LearningOutcomeId } from '../../learning-domain/models/learning-domain.models';
import { isQuestionDifficulty, type QuestionDifficulty } from '../../question-bank/models/question.models';

export const MASTERY_BANDS = Object.freeze([
  'unmeasured',
  'developing',
  'approaching',
  'proficient',
  'advanced'
] as const);
export type MasteryBand = (typeof MASTERY_BANDS)[number];

export const MASTERY_ERROR_CODES = Object.freeze({
  malformedInput: 'malformed-input',
  invalidOutcomeId: 'invalid-outcome-id',
  invalidQuestionId: 'invalid-question-id',
  invalidDifficulty: 'invalid-difficulty',
  invalidEarnedFraction: 'invalid-earned-fraction',
  invalidTimestamp: 'invalid-timestamp',
  invalidOptions: 'invalid-options'
} as const);
export type MasteryErrorCode = (typeof MASTERY_ERROR_CODES)[keyof typeof MASTERY_ERROR_CODES];

export class MasteryError extends Error {
  override readonly name = 'MasteryError';

  constructor(
    readonly code: MasteryErrorCode,
    message: string,
    readonly target?: string
  ) {
    super(message);
  }
}

const fail = (code: MasteryErrorCode, message: string, target?: string): never => {
  throw new MasteryError(code, message, target);
};

/** Raw input accepted by {@link createMasteryAttempt}; every field is validated before use. */
export type MasteryAttemptInput = Readonly<{
  readonly outcomeId: LearningOutcomeId;
  readonly questionId: string;
  readonly difficulty: QuestionDifficulty;
  readonly earnedFraction: number;
  readonly answeredAt: string;
}>;

/** One scored answer attempt: the unit consumed by the mastery calculation. */
export type MasteryAttempt = Readonly<{
  readonly outcomeId: LearningOutcomeId;
  readonly questionId: string;
  readonly difficulty: QuestionDifficulty;
  /** Already-normalized 0..1 credit for the attempt, same shape as ObjectiveScoringResult.earnedFraction. */
  readonly earnedFraction: number;
  /** ISO 8601 instant, normalized via `new Date(value).toISOString()`. */
  readonly answeredAt: string;
}>;

/**
 * Validates and normalizes one raw attempt into an immutable {@link MasteryAttempt}. Throws
 * {@link MasteryError} instead of silently coercing invalid data — `earnedFraction` in particular
 * is expected to already be normalized to `0..1` by the caller's scoring layer, so an out-of-range
 * value is a defect to surface, not a value to clamp.
 */
export const createMasteryAttempt = (input: MasteryAttemptInput): MasteryAttempt => {
  if (input === null || typeof input !== 'object') {
    return fail(MASTERY_ERROR_CODES.malformedInput, 'Mastery attempt input must be an object.', 'input');
  }

  const rawOutcomeId: unknown = input.outcomeId;
  if (typeof rawOutcomeId !== 'string' || rawOutcomeId.trim().length === 0) {
    return fail(MASTERY_ERROR_CODES.invalidOutcomeId, 'outcomeId must be a nonblank string.', 'outcomeId');
  }
  const outcomeId = rawOutcomeId.trim();

  const rawQuestionId: unknown = input.questionId;
  if (typeof rawQuestionId !== 'string' || rawQuestionId.trim().length === 0) {
    return fail(MASTERY_ERROR_CODES.invalidQuestionId, 'questionId must be a nonblank string.', 'questionId');
  }
  const questionId = rawQuestionId.trim();

  if (!isQuestionDifficulty(input.difficulty)) {
    return fail(
      MASTERY_ERROR_CODES.invalidDifficulty,
      'difficulty must be one of easy, medium, hard.',
      'difficulty'
    );
  }

  const earnedFraction: unknown = input.earnedFraction;
  if (
    typeof earnedFraction !== 'number' ||
    !Number.isFinite(earnedFraction) ||
    earnedFraction < 0 ||
    earnedFraction > 1
  ) {
    return fail(
      MASTERY_ERROR_CODES.invalidEarnedFraction,
      'earnedFraction must be a finite number between 0 and 1 inclusive.',
      'earnedFraction'
    );
  }

  const answeredAtRaw: unknown = input.answeredAt;
  if (typeof answeredAtRaw !== 'string' || answeredAtRaw.trim().length === 0 || Number.isNaN(Date.parse(answeredAtRaw))) {
    return fail(
      MASTERY_ERROR_CODES.invalidTimestamp,
      'answeredAt must be a nonblank, Date.parse-parseable timestamp string.',
      'answeredAt'
    );
  }

  return Object.freeze({
    outcomeId: outcomeId as LearningOutcomeId,
    questionId,
    difficulty: input.difficulty,
    earnedFraction,
    answeredAt: new Date(answeredAtRaw).toISOString()
  });
};

/** Per-outcome mastery result produced by `selectOutcomeMastery`. */
export type MasteryOutcomeScore = Readonly<{
  readonly outcomeId: LearningOutcomeId;
  /** 0..1, rounded to 4 decimals. Meaningless (reported as 0) when `isMeasured` is false. */
  readonly score: number;
  readonly band: MasteryBand;
  /** Every attempt supplied for this outcome, regardless of the recency window. */
  readonly attemptCount: number;
  /** How many of those attempts survived the recency window and fed the score. */
  readonly consideredCount: number;
  /** 0..1, rounded to 4 decimals. 0 when no repeated question depressed the weighted total. */
  readonly repetitionPenalty: number;
  readonly lastAnsweredAt: string | null;
  readonly isMeasured: boolean;
}>;

/**
 * Maps a score to a readable band. `isMeasured: false` always yields `unmeasured`.
 * Boundary values belong to the HIGHER band: 0.4 -> approaching, 0.6 -> proficient, 0.85 -> advanced.
 */
export const masteryBandFor = (score: number, isMeasured: boolean): MasteryBand => {
  if (!isMeasured) return 'unmeasured';
  if (score < 0.4) return 'developing';
  if (score < 0.6) return 'approaching';
  if (score < 0.85) return 'proficient';
  return 'advanced';
};
