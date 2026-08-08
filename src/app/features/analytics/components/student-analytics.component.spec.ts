import { DeferBlockBehavior, DeferBlockState, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { DEMO_ACCOUNTS, ROUTE_CAPABILITIES } from '../../../core/auth/authorization';
import { ROUTE_CAPABILITIES_DATA_KEY } from '../../../core/auth/auth.guard';
import { SessionStore } from '../../../core/auth/session.store';
import { adaptiveLearningRoutes } from '../../adaptive-learning/adaptive-learning.routes';
import { StudentAnalyticsComponent } from './student-analytics.component';

const ownStudentId = 'STUDENT-MATH101-2025-FALL-A-01';
const unrelatedStudentId = 'STUDENT-EDU201-2025-FALL-A-01';
const routeFor = (studentId: string, query: Record<string, string> = {}) => ({
  paramMap: of(convertToParamMap({ id: studentId })),
  queryParamMap: of(convertToParamMap(query))
});
const accountIdFor = (role: string): string =>
  DEMO_ACCOUNTS.find((account) => account.roleCode === role)?.id ?? '';

describe('StudentAnalyticsComponent', () => {
  let sessionStore: SessionStore;
  let router: { navigate: (...args: readonly unknown[]) => Promise<boolean> };
  let originalIntersectionObserver: typeof IntersectionObserver | undefined;

  beforeEach(() => {
    originalIntersectionObserver = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = class {
      readonly root: Element | null = null;
      readonly rootMargin = '';
      readonly thresholds: readonly number[] = [];
      disconnect(): void {}
      observe(_target: Element): void {}
      takeRecords(): IntersectionObserverEntry[] { return []; }
      unobserve(_target: Element): void {}
    } as unknown as typeof IntersectionObserver;
  });

  function createScreen(
    studentId = ownStudentId,
    query: Record<string, string> = {},
    role = 'STUDENT'
  ) {
    router = { navigate: vi.fn().mockResolvedValue(true) };
    TestBed.configureTestingModule({
      deferBlockBehavior: DeferBlockBehavior.Manual,
      imports: [StudentAnalyticsComponent],
      providers: [
        { provide: ActivatedRoute, useValue: routeFor(studentId, query) },
        { provide: Router, useValue: router }
      ]
    });
    sessionStore = TestBed.inject(SessionStore);
    sessionStore.signIn(accountIdFor(role));
    const fixture = TestBed.createComponent(StudentAnalyticsComponent);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => {
    sessionStore?.signOut();
    if (originalIntersectionObserver === undefined) {
      Reflect.deleteProperty(globalThis, 'IntersectionObserver');
    } else {
      globalThis.IntersectionObserver = originalIntersectionObserver;
    }
  });

  it('keeps the student route lazy behind exactly student and instructor capabilities', async () => {
    const route = adaptiveLearningRoutes.find((candidate) => candidate.path === 'student/:id/analytics');
    expect(route?.pathMatch).toBe('full');
    expect(route?.canMatch?.length).toBe(1);
    expect(route?.data?.['title']).toBe('Student analytics');
    expect(route?.data?.[ROUTE_CAPABILITIES_DATA_KEY]).toEqual([
      ROUTE_CAPABILITIES.studentLearning,
      ROUTE_CAPABILITIES.instructorTeaching
    ]);
    expect(route?.loadComponent).toBeDefined();
    const component = await route?.loadComponent?.();
    expect(component).toBe(StudentAnalyticsComponent);
  });

  it('renders scoped KPIs, heatmap semantics, engine reasons, and memoized selectors', async () => {
    const fixture = createScreen();
    const facade = fixture.componentInstance.facade;
    await vi.waitFor(() => expect(facade.requestState().status).toBe('ready'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.chart-placeholder')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-mastery-trend')).toBeNull();
    expect(facade.studentContext()?.id).toBe(ownStudentId);
    expect(facade.kpis().length).toBe(4);
    expect(facade.heatmapRows().length).toBeGreaterThan(0);
    expect(facade.recommendations().every((item) => item.reason.code.length > 0)).toBe(true);
    expect(facade.heatmapRows()).toBe(facade.heatmapRows());
    const firstTrend = facade.trendRows();
    const outcomeId = facade.filterOptions().outcomes[0]?.value;
    expect(outcomeId).toBeDefined();
    facade.updateFilters({ outcomeId });
    TestBed.tick();
    await fixture.whenStable();
    expect(facade.requestState().status).toBe('ready');
    expect(facade.trendRows()).not.toBe(firstTrend);
    fixture.detectChanges();
    expect(facade.trendRows()).not.toBe(firstTrend);
    const table = fixture.nativeElement.querySelector('app-mastery-heatmap table');
    expect(table).not.toBeNull();
    expect(table.textContent).toContain('Outcome mastery by period');
    const heatmapTable = fixture.nativeElement.querySelector('app-mastery-heatmap table') as HTMLTableElement;
    expect(heatmapTable.querySelector('caption')?.textContent).toContain('percentage and a text status');
    expect(heatmapTable.querySelectorAll('thead th[scope="col"]').length).toBeGreaterThan(1);
    expect(heatmapTable.querySelectorAll('tbody th[scope="row"]').length).toBeGreaterThan(0);
    expect(Array.from(heatmapTable.querySelectorAll('tbody td')).some((cell) => cell.textContent?.trim().length > 0)).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Explainable');
  });
  it('renders the trend only after a manual defer trigger and keeps its table alternative', async () => {
    const fixture = createScreen();
    await vi.waitFor(() => expect(fixture.componentInstance.facade.requestState().status).toBe('ready'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.chart-placeholder')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-mastery-trend')).toBeNull();

    const deferBlocks = await fixture.getDeferBlocks();
    expect(deferBlocks).toHaveLength(1);
    const trendBlock = deferBlocks[0];
    expect(trendBlock).toBeDefined();
    if (trendBlock === undefined) return;
    await trendBlock.render(DeferBlockState.Complete);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-mastery-trend')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-mastery-trend table')).not.toBeNull();
    const trendTable = fixture.nativeElement.querySelector('app-mastery-trend table') as HTMLTableElement;
    expect(trendTable.querySelector('caption')?.textContent).toContain('numeric values and status labels');
    expect(Array.from(trendTable.querySelectorAll('thead th')).map((header) => header.textContent?.trim())).toEqual([
      'Period',
      'Mastery',
      'Status',
      'Attempts'
    ]);
    expect(trendTable.querySelectorAll('tbody th[scope="row"]').length).toBeGreaterThan(0);
  });


  it('canonicalizes URL filters while preserving the route scope and denies unrelated students', async () => {
    const fixture = createScreen(ownStudentId, {
      course: 'invalid-course',
      outcome: 'invalid-outcome',
      date: 'invalid-date'
    });
    await vi.waitFor(() => expect(fixture.componentInstance.facade.requestState().status).toBe('ready'));
    fixture.detectChanges();
    expect(fixture.componentInstance.facade.filters()).toEqual({
      courseId: '',
      dateRange: 'all',
      outcomeId: ''
    });
    expect(router.navigate).toHaveBeenCalled();
    TestBed.resetTestingModule();
    const deniedFixture = createScreen(unrelatedStudentId, {}, 'INSTRUCTOR');
    await vi.waitFor(() =>
      expect(deniedFixture.componentInstance.facade.requestState().status).toBe('unauthorized')
    );
    deniedFixture.detectChanges();
    expect(deniedFixture.nativeElement.textContent).not.toContain(unrelatedStudentId);
  });

  it('clears sensitive data on service error and retries through the transport seam', async () => {
    const fixture = createScreen();
    const facade = fixture.componentInstance.facade;
    await vi.waitFor(() => expect(facade.requestState().status).toBe('ready'));
    facade.setMockScenario({ outcome: 'service-error' });
    facade.refresh();
    await vi.waitFor(() => expect(facade.requestState().status).toBe('error'));
    expect(facade.studentContext()).toBeNull();
    facade.setMockScenario({ outcome: 'success' });
    facade.retry();
    await vi.waitFor(() => expect(facade.requestState().status).toBe('ready'));
  });

  it('denies unsupported account roles before transport', async () => {
    const fixture = createScreen();
    sessionStore.switchAccount(accountIdFor('PLATFORM_ADMINISTRATOR'));
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(fixture.componentInstance.facade.requestState().status).toBe('unauthorized')
    );
    expect(fixture.componentInstance.facade.kpis().length).toBe(0);
  });

  it('denies a switched program manager and clears sensitive student analytics state', async () => {
    const fixture = createScreen();
    const facade = fixture.componentInstance.facade;
    await vi.waitFor(() => expect(facade.requestState().status).toBe('ready'));
    const context = facade.studentContext();
    expect(context).not.toBeNull();
    if (context === null) return;

    sessionStore.switchAccount(accountIdFor('PROGRAM_MANAGER'));
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(facade.requestState().status).toBe('unauthorized')
    );
    fixture.detectChanges();

    expect(facade.studentContext()).toBeNull();
    expect(facade.kpis()).toEqual([]);
    expect(fixture.nativeElement.textContent).not.toContain(context.id);
    expect(fixture.nativeElement.textContent).not.toContain(context.pseudonym);
  });
});
