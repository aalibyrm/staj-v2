import { Inject, Injectable, InjectionToken, Optional, computed, signal, type Signal, type WritableSignal } from '@angular/core';
import { catchError, defer, interval, map, of, startWith, switchMap, tap, throwError, type Observable, type Subscription } from 'rxjs';

import { normalizeApplicationError } from '../../../core/api/api-error';
import {
  createReferenceTimeAnchor,
  selectReferenceTimeTimer,
  type ReferenceTimeSyncAnchor,
  type ReferenceTimeTimerSnapshot
} from '../domain/reference-time-timer';
import {
  EXAM_SESSION_TERMINAL_STATES,
  isExamSessionTerminalState
} from '../domain/exam-session-state-machine';
import {
  type ExamSession,
  type ExamSessionState
} from '../models/exam-session.models';
import { ExamSessionRepository, type ExamSessionRepositoryError } from './exam-session.repository';
import {
  asExamQuestionId,
  createAnswerDraft,
  createExamQuestion,
  deriveExamProgress,
  freezeAnswerDraftMap,
  isAnswerValueProvided,
  toggleAnswerDraftReview,
  updateAnswerDraft,
  type AnswerDraft,
  type AnswerDraftMap,
  type AnswerValue,
  type ExamProgress,
  type ExamQuestion,
  type ExamQuestionInput
} from '../models/answer-draft.models';

export type ExamSessionRequestStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error' | 'unauthorized';

export type ExamSessionRequestState = Readonly<{
  readonly status: ExamSessionRequestStatus;
  readonly message?: string;
  readonly retryable?: boolean;
}>;

export type ExamSessionQuestionSource = (session: ExamSession) => Observable<readonly ExamQuestionInput[]>;

export type ExamSessionLoadResult = Readonly<{
  readonly session: ExamSession;
  readonly questions: readonly ExamQuestion[];
}>;

export class ExamSessionFacadeError extends Error {
  override readonly name = 'ExamSessionFacadeError';

  constructor(
    readonly code: 'confirmation-required' | 'not-ready' | 'late-answer' | 'terminal',
    message: string
  ) {
    super(message);
  }
}

const DEFAULT_WARNING_THRESHOLD_MS = 5 * 60 * 1000;
const DEFAULT_ROUTE_TOKEN = 'session-token';
const DEFAULT_SESSION_DURATION_MS = 45 * 60 * 1000;

const defaultMonotonicNow = (): number => {
  const performance = globalThis.performance;
  if (performance === undefined || typeof performance.now !== 'function') {
    throw new ExamSessionFacadeError('not-ready', 'A monotonic clock is unavailable.');
  }
  return performance.now();
};

const defaultQuestionInputs = (): readonly ExamQuestionInput[] => Object.freeze([
  Object.freeze({
    id: 'workspace-question-1',
    order: 1,
    prompt: 'Which observation best supports the stated learning objective?',
    kind: 'single' as const,
    points: 1,
    options: Object.freeze([
      Object.freeze({ id: 'option-a', label: 'The observation is repeatable.' }),
      Object.freeze({ id: 'option-b', label: 'The observation is unrelated.' }),
      Object.freeze({ id: 'option-c', label: 'The observation is omitted.' })
    ])
  }),
  Object.freeze({
    id: 'workspace-question-2',
    order: 2,
    prompt: 'Select the evidence that should be reviewed before making a decision.',
    kind: 'multiple' as const,
    points: 1,
    options: Object.freeze([
      Object.freeze({ id: 'option-a', label: 'Recent evidence' }),
      Object.freeze({ id: 'option-b', label: 'Relevant evidence' }),
      Object.freeze({ id: 'option-c', label: 'Unrelated evidence' })
    ])
  }),
  Object.freeze({
    id: 'workspace-question-3',
    order: 3,
    prompt: 'Write one concise reason for checking assumptions during this task.',
    kind: 'text' as const,
    points: 1,
    options: Object.freeze([])
  }),
  Object.freeze({
    id: 'workspace-question-4',
    order: 4,
    prompt: 'Which action keeps a review process transparent?',
    kind: 'single' as const,
    points: 1,
    options: Object.freeze([
      Object.freeze({ id: 'option-a', label: 'Record the decision context.' }),
      Object.freeze({ id: 'option-b', label: 'Hide the decision context.' }),
      Object.freeze({ id: 'option-c', label: 'Skip the review.' })
    ])
  }),
  Object.freeze({
    id: 'workspace-question-5',
    order: 5,
    prompt: 'Name the next step you would take after identifying an unknown.',
    kind: 'text' as const,
    points: 1,
    options: Object.freeze([])
  })
]);

const defaultQuestionSource = (_session: ExamSession): Observable<readonly ExamQuestionInput[]> =>
  defer(() => of(defaultQuestionInputs()));

export const EXAM_SESSION_QUESTION_SOURCE = new InjectionToken<ExamSessionQuestionSource>(
  'EXAM_SESSION_QUESTION_SOURCE',
  { providedIn: 'root', factory: () => defaultQuestionSource }
);

export const EXAM_SESSION_MONOTONIC_NOW_SOURCE = new InjectionToken<() => number>(
  'EXAM_SESSION_MONOTONIC_NOW_SOURCE',
  { providedIn: 'root', factory: () => defaultMonotonicNow }
);

const freezeQuestions = (inputs: readonly ExamQuestionInput[]): readonly ExamQuestion[] => {
  const seen = new Set<string>();
  const normalized = inputs.map((input) => {
    const question = createExamQuestion(input);
    if (seen.has(question.id)) throw new Error(`Question id ${question.id} is duplicated.`);
    seen.add(question.id);
    return question;
  });
  normalized.sort((left, right) => left.order - right.order || String(left.id).localeCompare(String(right.id)));
  return Object.freeze(normalized);
};

const errorCode = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'code' in error ? String((error as { readonly code?: unknown }).code) : '';

const messageForError = (error: unknown): string => {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return 'The exam session could not be loaded. Try again.';
};

const requestStatusForError = (error: unknown): Extract<ExamSessionRequestStatus, 'error' | 'unauthorized'> => {
  const code = errorCode(error);
  return code === 'unauthorized' || normalizeApplicationError(error).kind === 'unauthorized' ? 'unauthorized' : 'error';
};

const nonterminal = (state: ExamSessionState): boolean => !EXAM_SESSION_TERMINAL_STATES.includes(state as (typeof EXAM_SESSION_TERMINAL_STATES)[number]);

@Injectable({ providedIn: 'root' })
export class ExamSessionFacade {
  private readonly repository: ExamSessionRepository;
  private readonly questionSource: ExamSessionQuestionSource;
  private readonly monotonicNowSource: () => number;
  private readonly requestStateState = signal<ExamSessionRequestState>({ status: 'idle' });
  private readonly sessionState = signal<ExamSession | null>(null);
  private readonly questionsState = signal<readonly ExamQuestion[]>(Object.freeze([]));
  private readonly currentIndexState = signal(0);
  private readonly draftsState = signal<readonly AnswerDraft[]>(Object.freeze([]));
  private readonly timerState = signal<ReferenceTimeTimerSnapshot | null>(null);
  private readonly actionState = signal<'idle' | 'loading' | 'error'>('idle');
  private readonly answerRevision = signal(0);
  private requestRevision = 0;
  private transitionRevision = 0;
  private lastRouteToken: string | null = null;
  private timerAnchor: ReferenceTimeSyncAnchor | null = null;
  private timerSubscription: Subscription | null = null;
  private expiryTransitionRequested = false;

  readonly requestState: Signal<ExamSessionRequestState> = this.requestStateState.asReadonly();
  readonly session: Signal<ExamSession | null> = this.sessionState.asReadonly();
  readonly questions: Signal<readonly ExamQuestion[]> = this.questionsState.asReadonly();
  readonly currentIndex: Signal<number> = this.currentIndexState.asReadonly();
  readonly drafts: Signal<readonly AnswerDraft[]> = this.draftsState.asReadonly();
  readonly answerDrafts: Signal<readonly AnswerDraft[]> = this.drafts;
  readonly timer: Signal<ReferenceTimeTimerSnapshot | null> = this.timerState.asReadonly();
  readonly actionStatus: Signal<'idle' | 'loading' | 'error'> = this.actionState.asReadonly();
  readonly currentQuestion: Signal<ExamQuestion | null>;
  readonly draftMap: Signal<AnswerDraftMap>;
  readonly progress: Signal<ExamProgress>;
  readonly answeredCount: Signal<number>;
  readonly unansweredCount: Signal<number>;
  readonly flaggedCount: Signal<number>;
  readonly isTerminal: Signal<boolean>;
  readonly isExpired: Signal<boolean>;
  readonly canAnswer: Signal<boolean>;
  readonly canSubmit: Signal<boolean>;
  readonly localDraftStatus: Signal<'none' | 'local'>;
  readonly liveStatus: Signal<string>;

  constructor(
    @Optional() repository: ExamSessionRepository | null = null,
    @Optional() @Inject(EXAM_SESSION_QUESTION_SOURCE) questionSource: ExamSessionQuestionSource | null = null,
    @Optional() @Inject(EXAM_SESSION_MONOTONIC_NOW_SOURCE) monotonicNowSource: (() => number) | null = null
  ) {
    this.repository = repository ?? new ExamSessionRepository({ tokenSource: () => DEFAULT_ROUTE_TOKEN });
    this.questionSource = questionSource ?? defaultQuestionSource;
    this.monotonicNowSource = monotonicNowSource ?? defaultMonotonicNow;

    this.currentQuestion = computed(() => this.questionsState()[this.currentIndexState()] ?? null);
    this.draftMap = computed(() => freezeAnswerDraftMap(this.draftsState()));
    this.progress = computed(() => deriveExamProgress(this.questionsState(), this.draftMap(), this.currentIndexState()));
    this.answeredCount = computed(() => this.progress().answered);
    this.unansweredCount = computed(() => this.progress().unanswered);
    this.flaggedCount = computed(() => this.progress().flagged);
    this.isTerminal = computed(() => {
      const state = this.sessionState()?.state;
      return state !== undefined && isExamSessionTerminalState(state);
    });
    this.isExpired = computed(() => this.timerState()?.expired === true || this.sessionState()?.state === 'expired');
    this.canAnswer = computed(() => {
      const state = this.sessionState()?.state;
      return state !== undefined && nonterminal(state) && !this.isExpired();
    });
    this.canSubmit = computed(() => {
      const state = this.sessionState()?.state;
      return state !== undefined && nonterminal(state) && !this.isExpired();
    });
    this.localDraftStatus = computed(() => this.answerRevision() === 0 ? 'none' : 'local');
    this.liveStatus = computed(() => {
      const timer = this.timerState();
      if (this.isExpired()) return 'Time has expired. Answers are locked.';
      if (timer?.warning) return `Time is running low: ${this.formatDuration(timer.remainingMs)} remaining.`;
      if (this.localDraftStatus() === 'local') return 'Local answer draft updated.';
      return '';
    });

    if (repository === null) this.seedSmokeSession();
  }

  ngOnDestroy(): void {
    this.timerSubscription?.unsubscribe();
    this.timerSubscription = null;
  }

  load(routeToken: string): Observable<ExamSessionLoadResult> {
    const token = routeToken.trim();
    const revision = ++this.requestRevision;
    this.lastRouteToken = token;
    this.requestStateState.set({ status: 'loading' });
    this.sessionState.set(null);
    this.questionsState.set(Object.freeze([]));
    this.draftsState.set(Object.freeze([]));
    this.currentIndexState.set(0);
    this.timerState.set(null);
    this.timerAnchor = null;
    this.expiryTransitionRequested = false;
    if (token.length === 0) {
      const error = new ExamSessionFacadeError('not-ready', 'An exam session token is required.');
      this.requestStateState.set({ status: 'error', message: error.message, retryable: false });
      return throwError(() => error);
    }

    return this.repository.resolveByToken(token).pipe(
      switchMap((session) => this.activateIfCreated(session)),
      switchMap((session) => this.questionSource(session).pipe(map((questionInputs) => ({ session, questionInputs })))),
      map(({ session, questionInputs }) => Object.freeze({ session, questions: freezeQuestions(questionInputs) })),
      tap((result) => {
        if (revision !== this.requestRevision) return;
        this.applyLoadedResult(result);
      }),
      catchError((error: unknown) => {
        if (revision === this.requestRevision) {
          this.requestStateState.set({ status: requestStatusForError(error), message: messageForError(error), retryable: true });
          this.sessionState.set(null);
          this.questionsState.set(Object.freeze([]));
          this.draftsState.set(Object.freeze([]));
        }
        return throwError(() => error);
      })
    );
  }

  retry(): Observable<ExamSessionLoadResult> {
    return this.lastRouteToken === null ? throwError(() => new ExamSessionFacadeError('not-ready', 'There is no exam session to retry.')) : this.load(this.lastRouteToken);
  }

  navigateTo(index: number): boolean {
    if (this.questionsState().length === 0 || this.isTerminal()) return false;
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.questionsState().length) return false;
    this.currentIndexState.set(index);
    return true;
  }

  goPrevious(): boolean {
    return this.navigateTo(this.currentIndexState() - 1);
  }

  goNext(): boolean {
    return this.navigateTo(this.currentIndexState() + 1);
  }

  updateAnswer(questionId: string, value: AnswerValue): boolean {
    this.refreshTimer();
    if (!this.canAnswer()) return false;
    const index = this.draftsState().findIndex((draft) => draft.questionId === questionId);
    if (index < 0) return false;
    const previous = this.draftsState()[index];
    const next = updateAnswerDraft(previous, value);
    if (previous.value === next.value && previous.answered === next.answered) return true;
    const nextDrafts = [...this.draftsState()];
    nextDrafts[index] = next;
    this.draftsState.set(Object.freeze(nextDrafts));
    this.answerRevision.update((revision) => revision + 1);
    return true;
  }

  toggleReview(questionId: string): boolean {
    if (!this.canAnswer()) return false;
    const index = this.draftsState().findIndex((draft) => draft.questionId === questionId);
    if (index < 0) return false;
    const nextDrafts = [...this.draftsState()];
    nextDrafts[index] = toggleAnswerDraftReview(nextDrafts[index]);
    this.draftsState.set(Object.freeze(nextDrafts));
    this.answerRevision.update((revision) => revision + 1);
    return true;
  }

  transition(nextState: ExamSessionState): Observable<ExamSession> {
    const session = this.sessionState();
    if (session === null) return throwError(() => new ExamSessionFacadeError('not-ready', 'The exam session is not loaded.'));
    if (isExamSessionTerminalState(session.state)) return throwError(() => new ExamSessionFacadeError('terminal', 'The exam session is already finished.'));
    const revision = ++this.transitionRevision;
    this.actionState.set('loading');
    return this.repository.transition(session.routeToken, nextState, { expectedVersion: session.version }).pipe(
      tap((updated) => {
        if (revision !== this.transitionRevision) return;
        this.sessionState.set(updated);
        this.actionState.set('idle');
        if (isExamSessionTerminalState(updated.state)) this.timerSubscription?.unsubscribe();
      }),
      catchError((error: unknown) => {
        if (revision === this.transitionRevision) this.actionState.set('error');
        return throwError(() => error);
      })
    );
  }

  submit(confirmed = false): Observable<ExamSession> {
    if (!confirmed) return throwError(() => new ExamSessionFacadeError('confirmation-required', 'Confirmation is required before submission.'));
    this.refreshTimer();
    if (!this.canSubmit()) return throwError(() => new ExamSessionFacadeError('terminal', 'The exam session cannot be submitted.'));
    return this.transition('submitted');
  }

  refreshTimer(monotonicNowMs = this.monotonicNowSource()): ReferenceTimeTimerSnapshot | null {
    const session = this.sessionState();
    const anchor = this.timerAnchor;
    if (session === null || anchor === null) return null;
    const selected = selectReferenceTimeTimer({
      anchor,
      monotonicNowMs,
      sessionStartReferenceTime: session.referenceTime,
      durationMs: session.durationMs,
      warningThresholdMs: DEFAULT_WARNING_THRESHOLD_MS
    });
    this.timerState.set(selected);
    if (selected.expired && !this.expiryTransitionRequested && nonterminal(session.state)) {
      this.expiryTransitionRequested = true;
      this.transition('expired').subscribe({ error: () => undefined });
    }
    return selected;
  }

  draftFor(questionId: string): AnswerDraft | undefined {
    return this.draftMap()[questionId];
  }

  isQuestionAnswered(questionId: string): boolean {
    return isAnswerValueProvided(this.draftFor(questionId)?.value);
  }

  private applyLoadedResult(result: ExamSessionLoadResult): void {
    this.sessionState.set(result.session);
    this.questionsState.set(result.questions);
    this.currentIndexState.set(0);
    const drafts = result.questions.map((question) => createAnswerDraft(question.id));
    this.draftsState.set(Object.freeze(drafts));
    this.answerRevision.set(0);
    this.timerAnchor = createReferenceTimeAnchor(Date.parse(result.session.referenceTime), this.monotonicNowSource());
    this.timerState.set(selectReferenceTimeTimer({
      anchor: this.timerAnchor,
      monotonicNowMs: this.timerAnchor.monotonicObservedMs,
      sessionStartReferenceTime: result.session.referenceTime,
      durationMs: result.session.durationMs,
      warningThresholdMs: DEFAULT_WARNING_THRESHOLD_MS
    }));
    this.requestStateState.set({
      status: result.questions.length === 0 ? 'empty' : 'ready',
      ...(result.questions.length === 0 ? { message: 'This exam has no questions.' } : {})
    });
    this.timerSubscription?.unsubscribe();
    this.timerSubscription = interval(500).pipe(startWith(0), tap(() => this.refreshTimer())).subscribe();
  }

  private activateIfCreated(session: ExamSession): Observable<ExamSession> {
    return session.state === 'created'
      ? this.repository.transition(session.routeToken, 'active', { expectedVersion: session.version })
      : of(session);
  }

  private seedSmokeSession(): void {
    const snapshot = this.repository.getSnapshot();
    if (snapshot.sessions.some((session) => session.routeToken === DEFAULT_ROUTE_TOKEN)) return;
    this.repository.open({
      routeToken: DEFAULT_ROUTE_TOKEN,
      studentId: 'student-smoke',
      examId: 'exam-smoke',
      durationMs: DEFAULT_SESSION_DURATION_MS
    }).pipe(
      switchMap((session) => this.repository.transition(session.routeToken, 'active', { expectedVersion: session.version }))
    ).subscribe({ error: () => undefined });
  }

  private formatDuration(durationMs: number): string {
    const totalSeconds = Math.ceil(durationMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
}
