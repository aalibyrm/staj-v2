import { describe, expect, it } from 'vitest';

import { createSeedData } from '../../features/adaptive-learning/data-access/seed-data.factory';
import {
  ACTION_PERMISSIONS,
  DATA_SCOPE_ROLE_POLICY,
  DEMO_ACCOUNTS,
  ROUTE_CAPABILITIES,
  ROLE_CODES,
  decideActionAccess,
  decideDataScopeAccess,
  decideRouteAccess,
  type AuthSession,
  type DemoAccount
} from './authorization';
import { SessionStore } from './session.store';

const sessionFor = (account: DemoAccount): AuthSession =>
  Object.freeze({ accountId: account.id, account });

const accountWithRole = (role: DemoAccount['roleCode']): DemoAccount => {
  const account = DEMO_ACCOUNTS.find((candidate) => candidate.roleCode === role);
  if (account === undefined) {
    throw new Error(`Missing demo account for ${role}.`);
  }
  return account;
};

describe('demo account catalog', () => {
  it('contains six deeply immutable accounts with canonical roles and seed-backed scope IDs', () => {
    const seed = createSeedData();
    const seededEntityIds = new Set<string>([
      ...seed.students.map((student) => student.id),
      ...seed.courses.map((course) => course.id),
      ...seed.cohorts.map((cohort) => cohort.id)
    ]);

    expect(DEMO_ACCOUNTS).toHaveLength(6);
    expect(DEMO_ACCOUNTS.map((account) => account.roleCode)).toEqual([...ROLE_CODES]);
    expect(new Set(DEMO_ACCOUNTS.map((account) => account.id)).size).toBe(6);
    expect(new Set(DEMO_ACCOUNTS.map((account) => account.handle)).size).toBe(6);
    expect(Object.isFrozen(DEMO_ACCOUNTS)).toBe(true);

    for (const account of DEMO_ACCOUNTS) {
      expect(Object.isFrozen(account)).toBe(true);
      expect(Object.isFrozen(account.scopeGrants)).toBe(true);
      expect(JSON.stringify(account).toLowerCase()).not.toMatch(/email|password|secret|token/);

      for (const grant of account.scopeGrants) {
        expect(Object.isFrozen(grant)).toBe(true);
        expect(Object.isFrozen(grant.ids)).toBe(true);
        if (grant.kind !== 'program' && grant.kind !== 'platform') {
          expect(grant.ids.every((id) => seededEntityIds.has(id))).toBe(true);
        }
      }
    }
  });
});

describe('SessionStore', () => {
  it('exposes readonly signals and deterministic sign-in, switch, and sign-out transitions', () => {
    const store = new SessionStore();

    expect(store.session()).toBeNull();
    expect(store.isAuthenticated()).toBe(false);
    expect(store.role()).toBeNull();
    expect(store.activeAccount()).toBeNull();
    expect((store.session as unknown as { set?: unknown }).set).toBeUndefined();
    expect((store.session as unknown as { update?: unknown }).update).toBeUndefined();

    const student = accountWithRole('STUDENT');
    const instructor = accountWithRole('INSTRUCTOR');
    store.signIn(student.id);
    const studentSnapshot = store.session();

    expect(studentSnapshot?.accountId).toBe(student.id);
    expect(store.activeAccount()).toBe(student);
    expect(store.role()).toBe('STUDENT');
    expect(store.isAuthenticated()).toBe(true);

    store.signIn(student.id);
    expect(store.session()).toBe(studentSnapshot);
    store.switchAccount(student.id);
    expect(store.session()).toBe(studentSnapshot);

    store.switchAccount(instructor.id);
    expect(store.activeAccount()).toBe(instructor);
    expect(store.role()).toBe('INSTRUCTOR');
    expect(store.session()).not.toBe(studentSnapshot);

    store.signOut();
    expect(store.session()).toBeNull();
    expect(store.isAuthenticated()).toBe(false);
    expect(store.role()).toBeNull();
    expect(store.activeAccount()).toBeNull();
    store.signOut();
    expect(store.session()).toBeNull();
  });

  it('rejects invalid account IDs synchronously without changing the session', () => {
    const store = new SessionStore();
    const student = accountWithRole('STUDENT');
    store.signIn(student.id);
    const snapshot = store.session();

    expect(() => store.signIn('ACCOUNT-NOT-IN-CATALOG')).toThrow(RangeError);
    expect(() => store.switchAccount('ACCOUNT-NOT-IN-CATALOG')).toThrow(RangeError);
    expect(store.session()).toBe(snapshot);
  });
});

describe('route authorization', () => {
  it('table-tests an allow and a role denial for every canonical role', () => {
    const capabilities = Object.values(ROUTE_CAPABILITIES);

    for (const account of DEMO_ACCOUNTS) {
      const session = sessionFor(account);
      const ownCapability = capabilities.find((capability) =>
        capability.allowedRoles.includes(account.roleCode)
      );
      const otherCapability = capabilities.find(
        (capability) => !capability.allowedRoles.includes(account.roleCode)
      );

      expect(ownCapability).toBeDefined();
      expect(otherCapability).toBeDefined();
      expect(decideRouteAccess(session, ownCapability!)).toEqual({
        allowed: true,
        reason: 'allowed'
      });
      expect(decideRouteAccess(session, otherCapability!)).toEqual({
        allowed: false,
        reason: 'role-denied'
      });
    }
  });

  it('denies unauthenticated route access with the exact reason', () => {
    expect(decideRouteAccess(null, ROUTE_CAPABILITIES.studentLearning)).toEqual({
      allowed: false,
      reason: 'unauthenticated'
    });
  });
});

describe('action authorization', () => {
  it('table-tests an allow and a role denial for every canonical role', () => {
    const permissions = Object.values(ACTION_PERMISSIONS);

    for (const account of DEMO_ACCOUNTS) {
      const session = sessionFor(account);
      const ownPermission = permissions.find((permission) =>
        permission.allowedRoles.includes(account.roleCode)
      );
      const otherPermission = permissions.find(
        (permission) => !permission.allowedRoles.includes(account.roleCode)
      );

      expect(ownPermission).toBeDefined();
      expect(otherPermission).toBeDefined();
      expect(decideActionAccess(session, ownPermission!)).toEqual({
        allowed: true,
        reason: 'allowed'
      });
      expect(decideActionAccess(session, otherPermission!)).toEqual({
        allowed: false,
        reason: 'role-denied'
      });
    }
  });

  it('denies every mutating permission to the read-only observer', () => {
    const observerSession = sessionFor(accountWithRole('OBSERVER'));
    for (const permission of Object.values(ACTION_PERMISSIONS).filter(
      (candidate) => candidate.mutating
    )) {
      expect(decideActionAccess(observerSession, permission)).toEqual({
        allowed: false,
        reason: 'role-denied'
      });
    }

    expect(decideActionAccess(null, ACTION_PERMISSIONS.viewAuthorizedReports)).toEqual({
      allowed: false,
      reason: 'unauthenticated'
    });
  });
});

describe('data-scope authorization', () => {
  it('allows the student own scope but denies another student and a program scope', () => {
    const seed = createSeedData();
    const account = accountWithRole('STUDENT');
    const session = sessionFor(account);
    const ownStudentId = account.scopeGrants.find((grant) => grant.kind === 'student')!.ids[0];
    const ownCourseId = account.scopeGrants.find((grant) => grant.kind === 'course')!.ids[0];
    const otherStudentId = seed.students.find((student) => student.id !== ownStudentId)!.id;

    expect(decideDataScopeAccess(session, { kind: 'student', id: ownStudentId })).toEqual({
      allowed: true,
      reason: 'allowed'
    });
    expect(decideDataScopeAccess(session, { kind: 'course', id: ownCourseId })).toEqual({
      allowed: true,
      reason: 'allowed'
    });
    expect(decideDataScopeAccess(session, { kind: 'student', id: otherStudentId })).toEqual({
      allowed: false,
      reason: 'scope-denied'
    });
    expect(decideDataScopeAccess(session, { kind: 'program', id: 'PROGRAM-ADAPTIVE-LEARNING' })).toEqual({
      allowed: false,
      reason: 'role-denied'
    });
  });

  it('allows instructor assigned students and denies an unassigned student', () => {
    const seed = createSeedData();
    const account = accountWithRole('INSTRUCTOR');
    const session = sessionFor(account);
    const assignedStudentId = account.scopeGrants.find((grant) => grant.kind === 'student')!.ids[0];
    const assignedCohortId = account.scopeGrants.find((grant) => grant.kind === 'cohort')!.ids[0];
    const unassignedStudentId = seed.students.find(
      (student) => student.cohortId !== assignedCohortId
    )!.id;

    expect(decideDataScopeAccess(session, { kind: 'student', id: assignedStudentId })).toEqual({
      allowed: true,
      reason: 'allowed'
    });
    expect(decideDataScopeAccess(session, { kind: 'student', id: unassignedStudentId })).toEqual({
      allowed: false,
      reason: 'scope-denied'
    });
    expect(decideDataScopeAccess(session, { kind: 'program', id: 'PROGRAM-ADAPTIVE-LEARNING' })).toEqual({
      allowed: false,
      reason: 'role-denied'
    });
  });

  it('enforces program manager program, course, and cohort scope', () => {
    const account = accountWithRole('PROGRAM_MANAGER');
    const session = sessionFor(account);
    const programId = account.scopeGrants.find((grant) => grant.kind === 'program')!.ids[0];
    const courseId = account.scopeGrants.find((grant) => grant.kind === 'course')!.ids[0];
    const cohortId = account.scopeGrants.find((grant) => grant.kind === 'cohort')!.ids[0];

    expect(decideDataScopeAccess(session, { kind: 'program', id: programId })).toEqual({
      allowed: true,
      reason: 'allowed'
    });
    expect(decideDataScopeAccess(session, { kind: 'course', id: courseId })).toEqual({
      allowed: true,
      reason: 'allowed'
    });
    expect(decideDataScopeAccess(session, { kind: 'cohort', id: cohortId })).toEqual({
      allowed: true,
      reason: 'allowed'
    });
    expect(decideDataScopeAccess(session, { kind: 'program', id: 'PROGRAM-NOT-ASSIGNED' })).toEqual({
      allowed: false,
      reason: 'scope-denied'
    });
  });

  it('allows the observer authorized cohort only', () => {
    const seed = createSeedData();
    const account = accountWithRole('OBSERVER');
    const session = sessionFor(account);
    const authorizedCohortId = account.scopeGrants.find((grant) => grant.kind === 'cohort')!.ids[0];
    const unauthorizedCohortId = seed.cohorts.find((cohort) => cohort.id !== authorizedCohortId)!.id;

    expect(decideDataScopeAccess(session, { kind: 'cohort', id: authorizedCohortId })).toEqual({
      allowed: true,
      reason: 'allowed'
    });
    expect(decideDataScopeAccess(session, { kind: 'cohort', id: unauthorizedCohortId })).toEqual({
      allowed: false,
      reason: 'scope-denied'
    });
    expect(decideDataScopeAccess(session, { kind: 'course', id: 'COURSE-MATH101-2025-FALL' })).toEqual({
      allowed: false,
      reason: 'role-denied'
    });
  });

  it('allows measurement assessment and analytics scope for the assigned course', () => {
    const seed = createSeedData();
    const account = accountWithRole('MEASUREMENT_SPECIALIST');
    const session = sessionFor(account);
    const courseId = account.scopeGrants.find((grant) => grant.kind === 'course')!.ids[0];
    const otherCourseId = seed.courses.find((course) => course.id !== courseId)!.id;

    expect(decideDataScopeAccess(session, { kind: 'course', id: courseId })).toEqual({
      allowed: true,
      reason: 'allowed'
    });
    expect(decideDataScopeAccess(session, { kind: 'assessment', id: courseId })).toEqual({
      allowed: true,
      reason: 'allowed'
    });
    expect(decideDataScopeAccess(session, { kind: 'analytics', id: otherCourseId })).toEqual({
      allowed: false,
      reason: 'scope-denied'
    });
    expect(decideDataScopeAccess(session, { kind: 'cohort', id: 'COHORT-MATH101-2025-FALL-A' })).toEqual({
      allowed: false,
      reason: 'role-denied'
    });
  });

  it('allows only the administrator global platform scope and denies domain mutation scope', () => {
    const account = accountWithRole('PLATFORM_ADMINISTRATOR');
    const session = sessionFor(account);

    expect(decideDataScopeAccess(session, { kind: 'platform', id: 'PLATFORM-ANY' })).toEqual({
      allowed: true,
      reason: 'allowed'
    });
    expect(decideDataScopeAccess(session, { kind: 'course', id: 'COURSE-MATH101-2025-FALL' })).toEqual({
      allowed: false,
      reason: 'role-denied'
    });
    expect(decideActionAccess(session, ACTION_PERMISSIONS.manageCourse)).toEqual({
      allowed: false,
      reason: 'role-denied'
    });
  });

  it('denies unauthenticated and unknown scope requests with exact reasons', () => {
    expect(decideDataScopeAccess(null, { kind: 'student', id: 'STUDENT-ANY' })).toEqual({
      allowed: false,
      reason: 'unauthenticated'
    });
    expect(
      decideDataScopeAccess(sessionFor(accountWithRole('STUDENT')), {
        kind: 'program',
        id: 'UNKNOWN'
      })
    ).toEqual({ allowed: false, reason: 'role-denied' });
    expect(
      decideDataScopeAccess(sessionFor(accountWithRole('STUDENT')), {
        kind: 'student',
        id: 'UNKNOWN'
      })
    ).toEqual({ allowed: false, reason: 'scope-denied' });
  });

  it('keeps decisions frozen and independent across calls', () => {
    const studentSession = sessionFor(accountWithRole('STUDENT'));
    const target = { kind: 'student' as const, id: 'STUDENT-NOT-ASSIGNED' };
    const first = decideDataScopeAccess(studentSession, target);
    const second = decideDataScopeAccess(studentSession, target);

    expect(first).toEqual({ allowed: false, reason: 'scope-denied' });
    expect(Object.isFrozen(first)).toBe(true);
    expect(second).not.toBe(first);
    expect(DATA_SCOPE_ROLE_POLICY.student).toEqual(['STUDENT', 'INSTRUCTOR']);
    expect(Object.isFrozen(DATA_SCOPE_ROLE_POLICY)).toBe(true);
  });
});

describe('seed role migration', () => {
  it('keeps all six canonical roles and 120 students linked to the Student seed role', () => {
    const seed = createSeedData();
    const studentRole = seed.roles.find((role) => role.code === 'STUDENT');

    expect(seed.roles.map((role) => role.code)).toEqual([...ROLE_CODES]);
    expect(studentRole).toBeDefined();
    expect(seed.students).toHaveLength(120);
    expect(seed.students.every((student) => student.roleId === studentRole!.id)).toBe(true);
  });
});
