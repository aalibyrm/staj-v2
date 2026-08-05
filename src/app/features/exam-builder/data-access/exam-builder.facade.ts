import { Injectable, computed, signal, type Signal, type WritableSignal } from '@angular/core';

import type { LearningOutcomeId } from '../../adaptive-learning/models/seed-domain.models';
import { QUESTION_DIFFICULTIES, QUESTION_TYPES } from '../../question-bank/models/question.models';
import { createSeedData } from '../../adaptive-learning/data-access/seed-data.factory';
import {
  compareExamBlueprint,
  createExamBlueprint,
  type ExamBlueprint,
  type ExamBlueprintComparison,
  type ExamBlueprintCurrentCoverage,
  type ExamBlueprintCurrentCoverageInput
} from '../models/exam-blueprint.models';

type ExamBuilderOutcomeChoice = Readonly<{
  readonly id: LearningOutcomeId;
  readonly code: string;
  readonly title: string;
}>;

const freezeCoverage = (input: ExamBlueprintCurrentCoverageInput): ExamBlueprintCurrentCoverage =>
  Object.freeze({
    outcomeBuckets: Object.freeze(input.outcomeBuckets.map((bucket) => Object.freeze({ ...bucket }))),
    difficultyBuckets: Object.freeze(input.difficultyBuckets.map((bucket) => Object.freeze({ ...bucket }))),
    questionTypeBuckets: Object.freeze(input.questionTypeBuckets.map((bucket) => Object.freeze({ ...bucket })))
  });

const emptyCoverageFor = (target: ExamBlueprint): ExamBlueprintCurrentCoverage =>
  freezeCoverage({
    outcomeBuckets: target.outcomeBuckets.map(({ key }) => ({ key, currentQuestionCount: 0, currentPoints: 0 })),
    difficultyBuckets: target.difficultyBuckets.map(({ key }) => ({ key, currentQuestionCount: 0, currentPoints: 0 })),
    questionTypeBuckets: target.questionTypeBuckets.map(({ key }) => ({ key, currentQuestionCount: 0, currentPoints: 0 }))
  });

const createInitialBlueprint = (outcomeIds: readonly string[]): ExamBlueprint => {
  const selectedOutcomes = outcomeIds.slice(0, 3);
  const input = {
    targetQuestionCount: selectedOutcomes.length * 2,
    targetPoints: selectedOutcomes.length * 4,
    outcomeBuckets: selectedOutcomes.map((key) => ({ key, targetQuestionCount: 2, targetPoints: 4 })),
    difficultyBuckets: QUESTION_DIFFICULTIES.map((key) => ({ key, targetQuestionCount: 2, targetPoints: 4 })),
    questionTypeBuckets: QUESTION_TYPES.map((key) => ({ key, targetQuestionCount: 1, targetPoints: 2 }))
  };
  const blueprint = createExamBlueprint(input);
  if (blueprint === null) throw new Error('Canonical seed blueprint could not be created.');
  return blueprint;
};

@Injectable({ providedIn: 'root' })
export class ExamBuilderFacade {
  private readonly targetState: WritableSignal<ExamBlueprint>;
  private readonly currentCoverageState: WritableSignal<ExamBlueprintCurrentCoverage>;
  private readonly updateRevision = signal(0);

  readonly target: Signal<ExamBlueprint>;
  readonly currentCoverage: Signal<ExamBlueprintCurrentCoverage>;
  readonly comparison: Signal<ExamBlueprintComparison>;
  readonly outcomeChoices: Signal<readonly ExamBuilderOutcomeChoice[]>;
  readonly liveUpdateText: Signal<string>;

  constructor() {
    const seed = createSeedData();
    const currentCourse = seed.courses.find((course) => course.status === 'active') ?? seed.courses[0];
    const outcomes = seed.learningOutcomes.filter((outcome) => outcome.courseId === currentCourse?.id);
    const choices = outcomes.map((outcome) => ({ id: outcome.id, code: outcome.code, title: outcome.title }));
    const target = createInitialBlueprint(outcomes.map((outcome) => outcome.id));

    this.targetState = signal(target);
    this.currentCoverageState = signal(emptyCoverageFor(target));
    this.target = this.targetState.asReadonly();
    this.currentCoverage = this.currentCoverageState.asReadonly();
    this.outcomeChoices = signal(Object.freeze(choices.map((choice) => Object.freeze(choice))));
    this.comparison = computed(() => compareExamBlueprint(this.targetState(), this.currentCoverageState()));
    this.liveUpdateText = computed(() => {
      const comparison = this.comparison();
      return this.updateRevision() === 0
        ? comparison.summary
        : `Blueprint updated. ${comparison.summary}`;
    });
  }

  applyBlueprint(input: unknown): boolean {
    const blueprint = createExamBlueprint(input);
    if (blueprint === null) return false;
    this.targetState.set(blueprint);
    this.updateRevision.update((revision) => revision + 1);
    return true;
  }

  replaceCurrentCoverage(input: ExamBlueprintCurrentCoverageInput): void {
    this.currentCoverageState.set(freezeCoverage(input));
  }
}
