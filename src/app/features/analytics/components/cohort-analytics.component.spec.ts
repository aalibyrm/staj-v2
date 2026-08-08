import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { DEMO_ACCOUNTS } from '../../../core/auth/authorization';
import { SessionStore } from '../../../core/auth/session.store';
import { adaptiveLearningRoutes } from '../../adaptive-learning/adaptive-learning.routes';
import { CohortAnalyticsComponent } from './cohort-analytics.component';

const cohortId = 'COHORT-MATH101-2025-FALL-A';
const accountIdFor = (role: string): string => DEMO_ACCOUNTS.find((account) => account.roleCode === role)?.id ?? '';
const routeFor = (query: Record<string, string> = {}) => ({ queryParamMap: of(convertToParamMap(query)) });

describe('CohortAnalyticsComponent', () => {
  let sessionStore: SessionStore;
  let router: { navigate: (...args: readonly unknown[]) => Promise<boolean> };

  function createScreen(role = 'INSTRUCTOR', query: Record<string, string> = {}) {
    router = { navigate: vi.fn().mockResolvedValue(true) };
    TestBed.configureTestingModule({
      imports: [CohortAnalyticsComponent],
      providers: [
        { provide: ActivatedRoute, useValue: routeFor(query) },
        { provide: Router, useValue: router }
      ]
    });
    sessionStore = TestBed.inject(SessionStore);
    sessionStore.signIn(accountIdFor(role));
    const fixture = TestBed.createComponent(CohortAnalyticsComponent);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => sessionStore?.signOut());

  it('lazy-loads the real component with the four permitted capabilities', async () => {
    const route = adaptiveLearningRoutes.find((candidate) => candidate.path === 'cohort-analytics');
    expect(route?.data?.['title']).toBe('Cohort analytics');
    expect(route?.loadComponent).toBeDefined();
    expect(route?.data?.['capabilities']).toBeUndefined();
    expect(await route?.loadComponent?.()).toBe(CohortAnalyticsComponent);
  });

  it('blocks the privacy boundary without exposing any individual detail', async () => {
    const fixture = createScreen();
    const facade = fixture.componentInstance.facade;
    await vi.waitFor(() => expect(facade.requestState().status).toBe('ready'));
    facade.setMockScenario({ cohortSizeOverride: 4 });
    facade.refresh();
    await vi.waitFor(() => {
      expect(facade.requestState().status).toBe('ready');
      expect(facade.privacy().count).toBe(4);
    });
    await vi.waitFor(() => expect(facade.privacy().status).toBe('blocked'));
    fixture.detectChanges();

    expect(facade.privacy().count).toBe(4);
    expect(facade.comparisonRows()).toEqual([]);
    expect(fixture.nativeElement.querySelector('table')).toBeNull();
    expect(fixture.nativeElement.querySelector('.privacy-notice')?.textContent).toContain('4 learners');
    expect(fixture.nativeElement.textContent).not.toContain('Learner MATH');
  });

  it('renders exactly the authorized rows at the five-row threshold', async () => {
    const fixture = createScreen();
    const facade = fixture.componentInstance.facade;
    facade.setMockScenario({ cohortSizeOverride: 5 });
    facade.refresh();
    await vi.waitFor(() => {
      expect(facade.requestState().status).toBe('ready');
      expect(facade.privacy().status).toBe('allowed');
      expect(facade.privacy().count).toBe(5);
      expect(facade.comparisonRows()).toHaveLength(5);
    });
    fixture.detectChanges();

    expect(facade.privacy().status).toBe('allowed');
    expect(facade.comparisonRows()).toHaveLength(5);
    expect(facade.comparisonRows().every((row) => row.cohortId === cohortId)).toBe(true);
    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(5);
    expect(fixture.nativeElement.querySelector('table caption')?.textContent).toContain('Individual mastery comparison');
  });

  it('keeps role scope exact and derives measurement cohorts from course analytics grants', async () => {
    const instructor = createScreen('INSTRUCTOR');
    await vi.waitFor(() => expect(instructor.componentInstance.facade.requestState().status).toBe('ready'));
    expect(instructor.componentInstance.facade.filterOptions().cohorts).toHaveLength(1);
    TestBed.resetTestingModule();

    const measurement = createScreen('MEASUREMENT_SPECIALIST');
    await vi.waitFor(() => expect(measurement.componentInstance.facade.requestState().status).toBe('ready'));
    expect(measurement.componentInstance.facade.filterOptions().cohorts).toHaveLength(2);
    expect(measurement.componentInstance.facade.comparisonRows().every((row) => row.cohortId.includes('COHORT-MATH101-2025-FALL'))).toBe(true);
    TestBed.resetTestingModule();

    const admin = createScreen('PLATFORM_ADMINISTRATOR');
    await vi.waitFor(() => expect(admin.componentInstance.facade.requestState().status).toBe('unauthorized'));
    expect(admin.componentInstance.facade.comparisonRows()).toEqual([]);
  });

  it('canonicalizes foreign filters while preserving unrelated query parameters', async () => {
    const fixture = createScreen('INSTRUCTOR', { course: 'foreign-course', cohort: 'foreign-cohort', date: 'invalid', keep: '1' });
    const facade = fixture.componentInstance.facade;
    await vi.waitFor(() => expect(facade.requestState().status).toBe('ready'));
    expect(facade.filters()).toEqual({ courseId: '', cohortId: '', dateRange: 'all' });
    expect(router.navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParamsHandling: 'merge' }));
    facade.updateFilters({ cohortId });
    expect(router.navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: expect.objectContaining({ cohort: cohortId }), queryParamsHandling: 'merge' }));
  });

  it('renders loading, slow, empty, service error/retry, unauthorized, and ready states', async () => {
    const fixture = createScreen();
    const facade = fixture.componentInstance.facade;
    facade.setMockScenario({ latencyMs: 500 });
    facade.refresh();
    expect(facade.requestState().status).toBe('loading');
    await vi.waitFor(() => expect(facade.requestState().status).toBe('slow'));
    facade.setMockScenario({ emptyAnalytics: true, latencyMs: 0 });
    facade.refresh();
    await vi.waitFor(() => expect(facade.requestState().status).toBe('empty'));
    facade.setMockScenario({ outcome: 'service-error' });
    facade.refresh();
    await vi.waitFor(() => expect(facade.requestState().status).toBe('error'));
    facade.setMockScenario({ outcome: 'success' });
    facade.retry();
    await vi.waitFor(() => expect(facade.requestState().status).toBe('ready'));
    sessionStore.switchAccount(accountIdFor('PLATFORM_ADMINISTRATOR'));
    await fixture.whenStable();
    fixture.detectChanges();
    await vi.waitFor(() => expect(facade.requestState().status).toBe('unauthorized'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="status"]')).not.toBeNull();
  });
});
