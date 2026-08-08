import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { DEMO_ACCOUNTS } from '../../../core/auth/authorization';
import { SessionStore } from '../../../core/auth/session.store';
import { ItemAnalysisComponent } from './item-analysis.component';

const accountIdFor = (role: string): string => DEMO_ACCOUNTS.find((account) => account.roleCode === role)?.id ?? '';
const routeFor = (query: Record<string, string> = {}) => ({ queryParamMap: of(convertToParamMap(query)) });

describe('ItemAnalysisComponent', () => {
  let sessionStore: SessionStore;
  let router: { navigate: (...args: readonly unknown[]) => Promise<boolean> };

  function createScreen(role = 'INSTRUCTOR', query: Record<string, string> = {}) {
    router = { navigate: vi.fn().mockResolvedValue(true) };
    TestBed.configureTestingModule({
      imports: [ItemAnalysisComponent],
      providers: [
        { provide: ActivatedRoute, useValue: routeFor(query) },
        { provide: Router, useValue: router }
      ]
    });
    sessionStore = TestBed.inject(SessionStore);
    sessionStore.signIn(accountIdFor(role));
    const fixture = TestBed.createComponent(ItemAnalysisComponent);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => sessionStore?.signOut());

  it('renders authorized ready data with semantic table and per-row details', async () => {
    const fixture = createScreen('INSTRUCTOR');
    const facade = fixture.componentInstance.facade;
    await vi.waitFor(() => expect(facade.requestState().status).toBe('ready'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#item-analysis-heading')?.textContent?.trim()).toBe('Item analysis');
    expect(fixture.nativeElement.querySelector('table caption')?.textContent).toContain('Authorized item quality metrics');
    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
    expect(fixture.nativeElement.querySelectorAll('details').length).toBeGreaterThan(0);
    expect(fixture.nativeElement.querySelector('[role="status"]')).not.toBeNull();
  });

  it('keeps scope exact and denies roles without the item-analysis capability', async () => {
    const fixture = createScreen('MEASUREMENT_SPECIALIST');
    const facade = fixture.componentInstance.facade;
    await vi.waitFor(() => expect(facade.requestState().status).toBe('ready'));
    expect(facade.scope()?.role).toBe('MEASUREMENT_SPECIALIST');
    expect(facade.rows().every((row) => row.courseId === 'COURSE-MATH101-2025-FALL')).toBe(true);
    TestBed.resetTestingModule();

    const denied = createScreen('PROGRAM_MANAGER');
    await vi.waitFor(() => expect(denied.componentInstance.facade.requestState().status).toBe('unauthorized'));
    expect(denied.componentInstance.facade.rows()).toEqual([]);
    denied.detectChanges();
    expect(denied.nativeElement.querySelector('table')).toBeNull();
  });

  it('canonicalizes foreign URL filters and preserves unrelated query parameters', async () => {
    const fixture = createScreen('INSTRUCTOR', { course: 'foreign', outcome: 'foreign', difficulty: 'invalid', type: 'invalid', keep: '1' });
    const facade = fixture.componentInstance.facade;
    await vi.waitFor(() => expect(facade.requestState().status).toBe('ready'));

    expect(facade.filters()).toEqual({ course: '', outcome: '', difficulty: '', type: '' });
    expect(router.navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParamsHandling: 'merge' }));
    facade.updateFilters({ difficulty: 'medium' });
    expect(router.navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: expect.objectContaining({ difficulty: 'medium' }), queryParamsHandling: 'merge' }));
  });

  it('exposes loading, slow, empty, retryable error, retry, and denial states without stale rows', async () => {
    const fixture = createScreen();
    const facade = fixture.componentInstance.facade;
    await vi.waitFor(() => expect(facade.requestState().status).toBe('ready'));
    facade.setMockScenario({ latencyMs: 500 });
    facade.refresh();
    expect(facade.requestState().status).toBe('loading');
    await vi.waitFor(() => expect(facade.requestState().status).toBe('slow'));

    facade.setMockScenario({ latencyMs: 0, emptyAnalysis: true });
    facade.refresh();
    await vi.waitFor(() => expect(facade.requestState().status).toBe('empty'));
    expect(facade.rows()).toEqual([]);

    facade.setMockScenario({ emptyAnalysis: false, outcome: 'service-error' });
    facade.refresh();
    await vi.waitFor(() => expect(facade.requestState().status).toBe('error'));
    expect(facade.rows()).toEqual([]);
    facade.setMockScenario({ outcome: 'success' });
    facade.retry();
    await vi.waitFor(() => expect(facade.requestState().status).toBe('ready'));

    sessionStore.switchAccount(accountIdFor('PLATFORM_ADMINISTRATOR'));
    await fixture.whenStable();
    fixture.detectChanges();
    await vi.waitFor(() => expect(facade.requestState().status).toBe('unauthorized'));
    expect(facade.rows()).toEqual([]);
  });
});
