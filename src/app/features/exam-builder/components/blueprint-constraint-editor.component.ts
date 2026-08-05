import { CommonModule, DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  Output,
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

import {
  QUESTION_DIFFICULTIES,
  QUESTION_TYPES,
  type QuestionDifficulty,
  type QuestionType
} from '../../question-bank/models/question.models';
import type { LearningOutcomeId } from '../../adaptive-learning/models/seed-domain.models';
import {
  createExamBlueprint,
  validateExamBlueprint,
  type ExamBlueprint,
  type ExamBlueprintInput,
  type ExamBlueprintValidationIssue,
  type ExamBlueprintOutcomeBucketInput,
  type ExamBlueprintDifficultyBucketInput,
  type ExamBlueprintQuestionTypeBucketInput
} from '../models/exam-blueprint.models';

export type BlueprintOutcomeChoice = Readonly<{
  readonly id: LearningOutcomeId;
  readonly code: string;
  readonly title: string;
}>;

type DistributionName = 'outcomeBuckets' | 'difficultyBuckets' | 'questionTypeBuckets';
type DistributionKind = 'outcome' | 'difficulty' | 'questionType';
type BucketKey = string;

type BucketControls = {
  readonly rowId: FormControl<string>;
  readonly key: FormControl<BucketKey>;
  readonly targetQuestionCount: FormControl<number | null>;
  readonly targetPoints: FormControl<number | null>;
};
type BucketFormGroup = FormGroup<BucketControls>;

type BlueprintFormControls = {
  readonly targetQuestionCount: FormControl<number | null>;
  readonly targetPoints: FormControl<number | null>;
  readonly outcomeBuckets: FormArray<BucketFormGroup>;
  readonly difficultyBuckets: FormArray<BucketFormGroup>;
  readonly questionTypeBuckets: FormArray<BucketFormGroup>;
};

type FieldName = 'targetQuestionCount' | 'targetPoints' | 'key' | 'targetBucketQuestionCount' | 'targetBucketPoints';

const POINT_DECIMAL_PLACES = 6;
const POINT_DECIMAL_SCALE = 10 ** POINT_DECIMAL_PLACES;

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const nonBlankValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null =>
  typeof control.value === 'string' && control.value.trim().length > 0 ? null : { required: true };

const positiveSafeIntegerValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value = toNumber(control.value);
  return value !== null && Number.isSafeInteger(value) && value > 0 ? null : { safeInteger: true };
};

const positiveFiniteValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value = toNumber(control.value);
  return value !== null && Number.isFinite(value) && value > 0 ? null : { positive: true };
};

const canonicalKeyValidator = (kind: DistributionKind): ValidatorFn => (control: AbstractControl): ValidationErrors | null => {
  const key = typeof control.value === 'string' ? control.value.trim() : '';
  if (key.length === 0) return null;
  if (kind === 'outcome') return null;
  const values = kind === 'difficulty' ? QUESTION_DIFFICULTIES : QUESTION_TYPES;
  return (values as readonly string[]).includes(key) ? null : { canonical: true };
};

const stablePointUnits = (value: number): number | null => {
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * POINT_DECIMAL_SCALE);
};

const distributionTotalValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const parent = control.parent;
  const targetQuestionCount = toNumber(parent?.get('targetQuestionCount')?.value);
  const targetPoints = toNumber(parent?.get('targetPoints')?.value);
  const rows = control.value as readonly { readonly targetQuestionCount?: unknown; readonly targetPoints?: unknown }[];
  const errors: ValidationErrors = {};

  if (!Array.isArray(rows) || rows.length === 0) return { required: true };

  const rowCounts = rows.map((row) => toNumber(row.targetQuestionCount));
  if (
    targetQuestionCount !== null &&
    Number.isSafeInteger(targetQuestionCount) &&
    targetQuestionCount > 0 &&
    rowCounts.every((value): value is number => value !== null && Number.isSafeInteger(value) && value > 0)
  ) {
    const total = rowCounts.reduce((sum, value) => sum + value, 0);
    if (total !== targetQuestionCount) errors['questionCountTotal'] = true;
  }

  const rowPoints = rows.map((row) => toNumber(row.targetPoints));
  if (
    targetPoints !== null &&
    rowPoints.every((value): value is number => value !== null && Number.isFinite(value) && value > 0)
  ) {
    const total = rowPoints.reduce((sum, value) => sum + (stablePointUnits(value) ?? 0), 0);
    const expected = stablePointUnits(targetPoints);
    if (expected !== null && total !== expected) errors['pointsTotal'] = true;
  }

  return Object.keys(errors).length > 0 ? errors : null;
};

const duplicateKeyValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const rows = control.value as readonly { readonly key?: unknown }[];
  if (!Array.isArray(rows)) return null;
  const seen = new Set<string>();
  for (const row of rows) {
    const key = typeof row.key === 'string' ? row.key.trim() : '';
    if (key.length === 0) continue;
    if (seen.has(key)) return { duplicateKey: true };
    seen.add(key);
  }
  return null;
};

const distributionValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const totalErrors = distributionTotalValidator(control);
  const duplicateErrors = duplicateKeyValidator(control);
  const errors = { ...(totalErrors ?? {}), ...(duplicateErrors ?? {}) };
  return Object.keys(errors).length > 0 ? errors : null;
};

@Component({
  selector: 'app-blueprint-constraint-editor',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="blueprint-editor" aria-labelledby="blueprint-editor-heading">
      <header class="editor-heading">
        <div>
          <span class="eyebrow">Exam blueprint</span>
          <h2 id="blueprint-editor-heading">Define target constraints</h2>
        </div>
      </header>

      <p class="sr-only" role="status" aria-live="polite">{{ liveMessage() }}</p>

      <div
        *ngIf="formSubmitted() && (form.invalid || domainIssues().length > 0)"
        id="blueprint-editor-validation-summary"
        class="validation-summary"
        role="alert"
        aria-live="assertive"
      >
        <strong>Blueprint cannot be submitted.</strong>
        <span>Review the marked fields and distribution totals.</span>
        <ul>
          <li *ngFor="let message of validationMessages()">{{ message }}</li>
        </ul>
      </div>

      <form [formGroup]="form" class="editor-form" novalidate (ngSubmit)="submit()">
        <fieldset class="overall-targets">
          <legend>Overall target</legend>
          <div class="field-grid">
            <div class="field">
              <label for="blueprint-target-question-count">Target question count <span aria-hidden="true">*</span></label>
              <input
                id="blueprint-target-question-count"
                type="number"
                min="1"
                step="1"
                formControlName="targetQuestionCount"
                [attr.aria-invalid]="ariaInvalid('targetQuestionCount')"
                [attr.aria-describedby]="descriptionId('targetQuestionCount')"
              />
              <p *ngIf="shouldShowError(form.controls.targetQuestionCount)" id="blueprint-target-question-count-error" class="field-error">
                {{ fieldError(form.controls.targetQuestionCount, 'Target question count') }}
              </p>
            </div>
            <div class="field">
              <label for="blueprint-target-points">Target points <span aria-hidden="true">*</span></label>
              <input
                id="blueprint-target-points"
                type="number"
                min="0.000001"
                step="0.01"
                formControlName="targetPoints"
                [attr.aria-invalid]="ariaInvalid('targetPoints')"
                [attr.aria-describedby]="descriptionId('targetPoints')"
              />
              <p *ngIf="shouldShowError(form.controls.targetPoints)" id="blueprint-target-points-error" class="field-error">
                {{ fieldError(form.controls.targetPoints, 'Target points') }}
              </p>
            </div>
          </div>
        </fieldset>

        <section class="distribution" aria-labelledby="blueprint-outcomes-heading">
          <div class="distribution-heading"><div><h3 id="blueprint-outcomes-heading">Outcome distribution</h3><p>Set the target count and points for each learning outcome.</p></div><button type="button" class="secondary-button" (click)="addOutcomeBucket()">Add outcome</button></div>
          <div formArrayName="outcomeBuckets" class="bucket-list">
            <div *ngFor="let row of outcomeBuckets.controls; let index = index; trackBy: trackByRowId" [formGroupName]="index" class="bucket-row">
              <div class="field field--key"><label [attr.for]="fieldId('outcomeBuckets', row, 'key')">Outcome {{ index + 1 }} <span aria-hidden="true">*</span></label><select [id]="fieldId('outcomeBuckets', row, 'key')" formControlName="key" [attr.aria-invalid]="ariaInvalid('outcomeBuckets', index, 'key')" [attr.aria-describedby]="descriptionId('outcomeBuckets', index, 'key')"><option value="">Select an outcome</option><option *ngFor="let choice of outcomeChoices; trackBy: trackByOutcomeId" [value]="choice.id">{{ choice.code }} · {{ choice.title }}</option></select><p *ngIf="shouldShowRowError('outcomeBuckets', index, 'key')" [id]="fieldErrorId('outcomeBuckets', row, 'key')" class="field-error">{{ rowFieldError(row.controls.key, 'Outcome') }}</p></div>
              <div class="field"><label [attr.for]="fieldId('outcomeBuckets', row, 'targetQuestionCount')">Questions <span aria-hidden="true">*</span></label><input [id]="fieldId('outcomeBuckets', row, 'targetQuestionCount')" type="number" min="1" step="1" formControlName="targetQuestionCount" [attr.aria-invalid]="ariaInvalid('outcomeBuckets', index, 'targetQuestionCount')" [attr.aria-describedby]="descriptionId('outcomeBuckets', index, 'targetQuestionCount')" /><p *ngIf="shouldShowRowError('outcomeBuckets', index, 'targetQuestionCount')" [id]="fieldErrorId('outcomeBuckets', row, 'targetQuestionCount')" class="field-error">{{ rowFieldError(row.controls.targetQuestionCount, 'Questions') }}</p></div>
              <div class="field"><label [attr.for]="fieldId('outcomeBuckets', row, 'targetPoints')">Points <span aria-hidden="true">*</span></label><input [id]="fieldId('outcomeBuckets', row, 'targetPoints')" type="number" min="0.000001" step="0.01" formControlName="targetPoints" [attr.aria-invalid]="ariaInvalid('outcomeBuckets', index, 'targetPoints')" [attr.aria-describedby]="descriptionId('outcomeBuckets', index, 'targetPoints')" /><p *ngIf="shouldShowRowError('outcomeBuckets', index, 'targetPoints')" [id]="fieldErrorId('outcomeBuckets', row, 'targetPoints')" class="field-error">{{ rowFieldError(row.controls.targetPoints, 'Points') }}</p></div>
              <button type="button" class="remove-button" [disabled]="outcomeBuckets.length <= 1" (click)="removeOutcomeBucket(index)" [attr.aria-label]="'Remove outcome ' + (index + 1)">Remove</button>
            </div>
          </div>
          <p *ngIf="shouldShowDistributionError('outcomeBuckets')" id="blueprint-outcomeBuckets-error" class="group-error">{{ distributionError('outcomeBuckets') }}</p>
        </section>

        <section class="distribution" aria-labelledby="blueprint-difficulties-heading">
          <div class="distribution-heading"><div><h3 id="blueprint-difficulties-heading">Difficulty distribution</h3><p>Set the target count and points for each canonical difficulty.</p></div><button type="button" class="secondary-button" (click)="addDifficultyBucket()">Add difficulty</button></div>
          <div formArrayName="difficultyBuckets" class="bucket-list">
            <div *ngFor="let row of difficultyBuckets.controls; let index = index; trackBy: trackByRowId" [formGroupName]="index" class="bucket-row">
              <div class="field field--key"><label [attr.for]="fieldId('difficultyBuckets', row, 'key')">Difficulty {{ index + 1 }} <span aria-hidden="true">*</span></label><select [id]="fieldId('difficultyBuckets', row, 'key')" formControlName="key" [attr.aria-invalid]="ariaInvalid('difficultyBuckets', index, 'key')" [attr.aria-describedby]="descriptionId('difficultyBuckets', index, 'key')"><option *ngFor="let value of difficulties" [value]="value">{{ label(value) }}</option></select><p *ngIf="shouldShowRowError('difficultyBuckets', index, 'key')" [id]="fieldErrorId('difficultyBuckets', row, 'key')" class="field-error">{{ rowFieldError(row.controls.key, 'Difficulty') }}</p></div>
              <div class="field"><label [attr.for]="fieldId('difficultyBuckets', row, 'targetQuestionCount')">Questions <span aria-hidden="true">*</span></label><input [id]="fieldId('difficultyBuckets', row, 'targetQuestionCount')" type="number" min="1" step="1" formControlName="targetQuestionCount" [attr.aria-invalid]="ariaInvalid('difficultyBuckets', index, 'targetQuestionCount')" [attr.aria-describedby]="descriptionId('difficultyBuckets', index, 'targetQuestionCount')" /><p *ngIf="shouldShowRowError('difficultyBuckets', index, 'targetQuestionCount')" [id]="fieldErrorId('difficultyBuckets', row, 'targetQuestionCount')" class="field-error">{{ rowFieldError(row.controls.targetQuestionCount, 'Questions') }}</p></div>
              <div class="field"><label [attr.for]="fieldId('difficultyBuckets', row, 'targetPoints')">Points <span aria-hidden="true">*</span></label><input [id]="fieldId('difficultyBuckets', row, 'targetPoints')" type="number" min="0.000001" step="0.01" formControlName="targetPoints" [attr.aria-invalid]="ariaInvalid('difficultyBuckets', index, 'targetPoints')" [attr.aria-describedby]="descriptionId('difficultyBuckets', index, 'targetPoints')" /><p *ngIf="shouldShowRowError('difficultyBuckets', index, 'targetPoints')" [id]="fieldErrorId('difficultyBuckets', row, 'targetPoints')" class="field-error">{{ rowFieldError(row.controls.targetPoints, 'Points') }}</p></div>
              <button type="button" class="remove-button" [disabled]="difficultyBuckets.length <= 1" (click)="removeDifficultyBucket(index)" [attr.aria-label]="'Remove difficulty ' + (index + 1)">Remove</button>
            </div>
          </div>
          <p *ngIf="shouldShowDistributionError('difficultyBuckets')" id="blueprint-difficultyBuckets-error" class="group-error">{{ distributionError('difficultyBuckets') }}</p>
        </section>

        <section class="distribution" aria-labelledby="blueprint-types-heading">
          <div class="distribution-heading"><div><h3 id="blueprint-types-heading">Question-type distribution</h3><p>Set the target count and points for each canonical question type.</p></div><button type="button" class="secondary-button" (click)="addQuestionTypeBucket()">Add question type</button></div>
          <div formArrayName="questionTypeBuckets" class="bucket-list">
            <div *ngFor="let row of questionTypeBuckets.controls; let index = index; trackBy: trackByRowId" [formGroupName]="index" class="bucket-row">
              <div class="field field--key"><label [attr.for]="fieldId('questionTypeBuckets', row, 'key')">Question type {{ index + 1 }} <span aria-hidden="true">*</span></label><select [id]="fieldId('questionTypeBuckets', row, 'key')" formControlName="key" [attr.aria-invalid]="ariaInvalid('questionTypeBuckets', index, 'key')" [attr.aria-describedby]="descriptionId('questionTypeBuckets', index, 'key')"><option *ngFor="let value of questionTypes" [value]="value">{{ label(value) }}</option></select><p *ngIf="shouldShowRowError('questionTypeBuckets', index, 'key')" [id]="fieldErrorId('questionTypeBuckets', row, 'key')" class="field-error">{{ rowFieldError(row.controls.key, 'Question type') }}</p></div>
              <div class="field"><label [attr.for]="fieldId('questionTypeBuckets', row, 'targetQuestionCount')">Questions <span aria-hidden="true">*</span></label><input [id]="fieldId('questionTypeBuckets', row, 'targetQuestionCount')" type="number" min="1" step="1" formControlName="targetQuestionCount" [attr.aria-invalid]="ariaInvalid('questionTypeBuckets', index, 'targetQuestionCount')" [attr.aria-describedby]="descriptionId('questionTypeBuckets', index, 'targetQuestionCount')" /><p *ngIf="shouldShowRowError('questionTypeBuckets', index, 'targetQuestionCount')" [id]="fieldErrorId('questionTypeBuckets', row, 'targetQuestionCount')" class="field-error">{{ rowFieldError(row.controls.targetQuestionCount, 'Questions') }}</p></div>
              <div class="field"><label [attr.for]="fieldId('questionTypeBuckets', row, 'targetPoints')">Points <span aria-hidden="true">*</span></label><input [id]="fieldId('questionTypeBuckets', row, 'targetPoints')" type="number" min="0.000001" step="0.01" formControlName="targetPoints" [attr.aria-invalid]="ariaInvalid('questionTypeBuckets', index, 'targetPoints')" [attr.aria-describedby]="descriptionId('questionTypeBuckets', index, 'targetPoints')" /><p *ngIf="shouldShowRowError('questionTypeBuckets', index, 'targetPoints')" [id]="fieldErrorId('questionTypeBuckets', row, 'targetPoints')" class="field-error">{{ rowFieldError(row.controls.targetPoints, 'Points') }}</p></div>
              <button type="button" class="remove-button" [disabled]="questionTypeBuckets.length <= 1" (click)="removeQuestionTypeBucket(index)" [attr.aria-label]="'Remove question type ' + (index + 1)">Remove</button>
            </div>
          </div>
          <p *ngIf="shouldShowDistributionError('questionTypeBuckets')" id="blueprint-questionTypeBuckets-error" class="group-error">{{ distributionError('questionTypeBuckets') }}</p>
        </section>

        <div class="editor-actions"><button type="submit" class="primary-button">Submit blueprint</button></div>
      </form>
    </section>
  `,
  styles: [`
    :host { display:block; min-width:0; }
    .blueprint-editor { display:grid; gap:16px; padding:20px; border:1px solid var(--ui-border); border-radius:var(--ui-radius-md); background:var(--ui-surface); box-shadow:var(--ui-shadow-sm); }
    .editor-heading, .distribution-heading, .editor-actions { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
    h2, h3, p { margin:0; }
    h3 { font-size:16px; }
    .eyebrow { color:var(--ui-text-muted); font-size:11px; font-weight:750; letter-spacing:.05em; text-transform:uppercase; }
    .overall-targets, .distribution { display:grid; gap:12px; border:1px solid var(--ui-border); border-radius:var(--ui-radius-sm); padding:14px; }
    legend, label { color:var(--ui-text-muted); font-size:12px; font-weight:700; }
    .distribution-heading p { color:var(--ui-text-muted); font-size:12px; line-height:1.4; margin-top:4px; }
    .field-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
    .bucket-list { display:grid; gap:10px; }
    .bucket-row { display:grid; grid-template-columns:minmax(180px,1.4fr) minmax(110px,.7fr) minmax(110px,.7fr) auto; align-items:end; gap:10px; }
    .field { display:grid; gap:5px; min-width:0; }
    input, select { width:100%; min-width:0; min-height:40px; box-sizing:border-box; border:1px solid var(--ui-border-strong); border-radius:var(--ui-radius-sm); background:var(--ui-surface); color:var(--ui-text); padding:8px 10px; font:inherit; }
    .primary-button, .secondary-button, .remove-button { min-height:40px; border:1px solid var(--ui-border-strong); border-radius:var(--ui-radius-sm); padding:7px 12px; cursor:pointer; font-weight:700; }
    .primary-button { background:var(--ui-primary); color:var(--ui-on-primary,#fff); border-color:var(--ui-primary); }
    .secondary-button, .remove-button { background:var(--ui-surface); color:var(--ui-text); }
    button:disabled { cursor:not-allowed; opacity:.5; }
    .field-error, .group-error { color:var(--ui-danger,#a11); font-size:12px; font-weight:650; }
    .group-error { padding:8px 10px; border-left:3px solid var(--ui-danger,#a11); }
    .validation-summary { display:grid; gap:5px; padding:10px 12px; border:2px solid var(--ui-danger,#a11); border-radius:var(--ui-radius-sm); }
    .validation-summary ul { margin:0; padding-left:22px; }
    .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
    @media (max-width:760px) { .bucket-row { grid-template-columns:repeat(2,minmax(0,1fr)); } .field--key { grid-column:span 2; } .remove-button { width:100%; } }
    @media (max-width:520px) { .blueprint-editor { padding:14px; } .field-grid { grid-template-columns:1fr; } .distribution-heading { flex-direction:column; } .distribution-heading button { width:100%; } .bucket-row { grid-template-columns:1fr; } .field--key { grid-column:auto; } }
  `]
})
export class BlueprintConstraintEditorComponent implements OnInit, OnChanges {
  @Input() outcomeChoices: readonly BlueprintOutcomeChoice[] = [];
  @Input() initialBlueprint: ExamBlueprintInput | null = null;
  @Output() readonly submitted = new EventEmitter<ExamBlueprint>();

  readonly difficulties = QUESTION_DIFFICULTIES;
  readonly questionTypes = QUESTION_TYPES;
  readonly formSubmitted = signal(false);
  readonly domainIssues = signal<readonly ExamBlueprintValidationIssue[]>(Object.freeze([]));
  readonly liveMessage = signal('');

  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private rowSequence = 0;
  private initialStateApplied = false;

  readonly outcomeBuckets = new FormArray<BucketFormGroup>([], distributionValidator);
  readonly difficultyBuckets = new FormArray<BucketFormGroup>([], distributionValidator);
  readonly questionTypeBuckets = new FormArray<BucketFormGroup>([], distributionValidator);
  readonly form = new FormGroup<BlueprintFormControls>({
    targetQuestionCount: new FormControl<number | null>(null, { validators: [Validators.required, positiveSafeIntegerValidator] }),
    targetPoints: new FormControl<number | null>(null, { validators: [Validators.required, positiveFiniteValidator] }),
    outcomeBuckets: this.outcomeBuckets,
    difficultyBuckets: this.difficultyBuckets,
    questionTypeBuckets: this.questionTypeBuckets
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialBlueprint']) this.applyInitialBlueprint();
  }

  ngOnInit(): void {
    this.form.controls.targetQuestionCount.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refreshDistributionValidation());
    this.form.controls.targetPoints.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refreshDistributionValidation());
    if (!this.initialStateApplied) this.applyInitialBlueprint();
  }

  submit(): void {
    this.formSubmitted.set(true);
    this.form.markAllAsTouched();
    this.refreshDistributionValidation();
    const input = this.serializeInput();
    const issues = validateExamBlueprint(input);
    this.domainIssues.set(Object.freeze([...issues]));
    this.form.updateValueAndValidity({ emitEvent: false });

    if (this.form.invalid || issues.length > 0) {
      this.liveMessage.set('Blueprint cannot be submitted. Review the highlighted fields.');
      this.focusFirstInvalidField();
      return;
    }

    const blueprint = createExamBlueprint(input);
    if (blueprint === null) {
      this.liveMessage.set('Blueprint cannot be submitted. Review the highlighted fields.');
      this.focusFirstInvalidField();
      return;
    }

    this.liveMessage.set('Blueprint submitted successfully.');
    this.submitted.emit(blueprint);
  }

  addOutcomeBucket(): void {
    this.outcomeBuckets.push(this.createBucketRow('outcome', this.outcomeChoices[0]?.id ?? 'outcome-1', 1, 1));
    this.refreshDistributionValidation();
  }

  removeOutcomeBucket(index: number): void {
    if (this.outcomeBuckets.length > 1) this.outcomeBuckets.removeAt(index);
    this.refreshDistributionValidation();
  }

  addDifficultyBucket(): void {
    this.difficultyBuckets.push(this.createBucketRow('difficulty', QUESTION_DIFFICULTIES[0], 1, 1));
    this.refreshDistributionValidation();
  }

  removeDifficultyBucket(index: number): void {
    if (this.difficultyBuckets.length > 1) this.difficultyBuckets.removeAt(index);
    this.refreshDistributionValidation();
  }

  addQuestionTypeBucket(): void {
    this.questionTypeBuckets.push(this.createBucketRow('questionType', QUESTION_TYPES[0], 1, 1));
    this.refreshDistributionValidation();
  }

  removeQuestionTypeBucket(index: number): void {
    if (this.questionTypeBuckets.length > 1) this.questionTypeBuckets.removeAt(index);
    this.refreshDistributionValidation();
  }

  shouldShowError(control: AbstractControl): boolean {
    return control.invalid && (control.touched || this.formSubmitted());
  }

  shouldShowRowError(name: DistributionName, index: number, field: FieldName): boolean {
    const control = this.rowControl(name, index, field);
    return this.shouldShowError(control);
  }

  shouldShowDistributionError(name: DistributionName): boolean {
    const control = this.distribution(name);
    return control.invalid && (control.touched || this.formSubmitted());
  }

  ariaInvalid(name: 'targetQuestionCount' | 'targetPoints'): string | null;
  ariaInvalid(name: DistributionName, index: number, field: FieldName): string | null;
  ariaInvalid(name: 'targetQuestionCount' | 'targetPoints' | DistributionName, index?: number, field?: FieldName): string | null {
    if (name === 'targetQuestionCount' || name === 'targetPoints') return this.shouldShowError(this.form.controls[name]) ? 'true' : null;
    if (index === undefined || field === undefined) return null;
    const row = this.row(name, index);
    const control = this.rowControl(name, index, field);
    return this.shouldShowError(control) || this.shouldShowDistributionError(name) ? 'true' : null;
  }

  descriptionId(name: 'targetQuestionCount' | 'targetPoints'): string;
  descriptionId(name: DistributionName, index: number, field: FieldName): string;
  descriptionId(name: 'targetQuestionCount' | 'targetPoints' | DistributionName, index?: number, field?: FieldName): string {
    if (name === 'targetQuestionCount') return this.shouldShowError(this.form.controls.targetQuestionCount) ? 'blueprint-target-question-count-error' : '';
    if (name === 'targetPoints') return this.shouldShowError(this.form.controls.targetPoints) ? 'blueprint-target-points-error' : '';
    if (index === undefined || field === undefined) return '';
    const row = this.row(name, index);
    if (this.shouldShowError(this.rowControl(name, index, field))) return this.fieldErrorId(name, row, field);
    return this.shouldShowDistributionError(name) ? this.distributionErrorId(name) : '';
  }

  fieldError(control: AbstractControl, label: string): string {
    const errors = control.errors;
    if (errors?.['required']) return `${label} is required.`;
    if (errors?.['safeInteger']) return `${label} must be a positive whole number.`;
    if (errors?.['positive']) return `${label} must be greater than zero.`;
    if (errors?.['canonical']) return `${label} must use a canonical option.`;
    return `Review ${label.toLocaleLowerCase()}.`;
  }

  rowFieldError(control: AbstractControl, label: string): string {
    return this.fieldError(control, label);
  }

  distributionError(name: DistributionName): string {
    const errors = this.distribution(name).errors;
    const label = this.distributionLabel(name);
    if (errors?.['required']) return `${label} distribution needs at least one bucket.`;
    if (errors?.['duplicateKey']) return `${label} bucket keys must be unique.`;
    if (errors?.['questionCountTotal']) return `${label} question counts must equal the overall target.`;
    if (errors?.['pointsTotal']) return `${label} points must equal the overall target.`;
    return `Review ${label.toLocaleLowerCase()} distribution.`;
  }

  validationMessages(): readonly string[] {
    const messages = new Set<string>();
    if (this.shouldShowError(this.form.controls.targetQuestionCount)) messages.add(this.fieldError(this.form.controls.targetQuestionCount, 'Target question count'));
    if (this.shouldShowError(this.form.controls.targetPoints)) messages.add(this.fieldError(this.form.controls.targetPoints, 'Target points'));
    for (const name of ['outcomeBuckets', 'difficultyBuckets', 'questionTypeBuckets'] as const) {
      const distribution = this.distribution(name);
      if (this.shouldShowDistributionError(name)) messages.add(this.distributionError(name));
      distribution.controls.forEach((row) => {
        for (const field of ['key', 'targetQuestionCount', 'targetPoints'] as const) {
          const control = row.controls[field];
          if (this.shouldShowError(control)) messages.add(this.rowFieldError(control, field === 'key' ? this.distributionLabel(name) : field === 'targetQuestionCount' ? 'Questions' : 'Points'));
        }
      });
    }
    this.domainIssues().forEach((validationIssue) => messages.add(validationIssue.message));
    return Object.freeze([...messages]);
  }

  label(value: string): string {
    return value.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  trackByRowId(_index: number, row: BucketFormGroup): string {
    return row.controls.rowId.value;
  }

  trackByOutcomeId(_index: number, choice: BlueprintOutcomeChoice): string {
    return String(choice.id);
  }

  fieldId(name: DistributionName, row: BucketFormGroup, field: FieldName): string {
    return `blueprint-${name}-${row.controls.rowId.value}-${field}`;
  }

  fieldErrorId(name: DistributionName, row: BucketFormGroup, field: FieldName): string {
    return `${this.fieldId(name, row, field)}-error`;
  }

  distributionErrorId(name: DistributionName): string {
    return `blueprint-${name}-error`;
  }

  private applyInitialBlueprint(): void {
    const source = this.initialBlueprint;
    const normalized = source === null ? null : createExamBlueprint(source);
    const value = normalized ?? source;
    const targetQuestionCount = value?.targetQuestionCount ?? 1;
    const targetPoints = value?.targetPoints ?? 1;

    this.form.controls.targetQuestionCount.setValue(targetQuestionCount, { emitEvent: false });
    this.form.controls.targetPoints.setValue(targetPoints, { emitEvent: false });
    this.replaceBuckets(this.outcomeBuckets, 'outcome', value?.outcomeBuckets ?? []);
    this.replaceBuckets(this.difficultyBuckets, 'difficulty', value?.difficultyBuckets ?? []);
    this.replaceBuckets(this.questionTypeBuckets, 'questionType', value?.questionTypeBuckets ?? []);
    this.formSubmitted.set(false);
    this.domainIssues.set(Object.freeze([]));
    this.liveMessage.set('');
    this.form.markAsPristine();
    this.form.markAsUntouched();
    this.refreshDistributionValidation();
    this.initialStateApplied = true;
  }

  private replaceBuckets(
    array: FormArray<BucketFormGroup>,
    kind: DistributionKind,
    buckets: readonly { readonly key: string; readonly targetQuestionCount: number; readonly targetPoints: number }[]
  ): void {
    array.clear({ emitEvent: false });
    if (buckets.length === 0) {
      array.push(this.defaultBucketRow(kind), { emitEvent: false });
    } else {
      buckets.forEach((bucket) => array.push(this.createBucketRow(kind, bucket.key, bucket.targetQuestionCount, bucket.targetPoints), { emitEvent: false }));
    }
    array.markAsUntouched();
    array.updateValueAndValidity({ emitEvent: false });
  }

  private defaultBucketRow(kind: DistributionKind): BucketFormGroup {
    if (kind === 'outcome') return this.createBucketRow(kind, this.outcomeChoices[0]?.id ?? 'outcome-1', 1, 1);
    if (kind === 'difficulty') return this.createBucketRow(kind, QUESTION_DIFFICULTIES[0], 1, 1);
    return this.createBucketRow(kind, QUESTION_TYPES[0], 1, 1);
  }

  private createBucketRow(kind: DistributionKind, key: string, targetQuestionCount: number, targetPoints: number): BucketFormGroup {
    const rowId = `${kind}-${++this.rowSequence}`;
    return new FormGroup<BucketControls>({
      rowId: new FormControl(rowId, { nonNullable: true }),
      key: new FormControl(key, { nonNullable: true, validators: [nonBlankValidator, canonicalKeyValidator(kind)] }),
      targetQuestionCount: new FormControl(targetQuestionCount, { validators: [Validators.required, positiveSafeIntegerValidator] }),
      targetPoints: new FormControl(targetPoints, { validators: [Validators.required, positiveFiniteValidator] })
    });
  }

  private refreshDistributionValidation(): void {
    this.outcomeBuckets.updateValueAndValidity({ emitEvent: false });
    this.difficultyBuckets.updateValueAndValidity({ emitEvent: false });
    this.questionTypeBuckets.updateValueAndValidity({ emitEvent: false });
    this.form.updateValueAndValidity({ emitEvent: false });
  }

  private serializeInput(): ExamBlueprintInput {
    return {
      targetQuestionCount: toNumber(this.form.controls.targetQuestionCount.value) ?? Number.NaN,
      targetPoints: toNumber(this.form.controls.targetPoints.value) ?? Number.NaN,
      outcomeBuckets: this.serializeBuckets(this.outcomeBuckets) as readonly ExamBlueprintOutcomeBucketInput[],
      difficultyBuckets: this.serializeBuckets(this.difficultyBuckets) as readonly ExamBlueprintDifficultyBucketInput[],
      questionTypeBuckets: this.serializeBuckets(this.questionTypeBuckets) as readonly ExamBlueprintQuestionTypeBucketInput[]
    };
  }

  private serializeBuckets(array: FormArray<BucketFormGroup>): readonly { readonly key: string; readonly targetQuestionCount: number; readonly targetPoints: number }[] {
    return array.controls.map((row) => ({
      key: row.controls.key.value.trim(),
      targetQuestionCount: toNumber(row.controls.targetQuestionCount.value) ?? Number.NaN,
      targetPoints: toNumber(row.controls.targetPoints.value) ?? Number.NaN
    }));
  }

  private focusFirstInvalidField(): void {
    const ids: string[] = [];
    if (this.form.controls.targetQuestionCount.invalid) ids.push('blueprint-target-question-count');
    if (this.form.controls.targetPoints.invalid) ids.push('blueprint-target-points');
    for (const name of ['outcomeBuckets', 'difficultyBuckets', 'questionTypeBuckets'] as const) {
      const distribution = this.distribution(name);
      const firstInvalid = distribution.controls.findIndex((row) => row.invalid);
      if (firstInvalid >= 0) {
        const row = distribution.at(firstInvalid);
        const field = (['key', 'targetQuestionCount', 'targetPoints'] as const).find((fieldName) => row.controls[fieldName].invalid) ?? 'targetQuestionCount';
        ids.push(this.fieldId(name, row, field));
      } else if (distribution.invalid && distribution.length > 0) {
        ids.push(this.fieldId(name, distribution.at(0), 'targetQuestionCount'));
      }
    }
    const firstId = ids[0];
    if (firstId !== undefined) queueMicrotask(() => (this.document.getElementById(firstId) as HTMLElement | null)?.focus());
  }

  private distribution(name: DistributionName): FormArray<BucketFormGroup> {
    return this.form.controls[name];
  }

  private row(name: DistributionName, index: number): BucketFormGroup {
    return this.distribution(name).at(index);
  }

  private rowControl(name: DistributionName, index: number, field: FieldName): AbstractControl {
    const row = this.row(name, index);
    if (field === 'key') return row.controls.key;
    if (field === 'targetQuestionCount') return row.controls.targetQuestionCount;
    return row.controls.targetPoints;
  }

  private distributionLabel(name: DistributionName): string {
    return name === 'outcomeBuckets' ? 'Outcome' : name === 'difficultyBuckets' ? 'Difficulty' : 'Question-type';
  }
}
