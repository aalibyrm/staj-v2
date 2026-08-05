declare const accountIdBrand: unique symbol;

export type AccountId = string & { readonly [accountIdBrand]: 'AccountId' };

export const ROLE_CODES = Object.freeze([
  'STUDENT',
  'INSTRUCTOR',
  'MEASUREMENT_SPECIALIST',
  'PROGRAM_MANAGER',
  'OBSERVER',
  'PLATFORM_ADMINISTRATOR'
] as const);

export type RoleCode = (typeof ROLE_CODES)[number];

export const DATA_SCOPE_KINDS = Object.freeze([
  'student',
  'course',
  'cohort',
  'assessment',
  'analytics',
  'program',
  'platform'
] as const);

export type DataScopeKind = (typeof DATA_SCOPE_KINDS)[number];

export type AuthorizationReason = 'allowed' | 'unauthenticated' | 'role-denied' | 'scope-denied';

export interface AuthorizationDecision {
  readonly allowed: boolean;
  readonly reason: AuthorizationReason;
}

export interface DataScopeGrant {
  readonly kind: DataScopeKind;
  readonly ids: readonly string[];
  readonly global?: boolean;
  readonly readOnly?: boolean;
}

export interface DemoAccount {
  readonly id: AccountId;
  readonly handle: string;
  readonly displayLabel: string;
  readonly roleCode: RoleCode;
  readonly scopeGrants: readonly DataScopeGrant[];
}

export interface AuthSession {
  readonly accountId: AccountId;
  readonly account: DemoAccount;
}

export const ROUTE_CAPABILITY_CODES = Object.freeze([
  'student-learning',
  'instructor-teaching',
  'measurement-workspace',
  'program-workspace',
  'observer-reports',
  'platform-administration'
] as const);

export type RouteCapabilityCode = (typeof ROUTE_CAPABILITY_CODES)[number];

export interface RouteCapability {
  readonly key: RouteCapabilityCode;
  readonly allowedRoles: readonly RoleCode[];
}

export const ACTION_PERMISSION_CODES = Object.freeze([
  'view-own-learning',
  'update-own-learning',
  'manage-course',
  'review-assessment',
  'manage-program',
  'view-authorized-reports',
  'manage-platform'
] as const);

export type ActionPermissionCode = (typeof ACTION_PERMISSION_CODES)[number];

export interface ActionPermission {
  readonly key: ActionPermissionCode;
  readonly allowedRoles: readonly RoleCode[];
  readonly mutating: boolean;
}

export interface DataTarget {
  readonly kind: DataScopeKind;
  readonly id: string;
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

export const ROUTE_ROLE_POLICY: Readonly<Record<RouteCapabilityCode, readonly RoleCode[]>> = deepFreeze({
  'student-learning': ['STUDENT'],
  'instructor-teaching': ['INSTRUCTOR'],
  'measurement-workspace': ['MEASUREMENT_SPECIALIST'],
  'program-workspace': ['PROGRAM_MANAGER'],
  'observer-reports': ['OBSERVER'],
  'platform-administration': ['PLATFORM_ADMINISTRATOR']
} as const satisfies Record<RouteCapabilityCode, readonly RoleCode[]>);

export const ROUTE_CAPABILITIES = deepFreeze({
  studentLearning: {
    key: 'student-learning',
    allowedRoles: ROUTE_ROLE_POLICY['student-learning']
  },
  instructorTeaching: {
    key: 'instructor-teaching',
    allowedRoles: ROUTE_ROLE_POLICY['instructor-teaching']
  },
  measurementWorkspace: {
    key: 'measurement-workspace',
    allowedRoles: ROUTE_ROLE_POLICY['measurement-workspace']
  },
  programWorkspace: {
    key: 'program-workspace',
    allowedRoles: ROUTE_ROLE_POLICY['program-workspace']
  },
  observerReports: {
    key: 'observer-reports',
    allowedRoles: ROUTE_ROLE_POLICY['observer-reports']
  },
  platformAdministration: {
    key: 'platform-administration',
    allowedRoles: ROUTE_ROLE_POLICY['platform-administration']
  }
} as const satisfies Readonly<Record<string, RouteCapability>>);
type RouteCapabilityPath = Readonly<{
  pattern: readonly string[];
  capabilities: readonly RouteCapability[];
}>;

const ROUTE_CAPABILITY_PATHS: readonly RouteCapabilityPath[] = deepFreeze([
  {
    pattern: ['learning', 'dashboard'],
    capabilities: [
      ROUTE_CAPABILITIES.studentLearning,
      ROUTE_CAPABILITIES.instructorTeaching,
      ROUTE_CAPABILITIES.measurementWorkspace,
      ROUTE_CAPABILITIES.programWorkspace,
      ROUTE_CAPABILITIES.observerReports,
      ROUTE_CAPABILITIES.platformAdministration
    ]
  },
  {
    pattern: ['courses'],
    capabilities: [
      ROUTE_CAPABILITIES.studentLearning,
      ROUTE_CAPABILITIES.instructorTeaching,
      ROUTE_CAPABILITIES.programWorkspace
    ]
  },
  {
    pattern: ['courses', ':id', 'path'],
    capabilities: [ROUTE_CAPABILITIES.studentLearning, ROUTE_CAPABILITIES.instructorTeaching]
  },
  {
    pattern: ['outcomes'],
    capabilities: [ROUTE_CAPABILITIES.programWorkspace]
  },
  {
    pattern: ['outcomes', 'map'],
    capabilities: [
      ROUTE_CAPABILITIES.instructorTeaching,
      ROUTE_CAPABILITIES.programWorkspace,
      ROUTE_CAPABILITIES.platformAdministration
    ]
  },
  {
    pattern: ['question-bank'],
    capabilities: [
      ROUTE_CAPABILITIES.instructorTeaching,
      ROUTE_CAPABILITIES.measurementWorkspace
    ]
  },
  {
    pattern: ['questions', ':id'],
    capabilities: [
      ROUTE_CAPABILITIES.instructorTeaching,
      ROUTE_CAPABILITIES.measurementWorkspace
    ]
  },
  {
    pattern: ['exam-builder'],
    capabilities: [
      ROUTE_CAPABILITIES.instructorTeaching,
      ROUTE_CAPABILITIES.measurementWorkspace
    ]
  },
  {
    pattern: ['exams'],
    capabilities: [
      ROUTE_CAPABILITIES.instructorTeaching,
      ROUTE_CAPABILITIES.measurementWorkspace
    ]
  },
  {
    pattern: ['exam-session', ':token'],
    capabilities: [ROUTE_CAPABILITIES.studentLearning]
  },
  {
    pattern: ['grading'],
    capabilities: [ROUTE_CAPABILITIES.instructorTeaching]
  },
  {
    pattern: ['grading', ':attemptId'],
    capabilities: [ROUTE_CAPABILITIES.instructorTeaching]
  },
  {
    pattern: ['student', ':id', 'analytics'],
    capabilities: [
      ROUTE_CAPABILITIES.studentLearning,
      ROUTE_CAPABILITIES.instructorTeaching,
      ROUTE_CAPABILITIES.programWorkspace
    ]
  },
  {
    pattern: ['cohort-analytics'],
    capabilities: [
      ROUTE_CAPABILITIES.instructorTeaching,
      ROUTE_CAPABILITIES.measurementWorkspace,
      ROUTE_CAPABILITIES.programWorkspace,
      ROUTE_CAPABILITIES.observerReports
    ]
  },
  {
    pattern: ['item-analysis'],
    capabilities: [
      ROUTE_CAPABILITIES.instructorTeaching,
      ROUTE_CAPABILITIES.measurementWorkspace
    ]
  },
  {
    pattern: ['audit-log'],
    capabilities: [
      ROUTE_CAPABILITIES.measurementWorkspace,
      ROUTE_CAPABILITIES.programWorkspace,
      ROUTE_CAPABILITIES.observerReports,
      ROUTE_CAPABILITIES.platformAdministration
    ]
  }
] as const);

const routeCapabilityPathMatches = (
  pattern: readonly string[],
  path: readonly string[]
): boolean => {
  if (pattern.length !== path.length) {
    return false;
  }

  for (let index = 0; index < pattern.length; index += 1) {
    const expectedSegment = pattern[index];
    if (expectedSegment !== undefined && !expectedSegment.startsWith(':') && expectedSegment !== path[index]) {
      return false;
    }
  }

  return true;
};

export function routeCapabilitiesForPath(
  path: readonly string[]
): readonly RouteCapability[] | undefined {
  for (const route of ROUTE_CAPABILITY_PATHS) {
    if (routeCapabilityPathMatches(route.pattern, path)) {
      return route.capabilities;
    }
  }

  return undefined;
}


export const ACTION_ROLE_POLICY: Readonly<Record<ActionPermissionCode, readonly RoleCode[]>> = deepFreeze({
  'view-own-learning': ['STUDENT'],
  'update-own-learning': ['STUDENT'],
  'manage-course': ['INSTRUCTOR'],
  'review-assessment': ['MEASUREMENT_SPECIALIST'],
  'manage-program': ['PROGRAM_MANAGER'],
  'view-authorized-reports': ['OBSERVER'],
  'manage-platform': ['PLATFORM_ADMINISTRATOR']
} as const satisfies Record<ActionPermissionCode, readonly RoleCode[]>);

export const ACTION_PERMISSIONS = deepFreeze({
  viewOwnLearning: {
    key: 'view-own-learning',
    allowedRoles: ACTION_ROLE_POLICY['view-own-learning'],
    mutating: false
  },
  updateOwnLearning: {
    key: 'update-own-learning',
    allowedRoles: ACTION_ROLE_POLICY['update-own-learning'],
    mutating: true
  },
  manageCourse: {
    key: 'manage-course',
    allowedRoles: ACTION_ROLE_POLICY['manage-course'],
    mutating: true
  },
  reviewAssessment: {
    key: 'review-assessment',
    allowedRoles: ACTION_ROLE_POLICY['review-assessment'],
    mutating: false
  },
  manageProgram: {
    key: 'manage-program',
    allowedRoles: ACTION_ROLE_POLICY['manage-program'],
    mutating: true
  },
  viewAuthorizedReports: {
    key: 'view-authorized-reports',
    allowedRoles: ACTION_ROLE_POLICY['view-authorized-reports'],
    mutating: false
  },
  managePlatform: {
    key: 'manage-platform',
    allowedRoles: ACTION_ROLE_POLICY['manage-platform'],
    mutating: true
  }
} as const satisfies Readonly<Record<string, ActionPermission>>);

export const DATA_SCOPE_ROLE_POLICY: Readonly<Record<DataScopeKind, readonly RoleCode[]>> = deepFreeze({
  student: ['STUDENT', 'INSTRUCTOR'],
  course: ['STUDENT', 'INSTRUCTOR', 'MEASUREMENT_SPECIALIST', 'PROGRAM_MANAGER'],
  cohort: ['STUDENT', 'INSTRUCTOR', 'PROGRAM_MANAGER', 'OBSERVER'],
  assessment: ['MEASUREMENT_SPECIALIST'],
  analytics: ['MEASUREMENT_SPECIALIST'],
  program: ['PROGRAM_MANAGER'],
  platform: ['PLATFORM_ADMINISTRATOR']
} as const satisfies Record<DataScopeKind, readonly RoleCode[]>);

const asAccountId = (value: string): AccountId => value as AccountId;

const mathCourseId = 'COURSE-MATH101-2025-FALL';
const mathCohortId = 'COHORT-MATH101-2025-FALL-A';
const mathStudentOneId = 'STUDENT-MATH101-2025-FALL-A-01';
const mathStudentTwoId = 'STUDENT-MATH101-2025-FALL-A-02';
const mathStudentThreeId = 'STUDENT-MATH101-2025-FALL-A-03';
const programId = 'PROGRAM-ADAPTIVE-LEARNING';

const demoAccounts = [
  {
    id: asAccountId('ACCOUNT-STUDENT-001'),
    handle: 'demo.student',
    displayLabel: 'Student Demo',
    roleCode: 'STUDENT',
    scopeGrants: [
      { kind: 'student', ids: [mathStudentOneId] },
      { kind: 'course', ids: [mathCourseId] },
      { kind: 'cohort', ids: [mathCohortId] }
    ]
  },
  {
    id: asAccountId('ACCOUNT-INSTRUCTOR-001'),
    handle: 'demo.instructor',
    displayLabel: 'Instructor Demo',
    roleCode: 'INSTRUCTOR',
    scopeGrants: [
      { kind: 'student', ids: [mathStudentOneId, mathStudentTwoId, mathStudentThreeId] },
      { kind: 'course', ids: [mathCourseId] },
      { kind: 'cohort', ids: [mathCohortId] }
    ]
  },
  {
    id: asAccountId('ACCOUNT-MEASUREMENT-001'),
    handle: 'demo.measurement',
    displayLabel: 'Measurement Specialist Demo',
    roleCode: 'MEASUREMENT_SPECIALIST',
    scopeGrants: [
      { kind: 'course', ids: [mathCourseId] },
      { kind: 'assessment', ids: [mathCourseId] },
      { kind: 'analytics', ids: [mathCourseId] }
    ]
  },
  {
    id: asAccountId('ACCOUNT-PROGRAM-001'),
    handle: 'demo.program',
    displayLabel: 'Program Manager Demo',
    roleCode: 'PROGRAM_MANAGER',
    scopeGrants: [
      { kind: 'program', ids: [programId] },
      { kind: 'course', ids: [mathCourseId] },
      { kind: 'cohort', ids: [mathCohortId] }
    ]
  },
  {
    id: asAccountId('ACCOUNT-OBSERVER-001'),
    handle: 'demo.observer',
    displayLabel: 'Observer Demo',
    roleCode: 'OBSERVER',
    scopeGrants: [{ kind: 'cohort', ids: [mathCohortId], readOnly: true }]
  },
  {
    id: asAccountId('ACCOUNT-ADMIN-001'),
    handle: 'demo.administrator',
    displayLabel: 'Platform Administrator Demo',
    roleCode: 'PLATFORM_ADMINISTRATOR',
    scopeGrants: [{ kind: 'platform', ids: [], global: true }]
  }
] as const satisfies readonly DemoAccount[];

export const DEMO_ACCOUNTS = deepFreeze(demoAccounts);

export function findDemoAccount(accountId: AccountId | string): DemoAccount | undefined {
  return DEMO_ACCOUNTS.find((account) => account.id === accountId);
}

const decision = (allowed: boolean, reason: AuthorizationReason): AuthorizationDecision =>
  Object.freeze({ allowed, reason });


function hasAuthenticatedRole(session: AuthSession | null | undefined): session is AuthSession {
  return session !== null && session !== undefined;
}

export function decideRouteAccess(
  session: AuthSession | null | undefined,
  capability: RouteCapability
): AuthorizationDecision {
  if (!hasAuthenticatedRole(session)) {
    return decision(false, 'unauthenticated');
  }

  const roles = ROUTE_ROLE_POLICY[capability?.key as RouteCapabilityCode];
  if (roles === undefined || !roles.includes(session.account.roleCode)) {
    return decision(false, 'role-denied');
  }

  return decision(true, 'allowed');
}

export function decideActionAccess(
  session: AuthSession | null | undefined,
  permission: ActionPermission
): AuthorizationDecision {
  if (!hasAuthenticatedRole(session)) {
    return decision(false, 'unauthenticated');
  }

  const roles = ACTION_ROLE_POLICY[permission?.key as ActionPermissionCode];
  if (roles === undefined || !roles.includes(session.account.roleCode)) {
    return decision(false, 'role-denied');
  }

  return decision(true, 'allowed');
}

export function decideDataScopeAccess(
  session: AuthSession | null | undefined,
  target: DataTarget
): AuthorizationDecision {
  let kind: unknown;
  let id: unknown;
  try {
    if (
      target === null ||
      typeof target !== 'object' ||
      Array.isArray(target)
    ) {
      return decision(false, 'scope-denied');
    }

    const targetRecord = target as object;
    kind = 'kind' in targetRecord ? targetRecord.kind : undefined;
    id = 'id' in targetRecord ? targetRecord.id : undefined;
  } catch {
    return decision(false, 'scope-denied');
  }

  if (
    typeof kind !== 'string' ||
    !DATA_SCOPE_KINDS.includes(kind as DataScopeKind) ||
    typeof id !== 'string' ||
    id.trim().length === 0
  ) {
    return decision(false, 'scope-denied');
  }

  if (!hasAuthenticatedRole(session)) {
    return decision(false, 'unauthenticated');
  }

  const typedKind = kind as DataScopeKind;
  const roles = DATA_SCOPE_ROLE_POLICY[typedKind];
  if (!roles.includes(session.account.roleCode)) {
    return decision(false, 'role-denied');
  }

  const hasGrant = session.account.scopeGrants.some(
    (grant) =>
      grant.kind === typedKind &&
      (grant.global === true || grant.ids.includes(id))
  );

  return hasGrant ? decision(true, 'allowed') : decision(false, 'scope-denied');
}
