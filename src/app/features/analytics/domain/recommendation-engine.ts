import type {
  ContentItem,
  ContentItemId,
  CourseId,
  LearningOutcome,
  LearningPathEntry
} from '../../learning-domain/models/learning-domain.models';
import { recommendLearningPath } from '../../learning-domain/models/learning-path-recommendation';
import { selectMasteryByOutcomeId, type MasteryOptions } from './mastery-calculation';
import type { MasteryAttempt } from '../models/mastery.models';

export type RecommendationEngineInput = Readonly<{
  readonly courseId: CourseId;
  readonly attempts: readonly MasteryAttempt[];
  readonly completedContentIds: readonly ContentItemId[];
  readonly lockedContentIds: readonly ContentItemId[];
  readonly masteryOptions?: MasteryOptions;
}>;

export const recommendLearningPathFromAttempts = (
  input: RecommendationEngineInput,
  eligibleContent: readonly ContentItem[],
  eligibleOutcomes: readonly LearningOutcome[]
): readonly LearningPathEntry[] =>
  recommendLearningPath(
    {
      courseId: input.courseId,
      masteryByOutcomeId: selectMasteryByOutcomeId(input.attempts, input.masteryOptions),
      completedContentIds: input.completedContentIds,
      lockedContentIds: input.lockedContentIds
    },
    eligibleContent,
    eligibleOutcomes
  );
