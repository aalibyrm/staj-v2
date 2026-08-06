import { describe, expect, it } from 'vitest';

import { DEMO_ACCOUNTS, type AuthSession, type DemoAccount } from '../../../core/auth/authorization';
import type { GradingContext } from '../models/rubric.models';
import { decideGradingAttemptAccess } from './grading-access';

const sessionFor = (account: DemoAccount): AuthSession => Object.freeze({ accountId: account.id, account });

const accountWithRole = (role: DemoAccount['roleCode']): DemoAccount => {
  const account = DEMO_ACCOUNTS.find((candidate) => candidate.roleCode === role);
  if (account === undefined) {
    throw new Error(`Missing demo account for ${role}.`);
  }
  return account;
};

const contextFor = (studentId: string | undefined): GradingContext =>
  Object.freeze({
    attemptId: 'attempt-1',
    studentId: studentId as string,
    studentName: 'Learner One',
    examId: 'exam-1',
    examTitle: 'Written response assessment',
    courseTitle: 'Reasoning practice',
    questionNumber: 1,
    questionCount: 1
  });

describe('decideGradingAttemptAccess', () => {
  it('denies a null or undefined session as unauthenticated', () => {
    const instructor = accountWithRole('INSTRUCTOR');
    const ownedStudentId = instructor.scopeGrants.find((grant) => grant.kind === 'student')!.ids[0]!;
    const context = contextFor(ownedStudentId);

    expect(decideGradingAttemptAccess(null, context)).toEqual({
      allowed: false,
      reason: 'unauthenticated',
      message: expect.any(String)
    });
    expect(decideGradingAttemptAccess(undefined, context)).toEqual({
      allowed: false,
      reason: 'unauthenticated',
      message: expect.any(String)
    });
  });

  it('denies a non-instructor role as role-denied', () => {
    const student = accountWithRole('STUDENT');
    const ownStudentId = student.scopeGrants.find((grant) => grant.kind === 'student')!.ids[0]!;
    const session = sessionFor(student);
    const context = contextFor(ownStudentId);

    const decision = decideGradingAttemptAccess(session, context);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('role-denied');
  });

  it('denies an instructor for a student outside their scope grant', () => {
    const instructor = accountWithRole('INSTRUCTOR');
    const session = sessionFor(instructor);
    const context = contextFor('STUDENT-OUTSIDE-SCOPE');

    const decision = decideGradingAttemptAccess(session, context);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('scope-denied');
    expect(decision.message).not.toContain('STUDENT-OUTSIDE-SCOPE');
  });

  it('denies deny-by-default when context or studentId is missing rather than throwing', () => {
    const instructor = accountWithRole('INSTRUCTOR');
    const session = sessionFor(instructor);

    expect(decideGradingAttemptAccess(session, null)).toMatchObject({ allowed: false, reason: 'scope-denied' });
    expect(decideGradingAttemptAccess(session, undefined)).toMatchObject({ allowed: false, reason: 'scope-denied' });
    expect(decideGradingAttemptAccess(session, contextFor(undefined))).toMatchObject({
      allowed: false,
      reason: 'scope-denied'
    });
    expect(decideGradingAttemptAccess(session, contextFor('   '))).toMatchObject({
      allowed: false,
      reason: 'scope-denied'
    });
  });

  it('allows an instructor whose scope grant covers the attempt student', () => {
    const instructor = accountWithRole('INSTRUCTOR');
    const ownedStudentId = instructor.scopeGrants.find((grant) => grant.kind === 'student')!.ids[0]!;
    const session = sessionFor(instructor);
    const context = contextFor(ownedStudentId);

    const decision = decideGradingAttemptAccess(session, context);
    expect(decision).toEqual({ allowed: true, reason: 'allowed', message: expect.any(String) });
  });

  it('returns a frozen decision', () => {
    const instructor = accountWithRole('INSTRUCTOR');
    const ownedStudentId = instructor.scopeGrants.find((grant) => grant.kind === 'student')!.ids[0]!;
    const decision = decideGradingAttemptAccess(sessionFor(instructor), contextFor(ownedStudentId));
    expect(Object.isFrozen(decision)).toBe(true);
  });
});
