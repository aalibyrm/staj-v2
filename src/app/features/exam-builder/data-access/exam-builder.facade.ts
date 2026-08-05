import { Injectable, Optional, computed, signal, type Signal, type WritableSignal } from '@angular/core';
import { catchError, concatMap, defer, from, map, of, switchMap, tap, throwError, toArray, type Observable } from 'rxjs';

import { normalizeApplicationError } from '../../../core/api/api-error';
import { SessionStore } from '../../../core/auth/session.store';
import { createSeedData } from '../../adaptive-learning/data-access/seed-data.factory';
import type { LearningOutcomeId } from '../../adaptive-learning/models/seed-domain.models';
import { QuestionBankRepository, type QuestionBankRequestOptions } from '../../question-bank/data-access/question-bank.facade';
import { QUESTION_DIFFICULTIES, QUESTION_TYPES, type Question, type QuestionVersion } from '../../question-bank/models/question.models';
import { selectQuestionsForBlueprint, type BlueprintSelectionCandidate, type BlueprintSelectionUnmetReason } from '../domain/blueprint-auto-selection';
import {
  compareExamBlueprint,
  createExamBlueprint,
  normalizeExamSettings,
  questionCoverageFromVersions,
  validateExamBlueprint,
  validateExamQuestionVersions,
  type Exam,
  type ExamCreateInput,
  type ExamBlueprintCurrentCoverageInput,
  type ExamRuleInput,
  type ExamSettings,
  type ExamSuccessorInput,
  type ExamUpdateInput,
  type ExamWorkflowRequestState,
  type ExamWorkflowRequestStatus
} from '../models/exam.models';
import type { ExamBlueprint, ExamBlueprintComparison, ExamBlueprintCurrentCoverage } from '../models/exam-blueprint.models';
import { ExamRepository } from './exam.repository';

type ExamAutomaticSelectionOptions = Pick<QuestionBankRequestOptions, 'session'>;

export type ExamBuilderOutcomeChoice = Readonly<{
  readonly id: LearningOutcomeId;
  readonly code: string;
  readonly title: string;
}>;

export type ExamBuilderDraftValues = Readonly<{
  readonly title: string;
  readonly durationMinutes: number;
  readonly rules: readonly ExamRuleInput[];
  readonly changeNote?: string;
}>;

export type ExamAutomaticSelectionStatus =
  | 'idle'
  | 'loading'
  | 'success'
  | 'partial'
  | 'empty'
  | 'unauthorized'
  | 'error'
  | 'conflict';

export type ExamAutomaticSelectionState = Readonly<{
  readonly status: ExamAutomaticSelectionStatus;
  readonly selected: readonly QuestionVersion[];
  readonly unmetReasons: readonly BlueprintSelectionUnmetReason[];
  readonly message?: string;
  readonly retryable?: boolean;
}>;

const emptyAutomaticSelectionState = (): ExamAutomaticSelectionState => Object.freeze({
  status: 'idle',
  selected: Object.freeze([] as readonly QuestionVersion[]),
  unmetReasons: Object.freeze([] as readonly BlueprintSelectionUnmetReason[])
});

const freezeAutomaticSelectionState = (
  status: ExamAutomaticSelectionStatus,
  selected: readonly QuestionVersion[],
  unmetReasons: readonly BlueprintSelectionUnmetReason[],
  message?: string,
  retryable = false
): ExamAutomaticSelectionState => Object.freeze({
  status,
  selected: cloneSnapshots(selected),
  unmetReasons: Object.freeze(unmetReasons.map((reason) => Object.freeze({ ...reason }))),
  ...(message === undefined ? {} : { message }),
  ...(retryable ? { retryable: true } : {})
});

const freezeCoverage = (input: ExamBlueprintCurrentCoverageInput): ExamBlueprintCurrentCoverage =>
  Object.freeze({
    outcomeBuckets: Object.freeze(input.outcomeBuckets.map((bucket) => Object.freeze({ ...bucket }))),
    difficultyBuckets: Object.freeze(input.difficultyBuckets.map((bucket) => Object.freeze({ ...bucket }))),
    questionTypeBuckets: Object.freeze(input.questionTypeBuckets.map((bucket) => Object.freeze({ ...bucket })))
  });

const emptyCoverageFor = (target: ExamBlueprint): ExamBlueprintCurrentCoverage =>
  freezeCoverage({
    outcomeBuckets: target.outcomeBuckets.map(({ key }) => ({ key, currentQuestionCount: 0, currentPoints: 0 })),
    difficultyBuckets: target.difficultyBuckets.map(({ key }) => ({ key, currentQuestionCount: 0, currentPoints: 0 })),
    questionTypeBuckets: target.questionTypeBuckets.map(({ key }) => ({ key, currentQuestionCount: 0, currentPoints: 0 }))
  });

const createInitialBlueprint = (outcomeIds: readonly string[]): ExamBlueprint => {
  const selectedOutcomes = outcomeIds.slice(0, 3);
  const input = {
    targetQuestionCount: selectedOutcomes.length * 2,
    targetPoints: selectedOutcomes.length * 4,
    outcomeBuckets: selectedOutcomes.map((key) => ({ key, targetQuestionCount: 2, targetPoints: 4 })),
    difficultyBuckets: QUESTION_DIFFICULTIES.map((key) => ({ key, targetQuestionCount: 2, targetPoints: 4 })),
    questionTypeBuckets: QUESTION_TYPES.map((key) => ({ key, targetQuestionCount: 1, targetPoints: 2 }))
  };
  const blueprint = createExamBlueprint(input);
  if (blueprint === null) throw new Error('Canonical seed blueprint could not be created.');
  return blueprint;
};

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Reflect.ownKeys(value as object)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  }
  return value;
};

const cloneSnapshots = (snapshots: readonly QuestionVersion[]): readonly QuestionVersion[] => {
  const clone = snapshots.map((snapshot) => JSON.parse(JSON.stringify(snapshot)) as QuestionVersion);
  return deepFreeze(clone);
};

const statusFromError = (error: unknown): ExamWorkflowRequestStatus => {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  const kind = normalizeApplicationError(error).kind;
  if (code === 'conflict' || kind === 'conflict') return 'conflict';
  if (code === 'unauthorized' || kind === 'unauthorized') return 'unauthorized';
  return 'error';
};

const AUTO_SELECTION_PAGE_SIZE = 50;

const errorCodeOf = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';

const selectionStatusFromError = (error: unknown): Extract<ExamAutomaticSelectionStatus, 'unauthorized' | 'error' | 'conflict'> => {
  const code = errorCodeOf(error);
  const kind = normalizeApplicationError(error).kind;
  if (code === 'conflict' || kind === 'conflict') return 'conflict';
  if (code === 'unauthorized' || kind === 'unauthorized') return 'unauthorized';
  return 'error';
};
const selectionRetryable = (error: unknown): boolean => normalizeApplicationError(error).kind === 'service';

const uniquePublishedQuestions = (items: readonly Question[]): readonly Question[] => {
  const unique = new Map<string, Question>();
  for (const item of items) {
    if (item.status !== 'published' || unique.has(String(item.id))) continue;
    unique.set(String(item.id), item);
  }
  return Object.freeze([...unique.values()].sort((left, right) => {
    const leftId = String(left.id);
    const rightId = String(right.id);
    return leftId === rightId ? 0 : leftId < rightId ? -1 : 1;
  }));
};

const currentPublishedSnapshotFor = (
  question: Question,
  history: readonly QuestionVersion[]
): QuestionVersion | null => {
  const matches = history
    .filter((snapshot) =>
      snapshot.status === 'published' &&
      snapshot.questionId === question.id &&
      snapshot.version === question.version
    )
    .sort((left, right) => String(left.versionId).localeCompare(String(right.versionId)));
  return matches[0] ?? null;
};

const candidateFromSnapshot = (snapshot: QuestionVersion): BlueprintSelectionCandidate => Object.freeze({
  questionId: snapshot.questionId,
  versionId: snapshot.versionId,
  status: 'published',
  outcomeId: snapshot.outcomeId,
  difficulty: snapshot.difficulty,
  type: snapshot.type,
  points: snapshot.points
});

@Injectable({ providedIn: 'root' })
export class ExamBuilderFacade {
  private readonly repository: ExamRepository;
  private readonly questionBankRepository: QuestionBankRepository;
  private readonly sessionStore: SessionStore;
  private readonly targetState: WritableSignal<ExamBlueprint>;
  private readonly currentCoverageState: WritableSignal<ExamBlueprintCurrentCoverage>;
  private readonly currentExamState = signal<Exam | null>(null);
  private readonly historyState = signal<readonly Exam[]>(Object.freeze([]));
  private readonly selectedQuestionVersionsState = signal<readonly QuestionVersion[]>(Object.freeze([]));
  private readonly autoSelectionStateState = signal<ExamAutomaticSelectionState>(emptyAutomaticSelectionState());
  private readonly requestStateState = signal<ExamWorkflowRequestState>({ status: 'idle' });
  private readonly settingsState: WritableSignal<ExamSettings>;
  private readonly updateRevision = signal(0);
  private requestRevision = 0;
  private autoSelectionRevision = 0;

  readonly target: Signal<ExamBlueprint>;
  readonly targetValid: Signal<boolean>;
  readonly currentCoverage: Signal<ExamBlueprintCurrentCoverage>;
  readonly comparison: Signal<ExamBlueprintComparison>;
  readonly outcomeChoices: Signal<readonly ExamBuilderOutcomeChoice[]>;
  readonly liveUpdateText: Signal<string>;
  readonly currentExam: Signal<Exam | null> = this.currentExamState.asReadonly();
  readonly history: Signal<readonly Exam[]> = this.historyState.asReadonly();
  readonly versionHistory: Signal<readonly Exam[]> = this.history;
  readonly selectedQuestionVersions: Signal<readonly QuestionVersion[]> = this.selectedQuestionVersionsState.asReadonly();
  readonly selectedPinnedSnapshots: Signal<readonly QuestionVersion[]> = this.selectedQuestionVersions;
  readonly autoSelectionState: Signal<ExamAutomaticSelectionState> = this.autoSelectionStateState.asReadonly();
  readonly automaticSelectionState: Signal<ExamAutomaticSelectionState> = this.autoSelectionState;
  readonly requestState: Signal<ExamWorkflowRequestState> = this.requestStateState.asReadonly();
  readonly workflowState: Signal<ExamWorkflowRequestState> = this.requestState;
  readonly settings: Signal<ExamSettings>;
  readonly normalizedSettings: Signal<ExamSettings>;
  readonly publishReady: Signal<boolean>;
  readonly publishReadiness: Signal<boolean>;
  readonly actionableMessage: Signal<string>;
  readonly errorMessage: Signal<string>;

  constructor(
    @Optional() repository: ExamRepository | null = null,
    @Optional() sessionStore: SessionStore | null = null,
    @Optional() questionBankRepository: QuestionBankRepository | null = null
  ) {
    this.repository = repository ?? new ExamRepository();
    this.questionBankRepository = questionBankRepository ?? new QuestionBankRepository();
    this.sessionStore = sessionStore ?? new SessionStore();
    const seed = this.createSeedBlueprint();
    this.targetState = signal(seed.target);
    this.currentCoverageState = signal(emptyCoverageFor(seed.target));
    const initialSettings = normalizeExamSettings({ title: 'Untitled exam', durationMinutes: 60, rules: [] });
    if (initialSettings === null) throw new Error('Canonical exam settings could not be created.');
    this.settingsState = signal(initialSettings);
    this.target = this.targetState.asReadonly();
    this.targetValid = computed(() => validateExamBlueprint(this.targetState()).length === 0);
    this.currentCoverage = this.currentCoverageState.asReadonly();
    this.settings = this.settingsState.asReadonly();
    this.outcomeChoices = signal(Object.freeze(seed.choices.map((choice) => Object.freeze(choice))));
    this.comparison = computed(() => compareExamBlueprint(this.targetState(), this.currentCoverageState()));
    this.liveUpdateText = computed(() => this.updateRevision() === 0 ? this.comparison().summary : `Blueprint updated. ${this.comparison().summary}`);
    this.publishReady = computed(() => {
      const settings = this.settingsState();
      return this.comparison().status === 'valid' && settings.title.trim().length > 0 && settings.durationMinutes > 0 &&
        this.selectedQuestionVersionsState().length > 0 && validateExamQuestionVersions(this.selectedQuestionVersionsState()).length === 0;
    });
    this.normalizedSettings = this.settings;
    this.publishReadiness = this.publishReady;
    this.actionableMessage = computed(() => {
      const request = this.requestStateState();
      if (request.message !== undefined && request.message.length > 0) return request.message;
      if (!this.publishReady()) return this.comparison().summary;
      return 'The draft is ready to publish.';
    });
    this.errorMessage = computed(() => this.requestStateState().message ?? '');
  }

  applyBlueprint(input: unknown): boolean {
    const blueprint = createExamBlueprint(input);
    if (blueprint === null) return false;
    this.invalidateAutomaticSelection();
    this.targetState.set(blueprint);
    this.updateRevision.update((revision) => revision + 1);
    return true;
  }

  replaceCurrentCoverage(input: ExamBlueprintCurrentCoverageInput): void {
    this.currentCoverageState.set(freezeCoverage(input));
  }

  setSettings(input: unknown): boolean {
    const settings = normalizeExamSettings(input);
    if (settings === null) return false;
    this.settingsState.set(settings);
    return true;
  }

  setSelectedQuestionVersions(snapshots: readonly QuestionVersion[]): void {
    this.invalidateAutomaticSelection();
    this.applySelectedQuestionVersions(snapshots);
  }

  clearSelectedQuestionVersions(): void {
    this.setSelectedQuestionVersions([]);
  }

  autoSelectQuestions(options: ExamAutomaticSelectionOptions = {}): Observable<ExamAutomaticSelectionState> {
    const target = this.targetState();
    const revision = ++this.autoSelectionRevision;
    const requestOptions: QuestionBankRequestOptions = { session: options.session ?? this.sessionStore.session() };
    this.autoSelectionStateState.set(freezeAutomaticSelectionState(
      'loading',
      this.selectedQuestionVersionsState(),
      [],
      'Selecting authorized published question snapshots.'
    ));
    return this.questionBankRepository.listQuestions(
      { status: 'published', sort: 'id-asc', page: 1, pageSize: AUTO_SELECTION_PAGE_SIZE },
      requestOptions
    ).pipe(
      concatMap((response) => from(uniquePublishedQuestions(response.items)).pipe(
        concatMap((question) => this.questionBankRepository.getQuestionVersionHistory(question.id, requestOptions).pipe(
          map((history) => currentPublishedSnapshotFor(question, history))
        )),
        toArray()
      )),
      map((snapshots) => {
        const retained = snapshots.filter((snapshot): snapshot is QuestionVersion => snapshot !== null);
        const candidates = retained.map(candidateFromSnapshot);
        const result = selectQuestionsForBlueprint(target, candidates);
        const byVersionId = new Map(retained.map((snapshot) => [String(snapshot.versionId), snapshot]));
        const selected = result.selected
          .map((candidate) => byVersionId.get(String(candidate.versionId)))
          .filter((snapshot): snapshot is QuestionVersion => snapshot !== undefined);
        const status: Extract<ExamAutomaticSelectionStatus, 'success' | 'partial' | 'empty'> =
          selected.length === 0 ? 'empty' : result.status === 'complete' ? 'success' : 'partial';
        const message = status === 'success'
          ? `Automatic selection pinned ${selected.length} published question snapshots.`
          : status === 'partial'
            ? `Automatic selection pinned ${selected.length} snapshots; unmet coverage is listed below.`
            : 'No eligible retained published question snapshots were available.';
        return freezeAutomaticSelectionState(status, selected, result.unmetReasons, message);
      }),
      tap((state) => {
        if (revision !== this.autoSelectionRevision || target !== this.targetState()) return;
        this.applySelectedQuestionVersions(state.selected);
        this.autoSelectionStateState.set(state);
      }),
      catchError((error: unknown) => {
        if (revision === this.autoSelectionRevision && target === this.targetState()) {
          this.autoSelectionStateState.set(freezeAutomaticSelectionState(
            selectionStatusFromError(error),
            this.selectedQuestionVersionsState(),
            [],
            this.messageFor(error),
            selectionRetryable(error)
          ));
        }
        return throwError(() => error);
      })
    );
  }

  retryAutoSelection(options: ExamAutomaticSelectionOptions = {}): Observable<ExamAutomaticSelectionState> {
    return this.autoSelectQuestions(options);
  }

  retryAutomaticSelection(options: ExamAutomaticSelectionOptions = {}): Observable<ExamAutomaticSelectionState> {
    return this.retryAutoSelection(options);
  }

  loadCurrent(id: string, options: { readonly expectedVersion?: number } = {}): Observable<Exam> {
    const revision = ++this.requestRevision;
    this.requestStateState.set({ status: 'loading' });
    return this.repository.getCurrent(id, { ...this.sessionOptions(), ...options }).pipe(
      switchMap((exam) => exam.status === 'published'
        ? this.repository.listVersionHistory(exam.id, this.sessionOptions()).pipe(map((history) => ({ exam, history })))
        : of({ exam, history: Object.freeze([] as readonly Exam[]) })),
      tap(({ exam, history }) => {
        if (revision !== this.requestRevision) return;
        this.currentExamState.set(exam);
        this.historyState.set(history);
        this.applySelectedQuestionVersions(exam.questionVersions);
        this.settingsState.set(normalizeExamSettings(exam) ?? this.settingsState());
        this.requestStateState.set({ status: 'success', message: 'Exam loaded successfully.' });
      }),
      map(({ exam }) => exam),
      catchError((error: unknown) => {
        if (revision === this.requestRevision) this.requestStateState.set({ status: statusFromError(error), message: this.messageFor(error) });
        return throwError(() => error);
      })
    );
  }

  loadHistory(id: string): Observable<readonly Exam[]> {
    const revision = ++this.requestRevision;
    this.requestStateState.set({ status: 'loading' });
    return this.repository.listVersionHistory(id, this.sessionOptions()).pipe(
      tap((history) => {
        if (revision === this.requestRevision) {
          this.historyState.set(history);
          this.requestStateState.set({ status: 'success', message: 'Published version history loaded.' });
        }
      }),
      catchError((error: unknown) => {
        if (revision === this.requestRevision) this.requestStateState.set({ status: statusFromError(error), message: this.messageFor(error) });
        return throwError(() => error);
      })
    );
  }

  saveDraft(values: Partial<ExamBuilderDraftValues> = {}): Observable<Exam> {
    const revision = ++this.requestRevision;
    this.requestStateState.set({ status: 'saving' });
    const normalized = this.settingsFor(values);
    const draftInput = this.draftInput(normalized);
    const current = this.currentExamState();
    const request = current === null
      ? this.repository.createDraft(draftInput, this.sessionOptions())
      : current.status === 'draft'
        ? this.repository.updateDraft(current.id, draftInput, { ...this.sessionOptions(), expectedVersion: current.version })
        : this.repository.createSuccessor(current.id, { changeNote: normalizedNote(values.changeNote) }, { ...this.sessionOptions(), expectedVersion: current.version });
    return request.pipe(
      tap((exam) => {
        if (revision !== this.requestRevision) return;
        this.currentExamState.set(exam);
        this.settingsState.set(normalizeExamSettings(exam) ?? this.settingsState());
        this.setSelectedQuestionVersions(exam.questionVersions);
        this.requestStateState.set({ status: 'success', message: exam.status === 'draft' && current?.status === 'published' ? 'Editable successor created.' : 'Draft saved successfully.' });
      }),
      catchError((error: unknown) => {
        if (revision === this.requestRevision) this.requestStateState.set({ status: statusFromError(error), message: this.messageFor(error) });
        return throwError(() => error);
      })
    );
  }

  createDraft(values: ExamBuilderDraftValues): Observable<Exam> {
    this.currentExamState.set(null);
    return this.saveDraft(values);
  }

  publishExam(changeNote = ''): Observable<Exam> {
    const current = this.currentExamState();
    const revision = ++this.requestRevision;
    if (current === null) return throwError(() => new Error('Save a draft before publishing.'));
    if (!this.publishReady()) {
      const error = new Error('The blueprint, settings, and pinned question versions must exactly match before publishing.');
      this.requestStateState.set({ status: 'error', message: error.message });
      return throwError(() => error);
    }
    this.requestStateState.set({ status: 'publishing' });
    return this.repository.publish(current.id, { changeNote }, { ...this.sessionOptions(), expectedVersion: current.version }).pipe(
      switchMap((exam) => this.repository.listVersionHistory(exam.id, this.sessionOptions()).pipe(map((history) => ({ exam, history })))),
      tap(({ exam, history }) => {
        if (revision !== this.requestRevision) return;
        this.currentExamState.set(exam);
        this.historyState.set(history);
        this.requestStateState.set({ status: 'success', message: 'Exam published successfully.' });
      }),
      map(({ exam }) => exam),
      catchError((error: unknown) => {
        if (revision === this.requestRevision) this.requestStateState.set({ status: statusFromError(error), message: this.messageFor(error) });
        return throwError(() => error);
      })
    );
  }

  createSuccessor(changeNote: string): Observable<Exam> {
    const current = this.currentExamState();
    if (current === null) return throwError(() => new Error('Load a published exam before creating a successor.'));
    const revision = ++this.requestRevision;
    this.requestStateState.set({ status: 'saving' });
    return this.repository.createSuccessor(current.id, { changeNote }, { ...this.sessionOptions(), expectedVersion: current.version }).pipe(
      tap((exam) => {
        if (revision !== this.requestRevision) return;
        this.currentExamState.set(exam);
        this.settingsState.set(normalizeExamSettings(exam) ?? this.settingsState());
        this.setSelectedQuestionVersions(exam.questionVersions);
        this.requestStateState.set({ status: 'success', message: 'Editable successor created.' });
      }),
      catchError((error: unknown) => {
        if (revision === this.requestRevision) this.requestStateState.set({ status: statusFromError(error), message: this.messageFor(error) });
        return throwError(() => error);
      })
    );
  }

  updateDraft(id: string, input: ExamUpdateInput): Observable<Exam> {
    const current = this.currentExamState();
    const expectedVersion = current?.version;
    return this.repository.updateDraft(id, input, { ...this.sessionOptions(), expectedVersion });
  }

  private invalidateAutomaticSelection(): void {
    this.autoSelectionRevision += 1;
    this.autoSelectionStateState.set(emptyAutomaticSelectionState());
  }

  private applySelectedQuestionVersions(snapshots: readonly QuestionVersion[]): void {
    const frozen = cloneSnapshots(snapshots);
    this.selectedQuestionVersionsState.set(frozen);
    this.currentCoverageState.set(freezeCoverage(questionCoverageFromVersions(frozen)));
  }

  private createSeedBlueprint(): { readonly target: ExamBlueprint; readonly choices: readonly ExamBuilderOutcomeChoice[] } {
    const seed = this.outcomesFromSeed();
    return { target: createInitialBlueprint(seed.map((outcome) => outcome.id)), choices: seed };
  }

  private outcomesFromSeed(): readonly ExamBuilderOutcomeChoice[] {
    const seed = createSeedData();
    const currentCourse = seed.courses.find((course) => course.status === 'active') ?? seed.courses[0];
    const outcomes = seed.learningOutcomes.filter((outcome) => outcome.courseId === currentCourse?.id);
    return Object.freeze(outcomes.map(({ id, code, title }) => Object.freeze({ id, code, title })));
  }

  private settingsFor(values: Partial<ExamBuilderDraftValues>): ExamSettings {
    const settings = normalizeExamSettings({
      title: values.title ?? this.settingsState().title,
      durationMinutes: values.durationMinutes ?? this.settingsState().durationMinutes,
      rules: values.rules ?? this.settingsState().rules
    });
    if (settings === null) return this.settingsState();
    this.settingsState.set(settings);
    return settings;
  }

  private draftInput(settings: ExamSettings): ExamCreateInput {
    return { title: settings.title, durationMinutes: settings.durationMinutes, rules: settings.rules, blueprint: this.targetState(), questionVersions: this.selectedQuestionVersionsState() };
  }

  private sessionOptions(): { readonly session: unknown } { return { session: this.sessionStore.session() }; }
  private messageFor(error: unknown): string {
    if (error instanceof Error && error.message.length > 0) return error.message;
    return normalizeApplicationError(error).userMessage;
  }
}

const normalizedNote = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
