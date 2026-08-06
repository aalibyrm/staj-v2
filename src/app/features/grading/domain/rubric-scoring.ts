import {
  RUBRIC_ERROR_CODES,
  RubricDomainError,
  createRubric,
  type Rubric,
  type RubricInput
} from '../models/rubric.models';

export type RubricScoringInput = Readonly<{
  readonly rubric: Rubric | RubricInput;
  readonly selectedLevelIds?: Readonly<Record<string, string | null | undefined>>;
}>;

export type RubricCriterionScore = Readonly<{
  readonly criterionId: string;
  readonly selectedLevelId: string | null;
  readonly selectedScore: number;
  readonly maximumScore: number;
  readonly weight: number;
  readonly awardedPoints: number;
  readonly complete: boolean;
}>;

export type RubricScoringValidationIssue = Readonly<{
  readonly code: 'missing-selection';
  readonly criterionId: string;
  readonly message: string;
}>;

export type RubricScoringResult = Readonly<{
  readonly criterionScores: readonly RubricCriterionScore[];
  readonly total: number;
  readonly maximumPoints: number;
  readonly completion: 'complete' | 'incomplete';
  readonly validationState: 'valid' | 'incomplete';
  readonly validation: Readonly<{
    readonly valid: boolean;
    readonly issues: readonly RubricScoringValidationIssue[];
  }>;
  readonly isComplete: boolean;
  readonly isValid: boolean;
}>;

export type RubricScore = RubricScoringResult;

const ROUNDING_FACTOR = 100;

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const fail = (code: RubricDomainError['code'], message: string, target?: string): never => {
  throw new RubricDomainError(code, message, target);
};

const roundPoints = (value: number): number => {
  const rounded = Math.round((value + Number.EPSILON) * ROUNDING_FACTOR) / ROUNDING_FACTOR;
  return Object.is(rounded, -0) ? 0 : rounded;
};

const selectionMap = (value: unknown): UnknownRecord => {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return fail(RUBRIC_ERROR_CODES.invalidSelection, 'selectedLevelIds must be an object.', 'selectedLevelIds');
  return value;
};

/** Calculates every rubric criterion from immutable rubric data without mutating either input. */
export const selectRubricScore = (input: RubricScoringInput): RubricScoringResult => {
  if (!isRecord(input)) {
    return fail(RUBRIC_ERROR_CODES.malformedInput, 'Rubric scoring input must be an object.', 'input');
  }
  const rubric = createRubric(input['rubric'] as RubricInput);
  const selections = selectionMap(input['selectedLevelIds']);
  const criterionIds = new Set(rubric.criteria.map((criterion) => criterion.id));
  for (const key of Object.keys(selections)) {
    if (!criterionIds.has(key)) {
      return fail(
        RUBRIC_ERROR_CODES.unknownSelection,
        `selectedLevelIds references unknown criterion ${key}.`,
        `selectedLevelIds.${key}`
      );
    }
  }

  let total = 0;
  let complete = true;
  const issues: RubricScoringValidationIssue[] = [];
  const criterionScores: RubricCriterionScore[] = [];
  for (const criterion of rubric.criteria) {
    const rawSelection = selections[criterion.id];
    if (rawSelection === undefined || rawSelection === null || rawSelection === '') {
      complete = false;
      issues.push(Object.freeze({
        code: 'missing-selection',
        criterionId: criterion.id,
        message: `Select a level for ${criterion.title}.`
      }));
      criterionScores.push(Object.freeze({
        criterionId: criterion.id,
        selectedLevelId: null,
        selectedScore: 0,
        maximumScore: criterion.maxScore,
        weight: criterion.weight,
        awardedPoints: 0,
        complete: false
      }));
      continue;
    }
    if (typeof rawSelection !== 'string' || rawSelection.trim().length === 0) {
      return fail(
        RUBRIC_ERROR_CODES.invalidSelection,
        `Selection for ${criterion.id} must be a level id or null.`,
        `selectedLevelIds.${criterion.id}`
      );
    }
    const selectedLevelId = rawSelection.trim();
    const selectedLevel = criterion.levels.find((level) => level.id === selectedLevelId);
    if (selectedLevel === undefined) {
      return fail(
        RUBRIC_ERROR_CODES.unknownSelection,
        `Selection for ${criterion.id} references unknown level ${selectedLevelId}.`,
        `selectedLevelIds.${criterion.id}`
      );
    }
    const rawPoints = (selectedLevel.score / criterion.maxScore) * criterion.weight * rubric.maximumPoints;
    const boundedPoints = Math.min(rubric.maximumPoints, Math.max(0, rawPoints));
    const awardedPoints = roundPoints(boundedPoints);
    total += awardedPoints;
    criterionScores.push(Object.freeze({
      criterionId: criterion.id,
      selectedLevelId,
      selectedScore: selectedLevel.score,
      maximumScore: criterion.maxScore,
      weight: criterion.weight,
      awardedPoints,
      complete: true
    }));
  }

  const boundedTotal = Math.min(rubric.maximumPoints, Math.max(0, roundPoints(total)));
  const frozenIssues = Object.freeze(issues);
  const validation = Object.freeze({
    valid: complete,
    issues: frozenIssues
  });
  return Object.freeze({
    criterionScores: Object.freeze(criterionScores),
    total: boundedTotal,
    maximumPoints: rubric.maximumPoints,
    completion: complete ? 'complete' : 'incomplete',
    validationState: complete ? 'valid' : 'incomplete',
    validation,
    isComplete: complete,
    isValid: complete
  });
};

export const scoreRubric = selectRubricScore;
export const calculateRubricScore = selectRubricScore;
export const selectRubricTotal = selectRubricScore;
