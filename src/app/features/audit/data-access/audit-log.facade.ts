import { Injectable, Optional, computed, signal, type Signal } from '@angular/core';
import { catchError, defer, map, throwError, type Observable } from 'rxjs';

import { normalizeApplicationError } from '../../../core/api/api-error';
import { SessionStore } from '../../../core/auth/session.store';
import type { RoleCode } from '../../../core/auth/authorization';
import {
  canExportAuditLog,
  redactAuditRecord,
  selectAuditPage,
  summarizeAuditActivity,
  DEFAULT_AUDIT_LOG_QUERY,
  type AuditActivitySummary,
  type AuditLogPage,
  type AuditLogQuery
} from '../domain/audit-log-query';
import { AuditLogRepository } from './audit-log.repository';
import type { AuditLogRecord } from '../models/audit-log.models';

/** The four route-capable roles allowed to view the audit log, per `adaptive-learning.routes.ts`. */
const ALLOWED_VIEWER_ROLES: Readonly<Partial<Record<RoleCode, true>>> = Object.freeze({
  MEASUREMENT_SPECIALIST: true,
  PROGRAM_MANAGER: true,
  OBSERVER: true,
  PLATFORM_ADMINISTRATOR: true
});

type AuditLogTransportStatus = 'idle' | 'loading' | 'success' | 'error' | 'unauthorized';

type AuditLogTransportState = Readonly<{
  readonly status: AuditLogTransportStatus;
  readonly message?: string;
  readonly retryable?: boolean;
}>;

export type AuditLogRequestStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error' | 'unauthorized';

export type AuditLogRequestState = Readonly<{
  readonly status: AuditLogRequestStatus;
  readonly message?: string;
  readonly retryable?: boolean;
}>;

export class AuditLogFacadeError extends Error {
  override readonly name = 'AuditLogFacadeError';

  constructor(
    readonly code: 'unauthorized',
    message: string
  ) {
    super(message);
  }
}

const EMPTY_RECORDS: readonly AuditLogRecord[] = Object.freeze([]);
const IDLE_TRANSPORT_STATE: AuditLogTransportState = Object.freeze({ status: 'idle' });
const UNAUTHORIZED_MESSAGE = 'You are not authorized to view the audit log.';

const stateForError = (error: unknown): AuditLogTransportState => {
  const normalized = normalizeApplicationError(error);
  if (normalized.kind === 'unauthorized') {
    return Object.freeze({ status: 'unauthorized', message: normalized.userMessage, retryable: false });
  }
  return Object.freeze({ status: 'error', message: normalized.userMessage, retryable: normalized.retryable });
};

@Injectable({ providedIn: 'root' })
export class AuditLogFacade {
  private readonly repository: AuditLogRepository;
  private readonly sessionStore: SessionStore;
  private readonly transportStateState = signal<AuditLogTransportState>(IDLE_TRANSPORT_STATE);
  private readonly recordsState = signal<readonly AuditLogRecord[]>(EMPTY_RECORDS);
  private readonly queryState = signal<AuditLogQuery>(DEFAULT_AUDIT_LOG_QUERY);
  private readonly selectedIdState = signal<string | null>(null);
  private requestRevision = 0;
  private lastQuery: AuditLogQuery = DEFAULT_AUDIT_LOG_QUERY;

  readonly records: Signal<readonly AuditLogRecord[]> = this.recordsState.asReadonly();
  readonly query: Signal<AuditLogQuery> = this.queryState.asReadonly();
  readonly page: Signal<AuditLogPage> = computed(() => selectAuditPage(this.recordsState(), this.queryState()));
  readonly summary: Signal<AuditActivitySummary> = computed(() => summarizeAuditActivity(this.recordsState()));
  readonly viewerRole: Signal<RoleCode | null> = computed(() => this.sessionStore.session()?.account.roleCode ?? null);
  readonly canExport: Signal<boolean> = computed(() => canExportAuditLog(this.viewerRole()));
  readonly selectedRecord: Signal<AuditLogRecord | null> = computed(() => {
    const id = this.selectedIdState();
    if (id === null) return null;
    return this.recordsState().find((record) => record.id === id) ?? null;
  });
  readonly requestState: Signal<AuditLogRequestState> = computed(() => {
    const transport = this.transportStateState();
    if (transport.status !== 'success') return transport as AuditLogRequestState;
    return Object.freeze({ status: this.page().total === 0 ? ('empty' as const) : ('ready' as const) });
  });

  constructor(
    @Optional() repository: AuditLogRepository | null = null,
    @Optional() session: SessionStore | null = null
  ) {
    this.repository = repository ?? new AuditLogRepository();
    this.sessionStore = session ?? new SessionStore();
  }

  /** Loads every visible audit record for the current viewer, then applies `query` client-side. Denies without calling the repository when the session is missing or the role lacks audit-log capability. */
  load(query: AuditLogQuery): Observable<readonly AuditLogRecord[]> {
    this.lastQuery = query;
    this.queryState.set(query);
    const revision = ++this.requestRevision;
    const session = this.sessionStore.session();
    const role = session?.account.roleCode ?? null;

    if (session === null || role === null || ALLOWED_VIEWER_ROLES[role] !== true) {
      this.recordsState.set(EMPTY_RECORDS);
      this.transportStateState.set(Object.freeze({ status: 'unauthorized', message: UNAUTHORIZED_MESSAGE, retryable: false }));
      return throwError(() => new AuditLogFacadeError('unauthorized', UNAUTHORIZED_MESSAGE));
    }

    this.transportStateState.set(Object.freeze({ status: 'loading' }));

    return defer(() => this.repository.list()).pipe(
      map((records) => {
        if (revision !== this.requestRevision) return records;
        this.recordsState.set(Object.freeze(records.map((record) => redactAuditRecord(record, role))));
        this.transportStateState.set(Object.freeze({ status: 'success' }));
        return records;
      }),
      catchError((error: unknown) => {
        if (revision === this.requestRevision) {
          this.recordsState.set(EMPTY_RECORDS);
          this.transportStateState.set(stateForError(error));
        }
        return throwError(() => error);
      })
    );
  }

  /** Re-derives `page`/`summary` from already-loaded records — no refetch. */
  applyQuery(query: AuditLogQuery): void {
    this.lastQuery = query;
    this.queryState.set(query);
  }

  retry(): Observable<readonly AuditLogRecord[]> {
    return this.load(this.lastQuery);
  }

  select(id: string): void {
    this.selectedIdState.set(id);
  }

  clearSelection(): void {
    this.selectedIdState.set(null);
  }
}
