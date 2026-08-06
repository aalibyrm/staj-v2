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
import {
  selectRubricScore,
  type RubricScoringResult
} from '../domain/rubric-scoring';
import {
  RubricGradingRepository,
  type RubricGradingReadOptions
} from './rubric-grading.repository';
import type {
  GradingContext,
  ResponsePreview,
  Rubric,
  RubricGrading
} from '../models/rubric.models';

export type RubricGradingRequestStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error' | 'unauthorized';

export type RubricGradingRequestState = Readonly<{
  readonly status: RubricGradingRequestStatus;
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

@Injectable({ providedIn: 'root' })
export class RubricGradingFacade {
  private readonly repository: RubricGradingRepository;
  private readonly requestStateState = signal<RubricGradingRequestState>({ status: 'idle' });
  private readonly gradingState = signal<RubricGrading | null>(null);
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

  constructor(@Optional() repository: RubricGradingRepository | null = null) {
    this.repository = repository ?? new RubricGradingRepository();
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
    if (normalizedAttemptId.length === 0) {
      const error = new RubricGradingFacadeError('not-ready', 'An attempt id is required.');
      this.requestStateState.set(Object.freeze({ status: 'error', message: error.message, retryable: false }));
      return throwError(() => error);
    }

    return defer(() => this.repository.getByAttemptId(normalizedAttemptId, readOptions)).pipe(
      map((grading) => {
        if (revision !== this.requestRevision) return grading;
        this.gradingState.set(grading);
        this.requestStateState.set(
          grading === null
            ? Object.freeze({ status: 'empty', message: 'No grading attempt is available for this route.', retryable: false })
            : Object.freeze({ status: 'ready' })
        );
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

  clear(): void {
    this.requestRevision += 1;
    this.gradingState.set(null);
    this.requestStateState.set(Object.freeze({ status: 'idle' }));
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.requestRevision += 1;
    this.gradingState.set(null);
  }
}

export { EMPTY_LIST };
