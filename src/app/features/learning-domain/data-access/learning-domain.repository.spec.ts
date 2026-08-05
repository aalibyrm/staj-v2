import { firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { MockTransport } from '../../../core/api/mock-transport';
import {
  LearningDomainError,
  LearningDomainRepository,
  type ContentAccessContext
} from './learning-domain.repository';
import type {
  ContentItemId,
  CourseId,
  LearningOutcomeId
} from '../models/learning-domain.models';

const access = (overrides: Partial<ContentAccessContext> = {}): ContentAccessContext => ({
  mode: 'consume',
  authenticated: true,
  enrolledCourseIds: [],
  completedOutcomeIds: [],
  roleCodes: [],
  referenceTime: '2025-02-01T00:00:00.000Z',
  ...overrides
});

const contentIds = (values: readonly { readonly id: ContentItemId }[]): readonly string[] => values.map(({ id }) => id);

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
    const created = await firstValueFrom(repository.createCourse({
      id: 'course-test' as CourseId,
      code: 'LD-TEST',
      title: 'Repository test course'
    }));
    const updated = await firstValueFrom(repository.updateCourse(created.id, { title: 'Updated repository test course' }));
    expect(updated.title).toBe('Updated repository test course');
    expect(updated.version).toBe(created.version + 1);
    await firstValueFrom(repository.deleteCourse(created.id));
    await expect(firstValueFrom(repository.getCourse(created.id))).rejects.toMatchObject({ code: 'not-found' });
  });

  it('rejects unknown IDs and invalid cross-entity references as observable errors', async () => {
    const repository = new LearningDomainRepository(new MockTransport());
    const course = (await firstValueFrom(repository.listCourses()))[0];
    await expect(firstValueFrom(repository.getCourse('course-missing' as CourseId))).rejects.toBeInstanceOf(LearningDomainError);
    await expect(firstValueFrom(repository.createOutcome({
      courseId: course.id,
      code: 'OUT-TEST',
      title: 'Invalid prerequisite',
      prerequisiteOutcomeIds: ['outcome-missing' as LearningOutcomeId]
    }))).rejects.toMatchObject({ code: 'invalid-reference', referenceId: 'outcome-missing' });
  });

  it('honors test-controlled transport outcomes without mutating storage', async () => {
    const repository = new LearningDomainRepository(new MockTransport());
    const before = repository.getSnapshot();
    repository.setMockScenario({ outcome: 'conflict' });
    await expect(firstValueFrom(repository.listCourses())).rejects.toMatchObject({ kind: 'conflict' });
    expect(repository.getSnapshot()).toEqual(before);
  });

  it('rejects cyclic outcome updates before mutating outcomes or course versions', async () => {
    const repository = new LearningDomainRepository(new MockTransport());
    const before = repository.getSnapshot();
    await expect(firstValueFrom(repository.updateOutcome('outcome-foundations-models' as LearningOutcomeId, {
      prerequisiteOutcomeIds: ['outcome-foundations-analysis' as LearningOutcomeId]
    }))).rejects.toMatchObject({ code: 'validation', message: expect.stringContaining('OUT-102 -> OUT-101 -> OUT-102') });
    expect(repository.getSnapshot()).toEqual(before);
  });

  it('accepts an acyclic outcome prerequisite update', async () => {
    const repository = new LearningDomainRepository(new MockTransport());
    const outcomeId = 'outcome-foundations-analysis' as LearningOutcomeId;
    const prerequisiteOutcomeId = 'outcome-foundations-models' as LearningOutcomeId;
    const current = repository.getSnapshot().outcomes.find((outcome) => outcome.id === outcomeId);
    if (current === undefined) throw new Error('Expected seeded analysis outcome.');
    const updated = await firstValueFrom(repository.updateOutcome(outcomeId, { prerequisiteOutcomeIds: [prerequisiteOutcomeId] }));
    expect(updated.prerequisiteOutcomeIds).toEqual([prerequisiteOutcomeId]);
    expect(updated.version).toBe(current.version + 1);
  });

  it('rejects trimmed case-insensitive duplicate outcome codes before create or update mutation', async () => {
    const repository = new LearningDomainRepository(new MockTransport());
    const beforeCreate = repository.getSnapshot();
    await expect(firstValueFrom(repository.createOutcome({
      id: 'outcome-duplicate-create' as LearningOutcomeId,
      courseId: 'course-foundations' as CourseId,
      code: '  out-101  ',
      title: 'Duplicate create'
    }))).rejects.toMatchObject({
      code: 'validation',
      message: 'Learning outcome code "out-101" is already used in this course.'
    });
    expect(repository.getSnapshot()).toEqual(beforeCreate);

    const beforeUpdate = repository.getSnapshot();
    await expect(firstValueFrom(repository.updateOutcome('outcome-foundations-analysis' as LearningOutcomeId, {
      code: '  out-101  '
    }))).rejects.toMatchObject({
      code: 'validation',
      message: 'Learning outcome code "out-101" is already used in this course.'
    });
    expect(repository.getSnapshot()).toEqual(beforeUpdate);
  });

  it('allows an outcome to keep its own code during update', async () => {
    const repository = new LearningDomainRepository(new MockTransport());
    const current = repository.getSnapshot().outcomes.find((outcome) => outcome.id === 'outcome-foundations-models');
    if (current === undefined) throw new Error('Expected seeded models outcome.');
    const updated = await firstValueFrom(repository.updateOutcome(current.id, { code: `  ${current.code}  ` }));
    expect(updated.code).toBe(current.code);
    expect(updated.version).toBe(current.version + 1);
  });

  it('allows public content for authenticated consume context and denies anonymous access', async () => {
    const repository = new LearningDomainRepository(new MockTransport());
    const publicItem = await firstValueFrom(repository.listContent({}, { contentAccess: access() }));
    expect(contentIds(publicItem)).toEqual(['content-foundations-models']);
    expect(await firstValueFrom(repository.listContent({}, { contentAccess: access({ authenticated: false }) }))).toEqual([]);
  });

  it('requires enrollment and every required outcome before returning content', async () => {
    const repository = new LearningDomainRepository(new MockTransport());
    const courseId = 'course-foundations' as CourseId;
    const outcomeId = 'outcome-foundations-models' as LearningOutcomeId;
    expect(await firstValueFrom(repository.listContent({}, { contentAccess: access({ enrolledCourseIds: [courseId] }) }))).toHaveLength(1);
    const completed = await firstValueFrom(repository.listContent({}, { contentAccess: access({ enrolledCourseIds: [courseId], completedOutcomeIds: [outcomeId] }) }));
    expect(contentIds(completed)).toEqual(['content-foundations-practice', 'content-foundations-models']);
  });

  it('requires a matching role for restricted content without exposing the row otherwise', async () => {
    const repository = new LearningDomainRepository(new MockTransport());
    await firstValueFrom(repository.updateContent('content-application-build' as ContentItemId, {
      accessConditions: {
        visibility: 'restricted', requiresEnrollment: true,
        requiredOutcomeIds: ['outcome-application-design' as LearningOutcomeId], requiredRoleCodes: ['INSTRUCTOR']
      }
    }));
    const base = { enrolledCourseIds: ['course-application' as CourseId], completedOutcomeIds: ['outcome-application-design' as LearningOutcomeId] };
    expect(await firstValueFrom(repository.listContent({}, { contentAccess: access(base) }))).not.toContainEqual(expect.objectContaining({ id: 'content-application-build' }));
    expect(contentIds(await firstValueFrom(repository.listContent({}, { contentAccess: access({ ...base, roleCodes: ['INSTRUCTOR'] }) })))).toContain('content-application-build');
  });

  it('enforces inclusive availability boundaries and fails closed for invalid dates', async () => {
    const repository = new LearningDomainRepository(new MockTransport());
    await firstValueFrom(repository.updateContent('content-foundations-models' as ContentItemId, {
      accessConditions: { visibility: 'public', requiresEnrollment: false, availableFrom: '2025-02-01T00:00:00.000Z', availableUntil: '2025-02-10T00:00:00.000Z' }
    }));
    expect(await firstValueFrom(repository.listContent({}, { contentAccess: access({ referenceTime: '2025-01-31T23:59:59.999Z' }) }))).toEqual([]);
    expect(await firstValueFrom(repository.listContent({}, { contentAccess: access({ referenceTime: '2025-02-01T00:00:00.000Z' }) }))).toHaveLength(1);
    expect(await firstValueFrom(repository.listContent({}, { contentAccess: access({ referenceTime: '2025-02-10T00:00:00.000Z' }) }))).toHaveLength(1);
    expect(await firstValueFrom(repository.listContent({}, { contentAccess: access({ referenceTime: 'invalid' }) }))).toEqual([]);
  });

  it('fails closed for missing or invalid content context on lists and direct reads while management remains explicit', async () => {
    const repository = new LearningDomainRepository(new MockTransport());
    expect(await firstValueFrom(repository.listContent())).toEqual([]);
    expect(await firstValueFrom(repository.listContent({}, { contentAccess: { mode: 'consume' } as ContentAccessContext }))).toEqual([]);
    expect(await firstValueFrom(repository.listContent({}, { contentAccess: { mode: 'consume', authenticated: true, enrolledCourseIds: [], completedOutcomeIds: [], roleCodes: [], referenceTime: 'not-iso' } }))).toEqual([]);

    const denied = await firstValueFrom(repository.getContent('content-foundations-models' as ContentItemId)).catch((error: unknown) => error);
    expect(denied).toBeInstanceOf(LearningDomainError);
    expect(denied).toMatchObject({ code: 'unauthorized', entity: 'content' });
    expect((denied as LearningDomainError).id).toBeUndefined();
    expect((denied as LearningDomainError).message).not.toContain('content-foundations-models');
    await expect(firstValueFrom(repository.getContentItem('content-foundations-models' as ContentItemId, { contentAccess: access({ authenticated: false }) }))).rejects.toMatchObject({ code: 'unauthorized', entity: 'content' });

    const managed = await firstValueFrom(repository.listContent({}, { contentAccess: { mode: 'management' } as ContentAccessContext }));
    expect(managed).toHaveLength(5);
    expect(managed.find((item) => item.id === 'content-application-build')?.accessConditions.visibility).toBe('restricted');
    const managedRead = await firstValueFrom(repository.getContent('content-application-build' as ContentItemId, { contentAccess: { mode: 'management' } as ContentAccessContext }));
    expect(managedRead.id).toBe('content-application-build');
    const consumedRead = await firstValueFrom(repository.getContentItem('content-foundations-models' as ContentItemId, { contentAccess: access() }));
    expect(consumedRead.id).toBe('content-foundations-models');
  });

  it('composes access filtering with server-like filters and stable sorting', async () => {
    const repository = new LearningDomainRepository(new MockTransport());
    const values = await firstValueFrom(repository.listContent({ formats: ['article', 'interactive'], sortBy: 'durationMinutes', sortDirection: 'desc' }, { contentAccess: { mode: 'management' } as ContentAccessContext }));
    expect(contentIds(values)).toEqual(['content-foundations-practice', 'content-foundations-models']);
  });

  it('does not mutate caller-owned access arrays and never leaks inaccessible metadata', async () => {
    const repository = new LearningDomainRepository(new MockTransport());
    const enrolledCourseIds = ['course-application' as CourseId];
    const completedOutcomeIds: LearningOutcomeId[] = [];
    const result = await firstValueFrom(repository.listContent({}, { contentAccess: access({ enrolledCourseIds, completedOutcomeIds }) }));
    expect(enrolledCourseIds).toEqual(['course-application']);
    expect(completedOutcomeIds).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.some((item) => item.title === 'Alignment practice lab')).toBe(false);
  });
});
