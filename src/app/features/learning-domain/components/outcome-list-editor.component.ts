import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
  type OnInit
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
  type ValidationErrors,
  type ValidatorFn
} from '@angular/forms';
import { distinctUntilChanged, startWith } from 'rxjs';

import { RequestStateComponent } from '../../../shared/components/request-state.component';
import { LearningDomainFacade } from '../data-access/learning-domain.facade';
import { LearningDomainError } from '../data-access/learning-domain.repository';
import {
  LIFECYCLE_STATES,
  type CourseId,
  type LearningOutcome,
  type LearningOutcomeCreateInput,
  type LearningOutcomeFilter,
  type LearningOutcomeId,
  type LearningOutcomeStatus,
  type LearningOutcomeUpdateInput
} from '../models/learning-domain.models';

const asCourseId = (value: string): CourseId => value as CourseId;
const asLearningOutcomeId = (value: string): LearningOutcomeId => value as LearningOutcomeId;

const integerValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value = control.value;
  if (value === null || value === '') {
    return null;
  }
  if (!Number.isInteger(value)) {
    return { integer: true };
  }
  return value < 0 ? { minLevel: true } : null;
};

const nonBlankValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value = control.value;
  return typeof value === 'string' && value.trim().length > 0 ? null : { required: true };
};

const lifecycleStateValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value = control.value;
  return (LIFECYCLE_STATES as readonly string[]).includes(value) ? null : { unsupportedStatus: true };
};

type FeedbackKind = 'success' | 'error' | 'conflict' | null;
type EditorFieldName =
  | 'courseId'
  | 'code'
  | 'title'
  | 'description'
  | 'level'
  | 'status'
  | 'prerequisiteOutcomeIds';

type EditorFormControls = {
  courseId: FormControl<string>;
  code: FormControl<string>;
  title: FormControl<string>;
  description: FormControl<string>;
  level: FormControl<number | null>;
  status: FormControl<string>;
  prerequisiteOutcomeIds: FormControl<string[]>;
};

type EditorFormValue = {
  readonly courseId: string;
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly level: number | null;
  readonly status: string;
  readonly prerequisiteOutcomeIds: readonly string[];
};

type QueryFormControls = {
  search: FormControl<string>;
  courseId: FormControl<string>;
  status: FormControl<string>;
  minLevel: FormControl<number | null>;
};

@Component({
  selector: 'app-outcome-list-editor',
  standalone: true,
  imports: [ReactiveFormsModule, RequestStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="outcome-workspace" [attr.aria-busy]="isBusy() ? 'true' : null" aria-labelledby="outcome-list-editor-heading">
      <header class="page-heading">
        <span class="eyebrow">Program manager workspace</span>
        <h1 id="outcome-list-editor-heading">Outcomes</h1>
        <p>Manage measurable outcomes, their course context, and prerequisite relationships.</p>
      </header>

      <p class="sr-only" role="status" aria-live="polite">{{ liveMessage() }}</p>

      @if (isUnauthorized()) {
        <app-request-state
          state="unauthorized"
          title="Outcome access unavailable"
          message="You do not have permission to view or manage outcomes."
        />
      } @else if (isServiceError()) {
        <app-request-state
          state="error"
          title="Unable to load outcomes"
          [message]="serviceErrorMessage()"
          (retry)="retryLoad()"
        />
      } @else if (isSlow()) {
        <app-request-state
          state="slow"
          title="Outcome list is taking longer than expected"
          message="Courses and outcomes are still loading. You can wait or retry without losing your filters."
          (retry)="retryLoad()"
        />
      } @else if (isLoading()) {
        <app-request-state
          state="loading"
          title="Loading outcomes"
          message="Courses and outcomes are loading. Please wait."
        />
      } @else {
        @if (isConflict()) {
          <div id="outcome-feedback" tabindex="-1" class="feedback feedback--conflict" role="alert" aria-live="assertive">
            <strong>Save conflict</strong>
            <span>{{ conflictMessage() }}</span>
            <button type="button" class="button button--secondary" (click)="retryLoad()">Reload outcomes</button>
          </div>
        }

        @if (feedbackMessage() && feedbackKind() !== 'conflict') {
          <div
            id="outcome-feedback"
            tabindex="-1"
            class="feedback"
            [class.feedback--success]="feedbackKind() === 'success'"
            [class.feedback--error]="feedbackKind() === 'error'"
            role="status"
            aria-live="polite"
          >
            {{ feedbackMessage() }}
          </div>
        }

        <form class="query-panel" [formGroup]="queryForm" (submit)="$event.preventDefault()">
          <div class="query-heading">
            <div>
              <span class="eyebrow">Find and filter</span>
              <h2>Outcome list</h2>
            </div>
            <span class="result-count" aria-label="Visible outcome count">{{ visibleOutcomes().length }}</span>
          </div>
          <div class="query-grid">
            <div class="field">
              <label for="outcome-search">Search outcomes</label>
              <input
                id="outcome-search"
                type="search"
                formControlName="search"
                maxlength="120"
                autocomplete="off"
                placeholder="Search code, title, or description"
              />
            </div>
            <div class="field">
              <label for="outcome-course-filter">Course</label>
              <select id="outcome-course-filter" formControlName="courseId">
                <option value="">All courses</option>
                @for (course of courses(); track course.id) {
                  <option [value]="course.id">{{ course.code }} · {{ course.title }}</option>
                }
              </select>
            </div>
            <div class="field">
              <label for="outcome-status-filter">Status</label>
              <select id="outcome-status-filter" formControlName="status">
                <option value="">All statuses</option>
                @for (state of lifecycleStates; track state) {
                  <option [value]="state">{{ statusLabel(state) }}</option>
                }
              </select>
            </div>
            <div class="field">
              <label for="outcome-level-filter">Minimum level</label>
              <input id="outcome-level-filter" type="number" min="0" step="1" formControlName="minLevel" />
            </div>
            <button type="button" class="button button--secondary query-reset" (click)="resetQuery()">Reset filters</button>
          </div>
          <p class="query-summary" role="status" aria-live="polite">{{ querySummary() }}</p>
        </form>

        <div class="workspace-grid">
          <section class="list-panel" aria-labelledby="outcome-list-heading">
            <header class="section-heading">
              <div>
                <span class="eyebrow">Catalog</span>
                <h2 id="outcome-list-heading">Outcomes</h2>
              </div>
              <span class="section-count">{{ visibleOutcomes().length }} shown</span>
            </header>

            @if (visibleOutcomes().length === 0) {
              <app-request-state
                state="empty"
                title="No outcomes found"
                message="Adjust the search or filters, or create the first outcome for a course."
              />
            } @else {
              <ul class="outcome-list" aria-label="Outcomes">
                @for (outcome of visibleOutcomes(); track outcome.id) {
                  <li>
                    <button
                      type="button"
                      class="outcome-row"
                      [class.outcome-row--selected]="selectedOutcomeId() === outcome.id"
                      [attr.aria-pressed]="selectedOutcomeId() === outcome.id"
                      [attr.aria-label]="'Edit ' + outcome.code + ' ' + outcome.title"
                      (click)="selectOutcome(outcome)"
                    >
                      <span class="outcome-code">{{ outcome.code }}</span>
                      <span class="outcome-copy">
                        <strong>{{ outcome.title }}</strong>
                        <span>{{ courseContext(outcome.courseId) }}</span>
                      </span>
                      <span class="outcome-metadata">
                        <span>Level {{ outcome.level }}</span>
                        <span>{{ outcome.prerequisiteOutcomeIds.length }} prerequisites</span>
                        <span class="status-text">Status: {{ statusLabel(outcome.status) }}</span>
                      </span>
                    </button>
                  </li>
                }
              </ul>
            }
          </section>

          <section class="editor-panel" aria-labelledby="outcome-editor-heading">
            <header class="section-heading editor-heading">
              <div>
                <span class="eyebrow">{{ isEditing() ? 'Selected outcome' : 'New outcome' }}</span>
                <h2 id="outcome-editor-heading">{{ isEditing() ? 'Edit outcome' : 'Create outcome' }}</h2>
              </div>
              @if (isEditing()) {
                <button type="button" class="button button--secondary" (click)="startCreate()">New outcome</button>
              }
            </header>

            @if (formSubmitted() && editorForm.invalid) {
              <div class="validation-summary" role="alert" aria-live="assertive">
                <strong>Review the highlighted fields</strong>
                <ul>
                  @for (message of validationMessages(); track message) {
                    <li>{{ message }}</li>
                  }
                </ul>
              </div>
            }

            <form
              class="editor-form"
              [formGroup]="editorForm"
              [attr.aria-busy]="isSubmitting() ? 'true' : null"
              (ngSubmit)="save()"
              novalidate
            >
              <div class="form-grid">
                <div class="field field--wide">
                  <label for="outcome-course">Course <span aria-hidden="true">*</span></label>
                  <select
                    id="outcome-course"
                    formControlName="courseId"
                    [attr.aria-invalid]="ariaInvalid('courseId')"
                    [attr.aria-describedby]="descriptionId('courseId')"
                  >
                    <option value="">Select a course</option>
                    @for (course of courses(); track course.id) {
                      <option [value]="course.id">{{ course.code }} · {{ course.title }}</option>
                    }
                  </select>
                  @if (shouldShowError('courseId')) {
                    <p class="field-error" [id]="errorId('courseId')">{{ fieldError('courseId') }}</p>
                  }
                </div>

                <div class="field">
                  <label for="outcome-code">Code <span aria-hidden="true">*</span></label>
                  <input
                    id="outcome-code"
                    type="text"
                    formControlName="code"
                    maxlength="80"
                    autocomplete="off"
                    [attr.aria-invalid]="ariaInvalid('code')"
                    [attr.aria-describedby]="descriptionId('code')"
                  />
                  @if (shouldShowError('code')) {
                    <p class="field-error" [id]="errorId('code')">{{ fieldError('code') }}</p>
                  }
                </div>

                <div class="field field--wide">
                  <label for="outcome-title">Title <span aria-hidden="true">*</span></label>
                  <input
                    id="outcome-title"
                    type="text"
                    formControlName="title"
                    maxlength="160"
                    autocomplete="off"
                    [attr.aria-invalid]="ariaInvalid('title')"
                    [attr.aria-describedby]="descriptionId('title')"
                  />
                  @if (shouldShowError('title')) {
                    <p class="field-error" [id]="errorId('title')">{{ fieldError('title') }}</p>
                  }
                </div>

                <div class="field">
                  <label for="outcome-level">Level <span aria-hidden="true">*</span></label>
                  <input
                    id="outcome-level"
                    type="number"
                    min="0"
                    step="1"
                    formControlName="level"
                    [attr.aria-invalid]="ariaInvalid('level')"
                    [attr.aria-describedby]="descriptionId('level')"
                  />
                  @if (shouldShowError('level')) {
                    <p class="field-error" [id]="errorId('level')">{{ fieldError('level') }}</p>
                  }
                </div>

                <div class="field">
                  <label for="outcome-status">Status <span aria-hidden="true">*</span></label>
                  <select
                    id="outcome-status"
                    formControlName="status"
                    [attr.aria-invalid]="ariaInvalid('status')"
                    [attr.aria-describedby]="descriptionId('status')"
                  >
                    @for (state of lifecycleStates; track state) {
                      <option [value]="state">{{ statusLabel(state) }}</option>
                    }
                  </select>
                  @if (shouldShowError('status')) {
                    <p class="field-error" [id]="errorId('status')">{{ fieldError('status') }}</p>
                  }
                </div>

                <div class="field field--wide">
                  <label for="outcome-description">Description</label>
                  <textarea
                    id="outcome-description"
                    formControlName="description"
                    rows="4"
                    maxlength="800"
                    [attr.aria-invalid]="ariaInvalid('description')"
                    [attr.aria-describedby]="descriptionId('description')"
                  ></textarea>
                  @if (shouldShowError('description')) {
                    <p class="field-error" [id]="errorId('description')">{{ fieldError('description') }}</p>
                  }
                </div>

                <div class="field field--wide">
                  <label for="outcome-prerequisites">Prerequisites</label>
                  <select
                    id="outcome-prerequisites"
                    formControlName="prerequisiteOutcomeIds"
                    multiple
                    size="5"
                    [attr.aria-invalid]="ariaInvalid('prerequisiteOutcomeIds')"
                    [attr.aria-describedby]="descriptionId('prerequisiteOutcomeIds')"
                  >
                    @for (outcome of availablePrerequisites(); track outcome.id) {
                      <option [value]="outcome.id">{{ outcome.code }} · {{ outcome.title }}</option>
                    }
                  </select>
                  <p class="field-help" [id]="helpId('prerequisiteOutcomeIds')">
                    Only outcomes from the selected course are available. Hold Ctrl or Command to select multiple.
                  </p>
                  @if (shouldShowError('prerequisiteOutcomeIds')) {
                    <p class="field-error" [id]="errorId('prerequisiteOutcomeIds')">
                      {{ fieldError('prerequisiteOutcomeIds') }}
                    </p>
                  }
                </div>
              </div>

              <div class="editor-actions" aria-label="Outcome actions">
                <button type="submit" class="button button--primary" [disabled]="isSubmitting()">
                  {{ isSubmitting() ? 'Saving…' : isEditing() ? 'Save changes' : 'Create outcome' }}
                </button>
                <button
                  type="button"
                  class="button button--publish"
                  [disabled]="isSubmitting()"
                  (click)="publish()"
                >
                  Publish
                </button>
              </div>
              <p class="action-help">Publishing is explicit and requires every selected prerequisite to be published.</p>
            </form>
          </section>
        </div>
      }
    </section>
  `,
  styles: [`
    :host {
      display: block;
      min-width: 0;
    }

    .outcome-workspace {
      display: grid;
      align-content: start;
      gap: 20px;
      min-width: 0;
      padding: 4px;
    }

    .page-heading,
    .query-heading,
    .section-heading,
    .editor-form,
    .query-panel,
    .field,
    .feedback,
    .validation-summary {
      display: grid;
      min-width: 0;
    }

    .page-heading,
    .query-heading,
    .section-heading {
      gap: 5px;
    }

    h1,
    h2,
    p {
      margin: 0;
    }

    h1 {
      color: var(--ui-text);
      font-size: clamp(1.5rem, 3vw, 2rem);
      line-height: 1.2;
    }

    h2 {
      color: var(--ui-text);
      font-size: 1.1rem;
      line-height: 1.3;
    }

    .page-heading > p {
      max-width: 52rem;
      color: var(--ui-text-muted);
    }

    .eyebrow {
      color: var(--ui-text-muted);
      font-size: 11px;
      font-weight: 750;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .query-panel,
    .list-panel,
    .editor-panel {
      gap: 16px;
      min-width: 0;
      padding: 20px;
      border: 1px solid var(--ui-border);
      border-radius: var(--ui-radius-md);
      background: var(--ui-surface);
      box-shadow: var(--ui-shadow-sm);
    }

    .query-heading,
    .section-heading {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: end;
      gap: 12px;
    }

    .result-count,
    .section-count {
      display: inline-grid;
      min-height: 32px;
      padding: 4px 10px;
      place-items: center;
      border: 1px solid var(--ui-border-strong);
      border-radius: var(--ui-radius-sm);
      color: var(--ui-text);
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
    }

    .query-grid,
    .form-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }

    .field {
      align-content: start;
      gap: 6px;
    }

    .field--wide {
      grid-column: span 2;
    }

    label,
    .field-help,
    .action-help,
    .query-summary {
      color: var(--ui-text-muted);
      font-size: 12px;
      line-height: 1.4;
    }

    label {
      color: var(--ui-text);
      font-weight: 700;
    }

    input,
    select,
    textarea {
      width: 100%;
      min-width: 0;
      min-height: 44px;
      box-sizing: border-box;
      padding: 9px 11px;
      border: 1px solid var(--ui-border-strong);
      border-radius: var(--ui-radius-sm);
      background: var(--ui-surface);
      color: var(--ui-text);
      font: inherit;
    }

    textarea {
      min-height: 104px;
      resize: vertical;
    }

    select[multiple] {
      min-height: 136px;
      padding: 4px;
    }

    option {
      padding: 5px 6px;
    }

    input:focus-visible,
    select:focus-visible,
    textarea:focus-visible,
    button:focus-visible {
      outline: 3px solid var(--ui-focus);
      outline-offset: 2px;
    }

    input[aria-invalid='true'],
    select[aria-invalid='true'],
    textarea[aria-invalid='true'] {
      border-color: var(--ui-danger);
    }

    .button {
      min-height: 44px;
      padding: 8px 14px;
      border: 1px solid transparent;
      border-radius: var(--ui-radius-sm);
      cursor: pointer;
      font: inherit;
      font-weight: 700;
    }

    .button:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }

    .button--primary {
      background: var(--ui-primary);
      color: var(--ui-surface);
    }

    .button--primary:hover:not(:disabled) {
      background: var(--ui-primary-hover);
    }

    .button--secondary {
      border-color: var(--ui-border-strong);
      background: var(--ui-surface);
      color: var(--ui-text);
    }

    .button--secondary:hover:not(:disabled) {
      background: var(--ui-surface-subtle);
    }

    .button--publish {
      border-color: var(--ui-success);
      background: var(--ui-success-soft);
      color: var(--ui-text);
    }

    .button--publish:hover:not(:disabled) {
      background: var(--ui-surface-subtle);
    }

    .query-reset {
      align-self: end;
    }

    .query-summary {
      margin-top: -4px;
    }

    .workspace-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.05fr) minmax(22rem, 0.95fr);
      align-items: start;
      gap: 20px;
      min-width: 0;
    }

    .outcome-list {
      display: grid;
      gap: 8px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .outcome-row {
      display: grid;
      grid-template-columns: minmax(5.5rem, 0.25fr) minmax(0, 1fr) minmax(9rem, 0.7fr);
      align-items: center;
      width: 100%;
      min-width: 0;
      gap: 12px;
      padding: 14px;
      border: 1px solid var(--ui-border);
      border-radius: var(--ui-radius-sm);
      background: var(--ui-surface);
      color: var(--ui-text);
      cursor: pointer;
      text-align: left;
    }

    .outcome-row:hover,
    .outcome-row--selected {
      border-color: var(--ui-primary);
      background: var(--ui-primary-soft);
    }

    .outcome-code {
      overflow-wrap: anywhere;
      color: var(--ui-primary);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.03em;
    }

    .outcome-copy,
    .outcome-metadata {
      display: grid;
      min-width: 0;
      gap: 4px;
    }

    .outcome-copy strong,
    .outcome-copy span,
    .outcome-metadata span {
      overflow-wrap: anywhere;
    }

    .outcome-copy strong {
      font-size: 14px;
      line-height: 1.35;
    }

    .outcome-copy span,
    .outcome-metadata {
      color: var(--ui-text-muted);
      font-size: 12px;
      line-height: 1.35;
    }

    .status-text {
      color: var(--ui-text);
      font-weight: 700;
    }

    .editor-heading {
      align-items: center;
    }

    .editor-form {
      gap: 16px;
    }

    .editor-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    .action-help {
      margin-top: -8px;
    }

    .field-error {
      margin: 0;
      color: var(--ui-danger);
      font-size: 12px;
      font-weight: 700;
    }

    .validation-summary,
    .feedback {
      gap: 8px;
      padding: 14px 16px;
      border: 1px solid var(--ui-border-strong);
      border-radius: var(--ui-radius-sm);
      background: var(--ui-surface-subtle);
      color: var(--ui-text);
    }

    .validation-summary {
      border-color: var(--ui-danger);
    }

    .validation-summary ul {
      display: grid;
      gap: 4px;
      margin: 0;
      padding-left: 20px;
    }

    .feedback--success {
      border-color: var(--ui-success);
      background: var(--ui-success-soft);
    }

    .feedback--error,
    .feedback--conflict {
      border-color: var(--ui-danger);
      background: var(--ui-danger-soft);
    }

    .feedback--conflict {
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
    }

    .feedback--conflict span {
      overflow-wrap: anywhere;
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    @media (max-width: 1040px) {
      .workspace-grid {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 760px) {
      .query-grid,
      .form-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .field--wide {
        grid-column: span 2;
      }

      .outcome-row {
        grid-template-columns: minmax(5rem, 0.3fr) minmax(0, 1fr);
      }

      .outcome-metadata {
        grid-column: 1 / -1;
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }

    @media (max-width: 520px) {
      .outcome-workspace {
        gap: 16px;
        padding: 0;
      }

      .query-panel,
      .list-panel,
      .editor-panel {
        padding: 16px;
      }

      .query-grid,
      .form-grid {
        grid-template-columns: 1fr;
      }

      .field--wide {
        grid-column: auto;
      }

      .query-heading,
      .section-heading {
        align-items: start;
      }

      .outcome-row {
        grid-template-columns: 1fr;
        gap: 7px;
      }

      .outcome-metadata {
        grid-column: auto;
        grid-template-columns: 1fr;
      }

      .editor-actions,
      .editor-actions .button,
      .feedback--conflict .button {
        width: 100%;
      }

      .feedback--conflict {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class OutcomeListEditorComponent implements OnInit {
  readonly facade = inject(LearningDomainFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);

  readonly lifecycleStates = LIFECYCLE_STATES;
  readonly selectedOutcomeId = signal<LearningOutcomeId | null>(null);
  readonly currentCourseId = signal('');
  readonly formSubmitted = signal(false);
  readonly publishAttempted = signal(false);
  readonly isSubmitting = signal(false);
  readonly hasAttemptedLoad = signal(false);
  readonly coursesLoaded = signal(false);
  readonly outcomesLoaded = signal(false);
  readonly feedbackMessage = signal('');
  readonly feedbackKind = signal<FeedbackKind>(null);
  readonly liveMessage = signal('Loading outcomes and courses.');

  private applyingEditorValues = false;
  private loadRevision = 0;

  private readonly courseValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;
    return typeof value === 'string' && this.facade.courses().some((course) => course.id === value)
      ? null
      : { invalidCourse: true };
  };

  private readonly prerequisiteValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
    const raw = control.value;
    const selected = Array.isArray(raw) ? raw.map((value) => String(value)) : [];
    const errors: ValidationErrors = {};
    const unique = new Set(selected);
    const editingId = this.selectedOutcomeId();
    const courseId = control.parent?.get('courseId')?.value as string | undefined;
    const outcomes = new Map(this.facade.outcomes().map((outcome) => [String(outcome.id), outcome]));

    if (selected.length !== unique.size) {
      errors['duplicatePrerequisite'] = true;
    }
    if (editingId !== null && selected.includes(String(editingId))) {
      errors['selfPrerequisite'] = true;
    }
    if (selected.some((id) => !outcomes.has(id))) {
      errors['invalidPrerequisite'] = true;
    }
    if (
      courseId !== undefined &&
      courseId.length > 0 &&
      selected.some((id) => outcomes.get(id)?.courseId !== undefined && outcomes.get(id)?.courseId !== courseId)
    ) {
      errors['crossCoursePrerequisite'] = true;
    }

    const requiresPublishedPrerequisites =
      this.publishAttempted() || control.parent?.get('status')?.value === 'published';
    if (
      requiresPublishedPrerequisites &&
      selected.some((id) => outcomes.get(id) !== undefined && outcomes.get(id)?.status !== 'published')
    ) {
      errors['unpublishedPrerequisite'] = true;
    }

    return Object.keys(errors).length > 0 ? errors : null;
  };

  readonly editorForm = new FormGroup<EditorFormControls>({
    courseId: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, this.courseValidator]
    }),
    code: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, nonBlankValidator, Validators.maxLength(80)]
    }),
    title: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, nonBlankValidator, Validators.maxLength(160)]
    }),
    description: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(800)]
    }),
    level: new FormControl<number | null>(1, {
      validators: [Validators.required, integerValidator]
    }),
    status: new FormControl('draft', {
      nonNullable: true,
      validators: [Validators.required, lifecycleStateValidator]
    }),
    prerequisiteOutcomeIds: new FormControl<string[]>([], {
      nonNullable: true,
      validators: [this.prerequisiteValidator]
    })
  });

  readonly queryForm = new FormGroup<QueryFormControls>({
    search: new FormControl('', { nonNullable: true }),
    courseId: new FormControl('', { nonNullable: true }),
    status: new FormControl('', { nonNullable: true }),
    minLevel: new FormControl<number | null>(null)
  });

  private readonly courseRequest = computed(() => this.facade.coursesRequestState());
  private readonly outcomeRequest = computed(() => this.facade.outcomesRequestState());

  readonly courses = computed(() => this.facade.courses());
  readonly visibleOutcomes = computed(() => this.facade.visibleOutcomes());
  readonly selectedOutcome = computed(() => {
    const selectedId = this.selectedOutcomeId();
    return selectedId === null
      ? undefined
      : this.facade.outcomes().find((outcome) => outcome.id === selectedId);
  });
  readonly availablePrerequisites = computed(() => {
    const courseId = this.currentCourseId();
    const selectedId = this.selectedOutcomeId();
    return this.facade.outcomes()
      .filter((outcome) => outcome.courseId === courseId && outcome.id !== selectedId)
      .slice()
      .sort((left, right) => left.code.localeCompare(right.code));
  });
  readonly isEditing = computed(() => this.selectedOutcomeId() !== null);
  readonly isLoading = computed(() => {
    const coursesStatus = this.courseRequest().status;
    const outcomesStatus = this.outcomeRequest().status;
    const coursesAwaitingLoad = !this.coursesLoaded() && coursesStatus !== 'error' && coursesStatus !== 'slow' && coursesStatus !== 'unauthorized';
    const outcomesAwaitingLoad = !this.outcomesLoaded() && outcomesStatus !== 'error' && outcomesStatus !== 'slow' && outcomesStatus !== 'unauthorized';
    return !this.hasAttemptedLoad() || coursesStatus === 'loading' || outcomesStatus === 'loading' || coursesAwaitingLoad || outcomesAwaitingLoad;
  });
  readonly isUnauthorized = computed(() =>
    this.courseRequest().status === 'unauthorized' || this.outcomeRequest().status === 'unauthorized'
  );
  readonly isServiceError = computed(() => {
    const coursesFailed = this.courseRequest().status === 'error' && !this.coursesLoaded();
    const outcomesFailed = this.outcomeRequest().status === 'error' && !this.outcomesLoaded();
    return coursesFailed || outcomesFailed;
  });
  readonly isSlow = computed(() =>
    !this.isUnauthorized() && !this.isServiceError() &&
    [this.courseRequest(), this.outcomeRequest()].some((request) => request.status === 'slow')
  );
  readonly isBusy = computed(() => this.isLoading() || this.isSlow());
  readonly isConflict = computed(() =>
    this.feedbackKind() === 'conflict' || this.outcomeRequest().status === 'conflict'
  );

  ngOnInit(): void {
    this.queryForm.valueChanges
      .pipe(
        startWith(this.queryForm.getRawValue()),
        distinctUntilChanged((left, right) => JSON.stringify(left) === JSON.stringify(right)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => this.applyQueryFilter());

    this.editorForm.controls.status.valueChanges
      .pipe(
        startWith(this.editorForm.controls.status.value),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => this.refreshDomainValidators());
    this.editorForm.controls.courseId.valueChanges
      .pipe(
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((courseId) => this.handleCourseChange(courseId));

    this.loadData();
  }

  loadData(): void {
    const loadRevision = ++this.loadRevision;
    this.coursesLoaded.set(false);
    this.outcomesLoaded.set(false);
    this.hasAttemptedLoad.set(true);
    this.liveMessage.set('Loading outcomes and courses.');

    this.facade.loadCourses().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        if (loadRevision !== this.loadRevision) return;
        this.coursesLoaded.set(true);
        this.refreshDomainValidators();
        this.liveMessage.set('Courses loaded.');
      },
      error: () => {
        if (loadRevision !== this.loadRevision) return;
        this.liveMessage.set('Courses could not be loaded. Try again.');
      }
    });

    this.facade.loadOutcomes(this.outcomeFilter()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        if (loadRevision !== this.loadRevision) return;
        this.outcomesLoaded.set(true);
        this.refreshDomainValidators();
        this.liveMessage.set('Outcomes loaded.');
      },
      error: () => {
        if (loadRevision !== this.loadRevision) return;
        this.liveMessage.set('Outcomes could not be loaded. Try again.');
      }
    });
  }

  retryLoad(): void {
    this.feedbackMessage.set('');
    this.feedbackKind.set(null);
    this.loadData();
  }

  resetQuery(): void {
    this.queryForm.reset({ search: '', courseId: '', status: '', minLevel: null });
  }

  selectOutcome(outcomeOrId: LearningOutcome | LearningOutcomeId): void {
    const outcome =
      typeof outcomeOrId === 'string'
        ? this.facade.outcomes().find((candidate) => candidate.id === outcomeOrId)
        : outcomeOrId;
    if (outcome === undefined) {
      return;
    }

    this.selectedOutcomeId.set(outcome.id);
    this.setEditorValues(outcome);
    this.feedbackMessage.set('');
    this.feedbackKind.set(null);
    this.liveMessage.set(`${outcome.code} selected for editing.`);
  }

  startCreate(): void {
    this.selectedOutcomeId.set(null);
    this.setEditorValues(undefined);
    this.feedbackMessage.set('');
    this.feedbackKind.set(null);
    this.liveMessage.set('Create a new outcome.');
  }

  save(): void {
    this.formSubmitted.set(true);
    this.publishAttempted.set(false);
    this.refreshDomainValidators();
    this.editorForm.markAllAsTouched();

    if (this.editorForm.invalid || this.isSubmitting()) {
      this.liveMessage.set('Outcome cannot be saved. Review the highlighted fields.');
      this.focusFirstInvalidField();
      return;
    }

    const value = this.editorForm.getRawValue();
    const selected = this.selectedOutcome();
    if (value.status === 'published' && selected?.status !== 'published') {
      this.setActionError('Use Publish to move an outcome to the published state.');
      return;
    }
    this.writeOutcome(value, 'save');
  }

  publish(): void {
    this.formSubmitted.set(true);
    this.publishAttempted.set(true);
    this.refreshDomainValidators();
    this.editorForm.markAllAsTouched();

    if (this.editorForm.invalid || this.isSubmitting()) {
      this.liveMessage.set('Outcome cannot be published. Publish every prerequisite and fix the highlighted fields.');
      this.focusFirstInvalidField();
      return;
    }

    this.writeOutcome(this.editorForm.getRawValue(), 'publish');
  }

  statusLabel(status: string): string {
    return status.length === 0 ? 'Unknown' : `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
  }

  courseContext(courseId: CourseId): string {
    const course = this.courses().find((candidate) => candidate.id === courseId);
    return course === undefined ? 'Course unavailable' : `${course.code} · ${course.title}`;
  }

  querySummary(): string {
    const filter = this.outcomeFilter();
    const activeFilters = [filter.search, filter.courseId, filter.status, filter.minLevel].filter(
      (value) => value !== undefined && value !== ''
    ).length;
    return `${this.visibleOutcomes().length} outcome${this.visibleOutcomes().length === 1 ? '' : 's'} shown · ${activeFilters} active filter${activeFilters === 1 ? '' : 's'}`;
  }

  shouldShowError(name: EditorFieldName): boolean {
    const control = this.control(name);
    return control.invalid && (control.touched || this.formSubmitted());
  }

  fieldError(name: EditorFieldName): string {
    const errors = this.control(name).errors;
    if (errors === null) {
      return '';
    }
    if (errors['required']) {
      return `${this.fieldLabel(name)} is required.`;
    }
    if (errors['invalidCourse']) {
      return 'Select an available course.';
    }
    if (errors['maxlength']) {
      return `${this.fieldLabel(name)} is too long.`;
    }
    if (errors['minLevel']) {
      return 'Level must be 0 or greater.';
    }
    if (errors['integer']) {
      return 'Level must be a whole number.';
    }
    if (errors['unsupportedStatus']) {
      return 'Choose a supported lifecycle status.';
    }
    if (errors['selfPrerequisite']) {
      return 'An outcome cannot list itself as a prerequisite.';
    }
    if (errors['duplicatePrerequisite']) {
      return 'Remove duplicate prerequisite selections.';
    }
    if (errors['crossCoursePrerequisite']) {
      return 'Choose prerequisites from the selected course only.';
    }
    if (errors['invalidPrerequisite']) {
      return 'Select only existing outcomes as prerequisites.';
    }
    if (errors['unpublishedPrerequisite']) {
      return 'Publish every selected prerequisite before publishing this outcome.';
    }
    return 'Review this field.';
  }

  validationMessages(): readonly string[] {
    const fields: readonly EditorFieldName[] = [
      'courseId',
      'code',
      'title',
      'description',
      'level',
      'status',
      'prerequisiteOutcomeIds'
    ];
    return fields
      .filter((field) => this.control(field).invalid)
      .map((field) => this.fieldError(field));
  }

  ariaInvalid(name: EditorFieldName): string | null {
    return this.shouldShowError(name) ? 'true' : null;
  }

  descriptionId(name: EditorFieldName): string {
    const ids: string[] = [];
    if (name === 'prerequisiteOutcomeIds') {
      ids.push(this.helpId(name));
    }
    if (this.shouldShowError(name)) {
      ids.push(this.errorId(name));
    }
    return ids.join(' ');
  }

  helpId(name: EditorFieldName): string {
    return `outcome-editor-${name}-help`;
  }

  errorId(name: EditorFieldName): string {
    return `outcome-editor-${name}-error`;
  }

  conflictMessage(): string {
    if (this.feedbackMessage() && this.feedbackKind() === 'conflict') {
      return this.feedbackMessage();
    }
    const state = this.outcomeRequest();
    return this.errorMessage(state.error, 'The outcome changed elsewhere. Reload before trying again.');
  }

  serviceErrorMessage(): string {
    const state = this.outcomeRequest().status === 'error' ? this.outcomeRequest() : this.courseRequest();
    return this.errorMessage(state.error, 'The outcome service is unavailable. Try again.');
  }

  private control(name: EditorFieldName): AbstractControl {
    return this.editorForm.controls[name];
  }

  private focusFirstInvalidField(): void {
    const fields: readonly EditorFieldName[] = [
      'courseId',
      'code',
      'title',
      'description',
      'level',
      'status',
      'prerequisiteOutcomeIds'
    ];
    const firstInvalid = fields.find((field) => this.control(field).invalid);
    if (firstInvalid !== undefined) {
      this.focusElement(this.controlId(firstInvalid));
    }
  }

  private controlId(name: EditorFieldName): string {
    const ids: Readonly<Record<EditorFieldName, string>> = {
      courseId: 'outcome-course',
      code: 'outcome-code',
      title: 'outcome-title',
      description: 'outcome-description',
      level: 'outcome-level',
      status: 'outcome-status',
      prerequisiteOutcomeIds: 'outcome-prerequisites'
    };
    return ids[name];
  }

  private focusElement(id: string): void {
    queueMicrotask(() => {
      (this.document.getElementById(id) as HTMLElement | null)?.focus();
    });
  }

  private fieldLabel(name: EditorFieldName): string {
    const labels: Readonly<Record<EditorFieldName, string>> = {
      courseId: 'Course',
      code: 'Code',
      title: 'Title',
      description: 'Description',
      level: 'Level',
      status: 'Status',
      prerequisiteOutcomeIds: 'Prerequisites'
    };
    return labels[name];
  }

  private applyQueryFilter(): void {
    this.facade.setOutcomeFilter(this.outcomeFilter());
  }

  private outcomeFilter(): LearningOutcomeFilter {
    const value = this.queryForm.getRawValue();
    const filter: {
      search?: string;
      courseId?: CourseId;
      status?: LearningOutcomeStatus;
      minLevel?: number;
    } = {};
    const search = value.search.trim();
    if (search.length > 0) {
      filter.search = search;
    }
    if (value.courseId.length > 0) {
      filter.courseId = asCourseId(value.courseId);
    }
    if (value.status.length > 0) {
      filter.status = value.status as LearningOutcomeStatus;
    }
    if (value.minLevel !== null && Number.isInteger(value.minLevel) && value.minLevel >= 0) {
      filter.minLevel = value.minLevel;
    }
    return filter;
  }

  private handleCourseChange(courseId: string): void {
    this.currentCourseId.set(courseId);
    if (this.applyingEditorValues) {
      return;
    }

    const selected = this.editorForm.controls.prerequisiteOutcomeIds.value;
    const validIds = new Set(
      this.facade.outcomes()
        .filter((outcome) => outcome.courseId === courseId && outcome.id !== this.selectedOutcomeId())
        .map((outcome) => String(outcome.id))
    );
    const kept = selected.filter((id) => validIds.has(String(id)));
    if (kept.length !== selected.length) {
      this.editorForm.controls.prerequisiteOutcomeIds.setValue(kept, { emitEvent: false });
      this.liveMessage.set('Some prerequisites were cleared because they belong to another course.');
    }
    this.refreshDomainValidators();
  }

  private refreshDomainValidators(): void {
    this.editorForm.controls.courseId.updateValueAndValidity({ emitEvent: false });
    this.editorForm.controls.level.updateValueAndValidity({ emitEvent: false });
    this.editorForm.controls.status.updateValueAndValidity({ emitEvent: false });
    this.editorForm.controls.prerequisiteOutcomeIds.updateValueAndValidity({ emitEvent: false });
  }

  private setEditorValues(outcome: LearningOutcome | undefined): void {
    this.applyingEditorValues = true;
    this.editorForm.setValue(
      {
        courseId: outcome === undefined ? '' : String(outcome.courseId),
        code: outcome?.code ?? '',
        title: outcome?.title ?? '',
        description: outcome?.description ?? '',
        level: outcome?.level ?? 1,
        status: outcome?.status ?? 'draft',
        prerequisiteOutcomeIds: outcome?.prerequisiteOutcomeIds.map(String) ?? []
      },
      { emitEvent: false }
    );
    this.applyingEditorValues = false;
    this.currentCourseId.set(outcome === undefined ? '' : String(outcome.courseId));
    this.formSubmitted.set(false);
    this.publishAttempted.set(false);
    this.refreshDomainValidators();
    this.editorForm.markAsPristine();
    this.editorForm.markAsUntouched();
  }
  private writeOutcome(value: EditorFormValue, mode: 'save' | 'publish'): void {
    const input: LearningOutcomeCreateInput | LearningOutcomeUpdateInput = {
      courseId: asCourseId(value.courseId),
      code: value.code.trim(),
      title: value.title.trim(),
      description: value.description.trim(),
      level: value.level as number,
      status: (mode === 'publish' ? 'published' : value.status) as LearningOutcomeStatus,
      prerequisiteOutcomeIds: value.prerequisiteOutcomeIds.map(asLearningOutcomeId)
    };
    const selectedId = this.selectedOutcomeId();
    const request$ =
      selectedId === null
        ? this.facade.createOutcome(input as LearningOutcomeCreateInput)
        : this.facade.updateOutcome(selectedId, input as LearningOutcomeUpdateInput);

    this.isSubmitting.set(true);
    this.feedbackMessage.set('');
    this.feedbackKind.set(null);
    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (outcome) => {
        this.isSubmitting.set(false);
        this.selectedOutcomeId.set(outcome.id);
        this.setEditorValues(outcome);
        this.feedbackKind.set('success');
        this.feedbackMessage.set(mode === 'publish' ? 'Outcome published.' : 'Outcome saved.');
        this.liveMessage.set(mode === 'publish' ? 'Outcome published successfully.' : 'Outcome saved successfully.');
      },
      error: (error: unknown) => {
        this.isSubmitting.set(false);
        const conflict = this.isConflictError(error) || this.outcomeRequest().status === 'conflict';
        this.feedbackKind.set(conflict ? 'conflict' : 'error');
        const message = conflict
          ? this.errorMessage(error, 'The outcome changed elsewhere. Reload before trying again.')
          : this.errorMessage(error, 'The outcome could not be saved. Review the message and try again.');
        this.feedbackMessage.set(message);
        this.liveMessage.set(message);
        this.focusElement('outcome-feedback');
      }
    });
  }

  private setActionError(message: string): void {
    this.feedbackKind.set('error');
    this.feedbackMessage.set(message);
    this.liveMessage.set(message);
    this.focusElement('outcome-feedback');
  }
  private isConflictError(error: unknown): boolean {
    if (error instanceof LearningDomainError) {
      return error.code === 'conflict';
    }
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'conflict';
  }

  private errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
  }
}
