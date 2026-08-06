import { Inject, Injectable, InjectionToken, Optional, computed, signal, type Signal, type WritableSignal } from '@angular/core';
import { Subject, catchError, debounceTime, defer, firstValueFrom, from, groupBy, interval, map, mergeMap, of, startWith, switchMap, tap, throwError, type Observable, type Subscription } from 'rxjs';

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
import { PlatformEventBus, PlatformState, type PlatformConnectivity } from '../../../core/state/platform-state';
import { OfflineAnswerQueue, type OfflineAnswerQueueEnqueueInput } from './offline-answer-queue';
import type { OfflineAnswerQueueRecord } from '../models/offline-answer-queue.models';
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
export type ExamSessionAutosaveState = Readonly<{
  readonly status: ExamSessionAutosaveStatus;
  readonly message: string;
  readonly retryable: boolean;
  readonly savedAt: string | null;
}>;


export type ExamSessionAutosaveStatus = 'idle' | 'saving' | 'saved' | 'conflict' | 'error';

export type ExamSessionAutosaveConflict = Readonly<{
  readonly sessionId: string;
  readonly questionId: string;
  readonly loadRevision: number;
  readonly localRevision: number;
  readonly localDraft: AnswerDraft;
  readonly serverDraft: AnswerDraft;
  readonly origin: 'autosave' | 'offline-replay';
  readonly operationId: string | null;
  readonly resolutionStatus: 'idle' | 'resolving';
  readonly resolutionError: string | null;
}>;

export const EXAM_SESSION_AUTOSAVE_DEBOUNCE_MS = 300;

type AutosaveRequest = Readonly<{
  readonly sessionId: string;
  readonly questionId: string;
  readonly draft: AnswerDraft;
  readonly revision: number;
  readonly loadRevision: number;
}>;

type AutosaveResult = Readonly<{
  readonly request: AutosaveRequest;
  readonly persisted?: AnswerDraft;
  readonly queued?: OfflineAnswerQueueRecord;
  readonly error?: unknown;
}>;

const createAutosaveState = (
  status: ExamSessionAutosaveStatus,
  message = '',
  retryable = false,
  savedAt: string | null = null
): ExamSessionAutosaveState => Object.freeze({ status, message, retryable, savedAt });

const autosaveErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message.trim().length > 0 ? error.message : 'Answer draft could not be saved.';

export type ExamSessionQuestionSource = (session: ExamSession) => Observable<readonly ExamQuestionInput[]>;

export type ExamSessionLoadResult = Readonly<{
  readonly session: ExamSession;
  readonly questions: readonly ExamQuestion[];
}>;

export class ExamSessionFacadeError extends Error {
  override readonly name = 'ExamSessionFacadeError';

  constructor(
    readonly code: 'confirmation-required' | 'not-ready' | 'late-answer' | 'pending-sync' | 'terminal',
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

const errorProperty = (error: unknown, property: 'code' | 'reason'): unknown => {
  if (typeof error !== 'object' || error === null || !(property in error)) return undefined;
  return Reflect.get(error, property);
};

const errorCode = (error: unknown): string => String(errorProperty(error, 'code') ?? '');
const errorReason = (error: unknown): string => String(errorProperty(error, 'reason') ?? '');

const isStaleAnswerConflict = (error: unknown): boolean =>
  errorCode(error) === 'conflict' && errorReason(error) === 'stale-version';

const createAutosaveConflict = (
  sessionId: string,
  questionId: string,
  loadRevision: number,
  localRevision: number,
  localDraft: AnswerDraft,
  serverDraft: AnswerDraft,
  origin: ExamSessionAutosaveConflict['origin'],
  operationId: string | null,
  resolutionStatus: ExamSessionAutosaveConflict['resolutionStatus'] = 'idle',
  resolutionError: string | null = null
): ExamSessionAutosaveConflict => Object.freeze({
  sessionId,
  questionId,
  loadRevision,
  localRevision,
  localDraft,
  serverDraft,
  origin,
  operationId,
  resolutionStatus,
  resolutionError
});


const messageForError = (error: unknown): string => {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return 'The exam session could not be loaded. Try again.';
};

const requestStatusForError = (error: unknown): Extract<ExamSessionRequestStatus, 'error' | 'unauthorized'> => {
  const code = errorCode(error);
  return code === 'unauthorized' || normalizeApplicationError(error).kind === 'unauthorized' ? 'unauthorized' : 'error';
};

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

const nonterminal = (state: ExamSessionState): boolean => !EXAM_SESSION_TERMINAL_STATES.includes(state as (typeof EXAM_SESSION_TERMINAL_STATES)[number]);
const answerValuesEqual = (left: AnswerValue, right: AnswerValue): boolean => {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => value === right[index]);
  }
  return left === right;
};

const equivalentPersistedDraft = (
  queued: OfflineAnswerQueueRecord,
  persisted: AnswerDraft
): boolean =>
  persisted.questionId === queued.questionId &&
  persisted.version >= queued.expectedVersion + 1 &&
  persisted.flagged === queued.draft.flagged &&
  answerValuesEqual(persisted.value, queued.draft.value);


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
  private readonly autosaveStateState = signal<ExamSessionAutosaveState>(createAutosaveState('idle'));
  private readonly autosaveConflictState = signal<ExamSessionAutosaveConflict | null>(null);
  private autosaveConflictRevision = 0;
  private autosaveConflictRetryAction: 'use-server' | 'keep-local' | null = null;
  private autosaveRequests = new Subject<AutosaveRequest>();
  private autosaveSubscription: Subscription | null = null;
  private autosaveRetrySnapshot: AutosaveRequest | null = null;
  private requestRevision = 0;
  private transitionRevision = 0;
  private lastRouteToken: string | null = null;
  private timerAnchor: ReferenceTimeSyncAnchor | null = null;
  private timerSubscription: Subscription | null = null;
  private expiryTransitionRequested = false;
  private readonly offlineQueue: OfflineAnswerQueue;
  private readonly platformState: PlatformState;
  private readonly platformEventBus: PlatformEventBus;
  private readonly queueCountState = signal(0);
  private readonly replayErrorState = signal<string | null>(null);
  private readonly replayingState = signal(false);
  private platformSubscription: Subscription | null = null;
  private replayPromise: Promise<void> | null = null;
  private destroyed = false;
  readonly autosaveConflict: Signal<ExamSessionAutosaveConflict | null> = this.autosaveConflictState.asReadonly();

  readonly requestState: Signal<ExamSessionRequestState> = this.requestStateState.asReadonly();
  readonly autosaveState: Signal<ExamSessionAutosaveState> = this.autosaveStateState.asReadonly();
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
  readonly queuedAnswerCount: Signal<number>;
  readonly offlineQueueCount: Signal<number>;
  readonly connectivity: Signal<PlatformConnectivity>;
  readonly isOffline: Signal<boolean>;
  readonly isReconnecting: Signal<boolean>;
  readonly isReplaying: Signal<boolean>;
  readonly replayError: Signal<string | null>;

  constructor(
    @Optional() repository: ExamSessionRepository | null = null,
    @Optional() @Inject(EXAM_SESSION_QUESTION_SOURCE) questionSource: ExamSessionQuestionSource | null = null,
    @Optional() @Inject(EXAM_SESSION_MONOTONIC_NOW_SOURCE) monotonicNowSource: (() => number) | null = null,
    @Optional() offlineQueue: OfflineAnswerQueue | null = null,
    @Optional() platformState: PlatformState | null = null,
    @Optional() platformEventBus: PlatformEventBus | null = null
  ) {
    this.offlineQueue = offlineQueue ?? new OfflineAnswerQueue();
    this.platformEventBus = platformEventBus ?? new PlatformEventBus();
    this.platformState = platformState ?? new PlatformState(this.platformEventBus);
    this.repository = repository ?? new ExamSessionRepository({ tokenSource: () => DEFAULT_ROUTE_TOKEN });
    this.questionSource = questionSource ?? defaultQuestionSource;
    this.monotonicNowSource = monotonicNowSource ?? defaultMonotonicNow;
    this.queuedAnswerCount = this.queueCountState.asReadonly();
    this.offlineQueueCount = this.queuedAnswerCount;
    this.replayError = this.replayErrorState.asReadonly();
    this.isReplaying = this.replayingState.asReadonly();
    this.connectivity = computed(() => {
      const connectivity = this.platformState.state().connectivity;
      return connectivity === 'offline'
        ? 'offline'
        : this.replayingState() || this.queueCountState() > 0
          ? 'reconnecting'
          : connectivity;
    });
    this.isOffline = computed(() => this.connectivity() === 'offline');
    this.isReconnecting = computed(() => this.connectivity() === 'reconnecting');
    this.platformSubscription = this.platformEventBus.events$.subscribe((event) => this.onPlatformEvent(event));
    this.startAutosavePipeline();
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
      return state !== undefined && nonterminal(state) && !this.isExpired() &&
        this.queuedAnswerCount() === 0 && !this.isReplaying();
    });
    this.localDraftStatus = computed(() => this.answerRevision() === 0 ? 'none' : 'local');
    this.liveStatus = computed(() => {
      const conflict = this.autosaveConflictState();
      if (conflict !== null) {
        if (conflict.resolutionStatus === 'resolving') return 'Resolving answer conflict.';
        if (conflict.resolutionError !== null) return `Answer conflict resolution failed: ${conflict.resolutionError}`;
        return 'Answer changed elsewhere. Choose the local or server answer.';
      }
      if (this.replayError() !== null) return `Queued answer sync error: ${this.replayError()}`;
      if (this.isOffline()) return `Offline — ${this.queuedAnswerCount()} answer(s) queued`;
      if (this.isReconnecting()) return `Reconnecting — syncing ${this.queuedAnswerCount()} answer(s)`;
      const timer = this.timerState();
      if (this.isExpired()) return 'Time has expired. Answers are locked.';
      if (timer?.warning) return `Time is running low: ${this.formatDuration(timer.remainingMs)} remaining.`;
      if (this.localDraftStatus() === 'local') return 'Local answer draft updated.';
      return '';
    });

    if (repository === null) this.seedSmokeSession();
  }

  ngOnDestroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.platformSubscription?.unsubscribe();
    this.platformSubscription = null;
    this.timerSubscription?.unsubscribe();
    this.timerSubscription = null;
    this.autosaveSubscription?.unsubscribe();
    this.autosaveSubscription = null;
    this.autosaveRequests.complete();
    this.autosaveConflictRevision += 1;
    this.autosaveConflictState.set(null);
    this.autosaveConflictRetryAction = null;
    this.autosaveRetrySnapshot = null;
  }

  load(routeToken: string): Observable<ExamSessionLoadResult> {
    if (this.destroyed) return throwError(() => new ExamSessionFacadeError('not-ready', 'The exam session has been destroyed.'));
    const token = routeToken.trim();
    const revision = ++this.requestRevision;
    this.autosaveConflictRevision += 1;
    this.autosaveConflictState.set(null);
    this.autosaveConflictRetryAction = null;
    this.resetAutosavePipeline();
    this.autosaveRetrySnapshot = null;
    this.platformState.setPendingOperations(0);
    this.replayErrorState.set(null);
    this.autosaveStateState.set(createAutosaveState('idle'));
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
      switchMap(({ session, questionInputs }) => this.repository.listDrafts(session.id).pipe(
        map((drafts) => ({ session, questionInputs, drafts }))
      )),
      map(({ session, questionInputs, drafts }) => Object.freeze({
        result: Object.freeze({ session, questions: freezeQuestions(questionInputs) }),
        drafts
      })),
      tap(({ result, drafts }) => {
        if (revision !== this.requestRevision) return;
        this.applyLoadedResult(result, drafts);
        void this.refreshQueueState(result.session.id, revision, 0);
      }),
      map(({ result }) => result),
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
    const revision = this.answerRevision() + 1;
    this.answerRevision.set(revision);
    this.queueAutosave(questionId, next, revision);
    return true;
  }

  toggleReview(questionId: string): boolean {
    if (!this.canAnswer()) return false;
    const index = this.draftsState().findIndex((draft) => draft.questionId === questionId);
    if (index < 0) return false;
    const nextDrafts = [...this.draftsState()];
    const next = toggleAnswerDraftReview(nextDrafts[index]);
    nextDrafts[index] = next;
    this.draftsState.set(Object.freeze(nextDrafts));
    const revision = this.answerRevision() + 1;
    this.answerRevision.set(revision);
    this.queueAutosave(questionId, next, revision);
    return true;
  }

  retryAutosave(): boolean {
    const conflict = this.autosaveConflictState();
    if (conflict !== null && conflict.resolutionError !== null && this.autosaveConflictRetryAction !== null) {
      if (this.autosaveConflictRetryAction === 'use-server') void this.useServerAnswer();
      else void this.keepLocalAnswer();
      return true;
    }
    const snapshot = this.autosaveRetrySnapshot;
    const session = this.sessionState();
    if (snapshot === null || session === null || snapshot.sessionId !== session.id ||
      snapshot.loadRevision !== this.requestRevision || snapshot.revision !== this.answerRevision()) {
      return false;
    }
    this.autosaveStateState.set(createAutosaveState('saving', 'Saving', false, snapshot.draft.savedAt));
    this.autosaveRequests.next(snapshot);
    return true;
  }

  async useServerAnswer(): Promise<boolean> {
    const conflict = this.autosaveConflictState();
    const session = this.sessionState();
    const local = conflict === null ? undefined : this.draftFor(conflict.questionId);
    if (session === null || conflict === null || local === undefined ||
      conflict.resolutionStatus === 'resolving' || conflict.sessionId !== session.id ||
      conflict.loadRevision !== this.requestRevision) return false;
    const actionRevision = ++this.autosaveConflictRevision;
    const localRevision = this.answerRevision();
    const resolving = createAutosaveConflict(
      conflict.sessionId, conflict.questionId, conflict.loadRevision, localRevision,
      local, conflict.serverDraft, conflict.origin, conflict.operationId, 'resolving'
    );
    this.autosaveConflictRetryAction = 'use-server';
    this.publishAutosaveConflict(resolving);
    try {
      if (conflict.origin === 'offline-replay' && conflict.operationId !== null) {
        await this.offlineQueue.remove(conflict.operationId);
      }
    } catch (error: unknown) {
      this.retainConflictError(resolving, 'use-server', error);
      return false;
    }
    if (!this.isCurrentConflictAction(resolving, actionRevision, localRevision)) {
      this.retainLateConflict(resolving);
      return false;
    }
    this.replaceDraftWith(conflict.questionId, conflict.serverDraft);
    this.autosaveConflictRevision += 1;
    this.autosaveConflictState.set(null);
    this.autosaveConflictRetryAction = null;
    this.autosaveStateState.set(createAutosaveState('saved', 'Saved', false, conflict.serverDraft.savedAt));
    if (conflict.origin === 'offline-replay') {
      void this.refreshQueueState(session.id, this.requestRevision, this.answerRevision());
      this.startReplay(session.id);
    }
    return true;
  }

  async keepLocalAnswer(): Promise<boolean> {
    const conflict = this.autosaveConflictState();
    const session = this.sessionState();
    const local = conflict === null ? undefined : this.draftFor(conflict.questionId);
    if (session === null || conflict === null || local === undefined ||
      conflict.resolutionStatus === 'resolving' || conflict.sessionId !== session.id ||
      conflict.loadRevision !== this.requestRevision) return false;
    const actionRevision = ++this.autosaveConflictRevision;
    const localRevision = this.answerRevision();
    const resolving = createAutosaveConflict(
      conflict.sessionId, conflict.questionId, conflict.loadRevision, localRevision,
      local, conflict.serverDraft, conflict.origin, conflict.operationId, 'resolving'
    );
    this.autosaveConflictRetryAction = 'keep-local';
    this.publishAutosaveConflict(resolving);
    const draft = createAnswerDraft(conflict.questionId, local.value, local.flagged, {
      version: conflict.serverDraft.version,
      savedAt: local.savedAt
    });
    let persisted: AnswerDraft;
    try {
      persisted = await firstValueFrom(this.repository.saveDraft(
        conflict.sessionId,
        conflict.questionId,
        draft,
        { expectedVersion: conflict.serverDraft.version }
      ));
    } catch (error: unknown) {
      if (isStaleAnswerConflict(error)) {
        await this.refreshConflictAfterRace(resolving, 'keep-local');
      } else {
        this.retainConflictError(resolving, 'keep-local', error);
      }
      return false;
    }
    if (!this.isCurrentConflictAction(resolving, actionRevision, localRevision)) {
      this.retainLateConflict(resolving, persisted);
      return false;
    }
    try {
      if (conflict.origin === 'offline-replay' && conflict.operationId !== null) {
        await this.offlineQueue.remove(conflict.operationId);
      }
    } catch (error: unknown) {
      this.retainConflictError(
        createAutosaveConflict(
          conflict.sessionId, conflict.questionId, conflict.loadRevision, localRevision,
          local, persisted, conflict.origin, conflict.operationId
        ),
        'keep-local',
        error
      );
      return false;
    }
    if (!this.isCurrentConflictAction(resolving, actionRevision, localRevision)) {
      this.retainLateConflict(resolving, persisted);
      return false;
    }
    this.replaceDraftWith(conflict.questionId, persisted);
    this.autosaveConflictRevision += 1;
    this.autosaveConflictState.set(null);
    this.autosaveConflictRetryAction = null;
    this.autosaveStateState.set(createAutosaveState('saved', 'Saved', false, persisted.savedAt));
    if (conflict.origin === 'offline-replay') {
      void this.refreshQueueState(session.id, this.requestRevision, this.answerRevision());
      this.startReplay(session.id);
    }
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
    if (this.queuedAnswerCount() > 0 || this.isReplaying()) {
      return throwError(() => new ExamSessionFacadeError(
        'pending-sync',
        'Answers are still synchronizing. Wait for synchronization to finish before submitting.'
      ));
    }
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

  private applyLoadedResult(result: ExamSessionLoadResult, persistedDrafts: readonly AnswerDraft[]): void {
    this.sessionState.set(result.session);
    this.questionsState.set(result.questions);
    this.currentIndexState.set(0);
    const persistedByQuestion = new Map(persistedDrafts.map((draft) => [draft.questionId, draft] as const));
    const drafts = result.questions.map((question) => persistedByQuestion.get(question.id) ?? createAnswerDraft(question.id));
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

  private queueAutosave(questionId: string, draft: AnswerDraft, revision: number): void {
    const session = this.sessionState();
    if (session === null) return;
    const conflict = this.autosaveConflictState();
    if (conflict?.questionId === questionId && conflict.sessionId === session.id) {
      this.autosaveConflictRevision += 1;
      this.autosaveConflictRetryAction = null;
      this.autosaveConflictState.set(createAutosaveConflict(
        conflict.sessionId,
        conflict.questionId,
        conflict.loadRevision,
        revision,
        draft,
        conflict.serverDraft,
        conflict.origin,
        conflict.operationId
      ));
      this.publishAutosaveConflict(this.autosaveConflictState()!);
      return;
    }
    this.autosaveRetrySnapshot = null;
    if (conflict === null) this.autosaveStateState.set(createAutosaveState('idle', '', false, draft.savedAt));
    this.autosaveRequests.next(Object.freeze({
      sessionId: session.id,
      questionId,
      draft,
      revision,
      loadRevision: this.requestRevision
    }));
  }

  private startAutosavePipeline(): void {
    this.autosaveSubscription = this.autosaveRequests.pipe(
      groupBy((request) => request.questionId),
      mergeMap((requests) => requests.pipe(
        debounceTime(EXAM_SESSION_AUTOSAVE_DEBOUNCE_MS),
        switchMap((request) => this.saveAutosave(request))
      ))
    ).subscribe((result) => this.applyAutosaveResult(result));
  }

  private saveAutosave(request: AutosaveRequest): Observable<AutosaveResult> {
    const session = this.sessionState();
    const current = this.draftFor(request.questionId);
    if (session === null || session.id !== request.sessionId || request.loadRevision !== this.requestRevision ||
      current === undefined || this.autosaveConflictState()?.questionId === request.questionId) return of({ request });
    const effectiveRequest = request.revision === this.answerRevision()
      ? Object.freeze({ ...request, draft: current })
      : request;
    if (this.autosaveConflictState() === null) {
      this.autosaveStateState.set(createAutosaveState('saving', 'Saving', false, current.savedAt));
    }
    const queueInput: OfflineAnswerQueueEnqueueInput = {
      sessionId: effectiveRequest.sessionId,
      questionId: effectiveRequest.questionId,
      draft: effectiveRequest.draft,
      expectedVersion: effectiveRequest.draft.version
    };
    if (this.connectivity() !== 'online' || this.isReplaying()) {
      return from(this.offlineQueue.enqueue(queueInput)).pipe(
        map((queued) => ({ request: effectiveRequest, queued })),
        catchError((error: unknown) => of({ request: effectiveRequest, error }))
      );
    }
    return this.repository.saveDraft(
      effectiveRequest.sessionId,
      effectiveRequest.questionId,
      effectiveRequest.draft,
      { expectedVersion: effectiveRequest.draft.version }
    ).pipe(
      map((persisted) => ({ request: effectiveRequest, persisted })),
      catchError((error: unknown) => of({ request: effectiveRequest, error }))
    );
  }

  private applyAutosaveResult(result: AutosaveResult): void {
    const session = this.sessionState();
    if (session === null || session.id !== result.request.sessionId ||
      result.request.loadRevision !== this.requestRevision) return;
    const index = this.draftsState().findIndex((draft) => draft.questionId === result.request.questionId);
    if (index < 0) return;
    const current = this.draftsState()[index];
    if (result.queued !== undefined) {
      void this.refreshQueueState(session.id, result.request.loadRevision, result.request.revision);
      if (result.request.revision === this.answerRevision() && this.autosaveConflictState() === null) {
        this.autosaveRetrySnapshot = null;
        this.autosaveStateState.set(createAutosaveState('saving', 'Queued offline', false, current.savedAt));
      }
      return;
    }
    if (result.request.revision !== this.answerRevision() || this.autosaveConflictState()?.questionId === result.request.questionId) return;
    if (result.persisted !== undefined) {
      if (result.persisted.version >= current.version) {
        const nextDrafts = [...this.draftsState()];
        nextDrafts[index] = createAnswerDraft(
          current.questionId,
          current.value,
          current.flagged,
          result.persisted.version,
          result.persisted.savedAt
        );
        this.draftsState.set(Object.freeze(nextDrafts));
      }
      if (this.queuedAnswerCount() === 0) {
        this.autosaveRetrySnapshot = null;
        this.autosaveStateState.set(createAutosaveState('saved', 'Saved', false, result.persisted.savedAt));
      }
      return;
    }
    if (result.error === undefined) return;
    if (isStaleAnswerConflict(result.error)) {
      this.openAutosaveConflict(result.request);
      return;
    }
    this.autosaveRetrySnapshot = result.request;
    this.autosaveStateState.set(createAutosaveState(
      'error',
      autosaveErrorMessage(result.error),
      true,
      current.savedAt
    ));
  }

  private publishAutosaveConflict(conflict: ExamSessionAutosaveConflict): void {
    this.autosaveConflictState.set(conflict);
    if (conflict.resolutionError !== null) {
      this.autosaveStateState.set(createAutosaveState('error', conflict.resolutionError, true, conflict.localDraft.savedAt));
    } else if (conflict.resolutionStatus === 'resolving') {
      this.autosaveStateState.set(createAutosaveState('saving', 'Resolving conflict', false, conflict.localDraft.savedAt));
    } else {
      this.autosaveStateState.set(createAutosaveState('conflict', 'Choose the local or server answer.', false, conflict.localDraft.savedAt));
    }
  }

  private openAutosaveConflict(request: AutosaveRequest): void {
    const session = this.sessionState();
    const local = this.draftFor(request.questionId);
    if (session === null || local === undefined || request.revision !== this.answerRevision()) return;
    const conflictRevision = ++this.autosaveConflictRevision;
    this.repository.listDrafts(session.id).subscribe({
      next: (drafts) => {
        if (this.destroyed || conflictRevision !== this.autosaveConflictRevision ||
          this.sessionState()?.id !== request.sessionId || request.loadRevision !== this.requestRevision ||
          request.revision !== this.answerRevision()) return;
        const current = this.draftFor(request.questionId);
        if (current === undefined) return;
        const server = drafts.find((draft) => draft.questionId === request.questionId) ?? createAnswerDraft(request.questionId);
        this.autosaveRetrySnapshot = null;
        this.autosaveConflictRetryAction = null;
        this.publishAutosaveConflict(createAutosaveConflict(
          request.sessionId, request.questionId, request.loadRevision, request.revision,
          current, server, 'autosave', null
        ));
      },
      error: (error: unknown) => {
        if (this.destroyed || conflictRevision !== this.autosaveConflictRevision ||
          this.sessionState()?.id !== request.sessionId || request.loadRevision !== this.requestRevision ||
          request.revision !== this.answerRevision()) return;
        this.autosaveRetrySnapshot = request;
        this.autosaveStateState.set(createAutosaveState('error', autosaveErrorMessage(error), true, local.savedAt));
      }
    });
  }

  private isCurrentConflictAction(
    conflict: ExamSessionAutosaveConflict,
    actionRevision: number,
    localRevision: number
  ): boolean {
    const current = this.autosaveConflictState();
    return !this.destroyed &&
      current !== null &&
      current.sessionId === conflict.sessionId &&
      current.questionId === conflict.questionId &&
      current.loadRevision === conflict.loadRevision &&
      current.resolutionStatus === 'resolving' &&
      this.autosaveConflictRevision === actionRevision &&
      this.answerRevision() === localRevision &&
      this.sessionState()?.id === conflict.sessionId &&
      this.requestRevision === conflict.loadRevision;
  }

  private retainConflictError(
    conflict: ExamSessionAutosaveConflict,
    action: 'use-server' | 'keep-local',
    error: unknown
  ): void {
    const current = this.autosaveConflictState();
    const local = this.draftFor(conflict.questionId);
    if (current === null || local === undefined || current.sessionId !== conflict.sessionId ||
      current.questionId !== conflict.questionId || this.sessionState()?.id !== conflict.sessionId ||
      this.requestRevision !== conflict.loadRevision) return;
    this.autosaveConflictRevision += 1;
    this.autosaveConflictRetryAction = action;
    this.publishAutosaveConflict(createAutosaveConflict(
      current.sessionId, current.questionId, current.loadRevision, this.answerRevision(),
      local, current.serverDraft, current.origin, current.operationId, 'idle', autosaveErrorMessage(error)
    ));
  }

  private retainLateConflict(
    conflict: ExamSessionAutosaveConflict,
    serverDraft = conflict.serverDraft
  ): void {
    const current = this.autosaveConflictState();
    const local = this.draftFor(conflict.questionId);
    if (current === null || local === undefined || current.sessionId !== conflict.sessionId ||
      current.questionId !== conflict.questionId || this.sessionState()?.id !== conflict.sessionId ||
      this.requestRevision !== conflict.loadRevision) return;
    this.autosaveConflictRevision += 1;
    this.autosaveConflictRetryAction = null;
    this.publishAutosaveConflict(createAutosaveConflict(
      current.sessionId, current.questionId, current.loadRevision, this.answerRevision(),
      local, serverDraft, current.origin, current.origin === 'offline-replay' ? null : current.operationId
    ));
  }

  private async refreshConflictAfterRace(
    conflict: ExamSessionAutosaveConflict,
    action: 'use-server' | 'keep-local'
  ): Promise<void> {
    try {
      const drafts = await firstValueFrom(this.repository.listDrafts(conflict.sessionId));
      const current = this.autosaveConflictState();
      const local = this.draftFor(conflict.questionId);
      if (current === null || local === undefined || current.sessionId !== conflict.sessionId ||
        current.questionId !== conflict.questionId || this.sessionState()?.id !== conflict.sessionId ||
        this.requestRevision !== conflict.loadRevision) return;
      this.autosaveConflictRevision += 1;
      this.autosaveConflictRetryAction = null;
      this.publishAutosaveConflict(createAutosaveConflict(
        current.sessionId, current.questionId, current.loadRevision, this.answerRevision(),
        local,
        drafts.find((draft) => draft.questionId === conflict.questionId) ?? createAnswerDraft(conflict.questionId),
        current.origin,
        current.operationId
      ));
    } catch (error: unknown) {
      this.retainConflictError(conflict, action, error);
    }
  }

  private replaceDraftWith(questionId: string, persisted: AnswerDraft): void {
    const index = this.draftsState().findIndex((draft) => draft.questionId === questionId);
    if (index < 0) return;
    const nextDrafts = [...this.draftsState()];
    nextDrafts[index] = createAnswerDraft(questionId, persisted.value, persisted.flagged, persisted.version, persisted.savedAt);
    this.draftsState.set(Object.freeze(nextDrafts));
  }

  private onPlatformEvent(event: { readonly type: string }): void {
    if (event.type !== 'connectivity-changed') return;
    const session = this.sessionState();
    if (session === null || this.destroyed) return;
    const connectivity = this.platformState.state().connectivity;
    if (connectivity !== 'offline') this.startReplay(session.id);
    void this.refreshQueueState(session.id, this.requestRevision, this.answerRevision());
  }

  private refreshQueueState(sessionId: string, revision: number, localRevision = this.answerRevision()): Promise<void> {
    return this.offlineQueue.read(sessionId).then(
      (records) => {
        if (this.destroyed || revision !== this.requestRevision || this.sessionState()?.id !== sessionId) return;
        this.platformState.setPendingOperations(records.length);
        this.queueCountState.set(records.length);
        if (localRevision === this.answerRevision()) {
          for (const record of records) {
            if (this.autosaveConflictState()?.questionId === record.questionId) continue;
            const index = this.draftsState().findIndex((draft) => draft.questionId === record.questionId);
            if (index < 0) continue;
            const current = this.draftsState()[index];
            const nextDrafts = [...this.draftsState()];
            nextDrafts[index] = createAnswerDraft(
              current.questionId,
              record.draft.value,
              record.draft.flagged,
              record.expectedVersion,
              record.draft.savedAt
            );
            this.draftsState.set(Object.freeze(nextDrafts));
          }
        }
        if (records.length > 0 && this.platformState.state().connectivity !== 'offline' &&
          this.autosaveConflictState() === null) this.startReplay(sessionId);
      },
      (error: unknown) => {
        if (this.destroyed || revision !== this.requestRevision || this.sessionState()?.id !== sessionId) return;
        this.replayErrorState.set(autosaveErrorMessage(error));
      }
    );
  }

  retryQueuedReplay(): boolean {
    const session = this.sessionState();
    if (session === null || this.destroyed) return false;
    this.replayErrorState.set(null);
    this.startReplay(session.id);
    return true;
  }

  private startReplay(sessionId: string): void {
    if (this.destroyed || this.replayPromise !== null || this.platformState.state().connectivity === 'offline' ||
      this.autosaveConflictState() !== null) return;
    this.replayPromise = this.replayQueue(sessionId).finally(() => {
      this.replayPromise = null;
      if (!this.destroyed && this.sessionState()?.id === sessionId && this.queueCountState() > 0 &&
        this.platformState.state().connectivity !== 'offline' && this.replayError() === null &&
        this.autosaveConflictState() === null) {
        this.startReplay(sessionId);
      }
    });
  }

  private async replayQueue(sessionId: string): Promise<void> {
    const loadRevision = this.requestRevision;
    if (this.sessionState()?.id !== sessionId) return;
    let lastSavedAt: string | null = null;
    this.replayingState.set(true);
    try {
      while (!this.destroyed && this.sessionState()?.id === sessionId &&
        this.requestRevision === loadRevision && this.platformState.state().connectivity !== 'offline' &&
        this.autosaveConflictState() === null) {
        const records = await this.offlineQueue.read(sessionId);
        if (this.destroyed || this.sessionState()?.id !== sessionId || this.requestRevision !== loadRevision) return;
        this.platformState.setPendingOperations(records.length);
        this.queueCountState.set(records.length);
        const record = records[0];
        if (record === undefined) {
          this.replayErrorState.set(null);
          if (lastSavedAt !== null) this.autosaveStateState.set(createAutosaveState('saved', 'Saved', false, lastSavedAt));
          if (this.platformState.state().connectivity === 'reconnecting') this.platformState.setConnectivity('online');
          return;
        }
        try {
          const localRevision = this.answerRevision();
          const persisted = await this.replayRecord(record, loadRevision);
          if (persisted === null) return;
          if (this.destroyed || this.sessionState()?.id !== sessionId || this.requestRevision !== loadRevision) return;
          lastSavedAt = persisted.savedAt;
          if (localRevision === this.answerRevision()) this.applyPersistedDraft(persisted);
          await this.offlineQueue.remove(record.operationId);
          this.platformState.setPendingOperations(Math.max(0, records.length - 1));
          this.queueCountState.set(Math.max(0, records.length - 1));
        } catch (error: unknown) {
          this.replayErrorState.set(autosaveErrorMessage(error));
          this.autosaveStateState.set(createAutosaveState('error', autosaveErrorMessage(error), false));
          return;
        }
      }
    } finally {
      if (this.sessionState()?.id === sessionId) this.replayingState.set(false);
    }
  }

  private async replayRecord(record: OfflineAnswerQueueRecord, loadRevision: number): Promise<AnswerDraft | null> {
    try {
      return await firstValueFrom(this.repository.saveDraft(
        record.sessionId,
        record.questionId,
        record.draft,
        { expectedVersion: record.expectedVersion }
      ));
    } catch (error: unknown) {
      if (!isStaleAnswerConflict(error)) throw error;
      const persisted = await firstValueFrom(this.repository.listDrafts(record.sessionId));
      if (this.destroyed || this.sessionState()?.id !== record.sessionId || this.requestRevision !== loadRevision) return null;
      const server = persisted.find((draft) => draft.questionId === record.questionId) ?? createAnswerDraft(record.questionId);
      const equivalent = persisted.find((draft) => equivalentPersistedDraft(record, draft));
      if (equivalent !== undefined) return equivalent;
      this.openOfflineReplayConflict(record, server, loadRevision);
      return null;
  }
  }


  private openOfflineReplayConflict(
    record: OfflineAnswerQueueRecord,
    serverDraft: AnswerDraft,
    loadRevision: number
  ): void {
    const local = this.draftFor(record.questionId);
    if (local === undefined) return;
    this.autosaveConflictRevision += 1;
    this.autosaveConflictRetryAction = null;
    this.publishAutosaveConflict(createAutosaveConflict(
      record.sessionId,
      record.questionId,
      loadRevision,
      this.answerRevision(),
      local,
      serverDraft,
      'offline-replay',
      record.operationId
    ));
  }

  private applyPersistedDraft(persisted: AnswerDraft): void {
    const index = this.draftsState().findIndex((draft) => draft.questionId === persisted.questionId);
    if (index < 0 || persisted.version < this.draftsState()[index].version) return;
    const current = this.draftsState()[index];
    const nextDrafts = [...this.draftsState()];
    nextDrafts[index] = createAnswerDraft(
      current.questionId,
      current.value,
      current.flagged,
      persisted.version,
      persisted.savedAt
    );
    this.draftsState.set(Object.freeze(nextDrafts));
  }

  private resetAutosavePipeline(): void {
    this.autosaveSubscription?.unsubscribe();
    this.autosaveSubscription = null;
    this.autosaveRequests.complete();
    this.autosaveRequests = new Subject<AutosaveRequest>();
    this.startAutosavePipeline();
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
