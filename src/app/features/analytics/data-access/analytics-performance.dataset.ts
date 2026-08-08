import { createSeedData } from '../../adaptive-learning/data-access/seed-data.factory';
import type {
  CohortId,
  CourseId,
  LearningOutcomeId,
  SeedCohort,
  SeedCourse,
  SeedLearningOutcome,
  StudentId
} from '../../adaptive-learning/models/seed-domain.models';
import { createMasteryAttempt, type MasteryAttempt } from '../models/mastery.models';

export type AnalyticsPerformancePeriod = '2026-05-18' | '2026-05-24' | '2026-05-31' | '2026-06-07' | '2026-06-14' | '2026-06-18';
export const ANALYTICS_PERFORMANCE_PERIODS: readonly Readonly<{ readonly value: AnalyticsPerformancePeriod; readonly label: string }>[] = Object.freeze([
  Object.freeze({ value: '2026-05-18', label: 'May 18' }),
  Object.freeze({ value: '2026-05-24', label: 'May 24' }),
  Object.freeze({ value: '2026-05-31', label: 'May 31' }),
  Object.freeze({ value: '2026-06-07', label: 'Jun 7' }),
  Object.freeze({ value: '2026-06-14', label: 'Jun 14' }),
  Object.freeze({ value: '2026-06-18', label: 'Jun 18' })
]);

export type AnalyticsPerformanceDateRange = 'all' | 'last-14-days' | 'last-30-days';
export type AnalyticsPerformanceQuery = Readonly<{
  readonly dateRange?: AnalyticsPerformanceDateRange;
  readonly outcomeId?: LearningOutcomeId;
}>;

export type AnalyticsPerformanceRecord = Readonly<{
  readonly studentId: StudentId;
  readonly cohortId: CohortId;
  readonly courseId: CourseId;
  readonly outcomeId: LearningOutcomeId;
  readonly period: AnalyticsPerformancePeriod;
  readonly attempt: MasteryAttempt;
}>;

const SEED = createSeedData();

const BASELINE: readonly number[] = Object.freeze([0.28, 0.36, 0.44, 0.55, 0.63, 0.71]);
const EMPTY_RECORDS: readonly AnalyticsPerformanceRecord[] = Object.freeze([]);
const DATE_RANGE_STARTS: Readonly<Record<AnalyticsPerformanceDateRange, number>> = Object.freeze({
  all: Number.NEGATIVE_INFINITY,
  'last-14-days': Date.parse('2026-06-04T00:00:00.000Z'),
  'last-30-days': Date.parse('2026-05-19T00:00:00.000Z')
});

const coursesById = new Map<CourseId, SeedCourse>(SEED.courses.map((course) => [course.id, course]));
const cohortsById = new Map<CohortId, SeedCohort>(SEED.cohorts.map((cohort) => [cohort.id, cohort]));
const outcomesById = new Map<LearningOutcomeId, SeedLearningOutcome>(SEED.learningOutcomes.map((outcome) => [outcome.id, outcome]));

const accountOffset = (studentId: StudentId): number => studentId.endsWith('-02') ? 0.04 : studentId.endsWith('-03') ? -0.03 : 0;
const difficultyFor = (periodIndex: number): MasteryAttempt['difficulty'] => periodIndex % 3 === 0 ? 'easy' : periodIndex % 3 === 1 ? 'medium' : 'hard';
const clampFraction = (value: number): number => Math.min(1, Math.max(0, value));

const outcomesFor = (course: SeedCourse): readonly SeedLearningOutcome[] => course.learningOutcomeIds.flatMap((outcomeId) => {
  const outcome = outcomesById.get(outcomeId);
  return outcome === undefined || outcome.courseId !== course.id || outcome.status !== 'active' ? [] : [outcome];
});

const buildDataset = (): readonly AnalyticsPerformanceRecord[] => {
  const records: AnalyticsPerformanceRecord[] = [];
  for (const student of SEED.students) {
    const cohort = cohortsById.get(student.cohortId);
    if (cohort === undefined) throw new Error(`Missing cohort for ${student.id}.`);
    const course = coursesById.get(cohort.courseId);
    if (course === undefined) throw new Error(`Missing course for ${cohort.id}.`);
    const outcomes = outcomesFor(course);
    for (const [outcomeIndex, outcome] of outcomes.entries()) {
      for (const [periodIndex, period] of ANALYTICS_PERFORMANCE_PERIODS.entries()) {
        const earnedFraction = clampFraction((BASELINE[periodIndex] ?? 0.5) + outcomeIndex * 0.025 + accountOffset(student.id));
        const attempt = createMasteryAttempt({
          outcomeId: outcome.id,
          questionId: `ANALYTICS-PERFORMANCE-${student.id}-${outcome.id}-${period.value}`,
          difficulty: difficultyFor(periodIndex),
          earnedFraction,
          answeredAt: `${period.value}T10:00:00.000Z`
        });
        records.push(Object.freeze({
          studentId: student.id,
          cohortId: cohort.id,
          courseId: course.id,
          outcomeId: outcome.id,
          period: period.value,
          attempt
        }));
      }
    }
  }
  return Object.freeze(records);
};

export const ANALYTICS_PERFORMANCE_DATASET = buildDataset();
export const ANALYTICS_PERFORMANCE_RECORD_COUNT = ANALYTICS_PERFORMANCE_DATASET.length;

type OutcomeFilter = '' | LearningOutcomeId;
type QueryCache = ReadonlyMap<AnalyticsPerformanceDateRange, ReadonlyMap<OutcomeFilter, readonly AnalyticsPerformanceRecord[]>>;

const buildRecordBuckets = <TId extends string>(ids: readonly TId[], idFor: (record: AnalyticsPerformanceRecord) => TId): ReadonlyMap<TId, readonly AnalyticsPerformanceRecord[]> => {
  const mutable = new Map<TId, AnalyticsPerformanceRecord[]>();
  for (const id of ids) mutable.set(id, []);
  for (const record of ANALYTICS_PERFORMANCE_DATASET) {
    const bucket = mutable.get(idFor(record));
    if (bucket === undefined) throw new Error('Performance record references an unknown index key.');
    bucket.push(record);
  }
  const frozen = new Map<TId, readonly AnalyticsPerformanceRecord[]>();
  for (const [id, records] of mutable) frozen.set(id, Object.freeze([...records]));
  return frozen;
};

const STUDENT_RECORDS = buildRecordBuckets(SEED.students.map((student) => student.id), (record) => record.studentId);
const COHORT_RECORDS = buildRecordBuckets(SEED.cohorts.map((cohort) => cohort.id), (record) => record.cohortId);

const filterRecords = (records: readonly AnalyticsPerformanceRecord[], dateRange: AnalyticsPerformanceDateRange, outcomeId: OutcomeFilter): readonly AnalyticsPerformanceRecord[] => Object.freeze(records.filter((record) => {
  const dateMatches = Date.parse(record.attempt.answeredAt) >= DATE_RANGE_STARTS[dateRange];
  return dateMatches && (outcomeId === '' || record.outcomeId === outcomeId);
}));

const outcomeFiltersFor = (records: readonly AnalyticsPerformanceRecord[]): readonly OutcomeFilter[] => {
  const ids: LearningOutcomeId[] = [];
  for (const record of records) if (!ids.includes(record.outcomeId)) ids.push(record.outcomeId);
  return ['', ...ids];
};

const buildQueryCache = <TId extends string>(
  buckets: ReadonlyMap<TId, readonly AnalyticsPerformanceRecord[]>
): ReadonlyMap<TId, QueryCache> => {
  const cache = new Map<TId, QueryCache>();
  const dateRanges: readonly AnalyticsPerformanceDateRange[] = ['all', 'last-14-days', 'last-30-days'];
  for (const [id, records] of buckets) {
    const byDateRange = new Map<AnalyticsPerformanceDateRange, ReadonlyMap<OutcomeFilter, readonly AnalyticsPerformanceRecord[]>>();
    const outcomeFilters = outcomeFiltersFor(records);
    for (const dateRange of dateRanges) {
      const byOutcome = new Map<OutcomeFilter, readonly AnalyticsPerformanceRecord[]>();
      for (const outcomeId of outcomeFilters) byOutcome.set(outcomeId, filterRecords(records, dateRange, outcomeId));
      byDateRange.set(dateRange, byOutcome);
    }
    cache.set(id, byDateRange);
  }
  return cache;
};

const STUDENT_QUERY_CACHE = buildQueryCache(STUDENT_RECORDS);
const COHORT_QUERY_CACHE = buildQueryCache(COHORT_RECORDS);

const normalizeDateRange = (value: AnalyticsPerformanceDateRange | undefined): AnalyticsPerformanceDateRange | null => {
  if (value === undefined || value === 'all') return 'all';
  if (value === 'last-14-days' || value === 'last-30-days') return value;
  return null;
};

const selectFromCache = <TId extends string>(
  cache: ReadonlyMap<TId, QueryCache>,
  id: TId,
  query: AnalyticsPerformanceQuery | undefined
): readonly AnalyticsPerformanceRecord[] => {
  const dateRange = normalizeDateRange(query?.dateRange);
  if (dateRange === null) return EMPTY_RECORDS;
  const outcomeId: OutcomeFilter = query?.outcomeId ?? '';
  return cache.get(id)?.get(dateRange)?.get(outcomeId) ?? EMPTY_RECORDS;
};

export const selectStudentPerformanceEvidence = (studentId: StudentId, query?: AnalyticsPerformanceQuery): readonly AnalyticsPerformanceRecord[] => selectFromCache(STUDENT_QUERY_CACHE, studentId, query);

export const selectCohortPerformanceEvidence = (cohortId: CohortId, query?: AnalyticsPerformanceQuery): readonly AnalyticsPerformanceRecord[] => selectFromCache(COHORT_QUERY_CACHE, cohortId, query);
