import { describe, expect, it } from 'vitest';

import { createSeedData } from '../../adaptive-learning/data-access/seed-data.factory';
import {
  validateExamBlueprint,
  type ExamBlueprint,
  type ExamBlueprintCurrentCoverageInput
} from '../models/exam-blueprint.models';
import { ExamBuilderFacade } from './exam-builder.facade';

const matchingCoverageFor = (target: ExamBlueprint): ExamBlueprintCurrentCoverageInput => ({
  outcomeBuckets: target.outcomeBuckets.map(({ key, targetQuestionCount, targetPoints }) => ({
    key,
    currentQuestionCount: targetQuestionCount,
    currentPoints: targetPoints
  })),
  difficultyBuckets: target.difficultyBuckets.map(({ key, targetQuestionCount, targetPoints }) => ({
    key,
    currentQuestionCount: targetQuestionCount,
    currentPoints: targetPoints
  })),
  questionTypeBuckets: target.questionTypeBuckets.map(({ key, targetQuestionCount, targetPoints }) => ({
    key,
    currentQuestionCount: targetQuestionCount,
    currentPoints: targetPoints
  }))
});

describe('ExamBuilderFacade', () => {
  it('derives canonical seed choices, an initial valid target, and truthful missing comparison', () => {
    const facade = new ExamBuilderFacade();
    const seed = createSeedData();
    const currentCourse = seed.courses.find((course) => course.status === 'active') ?? seed.courses[0];
    if (currentCourse === undefined) throw new Error('Expected a seeded course.');
    const outcomes = seed.learningOutcomes.filter((outcome) => outcome.courseId === currentCourse.id);
    const choices = facade.outcomeChoices();

    expect(choices).toEqual(outcomes.map(({ id, code, title }) => ({ id, code, title })));
    expect(Object.isFrozen(choices)).toBe(true);
    expect(choices.every((choice) => Object.isFrozen(choice))).toBe(true);
    expect(validateExamBlueprint(facade.target())).toEqual([]);
    expect(facade.target().outcomeBuckets.map(({ key }) => key)).toEqual(outcomes.slice(0, 3).map(({ id }) => id));
    expect(facade.target().targetQuestionCount).toBe(6);
    expect(facade.target().targetPoints).toBe(12);
    expect(facade.comparison().status).toBe('missing');
    expect(facade.comparison().summary).toBe('No current coverage is selected; all target buckets are missing.');
  });

  it('applies a valid blueprint and announces the updated comparison', () => {
    const facade = new ExamBuilderFacade();
    const before = facade.target();
    const revised = {
      ...before,
      outcomeBuckets: before.outcomeBuckets.map((bucket, index) => ({ ...bucket, targetPoints: index + 3 })),
      difficultyBuckets: before.difficultyBuckets.map((bucket, index) => ({ ...bucket, targetPoints: index + 3 }))
    };

    expect(facade.applyBlueprint(revised)).toBe(true);
    expect(facade.target()).not.toBe(before);
    expect(facade.target().outcomeBuckets.map(({ targetPoints }) => targetPoints)).toEqual([3, 4, 5]);
    expect(facade.target().difficultyBuckets.map(({ targetPoints }) => targetPoints)).toEqual([3, 4, 5]);
    expect(facade.liveUpdateText()).toBe('Blueprint updated. No current coverage is selected; all target buckets are missing.');
  });

  it('rejects an invalid blueprint without mutating target, comparison, or announcement', () => {
    const facade = new ExamBuilderFacade();
    const beforeTarget = facade.target();
    const beforeCoverage = facade.currentCoverage();
    const beforeComparison = facade.comparison();
    const beforeAnnouncement = facade.liveUpdateText();
    const invalid = { ...beforeTarget, targetQuestionCount: 0 };

    expect(facade.applyBlueprint(invalid)).toBe(false);
    expect(facade.target()).toBe(beforeTarget);
    expect(facade.currentCoverage()).toBe(beforeCoverage);
    expect(facade.comparison()).toBe(beforeComparison);
    expect(facade.liveUpdateText()).toBe(beforeAnnouncement);
  });

  it('replaces coverage and comparison with deeply immutable, matching snapshots', () => {
    const facade = new ExamBuilderFacade();
    const input = matchingCoverageFor(facade.target());
    const beforeInput = JSON.stringify(input);

    facade.replaceCurrentCoverage(input);

    const coverage = facade.currentCoverage();
    const comparison = facade.comparison();
    expect(JSON.stringify(input)).toBe(beforeInput);
    expect(coverage).not.toBe(input);
    expect(Object.isFrozen(coverage)).toBe(true);
    expect(Object.isFrozen(coverage.outcomeBuckets)).toBe(true);
    expect(Object.isFrozen(coverage.outcomeBuckets[0])).toBe(true);
    expect(Object.isFrozen(coverage.difficultyBuckets)).toBe(true);
    expect(Object.isFrozen(coverage.difficultyBuckets[0])).toBe(true);
    expect(Object.isFrozen(coverage.questionTypeBuckets)).toBe(true);
    expect(Object.isFrozen(coverage.questionTypeBuckets[0])).toBe(true);
    expect(comparison.status).toBe('valid');
    expect(Object.isFrozen(comparison)).toBe(true);
    expect(Object.isFrozen(comparison.dimensions)).toBe(true);
    expect(Object.isFrozen(comparison.dimensions[0])).toBe(true);
    expect(Object.isFrozen(comparison.dimensions[0].buckets)).toBe(true);
    expect(Object.isFrozen(comparison.dimensions[0].buckets[0])).toBe(true);
  });

  it('tracks draft request state, normalized settings aliases, and truthful pinned selection readiness', () => {
    const facade = new ExamBuilderFacade();
    expect(facade.requestState().status).toBe('idle');
    expect(facade.selectedPinnedSnapshots()).toEqual([]);
    expect(facade.publishReady()).toBe(false);
    expect(facade.publishReadiness()).toBe(false);
    expect(facade.normalizedSettings()).toEqual(facade.settings());
    expect(facade.setSettings({ title: ' ', durationMinutes: 0, rules: [] })).toBe(false);
    expect(facade.settings().title).toBe('Untitled exam');
  });
});
