import type {
  CourseId,
  LearningOutcomeId,
  SeedCourse,
  SeedLearningOutcome
} from '../../adaptive-learning/models/seed-domain.models';

declare const questionIdBrand: unique symbol;
declare const questionVersionIdBrand: unique symbol;

export type QuestionVersionId = string & { readonly [questionVersionIdBrand]: 'QuestionVersionId' };

export type QuestionPublishInput = Readonly<{
  readonly changeNote?: string;
}>;

export type QuestionSuccessorInput = Readonly<{
  readonly changeNote: string;
}>;

export type QuestionId = string & { readonly [questionIdBrand]: 'QuestionId' };

export const QUESTION_STATUSES = Object.freeze([
  'draft',
  'review',
  'published',
  'archived'
] as const);
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export const QUESTION_TYPES = Object.freeze([
  'single-choice',
  'multiple-choice',
  'true-false',
  'matching',
  'short-answer',
  'essay'
] as const);
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard'] as const);
export type QuestionDifficulty = (typeof QUESTION_DIFFICULTIES)[number];

export const QUESTION_GRADES = Object.freeze(['foundation', 'intermediate', 'advanced'] as const);
export type QuestionGrade = (typeof QUESTION_GRADES)[number];

export const QUESTION_SORTS = Object.freeze([
  'updatedAt-desc',
  'updatedAt-asc',
  'id-asc',
  'id-desc',
  'title-asc',
  'title-desc',
  'difficulty-asc',
  'points-desc'
] as const);
export type QuestionSort = (typeof QUESTION_SORTS)[number];

export const DEFAULT_QUESTION_SORT: QuestionSort = 'updatedAt-desc';
export const DEFAULT_QUESTION_PAGE = 1;
export const DEFAULT_QUESTION_PAGE_SIZE = 10;
export const MAX_QUESTION_PAGE_SIZE = 50;

export interface QuestionCourseReference {
  readonly id: CourseId;
  readonly code: string;
  readonly title: string;
}

export interface QuestionOutcomeReference {
  readonly id: LearningOutcomeId;
  readonly code: string;
  readonly title: string;
}

export interface QuestionOption {
  readonly id: string;
  readonly label: string;
}

export interface QuestionMatchingPair {
  readonly prompt: string;
  readonly answer: string;
}

export interface ChoiceQuestionAnswer {
  readonly kind: 'choice';
  readonly optionIds: readonly string[];
}

export interface TrueFalseQuestionAnswer {
  readonly kind: 'boolean';
  readonly value: boolean;
}

export interface MatchingQuestionAnswer {
  readonly kind: 'matching';
  readonly pairs: readonly QuestionMatchingPair[];
}

export interface ShortAnswerQuestionAnswer {
  readonly kind: 'short-answer';
  readonly acceptedAnswers: readonly string[];
}

export interface EssayQuestionAnswer {
  readonly kind: 'essay';
  readonly rubricHint: string;
}

export type QuestionAnswer =
  | ChoiceQuestionAnswer
  | TrueFalseQuestionAnswer
  | MatchingQuestionAnswer
  | ShortAnswerQuestionAnswer
  | EssayQuestionAnswer;

export type EditableQuestionStatus = Extract<QuestionStatus, 'draft' | 'review'>;

export type QuestionEditableFields = Readonly<{
  courseId: CourseId;
  outcomeId: LearningOutcomeId;
  title: string;
  stem: string;
  explanation: string;
  tags: readonly string[];
  difficulty: QuestionDifficulty;
  points: number;
  grade: QuestionGrade;
  type: QuestionType;
  options: readonly QuestionOption[];
  answer: QuestionAnswer;
}>;

export type QuestionCreateInput = Readonly<QuestionEditableFields & {
  readonly status?: EditableQuestionStatus;
}>;

export type QuestionUpdateInput = Readonly<Partial<QuestionEditableFields> & {
  readonly status?: EditableQuestionStatus;
}>;
export type QuestionBulkTarget = Readonly<{
  readonly id: QuestionId;
  readonly expectedVersion: number;
}>;

export type QuestionBulkActionInput = Readonly<{
  readonly addTags?: readonly string[];
  readonly replaceTags?: readonly string[];
  readonly status?: EditableQuestionStatus;
}>;

export type QuestionBulkRequest = Readonly<{
  readonly targets: readonly QuestionBulkTarget[];
  readonly action: QuestionBulkActionInput;
}>;

export type QuestionBulkFailureCode =
  | 'not-found'
  | 'unauthorized'
  | 'validation'
  | 'conflict'
  | 'not-editable';

export type QuestionBulkSuccess = Readonly<{
  readonly kind: 'success';
  readonly id: QuestionId;
  readonly expectedVersion: number;
  readonly before: Question;
  readonly after: Question;
  readonly question: Question;
}>;

export type QuestionBulkFailure = Readonly<{
  readonly kind: 'failure';
  readonly id: QuestionId;
  readonly expectedVersion: number;
  readonly code: QuestionBulkFailureCode;
  readonly message: string;
}>;

export type QuestionBulkItemResult = QuestionBulkSuccess | QuestionBulkFailure;

export type QuestionBulkCounts = Readonly<{
  readonly total: number;
  readonly succeeded: number;
  readonly failed: number;
}>;

export type QuestionBulkResult = Readonly<{
  readonly items: readonly QuestionBulkItemResult[];
  readonly successes: readonly QuestionBulkSuccess[];
  readonly failures: readonly QuestionBulkFailure[];
  readonly counts: QuestionBulkCounts;
}>;


export type QuestionEditorMode = 'create' | 'edit' | 'preview';

export interface QuestionEditorReferenceData {
  readonly courses: readonly QuestionCourseReference[];
  readonly outcomes: readonly QuestionOutcomeReference[];
}

export type Question = Readonly<{
  id: QuestionId;
  createdAt: string;
  updatedAt: string;
  version: number;
  status: QuestionStatus;
  courseId: CourseId;
  outcomeId: LearningOutcomeId;
  course: QuestionCourseReference;
  outcome: QuestionOutcomeReference;
  title: string;
  stem: string;
  explanation: string;
  tags: readonly string[];
  difficulty: QuestionDifficulty;
  points: number;
  grade: QuestionGrade;
  type: QuestionType;
  options: readonly QuestionOption[];
  answer: QuestionAnswer;
}>;

export type QuestionVersion = Readonly<Question & {
  readonly questionId: QuestionId;
  readonly versionId: QuestionVersionId;
  readonly publishedAt: string;
  readonly changeNote: string;
}>;

export type ExamQuestionReference = Readonly<{
  readonly questionId: QuestionId;
  readonly version: number;
  readonly versionId: QuestionVersionId;
}>;

export interface QuestionListQueryInput {
  readonly search?: unknown;
  readonly course?: unknown;
  readonly courseId?: unknown;
  readonly grade?: unknown;
  readonly difficulty?: unknown;
  readonly status?: unknown;
  readonly type?: unknown;
  readonly sort?: unknown;
  readonly page?: unknown;
  readonly pageSize?: unknown;
}

export interface QuestionListQuery {
  readonly search: string;
  readonly course: string;
  readonly grade: string;
  readonly difficulty: string;
  readonly status: string;
  readonly type: string;
  readonly sort: QuestionSort;
  readonly page: number;
  readonly pageSize: number;
}

export type QuestionStatusCounts = Readonly<Record<QuestionStatus, number>>;

export interface QuestionListResponse {
  readonly items: readonly Question[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
  readonly hasPreviousPage: boolean;
  readonly hasNextPage: boolean;
  readonly query: QuestionListQuery;
  readonly statusCounts: QuestionStatusCounts;
}

export type QuestionBankRequestStatus =
  | 'idle'
  | 'loading'
  | 'slow'
  | 'success'
  | 'empty'
  | 'error'
  | 'unauthorized';

export interface QuestionBankRequestState {
  readonly status: QuestionBankRequestStatus;
  readonly message?: string;
  readonly retryable?: boolean;
}

export const EMPTY_QUESTION_STATUS_COUNTS: QuestionStatusCounts = Object.freeze({
  draft: 0,
  review: 0,
  published: 0,
  archived: 0
});

export const asQuestionId = (value: string): QuestionId => value as QuestionId;
export const asQuestionVersionId = (value: string): QuestionVersionId => value as QuestionVersionId;

export const questionVersionIdFor = (questionId: QuestionId, version: number): QuestionVersionId =>
  asQuestionVersionId(`${String(questionId)}-v${String(version)}`);
export const asCourseId = (value: string): CourseId => value as CourseId;
export const asLearningOutcomeId = (value: string): LearningOutcomeId => value as LearningOutcomeId;

export const isQuestionStatus = (value: unknown): value is QuestionStatus =>
  typeof value === 'string' && (QUESTION_STATUSES as readonly string[]).includes(value);

export const isQuestionType = (value: unknown): value is QuestionType =>
  typeof value === 'string' && (QUESTION_TYPES as readonly string[]).includes(value);

export const isQuestionDifficulty = (value: unknown): value is QuestionDifficulty =>
  typeof value === 'string' && (QUESTION_DIFFICULTIES as readonly string[]).includes(value);

export const isQuestionGrade = (value: unknown): value is QuestionGrade =>
  typeof value === 'string' && (QUESTION_GRADES as readonly string[]).includes(value);

export const isQuestionSort = (value: unknown): value is QuestionSort =>
  typeof value === 'string' && (QUESTION_SORTS as readonly string[]).includes(value);

export const questionReferenceFromCourse = (course: SeedCourse): QuestionCourseReference => Object.freeze({
  id: course.id,
  code: course.code,
  title: course.title
});

export const questionReferenceFromOutcome = (outcome: SeedLearningOutcome): QuestionOutcomeReference => Object.freeze({
  id: outcome.id,
  code: outcome.code,
  title: outcome.title
});
