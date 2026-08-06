import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  ViewChild,
  afterNextRender,
  inject,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import {
  AbstractControl,
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
  type ValidationErrors
} from '@angular/forms';
import { EMPTY, catchError, distinctUntilChanged, map } from 'rxjs';

import { RequestStateComponent } from '../../../shared/components/request-state.component';
import {
  MAX_CRITERION_COMMENT_LENGTH,
  MAX_OVERALL_FEEDBACK_LENGTH,
  type RubricCriterion,
  type RubricGrading
} from '../models/rubric.models';
import {
  selectRubricScore,
  type RubricCriterionScore,
  type RubricScoringResult
} from '../domain/rubric-scoring';
import {
  RubricGradingFacade,
  type RubricGradingRequestStatus
} from '../data-access/rubric-grading.facade';
import type { RubricGradingReadOptions } from '../data-access/rubric-grading.repository';

type CriterionFormControls = {
  readonly levelId: FormControl<string | null>;
  readonly comment: FormControl<string>;
};

type GraderFormControls = {
  readonly criteria: FormArray<FormGroup<CriterionFormControls>>;
  readonly overallFeedback: FormControl<string>;
};

const levelSelectionValidator = (criterion: RubricCriterion) =>
  (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;
    if (value === null || value === '') return null;
    return typeof value === 'string' && criterion.levels.some((level) => level.id === value)
      ? null
      : { unknownLevel: true };
  };

@Component({
  selector: 'app-rubric-grader',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RequestStateComponent],
  providers: [RubricGradingFacade],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="rubric-grader" aria-labelledby="rubric-grader-heading">
      <header class="page-heading">
        <div>
          <span class="eyebrow">Evaluator workspace</span>
          <h1 id="rubric-grader-heading">Rubric grading</h1>
          <p>Review the response, apply each criterion, and prepare clear feedback.</p>
        </div>
        <span class="read-only-note">No changes are saved in this review</span>
      </header>

      @if (facade.requestState().status === 'loading') {
        <app-request-state state="loading" title="Loading grading attempt" message="Preparing the response and rubric workspace." />
      } @else if (facade.requestState().status === 'empty') {
        <app-request-state state="empty" title="No grading attempt found" message="This route does not resolve to an available grading attempt." />
      } @else if (facade.requestState().status === 'unauthorized') {
        <app-request-state state="unauthorized" title="Grading unavailable" [message]="facade.errorMessage()" />
      } @else if (facade.requestState().status === 'error') {
        <app-request-state state="error" title="Unable to load grading" [message]="facade.errorMessage()" (retry)="retry()" />
      } @else if (facade.grading(); as grading) {
        <form class="grading-form" [formGroup]="rubricForm" (ngSubmit)="reviewRubric()" novalidate>
          <section class="response-preview" aria-labelledby="response-heading">
            <div class="section-heading">
              <div>
                <span class="eyebrow">Question {{ grading.context.questionNumber }} of {{ grading.context.questionCount }}</span>
                <h2 id="response-heading">Response preview</h2>
              </div>
              <span class="status-chip"><span aria-hidden="true">●</span> Ready for review</span>
            </div>
            <div class="preview-grid">
              <article class="question-copy">
                <span class="field-label">Question</span>
                <p>{{ grading.responsePreview.questionPrompt }}</p>
                <dl class="preview-meta">
                  <div><dt>Exam</dt><dd>{{ grading.context.examTitle }}</dd></div>
                  @if (grading.context.courseTitle) {
                    <div><dt>Course</dt><dd>{{ grading.context.courseTitle }}</dd></div>
                  }
                </dl>
              </article>
              <article class="response-copy">
                <span class="field-label">Student response</span>
                <p class="response-text">{{ grading.responsePreview.responseText }}</p>
                <dl class="preview-meta">
                  <div><dt>Word count</dt><dd>{{ grading.responsePreview.wordCount }}</dd></div>
                  <div><dt>Attachments</dt><dd>{{ grading.responsePreview.attachmentCount }}</dd></div>
                </dl>
              </article>
            </div>
          </section>

          <div class="grading-layout">
            <div class="grading-main">
              @if (reviewAttempted() && rubricForm.invalid) {
                <section #validationSummary class="validation-summary" tabindex="-1" role="alert" aria-labelledby="validation-summary-heading">
                  <h2 id="validation-summary-heading">Review the rubric before continuing</h2>
                  <ul>
                    @for (issue of validationIssues(); track issue.id) {
                      <li><a [href]="'#' + issue.id">{{ issue.message }}</a></li>
                    }
                  </ul>
                </section>
              }

              <section class="rubric-card" aria-labelledby="rubric-heading">
                <div class="section-heading">
                  <div>
                    <span class="eyebrow">Criterion matrix</span>
                    <h2 id="rubric-heading">{{ grading.rubric.title }}</h2>
                  </div>
                  <span class="weight-note">Weights total 100%</span>
                </div>
                <p class="rubric-description">{{ grading.rubric.description }}</p>

                <div class="matrix-desktop" formArrayName="criteria">
                  <table class="rubric-matrix">
                    <caption class="visually-hidden">Rubric criteria, levels, selected scores, and weighted points</caption>
                    <thead>
                      <tr>
                        <th scope="col">Criterion</th>
                        <th scope="col">Weight</th>
                        <th scope="col">Levels</th>
                        <th scope="col">Selected score</th>
                        <th scope="col">Weighted points</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (criterion of grading.rubric.criteria; track criterion.id; let index = $index) {
                        <tr [formGroupName]="index">
                          <th scope="row">
                            <span class="criterion-title">{{ criterion.title }}</span>
                            <span class="criterion-description">{{ criterion.description }}</span>
                            <label class="comment-field" [for]="'comment-table-' + criterion.id">
                              <span>Criterion comment <small>(optional)</small></span>
                              <textarea [id]="'comment-table-' + criterion.id" formControlName="comment" rows="2" [attr.maxlength]="maxCriterionCommentLength" [attr.aria-describedby]="'comment-help-' + criterion.id"></textarea>
                            </label>
                            <small [id]="'comment-help-' + criterion.id" class="field-help">{{ criterionForm(index).controls.comment.value.length }} / {{ maxCriterionCommentLength }}</small>
                          </th>
                          <td class="numeric">{{ formatWeight(criterion.weight) }}</td>
                          <td>
                            <div class="level-list" role="radiogroup" [attr.aria-labelledby]="'criterion-label-' + criterion.id">
                              <span class="visually-hidden" [id]="'criterion-label-' + criterion.id">Select a level for {{ criterion.title }}</span>
                              @for (level of criterion.levels; track level.id) {
                                <label class="level-option" [class.is-selected]="criterionForm(index).controls.levelId.value === level.id" [for]="'level-table-' + criterion.id + '-' + level.id">
                                  <input [id]="'level-table-' + criterion.id + '-' + level.id" type="radio" [name]="'level-table-' + criterion.id" [formControl]="criterionForm(index).controls.levelId" [value]="level.id" (change)="recalculate()" />
                                  <span><strong>{{ level.label }}</strong><small>{{ level.description }}</small></span>
                                  <b>{{ level.score }}</b>
                                </label>
                              }
                            </div>
                            @if (levelError(index)) {
                              <span class="field-error" [id]="'level-error-' + criterion.id">Select one level.</span>
                            }
                          </td>
                          <td class="numeric selected-score">{{ selectedScore(index) }}</td>
                          <td class="numeric awarded-points"><strong>{{ formatPoints(criterionPoints(criterion.id)) }}</strong><span> / {{ formatPoints(weightedMaximum(criterion)) }}</span></td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>

                <div class="criterion-cards" formArrayName="criteria">
                  @for (criterion of grading.rubric.criteria; track criterion.id; let index = $index) {
                    <article class="criterion-card" [formGroup]="criterionForm(index)">
                      <div class="criterion-card-heading">
                        <div><span class="eyebrow">Criterion {{ index + 1 }}</span><h3>{{ criterion.title }}</h3></div>
                        <span class="weight-badge">{{ formatWeight(criterion.weight) }}</span>
                      </div>
                      <p>{{ criterion.description }}</p>
                      <fieldset class="level-list" [attr.aria-describedby]="'card-level-help-' + criterion.id">
                        <legend>Choose a level <span class="required-mark">Required</span></legend>
                        @for (level of criterion.levels; track level.id) {
                          <label class="level-option" [class.is-selected]="criterionForm(index).controls.levelId.value === level.id" [for]="'level-card-' + criterion.id + '-' + level.id">
                            <input [id]="'level-card-' + criterion.id + '-' + level.id" type="radio" [name]="'level-card-' + criterion.id" [formControl]="criterionForm(index).controls.levelId" [value]="level.id" (change)="recalculate()" />
                            <span><strong>{{ level.label }}</strong><small>{{ level.description }}</small></span>
                            <b>{{ level.score }}</b>
                          </label>
                        }
                      </fieldset>
                      <small [id]="'card-level-help-' + criterion.id" class="field-help">{{ selectedScore(index) }} / {{ criterion.maxScore }} points selected</small>
                      @if (levelError(index)) { <span class="field-error">Select one level.</span> }
                      <label class="comment-field" [for]="'comment-card-' + criterion.id"><span>Criterion comment <small>(optional)</small></span><textarea [id]="'comment-card-' + criterion.id" formControlName="comment" rows="3" [attr.maxlength]="maxCriterionCommentLength"></textarea></label>
                      <div class="criterion-total"><span>Weighted points</span><strong>{{ formatPoints(criterionPoints(criterion.id)) }} / {{ formatPoints(weightedMaximum(criterion)) }}</strong></div>
                    </article>
                  }
                </div>
              </section>

              <section class="feedback-card" aria-labelledby="feedback-heading">
                <div class="section-heading"><div><span class="eyebrow">Feedback</span><h2 id="feedback-heading">Overall feedback</h2></div><span class="field-help">Optional</span></div>
                <label class="comment-field" for="overall-feedback"><span>Feedback for the student</span><textarea id="overall-feedback" formControlName="overallFeedback" rows="5" [attr.maxlength]="maxOverallFeedbackLength" aria-describedby="overall-feedback-help"></textarea></label>
                <small id="overall-feedback-help" class="field-help">{{ rubricForm.controls.overallFeedback.value.length }} / {{ maxOverallFeedbackLength }}</small>
                @if (rubricForm.controls.overallFeedback.hasError('maxlength') && (rubricForm.controls.overallFeedback.touched || reviewAttempted())) { <span class="field-error">Feedback must be {{ maxOverallFeedbackLength }} characters or fewer.</span> }
              </section>

              <div class="review-actions">
                <p class="live-status" aria-live="polite">{{ liveStatus() }}</p>
                <button type="submit" class="primary-button">Review rubric</button>
              </div>
            </div>

            <aside class="context-sidebar" aria-labelledby="context-heading">
              <section class="context-card">
                <div class="section-heading"><div><span class="eyebrow">Grading context</span><h2 id="context-heading">{{ grading.context.studentName }}</h2></div><span class="avatar" aria-hidden="true">{{ initials(grading.context.studentName) }}</span></div>
                <dl class="context-list">
                  <div><dt>Attempt</dt><dd>{{ grading.context.attemptId }}</dd></div>
                  <div><dt>Student</dt><dd>{{ grading.context.studentId || 'Scoped learner' }}</dd></div>
                  <div><dt>Question</dt><dd>{{ grading.responsePreview.questionId }}</dd></div>
                </dl>
              </section>
              <section class="progress-card" aria-labelledby="progress-heading">
                <div class="section-heading"><div><span class="eyebrow">Progress</span><h2 id="progress-heading">Rubric completion</h2></div><strong>{{ completedCriteria() }} / {{ grading.rubric.criteria.length }}</strong></div>
                <div class="progress-track" role="progressbar" [attr.aria-valuenow]="completedCriteria()" [attr.aria-valuemin]="0" [attr.aria-valuemax]="grading.rubric.criteria.length" aria-label="Rubric criteria completed"><span [style.width.%]="completionPercent()"></span></div>
                <p>{{ completionPercent() }}% of required criteria selected.</p>
              </section>
              <section class="total-card" aria-labelledby="total-heading">
                <span class="eyebrow">Exact total</span>
                <h2 id="total-heading" aria-live="polite">{{ formatPoints(scoringState()?.total ?? 0) }} <small>/ {{ formatPoints(grading.rubric.maximumPoints) }}</small></h2>
                <p>{{ scoringState()?.isComplete ? 'All criteria are selected.' : 'Select every criterion to complete the rubric.' }}</p>
              </section>
              <p class="context-note"><span aria-hidden="true">i</span> This screen only reviews local rubric input. It does not save, approve, or change the attempt.</p>
            </aside>
          </div>
        </form>
      }
    </main>
  `,
  styles: [`
    :host{display:block;min-width:0}.rubric-grader{display:grid;gap:20px}.page-heading,.section-heading,.criterion-card-heading,.review-actions{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.page-heading h1,.section-heading h2,.criterion-card-heading h3,.context-card h2,.progress-card h2,.total-card h2{margin:0;color:var(--ui-text)}.page-heading h1{font-size:clamp(1.5rem,2vw,1.8rem)}.page-heading p,.rubric-description,.context-note,.progress-card p,.total-card p{margin:6px 0 0;color:var(--ui-text-muted)}.eyebrow{display:block;margin-bottom:5px;color:var(--ui-text-muted);font-size:.72rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.read-only-note,.status-chip,.weight-note,.weight-badge{display:inline-flex;align-items:center;gap:6px;min-height:32px;padding:6px 10px;border:1px solid var(--ui-border);border-radius:999px;background:var(--ui-surface-subtle);color:var(--ui-text-muted);font-size:.78rem;font-weight:700}.status-chip{color:var(--ui-success)}.response-preview,.rubric-card,.feedback-card,.context-card,.progress-card,.total-card{padding:20px;border:1px solid var(--ui-border);border-radius:var(--ui-radius-md);background:var(--ui-surface);box-shadow:var(--ui-shadow-sm)}.response-preview{display:grid;gap:16px}.preview-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:20px}.question-copy,.response-copy{min-width:0}.response-copy{padding-left:20px;border-left:1px solid var(--ui-border)}.field-label,.comment-field>span{display:block;color:var(--ui-text-muted);font-size:.78rem;font-weight:800}.question-copy p,.response-text{margin:8px 0 16px;color:var(--ui-text);line-height:1.6}.response-text{white-space:pre-wrap}.preview-meta,.context-list{display:grid;gap:9px;margin:0}.preview-meta div,.context-list div{display:flex;justify-content:space-between;gap:12px}.preview-meta dt,.context-list dt{color:var(--ui-text-muted);font-size:.78rem}.preview-meta dd,.context-list dd{margin:0;color:var(--ui-text);font-size:.8rem;font-weight:700;text-align:right}.grading-layout{display:grid;grid-template-columns:minmax(0,1fr) 320px;align-items:start;gap:20px}.grading-main{display:grid;min-width:0;gap:20px}.rubric-card,.feedback-card{min-width:0}.rubric-description{font-size:.85rem}.matrix-desktop{overflow-x:auto;margin-top:16px}.rubric-matrix{width:100%;border-collapse:collapse;min-width:820px;font-size:.78rem}.rubric-matrix th,.rubric-matrix td{padding:12px 10px;border-top:1px solid var(--ui-border);vertical-align:top;text-align:left}.rubric-matrix thead th{background:var(--ui-surface-subtle);color:var(--ui-text-muted);font-size:.7rem;text-transform:uppercase;letter-spacing:.04em}.rubric-matrix tbody th{width:22%;font-weight:400}.criterion-title,.criterion-description{display:block}.criterion-title{font-weight:800;color:var(--ui-text)}.criterion-description{margin-top:5px;color:var(--ui-text-muted);line-height:1.4}.numeric{white-space:nowrap;font-variant-numeric:tabular-nums}.selected-score,.awarded-points{font-size:.9rem}.awarded-points span{color:var(--ui-text-muted);font-size:.75rem}.level-list{display:grid;gap:7px;min-width:0;border:0;padding:0;margin:0}.level-option{display:grid;grid-template-columns:20px minmax(0,1fr) auto;align-items:start;gap:7px;min-height:44px;padding:7px;border:1px solid var(--ui-border);border-radius:var(--ui-radius-sm);background:var(--ui-surface);cursor:pointer}.level-option:hover,.level-option.is-selected{border-color:var(--ui-primary);background:var(--ui-primary-soft)}.level-option input{width:18px;height:18px;margin:4px 0}.level-option span{display:grid;gap:2px}.level-option strong{color:var(--ui-text);font-size:.78rem}.level-option small{color:var(--ui-text-muted);line-height:1.35}.level-option b{font-variant-numeric:tabular-nums}.comment-field{display:grid;gap:6px;margin-top:12px}.comment-field textarea{width:100%;box-sizing:border-box;min-height:44px;resize:vertical;padding:9px;border:1px solid var(--ui-border-strong);border-radius:var(--ui-radius-sm);font:inherit;color:var(--ui-text);background:var(--ui-surface)}.comment-field textarea:focus-visible,.level-option:has(input:focus-visible){outline:3px solid color-mix(in srgb,var(--ui-focus) 35%,transparent);outline-offset:2px}.field-help{display:block;color:var(--ui-text-muted);font-size:.72rem}.field-error{display:block;margin-top:6px;color:var(--ui-danger);font-size:.75rem;font-weight:700}.criterion-cards{display:none}.validation-summary{padding:14px 16px;border:2px solid var(--ui-danger);border-radius:var(--ui-radius-md);background:var(--ui-danger-soft)}.validation-summary h2{margin:0;font-size:1rem}.validation-summary ul{margin:8px 0 0;padding-left:20px}.validation-summary a{color:var(--ui-text);font-weight:700}.context-sidebar{display:grid;gap:16px}.context-card,.progress-card,.total-card{display:grid;gap:14px}.avatar{display:grid;width:40px;height:40px;place-items:center;border-radius:50%;background:var(--ui-primary-soft);color:var(--ui-primary);font-weight:800}.progress-card .section-heading{align-items:center}.progress-track{height:10px;overflow:hidden;border-radius:999px;background:var(--ui-border)}.progress-track span{display:block;height:100%;background:var(--ui-primary);transition:width .15s ease}.progress-card p,.total-card p{font-size:.8rem}.total-card h2{font-size:2rem;font-variant-numeric:tabular-nums}.total-card h2 small{font-size:.9rem;color:var(--ui-text-muted)}.context-note{padding:12px;border-left:3px solid var(--ui-info);font-size:.78rem;line-height:1.5}.context-note span{display:inline-grid;width:20px;height:20px;place-items:center;margin-right:5px;border:1px solid var(--ui-info);border-radius:50%;color:var(--ui-info);font-weight:800}.review-actions{align-items:center}.live-status{min-height:24px;margin:0;color:var(--ui-text-muted);font-size:.8rem}.primary-button{min-height:44px;padding:9px 18px;border:1px solid var(--ui-primary);border-radius:var(--ui-radius-sm);background:var(--ui-primary);color:var(--ui-surface);font:inherit;font-weight:800;cursor:pointer}.primary-button:hover{background:var(--ui-primary-hover)}button:focus-visible,a:focus-visible{outline:3px solid var(--ui-focus);outline-offset:2px}.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(max-width:900px){.grading-layout{grid-template-columns:1fr}.context-sidebar{grid-template-columns:repeat(2,minmax(0,1fr))}.context-note{grid-column:1/-1}}@media(max-width:760px){.page-heading,.section-heading,.review-actions{flex-direction:column}.preview-grid{grid-template-columns:1fr}.response-copy{padding-left:0;border-left:0;border-top:1px solid var(--ui-border);padding-top:16px}.matrix-desktop{display:none}.criterion-cards{display:grid;gap:12px;margin-top:16px}.criterion-card{display:grid;gap:10px;padding:16px;border:1px solid var(--ui-border);border-radius:var(--ui-radius-md);background:var(--ui-surface-subtle)}.criterion-card p{margin:0;color:var(--ui-text-muted);font-size:.82rem;line-height:1.45}.criterion-card-heading{align-items:center}.criterion-card-heading h3{font-size:1rem}.criterion-total{display:flex;justify-content:space-between;gap:12px;padding-top:10px;border-top:1px solid var(--ui-border);font-size:.82rem}.context-sidebar{grid-template-columns:1fr}.context-note{grid-column:auto}.rubric-card,.feedback-card,.response-preview,.context-card,.progress-card,.total-card{padding:16px}.review-actions .primary-button{width:100%}}@media(prefers-reduced-motion:reduce){.progress-track span{transition:none}}
  `]
})
export class RubricGraderComponent {
  readonly facade = inject(RubricGradingFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly renderInjector = inject(Injector);
  readonly maxCriterionCommentLength = MAX_CRITERION_COMMENT_LENGTH;
  readonly maxOverallFeedbackLength = MAX_OVERALL_FEEDBACK_LENGTH;
  readonly rubricForm = new FormGroup<GraderFormControls>({
    criteria: new FormArray<FormGroup<CriterionFormControls>>([]),
    overallFeedback: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(MAX_OVERALL_FEEDBACK_LENGTH)] })
  });
  readonly scoringState = signal<RubricScoringResult | null>(null);
  readonly reviewAttempted = signal(false);
  readonly liveStatus = signal('');
  @ViewChild('validationSummary') private validationSummary?: ElementRef<HTMLElement>;

  constructor() {
    this.rubricForm.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.recalculate());
    this.route.paramMap.pipe(
      map((params) => params.get('attemptId') ?? ''),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((attemptId) => this.load(attemptId));
  }

  load(attemptId: string, options: RubricGradingReadOptions = {}): void {
    this.rubricForm.controls.criteria.clear();
    this.scoringState.set(null);
    this.facade.load(attemptId, options).pipe(
      catchError(() => EMPTY),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((grading) => {
      if (grading !== null) this.applyGrading(grading);
    });
  }

  retry(): void {
    this.facade.retry().pipe(
      catchError(() => EMPTY),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((grading) => {
      if (grading !== null) this.applyGrading(grading);
    });
  }

  private applyGrading(grading: RubricGrading): void {
    const criteria = this.rubricForm.controls.criteria;
    criteria.clear();
    for (const criterion of grading.rubric.criteria) {
      const selected = grading.selectedLevelIds[criterion.id] ?? null;
      const comment = grading.criterionComments[criterion.id] ?? '';
      criteria.push(new FormGroup<CriterionFormControls>({
        levelId: new FormControl<string | null>(selected, { validators: [Validators.required, levelSelectionValidator(criterion)] }),
        comment: new FormControl(comment, { nonNullable: true, validators: [Validators.maxLength(MAX_CRITERION_COMMENT_LENGTH)] })
      }));
    }
    this.rubricForm.controls.overallFeedback.setValue(grading.overallFeedback);
    this.rubricForm.markAsPristine();
    this.rubricForm.markAsUntouched();
    this.reviewAttempted.set(false);
    this.liveStatus.set('');
    this.recalculate();
  }

  recalculate(): void {
    const grading = this.facade.grading();
    if (grading === null || this.rubricForm.controls.criteria.length !== grading.rubric.criteria.length) {
      this.scoringState.set(null);
      return;
    }
    const selectedLevelIds: Record<string, string | null> = {};
    grading.rubric.criteria.forEach((criterion, index) => {
      selectedLevelIds[criterion.id] = this.criterionForm(index).controls.levelId.value;
    });
    this.scoringState.set(selectRubricScore({ rubric: grading.rubric, selectedLevelIds }));
  }

  reviewRubric(): void {
    this.reviewAttempted.set(true);
    this.rubricForm.markAllAsTouched();
    this.recalculate();
    if (this.rubricForm.invalid) {
      this.liveStatus.set('Rubric has required fields to review.');
      afterNextRender({ write: () => this.validationSummary?.nativeElement.focus() }, { injector: this.renderInjector });
      return;
    }
    this.liveStatus.set('Rubric review complete. No changes were saved.');
  }

  criterionForm(index: number): FormGroup<CriterionFormControls> {
    return this.rubricForm.controls.criteria.at(index);
  }

  levelError(index: number): boolean {
    const control = this.criterionForm(index).controls.levelId;
    return control.invalid && (control.touched || this.reviewAttempted());
  }

  selectedScore(index: number): string {
    const grading = this.facade.grading();
    const criterion = grading?.rubric.criteria[index];
    const selected = criterion?.levels.find((level) => level.id === this.criterionForm(index).controls.levelId.value);
    return selected === undefined ? '—' : `${selected.score}`;
  }

  criterionPoints(criterionId: string): number {
    return this.scoringState()?.criterionScores.find((score) => score.criterionId === criterionId)?.awardedPoints ?? 0;
  }

  weightedMaximum(criterion: RubricCriterion): number {
    const maximumPoints = this.facade.rubric()?.maximumPoints ?? 0;
    return criterion.weight * maximumPoints;
  }

  completedCriteria(): number {
    return this.scoringState()?.criterionScores.filter((score) => score.complete).length ?? 0;
  }

  completionPercent(): number {
    const total = this.facade.rubric()?.criteria.length ?? 0;
    return total === 0 ? 0 : Math.round((this.completedCriteria() / total) * 100);
  }

  validationIssues(): readonly { readonly id: string; readonly message: string }[] {
    const grading = this.facade.grading();
    if (grading === null) return [];
    const issues: { id: string; message: string }[] = [];
    grading.rubric.criteria.forEach((criterion, index) => {
      if (this.levelError(index)) issues.push({ id: `level-card-${criterion.id}-level-0`, message: `Select a level for ${criterion.title}.` });
      if (this.criterionForm(index).controls.comment.hasError('maxlength')) issues.push({ id: `comment-card-${criterion.id}`, message: `Shorten the comment for ${criterion.title}.` });
    });
    if (this.rubricForm.controls.overallFeedback.hasError('maxlength')) issues.push({ id: 'overall-feedback', message: 'Shorten the overall feedback.' });
    return issues;
  }

  formatPoints(value: number): string { return value.toFixed(2); }
  formatWeight(value: number): string { return `${(value * 100).toFixed(0)}%`; }
  initials(name: string): string { return name.split(/\s+/u).map((part) => part[0] ?? '').join('').slice(0, 2).toUpperCase(); }
  trackScore(_index: number, score: RubricCriterionScore): string { return score.criterionId; }

  requestStatus(): RubricGradingRequestStatus { return this.facade.requestState().status; }
}
