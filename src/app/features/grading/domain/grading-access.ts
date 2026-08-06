import {
  ACTION_PERMISSIONS,
  decideActionAccess,
  decideDataScopeAccess,
  type AuthSession
} from '../../../core/auth/authorization';
import type { GradingContext } from '../models/rubric.models';

export type GradingAccessReason = 'allowed' | 'unauthenticated' | 'role-denied' | 'scope-denied';

export type GradingAccessDecision = Readonly<{
  readonly allowed: boolean;
  readonly reason: GradingAccessReason;
  readonly message: string;
}>;

const UNAUTHENTICATED_MESSAGE = 'Sign in to review this grading attempt.';
const ROLE_DENIED_MESSAGE = 'Your role does not permit grading this attempt.';
const SCOPE_DENIED_MESSAGE = 'This grading attempt is outside your data scope.';
const ALLOWED_MESSAGE = 'Access granted for this grading attempt.';

/**
 * Decides whether a session may open a grading attempt: authentication,
 * the `manage-course` action permission, then student data-scope. Deny by
 * default and never leak the student id on a denied decision.
 */
export const decideGradingAttemptAccess = (
  session: AuthSession | null | undefined,
  context: GradingContext | null | undefined
): GradingAccessDecision => {
  if (session === null || session === undefined) {
    return Object.freeze({ allowed: false, reason: 'unauthenticated', message: UNAUTHENTICATED_MESSAGE });
  }

  const actionDecision = decideActionAccess(session, ACTION_PERMISSIONS.manageCourse);
  if (!actionDecision.allowed) {
    return Object.freeze({ allowed: false, reason: actionDecision.reason, message: ROLE_DENIED_MESSAGE });
  }

  const studentId = context?.studentId;
  if (typeof studentId !== 'string' || studentId.trim().length === 0) {
    return Object.freeze({ allowed: false, reason: 'scope-denied', message: SCOPE_DENIED_MESSAGE });
  }

  const scopeDecision = decideDataScopeAccess(session, { kind: 'student', id: studentId });
  if (!scopeDecision.allowed) {
    return Object.freeze({ allowed: false, reason: 'scope-denied', message: SCOPE_DENIED_MESSAGE });
  }

  return Object.freeze({ allowed: true, reason: 'allowed', message: ALLOWED_MESSAGE });
};
