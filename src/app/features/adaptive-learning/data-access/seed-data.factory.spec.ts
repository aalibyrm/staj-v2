import { describe, expect, it } from 'vitest';

import { createSeedData } from './seed-data.factory';
import type { SeedDataSet } from '../models/seed-domain.models';

type EntityWithId = { readonly id: string };
type EntityWithMetadata = EntityWithId & {
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
};

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const EMAIL_LIKE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/i;
const ROLE_CODES = [
  'STUDENT',
  'INSTRUCTOR',
  'MEASUREMENT_SPECIALIST',
  'PROGRAM_MANAGER',
  'OBSERVER',
  'PLATFORM_ADMINISTRATOR'
];

function indexById<T extends EntityWithId>(entities: readonly T[]): Map<string, T> {
  return new Map(entities.map((entity) => [entity.id, entity]));
}

function expectSameIds(actual: readonly string[], expected: readonly string[]): void {
  expect([...actual].sort()).toEqual([...expected].sort());
}

function assertDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') {
    return;
  }

  expect(Object.isFrozen(value)).toBe(true);
  for (const nestedValue of Object.values(value as Record<string, unknown>)) {
    assertDeepFrozen(nestedValue);
  }
}

function assertMetadata(entity: EntityWithMetadata): void {
  expect(entity.id).toBeTruthy();
  expect(entity.createdAt).toMatch(ISO_INSTANT);
  expect(entity.updatedAt).toMatch(ISO_INSTANT);
  expect(Date.parse(entity.updatedAt)).toBeGreaterThanOrEqual(Date.parse(entity.createdAt));
  expect(Number.isInteger(entity.version)).toBe(true);
  expect(entity.version).toBeGreaterThan(0);
}

describe('createSeedData', () => {
  it('returns deterministic, deeply immutable, isolated structures', () => {
    const first = createSeedData();
    const second = createSeedData();

    expect(first).toStrictEqual(second);
    expect(first).not.toBe(second);
    expect(first.terms).not.toBe(second.terms);
    expect(first.terms[0]).not.toBe(second.terms[0]);
    expect(first.courses[0].cohortIds).not.toBe(second.courses[0].cohortIds);
    expect(first.learningOutcomes[0].prerequisiteOutcomeIds).not.toBe(
      second.learningOutcomes[0].prerequisiteOutcomeIds
    );
    assertDeepFrozen(first);
    assertDeepFrozen(second);

    const mutableTerms = first.terms as unknown as { push(value: unknown): number };
    expect(() => mutableTerms.push({})).toThrow();
    const mutableTerm = first.terms[0] as unknown as { name: string };
    expect(() => {
      mutableTerm.name = 'mutated';
    }).toThrow();
  });

  it('creates the exact dense catalog and term status spread', () => {
    const data = createSeedData();

    expect(data.terms).toHaveLength(3);
    expect(data.courses).toHaveLength(6);
    expect(data.roles).toHaveLength(6);
    expect(data.learningOutcomes).toHaveLength(36);
    expect(data.cohorts).toHaveLength(12);
    expect(data.students).toHaveLength(120);
    expect(new Set(data.roles.map((role) => role.code))).toEqual(new Set(ROLE_CODES));
    expect(new Set(data.terms.map((term) => term.status))).toEqual(
      new Set(['archived', 'current', 'planned'])
    );

    for (const term of data.terms) {
      expect(term.courseIds).toHaveLength(2);
      expect(Date.parse(term.startsOn)).toBeLessThan(Date.parse(term.endsOn));
    }
    for (const course of data.courses) {
      expect(course.learningOutcomeIds).toHaveLength(6);
      expect(course.cohortIds).toHaveLength(2);
    }
    expect(data.courses.every((course) => !Object.keys(course).includes('slug'))).toBe(true);
    for (const cohort of data.cohorts) {
      expect(cohort.studentIds).toHaveLength(10);
    }

    const courseCodeCounts = new Map<string, number>();
    for (const course of data.courses) {
      courseCodeCounts.set(course.code, (courseCodeCounts.get(course.code) ?? 0) + 1);
    }
    expect([...courseCodeCounts.values()].sort()).toEqual([3, 3]);
  });

  it('uses unique prefixed IDs and valid metadata without PII-like email values', () => {
    const data = createSeedData();
    const collections: readonly (readonly EntityWithId[])[] = [
      data.terms,
      data.courses,
      data.roles,
      data.learningOutcomes,
      data.cohorts,
      data.students
    ];

    for (const collection of collections) {
      const ids = collection.map((entity) => entity.id);
      expect(new Set(ids).size).toBe(ids.length);
    }

    expect(data.terms.every((term) => term.id.startsWith('TERM-'))).toBe(true);
    expect(data.courses.every((course) => course.id.startsWith('COURSE-'))).toBe(true);
    expect(data.roles.every((role) => role.id.startsWith('ROLE-'))).toBe(true);
    expect(data.learningOutcomes.every((outcome) => outcome.id.startsWith('OUTCOME-'))).toBe(true);
    expect(data.cohorts.every((cohort) => cohort.id.startsWith('COHORT-'))).toBe(true);
    expect(data.students.every((student) => student.id.startsWith('STUDENT-'))).toBe(true);

    for (const entity of [
      ...data.terms,
      ...data.courses,
      ...data.roles,
      ...data.learningOutcomes,
      ...data.cohorts,
      ...data.students
    ]) {
      assertMetadata(entity);
    }
    expect(JSON.stringify(data)).not.toMatch(EMAIL_LIKE);
  });

  it('resolves every foreign key and keeps every relationship bidirectionally closed', () => {
    const data = createSeedData();
    const termsById = indexById(data.terms);
    const coursesById = indexById(data.courses);
    const rolesById = indexById(data.roles);
    const outcomesById = indexById(data.learningOutcomes);
    const cohortsById = indexById(data.cohorts);
    const studentsById = indexById(data.students);
    const studentRole = data.roles.find((role) => role.code === 'STUDENT');

    expect(studentRole).toBeDefined();

    for (const term of data.terms) {
      for (const courseId of term.courseIds) {
        const course = coursesById.get(courseId);
        expect(course).toBeDefined();
        expect(course?.termId).toBe(term.id);
      }
      expectSameIds(
        term.courseIds,
        data.courses.filter((course) => course.termId === term.id).map((course) => course.id)
      );
    }

    for (const course of data.courses) {
      const term = termsById.get(course.termId);
      expect(term).toBeDefined();
      expect(term?.courseIds).toContain(course.id);

      const courseOutcomes = data.learningOutcomes.filter((outcome) => outcome.courseId === course.id);
      expectSameIds(course.learningOutcomeIds, courseOutcomes.map((outcome) => outcome.id));
      for (const outcomeId of course.learningOutcomeIds) {
        expect(outcomesById.get(outcomeId)?.courseId).toBe(course.id);
      }

      const courseCohorts = data.cohorts.filter((cohort) => cohort.courseId === course.id);
      expectSameIds(course.cohortIds, courseCohorts.map((cohort) => cohort.id));
      for (const cohortId of course.cohortIds) {
        expect(cohortsById.get(cohortId)?.courseId).toBe(course.id);
      }
    }

    for (const outcome of data.learningOutcomes) {
      expect(coursesById.get(outcome.courseId)?.learningOutcomeIds).toContain(outcome.id);
      for (const prerequisiteId of outcome.prerequisiteOutcomeIds) {
        const prerequisite = outcomesById.get(prerequisiteId);
        expect(prerequisite).toBeDefined();
        expect(prerequisite?.courseId).toBe(outcome.courseId);
        expect(prerequisiteId).not.toBe(outcome.id);
      }
    }

    for (const cohort of data.cohorts) {
      expect(termsById.get(cohort.termId)?.courseIds).toContain(cohort.courseId);
      expect(coursesById.get(cohort.courseId)?.cohortIds).toContain(cohort.id);
      expectSameIds(
        cohort.studentIds,
        data.students.filter((student) => student.cohortId === cohort.id).map((student) => student.id)
      );
      for (const studentId of cohort.studentIds) {
        expect(studentsById.get(studentId)?.cohortId).toBe(cohort.id);
      }
    }

    for (const student of data.students) {
      expect(cohortsById.get(student.cohortId)?.studentIds).toContain(student.id);
      expect(rolesById.get(student.roleId)).toBe(studentRole);
      expect(student.roleId).toBe(studentRole?.id);
    }

    expect(new Set(data.terms.flatMap((term) => term.courseIds)).size).toBe(data.courses.length);
    expect(new Set(data.courses.flatMap((course) => course.learningOutcomeIds)).size).toBe(
      data.learningOutcomes.length
    );
    expect(new Set(data.courses.flatMap((course) => course.cohortIds)).size).toBe(data.cohorts.length);
    expect(new Set(data.cohorts.flatMap((cohort) => cohort.studentIds)).size).toBe(data.students.length);
  });

  it('provides the same branching, joining, and acyclic outcome graph for every course', () => {
    const data = createSeedData();

    for (const course of data.courses) {
      const outcomes = data.learningOutcomes.filter((outcome) => outcome.courseId === course.id);
      const outcomeById = indexById(outcomes);
      const roots = outcomes.filter((outcome) => outcome.prerequisiteOutcomeIds.length === 0);
      expect(roots).toHaveLength(1);
      const root = roots[0];

      const branches = outcomes.filter(
        (outcome) =>
          outcome.prerequisiteOutcomeIds.length === 1 && outcome.prerequisiteOutcomeIds[0] === root.id
      );
      expect(branches).toHaveLength(2);
      const branchIds = new Set(branches.map((branch) => branch.id));

      const joins = outcomes.filter(
        (outcome) =>
          outcome.prerequisiteOutcomeIds.length === 2 &&
          outcome.prerequisiteOutcomeIds.every((prerequisiteId) => branchIds.has(prerequisiteId))
      );
      expect(joins).toHaveLength(1);
      const join = joins[0];

      const terminals = outcomes.filter(
        (outcome) =>
          outcome.prerequisiteOutcomeIds.length === 1 && outcome.prerequisiteOutcomeIds[0] === join.id
      );
      expect(terminals).toHaveLength(2);

      const visiting = new Set<string>();
      const visited = new Set<string>();
      const visit = (outcomeId: string): void => {
        if (visiting.has(outcomeId)) {
          throw new Error(`Cycle detected at ${outcomeId}`);
        }
        if (visited.has(outcomeId)) {
          return;
        }

        const outcome = outcomeById.get(outcomeId);
        if (outcome === undefined) {
          throw new Error(`Orphan prerequisite ${outcomeId}`);
        }
        visiting.add(outcomeId);
        for (const prerequisiteId of outcome.prerequisiteOutcomeIds) {
          visit(prerequisiteId);
        }
        visiting.delete(outcomeId);
        visited.add(outcomeId);
      };

      for (const outcome of outcomes) {
        visit(outcome.id);
      }
      expect(visited.size).toBe(outcomes.length);
    }
  });
});
