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
export type ExamBlueprintCoverageBucketInput<Key extends string = string> = Readonly<{
  readonly key: Key;
  readonly currentQuestionCount: number;
  readonly currentPoints: number;
}>;

export type ExamBlueprintCoverageBucket<Key extends string = string> = ExamBlueprintCoverageBucketInput<Key>;

export type ExamBlueprintCurrentCoverageInput = Readonly<{
  readonly outcomeBuckets: readonly ExamBlueprintCoverageBucketInput<LearningOutcomeId>[];
  readonly difficultyBuckets: readonly ExamBlueprintCoverageBucketInput<QuestionDifficulty>[];
  readonly questionTypeBuckets: readonly ExamBlueprintCoverageBucketInput<QuestionType>[];
}>;

export type ExamBlueprintCurrentCoverage = ExamBlueprintCurrentCoverageInput;
export type ExamBlueprintComparisonAggregateStatus = 'valid' | 'partial' | 'missing';
export type ExamBlueprintBucketComparisonStatus = 'met' | 'missing' | 'excess';
export type ExamBlueprintComparisonDimension = 'outcome' | 'difficulty' | 'questionType';

export type ExamBlueprintBucketComparison<Key extends string = string> = Readonly<{
  readonly key: Key;
  readonly targetQuestionCount: number;
  readonly currentQuestionCount: number;
  readonly targetPoints: number;
  readonly currentPoints: number;
  readonly questionCountDelta: number;
  readonly pointsDelta: number;
  readonly remainingQuestionCount: number;
  readonly excessQuestionCount: number;
  readonly remainingPoints: number;
  readonly excessPoints: number;
  readonly status: ExamBlueprintBucketComparisonStatus;
  readonly reason: string;
}>;

export type ExamBlueprintDimensionComparison<Key extends string = string> = Readonly<{
  readonly dimension: ExamBlueprintComparisonDimension;
  readonly buckets: readonly ExamBlueprintBucketComparison<Key>[];
}>;

export type ExamBlueprintComparison = Readonly<{
  readonly status: ExamBlueprintComparisonAggregateStatus;
  readonly outcomeBuckets: readonly ExamBlueprintBucketComparison<LearningOutcomeId>[];
  readonly difficultyBuckets: readonly ExamBlueprintBucketComparison<QuestionDifficulty>[];
  readonly questionTypeBuckets: readonly ExamBlueprintBucketComparison<QuestionType>[];
  readonly dimensions: readonly [
    ExamBlueprintDimensionComparison<LearningOutcomeId>,
    ExamBlueprintDimensionComparison<QuestionDifficulty>,
    ExamBlueprintDimensionComparison<QuestionType>
  ];
  readonly summary: string;
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
const POINT_DECIMAL_SCALE = 10 ** POINT_DECIMAL_PLACES;

const coverageCount = (value: number): number =>
  Number.isSafeInteger(value) && value >= 0 ? value : 0;

const coveragePointUnits = (value: number): bigint =>
  Number.isFinite(value) && value >= 0 ? stablePointUnits(value) ?? 0n : 0n;

const coveragePoint = (units: bigint): number => Number(units) / POINT_DECIMAL_SCALE;

const formatCoverageNumber = (value: number): string =>
  value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: POINT_DECIMAL_PLACES });

const coverageReason = (questionCountDelta: number, pointsDelta: number): string => {
  const reasons: string[] = [];
  if (questionCountDelta < 0) {
    const amount = -questionCountDelta;
    reasons.push(`${amount} question${amount === 1 ? '' : 's'} missing`);
  } else if (questionCountDelta > 0) {
    reasons.push(`${questionCountDelta} question${questionCountDelta === 1 ? '' : 's'} excess`);
  }
  if (pointsDelta < 0) {
    reasons.push(`${formatCoverageNumber(-pointsDelta)} point${pointsDelta === -1 ? '' : 's'} missing`);
  } else if (pointsDelta > 0) {
    reasons.push(`${formatCoverageNumber(pointsDelta)} point${pointsDelta === 1 ? '' : 's'} excess`);
  }
  return reasons.length === 0 ? 'Target and current coverage match.' : `${reasons.join('; ')}.`;
};

const compareDimension = <Key extends string>(
  dimension: ExamBlueprintComparisonDimension,
  targetBuckets: readonly ExamBlueprintBucketInput<Key>[],
  currentBuckets: readonly ExamBlueprintCoverageBucketInput<Key>[]
): readonly ExamBlueprintBucketComparison<Key>[] => {
  const currentByKey = new Map<Key, { questionCount: number; pointUnits: bigint }>();
  for (const current of currentBuckets) {
    const previous = currentByKey.get(current.key);
    const questionCount = coverageCount(current.currentQuestionCount) + (previous?.questionCount ?? 0);
    const pointUnits = coveragePointUnits(current.currentPoints) + (previous?.pointUnits ?? 0n);
    currentByKey.set(current.key, { questionCount, pointUnits });
  }

  const targetKeys = new Set<Key>();
  const rows: ExamBlueprintBucketComparison<Key>[] = [];
  const append = (key: Key, targetQuestionCount: number, targetPointUnits: bigint): void => {
    const current = currentByKey.get(key);
    const currentQuestionCount = current?.questionCount ?? 0;
    const currentPointUnits = current?.pointUnits ?? 0n;
    const normalizedTargetPoints = coveragePoint(targetPointUnits);
    const normalizedCurrentPoints = coveragePoint(currentPointUnits);
    const questionCountDelta = currentQuestionCount - targetQuestionCount;
    const pointDeltaUnits = currentPointUnits - targetPointUnits;
    const pointsDelta = coveragePoint(pointDeltaUnits);
    const status: ExamBlueprintBucketComparisonStatus =
      questionCountDelta === 0 && pointDeltaUnits === 0n
        ? 'met'
        : questionCountDelta < 0 || pointDeltaUnits < 0n
          ? 'missing'
          : 'excess';
    rows.push({
      key,
      targetQuestionCount,
      currentQuestionCount,
      targetPoints: normalizedTargetPoints,
      currentPoints: normalizedCurrentPoints,
      questionCountDelta,
      pointsDelta,
      remainingQuestionCount: -questionCountDelta,
      excessQuestionCount: questionCountDelta,
      remainingPoints: -pointsDelta,
      excessPoints: pointsDelta,
      status,
      reason: coverageReason(questionCountDelta, pointsDelta)
    });
  };

  for (const target of targetBuckets) {
    targetKeys.add(target.key);
    append(target.key, target.targetQuestionCount, coveragePointUnits(target.targetPoints));
  }
  [...currentByKey.keys()]
    .filter((key) => !targetKeys.has(key))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .forEach((key) => append(key, 0, 0n));
  return deepFreeze(rows);
};

export const compareExamBlueprint = (
  target: ExamBlueprint,
  current: ExamBlueprintCurrentCoverageInput
): ExamBlueprintComparison => {
  const outcomeBuckets = compareDimension('outcome', target.outcomeBuckets, current.outcomeBuckets);
  const difficultyBuckets = compareDimension('difficulty', target.difficultyBuckets, current.difficultyBuckets);
  const questionTypeBuckets = compareDimension('questionType', target.questionTypeBuckets, current.questionTypeBuckets);
  const dimensions = [
    { dimension: 'outcome' as const, buckets: outcomeBuckets },
    { dimension: 'difficulty' as const, buckets: difficultyBuckets },
    { dimension: 'questionType' as const, buckets: questionTypeBuckets }
  ] as const;
  const allRows = [...outcomeBuckets, ...difficultyBuckets, ...questionTypeBuckets];
  const currentIsEmpty = allRows.every(
    (row) => row.currentQuestionCount === 0 && row.currentPoints === 0
  );
  const allMet = allRows.every((row) => row.status === 'met');
  const status: ExamBlueprintComparisonAggregateStatus = allMet
    ? 'valid'
    : currentIsEmpty
      ? 'missing'
      : 'partial';
  const summary =
    status === 'valid'
      ? 'All target count and point constraints are met.'
      : status === 'missing'
        ? 'No current coverage is selected; all target buckets are missing.'
        : 'Current coverage is partial; review each missing or excess reason.';
  return deepFreeze({
    status,
    outcomeBuckets,
    difficultyBuckets,
    questionTypeBuckets,
    dimensions,
    summary
  });
};

export const compareExamBlueprintCoverage = compareExamBlueprint;
