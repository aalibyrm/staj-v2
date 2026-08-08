import { TestBed } from '@angular/core/testing';
import { firstValueFrom, Subject } from 'rxjs';
import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';

import { MockTransport } from '../../../core/api/mock-transport';
import {
  LearningDomainFacade
} from '../data-access/learning-domain.facade';
import { LearningDomainRepository } from '../data-access/learning-domain.repository';
import { LearningDomainStore } from './learning-domain.store';
import type { Course, CourseId, LearningOutcome } from '../models/learning-domain.models';

const course = (id: string, title: string, status: Course['status'] = 'published'): Course =>
  Object.freeze({
    id: id as CourseId,
    code: id.toUpperCase(),
    title,
    description: `${title} description`,
    instructorIds: Object.freeze([]),
    learningOutcomeIds: Object.freeze([]),
    status,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    version: 1
  });

describe('LearningDomainStore', () => {
  it('normalizes entities and preserves state identity for no-op upserts', () => {
    const store = new LearningDomainStore();
    const first = course('course-a', 'Alpha');
    const second = course('course-b', 'Beta');

    store.upsertCourse(first);
    store.upsertCourse(second);
    const populated = store.state();
    store.upsertCourse(first);

    expect(store.state()).toBe(populated);
    expect(store.state().courses.ids).toEqual(['course-a', 'course-b']);
    expect(store.state().courses.entities['course-a']).toEqual(first);
    expect(store.courses()).toEqual([first, second]);

    store.deleteCourse(first.id);
    expect(store.state().courses.ids).toEqual(['course-b']);
    expect(store.state().courses.entities['course-a']).toBeUndefined();
  });
  it('marks only the current loading request as slow', () => {
    const store = new LearningDomainStore();

    store.beginRequest('courses', 1);
    expect(store.markRequestSlow('courses', 1)).toBe(true);
    expect(store.coursesRequestState().status).toBe('slow');
    expect(store.markRequestSlow('courses', 1)).toBe(false);

    expect(store.completeRequest('courses', 1, 1)).toBe(true);
    expect(store.markRequestSlow('courses', 1)).toBe(false);
    store.beginRequest('courses', 2);
    expect(store.markRequestSlow('courses', 1)).toBe(false);
    expect(store.coursesRequestState().status).toBe('loading');
  });


  it('filters and sorts through memoized selectors without storing derived arrays', () => {
    const store = new LearningDomainStore();
    store.replaceCourses([
      course('course-b', 'Beta'),
      course('course-a', 'Alpha'),
      course('course-d', 'Draft', 'draft'),
      course('course-e', 'Echo')
    ]);
    const initialFiltered = store.filteredCourses();

    store.setCourseFilter({ search: 'a', sortBy: 'title', sortDirection: 'desc' });
    expect(store.filteredCourses().map((value) => value.title)).toEqual(['Draft', 'Beta', 'Alpha']);
    expect(store.state().courses).toHaveProperty('ids');
    expect(store.state().courses).not.toHaveProperty('filtered');
    expect(store.filteredCourses()).not.toBe(initialFiltered);
  });

  it('tracks loading, empty, and conflict request states while failed writes leave entities intact', async () => {
    const repository = new LearningDomainRepository(new MockTransport());
    const store = new LearningDomainStore();
    const facade = new LearningDomainFacade(repository, store);

    const load = facade.loadCourses({ search: 'does-not-exist' });
    const pending = facade.coursesRequestState();
    expect(pending.status).toBe('idle');
    await firstValueFrom(load);
    expect(facade.coursesRequestState().status).toBe('empty');

    const before = store.courses();
    repository.setMockScenario({ outcome: 'conflict' });
    await expect(
      firstValueFrom(
        facade.createCourse({ code: 'LD-CONFLICT', title: 'Conflict course' })
      )
    ).rejects.toMatchObject({ kind: 'conflict' });
    expect(facade.courses()).toEqual(before);
    expect(facade.coursesRequestState().status).toBe('conflict');
  });

  it('provides the facade through Angular TestBed', () => {
    TestBed.configureTestingModule({
      providers: [MockTransport, LearningDomainRepository, LearningDomainStore, LearningDomainFacade]
    });
    const facade = TestBed.inject(LearningDomainFacade);
    expect(facade.state().courses.ids).toEqual([]);
  });
  describe('LearningDomainFacade slow request lifecycle', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('transitions loading to slow and preserves terminal read semantics', () => {
      const repository = new LearningDomainRepository(new MockTransport());
      const facade = new LearningDomainFacade(repository, new LearningDomainStore());

      const success = facade.loadCourses({}, { latencyMs: 1000 }).subscribe();
      expect(facade.coursesRequestState().status).toBe('loading');
      vi.advanceTimersByTime(400);
      expect(facade.coursesRequestState().status).toBe('slow');
      vi.advanceTimersByTime(600);
      expect(facade.coursesRequestState().status).toBe('success');
      expect(vi.getTimerCount()).toBe(0);
      success.unsubscribe();

      const empty = facade.loadCourses({ search: 'does-not-exist' }, { latencyMs: 1000 }).subscribe();
      vi.advanceTimersByTime(400);
      expect(facade.coursesRequestState().status).toBe('slow');
      vi.advanceTimersByTime(600);
      expect(facade.coursesRequestState().status).toBe('empty');
      empty.unsubscribe();

      const error = facade
        .loadCourses({}, { latencyMs: 1000, outcome: 'service-error' })
        .subscribe({ error: () => undefined });
      vi.advanceTimersByTime(400);
      expect(facade.coursesRequestState().status).toBe('slow');
      vi.advanceTimersByTime(600);
      expect(facade.coursesRequestState().status).toBe('error');

      const unauthorized = facade
        .loadCourses({}, { latencyMs: 1000, outcome: 'unauthorized' })
        .subscribe({ error: () => undefined });
      vi.advanceTimersByTime(400);
      expect(facade.coursesRequestState().status).toBe('slow');
      vi.advanceTimersByTime(600);
      expect(facade.coursesRequestState().status).toBe('unauthorized');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('clears superseded, cancelled, and destroyed timers without stale completion', () => {
      const repository = new LearningDomainRepository(new MockTransport());
      const facade = new LearningDomainFacade(repository, new LearningDomainStore());
      const first$ = new Subject<readonly Course[]>();
      const second$ = new Subject<readonly Course[]>();
      const pending$ = new Subject<readonly Course[]>();
      vi.spyOn(repository, 'listCourses')
        .mockReturnValueOnce(first$.asObservable())
        .mockReturnValueOnce(second$.asObservable())
        .mockReturnValue(pending$.asObservable());

      const first = facade.loadCourses().subscribe();
      expect(vi.getTimerCount()).toBe(1);
      const second = facade.loadCourses().subscribe();
      expect(vi.getTimerCount()).toBe(1);
      first$.next([course('stale', 'Stale')]);
      expect(facade.coursesRequestState().status).toBe('loading');
      vi.advanceTimersByTime(400);
      expect(facade.coursesRequestState().status).toBe('slow');
      first.unsubscribe();

      second$.next([]);
      expect(facade.coursesRequestState().status).toBe('empty');
      expect(vi.getTimerCount()).toBe(0);
      second.unsubscribe();

      const pending = facade.loadCourses().subscribe();
      expect(vi.getTimerCount()).toBe(1);
      facade.ngOnDestroy();
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(400);
      expect(facade.coursesRequestState().status).toBe('loading');
      pending.unsubscribe();
    });

    it('keeps slow timers independent across resources', () => {
      const repository = new LearningDomainRepository(new MockTransport());
      const facade = new LearningDomainFacade(repository, new LearningDomainStore());
      const courses$ = new Subject<readonly Course[]>();
      const outcomes$ = new Subject<readonly LearningOutcome[]>();
      vi.spyOn(repository, 'listCourses').mockReturnValue(courses$.asObservable());
      vi.spyOn(repository, 'listOutcomes').mockReturnValue(outcomes$.asObservable());

      const courses = facade.loadCourses().subscribe();
      const outcomes = facade.loadOutcomes().subscribe();
      vi.advanceTimersByTime(399);
      expect(facade.coursesRequestState().status).toBe('loading');
      expect(facade.outcomesRequestState().status).toBe('loading');
      vi.advanceTimersByTime(1);
      expect(facade.coursesRequestState().status).toBe('slow');
      expect(facade.outcomesRequestState().status).toBe('slow');

      courses$.next([]);
      expect(facade.coursesRequestState().status).toBe('empty');
      expect(facade.outcomesRequestState().status).toBe('slow');
      outcomes$.next([]);
      expect(facade.outcomesRequestState().status).toBe('empty');
      expect(vi.getTimerCount()).toBe(0);
      courses.unsubscribe();
      outcomes.unsubscribe();
    });
  });

});
