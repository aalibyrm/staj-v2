import type { RoleCode } from '../../../core/auth/authorization';
import type {
  CohortId,
  CohortStatus,
  CourseId,
  CourseStatus,
  LearningOutcomeId,
  RoleId,
  SeedCohort,
  SeedCourse,
  SeedDataSet,
  SeedLearningOutcome,
  SeedRoleDefinition,
  SeedStudent,
  SeedTerm,
  StudentId,
  StudentStatus,
  TermId,
  TermStatus
} from '../models/seed-domain.models';

const CREATED_AT = '2024-01-15T00:00:00.000Z';
const UPDATED_AT = '2024-01-15T00:00:00.000Z';
const STUDENT_ROLE_ID = 'ROLE-STUDENT';
const STUDENTS_PER_COHORT = 10;

interface TermPlan {
  readonly id: TermId;
  readonly code: string;
  readonly name: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly status: TermStatus;
}

interface CourseDefinition {
  readonly code: string;
  readonly title: string;
  readonly slug: string;
}

interface CoursePlan {
  readonly id: CourseId;
  readonly code: string;
  readonly title: string;
  readonly slug: string;
  readonly termId: TermId;
  readonly status: CourseStatus;
}

interface OutcomeDefinition {
  readonly suffix: string;
  readonly title: string;
  readonly description: string;
  readonly level: number;
  readonly prerequisiteSuffixes: readonly string[];
}

interface CohortPlan {
  readonly id: CohortId;
  readonly code: string;
  readonly name: string;
  readonly termId: TermId;
  readonly courseId: CourseId;
  readonly status: CohortStatus;
  readonly studentIds: readonly StudentId[];
}

interface RoleDefinition {
  readonly code: RoleCode;
  readonly name: string;
  readonly description: string;
}

const asTermId = (value: string): TermId => value as TermId;
const asCourseId = (value: string): CourseId => value as CourseId;
const asRoleId = (value: string): RoleId => value as RoleId;
const asCohortId = (value: string): CohortId => value as CohortId;
const asStudentId = (value: string): StudentId => value as StudentId;
const asLearningOutcomeId = (value: string): LearningOutcomeId => value as LearningOutcomeId;

function courseStatusForTerm(status: TermStatus): CourseStatus {
  if (status === 'archived') {
    return 'archived';
  }
  if (status === 'planned') {
    return 'planned';
  }
  return 'active';
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  for (const nestedValue of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nestedValue);
  }
  return value;
}

export function createSeedData(): SeedDataSet {
  const termPlans: readonly TermPlan[] = [
    {
      id: asTermId('TERM-2024-FALL'),
      code: 'TERM-2024-FALL',
      name: 'Autumn 2024',
      startsOn: '2024-09-01',
      endsOn: '2025-01-31',
      status: 'archived'
    },
    {
      id: asTermId('TERM-2025-FALL'),
      code: 'TERM-2025-FALL',
      name: 'Autumn 2025',
      startsOn: '2025-09-01',
      endsOn: '2026-01-31',
      status: 'current'
    },
    {
      id: asTermId('TERM-2026-FALL'),
      code: 'TERM-2026-FALL',
      name: 'Autumn 2026',
      startsOn: '2026-09-01',
      endsOn: '2027-01-31',
      status: 'planned'
    }
  ];

  const courseDefinitions: readonly CourseDefinition[] = [
    {
      code: 'MATH-101',
      title: 'Foundations of Data Literacy',
      slug: 'MATH101'
    },
    {
      code: 'EDU-201',
      title: 'Learning Analytics Principles',
      slug: 'EDU201'
    }
  ];

  const coursePlans: readonly CoursePlan[] = termPlans.flatMap((term) =>
    courseDefinitions.map((definition) => {
      const termSuffix = term.code.replace('TERM-', '');
      return {
        id: asCourseId(`COURSE-${definition.slug}-${termSuffix}`),
        code: definition.code,
        title: definition.title,
        slug: definition.slug,
        termId: term.id,
        status: courseStatusForTerm(term.status)
      };
    })
  );

  const terms: readonly SeedTerm[] = termPlans.map((term) => ({
    ...term,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    version: 1,
    courseIds: coursePlans
      .filter((course) => course.termId === term.id)
      .map((course) => course.id)
  }));

  const outcomeDefinitions: readonly OutcomeDefinition[] = [
    {
      suffix: '01',
      title: 'Identify foundational concepts',
      description: 'Recognize the vocabulary and core ideas used throughout the course.',
      level: 1,
      prerequisiteSuffixes: []
    },
    {
      suffix: '02',
      title: 'Classify core concepts',
      description: 'Organize foundational concepts into meaningful categories.',
      level: 2,
      prerequisiteSuffixes: ['01']
    },
    {
      suffix: '03',
      title: 'Interpret practical examples',
      description: 'Explain how foundational concepts appear in realistic scenarios.',
      level: 2,
      prerequisiteSuffixes: ['01']
    },
    {
      suffix: '04',
      title: 'Connect concepts to evidence',
      description: 'Combine the two application branches into an evidence-based explanation.',
      level: 3,
      prerequisiteSuffixes: ['02', '03']
    },
    {
      suffix: '05',
      title: 'Evaluate a complete case',
      description: 'Use the connected concepts to evaluate a complete case study.',
      level: 4,
      prerequisiteSuffixes: ['04']
    },
    {
      suffix: '06',
      title: 'Design an informed response',
      description: 'Produce an independent response grounded in the connected concepts.',
      level: 4,
      prerequisiteSuffixes: ['04']
    }
  ];

  const outcomeIdsByCourse = new Map<CourseId, ReadonlyMap<string, LearningOutcomeId>>();
  for (const course of coursePlans) {
    const outcomeIds = new Map<string, LearningOutcomeId>();
    for (const definition of outcomeDefinitions) {
      outcomeIds.set(
        definition.suffix,
        asLearningOutcomeId(`OUTCOME-${course.slug}-${course.id.replace(`COURSE-${course.slug}-`, '')}-${definition.suffix}`)
      );
    }
    outcomeIdsByCourse.set(course.id, outcomeIds);
  }

  const learningOutcomes: readonly SeedLearningOutcome[] = coursePlans.flatMap((course) => {
    const outcomeIds = outcomeIdsByCourse.get(course.id);
    if (outcomeIds === undefined) {
      throw new Error(`Missing outcome plan for ${course.id}`);
    }

    return outcomeDefinitions.map((definition) => {
      const id = outcomeIds.get(definition.suffix);
      if (id === undefined) {
        throw new Error(`Missing outcome ${definition.suffix} for ${course.id}`);
      }

      return {
        id,
        courseId: course.id,
        code: `OUTCOME-${definition.suffix}`,
        title: definition.title,
        description: definition.description,
        level: definition.level,
        status: 'active',
        prerequisiteOutcomeIds: definition.prerequisiteSuffixes.map((suffix) => {
          const prerequisiteId = outcomeIds.get(suffix);
          if (prerequisiteId === undefined) {
            throw new Error(`Missing prerequisite ${suffix} for ${course.id}`);
          }
          return prerequisiteId;
        }),
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
        version: 1
      } satisfies SeedLearningOutcome;
    });
  });

  const cohortPlans: readonly CohortPlan[] = coursePlans.flatMap((course) => {
    const termSuffix = course.id.replace(`COURSE-${course.slug}-`, '');
    const cohortStatus: CohortStatus = course.status;

    return (['A', 'B'] as const).map((section) => {
      const cohortId = asCohortId(`COHORT-${course.slug}-${termSuffix}-${section}`);
      const studentIds = Array.from({ length: STUDENTS_PER_COHORT }, (_, index) =>
        asStudentId(
          `STUDENT-${course.slug}-${termSuffix}-${section}-${String(index + 1).padStart(2, '0')}`
        )
      );

      return {
        id: cohortId,
        code: `COHORT-${course.code}-${termSuffix}-${section}`,
        name: `${course.title} ${termSuffix} · Section ${section}`,
        termId: course.termId,
        courseId: course.id,
        status: cohortStatus,
        studentIds
      };
    });
  });

  const cohorts: readonly SeedCohort[] = cohortPlans.map((cohort) => ({
    ...cohort,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    version: 1
  }));

  const courses: readonly SeedCourse[] = coursePlans.map((course) => ({
    id: course.id,
    code: course.code,
    title: course.title,
    termId: course.termId,
    status: course.status,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    version: 1,
    learningOutcomeIds: learningOutcomes
      .filter((outcome) => outcome.courseId === course.id)
      .map((outcome) => outcome.id),
    cohortIds: cohorts.filter((cohort) => cohort.courseId === course.id).map((cohort) => cohort.id)
  }));

  const roleDefinitions: readonly RoleDefinition[] = [
    {
      code: 'STUDENT',
      name: 'Student',
      description: 'Learner who uses assigned courses and learning paths.',
    },
    {
      code: 'INSTRUCTOR',
      name: 'Instructor',
      description: 'Educator who manages course teaching and learner progress.',
    },
    {
      code: 'MEASUREMENT_SPECIALIST',
      name: 'Measurement Specialist',
      description: 'Specialist who reviews assessment quality and measurement analytics.',
    },
    {
      code: 'PROGRAM_MANAGER',
      name: 'Program Manager',
      description: 'Manager who coordinates outcomes, programs, cohorts, and publishing.',
    },
    {
      code: 'OBSERVER',
      name: 'Observer',
      description: 'Read-only stakeholder who reviews authorized reports.',
    },
    {
      code: 'PLATFORM_ADMINISTRATOR',
      name: 'Platform Administrator',
      description: 'Administrator who maintains roles, terms, and platform parameters.',
    }
  ];

  const roles: readonly SeedRoleDefinition[] = roleDefinitions.map((role) => ({
    id: asRoleId(`ROLE-${role.code}`),
    ...role,
    status: 'active',
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    version: 1
  }));

  const students: readonly SeedStudent[] = cohortPlans.flatMap((cohort) =>
    cohort.studentIds.map((studentId, index) => ({
      id: studentId,
      pseudonym: `Learner ${cohort.code} ${String(index + 1).padStart(2, '0')}`,
      cohortId: cohort.id,
      roleId: asRoleId(STUDENT_ROLE_ID),
      status: 'active' as StudentStatus,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
      version: 1
    }))
  );

  const dataSet: SeedDataSet = {
    terms,
    courses,
    roles,
    learningOutcomes,
    cohorts,
    students
  };

  return deepFreeze(dataSet);
}
