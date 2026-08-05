import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal, type OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, type ParamMap } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { EMPTY, Subject, catchError, debounceTime, distinctUntilChanged, of, switchMap, tap } from 'rxjs';

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
  Question,
  QuestionId,
  QuestionListQuery,
  QuestionStatus,
  QuestionType
} from '../models/question.models';
import { QuestionEditorComponent } from './question-editor.component';

interface QueryRequest {
  readonly query: QuestionListQuery;
  readonly selectedId: QuestionId | null;
}

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
          <div *ngIf="facade.requestState().status === 'unauthorized'" class="table-state"><app-request-state state="unauthorized" title="Question bank unavailable" message="A valid instructor or measurement course grant is required." /></div>
          <div *ngIf="facade.requestState().status === 'error'" class="table-state"><app-request-state state="error" title="Question service unavailable" [message]="facade.errorMessage()" (retry)="retryLoad()" /></div>
          <div *ngIf="facade.requestState().status === 'empty'" class="table-state"><app-request-state state="empty" title="No matching questions" message="No authorized question matches the current filters." /></div>
          <div *ngIf="facade.requestState().status === 'success'" class="table-wrap">
            <table>
              <caption class="sr-only">Scoped question bank results</caption>
              <thead><tr><th scope="col">ID</th><th scope="col">Course / outcome</th><th scope="col">Type</th><th scope="col">Difficulty</th><th scope="col">Status</th><th scope="col">Version</th><th scope="col">Updated</th></tr></thead>
              <tbody>
                <tr *ngFor="let question of questions(); trackBy: trackByQuestionId" [class.question-row--selected]="facade.selectedId() === question.id" [attr.aria-selected]="facade.selectedId() === question.id" (click)="selectQuestion(question.id)">
                  <td><button type="button" class="row-select" [attr.aria-label]="'Preview question ' + question.id" [attr.aria-pressed]="facade.selectedId() === question.id" (click)="$event.stopPropagation(); selectQuestion(question.id)">{{ question.id }}</button><span class="row-title">{{ question.title }}</span></td>
                  <td><strong>{{ question.course.code }}</strong><span>{{ question.outcome.code }} · {{ question.outcome.title }}</span></td>
                  <td>{{ typeLabel(question.type) }}</td>
                  <td><span class="table-badge">{{ difficultyLabel(question.difficulty) }}</span></td>
                  <td><span class="table-badge status-badge"><span aria-hidden="true">{{ statusIcon(question.status) }}</span> {{ statusLabel(question.status) }}</span></td>
                  <td class="numeric">v{{ question.version }}</td>
                  <td><time [attr.datetime]="question.updatedAt">{{ question.updatedAt | date:'dd MMM yyyy, HH:mm' }}</time></td>
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

        <aside class="inspector" aria-labelledby="question-inspector-heading" [attr.aria-hidden]="facade.selectedQuestion() === null ? 'true' : null">
          <div class="inspector-heading"><div><span class="eyebrow">Current entity</span><h2 id="question-inspector-heading">Inspector</h2></div><button *ngIf="facade.selectedQuestion()" type="button" class="icon-button" aria-label="Close question preview" (click)="clearSelection()">×</button></div>
          <ng-container *ngIf="facade.selectedQuestion() as selected; else noSelection">
            <div class="inspector-id"><strong>{{ selected.id }}</strong><span class="table-badge status-badge"><span aria-hidden="true">{{ statusIcon(selected.status) }}</span> {{ statusLabel(selected.status) }}</span></div>
            <section class="preview-block"><h3>Preview</h3><p class="question-stem">{{ selected.stem }}</p><ol *ngIf="selected.options.length > 0" class="answer-options"><li *ngFor="let option of selected.options; trackBy: trackByOptionId">{{ option.label }}</li></ol><p class="answer-note"><strong>Answer representation:</strong> {{ answerLabel(selected) }}</p><p class="explanation"><strong>Explanation:</strong> {{ selected.explanation }}</p></section>
            <div class="inspector-actions">
              <button *ngIf="isEditable(selected)" type="button" class="primary-button" (click)="startEditQuestion(selected)">Edit question</button>
              <p *ngIf="!isEditable(selected)" class="non-editable-note">Preview only. Published and archived questions require version creation in the later publish workflow.</p>
            </div>
            <section class="metadata-block"><h3>Metadata</h3><dl><dt>Course</dt><dd>{{ selected.course.code }} · {{ selected.course.title }}</dd><dt>Outcome</dt><dd>{{ selected.outcome.code }} · {{ selected.outcome.title }}</dd><dt>Type</dt><dd>{{ typeLabel(selected.type) }}</dd><dt>Grade</dt><dd>{{ gradeLabel(selected.grade) }}</dd><dt>Difficulty</dt><dd>{{ difficultyLabel(selected.difficulty) }}</dd><dt>Points</dt><dd>{{ selected.points }}</dd><dt>Version</dt><dd>v{{ selected.version }} · immutable</dd><dt>Created</dt><dd><time [attr.datetime]="selected.createdAt">{{ selected.createdAt | date:'dd MMM yyyy' }}</time></dd><dt>Updated</dt><dd><time [attr.datetime]="selected.updatedAt">{{ selected.updatedAt | date:'dd MMM yyyy, HH:mm' }}</time></dd></dl><div class="tag-list" aria-label="Question tags"><span *ngFor="let tag of selected.tags" class="tag">#{{ tag }}</span></div></section>
          </ng-container>
          <ng-template #noSelection><div class="inspector-empty"><span aria-hidden="true">⌁</span><h3>Select a question</h3><p>Choose one row to preview its current immutable content and metadata.</p></div></ng-template>
        </aside>
      </div>
    </section>
  `,
  styles: [`
    :host { display:block; min-height:100%; }
    .question-bank { display:grid; gap:18px; padding:4px; }
    .page-heading, .card-heading, .inspector-heading, .inspector-id { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
    .page-heading { align-items:end; }
    .page-heading h1, .card-heading h2, .inspector-heading h2, h3, p { margin:0; }
    .eyebrow { color:var(--ui-text-muted); font-size:11px; font-weight:750; letter-spacing:.05em; text-transform:uppercase; }
    h1 { font-size:clamp(1.5rem,3vw,2rem); line-height:1.2; }
    h2 { font-size:1.1rem; line-height:1.3; }
    h3 { font-size:.9rem; }
    .page-heading p { color:var(--ui-text-muted); margin-top:4px; }
    .read-only-note { border:1px solid var(--ui-border-strong); border-radius:999px; color:var(--ui-text-muted); padding:5px 10px; font-size:12px; font-weight:700; }
    .filter-bar { display:grid; grid-template-columns:minmax(220px,1.6fr) repeat(6,minmax(112px,1fr)) auto; gap:10px; align-items:end; padding:14px; border:1px solid var(--ui-border); border-radius:var(--ui-radius-md); background:var(--ui-surface); box-shadow:var(--ui-shadow-sm); }
    label { display:grid; gap:4px; min-width:0; color:var(--ui-text-muted); font-size:11px; font-weight:700; }
    input, select { width:100%; min-height:40px; border:1px solid var(--ui-border-strong); border-radius:var(--ui-radius-sm); background:var(--ui-surface); color:var(--ui-text); padding:7px 10px; font-size:13px; }
    .secondary-button, .page-button, .icon-button { min-height:40px; border:1px solid var(--ui-border-strong); border-radius:var(--ui-radius-sm); background:var(--ui-surface); color:var(--ui-text); cursor:pointer; font-weight:700; padding:7px 12px; }
    .secondary-button:hover, .page-button:hover, .icon-button:hover { border-color:var(--ui-primary); color:var(--ui-primary); }
    button:disabled { cursor:not-allowed; opacity:.45; }
    .status-bar { display:flex; flex-wrap:wrap; gap:8px; }
    .status-chip { min-height:30px; border:1px solid var(--ui-border); border-radius:999px; background:var(--ui-surface); color:var(--ui-text-muted); padding:4px 11px; cursor:pointer; font-size:12px; }
    .status-chip strong { margin-left:4px; color:var(--ui-text); font-variant-numeric:tabular-nums; }
    .status-chip--active { border-color:var(--ui-primary); background:var(--ui-primary-soft); color:var(--ui-primary); }
    .status-chip--active strong { color:var(--ui-primary); }
    .live-message { min-height:18px; color:var(--ui-text-muted); font-size:12px; }
    .content-grid { display:grid; grid-template-columns:minmax(0,1fr) 360px; gap:16px; align-items:start; }
    .table-card, .inspector { min-width:0; border:1px solid var(--ui-border); border-radius:var(--ui-radius-md); background:var(--ui-surface); box-shadow:var(--ui-shadow-sm); }
    .card-heading, .inspector-heading { padding:16px 18px; border-bottom:1px solid var(--ui-border); }
    .page-summary { color:var(--ui-text-muted); font-size:12px; }
    .table-wrap { overflow:auto; }
    table { width:100%; border-collapse:collapse; font-size:12px; }
    th { background:var(--ui-surface-subtle); color:var(--ui-text-muted); font-size:11px; letter-spacing:.02em; text-align:left; text-transform:uppercase; }
    th, td { padding:11px 12px; border-bottom:1px solid var(--ui-border); vertical-align:middle; }
    tbody tr { cursor:pointer; }
    tbody tr:hover, .question-row--selected { background:var(--ui-primary-soft); }
    tbody tr:last-child td { border-bottom:0; }
    td > span, td > strong { display:block; }
    td > span { color:var(--ui-text-muted); margin-top:3px; }
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
    .inspector { position:sticky; top:16px; min-height:360px; }
    .inspector-id, .preview-block, .metadata-block, .inspector-empty { padding:16px 18px; }
    .inspector-id { align-items:center; border-bottom:1px solid var(--ui-border); }
    .preview-block { display:grid; gap:10px; border-bottom:1px solid var(--ui-border); }
    .question-stem { line-height:1.55; }
    .answer-options { display:grid; gap:6px; margin:0; padding-left:24px; color:var(--ui-text-muted); }
    .answer-note, .explanation { color:var(--ui-text-muted); font-size:12px; }
    .metadata-block { display:grid; gap:12px; }
    dl { display:grid; grid-template-columns:92px minmax(0,1fr); gap:7px 10px; margin:0; font-size:12px; }
    dt { color:var(--ui-text-muted); font-weight:700; }
    dd { margin:0; overflow-wrap:anywhere; }
    .tag-list { display:flex; flex-wrap:wrap; gap:6px; }
    .tag { border:1px solid var(--ui-border); border-radius:999px; background:var(--ui-surface-subtle); padding:4px 7px; color:var(--ui-text-muted); font-size:11px; }
    .inspector-empty { display:grid; justify-items:start; gap:8px; color:var(--ui-text-muted); }
    .inspector-empty > span { font-size:24px; color:var(--ui-primary); }
    .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
    @media (max-width:1100px) { .filter-bar { grid-template-columns:repeat(3,minmax(130px,1fr)); } .search-field { grid-column:span 3; } .secondary-button { justify-self:start; } .content-grid { grid-template-columns:minmax(0,1fr) 320px; } }
    @media (max-width:700px) { .question-bank { padding:0; gap:14px; } .page-heading { align-items:start; flex-direction:column; } .filter-bar { grid-template-columns:repeat(2,minmax(0,1fr)); } .search-field { grid-column:span 2; } .content-grid { grid-template-columns:1fr; } .inspector { position:relative; top:auto; order:-1; } .table-wrap { overflow-x:auto; } table { min-width:740px; } .pagination { justify-content:center; } }
  `]
})
export class QuestionBankComponent implements OnInit {
  readonly facade = inject(QuestionBankFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly queryRequests = new Subject<QueryRequest>();
  private readonly selectionRequests = new Subject<QuestionId | null>();
  private lastQueryKey = '';
  private lastSelectedKey = '';
  private readonly activeQuerySignal = signal(normalizeQuestionListQuery(FILTER_DEFAULTS));
  private readonly selectedRouteIdSignal = signal<QuestionId | null>(null);
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

  ngOnInit(): void {
    this.queryRequests.pipe(
      distinctUntilChanged((left, right) => this.queryKey(left.query) === this.queryKey(right.query) && left.selectedId === right.selectedId),
      tap(({ query }) => this.activeQuerySignal.set(query)),
      switchMap(({ query, selectedId }) => this.facade.loadQuestions(query).pipe(
        tap((response) => {
          this.activeQuerySignal.set(response.query);
          this.filterForm.patchValue({ sort: response.query.sort }, { emitEvent: false });
          if (response.query.page !== query.page) this.syncUrl(response.query, selectedId);
          this.liveMessage.set(`${response.total} authorized questions loaded.`);
        }),
        switchMap(() => selectedId === null ? of(null) : this.facade.selectQuestion(selectedId)),
        catchError(() => EMPTY)
      )),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((selected) => {
      if (selected === null && this.selectedRouteIdSignal() !== null) {
        this.selectedRouteIdSignal.set(null);
        this.liveMessage.set(this.facade.selectionNotice() || 'Selection cleared because the question is missing or stale.');
        this.syncUrl(this.activeQuerySignal(), null);
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
        this.liveMessage.set(`Previewing ${selected.id}.`);
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

  retryLoad(): void { this.queryRequests.next({ query: this.activeQuerySignal(), selectedId: this.selectedRouteIdSignal() }); }

  resetFilters(): void { this.filterForm.reset(FILTER_DEFAULTS); }

  setStatus(status: QuestionStatus | null): void { this.filterForm.patchValue({ status: status ?? '' }); }

  setPage(page: number): void {
    const query = normalizeQuestionListQuery({ ...this.activeQuerySignal(), page });
    this.selectedRouteIdSignal.set(null);
    this.queryRequests.next({ query, selectedId: null });
    this.syncUrl(query, null);
  }

  selectQuestion(id: QuestionId): void {
    this.selectedRouteIdSignal.set(id);
    this.syncUrl(this.activeQuerySignal(), id);
    this.selectionRequests.next(id);
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

  trackByQuestionId(_index: number, question: Question): QuestionId { return question.id; }
  trackByOptionId(_index: number, option: { readonly id: string }): string { return option.id; }
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
}
