import type {
  LearningOutcomeId,
  LearningOutcomeMasteryById
} from '../../learning-domain/models/learning-domain.models';
import { QUESTION_DIFFICULTIES, type QuestionDifficulty } from '../../question-bank/models/question.models';
import {
  MASTERY_ERROR_CODES,
  MasteryError,
  masteryBandFor,
  type MasteryAttempt,
  type MasteryOutcomeScore
} from '../models/mastery.models';

/**
 * Mastery calculation — pure, deterministic, side-effect free.
 *
 * FORMULA
 * For each learning outcome, keep the newest `recencyWindow` attempts (ties broken by
 * `questionId` ascending). For each kept attempt at zero-based recency rank `r` (0 = newest):
 *   recencyWeight    = 1 / (1 + recencyDecay * r)
 *   difficultyWeight = difficultyWeights[attempt.difficulty]
 *   repetitionWeight = repetitionDecay ** k, where k = count of NEWER kept attempts that
 *                       share the same questionId (0 for the newest sighting of a question)
 *   weight            = recencyWeight * difficultyWeight * repetitionWeight
 * score = clamp01( Σ(weight * earnedFraction) / Σ(weight) ), rounded to 4 decimals.
 *
 * CONSTANTS (MASTERY_DEFAULTS)
 *   recencyWindow: 10      — how many of the most recent attempts inform mastery; older
 *                            answers are dropped outright so mastery tracks current ability.
 *   difficultyWeights:
 *     easy: 0.8            — an easy correct answer is weaker evidence of mastery.
 *     medium: 1            — neutral baseline weight.
 *     hard: 1.3            — a hard correct answer is stronger evidence of mastery.
 *   recencyDecay: 0.15     — per-rank decay of a kept attempt's influence; rank 0 keeps full
 *                            weight, each older rank contributes progressively less via
 *                            1 / (1 + 0.15 * r), so a stale answer never fully vanishes but is
 *                            consistently discounted against fresher evidence.
 *   repetitionDecay: 0.5   — per-repeat decay applied to OLDER sightings of the same question;
 *                            answering the same item repeatedly must not let its weight
 *                            dominate the outcome purely through volume.
 *
 * ORDERING RULE
 * Attempts within an outcome are ordered by `answeredAt` descending; equal timestamps break
 * ties by `questionId` ascending, so repeated calls over the same input are byte-identical.
 *
 * REPETITION RULE
 * `k` counts strictly-newer kept attempts sharing the same `questionId`; the newest sighting of
 * any question (`k === 0`) always keeps full recency/difficulty weight, and each older repeat is
 * damped by an additional factor of `repetitionDecay`. `repetitionPenalty` reports
 * `1 - (Σ weight / Σ recencyWeight*difficultyWeight)` — how much of the outcome's undamped
 * weight was lost to repetition — and is exactly `0` when no question repeats within the kept
 * window.
 *
 * BOUNDARY BEHAVIOR
 * `score` and `repetitionPenalty` are clamped to `0..1` and rounded to 4 decimals. Mastery bands
 * (`masteryBandFor` in mastery.models.ts) treat a boundary value as belonging to the HIGHER
 * band: 0.4 -> approaching, 0.6 -> proficient, 0.85 -> advanced.
 *
 * UNMEASURED
 * An outcome is `isMeasured: false` (score 0, band 'unmeasured') only when it has no supplied
 * attempts at all, or its kept attempts sum to zero total weight. Because difficultyWeights are
 * validated to be positive and the recency/repetition weight of a rank-0, first-seen attempt are
 * always positive, any outcome with at least one attempt is measured — an answered question is
 * evidence of mastery even at zero credit.
 */

export type MasteryDifficultyWeights = Readonly<Record<QuestionDifficulty, number>>;

export const MASTERY_DEFAULTS = Object.freeze({
  recencyWindow: 10,
  difficultyWeights: Object.freeze({ easy: 0.8, medium: 1, hard: 1.3 }) as MasteryDifficultyWeights,
  recencyDecay: 0.15,
  repetitionDecay: 0.5
});

export type MasteryOptions = Readonly<
  Partial<{
    readonly recencyWindow: number;
    readonly difficultyWeights: Readonly<Partial<Record<QuestionDifficulty, number>>>;
    readonly recencyDecay: number;
    readonly repetitionDecay: number;
  }>
>;

export type ResolvedMasteryOptions = Readonly<{
  readonly recencyWindow: number;
  readonly difficultyWeights: MasteryDifficultyWeights;
  readonly recencyDecay: number;
  readonly repetitionDecay: number;
}>;

const fail = (message: string, target: string): never => {
  throw new MasteryError(MASTERY_ERROR_CODES.invalidOptions, message, target);
};

const isFraction = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

export const resolveMasteryOptions = (options?: MasteryOptions): ResolvedMasteryOptions => {
  if (options === undefined) {
    return MASTERY_DEFAULTS;
  }
  if (options === null || typeof options !== 'object') {
    return fail('options must be an object.', 'options');
  }

  const recencyWindow = options.recencyWindow ?? MASTERY_DEFAULTS.recencyWindow;
  if (!Number.isInteger(recencyWindow) || recencyWindow <= 0) {
    return fail('recencyWindow must be a positive integer.', 'recencyWindow');
  }

  const recencyDecay = options.recencyDecay ?? MASTERY_DEFAULTS.recencyDecay;
  if (!isFraction(recencyDecay)) {
    return fail('recencyDecay must be a finite number between 0 and 1 inclusive.', 'recencyDecay');
  }

  const repetitionDecay = options.repetitionDecay ?? MASTERY_DEFAULTS.repetitionDecay;
  if (!isFraction(repetitionDecay)) {
    return fail('repetitionDecay must be a finite number between 0 and 1 inclusive.', 'repetitionDecay');
  }

  const difficultyWeights = {
    ...MASTERY_DEFAULTS.difficultyWeights,
    ...(options.difficultyWeights ?? {})
  } as MasteryDifficultyWeights;
  for (const difficulty of QUESTION_DIFFICULTIES) {
    const weight = difficultyWeights[difficulty];
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) {
      return fail(
        `difficultyWeights.${difficulty} must be a positive finite number.`,
        `difficultyWeights.${difficulty}`
      );
    }
  }

  return Object.freeze({
    recencyWindow,
    difficultyWeights: Object.freeze(difficultyWeights),
    recencyDecay,
    repetitionDecay
  });
};

const compareAttemptsForOrdering = (left: MasteryAttempt, right: MasteryAttempt): number => {
  if (left.answeredAt !== right.answeredAt) {
    return left.answeredAt > right.answeredAt ? -1 : 1;
  }
  return left.questionId < right.questionId ? -1 : left.questionId > right.questionId ? 1 : 0;
};

const ROUNDING_FACTOR = 10000;

const round4 = (value: number): number => {
  const rounded = Math.round((value + Number.EPSILON) * ROUNDING_FACTOR) / ROUNDING_FACTOR;
  return Object.is(rounded, -0) ? 0 : rounded;
};

const scoreOutcome = (
  outcomeId: LearningOutcomeId,
  attempts: readonly MasteryAttempt[],
  resolved: ResolvedMasteryOptions
): MasteryOutcomeScore => {
  const ordered = [...attempts].sort(compareAttemptsForOrdering);
  const attemptCount = ordered.length;
  const kept = ordered.slice(0, resolved.recencyWindow);
  const consideredCount = kept.length;
  const lastAnsweredAt = attemptCount > 0 ? ordered[0].answeredAt : null;

  const priorSightingsByQuestionId = new Map<string, number>();
  let weightedScoreSum = 0;
  let weightSum = 0;
  let undampedWeightSum = 0;

  kept.forEach((attempt, rank) => {
    const recencyWeight = 1 / (1 + resolved.recencyDecay * rank);
    const difficultyWeight = resolved.difficultyWeights[attempt.difficulty];
    const priorSightings = priorSightingsByQuestionId.get(attempt.questionId) ?? 0;
    priorSightingsByQuestionId.set(attempt.questionId, priorSightings + 1);

    const undampedWeight = recencyWeight * difficultyWeight;
    const weight = undampedWeight * resolved.repetitionDecay ** priorSightings;

    weightedScoreSum += weight * attempt.earnedFraction;
    weightSum += weight;
    undampedWeightSum += undampedWeight;
  });

  const isMeasured = weightSum > 0;
  const score = isMeasured ? round4(Math.min(1, Math.max(0, weightedScoreSum / weightSum))) : 0;
  const repetitionPenalty =
    isMeasured && undampedWeightSum > 0 ? round4(Math.max(0, 1 - weightSum / undampedWeightSum)) : 0;

  return Object.freeze({
    outcomeId,
    score,
    band: masteryBandFor(score, isMeasured),
    attemptCount,
    consideredCount,
    repetitionPenalty,
    lastAnsweredAt,
    isMeasured
  });
};

const compareOutcomeIds = (left: LearningOutcomeId, right: LearningOutcomeId): number =>
  left < right ? -1 : left > right ? 1 : 0;

/** Groups attempts by outcome and scores each group per the formula documented above. */
export const selectOutcomeMastery = (
  attempts: readonly MasteryAttempt[],
  options?: MasteryOptions
): readonly MasteryOutcomeScore[] => {
  const resolved = resolveMasteryOptions(options);

  const grouped = new Map<LearningOutcomeId, MasteryAttempt[]>();
  for (const attempt of attempts) {
    const bucket = grouped.get(attempt.outcomeId);
    if (bucket === undefined) {
      grouped.set(attempt.outcomeId, [attempt]);
    } else {
      bucket.push(attempt);
    }
  }

  const scores = [...grouped.entries()]
    .map(([outcomeId, group]) => scoreOutcome(outcomeId, group, resolved))
    .sort((left, right) => compareOutcomeIds(left.outcomeId, right.outcomeId));

  return Object.freeze(scores);
};

/**
 * Frozen record of ONLY measured outcomes, assignable to `LearningPathRecommendationInput`'s
 * `masteryByOutcomeId` without a cast — an unmeasured outcome stays absent rather than being
 * reported as `0`, so the recommendation consumer's unmeasured branch is never falsely skipped.
 */
export const selectMasteryByOutcomeId = (
  attempts: readonly MasteryAttempt[],
  options?: MasteryOptions
): LearningOutcomeMasteryById => {
  const result: Record<LearningOutcomeId, number> = {};
  for (const outcomeScore of selectOutcomeMastery(attempts, options)) {
    if (outcomeScore.isMeasured) {
      result[outcomeScore.outcomeId] = outcomeScore.score;
    }
  }
  return Object.freeze(result);
};

/** Full per-outcome record, including unmeasured outcomes, for callers that need it. */
export const selectOutcomeMasteryById = (
  attempts: readonly MasteryAttempt[],
  options?: MasteryOptions
): Readonly<Record<LearningOutcomeId, MasteryOutcomeScore>> => {
  const result: Record<LearningOutcomeId, MasteryOutcomeScore> = {};
  for (const outcomeScore of selectOutcomeMastery(attempts, options)) {
    result[outcomeScore.outcomeId] = outcomeScore;
  }
  return Object.freeze(result);
};
