import { defer, of, type Observable } from 'rxjs';

import {
  asExamSessionId,
  asExamSessionRouteToken,
  createExamSession,
  ExamSessionDomainError,
  type ExamSession,
  type ExamSessionId,
  type ExamSessionRouteToken,
  type ExamSessionState
} from '../models/exam-session.models';
import {
  EXAM_SESSION_NONTERMINAL_STATES,
  transitionExamSession
} from '../domain/exam-session-state-machine';

export type ExamSessionSource = () => string;

export type ExamSessionRepositoryOptions = Readonly<{
  readonly idSource?: ExamSessionSource;
  readonly tokenSource?: ExamSessionSource;
  readonly referenceTimeSource?: ExamSessionSource;
}>;

export type ExamSessionOpenInput = Readonly<{
  readonly id?: ExamSessionId | string;
  readonly routeToken?: ExamSessionRouteToken | string;
  readonly studentId: string;
  readonly examId: string;
  readonly createdAt?: string;
  readonly startedAt?: string;
  readonly referenceTime?: string;
}>;

export type ExamSessionTransitionOptions = Readonly<{
  readonly expectedVersion?: number;
}>;

export type ExamSessionRepositorySnapshot = Readonly<{
  readonly sessions: readonly ExamSession[];
}>;

export type ExamSessionRepositoryErrorCode = 'not-found' | 'conflict' | 'validation';

export class ExamSessionRepositoryError extends ExamSessionDomainError {
  override readonly name: string = 'ExamSessionRepositoryError';

  constructor(
    code: ExamSessionRepositoryErrorCode,
    message: string,
    target?: string,
    readonly reason?: 'duplicate-active-session' | 'stale-version' | 'duplicate-id' | 'duplicate-token'
  ) {
    super(code, message, target);
  }
}

const nonblank = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const normalizeText = (value: unknown, field: string): string => {
  if (!nonblank(value)) {
    throw new ExamSessionRepositoryError('validation', `${field} must be a nonblank string.`, field);
  }
  return value.trim();
};

const pairKey = (studentId: string, examId: string): string => JSON.stringify([studentId, examId]);

const isNonterminal = (state: ExamSessionState): boolean =>
  EXAM_SESSION_NONTERMINAL_STATES.includes(state as (typeof EXAM_SESSION_NONTERMINAL_STATES)[number]);

const defaultReferenceTimeSource: ExamSessionSource = (): string => new Date().toISOString();

let fallbackTokenSequence = 0;
const defaultTokenSource: ExamSessionSource = (): string => {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid !== undefined) return `exam-session-${randomUuid}`;
  fallbackTokenSequence += 1;
  return `exam-session-${Math.random().toString(36).slice(2)}-${fallbackTokenSequence}`;
};

export class ExamSessionRepository {
  private readonly sessions = new Map<ExamSessionId, ExamSession>();
  private readonly tokenIndex = new Map<ExamSessionRouteToken, ExamSessionId>();
  private readonly activePairIndex = new Map<string, ExamSessionId>();
  private readonly idSource: ExamSessionSource;
  private readonly tokenSource: ExamSessionSource;
  private readonly referenceTimeSource: ExamSessionSource;
  private sequence = 1;

  constructor(options: ExamSessionRepositoryOptions = {}) {
    this.idSource = options.idSource ?? (() => `exam-session-${this.sequence++}`);
    this.tokenSource = options.tokenSource ?? defaultTokenSource;
    this.referenceTimeSource = options.referenceTimeSource ?? defaultReferenceTimeSource;
  }

  open(input: ExamSessionOpenInput): Observable<ExamSession> {
    return defer(() => {
      if (input === null || typeof input !== 'object' || Array.isArray(input)) {
        throw new ExamSessionRepositoryError('validation', 'Exam session open input must be an object.');
      }

      const studentId = normalizeText(input.studentId, 'studentId');
      const examId = normalizeText(input.examId, 'examId');
      const key = pairKey(studentId, examId);
      const existingId = this.activePairIndex.get(key);
      if (existingId !== undefined) {
        const existing = this.sessions.get(existingId);
        if (existing !== undefined && isNonterminal(existing.state)) {
          throw new ExamSessionRepositoryError(
            'conflict',
            `Student ${studentId} already has an active session for exam ${examId}.`,
            existing.id,
            'duplicate-active-session'
          );
        }
      }

      const requestedId = input.id;
      const id = this.nextId(requestedId);
      const requestedToken = input.routeToken;
      const routeToken = this.nextToken(requestedToken);
      const generatedReferenceTime = input.referenceTime ?? this.referenceTimeSource();
      const createdAt = input.createdAt ?? generatedReferenceTime;
      const startedAt = input.startedAt ?? createdAt;
      const candidate = createExamSession({
        id,
        routeToken,
        studentId,
        examId,
        state: 'created',
        version: 1,
        createdAt,
        startedAt,
        referenceTime: generatedReferenceTime
      });

      this.sessions.set(candidate.id, candidate);
      this.tokenIndex.set(candidate.routeToken, candidate.id);
      this.activePairIndex.set(key, candidate.id);
      return of(candidate);
    });
  }

  resolveByToken(token: ExamSessionRouteToken | string): Observable<ExamSession> {
    return defer(() => of(this.lookupByToken(token)));
  }

  getById(id: ExamSessionId | string): Observable<ExamSession> {
    return defer(() => {
      const normalizedId = normalizeText(id, 'id');
      const session = this.sessions.get(asExamSessionId(normalizedId));
      if (session === undefined) {
        throw new ExamSessionRepositoryError('not-found', `Exam session ${normalizedId} was not found.`, normalizedId);
      }
      return of(session);
    });
  }

  transition(
    idOrToken: ExamSessionId | ExamSessionRouteToken | string,
    nextState: ExamSessionState,
    options: ExamSessionTransitionOptions | number = {}
  ): Observable<ExamSession> {
    return defer(() => {
      const identifier = normalizeText(idOrToken, 'session identifier');
      const current = this.findByIdOrToken(identifier);
      if (current === undefined) {
        throw new ExamSessionRepositoryError('not-found', `Exam session ${identifier} was not found.`, identifier);
      }

      const expectedVersion = typeof options === 'number' ? options : options.expectedVersion;
      if (expectedVersion !== current.version) {
        throw new ExamSessionRepositoryError(
          'conflict',
          `Exam session ${current.id} changed elsewhere. Reload before transitioning it.`,
          current.id,
          'stale-version'
        );
      }

      const updated = transitionExamSession(current, nextState);
      const key = pairKey(current.studentId, current.examId);
      if (isNonterminal(updated.state)) {
        this.activePairIndex.set(key, updated.id);
      } else if (this.activePairIndex.get(key) === updated.id) {
        this.activePairIndex.delete(key);
      }
      this.sessions.set(updated.id, updated);
      return of(updated);
    });
  }

  getSnapshot(): ExamSessionRepositorySnapshot {
    const sessions = [...this.sessions.values()].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    return Object.freeze({ sessions: Object.freeze(sessions) });
  }

  private nextId(requested: ExamSessionId | string | undefined): ExamSessionId {
    if (requested !== undefined) {
      const normalized = normalizeText(requested, 'id');
      const id = asExamSessionId(normalized);
      if (this.sessions.has(id)) {
        throw new ExamSessionRepositoryError('conflict', `Exam session ${normalized} already exists.`, normalized, 'duplicate-id');
      }
      return id;
    }

    const base = normalizeText(this.idSource(), 'id source');
    let candidate = base;
    let suffix = 2;
    while (this.sessions.has(asExamSessionId(candidate))) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    return asExamSessionId(candidate);
  }

  private nextToken(requested: ExamSessionRouteToken | string | undefined): ExamSessionRouteToken {
    if (requested !== undefined) {
      const normalized = normalizeText(requested, 'routeToken');
      const token = asExamSessionRouteToken(normalized);
      if (this.tokenIndex.has(token)) {
        throw new ExamSessionRepositoryError('conflict', `Route token ${normalized} already exists.`, normalized, 'duplicate-token');
      }
      return token;
    }

    const base = normalizeText(this.tokenSource(), 'token source');
    let candidate = base;
    let suffix = 2;
    while (this.tokenIndex.has(asExamSessionRouteToken(candidate))) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    return asExamSessionRouteToken(candidate);
  }

  private lookupByToken(token: ExamSessionRouteToken | string): ExamSession {
    const normalized = normalizeText(token, 'routeToken');
    const sessionId = this.tokenIndex.get(asExamSessionRouteToken(normalized));
    if (sessionId === undefined) {
      throw new ExamSessionRepositoryError('not-found', `No exam session was found for route token ${normalized}.`, normalized);
    }
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      throw new ExamSessionRepositoryError('not-found', `No exam session was found for route token ${normalized}.`, normalized);
    }
    return session;
  }

  private findByIdOrToken(identifier: string): ExamSession | undefined {
    const byId = this.sessions.get(asExamSessionId(identifier));
    if (byId !== undefined) return byId;
    const sessionId = this.tokenIndex.get(asExamSessionRouteToken(identifier));
    return sessionId === undefined ? undefined : this.sessions.get(sessionId);
  }
}
