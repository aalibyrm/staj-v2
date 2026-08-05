declare const examQuestionIdBrand: unique symbol;

export type ExamQuestionId = string & { readonly [examQuestionIdBrand]: 'ExamQuestionId' };

export type AnswerValue = string | number | boolean | readonly string[] | null;

export type ExamQuestionOption = Readonly<{
  readonly id: string;
  readonly label: string;
}>;

export type ExamQuestionKind = 'single' | 'multiple' | 'text';

export type ExamQuestion = Readonly<{
  readonly id: ExamQuestionId;
  readonly order: number;
  readonly prompt: string;
  readonly kind: ExamQuestionKind;
  readonly points: number;
  readonly options: readonly ExamQuestionOption[];
}>;

export type ExamQuestionInput = Readonly<{
  readonly id: ExamQuestionId | string;
  readonly order?: number;
  readonly prompt: string;
  readonly kind?: ExamQuestionKind;
  readonly points?: number;
  readonly options?: readonly ExamQuestionOption[];
}>;

export type AnswerDraft = Readonly<{
  readonly questionId: ExamQuestionId;
  readonly value: AnswerValue;
  readonly answered: boolean;
  readonly flagged: boolean;
  readonly version: number;
  readonly savedAt: string | null;
}>;

export type AnswerDraftPersistenceInput = Readonly<{
  readonly version?: number;
  readonly savedAt?: string | null;
}>;

export type AnswerDraftMap = Readonly<Record<string, AnswerDraft>>;

export type ExamProgress = Readonly<{
  readonly total: number;
  readonly answered: number;
  readonly unanswered: number;
  readonly flagged: number;
  readonly current: number;
}>;

const nonblank = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const normalizeDraftVersion = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Answer draft version must be a nonnegative safe integer.');
  }
  return value;
};

const normalizeSavedAt = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (!nonblank(value)) throw new Error('Answer draft savedAt must be null or a nonblank string.');
  return value.trim();
};

const freezeAnswerValue = (value: AnswerValue): AnswerValue => {
  if (Array.isArray(value)) {
    const source = value as readonly unknown[];
    if (source.some((item) => {
      if (typeof item === 'number') return !Number.isFinite(item);
      return typeof item !== 'string' && typeof item !== 'boolean';
    })) {
      throw new Error('Answer draft array values must be strings, numbers, or booleans.');
    }
    return Object.freeze(source.map((item) => String(item)));
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error('Answer draft value has an unsupported type.');
};

const normalizeDraftPersistence = (
  versionOrPersistence: number | AnswerDraftPersistenceInput | undefined,
  savedAt: string | null | undefined
): Readonly<{ readonly version: number; readonly savedAt: string | null }> => {
  if (versionOrPersistence !== undefined && typeof versionOrPersistence !== 'number' &&
    (versionOrPersistence === null || typeof versionOrPersistence !== 'object' || Array.isArray(versionOrPersistence))) {
    throw new Error('Answer draft persistence must be a version number or object.');
  }
  const source = typeof versionOrPersistence === 'object' && versionOrPersistence !== null
    ? versionOrPersistence
    : undefined;
  const version = normalizeDraftVersion(source?.version ?? versionOrPersistence ?? 0);
  return Object.freeze({
    version,
    savedAt: normalizeSavedAt(source?.savedAt ?? savedAt ?? null)
  });
};

export const isAnswerValueProvided = (value: AnswerValue | undefined): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

export const asExamQuestionId = (value: string): ExamQuestionId => value as ExamQuestionId;

export const createExamQuestion = (input: ExamQuestionInput): ExamQuestion => {
  if (!nonblank(input.id)) throw new Error('Question id must be nonblank.');
  if (!nonblank(input.prompt)) throw new Error('Question prompt must be nonblank.');
  const order = input.order ?? 1;
  const points = input.points ?? 1;
  if (!Number.isSafeInteger(order) || order < 1) throw new Error('Question order must be a positive safe integer.');
  if (!Number.isSafeInteger(points) || points <= 0) throw new Error('Question points must be a positive safe integer.');
  const kind = input.kind ?? 'single';
  const options = Object.freeze((input.options ?? []).map((option) => Object.freeze({
    id: String(option.id),
    label: String(option.label)
  })));
  return Object.freeze({
    id: asExamQuestionId(input.id.trim()),
    order,
    prompt: input.prompt.trim(),
    kind,
    points,
    options
  });
};

export function createAnswerDraft(
  questionId: ExamQuestionId | string,
  value?: AnswerValue,
  flagged?: boolean,
  version?: number,
  savedAt?: string | null
): AnswerDraft;
export function createAnswerDraft(
  questionId: ExamQuestionId | string,
  value?: AnswerValue,
  flagged?: boolean,
  persistence?: AnswerDraftPersistenceInput
): AnswerDraft;
export function createAnswerDraft(
  questionId: ExamQuestionId | string,
  value: AnswerValue = null,
  flagged = false,
  versionOrPersistence: number | AnswerDraftPersistenceInput = 0,
  savedAt: string | null = null
): AnswerDraft {
  if (!nonblank(questionId)) throw new Error('Answer draft questionId must be nonblank.');
  if (typeof flagged !== 'boolean') throw new Error('Answer draft flagged must be a boolean.');
  const persistence = normalizeDraftPersistence(versionOrPersistence, savedAt);
  const frozenValue = freezeAnswerValue(value);
  return Object.freeze({
    questionId: asExamQuestionId(questionId.trim()),
    value: frozenValue,
    answered: isAnswerValueProvided(frozenValue),
    flagged,
    version: persistence.version,
    savedAt: persistence.savedAt
  });
}

export const updateAnswerDraft = (
  draft: AnswerDraft,
  value: AnswerValue
): AnswerDraft => createAnswerDraft(draft.questionId, value, draft.flagged, draft.version, draft.savedAt);

export const toggleAnswerDraftReview = (draft: AnswerDraft): AnswerDraft =>
  createAnswerDraft(draft.questionId, draft.value, !draft.flagged, draft.version, draft.savedAt);

export const deriveExamProgress = (
  questions: readonly ExamQuestion[],
  drafts: AnswerDraftMap,
  currentIndex: number
): ExamProgress => {
  const total = questions.length;
  const answered = questions.reduce((count, question) => count + (drafts[question.id]?.answered ? 1 : 0), 0);
  const flagged = questions.reduce((count, question) => count + (drafts[question.id]?.flagged ? 1 : 0), 0);
  return Object.freeze({
    total,
    answered,
    unanswered: Math.max(0, total - answered),
    flagged,
    current: total === 0 ? 0 : Math.min(total, Math.max(1, currentIndex + 1))
  });
};

export const freezeAnswerDraftMap = (drafts: readonly AnswerDraft[]): AnswerDraftMap => {
  const entries = drafts.map((draft) => [draft.questionId, draft] as const);
  return Object.freeze(Object.fromEntries(entries));
};
