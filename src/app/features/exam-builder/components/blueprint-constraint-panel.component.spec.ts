import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';

import type { LearningOutcomeId } from '../../adaptive-learning/models/seed-domain.models';
import {
  compareExamBlueprint,
  createExamBlueprint,
  type ExamBlueprint,
  type ExamBlueprintComparison,
  type ExamBlueprintCurrentCoverageInput
} from '../models/exam-blueprint.models';
import { BlueprintConstraintPanelComponent } from './blueprint-constraint-panel.component';

const outcome = (value: string): LearningOutcomeId => value as LearningOutcomeId;

const createTarget = (): ExamBlueprint => {
  const target = createExamBlueprint({
    targetQuestionCount: 2,
    targetPoints: 3,
    outcomeBuckets: [{ key: outcome('OUT-1'), targetQuestionCount: 2, targetPoints: 3 }],
    difficultyBuckets: [{ key: 'easy', targetQuestionCount: 2, targetPoints: 3 }],
    questionTypeBuckets: [{ key: 'single-choice', targetQuestionCount: 2, targetPoints: 3 }]
  });
  if (target === null) throw new Error('Expected a valid target.');
  return target;
};

const exactCoverage = (): ExamBlueprintCurrentCoverageInput => ({
  outcomeBuckets: [{ key: outcome('OUT-1'), currentQuestionCount: 2, currentPoints: 3 }],
  difficultyBuckets: [{ key: 'easy', currentQuestionCount: 2, currentPoints: 3 }],
  questionTypeBuckets: [{ key: 'single-choice', currentQuestionCount: 2, currentPoints: 3 }]
});

const partialCoverage = (): ExamBlueprintCurrentCoverageInput => ({
  outcomeBuckets: [{ key: outcome('OUT-1'), currentQuestionCount: 1, currentPoints: 2 }],
  difficultyBuckets: [{ key: 'easy', currentQuestionCount: 2, currentPoints: 3 }],
  questionTypeBuckets: [{ key: 'single-choice', currentQuestionCount: 2, currentPoints: 3 }]
});

const missingCoverage = (): ExamBlueprintCurrentCoverageInput => ({
  outcomeBuckets: [],
  difficultyBuckets: [],
  questionTypeBuckets: []
});

const render = (comparison: ExamBlueprintComparison) => {
  const fixture = TestBed.createComponent(BlueprintConstraintPanelComponent);
  fixture.componentInstance.target = createTarget();
  fixture.componentInstance.comparison = comparison;
  fixture.detectChanges();
  return fixture;
};

describe('BlueprintConstraintPanelComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [BlueprintConstraintPanelComponent] });
  });

  it('renders semantic matrix labels, target/current values, and a keyboard-focusable region', () => {
    const target = createTarget();
    const fixture = render(compareExamBlueprint(target, exactCoverage()));
    const element = fixture.nativeElement as HTMLElement;
    const row = element.querySelector('tbody tr:not(.dimension-row)');

    expect(element.querySelector('caption')?.textContent?.trim()).toBe(
      'Blueprint target and current coverage by outcome, difficulty, and question type'
    );
    expect(Array.from(element.querySelectorAll('thead th')).map((header) => header.textContent?.trim())).toEqual([
      'Dimension / bucket',
      'Target count',
      'Current count',
      'Target points',
      'Current points',
      'Status and reason'
    ]);
    expect(row?.querySelector('th')?.textContent?.trim()).toBe('OUT 1');
    expect(Array.from(row?.querySelectorAll('td') ?? []).slice(0, 4).map((cell) => cell.textContent?.trim())).toEqual([
      '2',
      '2',
      '3',
      '3'
    ]);
    expect(row?.querySelector('.row-status')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('✓ Met');
    expect(row?.querySelector('.reason')?.textContent?.trim()).toBe('Target and current coverage match.');
    const matrixRegion = element.querySelector('.matrix-scroll');
    expect(matrixRegion?.getAttribute('role')).toBe('region');
    expect(matrixRegion?.getAttribute('tabindex')).toBe('0');
    expect(matrixRegion?.getAttribute('aria-label')).toBe('Blueprint target and current coverage matrix');
    expect(element.querySelector('.aggregate-status')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('✓ Valid');
  });

  it('announces valid, partial, and missing states with exact reasons and non-color status labels', () => {
    const target = createTarget();

    const partialFixture = render(compareExamBlueprint(target, partialCoverage()));
    const partialElement = partialFixture.nativeElement as HTMLElement;
    const partialRow = partialElement.querySelector('tbody tr:not(.dimension-row)');
    expect(partialElement.querySelector('.aggregate-status')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('△ Partial coverage');
    expect(partialRow?.querySelector('.row-status')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('! Missing');
    expect(partialRow?.querySelector('.reason')?.textContent?.trim()).toBe('1 question missing; 1 point missing.');
    partialFixture.destroy();

    const missingFixture = render(compareExamBlueprint(target, missingCoverage()));
    const missingElement = missingFixture.nativeElement as HTMLElement;
    const missingRow = missingElement.querySelector('tbody tr:not(.dimension-row)');
    expect(missingElement.querySelector('.aggregate-status')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('! Missing coverage');
    expect(missingRow?.querySelector('.row-status')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('! Missing');
    expect(missingRow?.querySelector('.reason')?.textContent?.trim()).toBe('2 questions missing; 3 points missing.');
  });

  it('renders current-only buckets as excess rows with an explicit reason', () => {
    const target = createTarget();
    const current: ExamBlueprintCurrentCoverageInput = {
      ...exactCoverage(),
      outcomeBuckets: [
        ...exactCoverage().outcomeBuckets,
        { key: outcome('OUT-EXTRA'), currentQuestionCount: 1, currentPoints: 1 }
      ]
    };
    const fixture = render(compareExamBlueprint(target, current));
    const extraRow = Array.from(
      fixture.nativeElement.querySelectorAll('tbody tr:not(.dimension-row)') as NodeListOf<HTMLTableRowElement>
    ).find((candidate) => candidate.querySelector('th')?.textContent?.trim() === 'OUT EXTRA');

    expect(extraRow).toBeDefined();
    expect(extraRow?.querySelector('.row-status')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('△ Excess');
    expect(extraRow?.querySelector('.reason')?.textContent?.trim()).toBe('1 question excess; 1 point excess.');
  });
});
