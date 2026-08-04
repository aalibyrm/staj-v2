declare const termIdBrand: unique symbol;
declare const courseIdBrand: unique symbol;
declare const roleIdBrand: unique symbol;
declare const cohortIdBrand: unique symbol;
declare const studentIdBrand: unique symbol;
declare const learningOutcomeIdBrand: unique symbol;

export type TermId = string & { readonly [termIdBrand]: 'TermId' };
export type CourseId = string & { readonly [courseIdBrand]: 'CourseId' };
export type RoleId = string & { readonly [roleIdBrand]: 'RoleId' };
export type CohortId = string & { readonly [cohortIdBrand]: 'CohortId' };
export type StudentId = string & { readonly [studentIdBrand]: 'StudentId' };
export type LearningOutcomeId = string & {
  readonly [learningOutcomeIdBrand]: 'LearningOutcomeId';
};

export type RoleCode =
  | 'STUDENT'
  | 'INSTRUCTOR'
  | 'MEASUREMENT_SPECIALIST'
  | 'PROGRAM_MANAGER'
  | 'OBSERVER'
  | 'PLATFORM_ADMINISTRATOR';

export type TermStatus = 'archived' | 'current' | 'planned';
export type CourseStatus = 'archived' | 'active' | 'planned';
export type RoleStatus = 'active' | 'inactive';
export type LearningOutcomeStatus = 'active' | 'archived';
export type CohortStatus = 'archived' | 'active' | 'planned';
export type StudentStatus = 'active' | 'inactive';

export interface SeedEntityMetadata {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface SeedTerm extends SeedEntityMetadata {
  readonly id: TermId;
  readonly code: string;
  readonly name: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly status: TermStatus;
  readonly courseIds: readonly CourseId[];
}

export interface SeedCourse extends SeedEntityMetadata {
  readonly id: CourseId;
  readonly code: string;
  readonly title: string;
  readonly termId: TermId;
  readonly status: CourseStatus;
  readonly learningOutcomeIds: readonly LearningOutcomeId[];
  readonly cohortIds: readonly CohortId[];
}

export interface SeedRoleDefinition extends SeedEntityMetadata {
  readonly id: RoleId;
  readonly code: RoleCode;
  readonly name: string;
  readonly description: string;
  readonly status: RoleStatus;
}

export type SeedRole = SeedRoleDefinition;

export interface SeedLearningOutcome extends SeedEntityMetadata {
  readonly id: LearningOutcomeId;
  readonly courseId: CourseId;
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly level: number;
  readonly status: LearningOutcomeStatus;
  readonly prerequisiteOutcomeIds: readonly LearningOutcomeId[];
}

export type SeedOutcome = SeedLearningOutcome;

export interface SeedCohort extends SeedEntityMetadata {
  readonly id: CohortId;
  readonly code: string;
  readonly name: string;
  readonly termId: TermId;
  readonly courseId: CourseId;
  readonly status: CohortStatus;
  readonly studentIds: readonly StudentId[];
}

export interface SeedStudent extends SeedEntityMetadata {
  readonly id: StudentId;
  readonly pseudonym: string;
  readonly cohortId: CohortId;
  readonly roleId: RoleId;
  readonly status: StudentStatus;
}

export interface SeedDataSet {
  readonly terms: readonly SeedTerm[];
  readonly courses: readonly SeedCourse[];
  readonly roles: readonly SeedRoleDefinition[];
  readonly learningOutcomes: readonly SeedLearningOutcome[];
  readonly cohorts: readonly SeedCohort[];
  readonly students: readonly SeedStudent[];
}
