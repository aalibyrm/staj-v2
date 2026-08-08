import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, ViewChild, computed, inject, signal, type OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, type ParamMap } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { EMPTY, Subject, catchError, debounceTime, distinctUntilChanged, merge, of, switchMap, tap } from 'rxjs';

import { RequestStateComponent } from '../../../shared/components/request-state.component';
import {
  QuestionBankFacade,
  normalizeQuestionListQuery,
  QUESTION_DIFFICULTIES,
  QUESTION_GRADES,
  QUESTION_SORTS,
  QUESTION_STATUSES,
  QUESTION_TYPES
} from '../data-access/question-bank.facade';
import type {
  EditableQuestionStatus,
  Question,
  QuestionBulkFailure,
  QuestionBulkRequest,
  QuestionId,
  QuestionListQuery,
  QuestionStatus,
  QuestionType,
  QuestionVersion
} from '../models/question.models';
import { QuestionEditorComponent } from './question-editor.component';

interface QueryRequest {
  readonly query: QuestionListQuery;
  readonly selectedId: QuestionId | null;
  readonly retry?: boolean;
}
type BulkActionMode = 'add-tags' | 'replace-tags' | 'status';
type InspectorTab = 'preview' | 'metadata' | 'versions';

const FILTER_DEFAULTS = {
  search: '',
  course: '',
  grade: '',
  difficulty: '',
  status: '',
  type: '',
  sort: 'updatedAt-desc'
} as const;

@Component({
  selector: 'app-question-bank',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RequestStateComponent, QuestionEditorComponent],
  providers: [QuestionBankFacade],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="question-bank" aria-labelledby="question-bank-heading">
      <header class="page-heading">
        <div>
          <span class="eyebrow">Authorized question workspace</span>
          <h1 id="question-bank-heading">Question bank</h1>
          <p>Search and review immutable question entities in the active course scope.</p>
        </div>
        <div class="heading-actions"><span class="read-only-note" aria-label="Read only list">Read only list</span><button type="button" class="primary-button" (click)="startNewQuestion()">New question</button></div>
      </header>

      <form class="filter-bar" [formGroup]="filterForm" (submit)="$event.preventDefault()" aria-label="Question filters">
        <label class="search-field">
          <span>Search</span>
          <input formControlName="search" type="search" autocomplete="off" placeholder="Search ID, stem, outcome or tag" />
        </label>
        <label><span>Course</span><select formControlName="course"><option value="">All courses</option><option *ngFor="let course of facade.courseOptions(); trackBy: trackById" [value]="course.id">{{ course.code }} · {{ course.title }}</option></select></label>
        <label><span>Grade</span><select formControlName="grade"><option value="">All grades</option><option *ngFor="let grade of grades" [value]="grade">{{ gradeLabel(grade) }}</option></select></label>
        <label><span>Difficulty</span><select formControlName="difficulty"><option value="">All difficulties</option><option *ngFor="let difficulty of difficulties" [value]="difficulty">{{ difficultyLabel(difficulty) }}</option></select></label>
        <label><span>Status</span><select formControlName="status"><option value="">All statuses</option><option *ngFor="let status of statuses" [value]="status">{{ statusLabel(status) }}</option></select></label>
        <label><span>Type</span><select formControlName="type"><option value="">All types</option><option *ngFor="let type of types" [value]="type">{{ typeLabel(type) }}</option></select></label>
        <label><span>Sort</span><select formControlName="sort"><option *ngFor="let sort of sorts" [value]="sort">{{ sortLabel(sort) }}</option></select></label>
        <button type="button" class="secondary-button" (click)="resetFilters()">Clear filters</button>
      </form>

      <div class="status-bar" aria-label="Question status counts" role="group">
        <button type="button" class="status-chip status-chip--all" [class.status-chip--active]="activeQuery().status === ''" (click)="setStatus(null)">
          <span aria-hidden="true">●</span> All <strong>{{ statusTotal() }}</strong>
        </button>
        <button *ngFor="let status of statuses" type="button" class="status-chip" [class.status-chip--active]="activeQuery().status === status" (click)="setStatus(status)">
          <span aria-hidden="true">{{ statusIcon(status) }}</span> {{ statusLabel(status) }} <strong>{{ facade.statusCounts()[status] }}</strong>
        </button>
      </div>

      <p class="live-message" aria-live="polite">{{ liveMessage() }}</p>
      <section *ngIf="selectedQuestionCount() > 0" class="bulk-action-bar" [formGroup]="bulkActionForm" aria-labelledby="bulk-action-heading">
        <div class="bulk-action-copy">
          <span class="eyebrow" id="bulk-action-heading">Bulk actions</span>
          <strong>{{ selectedQuestionCount() }} selected</strong>
          <span>Published and archived rows may be selected, but immutable items can fail individually.</span>
        </div>
        <label for="bulk-action-mode"><span>Action</span><select id="bulk-action-mode" formControlName="mode">
          <option value="add-tags">Add tags</option>
          <option value="replace-tags">Replace tags</option>
          <option value="status">Set status</option>
        </select></label>
        <label *ngIf="bulkActionMode() !== 'status'" for="bulk-tags"><span>{{ bulkActionMode() === 'add-tags' ? 'Tags to add' : 'Replacement tags' }}</span><input id="bulk-tags" formControlName="tags" type="text" placeholder="e.g. algebra, review" autocomplete="off" /></label>
        <label *ngIf="bulkActionMode() === 'status'" for="bulk-status"><span>Status</span><select id="bulk-status" formControlName="status"><option value="draft">Draft</option><option value="review">Review</option></select></label>
        <button type="button" class="primary-button" #bulkReviewButton [disabled]="bulkSubmissionInvalid()" (click)="openBulkConfirmation()">Review bulk change</button>
      </section>
      <p *ngIf="bulkFeedback()" class="bulk-feedback" role="status" aria-live="polite">{{ bulkFeedback() }}</p>
      <ul *ngIf="bulkFailures().length > 0" class="bulk-failure-list" aria-label="Bulk action failures">
        <li *ngFor="let failure of bulkFailures(); trackBy: trackByFailureId"><span class="failure-mark" aria-hidden="true">!</span><strong>{{ failure.id }}</strong><span>{{ failure.message }}</span></li>
      </ul>
      <div *ngIf="bulkConfirmationOpen()" class="bulk-dialog-layer" (keydown.escape)="cancelBulkConfirmation()">
        <section #bulkDialog class="bulk-dialog" role="dialog" aria-modal="true" aria-labelledby="bulk-dialog-heading" tabindex="-1">
          <h2 id="bulk-dialog-heading">Confirm bulk change</h2>
          <p>{{ selectedQuestionCount() }} selected question{{ selectedQuestionCount() === 1 ? '' : 's' }} will be processed independently.</p>
          <p class="dialog-warning"><span aria-hidden="true">!</span> Published and archived questions are immutable; those rows can fail while other selected rows succeed.</p>
          <p *ngIf="bulkFeedback()" class="bulk-feedback" role="alert" aria-live="assertive">{{ bulkFeedback() }}</p>
          <div class="dialog-actions"><button type="button" class="secondary-button" [disabled]="workflowPending()" (click)="cancelBulkConfirmation()">Cancel</button><button type="button" class="primary-button" [disabled]="bulkSubmissionInvalid()" (click)="confirmBulkAction()">{{ workflowPending() ? 'Applying…' : 'Confirm and apply' }}</button></div>
        </section>
      </div>
      <app-question-editor
        *ngIf="editorOpen()"
        [question]="editingQuestion()"
        (cancel)="closeEditor()"
        (saved)="onQuestionSaved($event)"
      />

      <div class="content-grid">
        <section class="table-card" aria-labelledby="question-table-heading">
          <div class="card-heading"><div><span class="eyebrow">Scoped results</span><h2 id="question-table-heading">Questions <span *ngIf="facade.pageResult()">({{ total() }})</span></h2></div><span class="page-summary">Page {{ currentPage() }} of {{ totalPages() || 1 }}</span></div>
          <div *ngIf="facade.requestState().status === 'loading'" class="table-state"><app-request-state state="loading" title="Loading questions" message="The scoped question list is loading." /></div>
          <div *ngIf="facade.requestState().status === 'slow'" class="table-state"><app-request-state state="slow" title="Question bank response is taking longer" message="The question bank is still loading. You can wait or retry." (retry)="retryLoad()" /></div>
          <div *ngIf="facade.requestState().status === 'unauthorized'" class="table-state"><app-request-state state="unauthorized" title="Question bank unavailable" message="A valid instructor or measurement course grant is required." /></div>
          <div *ngIf="facade.requestState().status === 'error'" class="table-state"><app-request-state state="error" title="Question service unavailable" [message]="facade.errorMessage()" (retry)="retryLoad()" /></div>
          <div *ngIf="facade.requestState().status === 'empty'" class="table-state"><app-request-state state="empty" title="No matching questions" message="No authorized question matches the current filters." /></div>
          <div *ngIf="facade.requestState().status === 'success'" class="table-wrap">
            <table>
              <thead><tr><th scope="col" class="selection-column"><input type="checkbox" [checked]="allCurrentPageSelected()" [indeterminate]="someCurrentPageSelected()" (change)="toggleCurrentPageSelection($any($event.target).checked)" aria-label="Select all questions on this page" /></th><th scope="col" class="column-identity">ID</th><th scope="col" class="column-outcome">Course / outcome</th><th scope="col" class="column-type">Type</th><th scope="col" class="column-difficulty">Difficulty</th><th scope="col" class="column-status">Status</th><th scope="col" class="column-version">Version</th><th scope="col" class="column-updated">Updated</th></tr></thead>
              <tbody>
                <tr *ngFor="let question of questions(); trackBy: trackByQuestionId" [class.question-row--selected]="facade.selectedId() === question.id" [attr.aria-selected]="facade.selectedId() === question.id" (click)="selectQuestion(question.id)">
                  <td class="selection-column"><input type="checkbox" [checked]="isQuestionSelected(question.id)" (click)="$event.stopPropagation()" (change)="toggleQuestionSelection(question, $any($event.target).checked)" [attr.aria-label]="'Select question ' + question.id" /></td>
                  <td class="column-identity"><button type="button" class="row-select" [attr.aria-label]="'Preview question ' + question.id" [attr.aria-pressed]="facade.selectedId() === question.id" (click)="$event.stopPropagation(); selectQuestion(question.id)">{{ question.id }}</button><span class="row-title">{{ question.title }}</span></td>
                  <td class="column-outcome"><strong>{{ question.course.code }}</strong><span>{{ question.outcome.code }} · {{ question.outcome.title }}</span></td>
                  <td class="column-type">{{ typeLabel(question.type) }}</td>
                  <td class="column-difficulty"><span class="table-badge">{{ difficultyLabel(question.difficulty) }}</span></td>
                  <td class="column-status"><span class="table-badge status-badge"><span aria-hidden="true">{{ statusIcon(question.status) }}</span> {{ statusLabel(question.status) }}</span></td>
                  <td class="column-version numeric">v{{ question.version }}</td>
                  <td class="column-updated"><time [attr.datetime]="question.updatedAt">{{ question.updatedAt | date:'dd MMM yyyy, HH:mm' }}</time></td>
                </tr>
              </tbody>
            </table>
          </div>
          <nav *ngIf="facade.requestState().status === 'success' && totalPages() > 0" class="pagination" aria-label="Question pages">
            <button type="button" class="page-button" [disabled]="currentPage() <= 1" (click)="setPage(currentPage() - 1)" aria-label="Previous page">‹</button>
            <button *ngFor="let page of pageNumbers()" type="button" class="page-button" [class.page-button--active]="page === currentPage()" [attr.aria-current]="page === currentPage() ? 'page' : null" (click)="setPage(page)">{{ page }}</button>
            <button type="button" class="page-button" [disabled]="currentPage() >= totalPages()" (click)="setPage(currentPage() + 1)" aria-label="Next page">›</button>
          </nav>
        </section>

        <aside *ngIf="facade.requestState().status === 'success'" class="inspector" [class.inspector--open]="facade.selectedQuestion() !== null" aria-labelledby="question-inspector-heading" [attr.aria-hidden]="facade.selectedQuestion() === null ? 'true' : null">
          <div class="inspector-heading"><div><span class="eyebrow">Current entity</span><h2 id="question-inspector-heading">Inspector</h2></div><button *ngIf="facade.selectedQuestion()" type="button" class="icon-button" aria-label="Close question inspector" (click)="clearSelection()">×</button></div>
          <ng-container *ngIf="facade.selectedQuestion() as selected; else noSelection">
            <div class="inspector-id"><strong>{{ selected.id }}</strong><span class="table-badge status-badge"><span aria-hidden="true">{{ statusIcon(selected.status) }}</span> {{ statusLabel(selected.status) }}</span></div>
            <div class="inspector-tabs" role="tablist" aria-label="Question inspector sections">
              <button type="button" role="tab" class="inspector-tab" data-inspector-tab="preview" id="question-preview-tab" aria-controls="question-preview-panel" [attr.aria-selected]="inspectorTab() === 'preview'" [attr.tabindex]="inspectorTab() === 'preview' ? '0' : '-1'" [class.inspector-tab--active]="inspectorTab() === 'preview'" (click)="setInspectorTab('preview')" (keydown)="onInspectorTabKeydown($event)">Preview</button>
              <button type="button" role="tab" class="inspector-tab" data-inspector-tab="metadata" id="question-metadata-tab" aria-controls="question-metadata-panel" [attr.aria-selected]="inspectorTab() === 'metadata'" [attr.tabindex]="inspectorTab() === 'metadata' ? '0' : '-1'" [class.inspector-tab--active]="inspectorTab() === 'metadata'" (click)="setInspectorTab('metadata')" (keydown)="onInspectorTabKeydown($event)">Metadata</button>
              <button type="button" role="tab" class="inspector-tab" data-inspector-tab="versions" id="question-versions-tab" aria-controls="question-versions-panel" [attr.aria-selected]="inspectorTab() === 'versions'" [attr.tabindex]="inspectorTab() === 'versions' ? '0' : '-1'" [class.inspector-tab--active]="inspectorTab() === 'versions'" (click)="setInspectorTab('versions')" (keydown)="onInspectorTabKeydown($event)">Versions</button>
            </div>
            <section id="question-preview-panel" class="inspector-panel preview-block" role="tabpanel" aria-labelledby="question-preview-tab" tabindex="0" [hidden]="inspectorTab() !== 'preview'">
              <h3>Preview</h3>
              <p class="question-stem">{{ selected.stem }}</p>
              <ol *ngIf="selected.options.length > 0" class="answer-options"><li *ngFor="let option of selected.options; trackBy: trackByOptionId">{{ option.label }}</li></ol>
              <p class="answer-note"><strong>Answer representation:</strong> {{ answerLabel(selected) }}</p>
              <p class="explanation"><strong>Explanation:</strong> {{ selected.explanation }}</p>
            </section>
            <div class="inspector-actions">
              <button *ngIf="isEditable(selected)" type="button" class="primary-button" [disabled]="workflowPending()" (click)="startEditQuestion(selected)">Edit question</button>
              <button *ngIf="isEditable(selected)" type="button" class="primary-button" [disabled]="workflowPending()" (click)="publishQuestion(selected)">{{ workflowPending() ? 'Publishing…' : 'Publish' }}</button>
              <p *ngIf="selected.status === 'archived'" class="non-editable-note">Preview only. Archived questions cannot be edited or versioned.</p>
              <p *ngIf="workflowFeedback()" class="workflow-feedback" [class.workflow-feedback--success]="workflowFeedbackKind() === 'success'" role="alert" aria-live="assertive">{{ workflowFeedback() }}</p>
            </div>
            <section id="question-metadata-panel" class="inspector-panel metadata-block" role="tabpanel" aria-labelledby="question-metadata-tab" tabindex="0" [hidden]="inspectorTab() !== 'metadata'">
              <h3>Metadata</h3>
              <dl>
                <dt>Course</dt><dd>{{ selected.course.code }} · {{ selected.course.title }}</dd>
                <dt>Outcome</dt><dd>{{ selected.outcome.code }} · {{ selected.outcome.title }}</dd>
                <dt>Type</dt><dd>{{ typeLabel(selected.type) }}</dd>
                <dt>Difficulty</dt><dd>{{ difficultyLabel(selected.difficulty) }}</dd>
                <dt>Grade</dt><dd>{{ gradeLabel(selected.grade) }}</dd>
                <dt>Points</dt><dd>{{ selected.points }}</dd>
                <dt>Tags</dt><dd><div class="tag-list" aria-label="Question tags"><span *ngFor="let tag of selected.tags; trackBy: trackByTag" class="tag">#{{ tag }}</span></div></dd>
                <dt>Status</dt><dd>{{ statusLabel(selected.status) }}</dd>
                <dt>Version</dt><dd>v{{ selected.version }} · {{ versionStateLabel(selected) }}</dd>
                <dt>Created</dt><dd><time [attr.datetime]="selected.createdAt">{{ selected.createdAt | date:'dd MMM yyyy' }}</time></dd>
                <dt>Updated</dt><dd><time [attr.datetime]="selected.updatedAt">{{ selected.updatedAt | date:'dd MMM yyyy, HH:mm' }}</time></dd>
              </dl>
            </section>
            <section id="question-versions-panel" class="inspector-panel versions-panel" role="tabpanel" aria-labelledby="question-versions-tab" tabindex="0" [hidden]="inspectorTab() !== 'versions'">
              <h3>Versions</h3>
              <article *ngIf="showCurrentVersionEntry(selected)" class="version-entry version-entry--current" aria-label="Current question entity">
                <strong>Current {{ statusLabel(selected.status) }} entity · v{{ selected.version }}</strong>
                <span *ngIf="isEditable(selected)">Editable current successor</span>
                <span *ngIf="selected.status === 'archived'">Archived current entity · immutable</span>
                <time [attr.datetime]="selected.updatedAt">Updated {{ selected.updatedAt | date:'dd MMM yyyy, HH:mm' }}</time>
              </article>
              <section class="version-history" aria-labelledby="question-version-history-heading">
                <h4 id="question-version-history-heading">Retained published snapshots</h4>
                <ol *ngIf="versionHistory().length > 0; else noVersionHistory">
                  <li *ngFor="let version of versionHistory(); trackBy: trackByVersionId">
                    <strong>Published snapshot v{{ version.version }}</strong>
                    <time [attr.datetime]="version.publishedAt">{{ version.publishedAt | date:'dd MMM yyyy, HH:mm' }}</time>
                    <span>Immutable published snapshot</span>
                    <span>{{ version.changeNote }}</span>
                  </li>
                </ol>
                <ng-template #noVersionHistory><p>No retained publication snapshots.</p></ng-template>
              </section>
              <form *ngIf="selected.status === 'published'" class="successor-form" [formGroup]="successorForm" (ngSubmit)="createSuccessor(selected)">
                <label for="question-change-note">Change note <span aria-hidden="true">*</span></label>
                <textarea id="question-change-note" formControlName="changeNote" rows="3" [attr.aria-invalid]="successorForm.controls.changeNote.invalid && successorAttempted() ? 'true' : null"></textarea>
                <p *ngIf="successorAttempted() && successorForm.controls.changeNote.invalid" class="field-error">Enter a nonblank change note.</p>
                <button type="submit" class="primary-button" [disabled]="workflowPending()">{{ workflowPending() ? 'Creating…' : 'Create editable successor' }}</button>
              </form>
            </section>
          </ng-container>
          <ng-template #noSelection><div class="inspector-empty"><span aria-hidden="true">⌁</span><h3>Select a question</h3><p>Choose one row to preview its current content and metadata.</p></div></ng-template>
        </aside>
        <button *ngIf="facade.requestState().status === 'success' && facade.selectedQuestion()" type="button" class="inspector-backdrop" aria-label="Close question inspector" (click)="clearSelection()"></button>
      </div>
    </section>
  `,
  styles: [`
    :host { display:block; min-height:100%; }
    .question-bank { display:grid; gap:18px; padding:4px; }
    .page-heading, .card-heading, .inspector-heading, .inspector-id { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
    .page-heading { align-items:end; }
    .page-heading h1, .card-heading h2, .inspector-heading h2, h3, p { margin:0; }
    .eyebrow, .page-heading p, .inspector-empty, dt, td > span, .tag { color:var(--ui-text-muted); }
    .eyebrow { font-size:11px; font-weight:750; letter-spacing:.05em; text-transform:uppercase; }
    .page-heading p { margin-top:4px; }
    .read-only-note, .status-chip, .page-summary, .live-message, .answer-note, .explanation, .bulk-action-copy, .bulk-feedback, .bulk-failure-list, .dialog-warning, .version-entry span, .version-history li span { color:var(--ui-text-muted); font-size:12px; }
    .read-only-note { border:1px solid var(--ui-border-strong); border-radius:999px; padding:5px 10px; font-weight:700; }
    .filter-bar, .table-card, .inspector, .bulk-action-bar { border:1px solid var(--ui-border); border-radius:var(--ui-radius-md); }
    .filter-bar { display:grid; grid-template-columns:minmax(220px,1.6fr) repeat(6,minmax(112px,1fr)) auto; gap:10px; align-items:end; padding:14px; background:var(--ui-surface); }
    label { display:grid; gap:4px; min-width:0; color:var(--ui-text-muted); font-size:11px; font-weight:700; }
    input, select, .secondary-button, .page-button, .icon-button { border:1px solid var(--ui-border-strong); border-radius:var(--ui-radius-sm); background:var(--ui-surface); color:var(--ui-text); }
    input, select { width:100%; min-height:40px; padding:7px 10px; font-size:13px; }
    .secondary-button, .page-button, .icon-button { min-height:40px; cursor:pointer; font-weight:700; padding:7px 12px; }
    .secondary-button:hover, .page-button:hover, .icon-button:hover { border-color:var(--ui-primary); color:var(--ui-primary); }
    button:disabled { cursor:not-allowed; opacity:.45; }
    .status-bar { display:flex; flex-wrap:wrap; gap:8px; }
    .status-chip { min-height:30px; border:1px solid var(--ui-border); border-radius:999px; background:var(--ui-surface); padding:4px 11px; cursor:pointer; }
    .status-chip strong { margin-left:4px; color:var(--ui-text); font-variant-numeric:tabular-nums; }
    .status-chip--active { border-color:var(--ui-primary); background:var(--ui-primary-soft); color:var(--ui-primary); }
    .status-chip--active strong { color:var(--ui-primary); }
    .live-message { min-height:18px; }
    .content-grid { display:grid; grid-template-columns:minmax(0,1fr) 360px; gap:16px; align-items:start; }
    .table-card, .inspector { min-width:0; background:var(--ui-surface); }
    .card-heading, .inspector-heading { padding:16px 18px; }
    .card-heading, .inspector-heading, .inspector-id, .preview-block, .inspector-actions, th, td { border-bottom:1px solid var(--ui-border); }
    .table-wrap { overflow:auto; }
    table { width:100%; border-collapse:collapse; font-size:12px; }
    th { background:var(--ui-surface-subtle); color:var(--ui-text-muted); font-size:11px; text-align:left; text-transform:uppercase; }
    th, td { padding:11px 12px; vertical-align:middle; }
    tbody tr { cursor:pointer; }
    tbody tr:hover, .question-row--selected { background:var(--ui-primary-soft); }
    tbody tr:last-child td { border-bottom:0; }
    td > span, td > strong { display:block; }
    td > span { margin-top:3px; }
    .row-select { border:0; background:transparent; color:var(--ui-primary); cursor:pointer; padding:0; font-size:12px; font-weight:750; text-align:left; }
    .row-title { max-width:190px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .table-badge { display:inline-flex; align-items:center; gap:4px; border:1px solid var(--ui-border-strong); border-radius:999px; padding:3px 7px; color:var(--ui-text); font-size:11px; white-space:nowrap; }
    .numeric { font-variant-numeric:tabular-nums; }
    time { white-space:nowrap; }
    .table-state { padding:16px; }
    .pagination { display:flex; justify-content:flex-end; gap:6px; padding:12px 16px; border-top:1px solid var(--ui-border); }
    .page-button { min-width:38px; padding:5px 8px; }
    .page-button--active { border-color:var(--ui-primary); background:var(--ui-primary-soft); color:var(--ui-primary); }
    .icon-button { min-width:40px; font-size:20px; line-height:1; }
    .inspector { position:sticky; top:16px; min-height:360px; overflow:hidden; }
    .inspector-id, .preview-block, .metadata-block, .versions-panel, .inspector-empty { padding:16px 18px; }
    .inspector-id { align-items:center; }
    .inspector-tabs { display:grid; grid-template-columns:repeat(3,1fr); border-bottom:1px solid var(--ui-border); }
    .inspector-tab { min-height:42px; border:0; border-bottom:2px solid transparent; background:var(--ui-surface); color:var(--ui-text-muted); cursor:pointer; font-size:12px; font-weight:750; padding:8px 10px; }
    .inspector-tab:hover, .inspector-tab:focus-visible { color:var(--ui-primary); }
    .inspector-tab--active { border-bottom-color:var(--ui-primary); color:var(--ui-primary); }
    .inspector-panel[hidden] { display:none; }
    .preview-block { display:grid; gap:10px; }
    .question-stem { line-height:1.55; }
    .answer-options { display:grid; gap:6px; margin:0; padding-left:24px; color:var(--ui-text-muted); }
    .inspector-actions { display:flex; flex-wrap:wrap; gap:8px; padding:16px 18px; }
    .inspector-actions p { flex-basis:100%; }
    .metadata-block, .versions-panel { display:grid; gap:12px; }
    dl { display:grid; grid-template-columns:92px minmax(0,1fr); gap:7px 10px; margin:0; font-size:12px; }
    dt { font-weight:700; }
    dd { margin:0; overflow-wrap:anywhere; }
    .tag-list { display:flex; flex-wrap:wrap; gap:6px; }
    .tag { border:1px solid var(--ui-border); border-radius:999px; background:var(--ui-surface-subtle); padding:4px 7px; font-size:11px; }
    .version-entry, .version-history { display:grid; gap:7px; }
    .version-entry, .version-history li, .bulk-failure-list li { border:1px solid var(--ui-border); border-radius:var(--ui-radius-sm); }
    .version-entry { padding:10px 12px; background:var(--ui-surface-subtle); font-size:12px; }
    .version-history ol { display:grid; gap:8px; margin:0; padding-left:22px; }
    .version-history li { display:grid; gap:3px; padding:8px 10px; }
    .inspector-empty { display:grid; justify-items:start; gap:8px; }
    .inspector-backdrop { display:none; }
    .bulk-action-bar { display:flex; flex-wrap:wrap; align-items:end; gap:10px; padding:12px 14px; background:var(--ui-surface-subtle); }
    .bulk-action-copy { display:grid; gap:3px; min-width:220px; flex:1 1 260px; }
    .bulk-failure-list { display:grid; gap:6px; margin:0; padding:0; list-style:none; }
    .bulk-failure-list li { display:flex; align-items:flex-start; gap:7px; padding:7px 9px; }
    .failure-mark, .dialog-warning > span { color:var(--ui-text); font-weight:800; }
    .bulk-dialog-layer { position:fixed; inset:0; z-index:20; display:grid; place-items:center; padding:20px; background:rgba(15,23,42,.35); }
    .bulk-dialog { display:grid; gap:12px; width:min(480px,100%); padding:20px; border:1px solid var(--ui-border-strong); border-radius:var(--ui-radius-md); background:var(--ui-surface); }
    .dialog-warning { display:flex; gap:8px; line-height:1.5; }
    .dialog-actions { display:flex; justify-content:flex-end; gap:8px; }
    .selection-column { width:38px; text-align:center; }
    @media (max-width:1100px) { .filter-bar { grid-template-columns:repeat(3,minmax(130px,1fr)); } .search-field { grid-column:span 3; } .secondary-button { justify-self:start; } }
    @media (max-width:900px) {
      .question-bank { max-width:100%; overflow-x:clip; }
      .content-grid { grid-template-columns:minmax(0,1fr); min-width:0; }
      .table-card { width:100%; overflow:hidden; }
      .table-wrap { max-width:100%; max-height:calc(100dvh - 220px); overflow:auto; }
      table { table-layout:fixed; }
      .column-type, .column-difficulty, .column-version, .column-updated { display:none; }
      .column-identity { width:38%; }
      .column-outcome { width:42%; }
      .column-status { width:100px; }
      .inspector { display:none; position:fixed; z-index:31; inset:16px 12px 16px auto; width:min(400px,calc(100vw - 24px)); max-height:calc(100dvh - 32px); overflow:auto; border-radius:var(--ui-radius-md); }
      .inspector.inspector--open { display:flex; flex-direction:column; }
      .inspector-backdrop { display:block; position:fixed; inset:0; z-index:30; border:0; background:rgba(15,23,42,.35); cursor:pointer; }
    }
    @media (max-width:700px) { .question-bank { padding:0; gap:14px; } .page-heading { align-items:start; flex-direction:column; } .filter-bar { grid-template-columns:repeat(2,minmax(0,1fr)); } .search-field { grid-column:span 2; } .pagination { justify-content:center; } }
  `]
})
export class QuestionBankComponent implements OnInit {
  readonly facade = inject(QuestionBankFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  @ViewChild('bulkDialog') private bulkDialog?: ElementRef<HTMLElement>;
  @ViewChild('bulkReviewButton') private bulkReviewButton?: ElementRef<HTMLButtonElement>;
  private readonly bulkSelectedIdsSignal = signal<ReadonlySet<QuestionId>>(new Set<QuestionId>());
  private readonly bulkExpectedVersionsSignal = signal<ReadonlyMap<QuestionId, number>>(new Map<QuestionId, number>());
  readonly bulkSelectedIds = this.bulkSelectedIdsSignal.asReadonly();
  readonly bulkConfirmationOpen = signal(false);
  readonly bulkFeedback = signal('');
  readonly bulkFailures = signal<readonly QuestionBulkFailure[]>([]);
  readonly bulkActionMode = computed(() => this.bulkActionForm.controls.mode.value as BulkActionMode);
  readonly selectedQuestionCount = computed(() => this.bulkSelectedIdsSignal().size);
  readonly allCurrentPageSelected = computed(() => {
    const questions = this.questions();
    return questions.length > 0 && questions.every((question) => this.bulkSelectedIdsSignal().has(question.id));
  });
  readonly someCurrentPageSelected = computed(() => {
    const selected = this.bulkSelectedIdsSignal();
    return this.questions().some((question) => selected.has(question.id)) && !this.allCurrentPageSelected();
  });
  private readonly queryRequests = new Subject<QueryRequest>();
  private readonly retryRequests = new Subject<QueryRequest>();
  private readonly selectionRequests = new Subject<QuestionId | null>();
  private lastQueryKey = '';
  private lastSelectedKey = '';
  private readonly activeQuerySignal = signal(normalizeQuestionListQuery(FILTER_DEFAULTS));
  private readonly selectedRouteIdSignal = signal<QuestionId | null>(null);
  readonly inspectorTab = signal<InspectorTab>('preview');
  readonly editorOpen = signal(false);
  readonly editingQuestionId = signal<QuestionId | null>(null);
  readonly editingQuestion = computed(() => {
    const id = this.editingQuestionId();
    return id === null ? null : this.questions().find((question) => question.id === id) ?? this.facade.selectedQuestion();
  });
  readonly activeQuery = this.activeQuerySignal.asReadonly();
  readonly selectedRouteId = this.selectedRouteIdSignal.asReadonly();
  readonly questions = computed(() => this.facade.pageResult()?.items ?? []);
  readonly total = computed(() => this.facade.pageResult()?.total ?? 0);
  readonly statusTotal = computed(() =>
    (Object.values(this.facade.statusCounts()) as readonly number[]).reduce((sum: number, count: number) => sum + count, 0)
  );
  readonly currentPage = computed(() => this.facade.pageResult()?.page ?? 1);
  readonly totalPages = computed(() => this.facade.pageResult()?.totalPages ?? 0);
  readonly pageNumbers = computed(() => Array.from({ length: Math.min(this.totalPages(), 7) }, (_, index) => index + 1));
  readonly liveMessage = signal('');
  readonly workflowFeedback = signal('');
  readonly workflowFeedbackKind = signal<'success' | 'error' | 'conflict' | 'unauthorized'>('success');
  readonly workflowPending = signal(false);
  readonly successorAttempted = signal(false);
  readonly versionHistory = computed<readonly QuestionVersion[]>(() => this.facade.versionHistory());
  readonly statuses = QUESTION_STATUSES;
  readonly types = QUESTION_TYPES;
  readonly difficulties = QUESTION_DIFFICULTIES;
  readonly grades = QUESTION_GRADES;
  readonly sorts = QUESTION_SORTS;
  readonly filterForm = new FormGroup({
    search: new FormControl('', { nonNullable: true }),
    course: new FormControl('', { nonNullable: true }),
    grade: new FormControl('', { nonNullable: true }),
    difficulty: new FormControl('', { nonNullable: true }),
    status: new FormControl('', { nonNullable: true }),
    type: new FormControl('', { nonNullable: true }),
    sort: new FormControl('updatedAt-desc', { nonNullable: true })
  });
  readonly bulkActionForm = new FormGroup({
    mode: new FormControl<BulkActionMode>('add-tags', { nonNullable: true }),
    tags: new FormControl('', { nonNullable: true }),
    status: new FormControl<EditableQuestionStatus>('review', { nonNullable: true })
  });
  readonly successorForm = new FormGroup({
    changeNote: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/\S/)]
    })
  });

  ngOnInit(): void {
    merge(this.queryRequests, this.retryRequests).pipe(
      distinctUntilChanged((left, right) =>
        right.retry !== true &&
        this.queryKey(left.query) === this.queryKey(right.query) &&
        left.selectedId === right.selectedId
      ),
      tap(({ query }) => this.activeQuerySignal.set(query)),
      switchMap(({ query, selectedId, retry }) => {
        const request$ = retry === true
          ? this.facade.retry()
          : this.facade.loadQuestions(query);
        return request$.pipe(
          tap((response) => {
            this.activeQuerySignal.set(response.query);
            this.filterForm.patchValue({ sort: response.query.sort }, { emitEvent: false });
            if (response.query.page !== query.page) this.syncUrl(response.query, selectedId);
            this.liveMessage.set(`${response.total} authorized questions loaded.`);
          }),
          switchMap(() => selectedId === null ? of(null) : this.facade.selectQuestion(selectedId)),
          catchError(() => EMPTY)
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((selected) => {
      if (selected === null && this.selectedRouteIdSignal() !== null) {
        this.selectedRouteIdSignal.set(null);
        this.liveMessage.set(this.facade.selectionNotice() || 'Selection cleared because the question is missing or stale.');
        this.syncUrl(this.activeQuerySignal(), null);
      } else if (selected !== null) {
        this.inspectorTab.set('preview');
        this.loadVersionHistory(selected.id);
      }
    });
    this.selectionRequests.pipe(
      switchMap((id) => id === null ? of(null) : this.facade.selectQuestion(id)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((selected) => {
      if (selected === null && this.selectedRouteIdSignal() !== null) {
        this.selectedRouteIdSignal.set(null);
        this.liveMessage.set(this.facade.selectionNotice() || 'Selection cleared because the question is missing or stale.');
        this.syncUrl(this.activeQuerySignal(), null);
      } else if (selected !== null) {
        this.inspectorTab.set('preview');
        this.liveMessage.set(`Previewing ${selected.id}.`);
        this.loadVersionHistory(selected.id);
      }
    });
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => this.applyQueryParams(params));
    this.filterForm.valueChanges.pipe(debounceTime(120), takeUntilDestroyed(this.destroyRef)).subscribe((value) => {
      const query = normalizeQuestionListQuery({ ...value, page: 1 });
      this.selectedRouteIdSignal.set(null);
      this.queryRequests.next({ query, selectedId: null });
      this.syncUrl(query, null);
    });
    this.facade.loadCourseOptions().pipe(catchError(() => EMPTY), takeUntilDestroyed(this.destroyRef)).subscribe();
  }

  retryLoad(): void {
    this.retryRequests.next({
      query: this.activeQuerySignal(),
      selectedId: this.selectedRouteIdSignal(),
      retry: true
    });
  }

  resetFilters(): void { this.filterForm.reset(FILTER_DEFAULTS); }

  setStatus(status: QuestionStatus | null): void { this.filterForm.patchValue({ status: status ?? '' }); }

  isQuestionSelected(id: QuestionId): boolean {
    return this.bulkSelectedIdsSignal().has(id);
  }

  toggleQuestionSelection(question: Question, selected: boolean): void {
    const ids = new Set(this.bulkSelectedIdsSignal());
    const versions = new Map(this.bulkExpectedVersionsSignal());
    if (selected) {
      ids.add(question.id);
      versions.set(question.id, question.version);
    } else {
      ids.delete(question.id);
      versions.delete(question.id);
    }
    this.bulkSelectedIdsSignal.set(ids);
    this.bulkExpectedVersionsSignal.set(versions);
  }

  toggleCurrentPageSelection(selected: boolean): void {
    const ids = new Set(this.bulkSelectedIdsSignal());
    const versions = new Map(this.bulkExpectedVersionsSignal());
    for (const question of this.questions()) {
      if (selected) {
        ids.add(question.id);
        versions.set(question.id, question.version);
      } else {
        ids.delete(question.id);
        versions.delete(question.id);
      }
    }
    this.bulkSelectedIdsSignal.set(ids);
    this.bulkExpectedVersionsSignal.set(versions);
  }

  bulkSubmissionInvalid(): boolean {
    if (this.workflowPending() || this.selectedQuestionCount() === 0) {
      return true;
    }
    return this.bulkActionMode() !== 'status' && this.bulkActionForm.controls.tags.value.trim().length === 0;
  }

  openBulkConfirmation(): void {
    if (this.bulkSubmissionInvalid()) {
      this.bulkFeedback.set('Choose a valid bulk action before continuing.');
      this.liveMessage.set(this.bulkFeedback());
      return;
    }
    this.bulkConfirmationOpen.set(true);
    this.bulkFeedback.set('');
    setTimeout(() => this.bulkDialog?.nativeElement.focus());
  }

  cancelBulkConfirmation(): void {
    if (this.workflowPending()) {
      return;
    }
    this.bulkConfirmationOpen.set(false);
    this.liveMessage.set('Bulk change cancelled.');
    this.restoreBulkTriggerFocus();
  }

  confirmBulkAction(): void {
    if (this.bulkSubmissionInvalid()) {
      return;
    }
    const targets = [...this.bulkSelectedIdsSignal()].map((id) => ({
      id,
      expectedVersion: this.bulkExpectedVersionsSignal().get(id) ?? 0
    }));
    const mode = this.bulkActionMode();
    const tags = this.bulkActionForm.controls.tags.value.split(',');
    const action = mode === 'status'
      ? { status: this.bulkActionForm.controls.status.value }
      : mode === 'add-tags'
        ? { addTags: tags }
        : { replaceTags: tags };
    const request: QuestionBulkRequest = { targets, action };
    this.workflowPending.set(true);
    this.bulkFeedback.set('');
    this.liveMessage.set('Applying bulk question changes.');
    this.facade.bulkUpdateQuestions(request).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => {
        const failedIds = new Set(result.failures.map((failure) => failure.id));
        const retainedIds = new Set([...this.bulkSelectedIdsSignal()].filter((id) => failedIds.has(id)));
        const retainedVersions = new Map<QuestionId, number>();
        for (const id of retainedIds) {
          const version = this.bulkExpectedVersionsSignal().get(id);
          if (version !== undefined) retainedVersions.set(id, version);
        }
        this.bulkSelectedIdsSignal.set(retainedIds);
        this.bulkExpectedVersionsSignal.set(retainedVersions);
        this.bulkFailures.set(result.failures);
        this.workflowPending.set(false);
        this.bulkConfirmationOpen.set(false);
        this.restoreBulkTriggerFocus();
        if (result.failures.length === 0) {
          this.bulkFeedback.set(`${result.counts.succeeded} question${result.counts.succeeded === 1 ? '' : 's'} updated successfully.`);
          this.liveMessage.set(this.bulkFeedback());
        } else {
          this.bulkFeedback.set(`${result.failures.length} question${result.failures.length === 1 ? '' : 's'} failed; failed rows remain selected for retry.`);
          this.liveMessage.set(this.bulkFeedback());
        }
      },
      error: (error: unknown) => {
        this.workflowPending.set(false);
        this.bulkFeedback.set(error instanceof Error ? error.message : 'Bulk question request failed.');
        this.liveMessage.set(this.bulkFeedback());
        this.bulkConfirmationOpen.set(false);
        this.restoreBulkTriggerFocus();
      }
    });
  }

  trackByFailureId(_index: number, failure: QuestionBulkFailure): QuestionId { return failure.id; }

  setPage(page: number): void {
    const query = normalizeQuestionListQuery({ ...this.activeQuerySignal(), page });
    this.selectedRouteIdSignal.set(null);
    this.queryRequests.next({ query, selectedId: null });
    this.syncUrl(query, null);
  }

  selectQuestion(id: QuestionId): void {
    this.inspectorTab.set('preview');
    this.selectedRouteIdSignal.set(id);
    this.syncUrl(this.activeQuerySignal(), id);
    this.selectionRequests.next(id);
  }

  publishQuestion(question: Question): void {
    if (!this.isEditable(question) || this.workflowPending()) return;
    this.workflowPending.set(true);
    this.workflowFeedback.set('');
    this.liveMessage.set(`Publishing ${question.id}.`);
    this.facade.publishQuestion(question.id, {}, { expectedVersion: question.version }).pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (published) => {
        this.workflowPending.set(false);
        this.workflowFeedbackKind.set('success');
        this.workflowFeedback.set('Question published successfully.');
        this.liveMessage.set(`${published.id} published successfully.`);
        this.selectQuestion(published.id);
        this.loadVersionHistory(published.id);
      },
      error: (error: unknown) => {
        this.workflowPending.set(false);
        this.setWorkflowError(error);
      }
    });
  }

  createSuccessor(question: Question): void {
    this.successorAttempted.set(true);
    this.successorForm.markAllAsTouched();
    if (this.workflowPending()) return;
    const note = this.successorForm.controls.changeNote.value.trim();
    if (this.successorForm.invalid || note.length === 0) {
      this.workflowFeedbackKind.set('error');
      this.workflowFeedback.set('Enter a nonblank change note before creating a successor.');
      this.liveMessage.set(this.workflowFeedback());
      return;
    }
    this.workflowPending.set(true);
    this.workflowFeedback.set('');
    this.facade.createQuestionSuccessor(question.id, { changeNote: note }, { expectedVersion: question.version }).pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (draft) => {
        this.workflowPending.set(false);
        this.successorAttempted.set(false);
        this.successorForm.reset();
        this.editorOpen.set(true);
        this.editingQuestionId.set(draft.id);
        this.workflowFeedbackKind.set('success');
        this.workflowFeedback.set('New editable successor created.');
        this.liveMessage.set(`${draft.id} opened as an editable successor.`);
        this.selectQuestion(draft.id);
      },
      error: (error: unknown) => {
        this.workflowPending.set(false);
        this.setWorkflowError(error);
      }
    });
  }

  startNewQuestion(): void {
    this.editingQuestionId.set(null);
    this.editorOpen.set(true);
    this.liveMessage.set('Create a new question.');
  }

  startEditQuestion(question: Question): void {
    if (!this.isEditable(question)) {
      return;
    }
    this.editingQuestionId.set(question.id);
    this.editorOpen.set(true);
    this.liveMessage.set(`${question.id} opened for editing.`);
  }

  closeEditor(): void {
    this.editorOpen.set(false);
    this.editingQuestionId.set(null);
    this.liveMessage.set('Question editor closed.');
  }
  clearSelection(): void {
    this.facade.clearSelection();
    this.selectedRouteIdSignal.set(null);
    this.inspectorTab.set('preview');
    this.liveMessage.set(this.facade.selectionNotice() || 'Selection cleared.');
    this.syncUrl(this.activeQuerySignal(), null);
  }

  onQuestionSaved(question: Question): void {
    this.editorOpen.set(false);
    this.editingQuestionId.set(null);
    this.selectQuestion(question.id);
    this.liveMessage.set(`${question.id} saved and selected.`);
  }

  isEditable(question: Question): boolean {
    return question.status === 'draft' || question.status === 'review';
  }
  showCurrentVersionEntry(question: Question): boolean {
    return this.isEditable(question) || question.status === 'archived';
  }

  versionStateLabel(question: Question): string {
    return this.isEditable(question)
      ? 'editable successor'
      : question.status === 'published'
        ? 'immutable published entity'
        : 'immutable archived entity';
  }

  setInspectorTab(tab: InspectorTab): void {
    this.inspectorTab.set(tab);
  }

  onInspectorTabKeydown(event: KeyboardEvent): void {
    const tabs: readonly InspectorTab[] = ['preview', 'metadata', 'versions'];
    const currentIndex = tabs.indexOf(this.inspectorTab());
    const key = event.key;
    const nextIndex = key === 'ArrowRight'
      ? (currentIndex + 1) % tabs.length
      : key === 'ArrowLeft'
        ? (currentIndex + tabs.length - 1) % tabs.length
        : key === 'Home'
          ? 0
          : key === 'End'
            ? tabs.length - 1
            : -1;
    if (nextIndex < 0) {
      return;
    }
    event.preventDefault();
    const next = tabs[nextIndex];
    this.setInspectorTab(next);
    (event.currentTarget as HTMLElement | null)?.parentElement
      ?.querySelector<HTMLButtonElement>(`[data-inspector-tab="${next}"]`)
      ?.focus();
  }

  trackByVersionId(_index: number, version: QuestionVersion): string { return version.versionId; }

  private loadVersionHistory(id: QuestionId): void {
    this.facade.loadQuestionVersionHistory(id).pipe(
      catchError((error: unknown) => {
        this.setWorkflowError(error);
        return of([] as readonly QuestionVersion[]);
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  private setWorkflowError(error: unknown): void {
    const saveState = this.facade.saveRequestState();
    const status = saveState.status;
    this.workflowFeedbackKind.set(
      status === 'conflict' ? 'conflict' : status === 'unauthorized' ? 'unauthorized' : 'error'
    );
    this.workflowFeedback.set(
      error instanceof Error ? error.message : this.facade.saveFeedback() || 'Question workflow request failed.'
    );
    this.liveMessage.set(this.workflowFeedback());
  }

  trackByQuestionId(_index: number, question: Question): QuestionId { return question.id; }
  trackByOptionId(_index: number, option: { readonly id: string }): string { return option.id; }
  trackByTag(_index: number, tag: string): string { return tag; }
  trackById(_index: number, value: { readonly id: string }): string { return value.id; }

  statusLabel(value: string): string { return value.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
  typeLabel(value: QuestionType | string): string { return this.statusLabel(value); }
  difficultyLabel(value: string): string { return this.statusLabel(value); }
  gradeLabel(value: string): string { return this.statusLabel(value); }
  sortLabel(value: string): string { return this.statusLabel(value.replace('At', '').replace('-', ' ')); }
  statusIcon(status: QuestionStatus): string { return status === 'published' ? '✓' : status === 'review' ? '!' : status === 'archived' ? '×' : '○'; }

  answerLabel(question: Question): string {
    switch (question.answer.kind) {
      case 'choice': return `choice: ${question.answer.optionIds.join(', ')}`;
      case 'boolean': return `true/false: ${question.answer.value ? 'true' : 'false'}`;
      case 'matching': return `matching: ${question.answer.pairs.length} pairs`;
      case 'short-answer': return `short answer: ${question.answer.acceptedAnswers.length} accepted forms`;
      case 'essay': return 'essay response with rubric guidance';
    }
  }

  private applyQueryParams(params: ParamMap): void {
    const query = normalizeQuestionListQuery({
      search: params.get('search'), course: params.get('course'), grade: params.get('grade'), difficulty: params.get('difficulty'),
      status: params.get('status'), type: params.get('type'), sort: params.get('sort'), page: params.get('page')
    });
    const selected = this.normalizeSelected(params.get('selected'));
    const queryKey = this.queryKey(query);
    const selectedKey = selected ?? '';
    if (queryKey === this.lastQueryKey && selectedKey === this.lastSelectedKey) return;
    const queryChanged = queryKey !== this.lastQueryKey;
    this.lastQueryKey = queryKey;
    this.lastSelectedKey = selectedKey;
    this.activeQuerySignal.set(query);
    this.selectedRouteIdSignal.set(selected);
    this.filterForm.reset({ search: query.search, course: query.course, grade: query.grade, difficulty: query.difficulty, status: query.status, type: query.type, sort: query.sort }, { emitEvent: false });
    if (!this.urlMatches(params, query, selected)) this.syncUrl(query, selected);
    if (queryChanged) this.queryRequests.next({ query, selectedId: selected });
    else this.selectionRequests.next(selected);
  }

  private syncUrl(query: QuestionListQuery, selected: QuestionId | null): void {
    this.lastQueryKey = this.queryKey(query);
    this.lastSelectedKey = selected ?? '';
    const queryParams: Record<string, string | number | null> = {
      search: query.search || null, course: query.course || null, grade: query.grade || null, difficulty: query.difficulty || null,
      status: query.status || null, type: query.type || null, sort: query.sort === 'updatedAt-desc' ? null : query.sort, page: query.page === 1 ? null : query.page, selected
    };
    void this.router.navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge', replaceUrl: true });
  }

  private urlMatches(params: ParamMap, query: QuestionListQuery, selected: QuestionId | null): boolean {
    const expected: Readonly<Record<string, string | null>> = {
      search: query.search || null, course: query.course || null, grade: query.grade || null, difficulty: query.difficulty || null,
      status: query.status || null, type: query.type || null, sort: query.sort === 'updatedAt-desc' ? null : query.sort, page: query.page === 1 ? null : String(query.page), selected
    };
    return Object.entries(expected).every(([key, value]) => value === null ? !params.has(key) : params.get(key) === value);
  }

  private normalizeSelected(value: string | null): QuestionId | null {
    return value !== null && /^QUESTION-[A-Za-z0-9._:-]+$/.test(value) ? value as QuestionId : null;
  }

  private queryKey(query: QuestionListQuery): string { return JSON.stringify(query); }

  private restoreBulkTriggerFocus(): void {
    setTimeout(() => this.bulkReviewButton?.nativeElement.focus());
  }
}
