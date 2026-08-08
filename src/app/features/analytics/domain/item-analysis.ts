import type {
  Question,
  QuestionDifficulty,
  QuestionType
} from '../../question-bank/models/question.models';

export const ITEM_ANALYSIS_ERROR_CODES = Object.freeze({
  malformedInput: 'malformed-input',
  invalidQuestionId: 'invalid-question-id',
  invalidLearnerId: 'invalid-learner-id',
  invalidSelectedOptionId: 'invalid-selected-option-id',
  invalidFraction: 'invalid-fraction',
  unknownQuestion: 'unknown-question',
  duplicateEvidence: 'duplicate-evidence'
} as const);

export type ItemAnalysisErrorCode =
  (typeof ITEM_ANALYSIS_ERROR_CODES)[keyof typeof ITEM_ANALYSIS_ERROR_CODES];

export class ItemAnalysisError extends Error {
  override readonly name = 'ItemAnalysisError';

  constructor(
    readonly code: ItemAnalysisErrorCode,
    message: string,
    readonly target?: string
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type ItemAnalysisEvidence = Readonly<{
  readonly questionId: string;
  readonly learnerId: string;
  /** The learner's total score fraction, used only for discrimination ranking. */
  readonly learnerTotalScoreFraction?: number;
  /** Accepted as a descriptive alias for learnerTotalScoreFraction. */
  readonly totalScoreFraction?: number;
  readonly earnedFraction: number;
  readonly selectedOptionIds: readonly string[];
}>;

export type ItemAnalysisInput = Readonly<{
  readonly questions: readonly Question[];
  readonly evidence: readonly ItemAnalysisEvidence[];
}>;

export type ItemAnalysisOptionRow = Readonly<{
  readonly optionId: string;
  readonly label: string;
  readonly selectionCount: number;
  /** Percentage of respondents selecting this configured option, in 0..100. */
  readonly respondentPercentage: number;
  readonly isCorrect: boolean;
}>;

export type ItemAnalysisOptionAnalysis = Readonly<{
  readonly status: 'applicable' | 'not-applicable';
  readonly rows: readonly ItemAnalysisOptionRow[];
  readonly unlistedSelectionCount: number;
  readonly allowsMultipleSelections: boolean;
}>;

export type ItemAnalysisRow = Readonly<{
  readonly questionId: string;
  readonly questionTitle: string;
  readonly courseId: string;
  readonly courseLabel: string;
  readonly outcomeId: string;
  readonly outcomeLabel: string;
  readonly difficulty: QuestionDifficulty;
  readonly type: QuestionType;
  readonly responseCount: number;
  readonly facilityIndex: number;
  readonly discrimination: number | null;
  readonly discriminationLabel: 'insufficient-data' | 'negative' | 'weak' | 'moderate' | 'strong';
  readonly optionAnalysis: ItemAnalysisOptionAnalysis;
}>;

type NormalizedEvidence = Readonly<{
  readonly questionId: string;
  readonly learnerId: string;
  readonly learnerTotalScoreFraction: number;
  readonly earnedFraction: number;
  readonly selectedOptionIds: readonly string[];
}>;

const EMPTY_OPTION_ROWS: readonly ItemAnalysisOptionRow[] = Object.freeze([]);
const ROUNDING_FACTOR = 10_000;

const isRecord = (value: unknown): value is { readonly [key: string]: unknown } =>
  value !== null && typeof value === 'object';

const freezeArray = <T>(items: readonly T[]): readonly T[] => Object.freeze([...items]);

const round4 = (value: number): number => {
  const rounded = Math.round((value + Number.EPSILON) * ROUNDING_FACTOR) / ROUNDING_FACTOR;
  return Object.is(rounded, -0) ? 0 : rounded;
};

const compareIds = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const isFraction = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

const fail = (code: ItemAnalysisErrorCode, message: string, target?: string): never => {
  throw new ItemAnalysisError(code, message, target);
};

const normalizeEvidence = (
  evidence: ItemAnalysisEvidence,
  index: number,
  questionIds: ReadonlySet<string>,
  seenEvidence: Set<string>
): NormalizedEvidence => {
  if (!isRecord(evidence)) {
    return fail(ITEM_ANALYSIS_ERROR_CODES.malformedInput, 'Each item-analysis evidence record must be an object.', `evidence[${index}]`);
  }

  const questionId = typeof evidence.questionId === 'string' ? evidence.questionId.trim() : '';
  if (questionId.length === 0) {
    return fail(ITEM_ANALYSIS_ERROR_CODES.invalidQuestionId, 'questionId must be a nonblank string.', `evidence[${index}].questionId`);
  }
  if (!questionIds.has(questionId)) {
    return fail(ITEM_ANALYSIS_ERROR_CODES.unknownQuestion, `Evidence references unknown question ${questionId}.`, questionId);
  }

  const learnerId = typeof evidence.learnerId === 'string' ? evidence.learnerId.trim() : '';
  if (learnerId.length === 0) {
    return fail(ITEM_ANALYSIS_ERROR_CODES.invalidLearnerId, 'learnerId must be a nonblank string.', `evidence[${index}].learnerId`);
  }

  const totalScoreFraction: unknown = evidence.learnerTotalScoreFraction ?? evidence.totalScoreFraction;
  const earnedFraction: unknown = evidence.earnedFraction;
  if (!isFraction(totalScoreFraction) || !isFraction(earnedFraction)) {
    return fail(ITEM_ANALYSIS_ERROR_CODES.invalidFraction, 'Score fractions must be finite numbers in the range 0..1.', `evidence[${index}]`);
  }

  if (!Array.isArray(evidence.selectedOptionIds)) {
    return fail(ITEM_ANALYSIS_ERROR_CODES.invalidSelectedOptionId, 'selectedOptionIds must be an array of nonblank strings.', `evidence[${index}].selectedOptionIds`);
  }
  const selectedOptionIds: string[] = [];
  for (const [optionIndex, rawOptionId] of evidence.selectedOptionIds.entries()) {
    const optionId = typeof rawOptionId === 'string' ? rawOptionId.trim() : '';
    if (optionId.length === 0) {
      return fail(ITEM_ANALYSIS_ERROR_CODES.invalidSelectedOptionId, 'Selected option ids must be nonblank strings.', `evidence[${index}].selectedOptionIds[${optionIndex}]`);
    }
    selectedOptionIds.push(optionId);
  }

  const evidenceKey = `${questionId}\u0000${learnerId}`;
  if (seenEvidence.has(evidenceKey)) {
    return fail(ITEM_ANALYSIS_ERROR_CODES.duplicateEvidence, `Duplicate evidence for learner ${learnerId} and question ${questionId}.`, evidenceKey);
  }
  seenEvidence.add(evidenceKey);

  return Object.freeze({
    questionId,
    learnerId,
    learnerTotalScoreFraction: totalScoreFraction,
    earnedFraction,
    selectedOptionIds: freezeArray(selectedOptionIds)
  });
};

const discriminationLabelFor = (
  discrimination: number | null
): ItemAnalysisRow['discriminationLabel'] => {
  if (discrimination === null) return 'insufficient-data';
  if (discrimination < 0) return 'negative';
  if (discrimination < 0.2) return 'weak';
  if (discrimination < 0.4) return 'moderate';
  return 'strong';
};

const meanEarnedFraction = (evidence: readonly NormalizedEvidence[]): number =>
  round4(evidence.reduce((sum, item) => sum + item.earnedFraction, 0) / evidence.length);

const discriminationFor = (evidence: readonly NormalizedEvidence[]): number | null => {
  const learnerIds = new Set(evidence.map((item) => item.learnerId));
  if (learnerIds.size < 2) return null;

  const ranked = [...evidence].sort((left, right) =>
    right.learnerTotalScoreFraction - left.learnerTotalScoreFraction || compareIds(left.learnerId, right.learnerId)
  );
  const groupSize = Math.max(1, Math.floor(ranked.length * 0.27));
  const upper = ranked.slice(0, groupSize);
  const lower = ranked.slice(ranked.length - groupSize);
  const upperMean = upper.reduce((sum, item) => sum + item.earnedFraction, 0) / upper.length;
  const lowerMean = lower.reduce((sum, item) => sum + item.earnedFraction, 0) / lower.length;
  return round4(upperMean - lowerMean);
};

const optionAnalysisFor = (
  question: Question,
  evidence: readonly NormalizedEvidence[]
): ItemAnalysisOptionAnalysis => {
  const isChoice = question.type === 'single-choice' || question.type === 'multiple-choice';
  if (!isChoice) {
    return Object.freeze({
      status: 'not-applicable' as const,
      rows: EMPTY_OPTION_ROWS,
      unlistedSelectionCount: 0,
      allowsMultipleSelections: false
    });
  }

  const counts = new Map<string, number>(question.options.map((option) => [option.id, 0]));
  let unlistedSelectionCount = 0;
  for (const response of evidence) {
    const selectedIds = new Set(response.selectedOptionIds);
    for (const optionId of selectedIds) {
      if (counts.has(optionId)) {
        counts.set(optionId, (counts.get(optionId) ?? 0) + 1);
      } else {
        unlistedSelectionCount += 1;
      }
    }
  }

  const correctOptionIds = question.answer.kind === 'choice'
    ? new Set(question.answer.optionIds)
    : new Set<string>();
  const rows = freezeArray(question.options.map((option) => Object.freeze({
    optionId: option.id,
    label: option.label,
    selectionCount: counts.get(option.id) ?? 0,
    respondentPercentage: round4(((counts.get(option.id) ?? 0) / evidence.length) * 100),
    isCorrect: correctOptionIds.has(option.id)
  })));

  return Object.freeze({
    status: 'applicable' as const,
    rows,
    unlistedSelectionCount,
    allowsMultipleSelections: question.type === 'multiple-choice'
  });
};

const selectFromArrays = (
  questions: readonly Question[],
  evidence: readonly ItemAnalysisEvidence[]
): readonly ItemAnalysisRow[] => {
  if (!Array.isArray(questions) || !Array.isArray(evidence)) {
    return fail(ITEM_ANALYSIS_ERROR_CODES.malformedInput, 'Questions and evidence must be arrays.');
  }

  const questionById = new Map<string, Question>();
  for (const question of questions) {
    if (question === null || typeof question !== 'object') {
      return fail(ITEM_ANALYSIS_ERROR_CODES.malformedInput, 'Questions must contain question records.', 'questions');
    }
    const questionId = typeof question.id === 'string' ? question.id.trim() : '';
    if (questionId.length === 0) {
      return fail(ITEM_ANALYSIS_ERROR_CODES.invalidQuestionId, 'Question ids must be nonblank strings.', 'questions');
    }
    questionById.set(questionId, question);
  }

  const seenEvidence = new Set<string>();
  const grouped = new Map<string, NormalizedEvidence[]>();
  for (const [index, item] of evidence.entries()) {
    const normalized = normalizeEvidence(item, index, new Set(questionById.keys()), seenEvidence);
    const bucket = grouped.get(normalized.questionId);
    if (bucket === undefined) grouped.set(normalized.questionId, [normalized]);
    else bucket.push(normalized);
  }

  const rows = [...grouped.entries()]
    .sort(([left], [right]) => compareIds(left, right))
    .map(([questionId, questionEvidence]) => {
      const question = questionById.get(questionId);
      if (question === undefined) {
        return fail(ITEM_ANALYSIS_ERROR_CODES.unknownQuestion, `Evidence references unknown question ${questionId}.`, questionId);
      }
      const discrimination = discriminationFor(questionEvidence);
      return Object.freeze({
        questionId,
        questionTitle: question.title,
        courseId: String(question.courseId),
        courseLabel: `${question.course.code} · ${question.course.title}`,
        outcomeId: String(question.outcomeId),
        outcomeLabel: `${question.outcome.code} · ${question.outcome.title}`,
        difficulty: question.difficulty,
        type: question.type,
        responseCount: questionEvidence.length,
        facilityIndex: meanEarnedFraction(questionEvidence),
        discrimination,
        discriminationLabel: discriminationLabelFor(discrimination),
        optionAnalysis: optionAnalysisFor(question, questionEvidence)
      });
    });

  return Object.freeze(rows);
};

export function selectItemAnalysis(input: ItemAnalysisInput): readonly ItemAnalysisRow[];
export function selectItemAnalysis(
  questions: readonly Question[],
  evidence: readonly ItemAnalysisEvidence[]
): readonly ItemAnalysisRow[];
export function selectItemAnalysis(
  inputOrQuestions: ItemAnalysisInput | readonly Question[],
  suppliedEvidence?: readonly ItemAnalysisEvidence[]
): readonly ItemAnalysisRow[] {
  if (Array.isArray(inputOrQuestions)) {
    return selectFromArrays(inputOrQuestions, suppliedEvidence ?? []);
  }
  if (!isRecord(inputOrQuestions)) {
    return fail(ITEM_ANALYSIS_ERROR_CODES.malformedInput, 'Item-analysis input must contain questions and evidence.');
  }
  return selectFromArrays(inputOrQuestions.questions, inputOrQuestions.evidence);
}

export const calculateItemAnalysis = selectItemAnalysis;
