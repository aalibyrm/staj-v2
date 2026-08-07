/**
 * Audit-log domain model: an immutable, append-only record of a critical
 * platform action (publish, score change, session termination, import,
 * permission denial, override, or other). Mirrors the immutability and
 * validation conventions in `score-change.models.ts` (frozen objects,
 * frozen error-code record, typed domain error, `fail()`-style helpers).
 *
 * No IP address field exists anywhere on this model. `traceId`, `requestId`,
 * and `userAgent` are synthetic demo values only; they are never real
 * tokens, secrets, or personal data.
 */

import type { AuditEventDraft, AuditReadableValue } from '../../../core/observability/observability.ports';

export type { AuditReadableValue };

export const AUDIT_CATEGORIES = Object.freeze([
  'publish',
  'score-change',
  'session-termination',
  'import',
  'permission-denial',
  'override',
  'other'
] as const);

export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const AUDIT_STATUSES = Object.freeze(['success', 'rejected', 'failed'] as const);

export type AuditStatus = (typeof AUDIT_STATUSES)[number];

export const AUDIT_LOG_ERROR_CODES = Object.freeze({
  fieldRequired: 'field-required',
  invalidTimestamp: 'invalid-timestamp',
  invalidStatus: 'invalid-status'
} as const);

export type AuditLogErrorCode = (typeof AUDIT_LOG_ERROR_CODES)[keyof typeof AUDIT_LOG_ERROR_CODES];

export class AuditLogError extends Error {
  override readonly name = 'AuditLogError';

  constructor(
    readonly code: AuditLogErrorCode,
    message: string,
    readonly target?: string
  ) {
    super(message);
  }
}

export const MAX_AUDIT_DESCRIPTION_LENGTH = 500;
export const REDACTED_FIELD_VALUE = 'REDACTED';

export type AuditLogRecord = Readonly<{
  readonly id: string;
  readonly occurredAt: string;
  readonly actorId: string;
  readonly actorLabel: string;
  readonly actorRole: string;
  readonly category: AuditCategory;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly targetLabel: string;
  readonly description: string;
  readonly status: AuditStatus;
  readonly before: AuditReadableValue | null;
  readonly after: AuditReadableValue | null;
  readonly reason: string | null;
  readonly traceId: string;
  readonly requestId: string;
  readonly userAgent: string;
}>;

export type AuditLogRecordInput = Readonly<{
  readonly id: unknown;
  readonly occurredAt: unknown;
  readonly actorId: unknown;
  readonly actorLabel: unknown;
  readonly actorRole: unknown;
  readonly category: unknown;
  readonly action: unknown;
  readonly targetType: unknown;
  readonly targetId: unknown;
  readonly targetLabel: unknown;
  readonly description?: unknown;
  readonly status: unknown;
  readonly before?: AuditReadableValue | null;
  readonly after?: AuditReadableValue | null;
  readonly reason?: unknown;
  readonly traceId: unknown;
  readonly requestId: unknown;
  readonly userAgent: unknown;
}>;

const fail = (code: AuditLogErrorCode, message: string, target?: string): never => {
  throw new AuditLogError(code, message, target);
};

const requireNonblankText = (value: unknown, target: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fail(AUDIT_LOG_ERROR_CODES.fieldRequired, `A nonblank ${target} is required.`, target);
  }
  return value.trim();
};

const requireTimestamp = (value: unknown): string => {
  if (typeof value !== 'string' || value.trim().length === 0 || Number.isNaN(Date.parse(value))) {
    return fail(AUDIT_LOG_ERROR_CODES.invalidTimestamp, 'A valid occurredAt timestamp is required.', 'occurredAt');
  }
  return new Date(value).toISOString();
};

const CATEGORY_SET = AUDIT_CATEGORIES as readonly string[];

const requireStatus = (value: unknown): AuditStatus => {
  if (typeof value === 'string' && (AUDIT_STATUSES as readonly string[]).includes(value)) {
    return value as AuditStatus;
  }
  return fail(AUDIT_LOG_ERROR_CODES.invalidStatus, 'A valid audit status is required.', 'status');
};

const normalizeDescription = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, MAX_AUDIT_DESCRIPTION_LENGTH);
};

const normalizeReason = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

/** Recursively freezes an `AuditReadableValue` tree without mutating its shape. */
const deepFreezeReadable = (value: AuditReadableValue): AuditReadableValue => {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    for (const item of value) deepFreezeReadable(item as AuditReadableValue);
    return Object.freeze(value);
  }
  for (const key of Object.keys(value)) {
    deepFreezeReadable((value as Record<string, AuditReadableValue>)[key]);
  }
  return Object.freeze(value);
};

/**
 * Builds an immutable audit-log record. An unrecognized `category` silently
 * falls back to `'other'`; an unrecognized `status` always throws — there is
 * no default status. `before`/`after` are deep-frozen so nothing downstream
 * can mutate a persisted record's readable payload.
 */
export const createAuditLogRecord = (input: AuditLogRecordInput): AuditLogRecord => {
  const id = requireNonblankText(input.id, 'id');
  const occurredAt = requireTimestamp(input.occurredAt);
  const actorId = requireNonblankText(input.actorId, 'actorId');
  const actorLabel = requireNonblankText(input.actorLabel, 'actorLabel');
  const actorRole = requireNonblankText(input.actorRole, 'actorRole');
  const category =
    typeof input.category === 'string' && CATEGORY_SET.includes(input.category)
      ? (input.category as AuditCategory)
      : 'other';
  const action = requireNonblankText(input.action, 'action');
  const targetType = requireNonblankText(input.targetType, 'targetType');
  const targetId = requireNonblankText(input.targetId, 'targetId');
  const targetLabel = requireNonblankText(input.targetLabel, 'targetLabel');
  const description = normalizeDescription(input.description);
  const status = requireStatus(input.status);
  const before = input.before === undefined || input.before === null ? null : deepFreezeReadable(input.before);
  const after = input.after === undefined || input.after === null ? null : deepFreezeReadable(input.after);
  const reason = normalizeReason(input.reason);
  const traceId = requireNonblankText(input.traceId, 'traceId');
  const requestId = requireNonblankText(input.requestId, 'requestId');
  const userAgent = requireNonblankText(input.userAgent, 'userAgent');

  return Object.freeze({
    id,
    occurredAt,
    actorId,
    actorLabel,
    actorRole,
    category,
    action,
    targetType,
    targetId,
    targetLabel,
    description,
    status,
    before,
    after,
    reason,
    traceId,
    requestId,
    userAgent
  });
};

const humanizeAction = (action: string): string =>
  action
    .split(/[.:_-]+/u)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

export type AuditLogRecordResolution = Readonly<{
  readonly actorLabel: string;
  readonly actorRole: string;
  readonly category: AuditCategory;
  readonly targetLabel?: string;
  readonly description?: string;
  readonly status?: AuditStatus;
  readonly traceId: string;
  readonly requestId: string;
  readonly userAgent: string;
}>;

/**
 * Maps a recorded `AuditEventDraft` into a full `AuditLogRecord`. The
 * caller resolves the actor's display label/role and the event's category
 * (an `AuditEventDraft` carries only an opaque actor id and action string).
 * `mandatoryReason` maps to `reason`; a missing description is derived from
 * the action and target. The id is deterministic — built from action,
 * target id, and timestamp — so the same recorded event can never be
 * appended twice.
 */
export const fromAuditEventDraft = (
  draft: AuditEventDraft,
  resolve: AuditLogRecordResolution
): AuditLogRecord =>
  createAuditLogRecord({
    id: `${draft.action}::${draft.targetId}::${draft.occurredAt}`,
    occurredAt: draft.occurredAt,
    actorId: draft.actor,
    actorLabel: resolve.actorLabel,
    actorRole: resolve.actorRole,
    category: resolve.category,
    action: draft.action,
    targetType: draft.targetType,
    targetId: draft.targetId,
    targetLabel: resolve.targetLabel ?? draft.targetId,
    description: resolve.description ?? `${humanizeAction(draft.action)} recorded for ${draft.targetType} ${draft.targetId}.`,
    status: resolve.status ?? 'success',
    before: draft.before ?? null,
    after: draft.after ?? null,
    reason: draft.mandatoryReason ?? null,
    traceId: resolve.traceId,
    requestId: resolve.requestId,
    userAgent: resolve.userAgent
  });
