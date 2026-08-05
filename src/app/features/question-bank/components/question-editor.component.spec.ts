import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NEVER, of, throwError, type Observable } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  QuestionBankFacade,
  type QuestionBankSaveRequestState
} from '../data-access/question-bank.facade';
import {
  asCourseId,
  asLearningOutcomeId,
  asQuestionId,
  type Question,
  type QuestionCreateInput,
  type QuestionOutcomeReference,
  type QuestionUpdateInput
} from '../models/question.models';
import { QuestionEditorComponent } from './question-editor.component';

const courseId = asCourseId('COURSE-TEST-101');
const outcomeId = asLearningOutcomeId('OUTCOME-TEST-101');
const course = { id: courseId, code: 'TEST-101', title: 'Test course' };
const outcome: QuestionOutcomeReference = { id: outcomeId, code: 'OUT-101', title: 'Test outcome' };

const questionFromInput = (input: QuestionCreateInput | QuestionUpdateInput): Question => ({
  id: asQuestionId('QUESTION-TEST-101-NEW-0001'),
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-02T00:00:00.000Z',
  version: 1,
  status: 'draft',
  courseId: input.courseId ?? courseId,
  outcomeId: input.outcomeId ?? outcomeId,
  course,
  outcome,
  title: input.title ?? 'Question',
  stem: input.stem ?? 'Stem',
  explanation: input.explanation ?? 'Explanation',
  tags: input.tags ?? [],
  difficulty: input.difficulty ?? 'medium',
  points: input.points ?? 1,
  grade: input.grade ?? 'foundation',
  type: input.type ?? 'single-choice',
  options: input.options ?? [],
  answer: input.answer ?? { kind: 'boolean', value: true }
});

class TestQuestionBankFacade {
  readonly courseOptions = signal([course]);
  readonly outcomeOptions = signal<readonly QuestionOutcomeReference[]>([outcome]);
  readonly saveRequestState = signal<QuestionBankSaveRequestState>({ status: 'idle' });
  readonly saveFeedback = signal('');
  failure: 'none' | 'service' = 'none';

  readonly loadCourseOptions = vi.fn(() => of(this.courseOptions()));
  readonly loadOutcomeOptions = vi.fn(() => of(this.outcomeOptions()));
  readonly selectQuestion = vi.fn(() => of(null));
  readonly createQuestion = vi.fn((input: QuestionCreateInput): Observable<Question> => {
    if (this.failure === 'service') return throwError(() => new Error('Service unavailable.'));
    return of(questionFromInput(input));
  });
  readonly updateQuestion = vi.fn((id: string, input: QuestionUpdateInput): Observable<Question> => {
    if (this.failure === 'service') return throwError(() => new Error('Service unavailable.'));
    return of({ ...questionFromInput(input), id: asQuestionId(id), version: 2 });
  });
}

describe('QuestionEditorComponent', () => {
  let facade: TestQuestionBankFacade;

  beforeEach(() => {
    facade = new TestQuestionBankFacade();
    TestBed.configureTestingModule({
      imports: [QuestionEditorComponent],
      providers: [{ provide: QuestionBankFacade, useValue: facade }]
    });
  });

  const create = () => {
    const fixture = TestBed.createComponent(QuestionEditorComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.form.patchValue({ courseId, title: '  Title  ', stem: '  Stem  ', explanation: '  Explanation  ', points: 2, tags: ' Alpha, alpha, beta ' });
    component.form.controls.outcomeId.setValue(outcomeId);
    return { fixture, component };
  };

  const setChoice = (component: QuestionEditorComponent, type: 'single-choice' | 'multiple-choice') => {
    component.form.controls.type.setValue(type);
    component.options.at(0).controls.label.setValue(' First option ');
    component.options.at(1).controls.label.setValue('Second option');
    component.options.at(0).controls.correct.setValue(true);
    component.options.at(1).controls.correct.setValue(type === 'multiple-choice');
  };

  it('validates required common fields and focuses the first invalid control', async () => {
    const { fixture, component } = create();
    component.form.controls.title.setValue('');
    component.save();
    fixture.detectChanges();
    expect(component.form.invalid).toBe(true);
    expect(component.feedbackMessage()).toBe('');
    await Promise.resolve();
    expect(document.activeElement?.id).toBe('question-editor-title');
  });

  it('switches types without retaining stale answer controls', () => {
    const { component } = create();
    setChoice(component, 'single-choice');
    component.form.controls.type.setValue('matching');
    expect(component.options.length).toBe(0);
    expect(component.matchingPairs.length).toBe(2);
    component.form.controls.type.setValue('essay');
    expect(component.matchingPairs.length).toBe(0);
    expect(component.acceptedAnswers.length).toBe(0);
    expect(component.form.controls.rubricHint.value).toBe('');
  });

  it('serializes all six answer shapes with normalized common values', () => {
    const cases: readonly ['single-choice' | 'multiple-choice' | 'true-false' | 'matching' | 'short-answer' | 'essay', (component: QuestionEditorComponent) => void, (input: QuestionCreateInput) => void][] = [
      ['single-choice', (component) => setChoice(component, 'single-choice'), (input) => expect(input.answer).toEqual({ kind: 'choice', optionIds: ['option-1'] })],
      ['multiple-choice', (component) => setChoice(component, 'multiple-choice'), (input) => expect(input.answer).toEqual({ kind: 'choice', optionIds: ['option-1', 'option-2'] })],
      ['true-false', (component) => { component.form.controls.type.setValue('true-false'); component.form.controls.booleanAnswer.setValue('false'); }, (input) => expect(input.answer).toEqual({ kind: 'boolean', value: false })],
      ['matching', (component) => { component.form.controls.type.setValue('matching'); component.matchingPairs.at(0).setValue({ prompt: ' One ', answer: ' A ' }); component.matchingPairs.at(1).setValue({ prompt: 'Two', answer: 'B' }); }, (input) => expect(input.answer).toEqual({ kind: 'matching', pairs: [{ prompt: 'One', answer: 'A' }, { prompt: 'Two', answer: 'B' }] })],
      ['short-answer', (component) => { component.form.controls.type.setValue('short-answer'); component.acceptedAnswers.at(0).setValue(' accepted '); }, (input) => expect(input.answer).toEqual({ kind: 'short-answer', acceptedAnswers: ['accepted'] })],
      ['essay', (component) => { component.form.controls.type.setValue('essay'); component.form.controls.rubricHint.setValue(' Rubric '); }, (input) => expect(input.answer).toEqual({ kind: 'essay', rubricHint: 'Rubric' })]
    ];

    for (const [type, prepare, assertAnswer] of cases) {
      const { component } = create();
      component.form.controls.type.setValue(type);
      prepare(component);
      component.save();
      const input = facade.createQuestion.mock.calls.at(-1)?.[0];
      expect(input).toBeDefined();
      expect(input?.tags).toEqual(['Alpha', 'beta']);
      assertAnswer(input as QuestionCreateInput);
    }
  });

  it('blocks duplicate saves while a request is pending and preserves service-error feedback', () => {
    const { component } = create();
    setChoice(component, 'single-choice');
    facade.createQuestion.mockReturnValue(NEVER);
    component.save();
    component.save();
    expect(facade.createQuestion).toHaveBeenCalledTimes(1);
    facade.failure = 'service';
  });

  it('renders preview-only published questions and cancel emits without writing', () => {
    const { fixture, component } = create();
    const published = { ...questionFromInput({}), status: 'published' as const };
    component.question = published;
    component.ngOnChanges({ question: { currentValue: published, previousValue: null, firstChange: true, isFirstChange: () => true } });
    fixture.detectChanges();
    expect(component.editable()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Preview only');
    component.cancel.emit();
    expect(facade.createQuestion).not.toHaveBeenCalled();
    expect(facade.updateQuestion).not.toHaveBeenCalled();
  });
});
