import { firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { DEMO_ACCOUNTS } from '../../../core/auth/authorization';
import { MockTransport } from '../../../core/api/mock-transport';
import type { AuditEventDraft } from '../../../core/observability/observability.ports';
import type { AuditLogRecord } from '../models/audit-log.models';
import { AuditLogRepository } from './audit-log.repository';

const accountFor = (role: (typeof DEMO_ACCOUNTS)[number]['roleCode']) =>
  DEMO_ACCOUNTS.find((account) => account.roleCode === role)!;

describe('AuditLogRepository AuditPort seam', () => {
  it('maps a recorded AuditEventDraft into exactly one readable AuditLogRecord', async () => {
    const repository = new AuditLogRepository(new MockTransport());
    const account = accountFor('MEASUREMENT_SPECIALIST');
    const draft: AuditEventDraft = {
      action: 'grading.score-change',
      actor: account.id,
      targetType: 'grading-attempt',
      targetId: 'attempt-77',
      occurredAt: '2025-06-01T10:00:00.000Z',
      before: { points: 68 },
      after: { points: 95 },
      mandatoryReason: 'Second reader disagreed.'
    };

    repository.record(draft);
    const records = await firstValueFrom(repository.list());
    const matching = records.filter((record) => record.targetId === 'attempt-77');

    expect(matching).toHaveLength(1);
    const [recorded] = matching;
    expect(recorded.actorId).toBe(account.id);
    expect(recorded.actorLabel).toBe(account.displayLabel);
    expect(recorded.targetType).toBe('grading-attempt');
    expect(recorded.targetId).toBe('attempt-77');
    expect(recorded.before).toEqual({ points: 68 });
    expect(recorded.after).toEqual({ points: 95 });
    expect(recorded.reason).toBe('Second reader disagreed.');
  });

  it('does not append a duplicate record for the same derived id', async () => {
    const repository = new AuditLogRepository(new MockTransport());
    const account = accountFor('MEASUREMENT_SPECIALIST');
    const draft: AuditEventDraft = {
      action: 'grading.score-change',
      actor: account.id,
      targetType: 'grading-attempt',
      targetId: 'attempt-78',
      occurredAt: '2025-06-01T11:00:00.000Z',
      before: { points: 40 },
      after: { points: 70 },
      mandatoryReason: 'Rescored on appeal.'
    };

    repository.record(draft);
    repository.record(draft);
    const records = await firstValueFrom(repository.list());
    expect(records.filter((record) => record.targetId === 'attempt-78')).toHaveLength(1);
  });

  it('drops a malformed draft (missing action, empty targetId) without throwing or appending', async () => {
    const repository = new AuditLogRepository(new MockTransport());
    const account = accountFor('MEASUREMENT_SPECIALIST');
    const before = await firstValueFrom(repository.list());
    const malformed = {
      actor: account.id,
      targetType: 'grading-attempt',
      targetId: '',
      occurredAt: '2025-06-01T12:00:00.000Z'
    } as unknown as AuditEventDraft;

    expect(() => repository.record(malformed)).not.toThrow();
    const after = await firstValueFrom(repository.list());
    expect(after.length).toBe(before.length);
  });

  it('exposes no update or delete method, and mutating a returned array or record does not affect a later read', async () => {
    const repository = new AuditLogRepository(new MockTransport());
    const repositoryAsRecord = repository as unknown as Record<string, unknown>;
    expect(repositoryAsRecord['update']).toBeUndefined();
    expect(repositoryAsRecord['delete']).toBeUndefined();

    const first = await firstValueFrom(repository.list());
    const originalLength = first.length;
    const originalDescription = first[0].description;

    const mutableRecords = first as AuditLogRecord[];
    expect(() => mutableRecords.push(first[0])).toThrow();

    // Frozen record: mutate through a same-shape alias to confirm the write is rejected.
    const mutableRecord = first[0] as { description: string };
    expect(() => {
      mutableRecord.description = 'mutated';
    }).toThrow();

    const second = await firstValueFrom(repository.list());
    expect(second).not.toBe(first);
    expect(second.length).toBe(originalLength);
    expect(second[0].description).toBe(originalDescription);
  });
});
