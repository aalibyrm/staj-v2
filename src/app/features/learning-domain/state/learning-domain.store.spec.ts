import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { MockTransport } from '../../../core/api/mock-transport';
import {
  LearningDomainFacade
} from '../data-access/learning-domain.facade';
import { LearningDomainRepository } from '../data-access/learning-domain.repository';
import { LearningDomainStore } from './learning-domain.store';
import type { Course, CourseId } from '../models/learning-domain.models';

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
});
