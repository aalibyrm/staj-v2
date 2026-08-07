import { Inject, Injectable, Optional } from '@angular/core';
import { defer, map, Observable } from 'rxjs';

import { DEFAULT_MOCK_SCENARIO, MockTransport, type MockScenarioControls } from '../../../core/api/mock-transport';
import { DEMO_ACCOUNTS } from '../../../core/auth/authorization';
import { AuditPort, type AuditEventDraft, type AuditReadableValue } from '../../../core/observability/observability.ports';
import {
  createAuditLogRecord,
  fromAuditEventDraft,
  type AuditCategory,
  type AuditLogRecord,
  type AuditStatus
} from '../models/audit-log.models';

export type AuditLogReadOptions = Readonly<Partial<MockScenarioControls>>;

/** Maps a recorded action string to the audit category it belongs to; an unmapped action falls back to `'other'`. */
const ACTION_CATEGORY_LOOKUP: Readonly<Record<string, AuditCategory>> = Object.freeze({
  'exam.publish': 'publish',
  'grading.score-change': 'score-change',
  'exam-session.terminate': 'session-termination',
  'question-bank.import': 'import',
  'access.permission-denied': 'permission-denial',
  'grading.override': 'override'
});

const SYSTEM_ACTOR_ID = 'SYSTEM';
const SYSTEM_ACTOR_LABEL = 'System';
const SYSTEM_ACTOR_ROLE = 'System process';

const DEMO_ACCOUNT_BY_ID = new Map(DEMO_ACCOUNTS.map((account) => [account.id as string, account]));

/** Deterministic FNV-1a-style hash rendered as an 8-character hex string, for synthetic demo trace/request identifiers. */
const hashHex = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const SYNTHETIC_USER_AGENTS: readonly string[] = Object.freeze([
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) DemoAgent/1.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) DemoAgent/1.0',
  'Mozilla/5.0 (X11; Linux x86_64) DemoAgent/1.0'
]);

const resolveActor = (accountId: string): Readonly<{ label: string; role: string }> => {
  if (accountId === SYSTEM_ACTOR_ID) {
    return Object.freeze({ label: SYSTEM_ACTOR_LABEL, role: SYSTEM_ACTOR_ROLE });
  }
  const account = DEMO_ACCOUNT_BY_ID.get(accountId);
  return account === undefined
    ? Object.freeze({ label: accountId, role: SYSTEM_ACTOR_ROLE })
    : Object.freeze({ label: account.displayLabel, role: account.roleCode });
};

const SEED_TARGET_BY_CATEGORY: Readonly<Record<AuditCategory, Readonly<{ targetType: string; idPrefix: string; action: string }>>> =
  Object.freeze({
    publish: Object.freeze({ targetType: 'exam', idPrefix: 'EXAM', action: 'exam.publish' }),
    'score-change': Object.freeze({ targetType: 'grading-attempt', idPrefix: 'ATTEMPT', action: 'grading.score-change' }),
    'session-termination': Object.freeze({ targetType: 'exam-session', idPrefix: 'SESSION', action: 'exam-session.terminate' }),
    import: Object.freeze({ targetType: 'question-bank', idPrefix: 'IMPORT', action: 'question-bank.import' }),
    'permission-denial': Object.freeze({ targetType: 'route', idPrefix: 'ROUTE', action: 'access.permission-denied' }),
    override: Object.freeze({ targetType: 'grading-attempt', idPrefix: 'OVERRIDE', action: 'grading.override' }),
    other: Object.freeze({ targetType: 'system-task', idPrefix: 'TASK', action: 'system.maintenance' })
  });

const AUDIT_CATEGORY_CYCLE: readonly AuditCategory[] = Object.freeze([
  'publish',
  'score-change',
  'session-termination',
  'import',
  'permission-denial',
  'override',
  'other'
]);
const AUDIT_STATUS_CYCLE: readonly AuditStatus[] = Object.freeze(['success', 'rejected', 'failed']);
const SEED_RECORD_COUNT = 24;
const SEED_INTERVAL_MS = 40 * 60 * 1000;
const SEED_BASE_TIMESTAMP_MS = Date.parse('2025-05-05T09:25:00.000Z');

const humanizeCategory = (category: AuditCategory): string =>
  category
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

const seedBefore = (category: AuditCategory, status: AuditStatus): AuditReadableValue | null => {
  if (status === 'failed') return null;
  if (category === 'score-change') return { points: 68 };
  if (category === 'override') return { decision: 'pending' };
  return null;
};

const seedAfter = (category: AuditCategory, status: AuditStatus): AuditReadableValue | null => {
  if (status === 'failed') return null;
  if (category === 'score-change') return { points: 95 };
  if (category === 'override') return { decision: status === 'success' ? 'approved' : 'declined' };
  return null;
};

const seedReason = (category: AuditCategory, status: AuditStatus): string | null => {
  if (category === 'score-change') return 'Re-evaluated after appeal.';
  if (category === 'override') return 'Manual override applied by evaluator.';
  if (category === 'permission-denial') return 'Requested scope exceeds granted role.';
  if (status === 'rejected') return 'Rejected during validation.';
  if (status === 'failed') return 'Operation failed to complete.';
  return null;
};

const seedDescription = (category: AuditCategory, status: AuditStatus, targetId: string): string => {
  const verb = status === 'success' ? 'completed' : status === 'rejected' ? 'was rejected' : 'failed';
  return `${humanizeCategory(category)} ${verb} for ${targetId}.`;
};

const buildSeedRecords = (): readonly AuditLogRecord[] =>
  Array.from({ length: SEED_RECORD_COUNT }, (_unused, index) => {
    const category = AUDIT_CATEGORY_CYCLE[index % AUDIT_CATEGORY_CYCLE.length];
    const status = AUDIT_STATUS_CYCLE[index % AUDIT_STATUS_CYCLE.length];
    const account = DEMO_ACCOUNTS[index % DEMO_ACCOUNTS.length];
    const target = SEED_TARGET_BY_CATEGORY[category];
    const targetId = `${target.idPrefix}-${String(index + 1).padStart(2, '0')}`;
    const occurredAt = new Date(SEED_BASE_TIMESTAMP_MS - index * SEED_INTERVAL_MS).toISOString();

    return createAuditLogRecord({
      id: `seed-${index + 1}`,
      occurredAt,
      actorId: account.id,
      actorLabel: account.displayLabel,
      actorRole: account.roleCode,
      category,
      action: target.action,
      targetType: target.targetType,
      targetId,
      targetLabel: `${target.targetType} ${targetId}`,
      description: seedDescription(category, status, targetId),
      status,
      before: seedBefore(category, status),
      after: seedAfter(category, status),
      reason: seedReason(category, status),
      traceId: `trace-${hashHex(`seed-trace-${index}`)}`,
      requestId: `req-${hashHex(`seed-req-${index}`)}`,
      userAgent: SYNTHETIC_USER_AGENTS[index % SYNTHETIC_USER_AGENTS.length]
    });
  });

/**
 * Append-only, in-memory audit store. Implements `AuditPort` so any feature
 * that records an `AuditEventDraft` (for example `grading.score-change`)
 * feeds this store directly. There is no update or delete method — every
 * record returned to a caller is frozen, and `list()` always hands back a
 * fresh, independent copy so mutating the returned array never affects
 * subsequent reads.
 */
@Injectable({ providedIn: 'root' })
export class AuditLogRepository extends AuditPort {
  private readonly transport: MockTransport;
  private readonly records: AuditLogRecord[] = [];
  private readonly recordIds = new Set<string>();
  private scenarioControls: MockScenarioControls = Object.freeze({ ...DEFAULT_MOCK_SCENARIO });

  constructor(@Optional() @Inject(MockTransport) transport: MockTransport | null = null) {
    super();
    this.transport = transport ?? new MockTransport();
    for (const record of buildSeedRecords()) this.append(record);
  }

  /** Implements `AuditPort.record`. Never throws to the caller — a malformed or duplicate draft is silently dropped. */
  override record(event: AuditEventDraft): void {
    try {
      const resolved = resolveActor(event.actor);
      const seedIndex = this.records.length;
      const category = ACTION_CATEGORY_LOOKUP[event.action] ?? 'other';
      const record = fromAuditEventDraft(event, {
        actorLabel: resolved.label,
        actorRole: resolved.role,
        category,
        traceId: `trace-${hashHex(`${event.action}-${event.targetId}-${seedIndex}`)}`,
        requestId: `req-${hashHex(`${event.action}-${event.targetId}-req-${seedIndex}`)}`,
        userAgent: SYNTHETIC_USER_AGENTS[seedIndex % SYNTHETIC_USER_AGENTS.length]
      });
      this.append(record);
    } catch {
      // A recording feature must never break because its audit event failed to convert.
    }
  }

  list(options: AuditLogReadOptions = {}): Observable<readonly AuditLogRecord[]> {
    return defer(() => {
      const controls = { ...this.scenarioControls, ...options };
      const successBodyFactory = (): readonly AuditLogRecord[] => Object.freeze([...this.records]);
      return this.transport
        .execute({ method: 'GET', url: '/audit-events' }, successBodyFactory, controls)
        .pipe(map((response) => response.body));
    });
  }

  setMockScenario(controls: Partial<MockScenarioControls>): void {
    if (controls === null || typeof controls !== 'object' || Array.isArray(controls)) {
      throw new TypeError('Mock scenario controls must be an object.');
    }
    this.scenarioControls = Object.freeze({ ...this.scenarioControls, ...controls });
  }

  resetMockScenario(): void {
    this.scenarioControls = Object.freeze({ ...DEFAULT_MOCK_SCENARIO });
  }

  getMockScenario(): Readonly<MockScenarioControls> {
    return Object.freeze({ ...this.scenarioControls });
  }

  /** Appends `record`; a repeated id is rejected (never overwritten) and reported as not-appended. */
  private append(record: AuditLogRecord): boolean {
    if (this.recordIds.has(record.id)) return false;
    this.recordIds.add(record.id);
    this.records.push(record);
    return true;
  }
}
