import { Injectable, computed, inject } from '@angular/core';

import {
  decideDataScopeAccess,
  type AuthSession,
  type DataScopeGrant,
  type RoleCode
} from '../../../core/auth/authorization';
import { SessionStore } from '../../../core/auth/session.store';
import { createSeedData } from './seed-data.factory';

export type ScopedDataKind = 'course' | 'cohort' | 'student';
export type ScopedDataAccessMode = 'granted' | 'read-only';

export type ScopedDataRecord = Readonly<{
  readonly id: string;
  readonly kind: ScopedDataKind;
  readonly kindLabel: string;
  readonly primaryText: string;
  readonly secondaryContext: string;
  readonly accessMode: ScopedDataAccessMode;
}>;

type CandidateRecord = Readonly<{
  readonly id: string;
  readonly kind: ScopedDataKind;
  readonly kindLabel: string;
  readonly primaryText: string;
  readonly secondaryContext: string;
}>;

type CourseContext = Readonly<{
  readonly code: string;
  readonly title: string;
}>;

type CohortContext = Readonly<{
  readonly code: string;
  readonly name: string;
  readonly courseId: string;
}>;

const EMPTY_RECORDS: readonly ScopedDataRecord[] = Object.freeze([]);
const SUPPORTED_KINDS: readonly ScopedDataKind[] = Object.freeze(['course', 'cohort', 'student']);

const statusLabel = (status: string): string => `${status.slice(0, 1).toUpperCase()}${status.slice(1)}`;

const buildCandidateCatalog = (): readonly CandidateRecord[] => {
  const seed = createSeedData();
  const courseContexts = new Map<string, CourseContext>(
    seed.courses.map((course) => [
      course.id,
      Object.freeze({ code: course.code, title: course.title })
    ] as const)
  );
  const cohortContexts = new Map<string, CohortContext>(
    seed.cohorts.map((cohort) => [
      cohort.id,
      Object.freeze({ code: cohort.code, name: cohort.name, courseId: cohort.courseId })
    ] as const)
  );

  const candidates: CandidateRecord[] = [];
  for (const course of seed.courses) {
    candidates.push(
      Object.freeze({
        id: course.id,
        kind: 'course',
        kindLabel: 'Course',
        primaryText: course.title,
        secondaryContext: `${course.code} · Status: ${statusLabel(course.status)}`,
      })
    );
  }

  for (const cohort of seed.cohorts) {
    const course = courseContexts.get(cohort.courseId);
    const courseText = course === undefined ? 'Course context unavailable' : course.code;
    candidates.push(
      Object.freeze({
        id: cohort.id,
        kind: 'cohort',
        kindLabel: 'Cohort',
        primaryText: `${cohort.code} — ${cohort.name}`,
        secondaryContext: `${courseText} · Status: ${statusLabel(cohort.status)}`,
      })
    );
  }

  for (const student of seed.students) {
    const cohort = cohortContexts.get(student.cohortId);
    const cohortText = cohort === undefined ? 'Cohort context unavailable' : `${cohort.code} — ${cohort.name}`;
    candidates.push(
      Object.freeze({
        id: student.id,
        kind: 'student',
        kindLabel: 'Student',
        primaryText: student.pseudonym,
        secondaryContext: cohortText,
      })
    );
  }

  return Object.freeze(candidates);
};

const CANDIDATE_CATALOG = buildCandidateCatalog();

const roleLabelFor = (roleCode: RoleCode | undefined): string => {
  if (roleCode === undefined) {
    return 'No role selected';
  }

  return roleCode
    .toLowerCase()
    .split('_')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
};

const matchingGrant = (session: AuthSession, candidate: CandidateRecord): DataScopeGrant | undefined =>
  session.account.scopeGrants.find(
    (grant) =>
      grant.kind === candidate.kind &&
      (grant.global === true || grant.ids.includes(candidate.id))
  );


@Injectable()
export class ScopedDataFacade {
  private readonly sessionStore = inject(SessionStore);
  private readonly session = this.sessionStore.session;
  readonly isAuthenticated = computed(() => this.session() !== null);

  readonly accountLabel = computed(() => this.session()?.account.displayLabel ?? 'No account selected');
  readonly roleLabel = computed(() => roleLabelFor(this.session()?.account.roleCode));
  readonly visibleRecords = computed<readonly ScopedDataRecord[]>(() => {
    const session = this.session();
    if (session === null) {
      return EMPTY_RECORDS;
    }

    const records: ScopedDataRecord[] = [];
    for (const candidate of CANDIDATE_CATALOG) {
      if (!SUPPORTED_KINDS.includes(candidate.kind)) {
        continue;
      }

      const decision = decideDataScopeAccess(session, {
        kind: candidate.kind,
        id: candidate.id
      });
      if (!decision.allowed) {
        continue;
      }

      const grant = matchingGrant(session, candidate);
      if (grant === undefined) {
        continue;
      }

      records.push(
        Object.freeze({
          id: candidate.id,
          kind: candidate.kind,
          kindLabel: candidate.kindLabel,
          primaryText: candidate.primaryText,
          secondaryContext: candidate.secondaryContext,
          accessMode: grant.readOnly === true ? 'read-only' : 'granted'
        })
      );
    }

    return Object.freeze(records);
  });
}
