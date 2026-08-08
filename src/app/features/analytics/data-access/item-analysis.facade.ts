import { DestroyRef, Injectable, effect, inject, signal, untracked, type Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, type ParamMap } from '@angular/router';
import { catchError, map, of, throwError, type Observable } from 'rxjs';

import { normalizeApplicationError } from '../../../core/api/api-error';
import { DEFAULT_MOCK_SCENARIO, type MockScenarioControls } from '../../../core/api/mock-transport';
import type { AuthSession } from '../../../core/auth/authorization';
import { SessionStore } from '../../../core/auth/session.store';
import { createSeedData } from '../../adaptive-learning/data-access/seed-data.factory';
import { type SeedStudent } from '../../adaptive-learning/models/seed-domain.models';
import {
  QUESTION_DIFFICULTIES,
  QUESTION_TYPES,
  type Question,
  type QuestionDifficulty,
  type QuestionListQueryInput,
  type QuestionType
} from '../../question-bank/models/question.models';
import { QuestionBankRepository } from '../../question-bank/data-access/question-bank.facade';
import {
  selectItemAnalysis,
  type ItemAnalysisEvidence,
  type ItemAnalysisRow
} from '../domain/item-analysis';

export type ItemAnalysisRequestStatus = 'idle' | 'loading' | 'slow' | 'ready' | 'empty' | 'error' | 'unauthorized';
export type ItemAnalysisRequestState = Readonly<{
  readonly status: ItemAnalysisRequestStatus;
  readonly message?: string;
  readonly retryable?: boolean;
}>;
export type ItemAnalysisFilterKey = 'course' | 'outcome' | 'difficulty' | 'type';
export type ItemAnalysisFilters = Readonly<{
  readonly course: string;
  readonly outcome: string;
  readonly difficulty: string;
  readonly type: string;
}>;
export type ItemAnalysisFilterOption = Readonly<{ readonly value: string; readonly label: string }>;
export type ItemAnalysisFilterOptions = Readonly<{
  readonly courses: readonly ItemAnalysisFilterOption[];
  readonly outcomes: readonly ItemAnalysisFilterOption[];
  readonly difficulties: readonly ItemAnalysisFilterOption[];
  readonly types: readonly ItemAnalysisFilterOption[];
}>;
export type ItemAnalysisScenarioControls = Readonly<
  Partial<MockScenarioControls> & {
    readonly emptyAnalysis?: boolean;
    readonly emptyAnalytics?: boolean;
  }
>;
export type ItemAnalysisScope = Readonly<{
  readonly role: 'INSTRUCTOR' | 'MEASUREMENT_SPECIALIST';
  readonly courseIds: readonly string[];
  readonly courseLabel: string;
}>;
export type ItemAnalysisKpi = Readonly<{
  readonly key: 'items' | 'facility' | 'responses' | 'flags';
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly marker: string;
}>;

const SEED = createSeedData();
const EMPTY_FILTERS: ItemAnalysisFilters = Object.freeze({ course: '', outcome: '', difficulty: '', type: '' });
const EMPTY_OPTIONS: ItemAnalysisFilterOptions = Object.freeze({
  courses: Object.freeze([]),
  outcomes: Object.freeze([]),
  difficulties: Object.freeze([]),
  types: Object.freeze([])
});
const EMPTY_STATE: ItemAnalysisRequestState = Object.freeze({ status: 'idle' });
const EMPTY_ROWS: readonly ItemAnalysisRow[] = Object.freeze([]);
const EMPTY_KPIS: readonly ItemAnalysisKpi[] = Object.freeze([]);
const EMPTY_SCOPE: ItemAnalysisScope | null = null;
const AUTHORIZED_ROLES = Object.freeze(['INSTRUCTOR', 'MEASUREMENT_SPECIALIST'] as const);

const freezeArray = <T>(items: readonly T[]): readonly T[] => Object.freeze([...items]);
const compareIds = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const percent = (value: number): string => `${Math.round(value * 100)}%`;
const labelForType = (value: QuestionType): string => value.replaceAll('-', ' ');
const labelForDifficulty = (value: QuestionDifficulty): string => `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;

const authorizedCourseIds = (session: AuthSession | null): readonly string[] => {
  if (session === null || !(AUTHORIZED_ROLES as readonly string[]).includes(session.account.roleCode)) return Object.freeze([]);
  const ids = session.account.scopeGrants
    .filter((grant) => grant.kind === 'course' && grant.global !== true)
    .flatMap((grant) => grant.ids.filter((id) => typeof id === 'string' && id.trim().length > 0));
  return freezeArray([...new Set(ids)].sort(compareIds));
};

const courseIdForStudent = (student: SeedStudent): string | undefined =>
  SEED.courses.find((course) => course.cohortIds.includes(student.cohortId))?.id;

const studentsForSession = (session: AuthSession, courseIds: readonly string[]): readonly SeedStudent[] => {
  const courseSet = new Set(courseIds);
  const studentGrant = session.account.scopeGrants.find((grant) => grant.kind === 'student');
  const grantedStudentIds = studentGrant === undefined ? null : new Set(studentGrant.ids);
  const students = SEED.students.filter((student) => {
    const courseId = courseIdForStudent(student);
    if (courseId === undefined || !courseSet.has(String(courseId))) return false;
    return session.account.roleCode === 'INSTRUCTOR'
      ? grantedStudentIds?.has(String(student.id)) === true
      : true;
  });
  return freezeArray(students);
};

@Injectable()
export class ItemAnalysisFacade {
  private readonly sessionStore = inject(SessionStore);
  private readonly repository = inject(QuestionBankRepository);
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly router = inject(Router, { optional: true });
  private readonly destroyRef = inject(DestroyRef);
  private readonly session = this.sessionStore.session;
  private readonly queryState = signal<ItemAnalysisFilters>(EMPTY_FILTERS);
  private readonly filtersState = signal<ItemAnalysisFilters>(EMPTY_FILTERS);
  private readonly optionsState = signal<ItemAnalysisFilterOptions>(EMPTY_OPTIONS);
  private readonly requestStateState = signal<ItemAnalysisRequestState>(EMPTY_STATE);
  private readonly rowsState = signal<readonly ItemAnalysisRow[]>(EMPTY_ROWS);
  private readonly kpisState = signal<readonly ItemAnalysisKpi[]>(EMPTY_KPIS);
  private readonly scopeState = signal<ItemAnalysisScope | null>(EMPTY_SCOPE);
  private readonly scenarioState = signal<ItemAnalysisScenarioControls>(Object.freeze({ ...DEFAULT_MOCK_SCENARIO }));
  private revision = 0;
  private slowTimer: ReturnType<typeof setTimeout> | null = null;

  readonly requestState: Signal<ItemAnalysisRequestState> = this.requestStateState.asReadonly();
  readonly filters: Signal<ItemAnalysisFilters> = this.filtersState.asReadonly();
  readonly filterOptions: Signal<ItemAnalysisFilterOptions> = this.optionsState.asReadonly();
  readonly rows: Signal<readonly ItemAnalysisRow[]> = this.rowsState.asReadonly();
  readonly itemRows = this.rows;
  readonly kpis: Signal<readonly ItemAnalysisKpi[]> = this.kpisState.asReadonly();
  readonly scope: Signal<ItemAnalysisScope | null> = this.scopeState.asReadonly();
  readonly authorizedScope = this.scope;

  constructor() {
    if (this.route !== null) {
      this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => this.applyQueryFilters(params));
    }
    effect(() => {
      const accountId = this.session()?.accountId ?? null;
      this.configure(accountId, this.queryState());
    });
  }

  setMockScenario(controls: ItemAnalysisScenarioControls): void {
    this.scenarioState.set(Object.freeze({ ...DEFAULT_MOCK_SCENARIO, ...controls }));
  }

  resetMockScenario(): void {
    this.scenarioState.set(Object.freeze({ ...DEFAULT_MOCK_SCENARIO }));
  }

  updateFilters(update: Partial<ItemAnalysisFilters>): void {
    const next = this.canonicalizeFilters(Object.freeze({ ...this.filtersState(), ...update }));
    this.filtersState.set(next);
    this.queryState.set(next);
    this.navigateFilters(next);
    this.refresh();
  }

  clearFilters(): void {
    this.updateFilters(EMPTY_FILTERS);
  }

  retry(): void {
    this.refresh();
  }

  refresh(): void {
    this.load().subscribe({ error: () => undefined });
  }

  load(): Observable<readonly ItemAnalysisRow[] | null> {
    const revision = ++this.revision;
    this.cancelSlowTimer();
    this.clearPublicData();
    const session = this.session();
    const courseIds = authorizedCourseIds(session);
    const selectedFilters = this.filtersState();
    const selectedQuestions = this.authorizedQuestions(courseIds);

    if (session === null || courseIds.length === 0 || selectedQuestions.length === 0) {
      this.requestStateState.set(Object.freeze({
        status: 'unauthorized',
        message: session === null ? 'Sign in with an authorized account to view item analysis.' : 'This account has no authorized item-analysis course scope.',
        retryable: false
      }));
      return of(null);
    }

    this.requestStateState.set(Object.freeze({ status: 'loading' }));
    this.slowTimer = setTimeout(() => {
      if (revision === this.revision && this.requestStateState().status === 'loading') {
        this.requestStateState.set(Object.freeze({ status: 'slow', message: 'The item-analysis response is taking longer than expected. You can wait or retry.', retryable: true }));
      }
    }, 400);

    const scenario = untracked(() => this.scenarioState());
    const controls: Partial<MockScenarioControls> = {
      latencyMs: scenario.latencyMs,
      outcome: scenario.outcome,
      transientServiceFailures: scenario.transientServiceFailures,
      retryLimit: scenario.retryLimit,
      retryDelayMs: scenario.retryDelayMs
    };
    const query: QuestionListQueryInput = {
      course: selectedFilters.course,
      difficulty: selectedFilters.difficulty,
      type: selectedFilters.type,
      sort: 'id-asc',
      page: 1,
      pageSize: 50
    };

    return this.repository.listQuestions(query, { session, ...controls }).pipe(
      map((response) => {
        const scoped = response.items.filter((question) => courseIds.includes(String(question.courseId)));
        const filtered = selectedFilters.outcome === ''
          ? scoped
          : scoped.filter((question) => String(question.outcomeId) === selectedFilters.outcome);
        const questions = scenario.emptyAnalysis === true || scenario.emptyAnalytics === true ? [] : filtered;
        const evidence = this.demoEvidence(questions, session, courseIds);
        const rows = selectItemAnalysis(questions, evidence);

        if (revision !== this.revision || this.session()?.accountId !== session.accountId) return rows;
        this.cancelSlowTimer();
        if (rows.length === 0) {
          this.requestStateState.set(Object.freeze({ status: 'empty', message: 'No item-quality evidence matches the authorized scope and filters.' }));
          return null;
        }
        this.rowsState.set(rows);
        this.kpisState.set(this.buildKpis(rows));
        this.requestStateState.set(Object.freeze({ status: 'ready' }));
        return rows;
      }),
      catchError((error: unknown) => {
        if (revision === this.revision && this.session()?.accountId === session.accountId) {
          this.cancelSlowTimer();
          const normalized = normalizeApplicationError(error);
          this.clearPublicData();
          this.requestStateState.set(Object.freeze({
            status: normalized.kind === 'unauthorized' ? 'unauthorized' : 'error',
            message: normalized.kind === 'unauthorized' ? 'This account is no longer authorized for item analysis.' : normalized.userMessage,
            retryable: normalized.retryable
          }));
        }
        return throwError(() => error);
      })
    );
  }

  private configure(_accountId: string | null, query: ItemAnalysisFilters): void {
    const courseIds = authorizedCourseIds(this.session());
    const authorizedQuestions = this.authorizedQuestions(courseIds);
    const options = this.optionsFor(authorizedQuestions);
    this.optionsState.set(options);
    const next = this.canonicalizeFilters(query, options);
    this.filtersState.set(next);
    if (next.course !== query.course || next.outcome !== query.outcome || next.difficulty !== query.difficulty || next.type !== query.type) {
      this.navigateFilters(next);
    }
    this.scopeState.set(this.scopeFor(this.session(), courseIds));
    this.load().subscribe({ error: () => undefined });
  }

  private authorizedQuestions(courseIds: readonly string[]): readonly Question[] {
    if (courseIds.length === 0) return Object.freeze([]);
    const allowed = new Set(courseIds);
    return freezeArray(this.repository.getSnapshot().questions.filter((question) => allowed.has(String(question.courseId))));
  }

  private optionsFor(questions: readonly Question[]): ItemAnalysisFilterOptions {
    const courses = [...new Map(questions.map((question) => [String(question.courseId), question.course])).values()]
      .sort((left, right) => compareIds(String(left.id), String(right.id)))
      .map((course) => Object.freeze({ value: String(course.id), label: `${course.code} · ${course.title}` }));
    const outcomes = [...new Map(questions.map((question) => [String(question.outcomeId), question.outcome])).values()]
      .sort((left, right) => compareIds(String(left.id), String(right.id)))
      .map((outcome) => Object.freeze({ value: String(outcome.id), label: `${outcome.code} · ${outcome.title}` }));
    const difficulties = QUESTION_DIFFICULTIES.filter((difficulty) => questions.some((question) => question.difficulty === difficulty))
      .map((difficulty) => Object.freeze({ value: difficulty, label: labelForDifficulty(difficulty) }));
    const types = QUESTION_TYPES.filter((type) => questions.some((question) => question.type === type))
      .map((type) => Object.freeze({ value: type, label: labelForType(type) }));
    return Object.freeze({
      courses: freezeArray([Object.freeze({ value: '', label: 'All authorized courses' }), ...courses]),
      outcomes: freezeArray([Object.freeze({ value: '', label: 'All authorized outcomes' }), ...outcomes]),
      difficulties: freezeArray([Object.freeze({ value: '', label: 'All difficulties' }), ...difficulties]),
      types: freezeArray([Object.freeze({ value: '', label: 'All item types' }), ...types])
    });
  }

  private applyQueryFilters(params: ParamMap): void {
    const next = Object.freeze({
      course: params.get('course') ?? '',
      outcome: params.get('outcome') ?? '',
      difficulty: params.get('difficulty') ?? '',
      type: params.get('type') ?? ''
    });
    const current = this.queryState();
    if (next.course !== current.course || next.outcome !== current.outcome || next.difficulty !== current.difficulty || next.type !== current.type) this.queryState.set(next);
  }

  private canonicalizeFilters(value: ItemAnalysisFilters, options = this.optionsState()): ItemAnalysisFilters {
    const valid = (items: readonly ItemAnalysisFilterOption[], candidate: string): string => items.some((item) => item.value === candidate) ? candidate : '';
    return Object.freeze({
      course: valid(options.courses, value.course),
      outcome: valid(options.outcomes, value.outcome),
      difficulty: valid(options.difficulties, value.difficulty),
      type: valid(options.types, value.type)
    });
  }

  private scopeFor(session: AuthSession | null, courseIds: readonly string[]): ItemAnalysisScope | null {
    if (session === null || courseIds.length === 0 || (session.account.roleCode !== 'INSTRUCTOR' && session.account.roleCode !== 'MEASUREMENT_SPECIALIST')) return null;
    const courses = SEED.courses.filter((course) => courseIds.includes(String(course.id)));
    const courseLabel = courses.length === 1
      ? `${courses[0]?.code ?? 'Authorized'} · ${courses[0]?.title ?? 'course'}`
      : `${courses.length} authorized courses`;
    return Object.freeze({ role: session.account.roleCode, courseIds: freezeArray(courseIds), courseLabel });
  }

  private demoEvidence(questions: readonly Question[], session: AuthSession, courseIds: readonly string[]): readonly ItemAnalysisEvidence[] {
    const learners = studentsForSession(session, courseIds);
    const evidence: ItemAnalysisEvidence[] = [];
    questions.forEach((question, questionIndex) => {
      learners.forEach((learner, learnerIndex) => {
        const totalScoreFraction = Math.min(1, Math.max(0, 0.45 + learnerIndex * 0.04 + (questionIndex % 4) * 0.03));
        const earnedFraction = Math.min(1, Math.max(0, 0.25 + ((questionIndex + learnerIndex * 2) % 6) * 0.12));
        const selectedOptionIds = question.answer.kind === 'choice'
          ? [...question.answer.optionIds].slice(0, question.type === 'multiple-choice' ? question.answer.optionIds.length : 1)
          : [];
        if (question.type === 'multiple-choice' && questionIndex === 1 && learnerIndex === 0) selectedOptionIds.push(`${String(question.id)}-retired`);
        evidence.push(Object.freeze({
          questionId: String(question.id),
          learnerId: String(learner.id),
          learnerTotalScoreFraction: totalScoreFraction,
          earnedFraction,
          selectedOptionIds: freezeArray(selectedOptionIds)
        }));
      });
    });
    return freezeArray(evidence);
  }

  private buildKpis(rows: readonly ItemAnalysisRow[]): readonly ItemAnalysisKpi[] {
    const responses = rows.reduce((sum, row) => sum + row.responseCount, 0);
    const averageFacility = rows.reduce((sum, row) => sum + row.facilityIndex, 0) / rows.length;
    const flags = rows.filter((row) => row.discriminationLabel === 'negative' || row.optionAnalysis.unlistedSelectionCount > 0).length;
    return freezeArray([
      Object.freeze({ key: 'items' as const, label: 'Items analyzed', value: `${rows.length}`, detail: 'Authorized question records', marker: 'Q' }),
      Object.freeze({ key: 'facility' as const, label: 'Average facility', value: percent(averageFacility), detail: 'Mean earned fraction', marker: 'F' }),
      Object.freeze({ key: 'responses' as const, label: 'Responses', value: `${responses}`, detail: 'Learner-item evidence', marker: 'R' }),
      Object.freeze({ key: 'flags' as const, label: 'Quality flags', value: `${flags}`, detail: 'Negative or unlisted evidence', marker: '!' })
    ]);
  }

  private clearPublicData(): void {
    this.rowsState.set(EMPTY_ROWS);
    this.kpisState.set(EMPTY_KPIS);
  }

  private navigateFilters(filters: ItemAnalysisFilters): void {
    if (this.router === null || this.route === null) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        course: filters.course || null,
        outcome: filters.outcome || null,
        difficulty: filters.difficulty || null,
        type: filters.type || null
      },
      queryParamsHandling: 'merge'
    });
  }

  private cancelSlowTimer(): void {
    if (this.slowTimer !== null) {
      clearTimeout(this.slowTimer);
      this.slowTimer = null;
    }
  }
}
