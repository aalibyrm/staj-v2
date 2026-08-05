import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NEVER, of, type Observable } from 'rxjs';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { ExamBuilderFacade, type ExamAutomaticSelectionState } from '../data-access/exam-builder.facade';
import { compareExamBlueprint, createExamBlueprint, type ExamBlueprintCurrentCoverageInput } from '../models/exam-blueprint.models';
import type { Exam } from '../models/exam.models';
import { asLearningOutcomeId } from '../../question-bank/models/question.models';
import { BlueprintConstraintEditorComponent } from './blueprint-constraint-editor.component';
import { ExamBuilderComponent } from './exam-builder.component';

type PublishExamStub = (changeNote?: string) => Observable<Exam>;

const publishExamStub = (publishExam: PublishExamStub): ExamBuilderFacade => {
  const target = createExamBlueprint({
    targetQuestionCount: 1,
    targetPoints: 2,
    outcomeBuckets: [{ key: 'OUT-1', targetQuestionCount: 1, targetPoints: 2 }],
    difficultyBuckets: [{ key: 'easy', targetQuestionCount: 1, targetPoints: 2 }],
    questionTypeBuckets: [{ key: 'single-choice', targetQuestionCount: 1, targetPoints: 2 }]
  });
  if (target === null) throw new Error('Expected a valid test blueprint.');
  const coverage: ExamBlueprintCurrentCoverageInput = {
    outcomeBuckets: [{ key: asLearningOutcomeId('OUT-1'), currentQuestionCount: 1, currentPoints: 2 }],
    difficultyBuckets: [{ key: 'easy', currentQuestionCount: 1, currentPoints: 2 }],
    questionTypeBuckets: [{ key: 'single-choice', currentQuestionCount: 1, currentPoints: 2 }]
  };
  const exam = {
    id: 'EXAM-1',
    versionId: 'EXAM-1-v1',
    version: 1,
    status: 'draft',
    title: 'Algebra exam',
    durationMinutes: 30,
    rules: [],
    blueprint: target,
    questionVersions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    publishedAt: null,
    publishedBy: null,
    changeNote: ''
  } as unknown as Exam;
  return {
    target: signal(target),
    comparison: signal(compareExamBlueprint(target, coverage)),
    outcomeChoices: signal([]),
    liveUpdateText: signal('Blueprint is valid.'),
    currentExam: signal(exam),
    history: signal([]),
    selectedPinnedSnapshots: signal([]),
    requestState: signal({ status: 'idle' as const }),
    actionableMessage: signal('The draft is ready to publish.'),
    errorMessage: signal(''),
    publishReady: signal(true),
    applyBlueprint: vi.fn(),
    publishExam
  } as unknown as ExamBuilderFacade;
};
describe('ExamBuilderComponent', () => {
  const routeParam = vi.fn(() => null as string | null);
  beforeEach(() => {
    routeParam.mockReset();
    routeParam.mockReturnValue(null);
    return TestBed.configureTestingModule({
      imports: [ExamBuilderComponent],
      providers: [{ provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: routeParam } } } }]
    });
  });
  const create = (facade?: ExamBuilderFacade) => {
    if (facade !== undefined) TestBed.overrideProvider(ExamBuilderFacade, { useValue: facade });
    const fixture = TestBed.createComponent(ExamBuilderComponent);
    fixture.detectChanges();
    return fixture;
  };

  it('renders the four-step hierarchy and keeps the matrix before the keyboard-native editor', () => {
    const fixture = create();
    const element = fixture.nativeElement as HTMLElement;
    const steps = Array.from(element.querySelectorAll('.stepper > li'));
    const primary = element.querySelector('.primary-column') as HTMLElement;
    expect(element.querySelector('nav[aria-label="Exam creation steps"]')).not.toBeNull();
    expect(steps).toHaveLength(4);
    expect(steps.map((step) => step.querySelector('strong')?.textContent?.trim())).toEqual(['Blueprint', 'Question selection', 'Settings', 'Publish review']);
    expect(element.querySelector('li[aria-current="step"] strong')?.textContent?.trim()).toBe('Blueprint');
    expect(Array.from(primary.children).indexOf(primary.querySelector('app-blueprint-constraint-panel') as Element)).toBeLessThan(Array.from(primary.children).indexOf(primary.querySelector('details.editor-disclosure') as Element));
    expect(primary.querySelector('details summary')?.textContent?.trim()).toBe('Adjust blueprint constraints');
  });
  it('keeps semantic matrix values and validation before settings in the narrow-safe DOM order', () => {
    const fixture = create();
    const element = fixture.nativeElement as HTMLElement;
    const matrix = element.querySelector('.matrix-scroll') as HTMLElement;
    const summary = element.querySelector('.summary-card') as HTMLElement;
    const settings = element.querySelector('.settings-shell') as HTMLElement;
    expect(matrix.getAttribute('role')).toBe('region');
    expect(matrix.getAttribute('tabindex')).toBe('0');
    expect(matrix.getAttribute('aria-label')).toBe('Blueprint target and current coverage matrix');
    expect(matrix.querySelector('caption')?.textContent).toContain('Blueprint target and current coverage');
    expect(Array.from(matrix.querySelectorAll('thead th')).map((header) => header.textContent?.trim())).toEqual([
      'Dimension / bucket', 'Target count', 'Current count', 'Target points', 'Current points', 'Status and reason'
    ]);
    expect(matrix.textContent).toContain('Missing');
    expect(element.querySelector('.primary-column')?.firstElementChild?.tagName.toLowerCase()).toBe('app-blueprint-constraint-panel');
    expect(summary.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows truthful empty selection, settings labels, and disabled publish state', () => {
    const fixture = create();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('#exam-title')).not.toBeNull();
    expect(element.querySelector('#exam-duration')).not.toBeNull();
    expect(element.querySelector('#successor-note')).not.toBeNull();
    expect((element.querySelector('button.secondary-action') as HTMLButtonElement).disabled).toBe(true);
    (element.querySelector('button.secondary-action') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.publishConfirmationOpen()).toBe(false);
    expect((element.querySelector('button.secondary-action') as HTMLButtonElement).disabled).toBe(true);
    expect(fixture.componentInstance.form.valid).toBe(true);
    expect((element.querySelector('.settings-shell button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
    expect(element.querySelector('[role="status"][aria-live="polite"]')).not.toBeNull();
  });

  it('uses reactive validation and preserves the editor update announcement', () => {
    const fixture = create();
    const component = fixture.componentInstance;
    const title = component.form.controls.title;
    title.setValue('');
    component.form.markAllAsTouched();
    fixture.detectChanges();
    expect(component.form.invalid).toBe(true);
    const editor = fixture.debugElement.query(By.directive(BlueprintConstraintEditorComponent)).componentInstance as BlueprintConstraintEditorComponent;
    editor.submit();
    fixture.detectChanges();
    expect(component.facade.liveUpdateText()).toContain('Blueprint updated.');
    expect(fixture.nativeElement.querySelector('[role="status"][aria-live="polite"]')).not.toBeNull();
  });

  it('exposes workflow only through the facade and keeps visible keyboard labels', () => {
    const fixture = create();
    const component = fixture.componentInstance;
    const element = fixture.nativeElement as HTMLElement;
    expect(component.facade).toBeInstanceOf(ExamBuilderFacade);
    expect(component).not.toHaveProperty('seed');
    expect(component).not.toHaveProperty('createSeedData');
    expect(element.querySelector('label[for="exam-title"]')?.textContent).toContain('Title');
    expect(element.querySelector('label[for="exam-duration"]')?.textContent).toContain('Duration');
    expect(element.querySelector('.settings-shell button[type="submit"]')?.textContent).toContain('Save draft');
  });

  it('opens a labelled keyboard-accessible confirmation and cancels without a facade call', async () => {
    const publishExam = vi.fn(() => NEVER);
    const fixture = create(publishExamStub(publishExam));
    const trigger = fixture.nativeElement.querySelector('button.secondary-action') as HTMLButtonElement;

    expect(trigger.disabled).toBe(false);
    trigger.click();
    await Promise.resolve();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
    fixture.detectChanges();
    await fixture.whenStable();
    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).not.toBeNull();
    expect(document.activeElement).toBe(dialog);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('publish-confirmation-title');
    expect(dialog.getAttribute('aria-describedby')).toBe('publish-confirmation-description');
    expect(dialog.textContent).toContain('EXAM-1-v1');
    expect(dialog.textContent).toContain('immutable');

    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
    expect(publishExam).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it('confirms once, closes, and locks the publish trigger while the request is pending', () => {
    const publishExam = vi.fn(() => NEVER);
    const fixture = create(publishExamStub(publishExam));
    const trigger = fixture.nativeElement.querySelector('button.secondary-action') as HTMLButtonElement;

    trigger.click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.publish-confirmation-actions button') as HTMLButtonElement).click();
    fixture.detectChanges();
    fixture.componentInstance.confirmPublish();

    expect(publishExam).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.publishConfirmationOpen()).toBe(false);
    expect(fixture.componentInstance.publishSubmissionLocked()).toBe(true);
    expect(trigger.disabled).toBe(true);
  });

  it('restores trigger focus after a completed confirmation request', () => {
    const publishExam = vi.fn(() => of(undefined as unknown as Exam));
    const fixture = create(publishExamStub(publishExam));
    const trigger = fixture.nativeElement.querySelector('button.secondary-action') as HTMLButtonElement;

    trigger.click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.publish-confirmation-actions button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(publishExam).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.publishSubmissionLocked()).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });
  it('invokes automatic selection and exposes retry for a retryable state', () => {
    const autoState = signal<ExamAutomaticSelectionState>({
      status: 'idle',
      selected: Object.freeze([]),
      unmetReasons: Object.freeze([]),
      message: 'Ready'
    });
    const automaticSelect = vi.fn(() => of(autoState()));
    const retryAutoSelection = vi.fn(() => of(autoState()));
    const facade = Object.assign(publishExamStub(() => NEVER), {
      autoSelectionState: autoState,
      targetValid: signal(true),
      autoSelectQuestions: automaticSelect,
      retryAutoSelection
    }) as unknown as ExamBuilderFacade;
    const fixture = create(facade);
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>);
    const automaticButton = buttons.find((button) => button.textContent?.includes('Automatic select')) as HTMLButtonElement;

    automaticButton.click();
    expect(automaticSelect).toHaveBeenCalledTimes(1);
    autoState.set({ status: 'error', selected: Object.freeze([]), unmetReasons: Object.freeze([]), message: 'Retry', retryable: true });
    fixture.detectChanges();
    const retryButton = (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]).find((button) => button.textContent?.trim() === 'Retry') as HTMLButtonElement;
    retryButton.click();
    expect(retryAutoSelection).toHaveBeenCalledTimes(1);
  });

  it('requires a nonblank successor reason before calling the facade, but not for drafts', () => {
    const facade = publishExamStub(() => NEVER);
    const currentExam = facade.currentExam as unknown as WritableSignal<Exam | null>;
    const current = currentExam();
    currentExam.set({ ...(current as Exam), status: 'published' });
    const saveDraft = vi.fn(() => NEVER);
    const fixture = create(Object.assign(facade, { saveDraft }) as unknown as ExamBuilderFacade);
    const note = fixture.nativeElement.querySelector('#successor-note') as HTMLTextAreaElement;

    expect(note.required).toBe(true);
    expect(note.getAttribute('aria-describedby')).toContain('successor-note-error');
    fixture.componentInstance.saveDraft();
    fixture.detectChanges();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('#successor-note-error')).not.toBeNull();
  });

  it('loads an edit route id once and does not load for the new route', () => {
    const loadCurrent = vi.fn(() => of(undefined as unknown as Exam));
    routeParam.mockReturnValue('EXAM-42');
    create(Object.assign(publishExamStub(() => NEVER), { loadCurrent }) as unknown as ExamBuilderFacade);
    expect(loadCurrent).toHaveBeenCalledTimes(1);
    expect(loadCurrent).toHaveBeenCalledWith('EXAM-42');

    TestBed.resetTestingModule();
    routeParam.mockReset();
    routeParam.mockReturnValue(null);
    TestBed.configureTestingModule({
      imports: [ExamBuilderComponent],
      providers: [{ provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: routeParam } } } }]
    });
    const newLoadCurrent = vi.fn(() => of(undefined as unknown as Exam));
    create(Object.assign(publishExamStub(() => NEVER), { loadCurrent: newLoadCurrent }) as unknown as ExamBuilderFacade);
    expect(newLoadCurrent).not.toHaveBeenCalled();
  });
});
