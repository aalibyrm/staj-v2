import { Injectable, Optional, computed, signal, type Signal, type WritableSignal } from '@angular/core';
import { catchError, defer, map, of, switchMap, tap, throwError, type Observable } from 'rxjs';

import { normalizeApplicationError } from '../../../core/api/api-error';
import { SessionStore } from '../../../core/auth/session.store';
import { createSeedData } from '../../adaptive-learning/data-access/seed-data.factory';
import type { LearningOutcomeId } from '../../adaptive-learning/models/seed-domain.models';
import { QUESTION_DIFFICULTIES, QUESTION_TYPES, type QuestionVersion } from '../../question-bank/models/question.models';
import {
  compareExamBlueprint,
  createExamBlueprint,
  normalizeExamSettings,
  questionCoverageFromVersions,
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

@Injectable({ providedIn: 'root' })
export class ExamBuilderFacade {
  private readonly repository: ExamRepository;
  private readonly sessionStore: SessionStore;
  private readonly targetState: WritableSignal<ExamBlueprint>;
  private readonly currentCoverageState: WritableSignal<ExamBlueprintCurrentCoverage>;
  private readonly currentExamState = signal<Exam | null>(null);
  private readonly historyState = signal<readonly Exam[]>(Object.freeze([]));
  private readonly selectedQuestionVersionsState = signal<readonly QuestionVersion[]>(Object.freeze([]));
  private readonly requestStateState = signal<ExamWorkflowRequestState>({ status: 'idle' });
  private readonly settingsState: WritableSignal<ExamSettings>;
  private readonly updateRevision = signal(0);
  private requestRevision = 0;

  readonly target: Signal<ExamBlueprint>;
  readonly currentCoverage: Signal<ExamBlueprintCurrentCoverage>;
  readonly comparison: Signal<ExamBlueprintComparison>;
  readonly outcomeChoices: Signal<readonly ExamBuilderOutcomeChoice[]>;
  readonly liveUpdateText: Signal<string>;
  readonly currentExam: Signal<Exam | null> = this.currentExamState.asReadonly();
  readonly history: Signal<readonly Exam[]> = this.historyState.asReadonly();
  readonly versionHistory: Signal<readonly Exam[]> = this.history;
  readonly selectedQuestionVersions: Signal<readonly QuestionVersion[]> = this.selectedQuestionVersionsState.asReadonly();
  readonly selectedPinnedSnapshots: Signal<readonly QuestionVersion[]> = this.selectedQuestionVersions;
  readonly requestState: Signal<ExamWorkflowRequestState> = this.requestStateState.asReadonly();
  readonly workflowState: Signal<ExamWorkflowRequestState> = this.requestState;
  readonly settings: Signal<ExamSettings>;
  readonly normalizedSettings: Signal<ExamSettings>;
  readonly publishReady: Signal<boolean>;
  readonly publishReadiness: Signal<boolean>;
  readonly actionableMessage: Signal<string>;
  readonly errorMessage: Signal<string>;

  constructor(@Optional() repository: ExamRepository | null = null, @Optional() sessionStore: SessionStore | null = null) {
    this.repository = repository ?? new ExamRepository();
    this.sessionStore = sessionStore ?? new SessionStore();
    const seed = this.createSeedBlueprint();
    this.targetState = signal(seed.target);
    this.currentCoverageState = signal(emptyCoverageFor(seed.target));
    const initialSettings = normalizeExamSettings({ title: 'Untitled exam', durationMinutes: 60, rules: [] });
    if (initialSettings === null) throw new Error('Canonical exam settings could not be created.');
    this.settingsState = signal(initialSettings);
    this.target = this.targetState.asReadonly();
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
    const frozen = cloneSnapshots(snapshots);
    this.selectedQuestionVersionsState.set(frozen);
    this.currentCoverageState.set(freezeCoverage(questionCoverageFromVersions(frozen)));
  }

  clearSelectedQuestionVersions(): void {
    this.setSelectedQuestionVersions([]);
  }

  loadCurrent(id: string, options: { readonly expectedVersion?: number } = {}): Observable<Exam> {
    const revision = ++this.requestRevision;
    this.requestStateState.set({ status: 'loading' });
    return this.repository.getCurrent(id, { ...this.sessionOptions(), ...options }).pipe(
      tap((exam) => {
        if (revision !== this.requestRevision) return;
        this.currentExamState.set(exam);
        this.setSelectedQuestionVersions(exam.questionVersions);
        this.settingsState.set(normalizeExamSettings(exam) ?? this.settingsState());
        this.requestStateState.set({ status: 'success', message: 'Exam loaded successfully.' });
      }),
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
