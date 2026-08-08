import { createSeedData } from '../../adaptive-learning/data-access/seed-data.factory';
import {
  ANALYTICS_PERFORMANCE_DATASET,
  ANALYTICS_PERFORMANCE_PERIODS,
  ANALYTICS_PERFORMANCE_RECORD_COUNT,
  selectCohortPerformanceEvidence,
  selectStudentPerformanceEvidence
} from './analytics-performance.dataset';

const required = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('Expected seeded value.');
  return value;
};

describe('analytics performance dataset', () => {
  it('contains exactly 120 learners × 6 outcomes × 6 periods with canonical relations', () => {
    const seed = createSeedData();
    expect(ANALYTICS_PERFORMANCE_RECORD_COUNT).toBe(4_320);
    expect(ANALYTICS_PERFORMANCE_DATASET).toHaveLength(120 * 6 * 6);

    const cohorts = new Map(seed.cohorts.map((cohort) => [cohort.id, cohort]));
    const courses = new Map(seed.courses.map((course) => [course.id, course]));
    const outcomes = new Map(seed.learningOutcomes.map((outcome) => [outcome.id, outcome]));
    for (const record of ANALYTICS_PERFORMANCE_DATASET) {
      const student = required(seed.students.find((candidate) => candidate.id === record.studentId));
      const cohort = required(cohorts.get(record.cohortId));
      const course = required(courses.get(record.courseId));
      const outcome = required(outcomes.get(record.outcomeId));
      expect(student.cohortId).toBe(record.cohortId);
      expect(cohort.courseId).toBe(record.courseId);
      expect(outcome.courseId).toBe(record.courseId);
      expect(course.learningOutcomeIds).toContain(record.outcomeId);
      expect(record.attempt.outcomeId).toBe(record.outcomeId);
    }

    for (const student of seed.students) expect(selectStudentPerformanceEvidence(student.id)).toHaveLength(36);
  });

  it('keeps deterministic student/outcome/period ordering and valid immutable evidence', () => {
    const seed = createSeedData();
    const student = required(seed.students[0]);
    const course = required(seed.courses.find((candidate) => candidate.cohortIds.includes(student.cohortId)));
    const outcomes = seed.learningOutcomes.filter((outcome) => outcome.courseId === course.id);
    const evidence = selectStudentPerformanceEvidence(student.id);
    const expectedOrder = outcomes.flatMap((outcome) => ANALYTICS_PERFORMANCE_PERIODS.map((period) => `${outcome.id}:${period.value}`));
    expect(evidence.map((record) => `${record.outcomeId}:${record.period}`)).toEqual(expectedOrder);
    expect(Object.isFrozen(ANALYTICS_PERFORMANCE_DATASET)).toBe(true);
    expect(Object.isFrozen(evidence)).toBe(true);
    for (const record of evidence) {
      expect(Object.isFrozen(record)).toBe(true);
      expect(Object.isFrozen(record.attempt)).toBe(true);
      expect(Number.isFinite(record.attempt.earnedFraction)).toBe(true);
      expect(record.attempt.earnedFraction).toBeGreaterThanOrEqual(0);
      expect(record.attempt.earnedFraction).toBeLessThanOrEqual(1);
      expect(['easy', 'medium', 'hard']).toContain(record.attempt.difficulty);
      expect(Number.isNaN(Date.parse(record.attempt.answeredAt))).toBe(false);
    }
  });

  it('does not mutate canonical seed input and memoizes only finite canonical queries', () => {
    const seed = createSeedData();
    const firstStudent = required(seed.students[0]);
    const secondStudent = required(seed.students[1]);
    const firstCohort = required(seed.cohorts[0]);
    const firstOutcome = required(seed.learningOutcomes.find((outcome) => outcome.courseId === firstCohort.courseId));
    const seedSnapshot = JSON.stringify(seed);

    const all = selectStudentPerformanceEvidence(firstStudent.id, { dateRange: 'all' });
    expect(selectStudentPerformanceEvidence(firstStudent.id, { dateRange: 'all' })).toBe(all);
    const lastThirty = selectStudentPerformanceEvidence(firstStudent.id, { dateRange: 'last-30-days' });
    expect(lastThirty).not.toBe(all);
    expect(selectStudentPerformanceEvidence(firstStudent.id, { dateRange: 'last-30-days' })).toBe(lastThirty);
    const oneOutcome = selectStudentPerformanceEvidence(firstStudent.id, { outcomeId: firstOutcome.id });
    expect(oneOutcome).not.toBe(all);
    expect(oneOutcome.every((record) => record.outcomeId === firstOutcome.id)).toBe(true);
    expect(selectStudentPerformanceEvidence(secondStudent.id)).not.toBe(all);

    const cohortAll = selectCohortPerformanceEvidence(firstCohort.id);
    expect(selectCohortPerformanceEvidence(firstCohort.id)).toBe(cohortAll);
    expect(selectCohortPerformanceEvidence(firstCohort.id, { dateRange: 'last-14-days' })).not.toBe(cohortAll);
    expect(cohortAll.every((record) => record.cohortId === firstCohort.id)).toBe(true);
    const cohortStudentIds = new Set(firstCohort.studentIds);
    expect(cohortAll.every((record) => cohortStudentIds.has(record.studentId))).toBe(true);
    expect(JSON.stringify(seed)).toBe(seedSnapshot);
    expect(Reflect.set(firstStudent, 'pseudonym', 'mutated')).toBe(false);
    expect(JSON.stringify(seed)).toBe(seedSnapshot);
  });

  it('returns empty frozen slices for foreign or non-canonical query keys', () => {
    const seed = createSeedData();
    const student = required(seed.students[0]);
    const foreignOutcome = required(seed.learningOutcomes.find((outcome) => outcome.courseId !== seed.courses[0]?.id));
    const foreign = selectStudentPerformanceEvidence(student.id, { outcomeId: foreignOutcome.id });
    expect(foreign).toEqual([]);
    expect(Object.isFrozen(foreign)).toBe(true);
  });
});
