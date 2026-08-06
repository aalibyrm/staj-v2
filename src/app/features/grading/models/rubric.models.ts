export const RUBRIC_ERROR_CODES = Object.freeze({
  malformedInput: 'malformed-input',
  malformedRubric: 'malformed-rubric',
  malformedContext: 'malformed-context',
  malformedResponsePreview: 'malformed-response-preview',
  invalidId: 'invalid-id',
  invalidText: 'invalid-text',
  invalidMaximumPoints: 'invalid-maximum-points',
  invalidCriterion: 'invalid-criterion',
  duplicateCriterionId: 'duplicate-criterion-id',
  invalidCriterionWeight: 'invalid-criterion-weight',
  invalidWeightTotal: 'invalid-weight-total',
  invalidCriterionMaximum: 'invalid-criterion-maximum',
  invalidLevel: 'invalid-level',
  duplicateLevelId: 'duplicate-level-id',
  invalidLevelOrder: 'invalid-level-order',
  invalidLevelScore: 'invalid-level-score',
  unknownCriterion: 'unknown-criterion',
  unknownLevel: 'unknown-level',
  unknownSelection: 'unknown-selection',
  invalidSelection: 'invalid-selection',
  invalidComment: 'invalid-comment',
  invalidOverallFeedback: 'invalid-overall-feedback'
} as const);

export type RubricErrorCode = (typeof RUBRIC_ERROR_CODES)[keyof typeof RUBRIC_ERROR_CODES];

export class RubricDomainError extends Error {
  override readonly name = 'RubricDomainError';

  constructor(
    readonly code: RubricErrorCode,
    message: string,
    readonly target?: string
  ) {
    super(message);
  }
}

export type RubricLevelInput = Readonly<{
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly score: number;
}>;

export type RubricLevel = Readonly<{
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly score: number;
}>;

export type RubricCriterionInput = Readonly<{
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly weight: number;
  readonly maxScore: number;
  readonly levels: readonly RubricLevelInput[];
  readonly comment?: string;
}>;

export type RubricCriterion = Readonly<{
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly weight: number;
  readonly maxScore: number;
  readonly levels: readonly RubricLevel[];
  readonly comment: string;
}>;

export type RubricInput = Readonly<{
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly maximumPoints: number;
  readonly criteria: readonly RubricCriterionInput[];
}>;

export type Rubric = Readonly<{
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly maximumPoints: number;
  readonly criteria: readonly RubricCriterion[];
}>;

export type GradingContextInput = Readonly<{
  readonly attemptId: string;
  readonly studentId?: string;
  readonly studentName: string;
  readonly examId?: string;
  readonly examTitle: string;
  readonly courseTitle?: string;
  readonly questionNumber?: number;
  readonly questionCount?: number;
}>;

export type GradingContext = Readonly<{
  readonly attemptId: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly examId: string;
  readonly examTitle: string;
  readonly courseTitle: string;
  readonly questionNumber: number;
  readonly questionCount: number;
}>;

export type ResponsePreviewInput = Readonly<{
  readonly questionId: string;
  readonly questionPrompt?: string;
  readonly prompt?: string;
  readonly responseText?: string;
  readonly response?: string;
  readonly wordCount?: number;
  readonly attachmentCount?: number;
  readonly submittedAt?: string;
}>;

export type ResponsePreview = Readonly<{
  readonly questionId: string;
  readonly questionPrompt: string;
  readonly responseText: string;
  readonly wordCount: number;
  readonly attachmentCount: number;
  readonly submittedAt: string | null;
}>;

export type RubricGradingInput = Readonly<{
  readonly context: GradingContextInput | GradingContext;
  readonly responsePreview: ResponsePreviewInput | ResponsePreview;
  readonly rubric: RubricInput | Rubric;
  readonly selectedLevelIds?: Readonly<Record<string, string | null | undefined>>;
  readonly criterionComments?: Readonly<Record<string, string | null | undefined>>;
  readonly overallFeedback?: string | null;
}>;

export type RubricGrading = Readonly<{
  readonly context: GradingContext;
  readonly responsePreview: ResponsePreview;
  readonly rubric: Rubric;
  readonly selectedLevelIds: Readonly<Record<string, string | null>>;
  readonly criterionComments: Readonly<Record<string, string>>;
  readonly overallFeedback: string;
}>;

export type RubricEvaluation = RubricGrading;

export const MAX_CRITERION_COMMENT_LENGTH = 500;
export const MAX_OVERALL_FEEDBACK_LENGTH = 1000;

const WEIGHT_EPSILON = 1e-9;

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const fail = (code: RubricErrorCode, message: string, target?: string): never => {
  throw new RubricDomainError(code, message, target);
};

const sourceRecord = (value: unknown, label: string): UnknownRecord => {
  if (!isRecord(value)) return fail(RUBRIC_ERROR_CODES.malformedInput, `${label} must be an object.`, label);
  return value;
};

const requiredText = (value: unknown, target: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fail(RUBRIC_ERROR_CODES.invalidText, `${target} must be a nonblank string.`, target);
  }
  return value.trim();
};

const optionalText = (value: unknown, target: string): string => {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return fail(RUBRIC_ERROR_CODES.invalidText, `${target} must be a string.`, target);
  return value.trim();
};

const finitePositive = (value: unknown, code: RubricErrorCode, message: string, target: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fail(code, message, target);
  }
  return value;
};

const nonNegativeInteger = (value: unknown, fallback: number, target: string): number => {
  const candidate = value === undefined ? fallback : value;
  if (typeof candidate !== 'number' || !Number.isSafeInteger(candidate) || candidate < 1) {
    return fail(RUBRIC_ERROR_CODES.invalidSelection, `${target} must be a positive safe integer.`, target);
  }
  return candidate;
};

const freezeRecord = <T extends Record<string, unknown>>(value: T): Readonly<T> =>
  Object.freeze({ ...value });

const freezeLevels = (levels: RubricLevel[]): readonly RubricLevel[] => Object.freeze(levels);
const freezeCriteria = (criteria: RubricCriterion[]): readonly RubricCriterion[] => Object.freeze(criteria);

export const createRubricLevel = (input: RubricLevelInput): RubricLevel => {
  const source = sourceRecord(input, 'level');
  const id = requiredText(source['id'], 'level.id');
  const label = requiredText(source['label'], 'level.label');
  const description = optionalText(source['description'], 'level.description');
  const score = source['score'];
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) {
    return fail(
      RUBRIC_ERROR_CODES.invalidLevelScore,
      'level.score must be a finite number greater than or equal to zero.',
      'level.score'
    );
  }
  return Object.freeze({ id, label, description, score });
};

export const createRubricCriterion = (input: RubricCriterionInput): RubricCriterion => {
  const source = sourceRecord(input, 'criterion');
  const id = requiredText(source['id'], 'criterion.id');
  const title = requiredText(source['title'], 'criterion.title');
  const description = optionalText(source['description'], 'criterion.description');
  const weight = finitePositive(
    source['weight'],
    RUBRIC_ERROR_CODES.invalidCriterionWeight,
    'criterion.weight must be a finite positive number.',
    'criterion.weight'
  );
  const maxScore = finitePositive(
    source['maxScore'],
    RUBRIC_ERROR_CODES.invalidCriterionMaximum,
    'criterion.maxScore must be a finite positive number.',
    'criterion.maxScore'
  );
  const rawLevels = source['levels'];
  if (!Array.isArray(rawLevels) || rawLevels.length < 2) {
    return fail(
      RUBRIC_ERROR_CODES.invalidLevel,
      'criterion.levels must contain at least two ordered levels.',
      'criterion.levels'
    );
  }

  const ids = new Set<string>();
  let previousScore = -Infinity;
  const levels: RubricLevel[] = [];
  for (const [index, rawLevel] of rawLevels.entries()) {
    const level = createRubricLevel(rawLevel as RubricLevelInput);
    if (ids.has(level.id)) {
      return fail(
        RUBRIC_ERROR_CODES.duplicateLevelId,
        `criterion.levels contains duplicate id ${level.id}.`,
        `criterion.levels[${index}].id`
      );
    }
    ids.add(level.id);
    if (level.score > maxScore) {
      return fail(
        RUBRIC_ERROR_CODES.invalidLevelScore,
        `Level ${level.id} score cannot exceed criterion maxScore.`,
        `criterion.levels[${index}].score`
      );
    }
    if (level.score <= previousScore) {
      return fail(
        RUBRIC_ERROR_CODES.invalidLevelOrder,
        'criterion.levels scores must be strictly increasing.',
        `criterion.levels[${index}].score`
      );
    }
    previousScore = level.score;
    levels.push(level);
  }
  if (levels[0]?.score !== 0 || levels[levels.length - 1]?.score !== maxScore) {
    return fail(
      RUBRIC_ERROR_CODES.invalidLevelScore,
      'criterion.levels must begin at zero and end at criterion.maxScore.',
      'criterion.levels'
    );
  }
  const comment = optionalText(source['comment'], 'criterion.comment');
  return Object.freeze({
    id,
    title,
    description,
    weight,
    maxScore,
    levels: freezeLevels(levels),
    comment
  });
};

export const createRubric = (input: RubricInput): Rubric => {
  const source = sourceRecord(input, 'rubric');
  const id = requiredText(source['id'], 'rubric.id');
  const title = requiredText(source['title'], 'rubric.title');
  const description = optionalText(source['description'], 'rubric.description');
  const maximumPoints = finitePositive(
    source['maximumPoints'],
    RUBRIC_ERROR_CODES.invalidMaximumPoints,
    'rubric.maximumPoints must be a finite positive number.',
    'rubric.maximumPoints'
  );
  const rawCriteria = source['criteria'];
  if (!Array.isArray(rawCriteria) || rawCriteria.length === 0) {
    return fail(RUBRIC_ERROR_CODES.invalidCriterion, 'rubric.criteria must not be empty.', 'rubric.criteria');
  }

  const ids = new Set<string>();
  const criteria: RubricCriterion[] = [];
  let weightTotal = 0;
  for (const [index, rawCriterion] of rawCriteria.entries()) {
    const criterion = createRubricCriterion(rawCriterion as RubricCriterionInput);
    if (ids.has(criterion.id)) {
      return fail(
        RUBRIC_ERROR_CODES.duplicateCriterionId,
        `rubric.criteria contains duplicate id ${criterion.id}.`,
        `rubric.criteria[${index}].id`
      );
    }
    ids.add(criterion.id);
    weightTotal += criterion.weight;
    criteria.push(criterion);
  }
  if (!Number.isFinite(weightTotal) || Math.abs(weightTotal - 1) > WEIGHT_EPSILON) {
    return fail(
      RUBRIC_ERROR_CODES.invalidWeightTotal,
      'rubric criterion weights must be positive and sum to one.',
      'rubric.criteria.weight'
    );
  }
  return Object.freeze({
    id,
    title,
    description,
    maximumPoints,
    criteria: freezeCriteria(criteria)
  });
};

export const createGradingContext = (input: GradingContextInput): GradingContext => {
  const source = sourceRecord(input, 'grading context');
  const attemptId = requiredText(source['attemptId'], 'context.attemptId');
  const studentName = requiredText(source['studentName'], 'context.studentName');
  const examTitle = requiredText(source['examTitle'], 'context.examTitle');
  const studentId = optionalText(source['studentId'], 'context.studentId');
  const examId = optionalText(source['examId'], 'context.examId');
  const courseTitle = optionalText(source['courseTitle'], 'context.courseTitle');
  const questionCount = nonNegativeInteger(source['questionCount'], 1, 'context.questionCount');
  const questionNumber = nonNegativeInteger(source['questionNumber'], 1, 'context.questionNumber');
  if (questionNumber > questionCount) {
    return fail(
      RUBRIC_ERROR_CODES.invalidSelection,
      'context.questionNumber cannot exceed context.questionCount.',
      'context.questionNumber'
    );
  }
  return Object.freeze({
    attemptId,
    studentId,
    studentName,
    examId,
    examTitle,
    courseTitle,
    questionNumber,
    questionCount
  });
};

const countWords = (text: string): number => {
  const normalized = text.trim();
  return normalized.length === 0 ? 0 : normalized.split(/\s+/u).length;
};

export const createResponsePreview = (input: ResponsePreviewInput): ResponsePreview => {
  const source = sourceRecord(input, 'response preview');
  const questionId = requiredText(source['questionId'], 'responsePreview.questionId');
  const questionPrompt = requiredText(
    source['questionPrompt'] ?? source['prompt'],
    'responsePreview.questionPrompt'
  );
  const responseText = requiredText(
    source['responseText'] ?? source['response'],
    'responsePreview.responseText'
  );
  const rawWordCount = source['wordCount'];
  const wordCount = rawWordCount === undefined ? countWords(responseText) : rawWordCount;
  if (typeof wordCount !== 'number' || !Number.isSafeInteger(wordCount) || wordCount < 0) {
    return fail(RUBRIC_ERROR_CODES.invalidSelection, 'responsePreview.wordCount must be a nonnegative safe integer.', 'responsePreview.wordCount');
  }
  const rawAttachmentCount = source['attachmentCount'];
  const attachmentCount = rawAttachmentCount === undefined ? 0 : rawAttachmentCount;
  if (typeof attachmentCount !== 'number' || !Number.isSafeInteger(attachmentCount) || attachmentCount < 0) {
    return fail(RUBRIC_ERROR_CODES.invalidSelection, 'responsePreview.attachmentCount must be a nonnegative safe integer.', 'responsePreview.attachmentCount');
  }
  const submittedAt = source['submittedAt'];
  if (submittedAt !== undefined && submittedAt !== null && typeof submittedAt !== 'string') {
    return fail(RUBRIC_ERROR_CODES.invalidText, 'responsePreview.submittedAt must be a string or null.', 'responsePreview.submittedAt');
  }
  return Object.freeze({
    questionId,
    questionPrompt,
    responseText,
    wordCount,
    attachmentCount,
    submittedAt: typeof submittedAt === 'string' && submittedAt.trim().length > 0 ? submittedAt.trim() : null
  });
};

function mapForCriteria(
  raw: unknown,
  criteria: readonly RubricCriterion[],
  kind: 'selection'
): Readonly<Record<string, string | null>>;
function mapForCriteria(
  raw: unknown,
  criteria: readonly RubricCriterion[],
  kind: 'comment'
): Readonly<Record<string, string>>;
function mapForCriteria(
  raw: unknown,
  criteria: readonly RubricCriterion[],
  kind: 'selection' | 'comment'
): Readonly<Record<string, string | null>> {
  const source = raw === undefined || raw === null ? {} : sourceRecord(raw, `${kind} map`);
  const criterionById = new Map(criteria.map((criterion) => [criterion.id, criterion] as const));
  for (const key of Object.keys(source)) {
    if (!criterionById.has(key)) {
      return fail(RUBRIC_ERROR_CODES.unknownCriterion, `${kind} references unknown criterion ${key}.`, key);
    }
  }
  const values: Record<string, string | null> = {};
  for (const criterion of criteria) {
    const value = source[criterion.id];
    if (kind === 'selection') {
      if (value === undefined || value === null || value === '') {
        values[criterion.id] = null;
        continue;
      }
      if (typeof value !== 'string' || value.trim().length === 0) {
        return fail(RUBRIC_ERROR_CODES.invalidSelection, `Selection for ${criterion.id} must be a level id or null.`, criterion.id);
      }
      const levelId = value.trim();
      if (!criterion.levels.some((level) => level.id === levelId)) {
        return fail(RUBRIC_ERROR_CODES.unknownLevel, `Selection for ${criterion.id} references unknown level ${levelId}.`, criterion.id);
      }
      values[criterion.id] = levelId;
    } else {
      if (value === undefined || value === null) {
        values[criterion.id] = criterion.comment;
      } else if (typeof value !== 'string') {
        return fail(RUBRIC_ERROR_CODES.invalidComment, `Comment for ${criterion.id} must be a string.`, criterion.id);
      } else {
        values[criterion.id] = value.trim();
      }
    }
  }
  return freezeRecord(values);
};

export const createRubricGrading = (input: RubricGradingInput): RubricGrading => {
  const source = sourceRecord(input, 'rubric grading');
  const context = createGradingContext(source['context'] as GradingContextInput);
  const responsePreview = createResponsePreview(source['responsePreview'] as ResponsePreviewInput);
  const rubric = createRubric(source['rubric'] as RubricInput);
  const selectedLevelIds = mapForCriteria(source['selectedLevelIds'], rubric.criteria, 'selection');
  const criterionComments = mapForCriteria(source['criterionComments'], rubric.criteria, 'comment');
  const overallFeedback = optionalText(source['overallFeedback'], 'overallFeedback');
  return Object.freeze({
    context,
    responsePreview,
    rubric,
    selectedLevelIds,
    criterionComments,
    overallFeedback
  });
};

export const validateRubric = (input: unknown): Rubric => createRubric(input as RubricInput);
export const freezeRubric = createRubric;
export const createRubricEvaluation = createRubricGrading;
