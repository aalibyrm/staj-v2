declare const examSessionIdBrand: unique symbol;
declare const examSessionRouteTokenBrand: unique symbol;

export type ExamSessionId = string & { readonly [examSessionIdBrand]: 'ExamSessionId' };
export type ExamSessionRouteToken = string & { readonly [examSessionRouteTokenBrand]: 'ExamSessionRouteToken' };

export const asExamSessionId = (value: string): ExamSessionId => value as ExamSessionId;
export const asExamSessionRouteToken = (value: string): ExamSessionRouteToken => value as ExamSessionRouteToken;

export const EXAM_SESSION_STATES = Object.freeze([
  'created',
  'active',
  'disconnected',
  'reconnecting',
  'submitted',
  'expired',
  'terminated'
] as const);

export type ExamSessionState = (typeof EXAM_SESSION_STATES)[number];

export type ExamSessionDomainErrorCode =
  | 'validation'
  | 'invalid-transition'
  | 'same-state'
  | 'not-found'
  | 'conflict';

export class ExamSessionDomainError extends Error {
  override readonly name: string = 'ExamSessionDomainError';

  constructor(
    readonly code: ExamSessionDomainErrorCode,
    message: string,
    readonly target?: string
  ) {
    super(message);
  }
}

export type ExamSession = Readonly<{
  readonly id: ExamSessionId;
  readonly routeToken: ExamSessionRouteToken;
  readonly studentId: string;
  readonly examId: string;
  readonly state: ExamSessionState;
  readonly version: number;
  readonly createdAt: string;
  readonly startedAt: string;
  readonly referenceTime: string;
  readonly durationMs: number;
}>;

export type ExamSessionCreateInput = Readonly<{
  readonly id?: ExamSessionId | string;
  readonly routeToken?: ExamSessionRouteToken | string;
  readonly studentId: string;
  readonly examId: string;
  readonly state?: ExamSessionState;
  readonly version?: number;
  readonly createdAt: string;
  readonly startedAt: string;
  readonly referenceTime: string;
  readonly durationMs: number;
}>;

const nonblank = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const validateExamSessionDurationMs = (value: unknown, field = 'durationMs'): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new ExamSessionDomainError('validation', `${field} must be a positive safe integer in milliseconds.`, field);
  }
  return value;
};

const requiredText = (value: unknown, field: string): string => {
  if (!nonblank(value)) {
    throw new ExamSessionDomainError('validation', `${field} must be a nonblank string.`, field);
  }
  return value.trim();
};

const isExamSessionState = (value: unknown): value is ExamSessionState =>
  typeof value === 'string' && (EXAM_SESSION_STATES as readonly string[]).includes(value);

const requiredIdentifier = (value: unknown, field: string): string => requiredText(value, field);

export const createExamSession = (input: ExamSessionCreateInput): ExamSession => {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ExamSessionDomainError('validation', 'Exam session input must be an object.');
  }

  const source = input;
  const id = requiredIdentifier(source['id'], 'id');
  const routeToken = requiredIdentifier(source['routeToken'], 'routeToken');
  const studentId = requiredIdentifier(source['studentId'], 'studentId');
  const examId = requiredIdentifier(source['examId'], 'examId');
  const rawState = source['state'] ?? 'created';
  const state = isExamSessionState(rawState)
    ? rawState
    : (() => {
      throw new ExamSessionDomainError('validation', 'state must be a supported exam-session state.', 'state');
    })();
  const rawVersion = source['version'] ?? 1;
  if (typeof rawVersion !== 'number' || !Number.isSafeInteger(rawVersion) || rawVersion < 1) {
    throw new ExamSessionDomainError('validation', 'version must be a positive safe integer.', 'version');
  }
  const createdAt = requiredText(source['createdAt'], 'createdAt');
  const startedAt = requiredText(source['startedAt'], 'startedAt');
  const referenceTime = requiredText(source['referenceTime'], 'referenceTime');
  const durationMs = validateExamSessionDurationMs(source.durationMs);

  const candidate: {
    id: ExamSessionId;
    routeToken: ExamSessionRouteToken;
    studentId: string;
    examId: string;
    state: ExamSessionState;
    version: number;
    createdAt: string;
    startedAt: string;
    referenceTime: string;
    durationMs: number;
  } = {
    id: asExamSessionId(id),
    routeToken: asExamSessionRouteToken(routeToken),
    studentId,
    examId,
    state,
    version: rawVersion,
    createdAt,
    startedAt,
    referenceTime,
    durationMs
  };
  return Object.freeze(candidate);
};

export const isExamSessionStateValue = (value: unknown): value is ExamSessionState => isExamSessionState(value);
