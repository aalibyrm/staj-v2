import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { describe, expect, it, vi } from 'vitest';

import { DEMO_ACCOUNTS, type AuthSession } from '../../../core/auth/authorization';
import { SessionStore } from '../../../core/auth/session.store';
import { AuditLogRepository } from '../data-access/audit-log.repository';
import { AuditLogComponent } from './audit-log.component';

const accountFor = (role: (typeof DEMO_ACCOUNTS)[number]['roleCode']) => DEMO_ACCOUNTS.find((account) => account.roleCode === role)!;

const sessionFor = (role: (typeof DEMO_ACCOUNTS)[number]['roleCode']): AuthSession => {
  const account = accountFor(role);
  return Object.freeze({ accountId: account.id, account });
};

const sessionStoreProvider = (session: AuthSession | null) => ({
  provide: SessionStore,
  useValue: { session: signal(session) }
});

const configure = (session: AuthSession | null): void => {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [AuditLogComponent],
    providers: [provideRouter([{ path: 'audit-log', component: AuditLogComponent }]), sessionStoreProvider(session)]
  });
};

describe('AuditLogComponent', () => {
  it('renders the audit table with results and an export control for an authorized administrator', async () => {
    configure(sessionFor('PLATFORM_ADMINISTRATOR'));
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/audit-log', AuditLogComponent);
    await vi.waitFor(() => {
      expect(component.facade.requestState().status).toBe('ready');
    });
    harness.detectChanges();
    const element = harness.routeNativeElement as HTMLElement;
    expect(element.querySelector('h1')?.textContent?.trim()).toBe('Audit log');
    expect(element.querySelectorAll('.audit-table tbody tr').length).toBeGreaterThan(0);
    expect(element.querySelector('.primary-action')?.textContent).toContain('Export');
    const table = element.querySelector<HTMLTableElement>('.audit-table');
    expect(table?.querySelector('caption')?.textContent).toContain('Audit records');
    expect(table?.querySelectorAll('thead th[scope="col"]')).toHaveLength(6);
    expect(Array.from(table?.querySelectorAll('.status-chip') ?? []).every((chip) => (chip.textContent ?? '').trim().length > 0)).toBe(true);
  });

  it('round-trips search, filters, and sort through the URL query parameters and filters the visible rows', async () => {
    configure(sessionFor('PLATFORM_ADMINISTRATOR'));
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl(
      '/audit-log?search=score&filter=category:score-change&sort=actor:asc&page=1',
      AuditLogComponent
    );
    await vi.waitFor(() => {
      expect(component.facade.requestState().status === 'ready' || component.facade.requestState().status === 'empty').toBe(true);
    });
    harness.detectChanges();
    const router = TestBed.inject(Router);
    expect(router.url).toContain('search=score');
    expect(router.url).toContain('filter=category:score-change');
    expect(router.url).toContain('sort=actor:asc');

    const element = harness.routeNativeElement as HTMLElement;
    const rows = element.querySelectorAll('.audit-table tbody tr');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of Array.from(rows)) {
      expect(row.querySelector('.col-action')?.textContent?.toLowerCase()).toContain('score-change');
    }
  });

  it('opens the drawer with focus on selection, closes on Escape, and restores focus to the trigger', async () => {
    configure(sessionFor('PLATFORM_ADMINISTRATOR'));
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/audit-log', AuditLogComponent);
    await vi.waitFor(() => {
      expect(component.facade.requestState().status).toBe('ready');
    });
    harness.detectChanges();
    const element = harness.routeNativeElement as HTMLElement;
    const trigger = element.querySelector<HTMLButtonElement>('.row-select');
    expect(trigger).not.toBeNull();
    trigger!.focus();
    trigger!.click();
    harness.detectChanges();
    await vi.waitFor(() => {
      expect(element.querySelector('.audit-detail')).not.toBeNull();
    });
    harness.detectChanges();

    const panel = element.querySelector<HTMLElement>('.audit-detail');
    expect(panel?.getAttribute('role')).toBe('dialog');
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(panel);
    });
    const closeButton = panel?.querySelector<HTMLButtonElement>('.close-action');
    expect(closeButton).not.toBeNull();
    closeButton?.focus();
    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    closeButton?.dispatchEvent(tabEvent);
    expect(tabEvent.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(closeButton);

    panel!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    harness.detectChanges();
    expect(element.querySelector('.audit-detail')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('renders "Redacted" for a non-administrator viewer and hides the export control for OBSERVER', async () => {
    configure(sessionFor('OBSERVER'));
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/audit-log', AuditLogComponent);
    await vi.waitFor(() => {
      expect(component.facade.requestState().status).toBe('ready');
    });
    harness.detectChanges();
    const element = harness.routeNativeElement as HTMLElement;
    expect(element.querySelector('.primary-action')).toBeNull();

    const trigger = element.querySelector<HTMLButtonElement>('.row-select');
    expect(trigger).not.toBeNull();
    trigger!.click();
    harness.detectChanges();
    await vi.waitFor(() => {
      expect(element.querySelector('.audit-detail')?.textContent).toContain('Redacted');
    });
  });
  it('hides stale table and detail through the shared slow state, then recovers through retry', async () => {
    configure(sessionFor('PLATFORM_ADMINISTRATOR'));
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/audit-log', AuditLogComponent);
    await vi.waitFor(() => {
      expect(component.facade.requestState().status).toBe('ready');
    });
    harness.detectChanges();
    const element = harness.routeNativeElement as HTMLElement;
    const trigger = element.querySelector<HTMLButtonElement>('.row-select');
    expect(trigger).not.toBeNull();
    trigger!.click();
    harness.detectChanges();
    expect(element.querySelector('.audit-detail')).not.toBeNull();
    const repository = Reflect.get(component.facade, 'repository');
    expect(repository).toBeInstanceOf(AuditLogRepository);
    if (!(repository instanceof AuditLogRepository)) throw new Error('Audit repository provider is unavailable.');
    vi.useFakeTimers();
    try {
      repository.setMockScenario({ latencyMs: 500 });
      const pending = component.facade.load(component.facade.query()).subscribe({ error: () => undefined });
      harness.detectChanges();
      expect(element.querySelector('.audit-table')).toBeNull();
      expect(element.querySelector('.audit-detail')).toBeNull();
      vi.advanceTimersByTime(399);
      harness.detectChanges();
      expect(element.querySelector('.request-state--loading')).not.toBeNull();
      vi.advanceTimersByTime(1);
      harness.detectChanges();
      expect(element.querySelector('.request-state--slow')).not.toBeNull();
      const retry = element.querySelector<HTMLButtonElement>('.retry-action');
      expect(retry).not.toBeNull();

      repository.resetMockScenario();
      retry!.click();
      vi.advanceTimersByTime(1);
      harness.detectChanges();
      expect(component.facade.requestState().status).toBe('ready');
      expect(element.querySelectorAll('.audit-table tbody tr').length).toBeGreaterThan(0);
      pending.unsubscribe();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
