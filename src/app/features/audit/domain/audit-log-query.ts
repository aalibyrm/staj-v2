/**
 * Pure audit-log query operations: filter-token parsing, search/sort/page
 * selection, per-category activity summarization, viewer-scoped redaction,
 * and export eligibility. No Angular, RxJS, transport, or storage imports —
 * this module is deterministic and allocation-light, and never mutates an
 * input record or array.
 */
import type { RoleCode } from '../../../core/auth/authorization';
import {
  AUDIT_CATEGORIES,
  AUDIT_STATUSES,
  REDACTED_FIELD_VALUE,
  type AuditCategory,
  type AuditLogRecord,
  type AuditStatus
} from '../models/audit-log.models';

export type AuditLogQuery = Readonly<{
  readonly search: string;
  readonly filters: readonly string[];
  readonly sort: string;
  readonly page: number;
  readonly pageSize: number;
}>;

export const DEFAULT_AUDIT_LOG_SORT = 'occurredAt:desc';
export const DEFAULT_AUDIT_LOG_PAGE_SIZE = 20;

export const DEFAULT_AUDIT_LOG_QUERY: AuditLogQuery = Object.freeze({
  search: '',
  filters: Object.freeze([]),
  sort: DEFAULT_AUDIT_LOG_SORT,
  page: 1,
  pageSize: DEFAULT_AUDIT_LOG_PAGE_SIZE
});

export type ParsedAuditFilters = Readonly<{
  readonly categories: readonly AuditCategory[];
  readonly statuses: readonly AuditStatus[];
  readonly actors: readonly string[];
  readonly from: string | null;
  readonly to: string | null;
}>;

const CATEGORY_LOOKUP: Readonly<Record<string, true>> = Object.freeze(
  Object.fromEntries(AUDIT_CATEGORIES.map((category): [string, true] => [category, true]))
);
const STATUS_LOOKUP: Readonly<Record<string, true>> = Object.freeze(
  Object.fromEntries(AUDIT_STATUSES.map((status): [string, true] => [status, true]))
);

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Normalizes a `from:`/`to:` filter value to an ISO instant. A bare date is widened to the start (`from`) or end (`to`) of that UTC day; an unparseable value returns `null`. */
const parseDateBound = (value: string, edge: 'start' | 'end'): string | null => {
  const iso = DATE_ONLY_PATTERN.test(value) ? `${value}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}Z` : value;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
};

/**
 * Parses `category:<value>`, `status:<value>`, `actor:<accountId>`,
 * `from:<date>`, and `to:<date>` tokens. Unknown prefixes and unrecognized
 * enum values are silently ignored — this function never throws. A `from`/
 * `to` value that `Date.parse` cannot read is likewise ignored; when the
 * same prefix appears more than once, the first valid value wins.
 */
export const parseAuditFilters = (filters: readonly string[]): ParsedAuditFilters => {
  const categories: AuditCategory[] = [];
  const statuses: AuditStatus[] = [];
  const actors: string[] = [];
  const seenCategories = new Set<string>();
  const seenStatuses = new Set<string>();
  const seenActors = new Set<string>();
  let from: string | null = null;
  let to: string | null = null;

  for (const raw of filters) {
    if (typeof raw !== 'string') continue;
    const separatorIndex = raw.indexOf(':');
    if (separatorIndex <= 0) continue;
    const prefix = raw.slice(0, separatorIndex);
    const value = raw.slice(separatorIndex + 1);
    if (value.length === 0) continue;

    if (prefix === 'category' && CATEGORY_LOOKUP[value] === true && !seenCategories.has(value)) {
      seenCategories.add(value);
      categories.push(value as AuditCategory);
    } else if (prefix === 'status' && STATUS_LOOKUP[value] === true && !seenStatuses.has(value)) {
      seenStatuses.add(value);
      statuses.push(value as AuditStatus);
    } else if (prefix === 'actor' && !seenActors.has(value)) {
      seenActors.add(value);
      actors.push(value);
    } else if (prefix === 'from' && from === null) {
      from = parseDateBound(value, 'start');
    } else if (prefix === 'to' && to === null) {
      to = parseDateBound(value, 'end');
    }
  }

  return Object.freeze({
    categories: Object.freeze(categories),
    statuses: Object.freeze(statuses),
    actors: Object.freeze(actors),
    from,
    to
  });
};

export type AuditLogPage = Readonly<{
  readonly items: readonly AuditLogRecord[];
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
  readonly pageSize: number;
}>;

const VALID_SORTS: Readonly<Record<string, true>> = Object.freeze({
  'occurredAt:desc': true,
  'occurredAt:asc': true,
  'actor:asc': true,
  'category:asc': true
});

const compareByOccurredAtDesc = (left: AuditLogRecord, right: AuditLogRecord): number =>
  right.occurredAt.localeCompare(left.occurredAt);

const sortComparator = (sort: string): ((left: AuditLogRecord, right: AuditLogRecord) => number) => {
  switch (sort) {
    case 'occurredAt:asc':
      return (left, right) => left.occurredAt.localeCompare(right.occurredAt);
    case 'actor:asc':
      return (left, right) => left.actorLabel.localeCompare(right.actorLabel) || compareByOccurredAtDesc(left, right);
    case 'category:asc':
      return (left, right) => left.category.localeCompare(right.category) || compareByOccurredAtDesc(left, right);
    default:
      return compareByOccurredAtDesc;
  }
};

/**
 * Filters `records` by search text and by `query.filters` (AND across
 * facets, OR within a facet), sorts (an unrecognized `sort` falls back to
 * `occurredAt:desc`), then paginates. `page` is clamped into `1..pageCount`;
 * an empty result always yields `pageCount: 1` and an empty items array.
 */
export const selectAuditPage = (records: readonly AuditLogRecord[], query: AuditLogQuery): AuditLogPage => {
  const { categories, statuses, actors, from, to } = parseAuditFilters(query.filters);
  const categorySet = new Set(categories);
  const statusSet = new Set(statuses);
  const actorSet = new Set(actors);
  const search = typeof query.search === 'string' ? query.search.trim().toLowerCase() : '';

  const filtered = records.filter((record) => {
    if (categorySet.size > 0 && !categorySet.has(record.category)) return false;
    if (statusSet.size > 0 && !statusSet.has(record.status)) return false;
    if (actorSet.size > 0 && !actorSet.has(record.actorId)) return false;
    if (from !== null && record.occurredAt < from) return false;
    if (to !== null && record.occurredAt > to) return false;
    if (search.length === 0) return true;
    return (
      record.action.toLowerCase().includes(search) ||
      record.description.toLowerCase().includes(search) ||
      record.actorLabel.toLowerCase().includes(search) ||
      record.targetLabel.toLowerCase().includes(search) ||
      record.targetId.toLowerCase().includes(search)
    );
  });

  const sort = VALID_SORTS[query.sort] === true ? query.sort : DEFAULT_AUDIT_LOG_SORT;
  const sorted = [...filtered].sort(sortComparator(sort));

  const pageSize = Number.isFinite(query.pageSize) && query.pageSize > 0 ? Math.floor(query.pageSize) : DEFAULT_AUDIT_LOG_PAGE_SIZE;
  const total = sorted.length;
  const pageCount = total === 0 ? 1 : Math.ceil(total / pageSize);
  const requestedPage = Number.isFinite(query.page) && query.page > 0 ? Math.floor(query.page) : 1;
  const page = Math.min(Math.max(requestedPage, 1), pageCount);
  const start = (page - 1) * pageSize;

  return Object.freeze({
    items: Object.freeze(sorted.slice(start, start + pageSize)),
    total,
    page,
    pageCount,
    pageSize
  });
};

export type AuditCategoryCount = Readonly<{ readonly category: AuditCategory; readonly count: number }>;

export type AuditActivitySummary = Readonly<{
  readonly total: number;
  readonly byCategory: readonly AuditCategoryCount[];
}>;

/** Counts every category in `AUDIT_CATEGORIES` order, including zero counts for categories with no records. */
export const summarizeAuditActivity = (records: readonly AuditLogRecord[]): AuditActivitySummary => {
  const counts: Record<AuditCategory, number> = Object.fromEntries(
    AUDIT_CATEGORIES.map((category) => [category, 0])
  ) as Record<AuditCategory, number>;
  for (const record of records) counts[record.category] += 1;

  return Object.freeze({
    total: records.length,
    byCategory: Object.freeze(AUDIT_CATEGORIES.map((category) => Object.freeze({ category, count: counts[category] })))
  });
};

/**
 * A platform administrator sees every field unredacted. Every other role
 * gets a frozen copy whose `traceId`, `requestId`, and `userAgent` are
 * replaced by the exact sentinel `'REDACTED'` — the keys are always
 * present, never deleted, so the UI can say a field is hidden rather than
 * silently dropping it.
 */
export const redactAuditRecord = (record: AuditLogRecord, role: RoleCode): AuditLogRecord => {
  if (role === 'PLATFORM_ADMINISTRATOR') return record;
  return Object.freeze({
    ...record,
    traceId: REDACTED_FIELD_VALUE,
    requestId: REDACTED_FIELD_VALUE,
    userAgent: REDACTED_FIELD_VALUE
  });
};

const EXPORT_ROLES: Readonly<Partial<Record<RoleCode, true>>> = Object.freeze({
  PLATFORM_ADMINISTRATOR: true,
  MEASUREMENT_SPECIALIST: true,
  PROGRAM_MANAGER: true
});

export const canExportAuditLog = (role: RoleCode | null | undefined): boolean =>
  role !== null && role !== undefined && EXPORT_ROLES[role] === true;
