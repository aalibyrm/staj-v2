import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, type ParamMap } from '@angular/router';
import { BehaviorSubject, NEVER, firstValueFrom, of, Subject, switchMap, throwError, type Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockTransport } from '../../../core/api/mock-transport';
import { DEMO_ACCOUNTS } from '../../../core/auth/authorization';
import { SessionStore } from '../../../core/auth/session.store';
import {
  QuestionBankFacade,
  QuestionBankRepository,
  normalizeQuestionListQuery
} from '../data-access/question-bank.facade';
import {
  QUESTION_STATUSES,
  QUESTION_TYPES,
  asCourseId,
  asLearningOutcomeId,
  asQuestionId,
  type Question,
  type QuestionBankRequestState,
  type QuestionBulkRequest,
  type QuestionBulkResult,
  type QuestionId,
  type QuestionListQuery,
  type QuestionListResponse,
  type QuestionStatusCounts
} from '../models/question.models';
import { QuestionBankComponent } from './question-bank.component';

const accountIdFor = (role: 'INSTRUCTOR' | 'MEASUREMENT_SPECIALIST' | 'STUDENT'): string => {
  const account = DEMO_ACCOUNTS.find((candidate) => candidate.roleCode === role);
  if (account === undefined) throw new Error(`Missing account for ${role}.`);
  return account.id;
};

const signedIn = (role: 'INSTRUCTOR' | 'MEASUREMENT_SPECIALIST' | 'STUDENT'): SessionStore => {
  const store = new SessionStore();
  store.signIn(accountIdFor(role));
  return store;
};

describe('QuestionBankRepository', () => {
  it('seeds immutable dense rows from course and outcome references with every supported type', async () => {
    const repository = new QuestionBankRepository(new MockTransport());
    const response = await firstValueFrom(repository.listQuestions({ pageSize: 50 }, { session: signedIn('INSTRUCTOR').session() }));
    expect(response.total).toBeGreaterThan(10);
    expect(Object.isFrozen(response)).toBe(true);
    expect(Object.isFrozen(response.items)).toBe(true);
    expect(Object.isFrozen(response.items[0])).toBe(true);
    expect(new Set(response.items.map((question) => question.type))).toEqual(new Set(QUESTION_TYPES));
    expect(response.items.every((question) => question.courseId === 'COURSE-MATH101-2025-FALL')).toBe(true);
    expect(response.items.every((question) => question.outcomeId.length > 0 && question.tags.length > 0)).toBe(true);
  });

  it('fails closed for missing, invalid, and cross-role sessions without leaking rows', async () => {
    const repository = new QuestionBankRepository(new MockTransport());
    await expect(firstValueFrom(repository.listQuestions())).rejects.toMatchObject({ kind: 'unauthorized' });
    await expect(firstValueFrom(repository.listQuestions({}, { session: signedIn('STUDENT').session() }))).rejects.toMatchObject({ kind: 'unauthorized' });
    const measurement = signedIn('MEASUREMENT_SPECIALIST');
    const response = await firstValueFrom(repository.listQuestions({}, { session: measurement.session() }));
    expect(response.items.every((question) => question.courseId === 'COURSE-MATH101-2025-FALL')).toBe(true);
  });

  it('normalizes filters, performs stable sorting, clamps pages, and reports status counts without status filtering', async () => {
    const repository = new QuestionBankRepository(new MockTransport());
    const session = signedIn('INSTRUCTOR').session();
    const malformed = normalizeQuestionListQuery({ page: 'not-a-page', pageSize: 2, sort: 'id-asc' });
    expect(malformed.page).toBe(1);
    const page = await firstValueFrom(repository.listQuestions({ page: 999, pageSize: 2, sort: 'id-asc' }, { session }));
    expect(page.page).toBe(page.totalPages);
    expect(page.items).toHaveLength(2);
    const status = QUESTION_STATUSES[0];
    const filtered = await firstValueFrom(repository.listQuestions({ status, pageSize: 50 }, { session }));
    expect(filtered.items.every((question) => question.status === status)).toBe(true);
    expect(Object.values(filtered.statusCounts).reduce((sum, count) => sum + count, 0)).toBeGreaterThanOrEqual(filtered.total);
  });

  it('supports service failure and retry controls through the transport', async () => {
    const repository = new QuestionBankRepository(new MockTransport());
    repository.setMockScenario({ outcome: 'service-error' });
    await expect(firstValueFrom(repository.listQuestions({}, { session: signedIn('INSTRUCTOR').session() }))).rejects.toMatchObject({ kind: 'service' });
    repository.resetMockScenario();
    await expect(firstValueFrom(repository.listQuestions({}, { session: signedIn('INSTRUCTOR').session() }))).resolves.toMatchObject({ total: expect.any(Number) });
  });
});

describe('QuestionBankFacade', () => {
  it('owns request, result, status-count, and stale-selection signals', async () => {
    const store = signedIn('INSTRUCTOR');
    const repository = new QuestionBankRepository(new MockTransport());
    const facade = new QuestionBankFacade(repository, store);
    const result = await firstValueFrom(facade.loadQuestions({ pageSize: 2 }));
    expect(facade.requestState().status).toBe('success');
    expect(facade.pageResult()).toEqual(result);
    expect(facade.statusCounts().published).toBeGreaterThan(0);
    await firstValueFrom(facade.selectQuestion(result.items[0].id));
    expect(facade.selectedId()).toBe(result.items[0].id);
    await firstValueFrom(facade.selectQuestion('QUESTION-missing'));
    expect(facade.selectedId()).toBeNull();
    expect(facade.selectionNotice()).toContain('missing or stale');
  });

  it('allows component-style switchMap cancellation so stale responses cannot replace current state', async () => {
    const store = signedIn('INSTRUCTOR');
    const repository = new QuestionBankRepository(new MockTransport());
    repository.setMockScenario({ latencyMs: 15 });
    const facade = new QuestionBankFacade(repository, store);
    const queries = new Subject<{ readonly search: string }>();
    const subscription = queries.pipe(switchMap(({ search }) => facade.loadQuestions({ search }))).subscribe();
    queries.next({ search: 'foundations' });
    repository.setMockScenario({ latencyMs: 0 });
    queries.next({ search: 'analytics' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(facade.pageResult()?.query.search).toBe('analytics');
    subscription.unsubscribe();
  });
});
  it('creates and updates immutable draft data, preserves failed snapshots, and rejects published writes', async () => {
    const repository = new QuestionBankRepository(new MockTransport());
    const session = signedIn('INSTRUCTOR').session();
    const before = repository.getSnapshot();
    const accessible = (await firstValueFrom(repository.listQuestions({ pageSize: 50 }, { session }))).items[0];
    if (accessible === undefined) throw new Error('Expected an accessible seeded question.');
    const input = {
      courseId: accessible.courseId,
      outcomeId: accessible.outcomeId,
      title: '  New normalized question  ',
      stem: '  Which response is supported?  ',
      explanation: '  The evidence supports the selected response.  ',
      tags: [' evidence ', 'Evidence'],
      difficulty: 'easy' as const,
      points: 2,
      grade: 'foundation' as const,
      type: 'single-choice' as const,
      options: [{ id: 'a', label: '  Supported  ' }, { id: 'b', label: 'Other' }],
      answer: { kind: 'choice' as const, optionIds: ['a'] },
      status: 'draft' as const
    };
    const created = await firstValueFrom(repository.createQuestion(input, { session }));
    expect(created.id).toContain('-NEW-');
    expect(Object.isFrozen(created)).toBe(true);
    expect(created.title).toBe('New normalized question');
    expect(created.tags).toEqual(['evidence']);
    expect(repository.getSnapshot().questions).toHaveLength(before.questions.length + 1);
    const updated = await firstValueFrom(repository.updateQuestion(created.id, { title: 'Updated title' }, { session, expectedVersion: created.version }));
    expect(updated.version).toBe(created.version + 1);
    const failedBefore = repository.getSnapshot();
    repository.setMockScenario({ outcome: 'service-error' });
    await expect(firstValueFrom(repository.updateQuestion(created.id, { title: 'Unsaved' }, { session, expectedVersion: updated.version }))).rejects.toMatchObject({ kind: 'service' });
    expect(repository.getSnapshot()).toEqual(failedBefore);
    repository.resetMockScenario();
    const published = (await firstValueFrom(repository.listQuestions({ status: 'published', pageSize: 50 }, { session }))).items[0];
    if (published === undefined) throw new Error('Expected a published question.');
    await expect(firstValueFrom(repository.updateQuestion(published.id, { title: 'Forbidden' }, { session, expectedVersion: published.version }))).rejects.toMatchObject({ code: 'not-editable' });
  });
const testQuestion: Question = {
  id: asQuestionId('QUESTION-TEST-101-001'),
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-02T00:00:00.000Z',
  version: 1,
  status: 'published',
  courseId: asCourseId('COURSE-TEST-101'),
  outcomeId: asLearningOutcomeId('OUTCOME-TEST-101'),
  course: {
    id: asCourseId('COURSE-TEST-101'),
    code: 'TEST-101',
    title: 'Test Course'
  },
  outcome: {
    id: asLearningOutcomeId('OUTCOME-TEST-101'),
    code: 'OUT-101',
    title: 'Test outcome'
  },
  title: 'Test question',
  stem: 'Which answer demonstrates the tested behavior?',
  explanation: 'The selected answer is supported by the course evidence.',
  tags: ['test-101', 'behavior'],
  difficulty: 'medium',
  points: 5,
  grade: 'foundation',
  type: 'single-choice',
  options: [{ id: 'option-a', label: 'The supported answer' }],
  answer: { kind: 'choice', optionIds: ['option-a'] }
};
const bulkReviewQuestion: Question = { ...testQuestion, id: asQuestionId('QUESTION-TEST-101-REVIEW'), status: 'review' };
const bulkArchivedQuestion: Question = { ...testQuestion, id: asQuestionId('QUESTION-TEST-101-ARCHIVED'), status: 'archived' };

const testStatusCounts: QuestionStatusCounts = Object.freeze({
  draft: 2,
  review: 3,
  published: 4,
  archived: 1
});

const responseFor = (query: QuestionListQuery, items: readonly Question[]): QuestionListResponse => {
  const total = items.length;
  const page = total === 0 ? 1 : Math.min(query.page, 1);
  const responseQuery = page === query.page ? query : normalizeQuestionListQuery({ ...query, page });
  return Object.freeze({
    items: Object.freeze([...items]),
    total,
    page,
    pageSize: query.pageSize,
    totalPages: total === 0 ? 0 : 1,
    hasPreviousPage: false,
    hasNextPage: false,
    query: responseQuery,
    statusCounts: testStatusCounts
  });
};

type TestRequestMode = 'loading' | 'empty' | 'error' | 'unauthorized' | 'success';

class DeterministicQuestionBankFacade {
  readonly requestState = signal<QuestionBankRequestState>({ status: 'idle' });
  readonly errorMessage = signal('');
  readonly pageResult = signal<QuestionListResponse | null>(null);
  readonly selectedId = signal<QuestionId | null>(null);
  readonly selectedQuestion = signal<Question | null>(null);
  readonly selectionNotice = signal('');
  readonly statusCounts = signal<QuestionStatusCounts>(testStatusCounts);
  readonly courseOptions = signal<readonly Question['course'][]>([testQuestion.course]);
  mode: TestRequestMode = 'success';
  selectionMode: 'valid' | 'stale' = 'valid';
  readonly bulkUpdateResult$ = new Subject<QuestionBulkResult>();

  readonly loadQuestions = vi.fn((query: QuestionListQuery): Observable<QuestionListResponse> => {
    this.requestState.set({ status: 'loading' });
    this.errorMessage.set('');
    this.pageResult.set(null);
    this.selectedId.set(null);
    this.selectedQuestion.set(null);
    if (this.mode === 'loading') return NEVER;
    if (this.mode === 'error') {
      this.errorMessage.set('Service unavailable.');
      this.requestState.set({ status: 'error', message: this.errorMessage() });
      return throwError(() => new Error('service unavailable'));
    }
    if (this.mode === 'unauthorized') {
      this.requestState.set({ status: 'unauthorized', message: 'Access unavailable.' });
      return throwError(() => new Error('unauthorized'));
    }
    const response = responseFor(query, this.mode === 'empty' ? [] : [testQuestion]);
    this.pageResult.set(response);
    this.statusCounts.set(response.statusCounts);
    this.requestState.set({ status: response.total === 0 ? 'empty' : 'success' });
    return of(response);
  });

  readonly selectQuestion = vi.fn((id: QuestionId | string | null | undefined): Observable<Question | null> => {
    const normalized = typeof id === 'string' && id.trim().length > 0 ? asQuestionId(id.trim()) : null;
    if (this.selectionMode === 'valid' && normalized === testQuestion.id) {
      this.selectedId.set(testQuestion.id);
      this.selectedQuestion.set(testQuestion);
      this.selectionNotice.set('');
      return of(testQuestion);
    }
    this.selectedId.set(null);
    this.selectedQuestion.set(null);
    this.selectionNotice.set('Selection cleared because the question is missing or stale.');
    return of(null);
  });

  readonly clearSelection = vi.fn((reason = 'Selection cleared.'): void => {
    this.selectedId.set(null);
    this.selectedQuestion.set(null);
    this.selectionNotice.set(reason);
  });

  readonly loadCourseOptions = vi.fn(() => of(this.courseOptions()));
  readonly versionHistory = signal<readonly { readonly versionId: string; readonly version: number; readonly publishedAt: string; readonly changeNote: string }[]>([]);
  readonly saveRequestState = signal({ status: 'idle' as const });
  readonly saveFeedback = signal('');
  readonly loadQuestionVersionHistory = vi.fn((_id: QuestionId): Observable<readonly never[]> => of([]));
  readonly publishQuestion = vi.fn((_id: QuestionId, _input: unknown, _options: unknown): Observable<Question> => of(testQuestion));
  readonly bulkUpdateQuestions = vi.fn((_request: QuestionBulkRequest): Observable<QuestionBulkResult> => this.bulkUpdateResult$);
  readonly createQuestionSuccessor = vi.fn((_id: QuestionId, _input: unknown, _options: unknown): Observable<Question> => {
    const draft = { ...testQuestion, status: 'draft' as const, version: testQuestion.version + 1 };
    this.selectedId.set(draft.id);
    this.selectedQuestion.set(draft);
    return of(draft);
  });
}

const queryParamMap = (values: Readonly<Record<string, string>>): ParamMap => ({
  keys: Object.keys(values),
  has: (name) => Object.prototype.hasOwnProperty.call(values, name),
  get: (name) => values[name] ?? null,
  getAll: (name) => values[name] === undefined ? [] : [values[name]]
});

describe('QuestionBankComponent', () => {
  type NavigationExtras = {
    readonly queryParams?: Readonly<Record<string, string | number | null>>;
  };

  let facade: DeterministicQuestionBankFacade;
  let queryParams$: BehaviorSubject<ParamMap>;
  let routeValues: Record<string, string>;
  const router = {
    navigate: vi.fn((_commands: readonly unknown[], extras: NavigationExtras): Promise<boolean> => {
      const next = { ...routeValues };
      for (const [key, value] of Object.entries(extras.queryParams ?? {})) {
        if (value === null || value === undefined) {
          delete next[key];
        } else {
          next[key] = String(value);
        }
      }
      routeValues = next;
      queryParams$.next(queryParamMap(routeValues));
      return Promise.resolve(true);
    })
  };

  beforeEach(() => {
    vi.useFakeTimers();
    facade = new DeterministicQuestionBankFacade();
    routeValues = {};
    queryParams$ = new BehaviorSubject(queryParamMap(routeValues));
    router.navigate.mockClear();
    TestBed.configureTestingModule({
      imports: [QuestionBankComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { queryParamMap: queryParams$.asObservable() } },
        { provide: Router, useValue: router }
      ]
    });
    TestBed.overrideComponent(QuestionBankComponent, {
      set: { providers: [{ provide: QuestionBankFacade, useValue: facade }] }
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  const create = (params: Readonly<Record<string, string>> = {}, mode: TestRequestMode = 'success') => {
    facade.mode = mode;
    routeValues = { ...params };
    queryParams$.next(queryParamMap(routeValues));
    const fixture = TestBed.createComponent(QuestionBankComponent);
    fixture.detectChanges();
    return fixture;
  };

  it('loads the initial route query and selected inspector through the concrete component', () => {
    const fixture = create({
      search: 'behavior',
      status: 'published',
      sort: 'id-asc',
      selected: testQuestion.id
    });

    expect(facade.loadQuestions).toHaveBeenCalledWith(expect.objectContaining({
      search: 'behavior',
      status: 'published',
      sort: 'id-asc',
      page: 1
    }));
    expect(facade.selectQuestion).toHaveBeenCalledWith(testQuestion.id);
    expect(fixture.nativeElement.querySelector('.inspector')?.textContent).toContain(testQuestion.stem);
  });

  it('keeps default URL state canonical and synchronizes user filter changes', () => {
    const fixture = create({ sort: 'updatedAt-desc', page: '1' });
    expect(routeValues).toEqual({});
    expect(router.navigate).toHaveBeenCalled();

    fixture.componentInstance.filterForm.controls.search.setValue('behavior');
    vi.advanceTimersByTime(120);
    fixture.detectChanges();

    expect(routeValues).toEqual({ search: 'behavior' });
    expect(router.navigate).toHaveBeenLastCalledWith([], expect.objectContaining({
      queryParams: expect.objectContaining({ search: 'behavior', sort: null, page: null })
    }));
    expect(facade.loadQuestions).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'behavior', page: 1 }));
  });

  it('selects a rendered row and clears the stale selection from the inspector and URL', async () => {
    const fixture = create();
    const rowButton = fixture.nativeElement.querySelector('.row-select') as HTMLButtonElement;

    rowButton.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('tbody tr')?.classList.contains('question-row--selected')).toBe(true);
    expect(fixture.nativeElement.querySelector('.inspector')?.textContent).toContain(testQuestion.stem);
    expect(routeValues['selected']).toBe(testQuestion.id);

    facade.selectionMode = 'stale';
    rowButton.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('tbody tr')?.classList.contains('question-row--selected')).toBe(false);
    expect(fixture.nativeElement.querySelector('.inspector-empty')?.textContent).toContain('Select a question');
    expect(fixture.componentInstance.selectedRouteId()).toBeNull();
    expect(routeValues['selected']).toBeUndefined();
    expect(fixture.nativeElement.textContent).toContain('missing or stale');
  });

  it('renders loading, empty, error, unauthorized, and success inspector states', () => {
    const cases: readonly [TestRequestMode, string][] = [
      ['loading', 'Loading questions'],
      ['empty', 'No matching questions'],
      ['error', 'Question service unavailable'],
      ['unauthorized', 'Question bank unavailable']
    ];
    for (const [mode, text] of cases) {
      const fixture = create({}, mode);
      expect(fixture.nativeElement.querySelector('.table-state')?.textContent).toContain(text);
      fixture.destroy();
    }

    const successFixture = create({ selected: testQuestion.id }, 'success');
    expect(successFixture.nativeElement.querySelector('.table-wrap')).not.toBeNull();
    expect(successFixture.nativeElement.querySelector('.inspector-empty')).toBeNull();
    expect(successFixture.nativeElement.querySelector('.inspector')?.textContent).toContain(testQuestion.explanation);
  });

  it('shows All as the sum of unfiltered status counts while a status filter is active', () => {
    const fixture = create({ status: 'published' });
    const allCount = fixture.nativeElement.querySelector('.status-chip--all strong')?.textContent?.trim();

    expect(fixture.componentInstance.total()).toBe(1);
    expect(fixture.componentInstance.statusTotal()).toBe(10);
    expect(allCount).toBe('10');
  });
  it('publishes an editable question and announces success without changing URL query state', () => {
    const fixture = create({ search: 'behavior', selected: testQuestion.id });
    const draft = { ...testQuestion, status: 'draft' as const };
    fixture.componentInstance.workflowPending.set(true);
    fixture.componentInstance.publishQuestion(draft);
    expect(facade.publishQuestion).not.toHaveBeenCalled();
    fixture.componentInstance.workflowPending.set(false);
    fixture.componentInstance.publishQuestion(draft);
    expect(facade.publishQuestion).toHaveBeenCalledWith(draft.id, {}, { expectedVersion: draft.version });
    expect(fixture.componentInstance.workflowPending()).toBe(false);
    expect(fixture.componentInstance.workflowFeedback()).toContain('published successfully');
    expect(routeValues).toEqual({ search: 'behavior', selected: testQuestion.id });
  });

  it('hands a published successor to the existing editor with normalized note', () => {
    const fixture = create({ selected: testQuestion.id });
    fixture.componentInstance.successorForm.controls.changeNote.setValue('  clarify evidence  ');
    fixture.componentInstance.createSuccessor(testQuestion);
    expect(facade.createQuestionSuccessor).toHaveBeenCalledWith(
      testQuestion.id,
      { changeNote: 'clarify evidence' },
      { expectedVersion: testQuestion.version }
    );
    expect(fixture.componentInstance.editorOpen()).toBe(true);
    expect(fixture.componentInstance.editingQuestionId()).toBe(testQuestion.id);
  });
  it('selects current-page rows, requires a valid action, and restores focus after cancellation', () => {
    const fixture = create();
    const component = fixture.componentInstance;
    component.toggleQuestionSelection(testQuestion, true);
    fixture.detectChanges();
    expect(component.selectedQuestionCount()).toBe(1);
    expect(fixture.nativeElement.querySelector('.bulk-action-bar')?.textContent).toContain('1 selected');
    expect(component.bulkSubmissionInvalid()).toBe(true);
    component.bulkActionForm.controls.tags.setValue('bulk');
    fixture.detectChanges();
    const reviewTrigger = fixture.nativeElement.querySelector('.bulk-action-bar button.primary-button') as HTMLButtonElement;
    reviewTrigger.focus();
    component.openBulkConfirmation();
    fixture.detectChanges();
    vi.runAllTimers();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).not.toBeNull();
    component.cancelBulkConfirmation();
    fixture.detectChanges();
    vi.runAllTimers();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(reviewTrigger);
    expect(component.liveMessage()).toContain('cancelled');
  });

  it('invokes bulk update once and keeps confirmation guarded while pending', () => {
    const fixture = create();
    const component = fixture.componentInstance;
    component.toggleQuestionSelection(testQuestion, true);
    component.bulkActionForm.controls.tags.setValue('bulk');
    fixture.detectChanges();
    component.openBulkConfirmation();
    fixture.detectChanges();
    vi.runAllTimers();

    component.confirmBulkAction();
    fixture.detectChanges();
    expect(facade.bulkUpdateQuestions).toHaveBeenCalledTimes(1);
    expect(component.workflowPending()).toBe(true);
    const confirmButton = fixture.nativeElement.querySelector('.bulk-dialog .primary-button') as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);
    component.confirmBulkAction();
    expect(facade.bulkUpdateQuestions).toHaveBeenCalledTimes(1);
    expect(component.bulkConfirmationOpen()).toBe(true);
  });

  it('closes after a mixed result, retains failed selection, announces partial failure, and restores focus', () => {
    const fixture = create();
    const component = fixture.componentInstance;
    component.toggleQuestionSelection(bulkReviewQuestion, true);
    component.toggleQuestionSelection(bulkArchivedQuestion, true);
    component.bulkActionForm.controls.tags.setValue('bulk');
    fixture.detectChanges();
    const reviewTrigger = fixture.nativeElement.querySelector('.bulk-action-bar button.primary-button') as HTMLButtonElement;
    reviewTrigger.focus();
    component.openBulkConfirmation();
    fixture.detectChanges();
    vi.runAllTimers();
    component.confirmBulkAction();

    const success = {
      kind: 'success' as const,
      id: bulkReviewQuestion.id,
      expectedVersion: bulkReviewQuestion.version,
      before: bulkReviewQuestion,
      after: bulkReviewQuestion,
      question: bulkReviewQuestion
    };
    const failure = {
      kind: 'failure' as const,
      id: bulkArchivedQuestion.id,
      expectedVersion: bulkArchivedQuestion.version,
      code: 'not-editable' as const,
      message: 'Archived questions cannot be changed.'
    };
    const result: QuestionBulkResult = {
      items: [success, failure],
      successes: [success],
      failures: [failure],
      counts: { total: 2, succeeded: 1, failed: 1 }
    };
    facade.bulkUpdateResult$.next(result);
    fixture.detectChanges();
    vi.runAllTimers();
    fixture.detectChanges();

    expect(component.bulkConfirmationOpen()).toBe(false);
    expect(component.workflowPending()).toBe(false);
    expect([...component.bulkSelectedIds()]).toEqual([bulkArchivedQuestion.id]);
    const feedback = fixture.nativeElement.querySelector('.bulk-feedback[role="status"]') as HTMLElement;
    expect(feedback.textContent).toContain('1 question failed');
    expect(feedback.getAttribute('aria-live')).toBe('polite');
    expect(fixture.nativeElement.querySelector('.bulk-failure-list')?.textContent).toContain(failure.message);
    expect(component.liveMessage()).toContain('failed rows remain selected');
    expect(document.activeElement).toBe(reviewTrigger);
  });

  it('restores focus after a bulk request error closes the dialog', () => {
    const fixture = create();
    const component = fixture.componentInstance;
    component.toggleQuestionSelection(testQuestion, true);
    component.bulkActionForm.controls.tags.setValue('bulk');
    fixture.detectChanges();
    const reviewTrigger = fixture.nativeElement.querySelector('.bulk-action-bar button.primary-button') as HTMLButtonElement;
    reviewTrigger.focus();
    component.openBulkConfirmation();
    fixture.detectChanges();
    vi.runAllTimers();
    component.confirmBulkAction();
    facade.bulkUpdateResult$.error(new Error('bulk request failed'));
    fixture.detectChanges();
    vi.runAllTimers();
    fixture.detectChanges();

    expect(component.bulkConfirmationOpen()).toBe(false);
    expect(component.bulkFeedback()).toContain('bulk request failed');
    expect(document.activeElement).toBe(reviewTrigger);
  });

});
