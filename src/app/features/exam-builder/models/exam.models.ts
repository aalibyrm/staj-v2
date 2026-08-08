import { type LearningOutcomeId } from '../../adaptive-learning/models/seed-domain.models';
import type { QuestionDifficulty, QuestionType, QuestionVersion } from '../../question-bank/models/question.models';
import {
  createExamBlueprint,
  compareExamBlueprint,
  validateExamBlueprint,
  type ExamBlueprint,
  type ExamBlueprintCurrentCoverageInput,
  type ExamBlueprintInput,
  type ExamBlueprintValidationIssue
} from './exam-blueprint.models';

declare const examIdBrand: unique symbol;
declare const examVersionIdBrand: unique symbol;

export type ExamId = string & { readonly [examIdBrand]: 'ExamId' };
export type ExamVersionId = string & { readonly [examVersionIdBrand]: 'ExamVersionId' };

export const asExamId = (value: string): ExamId => value as ExamId;
export const asExamVersionId = (value: string): ExamVersionId => value as ExamVersionId;

export const EXAM_STATUSES = Object.freeze(['draft', 'published', 'archived'] as const);
export type ExamStatus = (typeof EXAM_STATUSES)[number];

export type ExamRuleValue = string | number | boolean;
export type ExamRule = Readonly<{ readonly key: string; readonly value: ExamRuleValue }>;
export type ExamRuleInput = Readonly<{
  readonly key?: unknown;
  readonly name?: unknown;
  readonly value?: unknown;
  readonly enabled?: unknown;
}>;

export type ExamSettings = Readonly<{
  readonly title: string;
  readonly durationMinutes: number;
  readonly rules: readonly ExamRule[];
}>;

export type ExamPublicationMetadata = Readonly<{
  readonly publishedAt: string;
  readonly publishedBy: string | null;
  readonly changeNote: string;
}>;

export type Exam = Readonly<{
  readonly id: ExamId;
  readonly versionId: ExamVersionId;
  readonly version: number;
  readonly status: ExamStatus;
  readonly title: string;
  readonly durationMinutes: number;
  readonly rules: readonly ExamRule[];
  readonly blueprint: ExamBlueprint;
  readonly questionVersions: readonly QuestionVersion[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
  readonly publishedBy: string | null;
  readonly changeNote: string;
}>;

export type ExamCreateInput = Readonly<{
  readonly id?: ExamId | string;
  readonly title: string;
  readonly durationMinutes: number;
  readonly rules?: readonly ExamRuleInput[];
  readonly blueprint: ExamBlueprintInput | ExamBlueprint;
  readonly questionVersions?: readonly QuestionVersion[];
  readonly questionSnapshots?: readonly QuestionVersion[];
  readonly pinnedQuestionVersions?: readonly QuestionVersion[];
}>;

export type ExamUpdateInput = Readonly<Partial<{
  readonly title: string;
  readonly durationMinutes: number;
  readonly rules: readonly ExamRuleInput[];
  readonly blueprint: ExamBlueprintInput | ExamBlueprint;
  readonly questionVersions: readonly QuestionVersion[];
  readonly questionSnapshots: readonly QuestionVersion[];
  readonly pinnedQuestionVersions: readonly QuestionVersion[];
}>>;

export type ExamPublishInput = Readonly<{ readonly changeNote?: string }>;
export type ExamSuccessorInput = Readonly<{ readonly changeNote: string }>;

export type ExamRepositoryOperationOptions = Readonly<{
  readonly expectedVersion?: number;
  readonly session?: unknown;
  readonly latencyMs?: number;
  readonly outcome?: 'success' | 'service-error' | 'unauthorized' | 'conflict';
  readonly transientServiceFailures?: number;
  readonly retryLimit?: number;
  readonly retryDelayMs?: number;
}>;

export type ExamWorkflowErrorCode =
  | 'not-found'
  | 'conflict'
  | 'immutable'
  | 'validation'
  | 'unauthorized';

export class ExamWorkflowError extends Error {
  override readonly name: string = 'ExamWorkflowError';
  constructor(
    readonly code: ExamWorkflowErrorCode,
    message: string,
    readonly id?: ExamId | string
  ) {
    super(message);
  }
}

export type ExamWorkflowRequestStatus =
  | 'idle'
  | 'loading'
  | 'saving'
  | 'publishing'
  | 'success'
  | 'error'
  | 'unauthorized'
  | 'conflict';

export type ExamWorkflowRequestState = Readonly<{
  readonly status: ExamWorkflowRequestStatus;
  readonly message?: string;
}>;
export type ExamCurrentLoadStatus =
  | 'idle'
  | 'loading'
  | 'slow'
  | 'success'
  | 'error'
  | 'unauthorized';

export type ExamCurrentLoadState = Readonly<{
  readonly status: ExamCurrentLoadStatus;
  readonly message?: string;
  readonly retryable?: boolean;
}>;


export type ExamWorkflowValidationIssueCode =
  | 'invalid-settings'
  | 'invalid-snapshot'
  | 'duplicate-question'
  | 'invalid-blueprint'
  | 'coverage-mismatch';

export type ExamWorkflowValidationIssue = Readonly<{
  readonly code: ExamWorkflowValidationIssueCode;
  readonly path: string;
  readonly message: string;
}>;

type RecordLike = Record<string, unknown>;

const isRecord = (value: unknown): value is RecordLike => typeof value === 'object' && value !== null && !Array.isArray(value);
const freeze = <T>(value: T): T => Object.freeze(value);

const cloneAndFreeze = <T>(value: T, seen = new WeakMap<object, unknown>()): T => {
  if (value === null || typeof value !== 'object') return value;
  const existing = seen.get(value as object);
  if (existing !== undefined) return existing as T;
  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    seen.set(value, clone);
    for (const item of value) clone.push(cloneAndFreeze(item, seen));
    return freeze(clone) as T;
  }
  const clone: RecordLike = {};
  seen.set(value as object, clone);
  for (const key of Reflect.ownKeys(value as object)) {
    clone[key as string] = cloneAndFreeze((value as RecordLike)[key as string], seen);
  }
  return freeze(clone) as T;
};

const nonblank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const normalizedPrimitive = (value: unknown): ExamRuleValue | null => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.trim();
  return null;
};

export const normalizeExamRules = (input: unknown): readonly ExamRule[] => {
  if (!Array.isArray(input)) return freeze([] as ExamRule[]);
  const rules: ExamRule[] = [];
  for (const raw of input) {
    if (!isRecord(raw)) continue;
    const keyValue = raw['key'] ?? raw['name'];
    const key = typeof keyValue === 'string' ? keyValue.trim() : '';
    const value = normalizedPrimitive(raw['value'] ?? raw['enabled']);
    if (key.length === 0 || value === null || (typeof value === 'string' && value.length === 0)) continue;
    rules.push(freeze({ key, value }));
  }
  return freeze(rules);
};

export const validateExamSettings = (input: unknown): readonly ExamWorkflowValidationIssue[] => {
  const issues: ExamWorkflowValidationIssue[] = [];
  if (!isRecord(input)) return freeze([{ code: 'invalid-settings', path: '', message: 'Exam settings must be an object.' }]);
  if (!nonblank(input['title'])) issues.push({ code: 'invalid-settings', path: 'title', message: 'Title must be nonblank.' });
  const duration = input['durationMinutes'];
  if (typeof duration !== 'number' || !Number.isSafeInteger(duration) || duration <= 0) {
    issues.push({ code: 'invalid-settings', path: 'durationMinutes', message: 'Duration must be a positive whole number of minutes.' });
  }
  if (input['rules'] !== undefined && !Array.isArray(input['rules'])) {
    issues.push({ code: 'invalid-settings', path: 'rules', message: 'Rules must be an ordered array.' });
  }
  return freeze(issues.map((issue) => freeze(issue)));
};

export const normalizeExamSettings = (input: unknown): ExamSettings | null => {
  if (!isRecord(input) || validateExamSettings(input).length > 0) return null;
  return cloneAndFreeze({
    title: (input['title'] as string).trim(),
    durationMinutes: input['durationMinutes'] as number,
    rules: normalizeExamRules(input['rules'] ?? [])
  });
};

const snapshotsFrom = (input: RecordLike): readonly QuestionVersion[] => {
  const raw = input['questionVersions'] ?? input['questionSnapshots'] ?? input['pinnedQuestionVersions'];
  return Array.isArray(raw) ? raw as readonly QuestionVersion[] : [];
};

const isQuestionDifficulty = (value: unknown): value is QuestionDifficulty => value === 'easy' || value === 'medium' || value === 'hard';
const isQuestionType = (value: unknown): value is QuestionType =>
  value === 'single-choice' || value === 'multiple-choice' || value === 'true-false' || value === 'matching' || value === 'short-answer' || value === 'essay';
const isQuestionGrade = (value: unknown): boolean =>
  value === 'foundation' || value === 'intermediate' || value === 'advanced';
type RuntimeQuestionOption = Readonly<{ readonly id: string; readonly label: string }>;
const isQuestionOption = (value: unknown): value is RuntimeQuestionOption =>
  isRecord(value) && nonblank(value['id']) && nonblank(value['label']);
const isQuestionReference = (value: unknown): value is RecordLike =>
  isRecord(value) && nonblank(value['id']) && nonblank(value['code']) && nonblank(value['title']);

const isQuestionAnswer = (
  type: QuestionType,
  answer: unknown,
  options: readonly RuntimeQuestionOption[]
): boolean => {
  if (!isRecord(answer)) return false;
  if (type === 'single-choice' || type === 'multiple-choice') {
    const optionIds = answer['optionIds'];
    if (answer['kind'] !== 'choice' || !Array.isArray(optionIds) || optionIds.length === 0) return false;
    if (type === 'single-choice' && optionIds.length !== 1) return false;
    if (optionIds.some((id) => !nonblank(id))) return false;
    const unique = new Set(optionIds as readonly string[]);
    const available = new Set(options.map((option) => option.id));
    return unique.size === optionIds.length && [...unique].every((id) => available.has(id));
  }
  if (type === 'true-false') return answer['kind'] === 'boolean' && typeof answer['value'] === 'boolean';
  if (type === 'matching') {
    const pairs = answer['pairs'];
    if (answer['kind'] !== 'matching' || !Array.isArray(pairs) || pairs.length < 2) return false;
    const prompts = new Set<string>();
    return pairs.every((pair) => {
      if (!isRecord(pair) || !nonblank(pair['prompt']) || !nonblank(pair['answer'])) return false;
      const prompt = (pair['prompt'] as string).trim().toLocaleLowerCase();
      if (prompts.has(prompt)) return false;
      prompts.add(prompt);
      return true;
    });
  }
  if (type === 'short-answer') {
    const acceptedAnswers = answer['acceptedAnswers'];
    if (answer['kind'] !== 'short-answer' || !Array.isArray(acceptedAnswers) || acceptedAnswers.length === 0) return false;
    const normalized = acceptedAnswers.map((value) => typeof value === 'string' ? value.trim().toLocaleLowerCase() : '');
    return normalized.every((value) => value.length > 0) && new Set(normalized).size === normalized.length;
  }
  return answer['kind'] === 'essay' && nonblank(answer['rubricHint']);
};

const isCompletePublishedQuestionVersion = (raw: RecordLike): raw is RecordLike => {
  if (raw['status'] !== 'published' || !nonblank(raw['id']) || !nonblank(raw['questionId']) || !nonblank(raw['versionId']) ||
    raw['id'] !== raw['questionId'] || typeof raw['version'] !== 'number' || !Number.isSafeInteger(raw['version']) || raw['version'] <= 0 ||
    !nonblank(raw['courseId']) || !nonblank(raw['outcomeId']) || !isQuestionReference(raw['course']) || !isQuestionReference(raw['outcome']) ||
    raw['courseId'] !== (raw['course'] as RecordLike)['id'] || raw['outcomeId'] !== (raw['outcome'] as RecordLike)['id'] ||
    !nonblank(raw['title']) || !nonblank(raw['stem']) || typeof raw['explanation'] !== 'string' ||
    !Array.isArray(raw['tags']) || raw['tags'].some((tag) => typeof tag !== 'string') ||
    !isQuestionDifficulty(raw['difficulty']) || !isQuestionGrade(raw['grade']) || !isQuestionType(raw['type']) ||
    typeof raw['points'] !== 'number' || !Number.isFinite(raw['points']) || raw['points'] <= 0 ||
    !Array.isArray(raw['options']) || raw['options'].some((option) => !isQuestionOption(option)) ||
    !Array.isArray(raw['answer']) && !isRecord(raw['answer']) ||
    typeof raw['createdAt'] !== 'string' || !nonblank(raw['createdAt']) ||
    typeof raw['updatedAt'] !== 'string' || !nonblank(raw['updatedAt']) ||
    typeof raw['publishedAt'] !== 'string' || !nonblank(raw['publishedAt']) ||
    typeof raw['changeNote'] !== 'string') return false;
  const options = raw['options'] as readonly RuntimeQuestionOption[];
  const type = raw['type'];
  if (!isQuestionType(type)) return false;
  if (new Set(options.map((option) => option.id)).size !== options.length) return false;
  return isQuestionAnswer(type, raw['answer'], options);
};

export const validateExamQuestionVersions = (input: unknown): readonly ExamWorkflowValidationIssue[] => {
  const issues: ExamWorkflowValidationIssue[] = [];
  if (!Array.isArray(input)) return freeze([{ code: 'invalid-snapshot', path: 'questionVersions', message: 'Pinned question versions must be an array.' }]);
  const seen = new Set<string>();
  input.forEach((raw, index) => {
    const path = `questionVersions[${index}]`;
    if (!isRecord(raw) || !isCompletePublishedQuestionVersion(raw)) {
      issues.push({ code: 'invalid-snapshot', path, message: 'Every pinned question must be a complete published question-version snapshot.' });
      return;
    }
    const questionId = raw['questionId'] as string;
    if (seen.has(questionId)) issues.push({ code: 'duplicate-question', path: `${path}.questionId`, message: 'A stable question ID cannot be pinned more than once.' });
    seen.add(questionId);
  });
  return freeze(issues.map((issue) => freeze(issue)));
};

export const questionCoverageFromVersions = (versions: readonly QuestionVersion[]): ExamBlueprintCurrentCoverageInput => {
  const outcomes = new Map<LearningOutcomeId, { count: number; points: number }>();
  const difficulties = new Map<QuestionDifficulty, { count: number; points: number }>();
  const types = new Map<QuestionType, { count: number; points: number }>();
  for (const version of versions) {
    const add = <K extends string>(map: Map<K, { count: number; points: number }>, key: K): void => {
      const previous = map.get(key) ?? { count: 0, points: 0 };
      map.set(key, { count: previous.count + 1, points: previous.points + version.points });
    };
    add(outcomes, version.outcomeId);
    add(difficulties, version.difficulty);
    add(types, version.type);
  }
  return cloneAndFreeze({
    outcomeBuckets: [...outcomes.entries()].map(([key, value]) => ({ key, currentQuestionCount: value.count, currentPoints: value.points })),
    difficultyBuckets: [...difficulties.entries()].map(([key, value]) => ({ key, currentQuestionCount: value.count, currentPoints: value.points })),
    questionTypeBuckets: [...types.entries()].map(([key, value]) => ({ key, currentQuestionCount: value.count, currentPoints: value.points }))
  });
};

export const validateExamPublication = (
  blueprint: ExamBlueprint,
  questionVersions: readonly QuestionVersion[]
): readonly ExamWorkflowValidationIssue[] => {
  const issues: ExamWorkflowValidationIssue[] = [...validateExamQuestionVersions(questionVersions)];
  const comparison = compareExamBlueprint(blueprint, questionCoverageFromVersions(questionVersions));
  if (comparison.status !== 'valid') issues.push({ code: 'coverage-mismatch', path: 'questionVersions', message: comparison.summary });
  return freeze(issues.map((issue) => freeze(issue)));
};

export type ExamAggregateInput = Readonly<{
  readonly id: ExamId;
  readonly versionId: ExamVersionId;
  readonly version: number;
  readonly status: ExamStatus;
  readonly title: string;
  readonly durationMinutes: number;
  readonly rules: readonly ExamRuleInput[];
  readonly blueprint: unknown;
  readonly questionVersions: readonly QuestionVersion[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt?: string | null;
  readonly publishedBy?: string | null;
  readonly changeNote?: string;
}>;

export const createExam = (input: ExamAggregateInput): Exam | null => {
  const settings = normalizeExamSettings({ title: input.title, durationMinutes: input.durationMinutes, rules: input.rules });
  const blueprint = createExamBlueprint(input.blueprint);
  if (settings === null || blueprint === null || validateExamQuestionVersions(input.questionVersions).length > 0) return null;
  if (!nonblank(input.id) || !nonblank(input.versionId) || !Number.isSafeInteger(input.version) || input.version <= 0 ||
    !nonblank(input.createdAt) || !nonblank(input.updatedAt)) return null;
  return cloneAndFreeze({
    id: asExamId(String(input.id)),
    versionId: asExamVersionId(String(input.versionId)),
    version: input.version,
    status: input.status,
    ...settings,
    blueprint,
    questionVersions: input.questionVersions,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    publishedAt: input.publishedAt ?? null,
    publishedBy: input.publishedBy ?? null,
    changeNote: typeof input.changeNote === 'string' ? input.changeNote.trim() : ''
  } satisfies Exam);
};

export const cloneExam = (exam: Exam): Exam => cloneAndFreeze(exam);
export const freezeExam = cloneExam;

export { compareExamBlueprint, createExamBlueprint, validateExamBlueprint };
export type { ExamBlueprint, ExamBlueprintCurrentCoverageInput, ExamBlueprintInput, ExamBlueprintValidationIssue };
