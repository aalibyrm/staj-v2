import type {
  ContentItem,
  LearningOutcome,
  LearningPathEntry,
  LearningPathEntryId,
  LearningPathReason,
  LearningPathRecommendationInput
} from './learning-domain.models';
import type { LearningOutcomeId } from './learning-domain.models';

type MeasuredOutcome = Readonly<{
  readonly outcome: LearningOutcome;
  readonly mastery: number;
  readonly wasClamped: boolean;
}>;

type RankedContent = Readonly<{
  readonly content: ContentItem;
  readonly alignedOutcomes: readonly LearningOutcome[];
  readonly measuredOutcome: MeasuredOutcome | undefined;
  readonly invalidMasteryOutcomeIds: readonly LearningOutcomeId[];
}>;

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const compareNumbers = (left: number, right: number): number =>
  left < right ? -1 : left > right ? 1 : 0;

const compareOutcomes = (left: LearningOutcome, right: LearningOutcome): number =>
  compareStrings(left.code, right.code) ||
  compareStrings(left.id, right.id) ||
  compareStrings(left.title, right.title);

const compareContent = (left: ContentItem, right: ContentItem): number =>
  compareStrings(left.title, right.title) ||
  compareNumbers(left.level, right.level) ||
  compareNumbers(left.durationMinutes, right.durationMinutes) ||
  compareStrings(left.format, right.format) ||
  compareStrings(left.id, right.id);

const clampMastery = (value: unknown): { readonly mastery: number; readonly wasClamped: boolean } | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  const mastery = Math.min(1, Math.max(0, value));
  return { mastery, wasClamped: mastery !== value };
};

const buildOutcomeIndex = (
  input: LearningPathRecommendationInput,
  outcomes: readonly LearningOutcome[]
): ReadonlyMap<LearningOutcomeId, LearningOutcome> => {
  const index = new Map<LearningOutcomeId, LearningOutcome>();
  const sorted = [...outcomes]
    .filter((outcome) => outcome.courseId === input.courseId)
    .sort(compareOutcomes);
  for (const outcome of sorted) {
    if (!index.has(outcome.id)) {
      index.set(outcome.id, outcome);
    }
  }
  return index;
};

const buildMasteryIndex = (
  input: LearningPathRecommendationInput,
  outcomes: readonly LearningOutcome[]
): Readonly<{
  readonly measured: ReadonlyMap<LearningOutcomeId, MeasuredOutcome>;
  readonly invalid: ReadonlySet<LearningOutcomeId>;
}> => {
  const measured = new Map<LearningOutcomeId, MeasuredOutcome>();
  const invalid = new Set<LearningOutcomeId>();
  const masteryByOutcomeId = input.masteryByOutcomeId as Readonly<Record<string, unknown>>;

  for (const outcome of outcomes) {
    if (!Object.prototype.hasOwnProperty.call(masteryByOutcomeId, outcome.id)) {
      continue;
    }
    const normalized = clampMastery(masteryByOutcomeId[outcome.id]);
    if (normalized === undefined) {
      invalid.add(outcome.id);
      continue;
    }
    measured.set(outcome.id, { outcome, ...normalized });
  }

  return { measured, invalid };
};

const compareMeasuredOutcomes = (left: MeasuredOutcome, right: MeasuredOutcome): number =>
  compareNumbers(left.mastery, right.mastery) || compareOutcomes(left.outcome, right.outcome);

const rankContent = (
  input: LearningPathRecommendationInput,
  content: readonly ContentItem[],
  outcomes: readonly LearningOutcome[]
): readonly RankedContent[] => {
  const outcomeIndex = buildOutcomeIndex(input, outcomes);
  const masteryIndex = buildMasteryIndex(input, [...outcomeIndex.values()]);
  const completedContentIds = new Set(input.completedContentIds);
  const lockedContentIds = new Set(input.lockedContentIds);
  const seenContentIds = new Set<string>();
  const eligibleContent = [...content]
    .filter(
      (item) =>
        item.courseId === input.courseId &&
        !completedContentIds.has(item.id) &&
        !lockedContentIds.has(item.id)
    )
    .sort(compareContent)
    .filter((item) => {
      if (seenContentIds.has(item.id)) {
        return false;
      }
      seenContentIds.add(item.id);
      return true;
    });

  const ranked = eligibleContent.map((item): RankedContent => {
    const alignedOutcomeIds = Object.freeze([...new Set(item.learningOutcomeIds)].sort(compareStrings));
    const alignedOutcomes = Object.freeze(
      alignedOutcomeIds.flatMap((outcomeId) => {
        const outcome = outcomeIndex.get(outcomeId);
        return outcome === undefined ? [] : [outcome];
      })
    );
    const measuredOutcomes = alignedOutcomes
      .map((outcome) => masteryIndex.measured.get(outcome.id))
      .filter((value): value is MeasuredOutcome => value !== undefined)
      .sort(compareMeasuredOutcomes);
    const invalidMasteryOutcomeIds = Object.freeze(
      alignedOutcomeIds.filter((outcomeId) => masteryIndex.invalid.has(outcomeId))
    );

    return {
      content: item,
      alignedOutcomes,
      measuredOutcome: measuredOutcomes[0],
      invalidMasteryOutcomeIds
    };
  });

  return Object.freeze(
    ranked.sort((left, right) => {
      const leftMeasured = left.measuredOutcome;
      const rightMeasured = right.measuredOutcome;
      if (leftMeasured === undefined && rightMeasured !== undefined) {
        return 1;
      }
      if (leftMeasured !== undefined && rightMeasured === undefined) {
        return -1;
      }
      if (leftMeasured !== undefined && rightMeasured !== undefined) {
        const measuredComparison = compareMeasuredOutcomes(leftMeasured, rightMeasured);
        if (measuredComparison !== 0) {
          return measuredComparison;
        }
      }
      return compareContent(left.content, right.content);
    })
  );
};

const STRONG_MASTERY_THRESHOLD = 0.7;

const formatMastery = (mastery: number): string =>
  `${Math.round(mastery * 1000) / 10}%`;

const buildReason = (ranked: RankedContent): LearningPathReason => {
  const measuredOutcome = ranked.measuredOutcome;
  if (measuredOutcome !== undefined) {
    const { outcome, mastery, wasClamped } = measuredOutcome;
    const isStrongMastery = mastery >= STRONG_MASTERY_THRESHOLD;
    return Object.freeze({
      code: isStrongMastery ? 'spaced-practice' : 'weak-outcome',
      summary: isStrongMastery ? `Maintain ${outcome.code}` : `Prioritize ${outcome.code}`,
      detail: isStrongMastery
        ? `This content covers ${outcome.title}, whose normalized mastery is ${formatMastery(
            mastery
          )}; use it for spaced practice to maintain mastery.`
        : `This content covers ${outcome.title}, whose normalized mastery is ${formatMastery(mastery)}.`,
      factors: Object.freeze({
        masteryState: 'measured',
        mastery,
        masteryClamped: wasClamped,
        outcomeId: outcome.id,
        outcomeCode: outcome.code,
        outcomeTitle: outcome.title
      })
    });
  }

  const alignedOutcome = ranked.alignedOutcomes[0];
  const alignedOutcomeIds = ranked.alignedOutcomes.map((outcome) => outcome.id);
  const invalidIds = ranked.invalidMasteryOutcomeIds;
  const unmeasuredOutcomeIds = alignedOutcomeIds.length > 0 ? alignedOutcomeIds.join(',') : 'none';
  return Object.freeze({
    code: 'new-content',
    summary: 'Add new content',
    detail:
      alignedOutcome === undefined
        ? 'No aligned outcome has a finite mastery measurement; treat this as new content.'
        : `No finite mastery measurement is available for ${alignedOutcome.code}; treat this as new content.`,
    factors: Object.freeze({
      masteryState: 'unmeasured',
      outcomeId: alignedOutcome?.id ?? 'none',
      outcomeCode: alignedOutcome?.code ?? 'none',
      unmeasuredOutcomeIds,
      invalidMasteryOutcomeIds: invalidIds.length > 0 ? invalidIds.join(',') : 'none'
    })
  });
};

const recommendationEntryId = (
  courseId: LearningPathRecommendationInput['courseId'],
  contentItemId: ContentItem['id']
): LearningPathEntryId =>
  `learning-path-entry:${courseId}:${contentItemId}` as LearningPathEntryId;

export const recommendLearningPath = (
  input: LearningPathRecommendationInput,
  eligibleContent: readonly ContentItem[],
  eligibleOutcomes: readonly LearningOutcome[]
): readonly LearningPathEntry[] => {
  const ranked = rankContent(input, eligibleContent, eligibleOutcomes);
  const entries = ranked.map((item, index): LearningPathEntry => {
    const reasonDetails = buildReason(item);
    return Object.freeze({
      id: recommendationEntryId(input.courseId, item.content.id),
      order: index + 1,
      contentItemId: item.content.id,
      reason: reasonDetails.summary,
      reasonDetails,
      isCompleted: false,
      isLocked: false
    });
  });
  return Object.freeze(entries);
};
