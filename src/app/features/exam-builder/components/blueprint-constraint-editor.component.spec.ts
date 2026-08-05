import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import type { LearningOutcomeId } from '../../adaptive-learning/models/seed-domain.models';
import {
  type ExamBlueprint,
  type ExamBlueprintInput
} from '../models/exam-blueprint.models';
import { BlueprintConstraintEditorComponent, type BlueprintOutcomeChoice } from './blueprint-constraint-editor.component';

const outcome = (value: string): LearningOutcomeId => value as LearningOutcomeId;
const choices: readonly BlueprintOutcomeChoice[] = [
  { id: outcome('OUT-1'), code: 'OUT-001', title: 'Explain evidence' },
  { id: outcome('OUT-2'), code: 'OUT-002', title: 'Apply evidence' }
];

const blueprintInput = (): ExamBlueprintInput => ({
  targetQuestionCount: 3,
  targetPoints: 3,
  outcomeBuckets: [
    { key: outcome('OUT-1'), targetQuestionCount: 1, targetPoints: 1 },
    { key: outcome('OUT-2'), targetQuestionCount: 2, targetPoints: 2 }
  ],
  difficultyBuckets: [
    { key: 'easy', targetQuestionCount: 1, targetPoints: 1 },
    { key: 'hard', targetQuestionCount: 2, targetPoints: 2 }
  ],
  questionTypeBuckets: [
    { key: 'single-choice', targetQuestionCount: 1, targetPoints: 1 },
    { key: 'essay', targetQuestionCount: 2, targetPoints: 2 }
  ]
});

describe('BlueprintConstraintEditorComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [BlueprintConstraintEditorComponent] });
  });

  const create = (initialBlueprint: ExamBlueprintInput = blueprintInput()) => {
    const fixture = TestBed.createComponent(BlueprintConstraintEditorComponent);
    const component = fixture.componentInstance;
    component.outcomeChoices = choices;
    component.initialBlueprint = initialBlueprint;
    component.ngOnChanges({
      initialBlueprint: {
        currentValue: initialBlueprint,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true
      }
    });
    fixture.detectChanges();
    return { fixture, component };
  };

  it('loads initial target and all three editable distributions', () => {
    const { component } = create();

    expect(component.form.controls.targetQuestionCount.value).toBe(3);
    expect(component.form.controls.targetPoints.value).toBe(3);
    expect(component.outcomeBuckets.length).toBe(2);
    expect(component.difficultyBuckets.at(1).controls.key.value).toBe('hard');
    expect(component.questionTypeBuckets.at(1).controls.key.value).toBe('essay');
  });

  it('renders supplied outcomes and canonical difficulty/type options', () => {
    const { fixture } = create();
    const outcomeSelect = fixture.nativeElement.querySelector(
      '[formArrayName="outcomeBuckets"] select'
    ) as HTMLSelectElement;
    const difficultySelect = fixture.nativeElement.querySelector(
      '[formArrayName="difficultyBuckets"] select'
    ) as HTMLSelectElement;
    const typeSelect = fixture.nativeElement.querySelector(
      '[formArrayName="questionTypeBuckets"] select'
    ) as HTMLSelectElement;
    const outcomeOptions = Array.from(outcomeSelect.options).map((option) => option.textContent?.trim());
    const difficultyOptions = Array.from(difficultySelect.options).map((option) => option.textContent?.trim());
    const typeOptions = Array.from(typeSelect.options).map((option) => option.textContent?.trim());

    expect(outcomeOptions).toContain('OUT-001 · Explain evidence');
    expect(difficultyOptions).toEqual(['Easy', 'Medium', 'Hard']);
    expect(typeOptions).toContain('Single Choice');
    expect(typeOptions).toContain('Essay');
  });

  it('adds rows and never removes the final row in a distribution', () => {
    const { component } = create();

    component.removeOutcomeBucket(0);
    expect(component.outcomeBuckets.length).toBe(1);
    component.addOutcomeBucket();
    expect(component.outcomeBuckets.length).toBe(2);
    component.removeOutcomeBucket(1);
    expect(component.outcomeBuckets.length).toBe(1);

    component.removeDifficultyBucket(0);
    component.removeQuestionTypeBucket(0);
    expect(component.difficultyBuckets.length).toBe(1);
    expect(component.questionTypeBuckets.length).toBe(1);
  });

  it('shows cross-distribution total errors and blocks invalid submission', () => {
    const { fixture, component } = create();
    const emitted: ExamBlueprint[] = [];
    component.submitted.subscribe((value) => emitted.push(value));
    component.form.controls.targetQuestionCount.setValue(4);
    component.submit();
    fixture.detectChanges();

    expect(emitted).toHaveLength(0);
    expect(component.distributionError('outcomeBuckets')).toContain('question counts');
    expect(fixture.nativeElement.querySelector('#blueprint-outcomeBuckets-error')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#blueprint-editor-validation-summary')).not.toBeNull();
  });

  it('links invalid fields and focuses the first invalid control', async () => {
    const { fixture, component } = create();
    component.form.controls.targetQuestionCount.setValue(null);
    component.submit();
    fixture.detectChanges();
    await Promise.resolve();

    const input = fixture.nativeElement.querySelector('#blueprint-target-question-count') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('blueprint-target-question-count-error');
    expect(fixture.nativeElement.querySelector('#blueprint-target-question-count-error')).not.toBeNull();
    expect(document.activeElement?.id).toBe('blueprint-target-question-count');
  });

  it('does not emit when a bucket key is blank or noncanonical', () => {
    const { component } = create();
    const emitted: ExamBlueprint[] = [];
    component.submitted.subscribe((value) => emitted.push(value));
    component.outcomeBuckets.at(0).controls.key.setValue('  ');
    component.difficultyBuckets.at(0).controls.key.setValue('trivial');
    component.submit();

    expect(emitted).toHaveLength(0);
    expect(component.domainIssues().some((issue) => issue.path === 'outcomeBuckets[0].key')).toBe(true);
    expect(component.domainIssues().some((issue) => issue.path === 'difficultyBuckets[0].key')).toBe(true);
  });

  it('emits exactly one deeply immutable normalized blueprint for valid input', () => {
    const { component } = create();
    const emitted: ExamBlueprint[] = [];
    component.submitted.subscribe((value) => emitted.push(value));
    component.submit();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual(blueprintInput());
    expect(Object.isFrozen(emitted[0])).toBe(true);
    expect(Object.isFrozen(emitted[0].outcomeBuckets)).toBe(true);
    expect(Object.isFrozen(emitted[0].outcomeBuckets[0])).toBe(true);
  });
});

