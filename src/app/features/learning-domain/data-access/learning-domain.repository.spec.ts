import { firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { MockTransport } from '../../../core/api/mock-transport';
import {
  LearningDomainError,
  LearningDomainRepository
} from './learning-domain.repository';
import type { CourseId, LearningOutcomeId } from '../models/learning-domain.models';

describe('LearningDomainRepository', () => {
  it('keeps list observables cold and returns defensive immutable copies', async () => {
    const repository = new LearningDomainRepository(new MockTransport());
    const request = repository.listCourses();

    const courses = await firstValueFrom(request);
    expect(courses.length).toBeGreaterThan(0);
    expect(Object.isFrozen(courses)).toBe(true);
    expect(Object.isFrozen(courses[0])).toBe(true);

    const first = courses[0];
    const second = await firstValueFrom(repository.getCourse(first.id));
    expect(second).not.toBe(first);
    expect(second.learningOutcomeIds).not.toBe(first.learningOutcomeIds);
    expect(second).toEqual(first);
  });

  it('performs create/update/delete without exposing mutable storage', async () => {
    const repository = new LearningDomainRepository(new MockTransport());
    const created = await firstValueFrom(
      repository.createCourse({
        id: 'course-test' as CourseId,
        code: 'LD-TEST',
        title: 'Repository test course'
      })
    );
    const updated = await firstValueFrom(
      repository.updateCourse(created.id, { title: 'Updated repository test course' })
    );

    expect(updated.title).toBe('Updated repository test course');
    expect(updated.version).toBe(created.version + 1);
    await firstValueFrom(repository.deleteCourse(created.id));
    await expect(firstValueFrom(repository.getCourse(created.id))).rejects.toMatchObject({
      code: 'not-found'
    });
  });

  it('rejects unknown IDs and invalid cross-entity references as observable errors', async () => {
    const repository = new LearningDomainRepository(new MockTransport());
    const course = (await firstValueFrom(repository.listCourses()))[0];

    await expect(
      firstValueFrom(repository.getCourse('course-missing' as CourseId))
    ).rejects.toBeInstanceOf(LearningDomainError);
    await expect(
      firstValueFrom(
        repository.createOutcome({
          courseId: course.id,
          code: 'OUT-TEST',
          title: 'Invalid prerequisite',
          prerequisiteOutcomeIds: ['outcome-missing' as LearningOutcomeId]
        })
      )
    ).rejects.toMatchObject({ code: 'invalid-reference', referenceId: 'outcome-missing' });
  });

  it('honors test-controlled transport outcomes without mutating storage', async () => {
    const repository = new LearningDomainRepository(new MockTransport());
    const before = repository.getSnapshot();
    repository.setMockScenario({ outcome: 'conflict' });

    await expect(firstValueFrom(repository.listCourses())).rejects.toMatchObject({ kind: 'conflict' });
    expect(repository.getSnapshot()).toEqual(before);
  });
});
