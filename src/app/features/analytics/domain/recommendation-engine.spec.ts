import { describe, expect, it } from 'vitest';

import {
  LEARNING_PATH_REASON_CODES,
  type ContentItem,
  type ContentItemId,
  type CourseId,
  type LearningOutcome,
  type LearningOutcomeId
} from '../../learning-domain/models/learning-domain.models';
import { MASTERY_ERROR_CODES, MasteryError, createMasteryAttempt, type MasteryAttempt } from '../models/mastery.models';
import type { MasteryOptions } from './mastery-calculation';
import {
  recommendLearningPathFromAttempts,
  type RecommendationEngineInput
} from './recommendation-engine';

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

const attempt = (
  outcome: string,
  earnedFraction: number,
  answeredAt = '2026-02-01T00:00:00.000Z'
): MasteryAttempt =>
  createMasteryAttempt({
    outcomeId: outcomeId(outcome),
    questionId: `question-${outcome}`,
    difficulty: 'medium',
    earnedFraction,
    answeredAt
  });

const input = (
  attempts: readonly MasteryAttempt[],
  completedContentIds: readonly string[] = [],
  lockedContentIds: readonly string[] = [],
  masteryOptions?: MasteryOptions
): RecommendationEngineInput => ({
  courseId: courseId('course-a'),
  attempts,
  completedContentIds: completedContentIds.map(contentItemId),
  lockedContentIds: lockedContentIds.map(contentItemId),
  masteryOptions
});

const expectMasteryError = (operation: () => unknown, code: string): void => {
  let caught: unknown;
  try {
    operation();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(MasteryError);
  expect(caught).toMatchObject({ code });
};

describe('recommendLearningPathFromAttempts', () => {
  it('changes ranking and reason details when mastery attempts change', () => {
    const outcomes = [outcome('outcome-weak', 'W'), outcome('outcome-strong', 'S')];
    const contentItems = [
      content('content-strong', 'Strong content', ['outcome-strong']),
      content('content-weak', 'Weak content', ['outcome-weak'])
    ];

    const weakerFirst = recommendLearningPathFromAttempts(
      input([attempt('outcome-weak', 0.2), attempt('outcome-strong', 0.8)]),
      contentItems,
      outcomes
    );
    const strongerFirst = recommendLearningPathFromAttempts(
      input([attempt('outcome-weak', 0.9), attempt('outcome-strong', 0.1)]),
      contentItems,
      outcomes
    );

    expect(weakerFirst.map((entry) => entry.contentItemId)).toEqual([
      contentItemId('content-weak'),
      contentItemId('content-strong')
    ]);
    expect(strongerFirst.map((entry) => entry.contentItemId)).toEqual([
      contentItemId('content-strong'),
      contentItemId('content-weak')
    ]);
    expect(weakerFirst.map((entry) => entry.reasonDetails?.code)).toEqual(['weak-outcome', 'spaced-practice']);
    expect(strongerFirst.map((entry) => entry.reasonDetails?.code)).toEqual(['weak-outcome', 'spaced-practice']);
    expect(weakerFirst.map((entry) => entry.reasonDetails?.summary)).toEqual(['Prioritize W', 'Maintain S']);
    expect(strongerFirst.map((entry) => entry.reasonDetails?.summary)).toEqual(['Prioritize S', 'Maintain W']);
  });

  it('excludes completed and locked content and keeps remaining order contiguous', () => {
    const result = recommendLearningPathFromAttempts(
      input([attempt('outcome-a', 0.1)], ['content-completed'], ['content-locked']),
      [
        content('content-completed', 'Completed first', ['outcome-a']),
        content('content-locked', 'Locked first', ['outcome-a']),
        content('content-available-b', 'Available B', ['outcome-a']),
        content('content-available-a', 'Available A', ['outcome-a'])
      ],
      [outcome('outcome-a')]
    );

    expect(result.map((entry) => entry.contentItemId)).toEqual([
      contentItemId('content-available-a'),
      contentItemId('content-available-b')
    ]);
    expect(result.map((entry) => entry.order)).toEqual([1, 2]);
    expect(result.every((entry) => !entry.isCompleted && !entry.isLocked)).toBe(true);
    expect(result.some((entry) => entry.contentItemId === contentItemId('content-completed'))).toBe(false);
    expect(result.some((entry) => entry.contentItemId === contentItemId('content-locked'))).toBe(false);
  });

  it('returns stable reason codes, human explanations, and finite mastery factors', () => {
    const result = recommendLearningPathFromAttempts(
      input([attempt('outcome-a', 0.4)]),
      [content('content-measured', 'Measured', ['outcome-a']), content('content-new', 'New')],
      [outcome('outcome-a')]
    );

    expect(result).toHaveLength(2);
    for (const entry of result) {
      const details = entry.reasonDetails;
      expect(details).toBeDefined();
      if (details === undefined) continue;
      expect(LEARNING_PATH_REASON_CODES).toContain(details.code);
      expect(details.summary.trim().length).toBeGreaterThan(0);
      expect(details.detail.trim().length).toBeGreaterThan(0);
      for (const factor of Object.values(details.factors)) {
        if (typeof factor === 'number') expect(Number.isFinite(factor)).toBe(true);
      }
    }
    expect(result[0].reasonDetails?.code).toBe('weak-outcome');
    expect(result[1].reasonDetails?.code).toBe('new-content');
  });

  it('uses the existing unmeasured explanation when there are no attempts', () => {
    const [entry] = recommendLearningPathFromAttempts(
      input([]),
      [content('content-new', 'New', ['outcome-a'])],
      [outcome('outcome-a', 'A')]
    );

    expect(entry.reasonDetails?.code).toBe('new-content');
    expect(entry.reasonDetails?.detail).toContain('No finite mastery measurement is available for A');
  });

  it('preserves existing unknown and out-of-course filtering behavior', () => {
    const result = recommendLearningPathFromAttempts(
      input([attempt('outcome-a', 0.2), attempt('outcome-other', 0.9)]),
      [
        content('content-other-course', 'Other course', ['outcome-a'], 'course-b'),
        content('content-unknown-outcome', 'Unknown outcome', ['outcome-unknown']),
        content('content-requested', 'Requested', ['outcome-a'])
      ],
      [outcome('outcome-a', 'A'), outcome('outcome-other', 'Other', 'course-b')]
    );

    expect(result.map((entry) => entry.contentItemId)).toEqual([
      contentItemId('content-requested'),
      contentItemId('content-unknown-outcome')
    ]);
    expect(result[0].reasonDetails?.code).toBe('weak-outcome');
    expect(result[1].reasonDetails?.code).toBe('new-content');
  });

  it('propagates typed mastery option errors without changing the existing selector', () => {
    expectMasteryError(
      () =>
        recommendLearningPathFromAttempts(
          input([], [], [], { recencyWindow: 0 }),
          [content('content-a', 'A')],
          []
        ),
      MASTERY_ERROR_CODES.invalidOptions
    );
  });

  it('is deterministic, does not mutate inputs, and preserves frozen recommendations', () => {
    const attempts = [attempt('outcome-a', 0.2), attempt('outcome-b', 0.8)];
    const contentItems = [content('content-b', 'B', ['outcome-b']), content('content-a', 'A', ['outcome-a'])];
    const outcomes = [outcome('outcome-b'), outcome('outcome-a')];
    const recommendationInput = input(attempts, ['content-done'], ['content-locked']);
    const beforeAttempts = JSON.stringify(attempts);
    const beforeContent = JSON.stringify(contentItems);
    const beforeOutcomes = JSON.stringify(outcomes);
    const beforeInput = JSON.stringify(recommendationInput);

    const first = recommendLearningPathFromAttempts(recommendationInput, contentItems, outcomes);
    const second = recommendLearningPathFromAttempts(recommendationInput, contentItems, outcomes);

    expect(first).toEqual(second);
    expect(JSON.stringify(attempts)).toBe(beforeAttempts);
    expect(JSON.stringify(contentItems)).toBe(beforeContent);
    expect(JSON.stringify(outcomes)).toBe(beforeOutcomes);
    expect(JSON.stringify(recommendationInput)).toBe(beforeInput);
    expect(Object.isFrozen(first)).toBe(true);
    for (const entry of first) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(entry.reasonDetails).toBeDefined();
      if (entry.reasonDetails === undefined) continue;
      expect(Object.isFrozen(entry.reasonDetails)).toBe(true);
      expect(Object.isFrozen(entry.reasonDetails.factors)).toBe(true);
    }
  });
});
