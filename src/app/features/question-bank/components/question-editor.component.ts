import { CommonModule, DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  Output,
  computed,
  inject,
  signal,
  type OnChanges,
  type OnInit,
  type SimpleChanges
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
  type ValidationErrors,
  type ValidatorFn
} from '@angular/forms';
import { catchError, of } from 'rxjs';

import {
  QuestionBankError,
  QuestionBankFacade,
  type QuestionBankSaveStatus
} from '../data-access/question-bank.facade';
import {
  QUESTION_DIFFICULTIES,
  QUESTION_GRADES,
  QUESTION_TYPES,
  asCourseId,
  asLearningOutcomeId,
  type Question,
  type QuestionAnswer,
  type QuestionCreateInput,
  type QuestionDifficulty,
  type QuestionGrade,
  type QuestionOption,
  type QuestionType,
  type QuestionUpdateInput
} from '../models/question.models';

type FeedbackKind = 'success' | 'error' | 'service' | 'unauthorized' | 'conflict' | null;
type EditorField =
  | 'courseId'
  | 'outcomeId'
  | 'type'
  | 'title'
  | 'stem'
  | 'explanation'
  | 'tags'
  | 'difficulty'
  | 'grade'
  | 'points'
  | 'options'
  | 'booleanAnswer'
  | 'matchingPairs'
  | 'acceptedAnswers'
  | 'rubricHint';

type OptionControls = {
  id: FormControl<string>;
  label: FormControl<string>;
  correct: FormControl<boolean>;
};
type MatchingControls = {
  prompt: FormControl<string>;
  answer: FormControl<string>;
};
type EditorRawValue = {
  courseId: string;
  outcomeId: string;
  type: QuestionType;
  title: string;
  stem: string;
  explanation: string;
  tags: string;
  difficulty: QuestionDifficulty;
  grade: QuestionGrade;
  points: number | null;
  options: readonly { id: string; label: string; correct: boolean }[];
  booleanAnswer: 'true' | 'false';
  matchingPairs: readonly { prompt: string; answer: string }[];
  acceptedAnswers: readonly string[];
  rubricHint: string;
};

const nonBlankValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null =>
  typeof control.value === 'string' && control.value.trim().length > 0 ? null : { required: true };

const positivePointsValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null =>
  typeof control.value === 'number' && Number.isFinite(control.value) && control.value > 0 ? null : { positive: true };

const choiceValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const type = control.parent?.get('type')?.value;
  if (type !== 'single-choice' && type !== 'multiple-choice') return null;
  const rows = control.value as readonly { label?: unknown; correct?: unknown }[] | null;
  if (!Array.isArray(rows) || rows.length === 0) return { optionsRequired: true };
  const labels = rows.map((row) => typeof row.label === 'string' ? row.label.trim().toLocaleLowerCase() : '');
  const errors: ValidationErrors = {};
  if (labels.some((label) => label.length === 0)) errors['optionRequired'] = true;
  if (new Set(labels.filter(Boolean)).size !== labels.filter(Boolean).length) errors['duplicateOption'] = true;
  const correctCount = rows.filter((row) => row.correct === true).length;
  if (type === 'single-choice' ? correctCount !== 1 : correctCount < 1) errors['correctOption'] = true;
  return Object.keys(errors).length > 0 ? errors : null;
};

const matchingValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  if (control.parent?.get('type')?.value !== 'matching') return null;
  const rows = control.value as readonly { prompt?: unknown; answer?: unknown }[] | null;
  if (!Array.isArray(rows) || rows.length < 2) return { pairCount: true };
  const prompts = rows.map((row) => typeof row.prompt === 'string' ? row.prompt.trim().toLocaleLowerCase() : '');
  const errors: ValidationErrors = {};
  if (prompts.some((prompt, index) => prompt.length === 0 || typeof rows[index].answer !== 'string' || rows[index].answer!.trim().length === 0)) errors['pairRequired'] = true;
  if (new Set(prompts.filter(Boolean)).size !== prompts.filter(Boolean).length) errors['duplicatePrompt'] = true;
  return Object.keys(errors).length > 0 ? errors : null;
};
const acceptedAnswerValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  if (control.parent?.get('type')?.value !== 'short-answer') return null;
  const values = control.value as readonly unknown[] | null;
  if (!Array.isArray(values) || values.length === 0) return { answerRequired: true };
  const normalized = values.map((value) => typeof value === 'string' ? value.trim().toLocaleLowerCase() : '');
  const errors: ValidationErrors = {};
  if (normalized.some((value) => value.length === 0)) errors['answerRequired'] = true;
  if (new Set(normalized.filter(Boolean)).size !== normalized.filter(Boolean).length) errors['duplicateAnswer'] = true;
  return Object.keys(errors).length > 0 ? errors : null;
};

@Component({
  selector: 'app-question-editor',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="question-editor" aria-labelledby="question-editor-heading">
      <header class="editor-heading">
        <div><span class="eyebrow">{{ isEditing() ? 'Selected question' : 'New question' }}</span><h2 id="question-editor-heading">{{ isEditing() ? 'Edit question' : 'Create question' }}</h2></div>
        <button type="button" class="secondary-button" (click)="cancel.emit()">Cancel</button>
      </header>
      <p class="sr-only" role="status" aria-live="polite">{{ liveMessage() }}</p>
      <div *ngIf="!editable()" class="non-editable-note" role="status">
        <strong>Preview only.</strong> Published and archived questions cannot be edited here. Create a new version in the later publish workflow.
      </div>
      <p *ngIf="referenceError()" class="feedback feedback--error" role="alert">{{ referenceError() }} <button type="button" class="secondary-button" (click)="retryReferences()">Retry references</button></p>
      <div *ngIf="feedbackMessage()" id="question-editor-feedback" tabindex="-1" class="feedback" [class.feedback--success]="feedbackKind() === 'success'" [class.feedback--error]="feedbackKind() !== 'success'" [class.feedback--conflict]="feedbackKind() === 'conflict'" [class.feedback--unauthorized]="feedbackKind() === 'unauthorized'" role="alert" aria-live="assertive">
        {{ feedbackMessage() }}
        <button *ngIf="feedbackKind() === 'service'" type="button" class="secondary-button" [disabled]="isSaving()" (click)="retrySave()">Retry save</button>
        <button *ngIf="feedbackKind() === 'conflict'" type="button" class="secondary-button" (click)="reloadConflict()">Reload question</button>
      </div>
      <div *ngIf="formSubmitted() && form.invalid && editable()" id="question-editor-validation-summary" class="validation-summary" role="alert" aria-live="assertive">
        <strong>Review the highlighted fields.</strong>
        <ul><li *ngFor="let message of validationMessages()">{{ message }}</li></ul>
      </div>
      <form *ngIf="editable()" [formGroup]="form" class="editor-form" novalidate [attr.aria-busy]="isSaving() ? 'true' : null" (ngSubmit)="save()">
        <div class="form-grid">
          <div class="field"><label for="question-editor-course">Course <span aria-hidden="true">*</span></label><select id="question-editor-course" formControlName="courseId" [attr.aria-invalid]="ariaInvalid('courseId')" [attr.aria-describedby]="descriptionId('courseId')"><option value="">Select a course</option><option *ngFor="let course of facade.courseOptions(); trackBy: trackById" [value]="course.id">{{ course.code }} · {{ course.title }}</option></select><p *ngIf="shouldShowError('courseId')" class="field-error" [id]="errorId('courseId')">{{ fieldError('courseId') }}</p></div>
          <div class="field"><label for="question-editor-outcome">Outcome <span aria-hidden="true">*</span></label><select id="question-editor-outcome" formControlName="outcomeId" [attr.aria-invalid]="ariaInvalid('outcomeId')" [attr.aria-describedby]="descriptionId('outcomeId')"><option value="">Select an outcome</option><option *ngFor="let outcome of facade.outcomeOptions(); trackBy: trackById" [value]="outcome.id">{{ outcome.code }} · {{ outcome.title }}</option></select><p *ngIf="shouldShowError('outcomeId')" class="field-error" [id]="errorId('outcomeId')">{{ fieldError('outcomeId') }}</p></div>
          <div class="field"><label for="question-editor-type">Type <span aria-hidden="true">*</span></label><select id="question-editor-type" formControlName="type" [attr.aria-invalid]="ariaInvalid('type')" [attr.aria-describedby]="descriptionId('type')"><option *ngFor="let type of types" [value]="type">{{ label(type) }}</option></select><p *ngIf="shouldShowError('type')" class="field-error" [id]="errorId('type')">{{ fieldError('type') }}</p></div>
          <div class="field"><label for="question-editor-difficulty">Difficulty <span aria-hidden="true">*</span></label><select id="question-editor-difficulty" formControlName="difficulty" [attr.aria-invalid]="ariaInvalid('difficulty')" [attr.aria-describedby]="descriptionId('difficulty')"><option *ngFor="let value of difficulties" [value]="value">{{ label(value) }}</option></select><p *ngIf="shouldShowError('difficulty')" class="field-error" [id]="errorId('difficulty')">{{ fieldError('difficulty') }}</p></div>
          <div class="field"><label for="question-editor-grade">Grade <span aria-hidden="true">*</span></label><select id="question-editor-grade" formControlName="grade" [attr.aria-invalid]="ariaInvalid('grade')" [attr.aria-describedby]="descriptionId('grade')"><option *ngFor="let value of grades" [value]="value">{{ label(value) }}</option></select><p *ngIf="shouldShowError('grade')" class="field-error" [id]="errorId('grade')">{{ fieldError('grade') }}</p></div>
          <div class="field"><label for="question-editor-points">Positive points <span aria-hidden="true">*</span></label><input id="question-editor-points" type="number" min="0.01" step="0.5" formControlName="points" [attr.aria-invalid]="ariaInvalid('points')" [attr.aria-describedby]="descriptionId('points')" /><p *ngIf="shouldShowError('points')" class="field-error" [id]="errorId('points')">{{ fieldError('points') }}</p></div>
          <div class="field field--wide"><label for="question-editor-title">Title <span aria-hidden="true">*</span></label><input id="question-editor-title" formControlName="title" maxlength="200" [attr.aria-invalid]="ariaInvalid('title')" [attr.aria-describedby]="descriptionId('title')" /><p *ngIf="shouldShowError('title')" class="field-error" [id]="errorId('title')">{{ fieldError('title') }}</p></div>
          <div class="field field--wide"><label for="question-editor-stem">Question stem <span aria-hidden="true">*</span></label><textarea id="question-editor-stem" rows="4" maxlength="1200" formControlName="stem" [attr.aria-invalid]="ariaInvalid('stem')" [attr.aria-describedby]="descriptionId('stem')"></textarea><p *ngIf="shouldShowError('stem')" class="field-error" [id]="errorId('stem')">{{ fieldError('stem') }}</p></div>
          <div class="field field--wide"><label for="question-editor-explanation">Explanation <span aria-hidden="true">*</span></label><textarea id="question-editor-explanation" rows="3" formControlName="explanation" [attr.aria-invalid]="ariaInvalid('explanation')" [attr.aria-describedby]="descriptionId('explanation')"></textarea><p *ngIf="shouldShowError('explanation')" class="field-error" [id]="errorId('explanation')">{{ fieldError('explanation') }}</p></div>
          <div class="field field--wide"><label for="question-editor-tags">Tags</label><input id="question-editor-tags" formControlName="tags" placeholder="alignment, evidence, analysis" [attr.aria-describedby]="descriptionId('tags')" /><p class="field-help" [id]="helpId('tags')">Comma-separated tokens are trimmed and deduplicated.</p></div>
        </div>
        <section class="answer-editor" aria-labelledby="answer-editor-heading"><h3 id="answer-editor-heading">Answer controls</h3>
          <div *ngIf="isChoice()" formArrayName="options" class="dynamic-list"><div *ngFor="let option of options.controls; let index = index; trackBy: trackByIndex" [formGroupName]="index" class="dynamic-row"><input [id]="'question-option-' + index" formControlName="label" [attr.aria-label]="'Option ' + (index + 1)" /><label class="correct-control"><input type="checkbox" formControlName="correct" (change)="singleCorrect(index)" /> <span>{{ form.controls.type.value === 'single-choice' ? 'Correct option' : 'Correct' }}</span></label><button type="button" class="icon-button" [disabled]="options.length <= 1" (click)="removeOption(index)" [attr.aria-label]="'Remove option ' + (index + 1)">×</button></div><button type="button" class="secondary-button" (click)="addOption()">Add option</button><p *ngIf="shouldShowError('options')" class="field-error" [id]="errorId('options')">{{ fieldError('options') }}</p></div>
          <fieldset *ngIf="isBoolean()" class="boolean-answer"><legend>Boolean answer</legend><label><input type="radio" formControlName="booleanAnswer" value="true" /> True</label><label><input type="radio" formControlName="booleanAnswer" value="false" /> False</label></fieldset>
          <div *ngIf="isMatching()" formArrayName="matchingPairs" class="dynamic-list"><div *ngFor="let pair of matchingPairs.controls; let index = index; trackBy: trackByIndex" [formGroupName]="index" class="dynamic-row"><input formControlName="prompt" [attr.aria-label]="'Matching prompt ' + (index + 1)" placeholder="Prompt" /><input formControlName="answer" [attr.aria-label]="'Matching answer ' + (index + 1)" placeholder="Answer" /><button type="button" class="icon-button" [disabled]="matchingPairs.length <= 2" (click)="removeMatchingPair(index)" [attr.aria-label]="'Remove matching pair ' + (index + 1)">×</button></div><button type="button" class="secondary-button" (click)="addMatchingPair()">Add pair</button><p *ngIf="shouldShowError('matchingPairs')" class="field-error" [id]="errorId('matchingPairs')">{{ fieldError('matchingPairs') }}</p></div>
          <div *ngIf="isShortAnswer()" formArrayName="acceptedAnswers" class="dynamic-list"><div *ngFor="let answer of acceptedAnswers.controls; let index = index; trackBy: trackByIndex" class="dynamic-row"><input [formControlName]="index" [attr.aria-label]="'Accepted answer ' + (index + 1)" placeholder="Accepted answer" /><button type="button" class="icon-button" [disabled]="acceptedAnswers.length <= 1" (click)="removeAcceptedAnswer(index)" [attr.aria-label]="'Remove accepted answer ' + (index + 1)">×</button></div><button type="button" class="secondary-button" (click)="addAcceptedAnswer()">Add accepted answer</button><p *ngIf="shouldShowError('acceptedAnswers')" class="field-error" [id]="errorId('acceptedAnswers')">{{ fieldError('acceptedAnswers') }}</p></div>
          <div *ngIf="isEssay()" class="field"><label for="question-editor-rubric">Rubric hint <span aria-hidden="true">*</span></label><textarea id="question-editor-rubric" rows="3" formControlName="rubricHint" [attr.aria-invalid]="ariaInvalid('rubricHint')" [attr.aria-describedby]="descriptionId('rubricHint')"></textarea><p *ngIf="shouldShowError('rubricHint')" class="field-error" [id]="errorId('rubricHint')">{{ fieldError('rubricHint') }}</p></div>
        </section>
        <div class="editor-actions"><button type="submit" class="primary-button" [disabled]="isSaving()">{{ isSaving() ? 'Saving…' : isEditing() ? 'Save changes' : 'Create question' }}</button><button type="button" class="secondary-button" [disabled]="isSaving()" (click)="cancel.emit()">Cancel</button></div>
      </form>
      <section class="live-preview" aria-labelledby="question-editor-preview-heading"><h3 id="question-editor-preview-heading">Live preview</h3><p class="question-stem">{{ previewStem() || 'Your question stem will appear here.' }}</p><ol *ngIf="previewOptions().length > 0"><li *ngFor="let option of previewOptions()">{{ option.label }} <strong *ngIf="option.correct">(correct)</strong></li></ol><dl *ngIf="isMatching()"><div *ngFor="let pair of previewPairs()"><dt>{{ pair.prompt }}</dt><dd>{{ pair.answer }}</dd></div></dl><p *ngIf="isShortAnswer()"><strong>Accepted answers:</strong> {{ previewAcceptedAnswers().join(', ') || 'None yet' }}</p><p *ngIf="isEssay()"><strong>Rubric hint:</strong> {{ form.controls.rubricHint.value || 'None yet' }}</p><p class="explanation"><strong>Explanation:</strong> {{ form.controls.explanation.value || 'None yet' }}</p></section>
    </section>
  `,
  styles: [`
    :host { display:block; min-width:0; }
    .question-editor { display:grid; gap:16px; padding:20px; border:1px solid var(--ui-border); border-radius:var(--ui-radius-md); background:var(--ui-surface); box-shadow:var(--ui-shadow-sm); }
    .editor-heading, .editor-actions, .dynamic-row, .feedback { display:flex; align-items:center; gap:10px; }
    .editor-heading { justify-content:space-between; align-items:flex-start; }
    h2, h3, p { margin:0; }
    .eyebrow { color:var(--ui-text-muted); font-size:11px; font-weight:750; letter-spacing:.05em; text-transform:uppercase; }
    .form-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }
    .field { display:grid; gap:5px; min-width:0; }
    .field--wide { grid-column:span 3; }
    label, legend { color:var(--ui-text-muted); font-size:12px; font-weight:700; }
    input, select, textarea { width:100%; min-width:0; min-height:40px; box-sizing:border-box; border:1px solid var(--ui-border-strong); border-radius:var(--ui-radius-sm); background:var(--ui-surface); color:var(--ui-text); padding:8px 10px; font:inherit; }
    textarea { resize:vertical; }
    .answer-editor, .live-preview { display:grid; gap:10px; padding:14px; border:1px solid var(--ui-border); border-radius:var(--ui-radius-sm); background:var(--ui-surface-subtle); }
    .dynamic-list { display:grid; gap:8px; }
    .dynamic-row input { flex:1; }
    .correct-control { display:flex; align-items:center; gap:5px; white-space:nowrap; }
    .correct-control input, .boolean-answer input { width:auto; min-height:0; }
    .boolean-answer { display:flex; gap:14px; border:0; padding:0; }
    .boolean-answer label { display:flex; align-items:center; gap:5px; }
    .primary-button, .secondary-button, .icon-button { min-height:40px; border:1px solid var(--ui-border-strong); border-radius:var(--ui-radius-sm); padding:7px 12px; cursor:pointer; font-weight:700; }
    .primary-button { background:var(--ui-primary); color:var(--ui-on-primary,#fff); border-color:var(--ui-primary); }
    .secondary-button, .icon-button { background:var(--ui-surface); color:var(--ui-text); }
    .icon-button { min-width:40px; font-size:18px; }
    button:disabled { cursor:not-allowed; opacity:.5; }
    .field-error { color:var(--ui-danger,#a11); font-size:12px; font-weight:650; }
    .field-help, .explanation, .non-editable-note { color:var(--ui-text-muted); font-size:12px; line-height:1.45; }
    .validation-summary, .feedback { padding:10px 12px; border:1px solid var(--ui-border-strong); border-radius:var(--ui-radius-sm); }
    .validation-summary { display:grid; gap:5px; }
    .feedback { justify-content:space-between; flex-wrap:wrap; }
    .feedback--success { border-color:var(--ui-success,#276749); }
    .feedback--error, .feedback--conflict, .feedback--unauthorized { border-color:var(--ui-danger,#a11); }
    .live-preview { background:var(--ui-surface); }
    .live-preview ol { margin:0; padding-left:24px; }
    .live-preview dl { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:6px 12px; margin:0; }
    .live-preview dd { margin:0; }
    .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
    @media (max-width:800px) { .form-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } .field--wide { grid-column:span 2; } }
    @media (max-width:560px) { .question-editor { padding:14px; } .form-grid { grid-template-columns:1fr; } .field--wide { grid-column:auto; } .dynamic-row { align-items:stretch; flex-wrap:wrap; } .dynamic-row input { min-width:calc(100% - 50px); } .boolean-answer { flex-direction:column; } }
  `]
})
export class QuestionEditorComponent implements OnInit, OnChanges {
  @Input() question: Question | null = null;
  @Output() readonly cancel = new EventEmitter<void>();
  @Output() readonly saved = new EventEmitter<Question>();

  readonly facade = inject(QuestionBankFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly outcomeCourseLoaded = signal('');
  private readonly document = inject(DOCUMENT);
  private readonly currentQuestionSignal = signal<Question | null>(null);
  private readonly typeSignal = signal<QuestionType>('single-choice');
  private applyingValues = false;
  private lastInput: QuestionCreateInput | QuestionUpdateInput | null = null;

  readonly types = QUESTION_TYPES;
  readonly difficulties = QUESTION_DIFFICULTIES;
  readonly grades = QUESTION_GRADES;
  readonly formSubmitted = signal(false);
  readonly isSaving = signal(false);
  readonly feedbackMessage = signal('');
  readonly feedbackKind = signal<FeedbackKind>(null);
  readonly referenceError = signal('');
  readonly liveMessage = signal('Loading question references.');
  readonly currentQuestion = this.currentQuestionSignal.asReadonly();
  readonly isEditing = computed(() => this.currentQuestionSignal() !== null);
  readonly editable = computed(() => {
    const status = this.currentQuestionSignal()?.status;
    return status === undefined || status === 'draft' || status === 'review';
  });
  readonly isChoice = computed(() => this.isChoiceType(this.typeSignal()));
  readonly isBoolean = computed(() => this.typeSignal() === 'true-false');
  readonly isMatching = computed(() => this.typeSignal() === 'matching');
  readonly isShortAnswer = computed(() => this.typeSignal() === 'short-answer');
  readonly isEssay = computed(() => this.typeSignal() === 'essay');
  readonly options = new FormArray<FormGroup<OptionControls>>([], choiceValidator);
  readonly matchingPairs = new FormArray<FormGroup<MatchingControls>>([], matchingValidator);
  readonly acceptedAnswers = new FormArray<FormControl<string>>([], acceptedAnswerValidator);
  readonly form = new FormGroup({
    courseId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    outcomeId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    type: new FormControl<QuestionType>('single-choice', { nonNullable: true, validators: [Validators.required] }),
    title: new FormControl('', { nonNullable: true, validators: [Validators.required, nonBlankValidator] }),
    stem: new FormControl('', { nonNullable: true, validators: [Validators.required, nonBlankValidator] }),
    explanation: new FormControl('', { nonNullable: true, validators: [Validators.required, nonBlankValidator] }),
    tags: new FormControl('', { nonNullable: true }),
    difficulty: new FormControl<QuestionDifficulty>('medium', { nonNullable: true, validators: [Validators.required] }),
    grade: new FormControl<QuestionGrade>('foundation', { nonNullable: true, validators: [Validators.required] }),
    points: new FormControl<number | null>(1, { validators: [Validators.required, positivePointsValidator] }),
    options: this.options,
    booleanAnswer: new FormControl<'true' | 'false'>('true', { nonNullable: true }),
    matchingPairs: this.matchingPairs,
    acceptedAnswers: this.acceptedAnswers,
    rubricHint: new FormControl('', { nonNullable: true })
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['question']) {
      this.setEditorValues(this.question);
    }
  }

  ngOnInit(): void {
    this.form.controls.type.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((type) => {
      this.typeSignal.set(type);
      if (!this.applyingValues) this.rebuildAnswerControls(type);
      this.refreshDomainValidation();
      this.form.updateValueAndValidity({ emitEvent: false });
    });
    this.form.controls.courseId.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((courseId) => {
      if (!this.applyingValues) this.handleCourseChange(courseId);
    });
    this.loadCourses();
    if (this.question === null) this.rebuildAnswerControls('single-choice');
  }

  save(): void {
    if (this.isSaving()) return;
    this.formSubmitted.set(true);
    this.form.markAllAsTouched();
    this.refreshDomainValidation();
    this.form.updateValueAndValidity({ emitEvent: false });
    if (this.form.invalid) {
      this.liveMessage.set('Question cannot be saved. Review the highlighted fields.');
      this.focusFirstInvalidField();
      return;
    }
    const input = this.serializeInput();
    this.lastInput = input;
    this.executeSave(input);
  }

  retrySave(): void {
    if (this.lastInput !== null && this.feedbackKind() === 'service' && !this.isSaving()) this.executeSave(this.lastInput);
  }

  reloadConflict(): void {
    const current = this.currentQuestionSignal();
    if (current === null) return;
    this.facade.selectQuestion(current.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((question) => {
      if (question !== null) {
        this.setEditorValues(question);
        this.feedbackKind.set(null);
        this.feedbackMessage.set('Question reloaded. Review it before saving again.');
      }
    });
  }

  addOption(): void {
    this.options.push(this.optionGroup(this.nextOptionId(), '', this.options.length === 0));
    this.options.updateValueAndValidity();
  }
  private nextOptionId(): string {
    const used = new Set(this.options.controls.map((row) => row.controls.id.value.trim()));
    let index = 1;
    while (used.has(`option-${index}`)) index += 1;
    return `option-${index}`;
  }

  removeOption(index: number): void {
    if (this.options.length > 1) this.options.removeAt(index);
    this.options.updateValueAndValidity();
  }

  singleCorrect(index: number): void {
    if (this.form.controls.type.value !== 'single-choice') return;
    this.options.controls.forEach((row, rowIndex) => row.controls.correct.setValue(rowIndex === index, { emitEvent: false }));
    this.options.updateValueAndValidity();
  }

  addMatchingPair(): void { this.matchingPairs.push(this.matchingGroup('', '')); this.matchingPairs.updateValueAndValidity(); }
  removeMatchingPair(index: number): void { if (this.matchingPairs.length > 2) this.matchingPairs.removeAt(index); this.matchingPairs.updateValueAndValidity(); }
  addAcceptedAnswer(): void { this.acceptedAnswers.push(new FormControl('', { nonNullable: true, validators: [nonBlankValidator] })); this.acceptedAnswers.updateValueAndValidity(); }
  removeAcceptedAnswer(index: number): void { if (this.acceptedAnswers.length > 1) this.acceptedAnswers.removeAt(index); this.acceptedAnswers.updateValueAndValidity(); }

  isChoiceType(type: QuestionType): boolean { return type === 'single-choice' || type === 'multiple-choice'; }
  label(value: string): string { return value.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
  trackByIndex(index: number): number { return index; }
  trackById(_index: number, value: { readonly id: string }): string { return value.id; }

  previewStem(): string { return this.form.controls.stem.value.trim(); }
  previewOptions(): readonly { readonly label: string; readonly correct: boolean }[] {
    return this.options.controls.map((row) => ({ label: row.controls.label.value.trim(), correct: row.controls.correct.value }));
  }
  previewPairs(): readonly { readonly prompt: string; readonly answer: string }[] { return this.matchingPairs.controls.map((row) => ({ prompt: row.controls.prompt.value.trim(), answer: row.controls.answer.value.trim() })); }
  previewAcceptedAnswers(): readonly string[] { return this.acceptedAnswers.controls.map((control) => control.value.trim()); }

  shouldShowError(name: EditorField): boolean {
    const control = this.control(name);
    return control.invalid && (control.touched || this.formSubmitted());
  }
  ariaInvalid(name: EditorField): string | null { return this.shouldShowError(name) ? 'true' : null; }
  fieldError(name: EditorField): string {
    const errors = this.control(name).errors;
    if (errors === null) return '';
    if (errors['required']) return `${this.fieldLabel(name)} is required.`;
    if (errors['positive']) return 'Points must be greater than zero.';
    if (errors['incompatibleOutcome']) return 'Choose an outcome from the selected course.';
    if (errors['optionRequired'] || errors['optionsRequired']) return 'Every option needs a nonblank label.';
    if (errors['duplicateOption']) return 'Option labels must be unique.';
    if (errors['correctOption']) return this.form.controls.type.value === 'single-choice' ? 'Choose exactly one correct option.' : 'Choose at least one correct option.';
    if (errors['pairCount']) return 'Add at least two matching pairs.';
    if (errors['pairRequired']) return 'Every matching pair needs a prompt and answer.';
    if (errors['duplicatePrompt']) return 'Matching prompts must be unique.';
    if (errors['answerRequired']) return 'Add at least one nonblank accepted answer.';
    if (errors['duplicateAnswer']) return 'Accepted answers must be unique.';
    if (errors['rubricRequired']) return 'Add a nonblank rubric hint.';
    return 'Review this field.';
  }
  validationMessages(): readonly string[] {
    const fields: readonly EditorField[] = ['courseId', 'outcomeId', 'type', 'title', 'stem', 'explanation', 'difficulty', 'grade', 'points', 'options', 'matchingPairs', 'acceptedAnswers', 'rubricHint'];
    return fields.filter((field) => this.control(field).invalid).map((field) => this.fieldError(field));
  }
  descriptionId(name: EditorField): string {
    if (this.shouldShowError(name)) return this.errorId(name);
    return name === 'tags' ? this.helpId(name) : '';
  }
  errorId(name: EditorField): string { return `question-editor-${name}-error`; }
  helpId(name: EditorField): string { return `question-editor-${name}-help`; }

  private control(name: EditorField): AbstractControl { return this.form.controls[name]; }
  private fieldLabel(name: EditorField): string { return name === 'courseId' ? 'Course' : name === 'outcomeId' ? 'Outcome' : this.label(name); }
  private focusFirstInvalidField(): void {
    const fields: readonly EditorField[] = ['courseId', 'outcomeId', 'type', 'title', 'stem', 'explanation', 'difficulty', 'grade', 'points', 'options', 'matchingPairs', 'acceptedAnswers', 'rubricHint'];
    const first = fields.find((field) => this.control(field).invalid);
    if (first !== undefined) {
      const ids: Readonly<Record<EditorField, string>> = {
        courseId: 'question-editor-course',
        outcomeId: 'question-editor-outcome',
        type: 'question-editor-type',
        title: 'question-editor-title',
        stem: 'question-editor-stem',
        explanation: 'question-editor-explanation',
        tags: 'question-editor-tags',
        difficulty: 'question-editor-difficulty',
        grade: 'question-editor-grade',
        points: 'question-editor-points',
        options: 'question-option-0',
        booleanAnswer: 'question-editor-boolean',
        matchingPairs: 'question-matching-prompt-0',
        acceptedAnswers: 'question-accepted-answer-0',
        rubricHint: 'question-editor-rubric'
      };
      queueMicrotask(() => (this.document.getElementById(ids[first]) as HTMLElement | null)?.focus());
    }
  }
  private refreshDomainValidation(): void {
    const courseId = this.form.controls.courseId.value.trim();
    const outcomeId = this.form.controls.outcomeId.value.trim();
    const outcomeErrors = { ...(this.form.controls.outcomeId.errors ?? {}) };
    delete outcomeErrors['incompatibleOutcome'];
    if (
      courseId.length > 0 &&
      outcomeId.length > 0 &&
      this.outcomeCourseLoaded() === courseId &&
      !this.facade.outcomeOptions().some((outcome) => String(outcome.id) === outcomeId)
    ) {
      outcomeErrors['incompatibleOutcome'] = true;
    }
    this.form.controls.outcomeId.setErrors(Object.keys(outcomeErrors).length > 0 ? outcomeErrors : null, { emitEvent: false });
    const rubricErrors = { ...(this.form.controls.rubricHint.errors ?? {}) };
    delete rubricErrors['rubricRequired'];
    if (this.typeSignal() === 'essay' && this.form.controls.rubricHint.value.trim().length === 0) {
      rubricErrors['rubricRequired'] = true;
    }
    this.form.controls.rubricHint.setErrors(Object.keys(rubricErrors).length > 0 ? rubricErrors : null, { emitEvent: false });
  }

  private loadCourses(): void {
    this.referenceError.set('');
    this.facade.loadCourseOptions().pipe(catchError((error: unknown) => { this.referenceError.set(error instanceof Error ? error.message : 'Question references could not be loaded.'); this.liveMessage.set('Question references could not be loaded. Try again.'); return of([]); }), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      const courseId = this.form.controls.courseId.value;
      if (courseId.length > 0) this.loadOutcomes(courseId);
      else this.liveMessage.set('Question references loaded.');
    });
  }
  retryReferences(): void { this.loadCourses(); }

  private loadOutcomes(courseId: string): void {
    this.referenceError.set('');
    this.facade.loadOutcomeOptions(courseId).pipe(catchError((error: unknown) => { this.referenceError.set(error instanceof Error ? error.message : 'Outcomes could not be loaded.'); return of([]); }), takeUntilDestroyed(this.destroyRef)).subscribe((outcomes) => {
      this.outcomeCourseLoaded.set(courseId);
      if (!outcomes.some((outcome) => String(outcome.id) === this.form.controls.outcomeId.value)) this.form.controls.outcomeId.setValue('');
      this.refreshDomainValidation();
      this.form.controls.outcomeId.updateValueAndValidity();
      this.liveMessage.set('Outcomes filtered to the selected course.');
    });
  }
  private handleCourseChange(courseId: string): void {
    if (this.outcomeCourseLoaded() !== courseId) this.form.controls.outcomeId.setValue('');
    this.loadOutcomes(courseId);
    this.refreshDomainValidation();
    this.form.controls.outcomeId.updateValueAndValidity();
  }

  private setEditorValues(question: Question | null): void {
    this.applyingValues = true;
    this.currentQuestionSignal.set(question);
    this.form.reset({
      courseId: question?.courseId ? String(question.courseId) : '',
      outcomeId: question?.outcomeId ? String(question.outcomeId) : '',
      type: question?.type ?? 'single-choice',
      title: question?.title ?? '',
      stem: question?.stem ?? '',
      explanation: question?.explanation ?? '',
      tags: question?.tags.join(', ') ?? '',
      difficulty: question?.difficulty ?? 'medium',
      grade: question?.grade ?? 'foundation',
      points: question?.points ?? 1,
      booleanAnswer: question?.answer.kind === 'boolean' && question.answer.value ? 'true' : 'false',
      rubricHint: question?.answer.kind === 'essay' ? question.answer.rubricHint : ''
    }, { emitEvent: false });
    this.typeSignal.set(this.form.controls.type.value);
    this.rebuildAnswerControls(question?.type ?? 'single-choice', question?.answer);
    this.applyingValues = false;
    this.formSubmitted.set(false);
    this.feedbackKind.set(null);
    this.feedbackMessage.set('');
    this.form.markAsPristine();
    this.form.markAsUntouched();
    this.form.updateValueAndValidity({ emitEvent: false });
  }

  private rebuildAnswerControls(type: QuestionType, answer?: QuestionAnswer): void {
    this.options.clear(); this.matchingPairs.clear(); this.acceptedAnswers.clear(); this.form.controls.rubricHint.setValue('', { emitEvent: false });
    if (this.isChoiceType(type)) {
      const optionRows = answer?.kind === 'choice' && this.currentQuestionSignal()?.options.length ? this.currentQuestionSignal()!.options : [
        { id: 'option-1', label: '', correct: true }, { id: 'option-2', label: '', correct: false }
      ];
      const selected = answer?.kind === 'choice' ? new Set(answer.optionIds) : new Set<string>(['option-1']);
      optionRows.forEach((option, index) => this.options.push(this.optionGroup(option.id, option.label, answer?.kind === 'choice' ? selected.has(option.id) : index === 0)));
    } else if (type === 'matching') {
      const pairs = answer?.kind === 'matching' ? answer.pairs : [{ prompt: '', answer: '' }, { prompt: '', answer: '' }];
      pairs.forEach((pair) => this.matchingPairs.push(this.matchingGroup(pair.prompt, pair.answer)));
    } else if (type === 'short-answer') {
      const values = answer?.kind === 'short-answer' ? answer.acceptedAnswers : [''];
      values.forEach((value) => this.acceptedAnswers.push(new FormControl(value, { nonNullable: true, validators: [nonBlankValidator] })));
    } else if (type === 'essay' && answer?.kind === 'essay') {
      this.form.controls.rubricHint.setValue(answer.rubricHint, { emitEvent: false });
    }
    this.options.updateValueAndValidity({ emitEvent: false }); this.matchingPairs.updateValueAndValidity({ emitEvent: false }); this.acceptedAnswers.updateValueAndValidity({ emitEvent: false });
  }

  private optionGroup(id: string, label: string, correct: boolean): FormGroup<OptionControls> {
    return new FormGroup({ id: new FormControl(id, { nonNullable: true }), label: new FormControl(label, { nonNullable: true, validators: [nonBlankValidator] }), correct: new FormControl(correct, { nonNullable: true }) });
  }
  private matchingGroup(prompt: string, answer: string): FormGroup<MatchingControls> {
    return new FormGroup({ prompt: new FormControl(prompt, { nonNullable: true, validators: [nonBlankValidator] }), answer: new FormControl(answer, { nonNullable: true, validators: [nonBlankValidator] }) });
  }

  private serializeInput(): QuestionCreateInput | QuestionUpdateInput {
    const raw = this.form.getRawValue() as EditorRawValue;
    const options: readonly QuestionOption[] = this.options.controls.map((row) => ({ id: row.controls.id.value.trim(), label: row.controls.label.value.trim() }));
    let answer: QuestionAnswer;
    if (raw.type === 'single-choice' || raw.type === 'multiple-choice') answer = { kind: 'choice', optionIds: this.options.controls.filter((row) => row.controls.correct.value).map((row) => row.controls.id.value.trim()) };
    else if (raw.type === 'true-false') answer = { kind: 'boolean', value: raw.booleanAnswer === 'true' };
    else if (raw.type === 'matching') answer = { kind: 'matching', pairs: this.matchingPairs.controls.map((row) => ({ prompt: row.controls.prompt.value.trim(), answer: row.controls.answer.value.trim() })) };
    else if (raw.type === 'short-answer') answer = { kind: 'short-answer', acceptedAnswers: this.acceptedAnswers.controls.map((row) => row.value.trim()) };
    else answer = { kind: 'essay', rubricHint: raw.rubricHint.trim() };
    const seenTags = new Set<string>();
    const tags = raw.tags.split(',').map((tag) => tag.trim()).filter((tag) => {
      const key = tag.toLocaleLowerCase();
      if (tag.length === 0 || seenTags.has(key)) return false;
      seenTags.add(key);
      return true;
    });
    const common = { courseId: asCourseId(raw.courseId.trim()), outcomeId: asLearningOutcomeId(raw.outcomeId.trim()), title: raw.title.trim(), stem: raw.stem.trim(), explanation: raw.explanation.trim(), tags, difficulty: raw.difficulty, points: Number(raw.points), grade: raw.grade, type: raw.type, options: this.isChoiceType(raw.type) ? options : [], answer };
    return this.currentQuestionSignal() === null ? { ...common, status: 'draft' } : common;
  }

  private executeSave(input: QuestionCreateInput | QuestionUpdateInput): void {
    this.isSaving.set(true); this.feedbackKind.set(null); this.feedbackMessage.set('');
    const current = this.currentQuestionSignal();
    const request$ = current === null ? this.facade.createQuestion(input as QuestionCreateInput) : this.facade.updateQuestion(current.id, input as QuestionUpdateInput, { expectedVersion: current.version });
    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (question) => { this.isSaving.set(false); this.currentQuestionSignal.set(question); this.setEditorValues(question); this.feedbackKind.set('success'); this.feedbackMessage.set('Question saved successfully.'); this.liveMessage.set('Question saved successfully.'); this.saved.emit(question); },
      error: (error: unknown) => { this.isSaving.set(false); const status: QuestionBankSaveStatus = this.facade.saveRequestState().status; this.feedbackKind.set(status === 'conflict' ? 'conflict' : status === 'unauthorized' ? 'unauthorized' : status === 'error' && !(error instanceof QuestionBankError) ? 'service' : 'error'); this.feedbackMessage.set(error instanceof Error ? error.message : this.facade.saveFeedback()); this.liveMessage.set(this.feedbackMessage()); this.focusFeedback(); }
    });
  }

  private focusFeedback(): void { queueMicrotask(() => (this.document.getElementById('question-editor-feedback') as HTMLElement | null)?.focus()); }
}
