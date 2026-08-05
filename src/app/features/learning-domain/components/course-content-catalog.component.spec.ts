import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionStore } from '../../../core/auth/session.store';
import { DEMO_ACCOUNTS, type RoleCode } from '../../../core/auth/authorization';
import { LearningDomainFacade } from '../data-access/learning-domain.facade';
import type { ContentAccessContext } from '../data-access/learning-domain.repository';
import type { ContentItem, Course, CourseId, LearningOutcome, LearningOutcomeId } from '../models/learning-domain.models';
import { CourseContentCatalogComponent } from './course-content-catalog.component';

const courseId = 'course-foundations' as CourseId;
const outcomeId = 'outcome-foundations-models' as LearningOutcomeId;
const course: Course = {
  id: courseId, code: 'LD-101', title: 'Learning Design Foundations', description: 'Foundations', instructorIds: [], learningOutcomeIds: [outcomeId], status: 'published', createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z', version: 1
};
const outcome: LearningOutcome = {
  id: outcomeId, courseId, code: 'OUT-101', title: 'Describe learning models', description: 'Describe models.', level: 1, status: 'published', prerequisiteOutcomeIds: [], createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z', version: 1
};
const item: ContentItem = {
  id: 'content-foundations-models' as ContentItem['id'], courseId, title: 'Outcome modeling primer', description: 'A primer', learningOutcomeIds: [outcomeId], level: 1, durationMinutes: 18, format: 'article', status: 'published', accessConditions: { visibility: 'public', requiresEnrollment: false }, createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z', version: 1
};

const accountIdFor = (role: RoleCode): string => DEMO_ACCOUNTS.find((account) => account.roleCode === role)?.id ?? '';
const requestState = (status: 'idle' | 'loading' | 'success' | 'error' | 'unauthorized') => ({ status, requestId: 1, error: status === 'error' ? new Error('service') : null });
const queryMap = (values: Record<string, string>): { get: (name: string) => string | null } => ({ get: (name) => values[name] ?? null });

class TestFacade {
  readonly courses = signal<readonly Course[]>([course]);
  readonly outcomes = signal<readonly LearningOutcome[]>([outcome]);
  readonly content = signal<readonly ContentItem[]>([item]);
  readonly coursesRequestState = signal(requestState('success'));
  readonly outcomesRequestState = signal(requestState('success'));
  readonly contentRequestState = signal(requestState('success'));
  readonly loadCourses = vi.fn(() => of(this.courses()));
  readonly loadOutcomes = vi.fn(() => of(this.outcomes()));
  readonly loadContent = vi.fn((_filter: unknown, _options: { readonly contentAccess: ContentAccessContext }) => of(this.content()));
}

describe('CourseContentCatalogComponent', () => {
  let facade: TestFacade;
  let queryParams$: BehaviorSubject<{ get: (name: string) => string | null }>;
  const router = { navigate: vi.fn(() => Promise.resolve(true)) };

  beforeEach(() => {
    vi.useFakeTimers();
    facade = new TestFacade();
    queryParams$ = new BehaviorSubject(queryMap({}));
    router.navigate.mockClear();
    TestBed.configureTestingModule({
      imports: [CourseContentCatalogComponent],
      providers: [
        { provide: LearningDomainFacade, useValue: facade },
        { provide: ActivatedRoute, useValue: { queryParamMap: queryParams$.asObservable() } },
        { provide: Router, useValue: router }
      ]
    });
    TestBed.inject(SessionStore).signOut();
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  const create = (role: RoleCode) => {
    TestBed.inject(SessionStore).signIn(accountIdFor(role));
    const fixture = TestBed.createComponent(CourseContentCatalogComponent);
    fixture.detectChanges();
    vi.advanceTimersByTime(250);
    fixture.detectChanges();
    return fixture;
  };

  it('dispatches explicit management and student consume access options', () => {
    create('INSTRUCTOR');
    const managementOptions = facade.loadContent.mock.calls.at(-1)?.[1];
    expect(managementOptions?.contentAccess.mode).toBe('management');
    TestBed.inject(SessionStore).signOut();
    TestBed.inject(SessionStore).signIn(accountIdFor('STUDENT'));
    const studentFixture = TestBed.createComponent(CourseContentCatalogComponent);
    studentFixture.detectChanges();
    vi.advanceTimersByTime(250);
    expect(facade.loadContent.mock.calls.at(-1)?.[1]).toEqual(expect.objectContaining({ contentAccess: expect.objectContaining({ mode: 'consume', completedOutcomeIds: [] }) }));
  });

  it('keeps default query state canonical and mirrors filter changes to the URL', () => {
    const fixture = create('STUDENT');
    expect(router.navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: {} }));
    fixture.componentInstance.filterForm.controls.search.setValue('alignment');
    vi.advanceTimersByTime(250);
    expect(router.navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { search: 'alignment' } }));
    expect(facade.loadContent).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'alignment' }), expect.anything());
  });

  it('renders real metadata and explicit access summaries', () => {
    const fixture = create('STUDENT');
    expect(fixture.nativeElement.textContent).toContain('Outcome modeling primer');
    expect(fixture.nativeElement.textContent).toContain('OUT-101');
    expect(fixture.nativeElement.textContent).toContain('18 minutes');
    expect(fixture.nativeElement.textContent).toContain('Public');
  });

  it('bounds rendered rows and exposes semantic pagination', () => {
    facade.content.set(Array.from({ length: 40 }, (_, index) => ({ ...item, id: `content-${index}` as ContentItem['id'] })));
    const fixture = create('INSTRUCTOR');
    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(25);
    fixture.componentInstance.showMore();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(40);
  });


  it('preserves filters for retry and distinguishes empty access from filter mismatch', () => {
    const fixture = create('STUDENT');
    facade.content.set([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No accessible content');
    fixture.componentInstance.filterForm.controls.search.setValue('missing');
    vi.advanceTimersByTime(250);
    facade.content.set([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No accessible content matches these filters');
    const callsBeforeRetry = facade.loadContent.mock.calls.length;
    fixture.componentInstance.retryLoad();
    vi.advanceTimersByTime(250);
    expect(facade.loadContent.mock.calls.length).toBeGreaterThan(callsBeforeRetry);
    expect(fixture.componentInstance.filterForm.controls.search.value).toBe('missing');
  });

  it('shows no rows for an absent session', () => {
    const fixture = TestBed.createComponent(CourseContentCatalogComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Catalog access unavailable');
    expect(fixture.nativeElement.querySelector('tbody')).toBeNull();
    expect(facade.loadContent).not.toHaveBeenCalled();
  });

  it('accepts route query filters without a feedback loop', () => {
    const fixture = create('PROGRAM_MANAGER');
    const calls = router.navigate.mock.calls.length;
    queryParams$.next(queryMap({ search: 'outcome', sortBy: 'durationMinutes', direction: 'desc' }));
    fixture.detectChanges();
    vi.advanceTimersByTime(250);
    expect(fixture.componentInstance.filterForm.getRawValue()).toEqual(expect.objectContaining({ search: 'outcome', sortBy: 'durationMinutes', sortDirection: 'desc' }));
    expect(router.navigate.mock.calls.length).toBe(calls);
  });
  it('cancels stale filter requests before their rows can replace the current result', () => {
    const fixture = create('STUDENT');
    const stale = new Subject<readonly ContentItem[]>();
    const current = new Subject<readonly ContentItem[]>();
    facade.loadContent.mockImplementationOnce(() => stale).mockImplementationOnce(() => current);
    fixture.componentInstance.filterForm.controls.search.setValue('first');
    vi.advanceTimersByTime(250);
    fixture.componentInstance.filterForm.controls.search.setValue('second');
    vi.advanceTimersByTime(250);
    expect(stale.observers).toHaveLength(0);
    expect(facade.loadContent).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'second' }), expect.anything());
  });
});
