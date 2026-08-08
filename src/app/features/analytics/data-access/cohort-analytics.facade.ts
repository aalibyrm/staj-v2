import { DestroyRef, Injectable, computed, effect, inject, signal, untracked, type Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, type ParamMap } from '@angular/router';
import { catchError, map, of, throwError, type Observable } from 'rxjs';

import { normalizeApplicationError } from '../../../core/api/api-error';
import { DEFAULT_MOCK_SCENARIO, MockTransport, type MockScenarioControls } from '../../../core/api/mock-transport';
import { type AuthSession, type RoleCode } from '../../../core/auth/authorization';
import { SessionStore } from '../../../core/auth/session.store';
import { selectCohortPrivacy, COHORT_PRIVACY_MINIMUM } from '../domain/cohort-privacy';
import { selectOutcomeMastery } from '../domain/mastery-calculation';
import { createMasteryAttempt, type MasteryAttempt, type MasteryBand } from '../models/mastery.models';
import { createSeedData } from '../../adaptive-learning/data-access/seed-data.factory';
import type { SeedCohort, SeedCourse, SeedStudent } from '../../adaptive-learning/models/seed-domain.models';
import type { LearningOutcome } from '../../learning-domain/models/learning-domain.models';

export type CohortAnalyticsRequestStatus = 'idle' | 'loading' | 'slow' | 'ready' | 'empty' | 'error' | 'unauthorized';
export type CohortAnalyticsRequestState = Readonly<{ readonly status: CohortAnalyticsRequestStatus; readonly message?: string; readonly retryable?: boolean }>;
export type CohortAnalyticsFilterKey = 'courseId' | 'cohortId' | 'dateRange';
export type CohortAnalyticsFilterOption = Readonly<{ readonly value: string; readonly label: string }>;
export type CohortAnalyticsFilterOptions = Readonly<{ readonly courses: readonly CohortAnalyticsFilterOption[]; readonly cohorts: readonly CohortAnalyticsFilterOption[]; readonly dateRanges: readonly CohortAnalyticsFilterOption[] }>;
export type CohortAnalyticsFilters = Readonly<{ readonly courseId: string; readonly cohortId: string; readonly dateRange: string }>;
export type CohortAnalyticsScenarioControls = Readonly<Partial<MockScenarioControls> & { readonly cohortSizeOverride?: number; readonly emptyAnalytics?: boolean; readonly emptyCohort?: boolean }>;
export type CohortAnalyticsContext = Readonly<{ readonly cohortId: string; readonly cohortLabel: string; readonly cohortIds: readonly string[]; readonly courseId: string; readonly courseLabel: string }>;
export type CohortComparisonRow = Readonly<{ readonly studentId: string; readonly pseudonym: string; readonly cohortId: string; readonly cohortLabel: string; readonly score: number; readonly scoreLabel: string; readonly rank: number; readonly band: MasteryBand; readonly statusLabel: string; readonly marker: string; readonly attemptCount: number }>;
export type CohortAnalyticsKpi = Readonly<{ readonly key: 'learners' | 'mastery' | 'outcomes' | 'attempts'; readonly label: string; readonly value: string; readonly detail: string; readonly marker: string }>;
export type CohortAnalyticsSummary = Readonly<{ readonly learnerCount: number; readonly measuredLearnerCount: number; readonly averageScore: number | null; readonly averageScoreLabel: string; readonly measuredOutcomeCount: number; readonly outcomeCount: number; readonly attemptCount: number }>;
export type CohortPrivacyState = Readonly<{ readonly status: 'blocked' | 'allowed'; readonly count: number; readonly minimum: number }>;

const SEED = createSeedData();
const EMPTY_FILTERS: CohortAnalyticsFilters = Object.freeze({ courseId: '', cohortId: '', dateRange: 'all' });
const EMPTY_OPTIONS: CohortAnalyticsFilterOptions = Object.freeze({ courses: Object.freeze([]), cohorts: Object.freeze([]), dateRanges: Object.freeze([Object.freeze({ value: 'all', label: 'All available dates' })]) });
const EMPTY_STATE: CohortAnalyticsRequestState = Object.freeze({ status: 'idle' });
const EMPTY_ROWS: readonly CohortComparisonRow[] = Object.freeze([]);
const EMPTY_KPIS: readonly CohortAnalyticsKpi[] = Object.freeze([]);
const EMPTY_CONTEXT: CohortAnalyticsContext | null = null;
const EMPTY_SUMMARY: CohortAnalyticsSummary | null = null;
const EMPTY_PRIVACY: CohortPrivacyState = Object.freeze({ status: 'blocked', count: 0, minimum: COHORT_PRIVACY_MINIMUM });
const DATE_OPTIONS: readonly CohortAnalyticsFilterOption[] = Object.freeze([
  Object.freeze({ value: 'all', label: 'All available dates' }),
  Object.freeze({ value: 'last-14-days', label: 'Last 14 days' }),
  Object.freeze({ value: 'last-30-days', label: 'Last 30 days' })
]);
const PERIODS = Object.freeze(['2026-05-18', '2026-05-24', '2026-05-31', '2026-06-07', '2026-06-14', '2026-06-18']);
const BASELINE = Object.freeze([0.28, 0.36, 0.44, 0.55, 0.63, 0.71]);
const freezeArray = <T>(items: readonly T[]): readonly T[] => Object.freeze([...items]);
const percent = (score: number | null): string => score === null ? 'No data' : `${Math.round(score * 100)}%`;
const bandMarker = (band: MasteryBand): string => band === 'advanced' ? '✓' : band === 'proficient' ? 'P' : band === 'approaching' ? 'A' : band === 'developing' ? 'D' : '?';
const dateStart = (range: string): number => range === 'last-14-days' ? Date.parse('2026-06-04T00:00:00.000Z') : range === 'last-30-days' ? Date.parse('2026-05-19T00:00:00.000Z') : Number.NEGATIVE_INFINITY;
const roleSupportsCohorts = (role: RoleCode): boolean => role === 'INSTRUCTOR' || role === 'MEASUREMENT_SPECIALIST' || role === 'PROGRAM_MANAGER' || role === 'OBSERVER';

const grantAllows = (session: AuthSession, kind: 'cohort' | 'course' | 'analytics', id: string): boolean => session.account.scopeGrants.some((grant) => grant.kind === kind && (grant.global === true || grant.ids.includes(id)));

const authorizedCohorts = (session: AuthSession | null): readonly SeedCohort[] => {
  if (session === null || !roleSupportsCohorts(session.account.roleCode)) return Object.freeze([]);
  if (session.account.roleCode === 'MEASUREMENT_SPECIALIST') {
    const courseIds = new Set(SEED.courses.filter((course) => grantAllows(session, 'analytics', course.id) || grantAllows(session, 'course', course.id)).map((course) => course.id));
    return freezeArray(SEED.cohorts.filter((cohort) => courseIds.has(cohort.courseId)));
  }
  return freezeArray(SEED.cohorts.filter((cohort) => grantAllows(session, 'cohort', cohort.id)));
};

type StudentEntry = Readonly<{ readonly student: SeedStudent; readonly cohort: SeedCohort; readonly course: SeedCourse; readonly outcomes: readonly LearningOutcome[]; readonly attempts: readonly MasteryAttempt[] }>;

const courseFor = (cohort: SeedCohort): SeedCourse | undefined => SEED.courses.find((course) => course.id === cohort.courseId);
const outcomesFor = (course: SeedCourse): readonly LearningOutcome[] => freezeArray(SEED.learningOutcomes.filter((outcome) => outcome.courseId === course.id));

const entriesFor = (cohorts: readonly SeedCohort[]): readonly StudentEntry[] => freezeArray(cohorts.flatMap((cohort) => {
  const course = courseFor(cohort);
  if (course === undefined) return [];
  const outcomes = outcomesFor(course);
  return cohort.studentIds.flatMap((studentId) => {
    const student = SEED.students.find((candidate) => candidate.id === studentId);
    if (student === undefined) return [];
    const studentOffset = student.id.endsWith('-02') ? 0.04 : student.id.endsWith('-03') ? -0.03 : 0;
    const attempts = outcomes.flatMap((outcome, outcomeIndex) => PERIODS.map((period, periodIndex) => createMasteryAttempt({ outcomeId: outcome.id, questionId: `COHORT-${outcomeIndex + 1}-${periodIndex + 1}-${student.id}`, difficulty: periodIndex % 3 === 0 ? 'easy' : periodIndex % 3 === 1 ? 'medium' : 'hard', earnedFraction: Math.min(1, Math.max(0, (BASELINE[periodIndex] ?? 0.5) + outcomeIndex * 0.025 + studentOffset)), answeredAt: `${period}T10:00:00.000Z` })));
    return [Object.freeze({ student, cohort, course, outcomes, attempts: freezeArray(attempts) })];
  });
}));

const normalizedScenario = (controls: CohortAnalyticsScenarioControls): CohortAnalyticsScenarioControls => {
  const value = controls.cohortSizeOverride;
  if (value !== undefined && (!Number.isInteger(value) || value < 0)) throw new TypeError('cohortSizeOverride must be a non-negative integer.');
  return Object.freeze({ ...DEFAULT_MOCK_SCENARIO, ...controls });
};

@Injectable()
export class CohortAnalyticsFacade {
  private readonly sessionStore = inject(SessionStore);
  private readonly transport = inject(MockTransport);
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly router = inject(Router, { optional: true });
  private readonly destroyRef = inject(DestroyRef);
  private readonly session = this.sessionStore.session;
  private readonly queryState = signal<CohortAnalyticsFilters>(EMPTY_FILTERS);
  private readonly filtersState = signal<CohortAnalyticsFilters>(EMPTY_FILTERS);
  private readonly optionsState = signal<CohortAnalyticsFilterOptions>(EMPTY_OPTIONS);
  private readonly requestStateState = signal<CohortAnalyticsRequestState>(EMPTY_STATE);
  private readonly contextState = signal<CohortAnalyticsContext | null>(EMPTY_CONTEXT);
  private readonly summaryState = signal<CohortAnalyticsSummary | null>(EMPTY_SUMMARY);
  private readonly kpisState = signal<readonly CohortAnalyticsKpi[]>(EMPTY_KPIS);
  private readonly comparisonRowsState = signal<readonly CohortComparisonRow[]>(EMPTY_ROWS);
  private readonly privacyState = signal<CohortPrivacyState>(EMPTY_PRIVACY);
  private readonly scenarioState = signal<CohortAnalyticsScenarioControls>(normalizedScenario({}));
  private revision = 0;
  private slowTimer: ReturnType<typeof setTimeout> | null = null;

  readonly requestState: Signal<CohortAnalyticsRequestState> = this.requestStateState.asReadonly();
  readonly filters: Signal<CohortAnalyticsFilters> = this.filtersState.asReadonly();
  readonly filterOptions: Signal<CohortAnalyticsFilterOptions> = this.optionsState.asReadonly();
  readonly cohortContext: Signal<CohortAnalyticsContext | null> = this.contextState.asReadonly();
  readonly summary: Signal<CohortAnalyticsSummary | null> = this.summaryState.asReadonly();
  readonly cohortSummary = this.summary;
  readonly aggregateSummary = this.summary;
  readonly kpis: Signal<readonly CohortAnalyticsKpi[]> = this.kpisState.asReadonly();
  readonly aggregateKpis = this.kpis;
  readonly comparisonRows: Signal<readonly CohortComparisonRow[]> = this.comparisonRowsState.asReadonly();
  readonly individualRows = this.comparisonRows;
  readonly privacy: Signal<CohortPrivacyState> = this.privacyState.asReadonly();
  readonly privacyStatus = computed(() => this.privacy().status);
  readonly privacyNotice = computed(() => `Individual comparison is hidden for privacy: this cohort has ${this.privacy().count} learners; at least ${this.privacy().minimum} are required.`);

  constructor() {
    if (this.route !== null) {
      this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => this.applyQueryFilters(params));
    }
    effect(() => {
      const accountId = this.session()?.accountId ?? null;
      this.configure(accountId, this.queryState());
    });
  }

  setMockScenario(controls: CohortAnalyticsScenarioControls): void { this.scenarioState.set(normalizedScenario(controls)); }
  resetMockScenario(): void { this.scenarioState.set(normalizedScenario({})); }
  updateFilters(update: Partial<CohortAnalyticsFilters>): void {
    const next = this.canonicalizeFilters({ ...this.filtersState(), ...update });
    this.filtersState.set(next);
    this.queryState.set(next);
    this.navigateFilters(next);
    this.refresh();
  }
  clearFilters(): void { this.updateFilters(EMPTY_FILTERS); }
  retry(): void { this.refresh(); }
  refresh(): void { this.load().subscribe({ error: () => undefined }); }

  load(): Observable<CohortAnalyticsSummary | null> {
    const revision = ++this.revision;
    this.cancelSlowTimer();
    this.clearPublicData();
    const session = this.session();
    const cohorts = authorizedCohorts(session);
    const selected = this.selectedCohorts(cohorts, this.filtersState());
    if (session === null || cohorts.length === 0 || selected.length === 0) {
      this.requestStateState.set(Object.freeze({ status: 'unauthorized', message: session === null ? 'Sign in with an authorized account to view this cohort analytics scope.' : 'This account has no authorized cohort analytics scope.', retryable: false }));
      return of(null);
    }
    this.requestStateState.set(Object.freeze({ status: 'loading' }));
    this.slowTimer = setTimeout(() => { if (revision === this.revision && this.requestStateState().status === 'loading') this.requestStateState.set(Object.freeze({ status: 'slow', message: 'The cohort analytics response is taking longer than expected. You can wait or retry.', retryable: true })); }, 400);
    const scenario = untracked(() => this.scenarioState());
    const controls: Partial<MockScenarioControls> = { latencyMs: scenario.latencyMs, outcome: scenario.outcome, transientServiceFailures: scenario.transientServiceFailures, retryLimit: scenario.retryLimit, retryDelayMs: scenario.retryDelayMs };
    return this.transport.execute({ method: 'GET', url: '/cohort-analytics' }, () => Object.freeze({ accountId: session.accountId, cohortIds: selected.map((cohort) => cohort.id) }), controls).pipe(
      map(() => {
        const entries = entriesFor(selected).slice(0, scenario.cohortSizeOverride);
        const report = this.buildReport(entries, this.filtersState().dateRange);
        if (revision !== this.revision || this.session()?.accountId !== session.accountId) return report.summary;
        this.cancelSlowTimer();
        if (scenario.emptyAnalytics === true || scenario.emptyCohort === true || entries.length === 0) {
          this.requestStateState.set(Object.freeze({ status: 'empty', message: 'No cohort analytics match the selected scope and filters.' }));
          return null;
        }
        const privacy = selectCohortPrivacy(report.rows);
        this.privacyState.set(Object.freeze({ status: privacy.status, count: entries.length, minimum: COHORT_PRIVACY_MINIMUM }));
        this.summaryState.set(report.summary);
        this.kpisState.set(report.kpis);
        this.contextState.set(report.context);
        this.comparisonRowsState.set(privacy.status === 'allowed' ? privacy.rows : EMPTY_ROWS);
        this.requestStateState.set(Object.freeze({ status: 'ready' }));
        return report.summary;
      }),
      catchError((error: unknown) => {
        if (revision === this.revision && this.session()?.accountId === session.accountId) {
          this.cancelSlowTimer();
          const normalized = normalizeApplicationError(error);
          this.clearPublicData();
          this.requestStateState.set(Object.freeze({ status: normalized.kind === 'unauthorized' ? 'unauthorized' : 'error', message: normalized.kind === 'unauthorized' ? 'This account is no longer authorized for this cohort analytics scope.' : normalized.userMessage, retryable: normalized.retryable }));
        }
        return throwError(() => error);
      })
    );
  }

  private configure(_accountId: string | null, query: CohortAnalyticsFilters): void {
    const cohorts = authorizedCohorts(this.session());
    const options = this.optionsFor(cohorts);
    this.optionsState.set(options);
    const next = this.canonicalizeFilters(query, options);
    this.filtersState.set(next);
    if (next.courseId !== query.courseId || next.cohortId !== query.cohortId || next.dateRange !== query.dateRange) this.navigateFilters(next);
    this.load().subscribe({ error: () => undefined });
  }
  private optionsFor(cohorts: readonly SeedCohort[]): CohortAnalyticsFilterOptions {
    const courseIds = new Set(cohorts.map((cohort) => cohort.courseId));
    return Object.freeze({ courses: freezeArray(SEED.courses.filter((course) => courseIds.has(course.id)).map((course) => Object.freeze({ value: course.id, label: `${course.code} · ${course.title}` }))), cohorts: freezeArray(cohorts.map((cohort) => Object.freeze({ value: cohort.id, label: `${cohort.code} · ${cohort.name}` }))), dateRanges: DATE_OPTIONS });
  }
  private applyQueryFilters(params: ParamMap): void {
    const next = Object.freeze({ courseId: params.get('course') ?? '', cohortId: params.get('cohort') ?? '', dateRange: params.get('date') ?? 'all' });
    const current = this.queryState();
    if (next.courseId !== current.courseId || next.cohortId !== current.cohortId || next.dateRange !== current.dateRange) this.queryState.set(next);
  }
  private canonicalizeFilters(value: CohortAnalyticsFilters, options = this.optionsState()): CohortAnalyticsFilters {
    const valid = (items: readonly CohortAnalyticsFilterOption[], candidate: string): string => items.some((item) => item.value === candidate) ? candidate : '';
    const dateRange = DATE_OPTIONS.some((item) => item.value === value.dateRange) ? value.dateRange : 'all';
    const courseId = valid(options.courses, value.courseId);
    const cohortId = valid(options.cohorts, value.cohortId);
    return Object.freeze({ courseId, cohortId, dateRange });
  }
  private selectedCohorts(cohorts: readonly SeedCohort[], filters: CohortAnalyticsFilters): readonly SeedCohort[] {
    return freezeArray(cohorts.filter((cohort) => (filters.courseId === '' || cohort.courseId === filters.courseId) && (filters.cohortId === '' || cohort.id === filters.cohortId)));
  }
  private buildReport(entries: readonly StudentEntry[], dateRange: string): { readonly rows: readonly CohortComparisonRow[]; readonly summary: CohortAnalyticsSummary; readonly kpis: readonly CohortAnalyticsKpi[]; readonly context: CohortAnalyticsContext } {
    const start = dateStart(dateRange);
    const scored = entries.map((entry) => {
      const attempts = entry.attempts.filter((attempt) => Date.parse(attempt.answeredAt) >= start);
      const scores = selectOutcomeMastery(attempts).filter((score) => score.isMeasured);
      const score = scores.length === 0 ? null : scores.reduce((sum, item) => sum + item.score, 0) / scores.length;
      return Object.freeze({ entry, attempts, score });
    });
    const ordered = [...scored].sort((left, right) => (right.score ?? -1) - (left.score ?? -1) || left.entry.student.id.localeCompare(right.entry.student.id));
    const rows = freezeArray(ordered.map((item, index) => {
      const score = item.score ?? 0;
      const band: MasteryBand = score >= 0.85 ? 'advanced' : score >= 0.6 ? 'proficient' : score >= 0.4 ? 'approaching' : 'developing';
      return Object.freeze({ studentId: item.entry.student.id, pseudonym: item.entry.student.pseudonym, cohortId: item.entry.cohort.id, cohortLabel: `${item.entry.cohort.code} · ${item.entry.cohort.name}`, score, scoreLabel: percent(item.score), rank: index + 1, band, statusLabel: `${band} mastery`, marker: bandMarker(band), attemptCount: item.attempts.length });
    }));
    const measured = scored.filter((item) => item.score !== null);
    const averageScore = measured.length === 0 ? null : measured.reduce((sum, item) => sum + (item.score ?? 0), 0) / measured.length;
    const outcomeCount = entries[0]?.outcomes.length ?? 0;
    const measuredOutcomeCount = entries.reduce((sum, entry) => sum + selectOutcomeMastery(entry.attempts.filter((attempt) => Date.parse(attempt.answeredAt) >= start)).filter((score) => score.isMeasured).length, 0);
    const attemptCount = scored.reduce((sum, item) => sum + item.attempts.length, 0);
    const cohortIds = freezeArray([...new Set(entries.map((entry) => entry.cohort.id))]);
    const first = entries[0];
    const context = Object.freeze({ cohortId: cohortIds.length === 1 ? cohortIds[0] ?? '' : '', cohortLabel: cohortIds.length === 1 ? `${first?.cohort.code ?? 'Authorized'} · ${first?.cohort.name ?? 'cohorts'}` : `${cohortIds.length} authorized cohorts`, cohortIds, courseId: first?.course.id ?? '', courseLabel: first === undefined ? 'Authorized course scope' : `${first.course.code} · ${first.course.title}` });
    const summary = Object.freeze({ learnerCount: entries.length, measuredLearnerCount: measured.length, averageScore, averageScoreLabel: percent(averageScore), measuredOutcomeCount, outcomeCount: outcomeCount * entries.length, attemptCount });
    const kpis = freezeArray([
      Object.freeze({ key: 'learners' as const, label: 'Learners in scope', value: `${entries.length}`, detail: `Privacy minimum ${COHORT_PRIVACY_MINIMUM}`, marker: '◎' }),
      Object.freeze({ key: 'mastery' as const, label: 'Average mastery', value: percent(averageScore), detail: `${measured.length} measured learner${measured.length === 1 ? '' : 's'}`, marker: averageScore !== null && averageScore >= 0.6 ? '↑' : '!' }),
      Object.freeze({ key: 'outcomes' as const, label: 'Measured outcomes', value: `${measuredOutcomeCount}`, detail: `${outcomeCount * entries.length} possible learner outcomes`, marker: 'P' }),
      Object.freeze({ key: 'attempts' as const, label: 'Attempts in range', value: `${attemptCount}`, detail: 'Scored answer history', marker: '↗' })
    ]);
    return { rows, summary, kpis, context };
  }
  private clearPublicData(): void {
    this.summaryState.set(EMPTY_SUMMARY); this.kpisState.set(EMPTY_KPIS); this.comparisonRowsState.set(EMPTY_ROWS); this.contextState.set(EMPTY_CONTEXT); this.privacyState.set(EMPTY_PRIVACY);
  }
  private navigateFilters(filters: CohortAnalyticsFilters): void {
    if (this.router === null || this.route === null) return;
    void this.router.navigate([], { relativeTo: this.route, queryParams: { course: filters.courseId || null, cohort: filters.cohortId || null, date: filters.dateRange === 'all' ? null : filters.dateRange }, queryParamsHandling: 'merge' });
  }
  private cancelSlowTimer(): void { if (this.slowTimer !== null) { clearTimeout(this.slowTimer); this.slowTimer = null; } }
}
