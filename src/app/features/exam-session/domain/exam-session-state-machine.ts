import {
  createExamSession,
  ExamSessionDomainError,
  isExamSessionStateValue,
  type ExamSession,
  type ExamSessionState
} from '../models/exam-session.models';

export const EXAM_SESSION_TRANSITIONS: Readonly<Record<ExamSessionState, readonly ExamSessionState[]>> = Object.freeze({
  created: Object.freeze(['active', 'terminated'] as const),
  active: Object.freeze(['disconnected', 'submitted', 'expired', 'terminated'] as const),
  disconnected: Object.freeze(['reconnecting', 'submitted', 'expired', 'terminated'] as const),
  reconnecting: Object.freeze(['active', 'disconnected', 'submitted', 'expired', 'terminated'] as const),
  submitted: Object.freeze([] as const),
  expired: Object.freeze([] as const),
  terminated: Object.freeze([] as const)
});

export type ExamSessionTransitionErrorCode = 'invalid-transition' | 'same-state';

export class ExamSessionStateMachineError extends ExamSessionDomainError {
  override readonly name: string = 'ExamSessionStateMachineError';

  constructor(
    code: ExamSessionTransitionErrorCode,
    message: string,
    readonly from: unknown,
    readonly to: unknown,
    sessionId?: string
  ) {
    super(code, message, sessionId);
  }
}

export const canTransitionExamSession = (from: unknown, to: unknown): boolean => {
  if (!isExamSessionStateValue(from) || !isExamSessionStateValue(to)) return false;
  return from === to || EXAM_SESSION_TRANSITIONS[from].includes(to);
};

export const transitionExamSession = (session: ExamSession, nextState: ExamSessionState): ExamSession => {
  if (session.state === nextState) {
    return session;
  }

  if (!isExamSessionStateValue(nextState) || !isExamSessionStateValue(session.state) ||
    !EXAM_SESSION_TRANSITIONS[session.state].includes(nextState)) {
    throw new ExamSessionStateMachineError(
      'invalid-transition',
      `Exam session cannot transition from ${String(session.state)} to ${String(nextState)}.`,
      session.state,
      nextState,
      session.id
    );
  }

  if (!Number.isSafeInteger(session.version) || session.version >= Number.MAX_SAFE_INTEGER) {
    throw new ExamSessionDomainError('validation', 'Exam session version cannot be incremented safely.', session.id);
  }

  return createExamSession({
    id: session.id,
    routeToken: session.routeToken,
    studentId: session.studentId,
    examId: session.examId,
    state: nextState,
    version: session.version + 1,
    createdAt: session.createdAt,
    startedAt: session.startedAt,
    referenceTime: session.referenceTime,
    durationMs: session.durationMs
  });
};

export const EXAM_SESSION_TERMINAL_STATES = Object.freeze([
  'submitted',
  'expired',
  'terminated'
] as const);

export const EXAM_SESSION_NONTERMINAL_STATES = Object.freeze([
  'created',
  'active',
  'disconnected',
  'reconnecting'
] as const);

export const isExamSessionTerminalState = (state: ExamSessionState): boolean =>
  EXAM_SESSION_TERMINAL_STATES.includes(state as (typeof EXAM_SESSION_TERMINAL_STATES)[number]);
