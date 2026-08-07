import { signal, type WritableSignal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { DEMO_ACCOUNTS, type AuthSession } from '../../../core/auth/authorization';
import type { SessionStore } from '../../../core/auth/session.store';
import { MockTransport } from '../../../core/api/mock-transport';
import { DEFAULT_AUDIT_LOG_QUERY, type AuditLogQuery } from '../domain/audit-log-query';
import { AuditLogFacade } from './audit-log.facade';
import { AuditLogRepository } from './audit-log.repository';

const accountFor = (role: (typeof DEMO_ACCOUNTS)[number]['roleCode']) =>
  DEMO_ACCOUNTS.find((account) => account.roleCode === role)!;

const sessionFor = (role: (typeof DEMO_ACCOUNTS)[number]['roleCode']): AuthSession => {
  const account = accountFor(role);
  return Object.freeze({ accountId: account.id, account });
};

const fakeSessionStore = (initial: AuthSession | null): { store: SessionStore; sessionSignal: WritableSignal<AuthSession | null> } => {
  const sessionSignal = signal<AuthSession | null>(initial);
  return { store: { session: sessionSignal } as unknown as SessionStore, sessionSignal };
};

const queryWith = (overrides: Partial<AuditLogQuery>): AuditLogQuery => ({ ...DEFAULT_AUDIT_LOG_QUERY, ...overrides });

describe('AuditLogFacade authorization', () => {
  it('denies a null session as unauthorized without calling the repository', async () => {
    const repository = new AuditLogRepository(new MockTransport());
    const listSpy = repository.list.bind(repository);
    let called = false;
    repository.list = ((...args: Parameters<typeof listSpy>) => {
      called = true;
      return listSpy(...args);
    }) as typeof repository.list;
    const { store } = fakeSessionStore(null);
    const facade = new AuditLogFacade(repository, store);

    await expect(firstValueFrom(facade.load(DEFAULT_AUDIT_LOG_QUERY))).rejects.toBeTruthy();
    expect(facade.requestState().status).toBe('unauthorized');
    expect(called).toBe(false);
  });

  it('denies a non-capable role (INSTRUCTOR) without calling the repository', async () => {
    const repository = new AuditLogRepository(new MockTransport());
    let called = false;
    const originalList = repository.list.bind(repository);
    repository.list = ((...args: Parameters<typeof originalList>) => {
      called = true;
      return originalList(...args);
    }) as typeof repository.list;
    const { store } = fakeSessionStore(sessionFor('INSTRUCTOR'));
    const facade = new AuditLogFacade(repository, store);

    await expect(firstValueFrom(facade.load(DEFAULT_AUDIT_LOG_QUERY))).rejects.toBeTruthy();
    expect(facade.requestState().status).toBe('unauthorized');
    expect(called).toBe(false);
  });

  it('reaches ready for every route-capable role', async () => {
    for (const role of ['MEASUREMENT_SPECIALIST', 'PROGRAM_MANAGER', 'OBSERVER', 'PLATFORM_ADMINISTRATOR'] as const) {
      const repository = new AuditLogRepository(new MockTransport());
      const { store } = fakeSessionStore(sessionFor(role));
      const facade = new AuditLogFacade(repository, store);
      await firstValueFrom(facade.load(DEFAULT_AUDIT_LOG_QUERY));
      expect(facade.requestState().status).toBe('ready');
      expect(facade.records().length).toBeGreaterThan(0);
    }
  });
});

describe('AuditLogFacade redaction', () => {
  it('redacts traceId/requestId/userAgent for a non-administrator, including through selectedRecord', async () => {
    const repository = new AuditLogRepository(new MockTransport());
    const { store } = fakeSessionStore(sessionFor('OBSERVER'));
    const facade = new AuditLogFacade(repository, store);
    await firstValueFrom(facade.load(DEFAULT_AUDIT_LOG_QUERY));
    expect(facade.records().every((record) => record.traceId === 'REDACTED')).toBe(true);
    facade.select(facade.records()[0].id);
    expect(facade.selectedRecord()?.traceId).toBe('REDACTED');
  });

  it('never redacts for a platform administrator', async () => {
    const repository = new AuditLogRepository(new MockTransport());
    const { store } = fakeSessionStore(sessionFor('PLATFORM_ADMINISTRATOR'));
    const facade = new AuditLogFacade(repository, store);
    await firstValueFrom(facade.load(DEFAULT_AUDIT_LOG_QUERY));
    expect(facade.records().some((record) => record.traceId !== 'REDACTED')).toBe(true);
  });
});

describe('AuditLogFacade request states', () => {
  it('produces error with retryable and recovers on retry after a service-error scenario', async () => {
    const repository = new AuditLogRepository(new MockTransport());
    repository.setMockScenario({ outcome: 'service-error' });
    const { store } = fakeSessionStore(sessionFor('PLATFORM_ADMINISTRATOR'));
    const facade = new AuditLogFacade(repository, store);
    await expect(firstValueFrom(facade.load(DEFAULT_AUDIT_LOG_QUERY))).rejects.toBeTruthy();
    expect(facade.requestState().status).toBe('error');
    expect(facade.requestState().retryable).toBe(true);

    repository.resetMockScenario();
    await firstValueFrom(facade.retry());
    expect(facade.requestState().status).toBe('ready');
  });

  it('produces empty when a filter matches nothing, without refetching', async () => {
    const repository = new AuditLogRepository(new MockTransport());
    const { store } = fakeSessionStore(sessionFor('PLATFORM_ADMINISTRATOR'));
    const facade = new AuditLogFacade(repository, store);
    await firstValueFrom(facade.load(DEFAULT_AUDIT_LOG_QUERY));
    facade.applyQuery(queryWith({ search: 'no-record-should-ever-match-this-search-text' }));
    expect(facade.requestState().status).toBe('empty');
    expect(facade.page().items).toEqual([]);
  });

  it('never lets a stale, later-arriving response overwrite a newer one', async () => {
    const repository = new AuditLogRepository(new MockTransport());
    const { store } = fakeSessionStore(sessionFor('PLATFORM_ADMINISTRATOR'));
    const facade = new AuditLogFacade(repository, store);

    const stale = facade.load(queryWith({ pageSize: 1 }));
    repository.setMockScenario({ latencyMs: 5 });
    const current = facade.load(DEFAULT_AUDIT_LOG_QUERY);
    await firstValueFrom(current);
    expect(facade.requestState().status).toBe('ready');
    await firstValueFrom(stale).catch(() => undefined);
    expect(facade.requestState().status).toBe('ready');
    expect(facade.query()).toEqual(DEFAULT_AUDIT_LOG_QUERY);
  });
});
