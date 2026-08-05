import { describe, expect, it } from 'vitest';

import {
  type ContentItem,
  type ContentItemId,
  type CourseId,
  type LearningOutcome,
  type LearningOutcomeId,
  type LearningOutcomeMasteryById,
  type LearningPathRecommendationInput
} from './learning-domain.models';
import { recommendLearningPath } from './learning-path-recommendation';

const courseId = (value: string): CourseId => value as CourseId;
const contentItemId = (value: string): ContentItemId => value as ContentItemId;
const outcomeId = (value: string): LearningOutcomeId => value as LearningOutcomeId;

const outcome = (id: string, code = id, course = 'course-a'): LearningOutcome => ({
  id: outcomeId(id),
  courseId: courseId(course),
  code,
  title: `${code} outcome`,
  description: `${code} description`,
  level: 1,
  status: 'published',
  prerequisiteOutcomeIds: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  version: 1
});

const content = (
  id: string,
  title: string,
  learningOutcomeIds: readonly string[] = [],
  course = 'course-a'
): ContentItem => ({
  id: contentItemId(id),
  courseId: courseId(course),
  title,
  description: `${title} description`,
  learningOutcomeIds: learningOutcomeIds.map(outcomeId),
  level: 1,
  durationMinutes: 10,
  format: 'article',
  accessConditions: {},
  status: 'published',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  version: 1
});

const input = (
  masteryByOutcomeId: Record<string, number>,
  completedContentIds: readonly string[] = [],
  lockedContentIds: readonly string[] = []
): LearningPathRecommendationInput => ({
  courseId: courseId('course-a'),
  masteryByOutcomeId: masteryByOutcomeId as LearningOutcomeMasteryById,
  completedContentIds: completedContentIds.map(contentItemId),
  lockedContentIds: lockedContentIds.map(contentItemId)
});

describe('recommendLearningPath', () => {
  it('ranks weaker outcomes before stronger outcomes and reacts to changed mastery', () => {
    const outcomes = [outcome('outcome-weak', 'W'), outcome('outcome-strong', 'S')];
    const contentItems = [
      content('content-strong', 'Strong content', ['outcome-strong']),
      content('content-weak', 'Weak content', ['outcome-weak'])
    ];

    const weakerFirst = recommendLearningPath(input({ 'outcome-weak': 0.2, 'outcome-strong': 0.8 }), contentItems, outcomes);
    const strongerFirst = recommendLearningPath(input({ 'outcome-weak': 0.9, 'outcome-strong': 0.1 }), contentItems, outcomes);

    expect(weakerFirst.map((entry) => entry.contentItemId)).toEqual([
      contentItemId('content-weak'),
      contentItemId('content-strong')
    ]);
    expect(strongerFirst.map((entry) => entry.contentItemId)).toEqual([
      contentItemId('content-strong'),
      contentItemId('content-weak')
    ]);
    expect(weakerFirst.map((entry) => entry.reasonDetails?.code)).toEqual(['weak-outcome', 'spaced-practice']);
    expect(weakerFirst[1].reasonDetails?.summary).toBe('Maintain S');
    expect(weakerFirst[1].reasonDetails?.detail).toContain('spaced practice');
  });

  it('excludes completed and locked content before ranking and keeps contiguous order', () => {
    const result = recommendLearningPath(
      input({ 'outcome-a': 0.1 }, ['content-completed'], ['content-locked']),
      [
        content('content-completed', 'Completed first', ['outcome-a']),
        content('content-locked', 'Locked first', ['outcome-a']),
        content('content-available', 'Available', ['outcome-a'])
      ],
      [outcome('outcome-a')]
    );

    expect(result.map((entry) => entry.contentItemId)).toEqual([contentItemId('content-available')]);
    expect(result.map((entry) => entry.order)).toEqual([1]);
    expect(result.every((entry) => !entry.isCompleted && !entry.isLocked)).toBe(true);
  });

  it('provides non-empty reasons and structured factors for every recommendation', () => {
    const result = recommendLearningPath(
      input({ 'outcome-a': 0.4 }),
      [content('content-measured', 'Measured', ['outcome-a']), content('content-new', 'New')],
      [outcome('outcome-a')]
    );

    expect(result).toHaveLength(2);
    expect(result.every((entry) => entry.reason.trim().length > 0)).toBe(true);
    expect(result.every((entry) => entry.reasonDetails !== undefined)).toBe(true);
    expect(result[0].reasonDetails?.code).toBe('weak-outcome');
    expect(result[0].reasonDetails?.factors['mastery']).toBe(0.4);
    expect(result[1].reasonDetails?.code).toBe('new-content');
    expect(result[1].reasonDetails?.factors['masteryState']).toBe('unmeasured');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
    expect(Object.isFrozen(result[0].reasonDetails)).toBe(true);
    expect(Object.isFrozen(result[0].reasonDetails?.factors)).toBe(true);
  });

  it('uses semantic tie-breakers for measured and new content regardless of input order', () => {
    const outcomes = [outcome('outcome-a', 'A')];
    const contentItems = [
      content('content-new-b', 'New B'),
      content('content-measured-b', 'Measured B', ['outcome-a']),
      content('content-new-a', 'New A'),
      content('content-measured-a', 'Measured A', ['outcome-a'])
    ];

    const first = recommendLearningPath(input({ 'outcome-a': 0.5 }), contentItems, outcomes);
    const second = recommendLearningPath(input({ 'outcome-a': 0.5 }), [...contentItems].reverse(), [...outcomes].reverse());

    expect(first).toEqual(second);
    expect(first.map((entry) => entry.contentItemId)).toEqual([
      contentItemId('content-measured-a'),
      contentItemId('content-measured-b'),
      contentItemId('content-new-a'),
      contentItemId('content-new-b')
    ]);
  });

  it('filters content and outcomes to the requested course', () => {
    const result = recommendLearningPath(
      input({ 'outcome-a': 0.1 }),
      [
        content('content-other-course', 'Other course', ['outcome-a'], 'course-b'),
        content('content-requested', 'Requested course', ['outcome-a'])
      ],
      [outcome('outcome-a'), outcome('outcome-other', 'Other', 'course-b')]
    );

    expect(result.map((entry) => entry.contentItemId)).toEqual([contentItemId('content-requested')]);
  });

  it('does not mutate input arrays or entities', () => {
    const contentItems = [content('content-b', 'B', ['outcome-b']), content('content-a', 'A', ['outcome-a'])];
    const outcomes = [outcome('outcome-b'), outcome('outcome-a')];
    const recommendationInput = input({ 'outcome-a': 0.2, 'outcome-b': 0.8 });
    const beforeContent = JSON.stringify(contentItems);
    const beforeOutcomes = JSON.stringify(outcomes);
    const beforeInput = JSON.stringify(recommendationInput);

    recommendLearningPath(recommendationInput, contentItems, outcomes);

    expect(JSON.stringify(contentItems)).toBe(beforeContent);
    expect(JSON.stringify(outcomes)).toBe(beforeOutcomes);
    expect(JSON.stringify(recommendationInput)).toBe(beforeInput);
  });

  it('clamps finite malformed mastery and treats non-finite mastery as unmeasured', () => {
    const result = recommendLearningPath(
      input({ 'outcome-low': -2, 'outcome-high': 2, 'outcome-invalid': Number.NaN, 'outcome-infinite': Number.POSITIVE_INFINITY }),
      [
        content('content-infinite', 'Infinite', ['outcome-infinite']),
        content('content-invalid', 'Invalid', ['outcome-invalid']),
        content('content-high', 'High', ['outcome-high']),
        content('content-low', 'Low', ['outcome-low'])
      ],
      [outcome('outcome-invalid'), outcome('outcome-high'), outcome('outcome-low'), outcome('outcome-infinite')]
    );

    expect(result.map((entry) => entry.contentItemId)).toEqual([
      contentItemId('content-low'),
      contentItemId('content-high'),
      contentItemId('content-infinite'),
      contentItemId('content-invalid')
    ]);
    expect(result[0].reasonDetails?.factors['mastery']).toBe(0);
    expect(result[1].reasonDetails?.factors['mastery']).toBe(1);
    expect(result[2].reasonDetails?.factors['masteryState']).toBe('unmeasured');
    expect(result[3].reasonDetails?.factors['masteryState']).toBe('unmeasured');
    for (const entry of result) {
      for (const factor of Object.values(entry.reasonDetails?.factors ?? {})) {
        expect(typeof factor !== 'number' || Number.isFinite(factor)).toBe(true);
      }
    }
  });
});
