import type {
  CourseId,
  LearningOutcomeId
} from '../../adaptive-learning/models/seed-domain.models';

export type { CourseId, LearningOutcomeId } from '../../adaptive-learning/models/seed-domain.models';

declare const contentItemIdBrand: unique symbol;
declare const learningPathIdBrand: unique symbol;
declare const learningPathEntryIdBrand: unique symbol;

export type ContentItemId = string & { readonly [contentItemIdBrand]: 'ContentItemId' };
export type LearningPathId = string & { readonly [learningPathIdBrand]: 'LearningPathId' };
export type LearningPathEntryId = string & {
  readonly [learningPathEntryIdBrand]: 'LearningPathEntryId';
};

export const LIFECYCLE_STATES = [
  'draft',
  'planned',
  'active',
  'published',
  'inactive',
  'archived'
] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];
export type CourseStatus = LifecycleState;
export type LearningOutcomeStatus = LifecycleState;
export type ContentItemStatus = LifecycleState;
export type LearningPathStatus = LifecycleState;
export type PublishState = Extract<LifecycleState, 'draft' | 'published' | 'archived'>;

export const CONTENT_FORMATS = [
  'article',
  'audio',
  'document',
  'exercise',
  'external-link',
  'interactive',
  'video'
] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];

export const LEARNING_PATH_REASON_CODES = [
  'weak-outcome',
  'prerequisite',
  'spaced-practice',
  'new-content',
  'in-progress'
] as const;
export type LearningPathReasonCode = (typeof LEARNING_PATH_REASON_CODES)[number];

export interface LearningDomainEntityMetadata {
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface Course extends LearningDomainEntityMetadata {
  readonly id: CourseId;
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly termId?: string;
  readonly instructorIds: readonly string[];
  readonly learningOutcomeIds: readonly LearningOutcomeId[];
  readonly status: CourseStatus;
}

export interface LearningOutcome extends LearningDomainEntityMetadata {
  readonly id: LearningOutcomeId;
  readonly courseId: CourseId;
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly level: number;
  readonly status: LearningOutcomeStatus;
  readonly prerequisiteOutcomeIds: readonly LearningOutcomeId[];
}

export interface ContentAccessConditions {
  readonly visibility?: 'public' | 'enrolled' | 'restricted';
  readonly requiresEnrollment?: boolean;
  readonly requiredOutcomeIds?: readonly LearningOutcomeId[];
  readonly requiredRoleCodes?: readonly string[];
  readonly availableFrom?: string;
  readonly availableUntil?: string;
}

export interface ContentItem extends LearningDomainEntityMetadata {
  readonly id: ContentItemId;
  readonly courseId: CourseId;
  readonly title: string;
  readonly description: string;
  readonly learningOutcomeIds: readonly LearningOutcomeId[];
  readonly level: number;
  readonly durationMinutes: number;
  readonly format: ContentFormat;
  readonly accessConditions: ContentAccessConditions;
  readonly status: ContentItemStatus;
}

export interface LearningPathReason {
  readonly code: LearningPathReasonCode;
  readonly summary: string;
  readonly detail: string;
  readonly factors: Readonly<Record<string, string | number | boolean>>;
}

export interface LearningPathEntry {
  readonly id: LearningPathEntryId;
  readonly order: number;
  readonly contentItemId: ContentItemId;
  readonly reason: string;
  readonly reasonDetails?: LearningPathReason;
  readonly isCompleted: boolean;
  readonly isLocked: boolean;
}

export type LearningOutcomeMasteryById = Readonly<Record<LearningOutcomeId, number>>;

export interface LearningPathRecommendationInput {
  readonly courseId: CourseId;
  readonly masteryByOutcomeId: LearningOutcomeMasteryById;
  readonly completedContentIds: readonly ContentItemId[];
  readonly lockedContentIds: readonly ContentItemId[];
}

export interface LearningPath extends LearningDomainEntityMetadata {
  readonly id: LearningPathId;
  readonly courseId: CourseId;
  readonly title: string;
  readonly description: string;
  readonly status: LearningPathStatus;
  readonly reason: string;
  readonly entries: readonly LearningPathEntry[];
}

export interface CourseCreateInput {
  readonly id?: CourseId;
  readonly code: string;
  readonly title: string;
  readonly description?: string;
  readonly termId?: string;
  readonly instructorIds?: readonly string[];
  readonly learningOutcomeIds?: readonly LearningOutcomeId[];
  readonly status?: CourseStatus;
}

export type CourseUpdateInput = Partial<Omit<Course, 'id' | keyof LearningDomainEntityMetadata>>;

export interface LearningOutcomeCreateInput {
  readonly id?: LearningOutcomeId;
  readonly courseId: CourseId;
  readonly code: string;
  readonly title: string;
  readonly description?: string;
  readonly level?: number;
  readonly status?: LearningOutcomeStatus;
  readonly prerequisiteOutcomeIds?: readonly LearningOutcomeId[];
}

export type LearningOutcomeUpdateInput = Partial<
  Omit<LearningOutcome, 'id' | keyof LearningDomainEntityMetadata>
>;

export interface ContentItemCreateInput {
  readonly id?: ContentItemId;
  readonly courseId: CourseId;
  readonly title: string;
  readonly description?: string;
  readonly learningOutcomeIds?: readonly LearningOutcomeId[];
  readonly outcomeIds?: readonly LearningOutcomeId[];
  readonly level?: number;
  readonly durationMinutes?: number;
  readonly format?: ContentFormat;
  readonly accessConditions?: ContentAccessConditions;
  readonly status?: ContentItemStatus;
}

export type ContentItemUpdateInput = Partial<Omit<ContentItem, 'id' | keyof LearningDomainEntityMetadata>> & {
  readonly outcomeIds?: readonly LearningOutcomeId[];
};

export interface LearningPathEntryInput {
  readonly id?: LearningPathEntryId;
  readonly order?: number;
  readonly position?: number;
  readonly contentItemId?: ContentItemId;
  readonly contentId?: ContentItemId;
  readonly reason?: string;
  readonly reasonDetails?: LearningPathReason;
  readonly isCompleted?: boolean;
  readonly isLocked?: boolean;
}

export interface LearningPathCreateInput {
  readonly id?: LearningPathId;
  readonly courseId: CourseId;
  readonly title: string;
  readonly description?: string;
  readonly status?: LearningPathStatus;
  readonly reason?: string;
  readonly entries?: readonly LearningPathEntryInput[];
}

export type LearningPathUpdateInput = Partial<
  Omit<LearningPath, 'id' | keyof LearningDomainEntityMetadata>
> & {
  readonly entries?: readonly LearningPathEntryInput[];
};

export type SortDirection = 'asc' | 'desc';

export interface CourseFilter {
  readonly search?: string;
  readonly status?: CourseStatus;
  readonly statuses?: readonly CourseStatus[];
  readonly termId?: string;
  readonly sortBy?: 'code' | 'title' | 'status' | 'updatedAt';
  readonly sortDirection?: SortDirection;
}

export interface LearningOutcomeFilter {
  readonly search?: string;
  readonly courseId?: CourseId;
  readonly status?: LearningOutcomeStatus;
  readonly statuses?: readonly LearningOutcomeStatus[];
  readonly level?: number;
  readonly minLevel?: number;
  readonly maxLevel?: number;
  readonly sortBy?: 'code' | 'title' | 'level' | 'status' | 'updatedAt';
  readonly sortDirection?: SortDirection;
}

export interface ContentItemFilter {
  readonly search?: string;
  readonly courseId?: CourseId;
  readonly outcomeId?: LearningOutcomeId;
  readonly learningOutcomeId?: LearningOutcomeId;
  readonly status?: ContentItemStatus;
  readonly statuses?: readonly ContentItemStatus[];
  readonly level?: number;
  readonly minLevel?: number;
  readonly maxLevel?: number;
  readonly format?: ContentFormat;
  readonly formats?: readonly ContentFormat[];
  readonly sortBy?: 'title' | 'level' | 'durationMinutes' | 'format' | 'status' | 'updatedAt';
  readonly sortDirection?: SortDirection;
}

export interface LearningPathFilter {
  readonly search?: string;
  readonly courseId?: CourseId;
  readonly status?: LearningPathStatus;
  readonly statuses?: readonly LearningPathStatus[];
  readonly sortBy?: 'title' | 'status' | 'updatedAt';
  readonly sortDirection?: SortDirection;
}

export interface LearningDomainQuery {
  readonly courses?: CourseFilter;
  readonly outcomes?: LearningOutcomeFilter;
  readonly content?: ContentItemFilter;
  readonly paths?: LearningPathFilter;
}

export type LearningDomainListFilter =
  | CourseFilter
  | LearningOutcomeFilter
  | ContentItemFilter
  | LearningPathFilter;

const frozenArray = <T>(values: readonly T[] | undefined): readonly T[] =>
  Object.freeze([...(values ?? [])]);

const cloneAccessConditions = (value: ContentAccessConditions): ContentAccessConditions =>
  Object.freeze({
    ...value,
    requiredOutcomeIds:
      value.requiredOutcomeIds === undefined ? undefined : frozenArray(value.requiredOutcomeIds),
    requiredRoleCodes:
      value.requiredRoleCodes === undefined ? undefined : frozenArray(value.requiredRoleCodes)
  });

const cloneReasonDetails = (value: LearningPathReason | undefined): LearningPathReason | undefined =>
  value === undefined
    ? undefined
    : Object.freeze({
        ...value,
        factors: Object.freeze({ ...value.factors })
      });

export const cloneCourse = (value: Course): Course =>
  Object.freeze({
    ...value,
    instructorIds: frozenArray(value.instructorIds),
    learningOutcomeIds: frozenArray(value.learningOutcomeIds)
  });

export const cloneLearningOutcome = (value: LearningOutcome): LearningOutcome =>
  Object.freeze({
    ...value,
    prerequisiteOutcomeIds: frozenArray(value.prerequisiteOutcomeIds)
  });

export const cloneContentItem = (value: ContentItem): ContentItem =>
  Object.freeze({
    ...value,
    learningOutcomeIds: frozenArray(value.learningOutcomeIds),
    accessConditions: cloneAccessConditions(value.accessConditions)
  });

export const cloneLearningPathEntry = (value: LearningPathEntry): LearningPathEntry => {
  const reasonDetails = cloneReasonDetails(value.reasonDetails);
  return Object.freeze(
    reasonDetails === undefined
      ? { ...value }
      : {
          ...value,
          reasonDetails
        }
  );
};

export const cloneLearningPath = (value: LearningPath): LearningPath =>
  Object.freeze({
    ...value,
    entries: frozenArray(value.entries.map(cloneLearningPathEntry))
  });
