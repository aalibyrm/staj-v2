import { Injectable, Optional } from '@angular/core';
import { defer, map, type Observable } from 'rxjs';

import { DEFAULT_MOCK_SCENARIO, MockTransport, type MockScenarioControls } from '../../../core/api/mock-transport';
import { SessionStore } from '../../../core/auth/session.store';
import { DATA_SCOPE_KINDS, ROLE_CODES, type AuthSession, type RoleCode } from '../../../core/auth/authorization';
import {
  asExamId,
  asExamVersionId,
  createExam,
  cloneExam,
  normalizeExamSettings,
  questionCoverageFromVersions,
  validateExamPublication,
  validateExamQuestionVersions,
  type Exam,
  type ExamId,
  type ExamVersionId,
  type ExamCreateInput,
  type ExamPublishInput,
  type ExamRepositoryOperationOptions,
  type ExamRuleInput,
  type ExamStatus,
  type ExamSuccessorInput,
  type ExamUpdateInput,
  ExamWorkflowError,
  type ExamWorkflowErrorCode
} from '../models/exam.models';
import { compareExamBlueprint, createExamBlueprint, type ExamBlueprint } from '../models/exam-blueprint.models';
import type { QuestionVersion } from '../../question-bank/models/question.models';

export class ExamWorkflowRepositoryError extends ExamWorkflowError {
  override readonly name: string = 'ExamWorkflowRepositoryError';
  constructor(code: ExamWorkflowErrorCode, message: string, id?: ExamId | string) {
    super(code, message, id);
  }
}

export type ExamRepositorySnapshot = Readonly<{
  readonly current: readonly Exam[];
  readonly history: readonly Exam[];
}>;

const WRITE_ROLES: readonly RoleCode[] = ['INSTRUCTOR', 'MEASUREMENT_SPECIALIST', 'PROGRAM_MANAGER'];
const isWriteRole = (session: AuthSession | null): boolean => session !== null && WRITE_ROLES.includes(session.account.roleCode);
const now = (): string => new Date().toISOString();
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isAuthSession = (value: unknown): value is AuthSession => {
  if (!isRecord(value) || typeof value['accountId'] !== 'string' || !isRecord(value['account'])) return false;
  const account = value['account'];
  if (account['id'] !== value['accountId'] || typeof account['id'] !== 'string' || typeof account['handle'] !== 'string' ||
    typeof account['displayLabel'] !== 'string' || typeof account['roleCode'] !== 'string' ||
    !(ROLE_CODES as readonly string[]).includes(account['roleCode']) || !Array.isArray(account['scopeGrants'])) return false;
  return account['scopeGrants'].every((grant) => {
    if (!isRecord(grant) || typeof grant['kind'] !== 'string' || !(DATA_SCOPE_KINDS as readonly string[]).includes(grant['kind']) ||
      !Array.isArray(grant['ids']) || grant['ids'].some((id) => typeof id !== 'string')) return false;
    return (grant['global'] === undefined || typeof grant['global'] === 'boolean') &&
      (grant['readOnly'] === undefined || typeof grant['readOnly'] === 'boolean');
  });
};
const normalizedNote = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const idSort = (left: { readonly id: string }, right: { readonly id: string }): number => left.id < right.id ? -1 : left.id > right.id ? 1 : 0;

const snapshotsOf = (input: ExamCreateInput | ExamUpdateInput | Record<string, unknown>): readonly QuestionVersion[] => {
  const source = input as Record<string, unknown>;
  const raw = source['questionVersions'] ?? source['questionSnapshots'] ?? source['pinnedQuestionVersions'];
  return Array.isArray(raw) ? raw as readonly QuestionVersion[] : [];
};

@Injectable({ providedIn: 'root' })
export class ExamRepository {
  private readonly transport: MockTransport;
  private readonly sessionStore: SessionStore;
  private readonly currentEntities = new Map<ExamId, Exam>();
  private readonly publishedHistory = new Map<ExamId, Exam[]>();
  private scenarioControls: MockScenarioControls = { ...DEFAULT_MOCK_SCENARIO };
  private sequence = 1;

  constructor(
    @Optional() transport: MockTransport | null = null,
    @Optional() sessionStore: SessionStore | null = null
  ) {
    this.transport = transport ?? new MockTransport();
    this.sessionStore = sessionStore ?? new SessionStore();
  }

  createDraft(input: ExamCreateInput, options: ExamRepositoryOperationOptions = {}): Observable<Exam> {
    return defer(() => {
      const session = this.sessionFor(options);
      const request = { method: 'POST' as const, url: '/exams', body: input };
      this.assertAuthorized(session, request.url);
      const id = asExamId(typeof input?.id === 'string' && input.id.trim().length > 0 ? input.id.trim() : `EXAM-${this.sequence++}`);
      const normalized = this.normalizeCreate(input, id, session);
      return this.execute(request.method, request.url, normalized, () => {
        if (this.currentEntities.has(id)) throw this.error('conflict', 'An exam with this ID already exists.', id);
        this.currentEntities.set(id, normalized);
        return cloneExam(normalized);
      }, options);
    });
  }

  createExamDraft(input: ExamCreateInput, options: ExamRepositoryOperationOptions = {}): Observable<Exam> {
    return this.createDraft(input, options);
  }

  getCurrent(id: ExamId | string, options: ExamRepositoryOperationOptions = {}): Observable<Exam> {
    return defer(() => {
      this.assertAuthorized(this.sessionFor(options), String(id));
      return this.execute('GET', `/exams/${String(id)}`, undefined, () => {
        const exam = this.currentEntities.get(asExamId(String(id)));
        if (exam === undefined) throw this.error('not-found', 'The exam does not exist.', id);
        return cloneExam(exam);
      }, options);
    });
  }

  getExam(id: ExamId | string, options: ExamRepositoryOperationOptions = {}): Observable<Exam> {
    return this.getCurrent(id, options);
  }

  listVersionHistory(id: ExamId | string, options: ExamRepositoryOperationOptions = {}): Observable<readonly Exam[]> {
    return defer(() => {
      this.assertAuthorized(this.sessionFor(options), String(id));
      return this.execute('GET', `/exams/${String(id)}/versions`, undefined, () => {
        if (!this.currentEntities.has(asExamId(String(id)))) throw this.error('not-found', 'The exam does not exist.', id);
        return Object.freeze([...(this.publishedHistory.get(asExamId(String(id))) ?? [])].sort((left, right) => left.version - right.version).map(cloneExam));
      }, options);
    });
  }

  getVersionHistory(id: ExamId | string, options: ExamRepositoryOperationOptions = {}): Observable<readonly Exam[]> {
    return this.listVersionHistory(id, options);
  }

  getExamVersionHistory(id: ExamId | string, options: ExamRepositoryOperationOptions = {}): Observable<readonly Exam[]> {
    return this.listVersionHistory(id, options);
  }

  updateDraft(id: ExamId | string, input: ExamUpdateInput, options: ExamRepositoryOperationOptions = {}): Observable<Exam> {
    return defer(() => {
      const session = this.sessionFor(options);
      const request = { method: 'PATCH' as const, url: `/exams/${String(id)}`, body: input };
      this.assertAuthorized(session, request.url);
      const current = this.currentEntities.get(asExamId(String(id)));
      if (current === undefined) throw this.error('not-found', 'The exam does not exist.', id);
      this.assertExpectedVersion(current, options.expectedVersion, id);
      if (current.status !== 'draft') throw this.error('immutable', 'Published exams cannot be edited directly; create an editable successor.', id);
      const normalized = this.normalizeUpdate(current, input, session);
      return this.execute(request.method, request.url, normalized, () => {
        const latest = this.currentEntities.get(current.id);
        if (latest === undefined) throw this.error('not-found', 'The exam does not exist.', id);
        this.assertExpectedVersion(latest, options.expectedVersion, id);
        if (latest.status !== 'draft') throw this.error('immutable', 'Published exams cannot be edited directly; create an editable successor.', id);
        const next = this.normalizeUpdate(latest, input, session);
        const updated = this.buildExam({ ...next, id: latest.id, version: latest.version + 1, versionId: asExamVersionId(`${latest.id}-v${latest.version + 1}`), createdAt: latest.createdAt, updatedAt: now(), status: 'draft', publishedAt: null, publishedBy: null, changeNote: latest.changeNote });
        this.currentEntities.set(latest.id, updated);
        return cloneExam(updated);
      }, options);
    });
  }

  updateExam(id: ExamId | string, input: ExamUpdateInput, options: ExamRepositoryOperationOptions = {}): Observable<Exam> {
    return this.updateDraft(id, input, options);
  }

  publish(id: ExamId | string, input: ExamPublishInput = {}, options: ExamRepositoryOperationOptions = {}): Observable<Exam> {
    return defer(() => {
      const session = this.sessionFor(options);
      const request = { method: 'POST' as const, url: `/exams/${String(id)}/publish`, body: input };
      this.assertAuthorized(session, request.url);
      const current = this.currentEntities.get(asExamId(String(id)));
      if (current === undefined) throw this.error('not-found', 'The exam does not exist.', id);
      this.assertExpectedVersion(current, options.expectedVersion, id);
      if (current.status !== 'draft') throw this.error('immutable', 'Only a draft exam can be published.', id);
      const issues = validateExamPublication(current.blueprint, current.questionVersions);
      if (issues.length > 0) throw this.error('validation', issues[0]?.message ?? 'The exam is not ready to publish.', id);
      return this.execute(request.method, request.url, { changeNote: normalizedNote(input.changeNote) || 'Initial publication' }, () => {
        const latest = this.currentEntities.get(current.id);
        if (latest === undefined) throw this.error('not-found', 'The exam does not exist.', id);
        this.assertExpectedVersion(latest, options.expectedVersion, id);
        if (latest.status !== 'draft') throw this.error('immutable', 'Only a draft exam can be published.', id);
        const timestamp = now();
        const published = this.buildExam({ ...latest, status: 'published', updatedAt: timestamp, publishedAt: timestamp, publishedBy: session?.accountId ?? null, changeNote: normalizedNote(input.changeNote) || 'Initial publication' });
        const history = this.publishedHistory.get(latest.id) ?? [];
        history.push(published);
        this.publishedHistory.set(latest.id, history);
        this.currentEntities.set(latest.id, published);
        return cloneExam(published);
      }, options);
    });
  }

  publishExam(id: ExamId | string, input: ExamPublishInput = {}, options: ExamRepositoryOperationOptions = {}): Observable<Exam> {
    return this.publish(id, input, options);
  }

  createSuccessor(id: ExamId | string, input: ExamSuccessorInput, options: ExamRepositoryOperationOptions = {}): Observable<Exam> {
    return defer(() => {
      const session = this.sessionFor(options);
      const request = { method: 'POST' as const, url: `/exams/${String(id)}/successors`, body: input };
      this.assertAuthorized(session, request.url);
      const note = normalizedNote(input?.changeNote);
      if (note.length === 0) throw this.error('validation', 'A nonblank change note is required to create a successor.', id);
      const current = this.currentEntities.get(asExamId(String(id)));
      if (current === undefined) throw this.error('not-found', 'The exam does not exist.', id);
      this.assertExpectedVersion(current, options.expectedVersion, id);
      if (current.status !== 'published') throw this.error('immutable', 'Only a published exam can create an editable successor.', id);
      return this.execute(request.method, request.url, { changeNote: note }, () => {
        const latest = this.currentEntities.get(current.id);
        if (latest === undefined) throw this.error('not-found', 'The exam does not exist.', id);
        this.assertExpectedVersion(latest, options.expectedVersion, id);
        if (latest.status !== 'published') throw this.error('immutable', 'Only a published exam can create an editable successor.', id);
        const timestamp = now();
        const successor = this.buildExam({
          ...latest,
          version: latest.version + 1,
          versionId: asExamVersionId(`${latest.id}-v${latest.version + 1}`),
          status: 'draft',
          updatedAt: timestamp,
          publishedAt: null,
          publishedBy: null,
          changeNote: note,
          questionVersions: latest.questionVersions.map((version) => version)
        });
        this.currentEntities.set(latest.id, successor);
        return cloneExam(successor);
      }, options);
    });
  }

  createExamSuccessor(id: ExamId | string, input: ExamSuccessorInput, options: ExamRepositoryOperationOptions = {}): Observable<Exam> {
    return this.createSuccessor(id, input, options);
  }

  setMockScenario(controls: Partial<MockScenarioControls>): void {
    this.scenarioControls = Object.freeze({ ...this.scenarioControls, ...controls });
  }
  setMockControls(controls: Partial<MockScenarioControls>): void { this.setMockScenario(controls); }
  resetMockScenario(): void { this.scenarioControls = { ...DEFAULT_MOCK_SCENARIO }; }
  getMockScenario(): Readonly<MockScenarioControls> { return Object.freeze({ ...this.scenarioControls }); }

  getSnapshot(): ExamRepositorySnapshot {
    const current = [...this.currentEntities.values()].sort(idSort).map(cloneExam);
    const history: Exam[] = [];
    for (const entries of this.publishedHistory.values()) history.push(...entries.map(cloneExam));
    history.sort((left, right) => left.id === right.id ? left.version - right.version : idSort(left, right));
    return Object.freeze({ current: Object.freeze(current), history: Object.freeze(history) });
  }

  private sessionFor(options: ExamRepositoryOperationOptions): AuthSession | null {
    const candidate = options.session;
    if (isAuthSession(candidate)) return candidate;
    return this.sessionStore.session();
  }

  private assertAuthorized(session: AuthSession | null, id: string): void {
    if (!isWriteRole(session)) throw this.error('unauthorized', 'You are not authorized to operate on exams.', id);
  }

  private assertExpectedVersion(current: Exam, expected: number | undefined, id: ExamId | string): void {
    if (!Number.isSafeInteger(expected) || expected !== current.version) throw this.error('conflict', 'The exam version is stale.', id);
  }

  private normalizeCreate(input: ExamCreateInput, id: ExamId, session: AuthSession | null): Exam {
    const timestamp = now();
    const blueprint = createExamBlueprint(input.blueprint);
    const settings = normalizeExamSettings({ title: input.title, durationMinutes: input.durationMinutes, rules: input.rules ?? [] });
    const versions = snapshotsOf(input);
    if (settings === null || blueprint === null) throw this.error('validation', 'Title, duration, rules, and blueprint settings are invalid.', id);
    const validation = validateExamQuestionVersions(versions);
    if (validation.length > 0) throw this.error('validation', validation[0]?.message ?? 'Pinned question versions are invalid.', id);
    return this.buildExam({ id, versionId: asExamVersionId(`${id}-v1`), version: 1, status: 'draft', ...settings, blueprint, questionVersions: versions, createdAt: timestamp, updatedAt: timestamp, publishedAt: null, publishedBy: session?.accountId ?? null, changeNote: '' });
  }

  private normalizeUpdate(current: Exam, input: ExamUpdateInput, _session: AuthSession | null): Omit<Exam, 'updatedAt'> & { updatedAt?: string } {
    const source = input as Record<string, unknown>;
    const settings = normalizeExamSettings({ title: source['title'] ?? current.title, durationMinutes: source['durationMinutes'] ?? current.durationMinutes, rules: source['rules'] ?? current.rules });
    const blueprint = createExamBlueprint(source['blueprint'] ?? current.blueprint);
    const versions = source['questionVersions'] !== undefined || source['questionSnapshots'] !== undefined || source['pinnedQuestionVersions'] !== undefined ? snapshotsOf(input) : current.questionVersions;
    if (settings === null || blueprint === null) throw this.error('validation', 'Title, duration, rules, and blueprint settings are invalid.', current.id);
    const validation = validateExamQuestionVersions(versions);
    if (validation.length > 0) throw this.error('validation', validation[0]?.message ?? 'Pinned question versions are invalid.', current.id);
    return { ...current, ...settings, blueprint, questionVersions: versions };
  }

  private buildExam(input: {
    readonly id: ExamId;
    readonly versionId: ExamVersionId;
    readonly version: number;
    readonly status: ExamStatus;
    readonly title: string;
    readonly durationMinutes: number;
    readonly rules: readonly ExamRuleInput[];
    readonly blueprint: unknown;
    readonly questionVersions: readonly QuestionVersion[];
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly publishedAt?: string | null;
    readonly publishedBy?: string | null;
    readonly changeNote?: string;
  }): Exam {
    const exam = createExam(input);
    if (exam === null) throw this.error('validation', 'The exam aggregate is invalid.', input.id);
    return exam;
  }

  private execute<T>(method: 'GET' | 'POST' | 'PATCH', url: string, body: unknown, factory: () => T, options: ExamRepositoryOperationOptions): Observable<T> {
    const { expectedVersion: _expectedVersion, session: _session, ...controls } = options;
    return this.transport.execute({ method, url, body }, factory, { ...this.scenarioControls, ...controls }).pipe(map((response) => response.body));
  }

  private error(code: ExamWorkflowErrorCode, message: string, id?: ExamId | string): ExamWorkflowRepositoryError {
    return new ExamWorkflowRepositoryError(code, message, id);
  }
}

export { compareExamBlueprint, questionCoverageFromVersions };
export type { ExamBlueprint };
