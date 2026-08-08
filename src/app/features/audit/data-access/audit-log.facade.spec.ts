import { signal, type WritableSignal } from '@angular/core';
import { firstValueFrom, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { DEMO_ACCOUNTS, type AuthSession } from '../../../core/auth/authorization';
import type { SessionStore } from '../../../core/auth/session.store';
import { MockTransport } from '../../../core/api/mock-transport';
import { DEFAULT_AUDIT_LOG_QUERY, type AuditLogQuery } from '../domain/audit-log-query';
import { AuditLogFacade } from './audit-log.facade';
import type { AuditLogRecord } from '../models/audit-log.models';
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
  it('keeps authorized loading through 399 ms, becomes audit-specific slow at 400 ms, and clears the timer on empty success', () => {
    vi.useFakeTimers();
    try {
      const repository = new AuditLogRepository(new MockTransport());
      const response = new Subject<readonly AuditLogRecord[]>();
      repository.list = (() => response.asObservable()) as typeof repository.list;
      const { store } = fakeSessionStore(sessionFor('PLATFORM_ADMINISTRATOR'));
      const facade = new AuditLogFacade(repository, store);

      const subscription = facade.load(DEFAULT_AUDIT_LOG_QUERY).subscribe();
      expect(facade.requestState().status).toBe('loading');
      vi.advanceTimersByTime(399);
      expect(facade.requestState().status).toBe('loading');
      vi.advanceTimersByTime(1);
      expect(facade.requestState()).toMatchObject({
        status: 'slow',
        message: 'The audit log is still loading. You can wait or retry.',
        retryable: true
      });

      response.next([]);
      response.complete();
      expect(facade.requestState().status).toBe('empty');
      vi.advanceTimersByTime(400);
      expect(facade.requestState().status).toBe('empty');
      subscription.unsubscribe();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('retries a slow load with the exact last query and ignores the superseded response before recovery', () => {
    vi.useFakeTimers();
    try {
      const repository = new AuditLogRepository(new MockTransport());
      const firstResponse = new Subject<readonly AuditLogRecord[]>();
      const retryResponse = new Subject<readonly AuditLogRecord[]>();
      let calls = 0;
      repository.list = (() => {
        calls += 1;
        return (calls === 1 ? firstResponse : retryResponse).asObservable();
      }) as typeof repository.list;
      const { store } = fakeSessionStore(sessionFor('PLATFORM_ADMINISTRATOR'));
      const facade = new AuditLogFacade(repository, store);
      const query = queryWith({ search: 'exact-query', page: 2, pageSize: 10 });

      const firstSubscription = facade.load(query).subscribe();
      vi.advanceTimersByTime(400);
      expect(facade.requestState().status).toBe('slow');

      const retrySubscription = facade.retry().subscribe();
      expect(calls).toBe(2);
      expect(facade.query()).toBe(query);
      expect(facade.requestState().status).toBe('loading');
      expect(facade.records()).toEqual([]);

      firstResponse.next([]);
      firstResponse.complete();
      expect(facade.requestState().status).toBe('loading');
      retryResponse.next([]);
      retryResponse.complete();
      expect(facade.requestState().status).toBe('empty');

      firstSubscription.unsubscribe();
      retrySubscription.unsubscribe();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('keeps terminal conflict and transport-unauthorized outcomes non-retryable and clears their slow timers', () => {
    vi.useFakeTimers();
    try {
      for (const outcome of ['conflict', 'unauthorized'] as const) {
        const repository = new AuditLogRepository(new MockTransport());
        const response = new Subject<readonly AuditLogRecord[]>();
        let calls = 0;
        repository.list = (() => {
          calls += 1;
          return response.asObservable();
        }) as typeof repository.list;
        const { store } = fakeSessionStore(sessionFor('PLATFORM_ADMINISTRATOR'));
        const facade = new AuditLogFacade(repository, store);
        const subscription = facade.load(DEFAULT_AUDIT_LOG_QUERY).subscribe({ error: () => undefined });

        response.error({ kind: outcome });
        expect(facade.requestState().status).toBe(outcome === 'conflict' ? 'error' : 'unauthorized');
        expect(facade.requestState().retryable).toBe(false);
        facade.retry().subscribe();
        expect(calls).toBe(1);
        vi.advanceTimersByTime(401);
        expect(facade.requestState().status).toBe(outcome === 'conflict' ? 'error' : 'unauthorized');
        subscription.unsubscribe();
      }
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('clears stale records and selection at a blocking load boundary', async () => {
    const repository = new AuditLogRepository(new MockTransport());
    const { store } = fakeSessionStore(sessionFor('PLATFORM_ADMINISTRATOR'));
    const facade = new AuditLogFacade(repository, store);
    await firstValueFrom(facade.load(DEFAULT_AUDIT_LOG_QUERY));
    const loaded = facade.records();
    facade.select(loaded[0].id);
    expect(facade.selectedRecord()?.id).toBe(loaded[0].id);

    const response = new Subject<readonly AuditLogRecord[]>();
    repository.list = (() => response.asObservable()) as typeof repository.list;
    const nextQuery = queryWith({ search: loaded[0].targetId });
    const subscription = facade.load(nextQuery).subscribe();
    expect(facade.requestState().status).toBe('loading');
    expect(facade.records()).toEqual([]);
    expect(facade.selectedRecord()).toBeNull();
    expect(facade.query()).toBe(nextQuery);
    response.next(loaded);
    response.complete();
    expect(facade.requestState().status).toBe('ready');
    subscription.unsubscribe();
  });

  it('does not let a superseded response cancel the current slow timer or replace current state', () => {
    vi.useFakeTimers();
    try {
      const repository = new AuditLogRepository(new MockTransport());
      const staleResponse = new Subject<readonly AuditLogRecord[]>();
      const currentResponse = new Subject<readonly AuditLogRecord[]>();
      let calls = 0;
      repository.list = (() => {
        calls += 1;
        return (calls === 1 ? staleResponse : currentResponse).asObservable();
      }) as typeof repository.list;
      const { store } = fakeSessionStore(sessionFor('PLATFORM_ADMINISTRATOR'));
      const facade = new AuditLogFacade(repository, store);
      const staleSubscription = facade.load(queryWith({ pageSize: 1 })).subscribe();
      vi.advanceTimersByTime(399);
      const currentQuery = DEFAULT_AUDIT_LOG_QUERY;
      const currentSubscription = facade.load(currentQuery).subscribe();
      vi.advanceTimersByTime(400);
      expect(facade.requestState().status).toBe('slow');

      staleResponse.next([]);
      staleResponse.complete();
      expect(facade.requestState().status).toBe('slow');
      expect(facade.query()).toBe(currentQuery);
      currentResponse.next([]);
      currentResponse.complete();
      expect(facade.requestState().status).toBe('empty');
      staleSubscription.unsubscribe();
      currentSubscription.unsubscribe();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('clears the slow timer on cancellation and destruction and ignores post-destroy completion', () => {
    vi.useFakeTimers();
    try {
      const repository = new AuditLogRepository(new MockTransport());
      const response = new Subject<readonly AuditLogRecord[]>();
      repository.list = (() => response.asObservable()) as typeof repository.list;
      const { store } = fakeSessionStore(sessionFor('PLATFORM_ADMINISTRATOR'));
      const facade = new AuditLogFacade(repository, store);
      const cancelled = facade.load(DEFAULT_AUDIT_LOG_QUERY).subscribe();
      vi.advanceTimersByTime(399);
      cancelled.unsubscribe();
      vi.advanceTimersByTime(401);
      expect(facade.requestState().status).toBe('loading');

      const destroyed = facade.load(DEFAULT_AUDIT_LOG_QUERY).subscribe();
      facade.ngOnDestroy();
      vi.advanceTimersByTime(401);
      response.next([]);
      response.complete();
      expect(facade.requestState().status).toBe('loading');
      expect(facade.records()).toEqual([]);
      destroyed.unsubscribe();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
