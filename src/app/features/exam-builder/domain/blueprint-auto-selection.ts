import {
  QUESTION_DIFFICULTIES,
  QUESTION_TYPES,
  type QuestionDifficulty,
  type QuestionId,
  type QuestionType,
  type QuestionVersionId
} from '../../question-bank/models/question.models';
import type { LearningOutcomeId } from '../../adaptive-learning/models/seed-domain.models';
import type { ExamBlueprint } from '../models/exam-blueprint.models';

const POINT_DECIMAL_PLACES = 6;
const POINT_SCALE = 10n ** BigInt(POINT_DECIMAL_PLACES);
const COVERAGE_SCALE = 1_000_000_000_000_000_000n;

export type BlueprintSelectionDimension = 'overall' | 'outcome' | 'difficulty' | 'questionType';


type SelectionConstraint = Readonly<{
  readonly dimension: BlueprintSelectionDimension;
  readonly key?: string;
  readonly targetCount: number;
  readonly targetPoints: bigint;
}>;

type PreparedCandidate = {
  readonly candidate: BlueprintSelectionCandidate;
  readonly pointUnits: bigint;
  readonly countIndices: readonly number[];
};

type CandidateGroup = readonly PreparedCandidate[];

type BucketIndexMaps = {
  readonly outcome: Map<string, number>;
  readonly difficulty: Map<string, number>;
  readonly questionType: Map<string, number>;
};

const compareText = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;

/**
 * A frozen published question-version snapshot that can participate in selection.
 * The stable question identity is separate from the pinned immutable version identity.
 */
export type BlueprintSelectionCandidate = Readonly<{
  readonly questionId: QuestionId;
  readonly versionId: QuestionVersionId;
  readonly status: 'published';
  readonly outcomeId: LearningOutcomeId;
  readonly difficulty: QuestionDifficulty;
  readonly type: QuestionType;
  readonly points: number;
}>;

export type BlueprintSelectionUnmetReason = Readonly<{
  readonly dimension: BlueprintSelectionDimension;
  readonly key?: string;
  readonly missingCount: number;
  readonly missingPoints: number;
  readonly message: string;
}>;

export type BlueprintSelectionResult = Readonly<{
  readonly status: 'complete' | 'partial';
  readonly selected: readonly BlueprintSelectionCandidate[];
  readonly unmetReasons: readonly BlueprintSelectionUnmetReason[];
}>;


const stablePointUnits = (value: unknown): bigint | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;

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

const pointFromUnits = (units: bigint): number => {
  const value = Number(units) / Number(POINT_SCALE);
  return Number.isFinite(value) ? value : Number.MAX_VALUE;
};

const formatPointUnits = (units: bigint): string => {
  const whole = units / POINT_SCALE;
  const fractional = (units % POINT_SCALE).toString().padStart(POINT_DECIMAL_PLACES, '0').replace(/0+$/, '');
  return fractional.length === 0 ? whole.toString() : `${whole.toString()}.${fractional}`;
};

const isQuestionDifficulty = (value: unknown): value is QuestionDifficulty =>
  typeof value === 'string' && (QUESTION_DIFFICULTIES as readonly string[]).includes(value);

const isQuestionType = (value: unknown): value is QuestionType =>
  typeof value === 'string' && (QUESTION_TYPES as readonly string[]).includes(value);

const isNonblankString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.trim().length > 0;

const normalizedTargetCount = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;

const normalizedTargetPoints = (value: unknown): bigint => stablePointUnits(value) ?? 0n;

const normalizedBuckets = (
  value: unknown,
  dimension: Exclude<BlueprintSelectionDimension, 'overall'>
): readonly SelectionConstraint[] => {
  if (!Array.isArray(value)) return [];

  const buckets: SelectionConstraint[] = [];
  for (const rawBucket of value) {
    if (rawBucket === null || typeof rawBucket !== 'object' || Array.isArray(rawBucket)) continue;
    const bucket = rawBucket as Record<string, unknown>;
    const key = bucket['key'];
    if (!isNonblankString(key)) continue;
    const targetCount = normalizedTargetCount(bucket['targetQuestionCount']);
    const targetPoints = normalizedTargetPoints(bucket['targetPoints']);
    buckets.push({
      dimension,
      key,
      targetCount,
      targetPoints
    });
  }
  buckets.sort((left, right) => compareText(left.key ?? '', right.key ?? ''));
  return buckets;
};

const constraintsFor = (blueprint: ExamBlueprint): readonly SelectionConstraint[] => [
  {
    dimension: 'overall',
    targetCount: normalizedTargetCount(blueprint.targetQuestionCount),
    targetPoints: normalizedTargetPoints(blueprint.targetPoints)
  },
  ...normalizedBuckets(blueprint.outcomeBuckets, 'outcome'),
  ...normalizedBuckets(blueprint.difficultyBuckets, 'difficulty'),
  ...normalizedBuckets(blueprint.questionTypeBuckets, 'questionType')
];

const identityKey = (candidate: BlueprintSelectionCandidate): string =>
  JSON.stringify([
    candidate.questionId,
    candidate.versionId,
    candidate.status,
    candidate.outcomeId,
    candidate.difficulty,
    candidate.type,
    String(candidate.points)
  ]);

const comparePreparedCandidates = (left: PreparedCandidate, right: PreparedCandidate): number => {
  const leftCandidate = left.candidate;
  const rightCandidate = right.candidate;
  const fields: readonly (keyof BlueprintSelectionCandidate)[] = [
    'questionId',
    'versionId',
    'outcomeId',
    'difficulty',
    'type'
  ];
  for (const field of fields) {
    const comparison = compareText(String(leftCandidate[field]), String(rightCandidate[field]));
    if (comparison !== 0) return comparison;
  }
  if (left.pointUnits < right.pointUnits) return -1;
  if (left.pointUnits > right.pointUnits) return 1;
  return compareText(String(leftCandidate.points), String(rightCandidate.points));
};

const prepareCandidate = (
  rawCandidate: unknown,
  constraints: readonly SelectionConstraint[],
  bucketIndexes: BucketIndexMaps
): PreparedCandidate | null => {
  if (rawCandidate === null || typeof rawCandidate !== 'object' || Array.isArray(rawCandidate)) return null;
  const candidate = rawCandidate as Record<string, unknown>;
  const questionId = candidate['questionId'];
  const versionId = candidate['versionId'];
  const status = candidate['status'];
  const outcomeId = candidate['outcomeId'];
  const difficulty = candidate['difficulty'];
  const type = candidate['type'];
  const points = candidate['points'];
  if (
    !isNonblankString(questionId) ||
    !isNonblankString(versionId) ||
    status !== 'published' ||
    !isNonblankString(outcomeId) ||
    !isQuestionDifficulty(difficulty) ||
    !isQuestionType(type)
  ) {
    return null;
  }

  const pointUnits = stablePointUnits(points);
  if (pointUnits === null) return null;

  const outcomeIndex = bucketIndexes.outcome.get(outcomeId);
  const difficultyIndex = bucketIndexes.difficulty.get(difficulty);
  const questionTypeIndex = bucketIndexes.questionType.get(type);
  if (outcomeIndex === undefined || difficultyIndex === undefined || questionTypeIndex === undefined) return null;

  const countIndices = [0, outcomeIndex, difficultyIndex, questionTypeIndex];
  if (countIndices.some((index) => {
    const constraint = constraints[index];
    return constraint === undefined || constraint.targetCount < 1;
  })) return null;
  if (countIndices.some((index) => {
    const constraint = constraints[index];
    return constraint === undefined || pointUnits > constraint.targetPoints;
  })) return null;

  return {
    candidate: {
      questionId: questionId as QuestionId,
      versionId: versionId as QuestionVersionId,
      status: 'published',
      outcomeId: outcomeId as LearningOutcomeId,
      difficulty,
      type,
      points: points as number
    },
    pointUnits,
    countIndices
  };
};

const prepareGroups = (
  candidates: unknown,
  constraints: readonly SelectionConstraint[],
  bucketIndexes: BucketIndexMaps
): readonly CandidateGroup[] => {
  const rows = Array.isArray(candidates) ? candidates : [];
  const unique = new Map<string, PreparedCandidate>();
  for (const rawCandidate of rows) {
    const prepared = prepareCandidate(rawCandidate, constraints, bucketIndexes);
    if (prepared !== null) unique.set(identityKey(prepared.candidate), prepared);
  }

  const groups = new Map<string, PreparedCandidate[]>();
  for (const prepared of unique.values()) {
    const key = String(prepared.candidate.questionId);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [prepared]);
    else group.push(prepared);
  }

  const orderedGroups = [...groups.entries()].sort(([left], [right]) => compareText(left, right));
  return orderedGroups.map(([, group]) => {
    group.sort(comparePreparedCandidates);
    return group;
  });
};

const stateKey = (
  groupIndex: number,
  counts: readonly number[],
  points: readonly bigint[]
): string => `${groupIndex}|${counts.join(',')}|${points.map((value) => value.toString()).join(',')}`;

const applyCandidate = (
  prepared: PreparedCandidate,
  counts: number[],
  points: bigint[],
  direction: 1 | -1
): void => {
  for (const index of prepared.countIndices) {
    counts[index] += direction;
    points[index] += direction === 1 ? prepared.pointUnits : -prepared.pointUnits;
  }
};

const candidateFits = (
  prepared: PreparedCandidate,
  counts: readonly number[],
  points: readonly bigint[],
  targetCounts: readonly number[],
  targetPoints: readonly bigint[]
): boolean => prepared.countIndices.every((index) =>
  counts[index] + 1 <= targetCounts[index] && points[index] + prepared.pointUnits <= targetPoints[index]
);

const exactState = (
  counts: readonly number[],
  points: readonly bigint[],
  targetCounts: readonly number[],
  targetPoints: readonly bigint[]
): boolean => targetCounts.every((target, index) => counts[index] === target && points[index] === targetPoints[index]);

const coverageScore = (
  counts: readonly number[],
  points: readonly bigint[],
  targetCounts: readonly number[],
  targetPoints: readonly bigint[],
  suffixCounts?: readonly number[],
  suffixPoints?: readonly bigint[]
): bigint => {
  let score = 0n;
  for (let index = 0; index < targetCounts.length; index += 1) {
    const countTarget = BigInt(targetCounts[index]);
    const pointTarget = targetPoints[index];
    const countValue = suffixCounts === undefined
      ? counts[index]
      : Math.min(targetCounts[index], counts[index] + suffixCounts[index]);
    const pointValue = suffixPoints === undefined
      ? points[index]
      : (() => {
        const upper = points[index] + suffixPoints[index];
        return upper < pointTarget ? upper : pointTarget;
      })();

    score += countTarget === 0n
      ? COVERAGE_SCALE
      : BigInt(countValue) * COVERAGE_SCALE / countTarget;
    score += pointTarget === 0n
      ? COVERAGE_SCALE
      : pointValue * COVERAGE_SCALE / pointTarget;
  }
  return score;
};

const compareCandidatePaths = (
  left: readonly PreparedCandidate[],
  right: readonly PreparedCandidate[]
): number => {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const comparison = comparePreparedCandidates(left[index], right[index]);
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
};

const missingReasonMessage = (
  constraint: SelectionConstraint,
  missingCount: number,
  missingPoints: bigint
): string => {
  const label = constraint.dimension === 'overall'
    ? 'Overall blueprint coverage'
    : `${constraint.dimension} bucket "${constraint.key ?? ''}"`;
  const fragments: string[] = [];
  if (missingCount > 0) {
    fragments.push(`${missingCount} question${missingCount === 1 ? '' : 's'} missing`);
  }
  if (missingPoints > 0n) {
    fragments.push(`${formatPointUnits(missingPoints)} point${missingPoints === 1n ? '' : 's'} missing`);
  }
  return `${label}: ${fragments.join('; ')}.`;
};

const unmetReasonsFor = (
  constraints: readonly SelectionConstraint[],
  counts: readonly number[],
  points: readonly bigint[],
  targetCounts: readonly number[],
  targetPoints: readonly bigint[]
): readonly BlueprintSelectionUnmetReason[] => {
  const reasons: BlueprintSelectionUnmetReason[] = [];
  for (let index = 0; index < constraints.length; index += 1) {
    const missingCount = Math.max(0, targetCounts[index] - counts[index]);
    const missingPointUnits = targetPoints[index] > points[index] ? targetPoints[index] - points[index] : 0n;
    if (missingCount === 0 && missingPointUnits === 0n) continue;
    const constraint = constraints[index];
    reasons.push(Object.freeze({
      dimension: constraint.dimension,
      ...(constraint.key === undefined ? {} : { key: constraint.key }),
      missingCount,
      missingPoints: pointFromUnits(missingPointUnits),
      message: missingReasonMessage(constraint, missingCount, missingPointUnits)
    }));
  }
  return Object.freeze(reasons);
};

const outwardCandidate = (prepared: PreparedCandidate): BlueprintSelectionCandidate => Object.freeze({
  questionId: prepared.candidate.questionId,
  versionId: prepared.candidate.versionId,
  status: 'published',
  outcomeId: prepared.candidate.outcomeId,
  difficulty: prepared.candidate.difficulty,
  type: prepared.candidate.type,
  points: prepared.candidate.points
});

/**
 * Selects a deterministic non-duplicating set. Exact search explores every valid
 * candidate-version choice with memoized states and suffix capacity pruning.
 *
 * Partial ranking is deterministic: maximize the sum of fixed-point normalized
 * count and point coverage for every overall and bucket constraint; then maximize
 * selected question count and overall points; then choose the lexicographically
 * earliest stable candidate identity sequence. Upper-bound coverage pruning is
 * monotonic, so it cannot discard a better non-exceeding subset.
 */
export const selectQuestionsForBlueprint = (
  blueprint: ExamBlueprint,
  candidates: readonly BlueprintSelectionCandidate[]
): BlueprintSelectionResult => {
  const constraints = constraintsFor(blueprint);
  const targetCounts = constraints.map((constraint) => constraint.targetCount);
  const targetPoints = constraints.map((constraint) => constraint.targetPoints);
  const bucketIndexes: BucketIndexMaps = {
    outcome: new Map(),
    difficulty: new Map(),
    questionType: new Map()
  };
  constraints.forEach((constraint, index) => {
    if (constraint.key === undefined) return;
    if (constraint.dimension === 'outcome') bucketIndexes.outcome.set(constraint.key, index);
    else if (constraint.dimension === 'difficulty') bucketIndexes.difficulty.set(constraint.key, index);
    else if (constraint.dimension === 'questionType') bucketIndexes.questionType.set(constraint.key, index);
  });

  const groups = prepareGroups(candidates, constraints, bucketIndexes);
  const dimensionCount = constraints.length;
  const suffixCounts: number[][] = Array.from(
    { length: groups.length + 1 },
    () => new Array<number>(dimensionCount).fill(0)
  );
  const suffixPoints: bigint[][] = Array.from(
    { length: groups.length + 1 },
    () => new Array<bigint>(dimensionCount).fill(0n)
  );
  for (let groupIndex = groups.length - 1; groupIndex >= 0; groupIndex -= 1) {
    for (let constraintIndex = 0; constraintIndex < dimensionCount; constraintIndex += 1) {
      const nextCount = suffixCounts[groupIndex + 1][constraintIndex];
      const nextPoints = suffixPoints[groupIndex + 1][constraintIndex];
      let groupCount = 0;
      let groupPoints = 0n;
      for (const option of groups[groupIndex]) {
        if (!option.countIndices.includes(constraintIndex)) continue;
        groupCount = 1;
        if (option.pointUnits > groupPoints) groupPoints = option.pointUnits;
      }
      suffixCounts[groupIndex][constraintIndex] = nextCount + groupCount;
      suffixPoints[groupIndex][constraintIndex] = nextPoints + groupPoints;
    }
  }

  const counts = new Array<number>(dimensionCount).fill(0);
  const points = new Array<bigint>(dimensionCount).fill(0n);
  const selectedStack: PreparedCandidate[] = [];

  const canReachExact = (groupIndex: number): boolean => {
    for (let index = 0; index < dimensionCount; index += 1) {
      if (counts[index] > targetCounts[index] || points[index] > targetPoints[index]) return false;
      if (counts[index] + suffixCounts[groupIndex][index] < targetCounts[index]) return false;
      if (points[index] + suffixPoints[groupIndex][index] < targetPoints[index]) return false;
    }
    return true;
  };

  const exactMemo = new Set<string>();
  const findExact = (groupIndex: number): boolean => {
    if (!canReachExact(groupIndex)) return false;
    if (exactState(counts, points, targetCounts, targetPoints)) return true;
    if (groupIndex >= groups.length) return false;

    const key = stateKey(groupIndex, counts, points);
    if (exactMemo.has(key)) return false;
    exactMemo.add(key);

    for (const option of groups[groupIndex]) {
      if (!candidateFits(option, counts, points, targetCounts, targetPoints)) continue;
      applyCandidate(option, counts, points, 1);
      selectedStack.push(option);
      if (findExact(groupIndex + 1)) return true;
      selectedStack.pop();
      applyCandidate(option, counts, points, -1);
    }
    return findExact(groupIndex + 1);
  };

  if (findExact(0)) {
    const selected = Object.freeze(selectedStack.map(outwardCandidate));
    return Object.freeze({ status: 'complete', selected, unmetReasons: Object.freeze([]) });
  }

  let bestScore = -1n;
  let bestCount = -1;
  let bestPoints = -1n;
  let bestPath: readonly PreparedCandidate[] = [];
  const partialMemo = new Set<string>();

  const considerPartial = (): void => {
    const score = coverageScore(counts, points, targetCounts, targetPoints);
    const selectedCount = counts[0];
    const selectedPoints = points[0];
    const isBetter = score > bestScore ||
      (score === bestScore && selectedCount > bestCount) ||
      (score === bestScore && selectedCount === bestCount && selectedPoints > bestPoints) ||
      (score === bestScore && selectedCount === bestCount && selectedPoints === bestPoints && compareCandidatePaths(selectedStack, bestPath) < 0);
    if (!isBetter) return;
    bestScore = score;
    bestCount = selectedCount;
    bestPoints = selectedPoints;
    bestPath = selectedStack.slice();
  };

  const searchPartial = (groupIndex: number): void => {
    const key = stateKey(groupIndex, counts, points);
    if (partialMemo.has(key)) return;
    partialMemo.add(key);

    considerPartial();
    const upperScore = coverageScore(
      counts,
      points,
      targetCounts,
      targetPoints,
      suffixCounts[groupIndex],
      suffixPoints[groupIndex]
    );
    if (upperScore < bestScore) return;
    const upperCount = counts[0] + suffixCounts[groupIndex][0];
    if (upperScore === bestScore && upperCount < bestCount) return;
    const upperPoint = points[0] + suffixPoints[groupIndex][0];
    if (upperScore === bestScore && upperCount === bestCount && upperPoint < bestPoints) return;
    if (groupIndex >= groups.length) return;

    for (const option of groups[groupIndex]) {
      if (!candidateFits(option, counts, points, targetCounts, targetPoints)) continue;
      applyCandidate(option, counts, points, 1);
      selectedStack.push(option);
      searchPartial(groupIndex + 1);
      selectedStack.pop();
      applyCandidate(option, counts, points, -1);
    }
    searchPartial(groupIndex + 1);
  };

  searchPartial(0);
  const selected = Object.freeze(bestPath.map(outwardCandidate));
  const unmetReasons = unmetReasonsFor(constraints, countsForPath(bestPath, dimensionCount), pointsForPath(bestPath, dimensionCount), targetCounts, targetPoints);
  return Object.freeze({ status: 'partial', selected, unmetReasons });
};

const countsForPath = (path: readonly PreparedCandidate[], dimensionCount: number): readonly number[] => {
  const counts = new Array<number>(dimensionCount).fill(0);
  for (const prepared of path) {
    for (const index of prepared.countIndices) counts[index] += 1;
  }
  return counts;
};

const pointsForPath = (path: readonly PreparedCandidate[], dimensionCount: number): readonly bigint[] => {
  const points = new Array<bigint>(dimensionCount).fill(0n);
  for (const prepared of path) {
    for (const index of prepared.countIndices) points[index] += prepared.pointUnits;
  }
  return points;
};
