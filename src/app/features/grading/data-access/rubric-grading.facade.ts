import {
  Injectable,
  Optional,
  computed,
  signal,
  type Signal
} from '@angular/core';
import {
  catchError,
  defer,
  map,
  throwError,
  type Observable
} from 'rxjs';

import { normalizeApplicationError } from '../../../core/api/api-error';
import { SessionStore } from '../../../core/auth/session.store';
import {
  mapApplicationErrorToNotification,
  NotificationPort,
  type NotificationMessage
} from '../../../core/observability/notification.port';
import { decideGradingAttemptAccess, type GradingAccessDecision } from '../domain/grading-access';
import { deriveGradingWorkflowState } from '../domain/grading-workflow';
import {
  deriveOptimisticEvaluationCount,
  selectOptimisticTimeline,
  type PendingScoreChange,
  type ReEvaluationTimelineItem
} from '../domain/score-change-history';
import {
  selectRubricScore,
  type RubricScoringResult
} from '../domain/rubric-scoring';
import {
  RubricGradingRepository,
  type RubricGradingReadOptions
} from './rubric-grading.repository';
import { ScoreChangeError, type ScoreChangeEntry } from '../models/score-change.models';
import type {
  GradingContext,
  ResponsePreview,
  Rubric,
  RubricGrading
} from '../models/rubric.models';
import type { GradingWorkflowState, GradingWorkflowStatus } from '../models/grading-workflow.models';

export type RubricGradingRequestStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error' | 'unauthorized';

export type RubricGradingRequestState = Readonly<{
  readonly status: RubricGradingRequestStatus;
  readonly message?: string;
  readonly retryable?: boolean;
}>;

export type RubricScoreChangeStatus = 'idle' | 'saving' | 'saved' | 'error';

export type RubricScoreChangeState = Readonly<{
  readonly status: RubricScoreChangeStatus;
  readonly message?: string;
  readonly retryable?: boolean;
}>;

export class RubricGradingFacadeError extends Error {
  override readonly name = 'RubricGradingFacadeError';

  constructor(
    readonly code: 'not-ready' | 'destroyed',
    message: string
  ) {
    super(message);
  }
}

const EMPTY_LIST: readonly never[] = Object.freeze([]);
const EMPTY_SCORE_CHANGES: readonly ScoreChangeEntry[] = Object.freeze([]);
const IDLE_SCORE_CHANGE_STATE: RubricScoreChangeState = Object.freeze({ status: 'idle' });

const stateForError = (error: unknown): RubricGradingRequestState => {
  const normalized = normalizeApplicationError(error);
  if (normalized.kind === 'unauthorized') {
    return Object.freeze({
      status: 'unauthorized' as const,
      message: normalized.userMessage,
      retryable: false
    });
  }
  return Object.freeze({
    status: 'error' as const,
    message: normalized.userMessage,
    retryable: normalized.retryable
  });
};

const scoreChangeStateForError = (error: unknown): RubricScoreChangeState => {
  if (error instanceof ScoreChangeError) {
    return Object.freeze({ status: 'error' as const, message: error.message, retryable: false });
  }
  const normalized = normalizeApplicationError(error);
  return Object.freeze({ status: 'error' as const, message: normalized.userMessage, retryable: normalized.retryable });
};

@Injectable({ providedIn: 'root' })
export class RubricGradingFacade {
  private readonly repository: RubricGradingRepository;
  private readonly sessionStore: SessionStore;
  private readonly requestStateState = signal<RubricGradingRequestState>({ status: 'idle' });
  private readonly gradingState = signal<RubricGrading | null>(null);
  private readonly scoreChangeHistoryState = signal<readonly ScoreChangeEntry[]>(EMPTY_SCORE_CHANGES);
  private readonly scoreChangeStateState = signal<RubricScoreChangeState>(IDLE_SCORE_CHANGE_STATE);
  private readonly pendingScoreChangeState = signal<PendingScoreChange | null>(null);
  private readonly lastNotificationState = signal<NotificationMessage | null>(null);
  private requestRevision = 0;
  private lastAttemptId: string | null = null;
  private lastReadOptions: RubricGradingReadOptions = Object.freeze({});
  private destroyed = false;

  readonly requestState: Signal<RubricGradingRequestState> = this.requestStateState.asReadonly();
  readonly grading: Signal<RubricGrading | null> = this.gradingState.asReadonly();
  readonly context: Signal<GradingContext | null> = computed(() => this.gradingState()?.context ?? null);
  readonly responsePreview: Signal<ResponsePreview | null> = computed(() => this.gradingState()?.responsePreview ?? null);
  readonly rubric: Signal<Rubric | null> = computed(() => this.gradingState()?.rubric ?? null);
  readonly isReady: Signal<boolean> = computed(() => this.requestStateState().status === 'ready' && this.gradingState() !== null);
  readonly criterionCount: Signal<number> = computed(() => this.gradingState()?.rubric.criteria.length ?? 0);
  readonly initialScore: Signal<RubricScoringResult | null> = computed(() => {
    const grading = this.gradingState();
    return grading === null
      ? null
      : selectRubricScore({ rubric: grading.rubric, selectedLevelIds: grading.selectedLevelIds });
  });
  readonly errorMessage: Signal<string> = computed(() => this.requestStateState().message ?? '');
  readonly accessDecision: Signal<GradingAccessDecision> = computed(() =>
    decideGradingAttemptAccess(this.sessionStore.session(), this.context())
  );
  readonly scoreChangeHistory: Signal<readonly ScoreChangeEntry[]> = this.scoreChangeHistoryState.asReadonly();
  readonly pendingScoreChange: Signal<PendingScoreChange | null> = this.pendingScoreChangeState.asReadonly();
  readonly lastNotification: Signal<NotificationMessage | null> = this.lastNotificationState.asReadonly();
  readonly reEvaluationTimeline: Signal<readonly ReEvaluationTimelineItem[]> = computed(() =>
    selectOptimisticTimeline(this.scoreChangeHistoryState(), this.pendingScoreChangeState())
  );
  readonly scoreChangeState: Signal<RubricScoreChangeState> = this.scoreChangeStateState.asReadonly();
  /** The total this attempt currently carries, before any new in-progress score change is applied. */
  readonly previousScoreChangeTotal: Signal<number> = computed(() => {
    const history = this.scoreChangeHistoryState();
    if (history.length > 0) return history[history.length - 1].nextPoints;
    return this.initialScore()?.total ?? 0;
  });
  /** The total to display: the pending optimistic total while a change is in flight, otherwise the last persisted total. */
  readonly displayedScoreTotal: Signal<number> = computed(() => {
    const pending = this.pendingScoreChangeState();
    return pending !== null ? pending.nextPoints : this.previousScoreChangeTotal();
  });
  readonly workflowState: Signal<GradingWorkflowState | null> = computed(() => {
    const grading = this.gradingState();
    if (grading === null) return null;
    return deriveGradingWorkflowState(grading, { evaluationCount: deriveOptimisticEvaluationCount(this.scoreChangeHistoryState(), this.pendingScoreChangeState()) });
  });
  readonly workflowStatus: Signal<GradingWorkflowStatus | null> = computed(() => this.workflowState()?.status ?? null);
  readonly isGradable: Signal<boolean> = computed(
    () => this.requestStateState().status === 'ready' && this.accessDecision().allowed
  );

  constructor(
    @Optional() repository: RubricGradingRepository | null = null,
    @Optional() session: SessionStore | null = null,
    @Optional() private readonly notifications: NotificationPort | null = null
  ) {
    this.repository = repository ?? new RubricGradingRepository();
    this.sessionStore = session ?? new SessionStore();
  }

  load(attemptId: string, options: RubricGradingReadOptions = {}): Observable<RubricGrading | null> {
    if (this.destroyed) {
      return throwError(() => new RubricGradingFacadeError('destroyed', 'The grading facade has been destroyed.'));
    }
    const normalizedAttemptId = typeof attemptId === 'string' ? attemptId.trim() : '';
    const revision = ++this.requestRevision;
    const readOptions = Object.freeze({ ...options });
    this.lastAttemptId = normalizedAttemptId;
    this.lastReadOptions = readOptions;
    this.requestStateState.set(Object.freeze({ status: 'loading' }));
    this.gradingState.set(null);
    this.scoreChangeHistoryState.set(EMPTY_SCORE_CHANGES);
    this.scoreChangeStateState.set(IDLE_SCORE_CHANGE_STATE);
    this.pendingScoreChangeState.set(null);
    this.lastNotificationState.set(null);
    if (normalizedAttemptId.length === 0) {
      const error = new RubricGradingFacadeError('not-ready', 'An attempt id is required.');
      this.requestStateState.set(Object.freeze({ status: 'error', message: error.message, retryable: false }));
      return throwError(() => error);
    }

    return defer(() => this.repository.getByAttemptId(normalizedAttemptId, readOptions)).pipe(
      map((grading) => {
        if (revision !== this.requestRevision) return grading;
        if (grading === null) {
          this.gradingState.set(null);
          this.requestStateState.set(
            Object.freeze({ status: 'empty', message: 'No grading attempt is available for this route.', retryable: false })
          );
          return grading;
        }
        const decision = decideGradingAttemptAccess(this.sessionStore.session(), grading.context);
        if (!decision.allowed) {
          this.gradingState.set(null);
          this.requestStateState.set(Object.freeze({ status: 'unauthorized', message: decision.message, retryable: false }));
          return null;
        }
        this.gradingState.set(grading);
        this.scoreChangeHistoryState.set(this.repository.listScoreChanges(normalizedAttemptId));
        this.requestStateState.set(Object.freeze({ status: 'ready' }));
        return grading;
      }),
      catchError((error: unknown) => {
        if (revision === this.requestRevision) {
          this.gradingState.set(null);
          this.requestStateState.set(stateForError(error));
        }
        return throwError(() => error);
      })
    );
  }

  retry(): Observable<RubricGrading | null> {
    if (this.lastAttemptId === null || this.lastAttemptId.length === 0) {
      return throwError(() => new RubricGradingFacadeError('not-ready', 'There is no grading attempt to retry.'));
    }
    return this.load(this.lastAttemptId, this.lastReadOptions);
  }

  submitScoreChange(input: Readonly<{ readonly reason: string; readonly nextPoints: number }>): Observable<ScoreChangeEntry> {
    if (this.destroyed) {
      return throwError(() => new RubricGradingFacadeError('destroyed', 'The grading facade has been destroyed.'));
    }
    const grading = this.gradingState();
    if (grading === null || this.requestStateState().status !== 'ready') {
      return throwError(() => new RubricGradingFacadeError('not-ready', 'A grading attempt must be loaded before applying a score change.'));
    }
    const decision = decideGradingAttemptAccess(this.sessionStore.session(), grading.context);
    if (!decision.allowed) {
      this.scoreChangeStateState.set(Object.freeze({ status: 'error', message: decision.message, retryable: false }));
      return throwError(() => new RubricGradingFacadeError('not-ready', decision.message));
    }
    const actorId = this.sessionStore.session()?.accountId;
    if (typeof actorId !== 'string' || actorId.trim().length === 0) {
      const message = 'A signed-in account is required to apply a score change.';
      this.scoreChangeStateState.set(Object.freeze({ status: 'error', message, retryable: false }));
      return throwError(() => new RubricGradingFacadeError('not-ready', message));
    }

    const attemptId = grading.context.attemptId;
    const previousPoints = this.previousScoreChangeTotal();
    const priorHistory = this.scoreChangeHistoryState();
    const revision = ++this.requestRevision;
    this.pendingScoreChangeState.set(
      Object.freeze({ previousPoints, nextPoints: input.nextPoints, reason: input.reason, actorId })
    );
    this.scoreChangeStateState.set(Object.freeze({ status: 'saving' }));
    this.lastNotificationState.set(null);

    return defer(() => this.repository.submitScoreChange(
      attemptId,
      { reason: input.reason, nextPoints: input.nextPoints, previousPoints },
      { actorId }
    )).pipe(
      map((entry) => {
        if (revision === this.requestRevision) {
          this.pendingScoreChangeState.set(null);
          this.scoreChangeHistoryState.set(this.repository.listScoreChanges(attemptId));
          this.scoreChangeStateState.set(Object.freeze({ status: 'saved' }));
        }
        return entry;
      }),
      catchError((error: unknown) => {
        if (revision === this.requestRevision) {
          this.pendingScoreChangeState.set(null);
          this.scoreChangeHistoryState.set(priorHistory);
          this.scoreChangeStateState.set(scoreChangeStateForError(error));
          const notification = mapApplicationErrorToNotification(normalizeApplicationError(error));
          this.lastNotificationState.set(notification);
          try {
            this.notifications?.notify(notification);
          } catch {
            // A throwing notification port must never prevent the rollback above.
          }
        }
        return throwError(() => error);
      })
    );
  }

  clear(): void {
    this.requestRevision += 1;
    this.gradingState.set(null);
    this.requestStateState.set(Object.freeze({ status: 'idle' }));
    this.scoreChangeHistoryState.set(EMPTY_SCORE_CHANGES);
    this.scoreChangeStateState.set(IDLE_SCORE_CHANGE_STATE);
    this.pendingScoreChangeState.set(null);
    this.lastNotificationState.set(null);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.requestRevision += 1;
    this.gradingState.set(null);
  }
}

export { EMPTY_LIST };
