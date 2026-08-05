import {
  QUESTION_DIFFICULTIES,
  QUESTION_TYPES,
  type QuestionDifficulty,
  type QuestionType
} from '../../question-bank/models/question.models';
import type { LearningOutcomeId } from '../../adaptive-learning/models/seed-domain.models';

export type ExamBlueprintBucketInput<Key extends string = string> = Readonly<{
  readonly key: Key;
  readonly targetQuestionCount: number;
  readonly targetPoints: number;
}>;

export type ExamBlueprintBucket<Key extends string = string> = ExamBlueprintBucketInput<Key>;

export type ExamBlueprintOutcomeBucketInput = ExamBlueprintBucketInput<LearningOutcomeId>;
export type ExamBlueprintDifficultyBucketInput = ExamBlueprintBucketInput<QuestionDifficulty>;
export type ExamBlueprintQuestionTypeBucketInput = ExamBlueprintBucketInput<QuestionType>;

export type ExamBlueprintOutcomeBucket = ExamBlueprintBucket<LearningOutcomeId>;
export type ExamBlueprintDifficultyBucket = ExamBlueprintBucket<QuestionDifficulty>;
export type ExamBlueprintQuestionTypeBucket = ExamBlueprintBucket<QuestionType>;

export type ExamBlueprintInput = Readonly<{
  readonly targetQuestionCount: number;
  readonly targetPoints: number;
  readonly outcomeBuckets: readonly ExamBlueprintOutcomeBucketInput[];
  readonly difficultyBuckets: readonly ExamBlueprintDifficultyBucketInput[];
  readonly questionTypeBuckets: readonly ExamBlueprintQuestionTypeBucketInput[];
}>;

export type ExamBlueprint = Readonly<{
  readonly targetQuestionCount: number;
  readonly targetPoints: number;
  readonly outcomeBuckets: readonly ExamBlueprintOutcomeBucket[];
  readonly difficultyBuckets: readonly ExamBlueprintDifficultyBucket[];
  readonly questionTypeBuckets: readonly ExamBlueprintQuestionTypeBucket[];
}>;

export type ExamBlueprintValidationIssueCode =
  | 'invalid-target-question-count'
  | 'invalid-target-points'
  | 'distribution-required'
  | 'invalid-blueprint'
  | 'invalid-bucket'
  | 'blank-bucket-key'
  | 'noncanonical-bucket-key'
  | 'duplicate-bucket-key'
  | 'invalid-bucket-question-count'
  | 'invalid-bucket-points'
  | 'question-count-total-mismatch'
  | 'points-total-mismatch';

export type ExamBlueprintValidationIssue = Readonly<{
  readonly code: ExamBlueprintValidationIssueCode;
  readonly path: string;
  readonly message: string;
}>;

const POINT_DECIMAL_PLACES = 6;

type DistributionName = 'outcomeBuckets' | 'difficultyBuckets' | 'questionTypeBuckets';
type DistributionKind = 'outcome' | 'difficulty' | 'questionType';

type UnknownRecord = Record<string, unknown>;


const issue = (
  code: ExamBlueprintValidationIssueCode,
  path: string,
  message: string
): ExamBlueprintValidationIssue => Object.freeze({ code, path, message });

const normalizeKey = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const stablePointUnits = (value: number): bigint | null => {
  if (!Number.isFinite(value) || value <= 0) return null;

  const [coefficient, exponentText] = value.toString().toLowerCase().split('e');
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  const [whole, fractional = ''] = coefficient.split('.');
  const digits = `${whole}${fractional}`.replace(/^0+/, '') || '0';
  const decimalShift = exponent - fractional.length + POINT_DECIMAL_PLACES;
  const integer = BigInt(digits);

  if (decimalShift >= 0) return integer * 10n ** BigInt(decimalShift);

  const divisor = 10n ** BigInt(-decimalShift);
  const quotient = integer / divisor;
  const remainder = integer % divisor;
  return remainder * 2n >= divisor ? quotient + 1n : quotient;
};

const pointTotal = (values: readonly number[]): bigint | null => {
  let total = 0n;
  for (const value of values) {
    const units = stablePointUnits(value);
    if (units === null) return null;
    total += units;
  }
  return total;
};

const distributionLabel = (name: DistributionName): string =>
  name === 'outcomeBuckets' ? 'Outcome' : name === 'difficultyBuckets' ? 'Difficulty' : 'Question-type';

const isCanonicalKey = (kind: DistributionKind, key: string): boolean => {
  if (kind === 'outcome') return key.length > 0;
  if (kind === 'difficulty') return (QUESTION_DIFFICULTIES as readonly string[]).includes(key);
  return (QUESTION_TYPES as readonly string[]).includes(key);
};

const validateDistribution = (
  input: UnknownRecord,
  name: DistributionName,
  kind: DistributionKind,
  targetQuestionCount: number | null,
  targetPoints: number | null,
  issues: ExamBlueprintValidationIssue[]
): void => {
  const label = distributionLabel(name);
  const rawDistribution = input[name];
  if (!Array.isArray(rawDistribution) || rawDistribution.length === 0) {
    issues.push(
      issue(
        !Array.isArray(rawDistribution) ? 'distribution-required' : 'distribution-required',
        name,
        `${label} distribution must contain at least one bucket.`
      )
    );
    return;
  }

  const seenKeys = new Set<string>();
  let questionCountTotal = 0n;
  let questionCountValuesValid = true;
  const pointValues: number[] = [];

  rawDistribution.forEach((rawBucket, index) => {
    const path = `${name}[${index}]`;
    if (rawBucket === null || typeof rawBucket !== 'object' || Array.isArray(rawBucket)) {
      issues.push(issue('invalid-bucket', path, `${label} bucket must be an object.`));
      return;
    }
    const bucket = rawBucket as UnknownRecord;

    const key = normalizeKey(bucket['key']);
    if (key.length === 0) {
      issues.push(issue('blank-bucket-key', `${path}.key`, `${label} bucket key must be nonblank.`));
    } else if (!isCanonicalKey(kind, key)) {
      issues.push(issue('noncanonical-bucket-key', `${path}.key`, `${label} bucket key is not canonical.`));
    } else if (seenKeys.has(key)) {
      issues.push(issue('duplicate-bucket-key', `${path}.key`, `${label} bucket keys must be unique.`));
    } else {
      seenKeys.add(key);
    }

    const bucketQuestionCount = bucket['targetQuestionCount'];
    if (typeof bucketQuestionCount !== 'number' || !Number.isSafeInteger(bucketQuestionCount) || bucketQuestionCount <= 0) {
      issues.push(
        issue(
          'invalid-bucket-question-count',
          `${path}.targetQuestionCount`,
          `${label} bucket question count must be a positive safe integer.`
        )
      );
      questionCountValuesValid = false;
    } else {
      questionCountTotal += BigInt(bucketQuestionCount);
    }

    const bucketPoints = bucket['targetPoints'];
    if (typeof bucketPoints !== 'number' || !Number.isFinite(bucketPoints) || bucketPoints <= 0) {
      issues.push(
        issue(
          'invalid-bucket-points',
          `${path}.targetPoints`,
          `${label} bucket points must be finite and greater than zero.`
        )
      );
    } else {
      pointValues.push(bucketPoints);
    }
  });

  if (targetQuestionCount !== null && questionCountValuesValid && questionCountTotal !== BigInt(targetQuestionCount)) {
    issues.push(
      issue(
        'question-count-total-mismatch',
        `${name}.questionCountTotal`,
        `${label} bucket question counts must sum to target question count ${targetQuestionCount}.`
      )
    );
  }

  const totalPoints = pointTotal(pointValues);
  const expectedPoints = targetPoints === null ? null : stablePointUnits(targetPoints);
  if (totalPoints !== null && expectedPoints !== null && totalPoints !== expectedPoints) {
    issues.push(
      issue(
        'points-total-mismatch',
        `${name}.pointsTotal`,
        `${label} bucket points must sum to target points ${targetPoints}.`
      )
    );
  }
};

export const validateExamBlueprint = (input: unknown): readonly ExamBlueprintValidationIssue[] => {
  const issues: ExamBlueprintValidationIssue[] = [];
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return Object.freeze([
      issue('invalid-blueprint', '', 'Blueprint must be an object.')
    ]);
  }
  const source = input as UnknownRecord;

  const targetQuestionCount = source['targetQuestionCount'];
  if (
    typeof targetQuestionCount !== 'number' ||
    !Number.isSafeInteger(targetQuestionCount) ||
    targetQuestionCount <= 0
  ) {
    issues.push(
      issue(
        'invalid-target-question-count',
        'targetQuestionCount',
        'Target question count must be a positive safe integer.'
      )
    );
  }

  const targetPoints = source['targetPoints'];
  if (typeof targetPoints !== 'number' || !Number.isFinite(targetPoints) || targetPoints <= 0) {
    issues.push(
      issue(
        'invalid-target-points',
        'targetPoints',
        'Target points must be finite and greater than zero.'
      )
    );
  }

  const safeTargetQuestionCount =
    typeof targetQuestionCount === 'number' && Number.isSafeInteger(targetQuestionCount) && targetQuestionCount > 0
      ? targetQuestionCount
      : null;
  const safeTargetPoints =
    typeof targetPoints === 'number' && Number.isFinite(targetPoints) && targetPoints > 0
      ? targetPoints
      : null;

  validateDistribution(source, 'outcomeBuckets', 'outcome', safeTargetQuestionCount, safeTargetPoints, issues);
  validateDistribution(source, 'difficultyBuckets', 'difficulty', safeTargetQuestionCount, safeTargetPoints, issues);
  validateDistribution(source, 'questionTypeBuckets', 'questionType', safeTargetQuestionCount, safeTargetPoints, issues);

  return Object.freeze(issues);
};

const deepFreeze = <T>(value: T): T => {
  if (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    !Object.isFrozen(value)
  ) {
    Object.freeze(value);
    for (const key of Reflect.ownKeys(value)) {
      deepFreeze((value as unknown as Record<PropertyKey, unknown>)[key]);
    }
  }
  return value;
};

const normalizedBucket = <Key extends string>(source: UnknownRecord): ExamBlueprintBucket<Key> => ({
  key: normalizeKey(source['key']) as Key,
  targetQuestionCount: source['targetQuestionCount'] as number,
  targetPoints: source['targetPoints'] as number
});

export const createExamBlueprint = (input: unknown): ExamBlueprint | null => {
  if (validateExamBlueprint(input).length > 0 || input === null || typeof input !== 'object' || Array.isArray(input)) return null;

  const source = input as UnknownRecord;
  return deepFreeze({
    targetQuestionCount: source['targetQuestionCount'] as number,
    targetPoints: source['targetPoints'] as number,
    outcomeBuckets: (source['outcomeBuckets'] as readonly UnknownRecord[]).map(
      (bucket) => normalizedBucket<LearningOutcomeId>(bucket)
    ),
    difficultyBuckets: (source['difficultyBuckets'] as readonly UnknownRecord[]).map(
      (bucket) => normalizedBucket<QuestionDifficulty>(bucket)
    ),
    questionTypeBuckets: (source['questionTypeBuckets'] as readonly UnknownRecord[]).map(
      (bucket) => normalizedBucket<QuestionType>(bucket)
    )
  } satisfies ExamBlueprint);
};
