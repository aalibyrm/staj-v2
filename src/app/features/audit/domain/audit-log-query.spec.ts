import { describe, expect, it } from 'vitest';

import { AUDIT_CATEGORIES, createAuditLogRecord, type AuditLogRecord } from '../models/audit-log.models';
import {
  canExportAuditLog,
  parseAuditFilters,
  redactAuditRecord,
  selectAuditPage,
  summarizeAuditActivity,
  type AuditLogQuery
} from './audit-log-query';

const baseQuery: AuditLogQuery = Object.freeze({
  search: '',
  filters: Object.freeze([]),
  sort: 'occurredAt:desc',
  page: 1,
  pageSize: 20
});

let recordSequence = 0;

const record = (overrides: Partial<Parameters<typeof createAuditLogRecord>[0]> = {}): AuditLogRecord => {
  recordSequence += 1;
  return createAuditLogRecord({
    id: `record-${recordSequence}`,
    occurredAt: `2025-05-0${(recordSequence % 9) + 1}T08:00:00.000Z`,
    actorId: 'ACCOUNT-MEASUREMENT-001',
    actorLabel: 'Measurement Specialist Demo',
    actorRole: 'MEASUREMENT_SPECIALIST',
    category: 'score-change',
    action: 'grading.score-change',
    targetType: 'grading-attempt',
    targetId: `ATTEMPT-${recordSequence}`,
    targetLabel: `Attempt ${recordSequence}`,
    description: 'Score updated after re-evaluation.',
    status: 'success',
    before: { points: 60 },
    after: { points: 82 },
    reason: 'Re-evaluated after appeal.',
    traceId: `trace-${recordSequence}`,
    requestId: `req-${recordSequence}`,
    userAgent: 'Mozilla/5.0 DemoAgent/1.0',
    ...overrides
  });
};

describe('parseAuditFilters', () => {
  it('parses known category/status/actor tokens and ignores unknown prefixes and unrecognized enum values', () => {
    const parsed = parseAuditFilters([
      'category:score-change',
      'category:not-a-category',
      'status:rejected',
      'status:not-a-status',
      'actor:ACCOUNT-OBSERVER-001',
      'unknown-prefix:whatever',
      'malformed-token'
    ]);
    expect(parsed.categories).toEqual(['score-change']);
    expect(parsed.statuses).toEqual(['rejected']);
    expect(parsed.actors).toEqual(['ACCOUNT-OBSERVER-001']);
  });

  it('never throws on garbage input', () => {
    expect(() => parseAuditFilters(['', ':', 'category:', 'status:success:extra'])).not.toThrow();
  });

  it('parses from:/to: date-only tokens into start-of-day and end-of-day ISO instants, and ignores an unparseable value', () => {
    const parsed = parseAuditFilters(['from:2025-05-04', 'to:2025-05-04']);
    expect(parsed.from).toBe('2025-05-04T00:00:00.000Z');
    expect(parsed.to).toBe('2025-05-04T23:59:59.999Z');

    const unparseable = parseAuditFilters(['from:not-a-date', 'to:also-not-a-date']);
    expect(unparseable.from).toBeNull();
    expect(unparseable.to).toBeNull();
  });

  it('keeps the first valid from: value when the prefix repeats', () => {
    const parsed = parseAuditFilters(['from:not-a-date', 'from:2025-05-04', 'from:2025-05-06']);
    expect(parsed.from).toBe('2025-05-04T00:00:00.000Z');
  });
});

describe('selectAuditPage', () => {
  it('applies AND across facets and OR within a facet', () => {
    const records = [
      record({ category: 'score-change', status: 'success', actorId: 'a1' }),
      record({ category: 'score-change', status: 'rejected', actorId: 'a2' }),
      record({ category: 'override', status: 'success', actorId: 'a1' }),
      record({ category: 'override', status: 'rejected', actorId: 'a2' })
    ];
    const query: AuditLogQuery = {
      ...baseQuery,
      filters: ['category:score-change', 'category:override', 'status:success']
    };
    const page = selectAuditPage(records, query);
    expect(page.items.map((item) => item.category)).toEqual(expect.arrayContaining(['score-change', 'override']));
    expect(page.items.every((item) => item.status === 'success')).toBe(true);
    expect(page.total).toBe(2);
  });

  it('matches search case-insensitively across action, description, actor label, target label, and target id', () => {
    const byAction = record({ action: 'exam.PUBLISH', description: 'x', actorLabel: 'x', targetLabel: 'x', targetId: 'x' });
    const byDescription = record({ action: 'x', description: 'Session Terminated Early', actorLabel: 'x', targetLabel: 'x', targetId: 'x' });
    const byActor = record({ action: 'x', description: 'x', actorLabel: 'Program Manager Demo', targetLabel: 'x', targetId: 'x' });
    const byTargetLabel = record({ action: 'x', description: 'x', actorLabel: 'x', targetLabel: 'Cohort Analytics', targetId: 'x' });
    const byTargetId = record({ action: 'x', description: 'x', actorLabel: 'x', targetLabel: 'x', targetId: 'EXAM-UNIQUE-77' });
    const records = [byAction, byDescription, byActor, byTargetLabel, byTargetId];

    expect(selectAuditPage(records, { ...baseQuery, search: 'publish' }).items).toEqual([byAction]);
    expect(selectAuditPage(records, { ...baseQuery, search: 'terminated early' }).items).toEqual([byDescription]);
    expect(selectAuditPage(records, { ...baseQuery, search: 'program manager' }).items).toEqual([byActor]);
    expect(selectAuditPage(records, { ...baseQuery, search: 'cohort analytics' }).items).toEqual([byTargetLabel]);
    expect(selectAuditPage(records, { ...baseQuery, search: 'exam-unique-77' }).items).toEqual([byTargetId]);
  });

  it('falls back to occurredAt:desc for an unrecognized sort', () => {
    const oldest = record({ occurredAt: '2025-05-01T00:00:00.000Z' });
    const newest = record({ occurredAt: '2025-05-03T00:00:00.000Z' });
    const page = selectAuditPage([oldest, newest], { ...baseQuery, sort: 'not-a-real-sort' });
    expect(page.items[0]).toBe(newest);
    expect(page.items[1]).toBe(oldest);
  });

  it('clamps a page requested above pageCount down to the last page, and below 1 up to page 1', () => {
    const records = Array.from({ length: 5 }, () => record());
    const above = selectAuditPage(records, { ...baseQuery, page: 999, pageSize: 2 });
    expect(above.page).toBe(3);
    expect(above.pageCount).toBe(3);

    const below = selectAuditPage(records, { ...baseQuery, page: -4, pageSize: 2 });
    expect(below.page).toBe(1);
  });

  it('yields pageCount 1 and an empty items array when nothing matches', () => {
    const records = [record({ category: 'publish' })];
    const page = selectAuditPage(records, { ...baseQuery, filters: ['category:override'] });
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.pageCount).toBe(1);
    expect(page.page).toBe(1);
  });

  it('includes a record occurring at 00:00 of a bare from: date and excludes the day before', () => {
    const atMidnight = record({ occurredAt: '2025-05-04T00:00:00.000Z' });
    const dayBefore = record({ occurredAt: '2025-05-03T23:59:59.999Z' });
    const page = selectAuditPage([dayBefore, atMidnight], { ...baseQuery, filters: ['from:2025-05-04'] });
    expect(page.items).toEqual([atMidnight]);
  });

  it('includes a record occurring late in the day for a bare to: date and excludes the day after', () => {
    const lateSameDay = record({ occurredAt: '2025-05-04T23:59:59.999Z' });
    const nextDay = record({ occurredAt: '2025-05-05T00:00:00.000Z' });
    const page = selectAuditPage([lateSameDay, nextDay], { ...baseQuery, filters: ['to:2025-05-04'] });
    expect(page.items).toEqual([lateSameDay]);
  });

  it('returns only records within a from:/to: range', () => {
    const before = record({ occurredAt: '2025-05-02T12:00:00.000Z' });
    const inRange = record({ occurredAt: '2025-05-04T12:00:00.000Z' });
    const after = record({ occurredAt: '2025-05-07T12:00:00.000Z' });
    const page = selectAuditPage([before, inRange, after], {
      ...baseQuery,
      filters: ['from:2025-05-03', 'to:2025-05-05']
    });
    expect(page.items).toEqual([inRange]);
  });

  it('ignores an unparseable from: token and returns the unfiltered set', () => {
    const records = [record(), record(), record()];
    const page = selectAuditPage(records, { ...baseQuery, filters: ['from:not-a-date'] });
    expect(page.total).toBe(records.length);
  });

  it('combines a date facet with a category facet as AND', () => {
    const matching = record({ category: 'score-change', occurredAt: '2025-05-04T12:00:00.000Z' });
    const wrongCategory = record({ category: 'override', occurredAt: '2025-05-04T12:00:00.000Z' });
    const wrongDate = record({ category: 'score-change', occurredAt: '2025-05-09T12:00:00.000Z' });
    const page = selectAuditPage([matching, wrongCategory, wrongDate], {
      ...baseQuery,
      filters: ['from:2025-05-04', 'to:2025-05-04', 'category:score-change']
    });
    expect(page.items).toEqual([matching]);
  });
});

describe('summarizeAuditActivity', () => {
  it('lists every category in tuple order, including zero counts', () => {
    const summary = summarizeAuditActivity([record({ category: 'publish' }), record({ category: 'publish' }), record({ category: 'override' })]);
    expect(summary.total).toBe(3);
    expect(summary.byCategory.map((entry) => entry.category)).toEqual([...AUDIT_CATEGORIES]);
    expect(summary.byCategory.find((entry) => entry.category === 'publish')?.count).toBe(2);
    expect(summary.byCategory.find((entry) => entry.category === 'override')?.count).toBe(1);
    expect(summary.byCategory.find((entry) => entry.category === 'import')?.count).toBe(0);
  });
});

describe('redactAuditRecord', () => {
  it('leaves a platform administrator record untouched', () => {
    const original = record({ traceId: 'trace-visible', requestId: 'req-visible', userAgent: 'agent-visible' });
    const redacted = redactAuditRecord(original, 'PLATFORM_ADMINISTRATOR');
    expect(redacted).toBe(original);
  });

  it('replaces exactly traceId, requestId, and userAgent for every other role, keeping the rest intact', () => {
    const original = record({ traceId: 'trace-visible', requestId: 'req-visible', userAgent: 'agent-visible' });
    for (const role of ['MEASUREMENT_SPECIALIST', 'PROGRAM_MANAGER', 'OBSERVER', 'STUDENT', 'INSTRUCTOR'] as const) {
      const redacted = redactAuditRecord(original, role);
      expect(redacted.traceId).toBe('REDACTED');
      expect(redacted.requestId).toBe('REDACTED');
      expect(redacted.userAgent).toBe('REDACTED');
      expect(redacted.id).toBe(original.id);
      expect(redacted.description).toBe(original.description);
      expect(redacted.before).toEqual(original.before);
      expect(redacted.after).toEqual(original.after);
    }
  });
});

describe('canExportAuditLog', () => {
  it('is false for OBSERVER and null/undefined roles, true for the three permitted roles', () => {
    expect(canExportAuditLog('OBSERVER')).toBe(false);
    expect(canExportAuditLog(null)).toBe(false);
    expect(canExportAuditLog(undefined)).toBe(false);
    expect(canExportAuditLog('STUDENT')).toBe(false);
    expect(canExportAuditLog('PLATFORM_ADMINISTRATOR')).toBe(true);
    expect(canExportAuditLog('MEASUREMENT_SPECIALIST')).toBe(true);
    expect(canExportAuditLog('PROGRAM_MANAGER')).toBe(true);
  });
});
