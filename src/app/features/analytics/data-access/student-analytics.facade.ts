import { DestroyRef, Injectable, computed, effect, inject, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, type ParamMap } from '@angular/router';
import { catchError, map, of, throwError, type Observable } from 'rxjs';

import { normalizeApplicationError } from '../../../core/api/api-error';
import { DEFAULT_MOCK_SCENARIO, MockTransport, type MockScenarioControls } from '../../../core/api/mock-transport';
import { type AuthSession, type RoleCode } from '../../../core/auth/authorization';
import { SessionStore } from '../../../core/auth/session.store';
import { recommendLearningPathFromAttempts } from '../domain/recommendation-engine';
import { selectOutcomeMastery } from '../domain/mastery-calculation';
import { type MasteryAttempt, type MasteryOutcomeScore } from '../models/mastery.models';
import { ANALYTICS_PERFORMANCE_PERIODS, selectStudentPerformanceEvidence } from './analytics-performance.dataset';
import type { ContentItem, ContentItemId, CourseId, LearningOutcome, LearningPathReason } from '../../learning-domain/models/learning-domain.models';
import { createSeedData } from '../../adaptive-learning/data-access/seed-data.factory';
import type { SeedCohort, SeedCourse, SeedStudent } from '../../adaptive-learning/models/seed-domain.models';

export type AnalyticsRequestStatus = 'idle' | 'loading' | 'slow' | 'ready' | 'empty' | 'error' | 'unauthorized';
export type AnalyticsRequestState = Readonly<{ readonly status: AnalyticsRequestStatus; readonly message?: string; readonly retryable?: boolean }>;
export type AnalyticsFilterKey = 'courseId' | 'dateRange' | 'outcomeId';
export type AnalyticsFilterOption = Readonly<{ readonly value: string; readonly label: string }>;
export type AnalyticsFilterOptions = Readonly<{ readonly courses: readonly AnalyticsFilterOption[]; readonly dateRanges: readonly AnalyticsFilterOption[]; readonly outcomes: readonly AnalyticsFilterOption[] }>;
export type StudentAnalyticsFilters = Readonly<{ readonly courseId: string; readonly dateRange: string; readonly outcomeId: string }>;
export type StudentAnalyticsContext = Readonly<{ readonly id: string; readonly pseudonym: string; readonly cohortId: string; readonly cohortLabel: string; readonly courseId: string; readonly courseLabel: string }>;
export type AnalyticsKpi = Readonly<{ readonly key: 'mastery' | 'outcomes' | 'attempts' | 'recommendations'; readonly label: string; readonly value: string; readonly detail: string; readonly marker: string }>;
export type MasteryTrendRow = Readonly<{ readonly period: string; readonly periodLabel: string; readonly score: number | null; readonly scoreLabel: string; readonly bandLabel: string; readonly statusLabel: string; readonly attemptCount: number }>;
export type MasteryTrendSummary = Readonly<{ readonly text: string; readonly startLabel: string; readonly endLabel: string; readonly changeLabel: string }>;
export type HeatmapCell = Readonly<{ readonly period: string; readonly periodLabel: string; readonly score: number | null; readonly scoreLabel: string; readonly band: string; readonly statusLabel: string }>;
export type HeatmapRow = Readonly<{ readonly outcomeId: string; readonly outcomeCode: string; readonly outcomeTitle: string; readonly cells: readonly HeatmapCell[] }>;
export type HeatmapLegendItem = Readonly<{ readonly band: string; readonly label: string; readonly range: string; readonly marker: string }>;
export type StudentRiskStatus = Readonly<{ readonly label: string; readonly detail: string; readonly band: 'low' | 'moderate' | 'elevated' | 'unmeasured'; readonly marker: string }>;
export type StudentAnalyticsRecommendation = Readonly<{ readonly contentId: string; readonly contentTitle: string; readonly contentFormat: string; readonly order: number; readonly reason: LearningPathReason }>;
export type StudentAnalyticsScenarioControls = Readonly<Partial<MockScenarioControls> & { readonly emptyAnalytics?: boolean }>;

export type AnalyticsDataset = Readonly<{ readonly context: StudentAnalyticsContext; readonly course: SeedCourse; readonly cohort: SeedCohort; readonly student: SeedStudent; readonly outcomes: readonly LearningOutcome[]; readonly content: readonly ContentItem[]; readonly attempts: readonly MasteryAttempt[]; readonly completedContentIds: readonly ContentItemId[]; readonly lockedContentIds: readonly ContentItemId[] }>;

const SEED = createSeedData();
const EMPTY_FILTERS: StudentAnalyticsFilters = Object.freeze({ courseId: '', dateRange: 'all', outcomeId: '' });
const EMPTY_OPTIONS: AnalyticsFilterOptions = Object.freeze({ courses: Object.freeze([]), dateRanges: Object.freeze([]), outcomes: Object.freeze([]) });
const EMPTY_KPIS: readonly AnalyticsKpi[] = Object.freeze([]);
const EMPTY_TREND: readonly MasteryTrendRow[] = Object.freeze([]);
const EMPTY_HEATMAP: readonly HeatmapRow[] = Object.freeze([]);
const EMPTY_RECOMMENDATIONS: readonly StudentAnalyticsRecommendation[] = Object.freeze([]);
const EMPTY_SUMMARY: MasteryTrendSummary = Object.freeze({ text: 'No mastery measurements are available for this student and filter combination.', startLabel: '', endLabel: '', changeLabel: 'No change available' });
const EMPTY_RISK: StudentRiskStatus = Object.freeze({ label: 'Not measured', detail: 'Risk cannot be assessed until this student has eligible attempt history.', band: 'unmeasured', marker: '?' });
const DATE_OPTIONS: readonly AnalyticsFilterOption[] = Object.freeze([
  Object.freeze({ value: 'all', label: 'All available dates' }),
  Object.freeze({ value: 'last-14-days', label: 'Last 14 days' }),
  Object.freeze({ value: 'last-30-days', label: 'Last 30 days' })
]);
const PERIODS = ANALYTICS_PERFORMANCE_PERIODS;
const HEATMAP_LEGEND: readonly HeatmapLegendItem[] = Object.freeze([
  Object.freeze({ band: 'developing', label: 'Developing', range: '0–39%', marker: 'D' }),
  Object.freeze({ band: 'approaching', label: 'Approaching', range: '40–59%', marker: 'A' }),
  Object.freeze({ band: 'proficient', label: 'Proficient', range: '60–84%', marker: 'P' }),
  Object.freeze({ band: 'advanced', label: 'Advanced', range: '85–100%', marker: '✓' })
]);
const EMPTY_STATE: AnalyticsRequestState = Object.freeze({ status: 'idle' });
const roleSupportsAnalytics = (role: RoleCode): boolean => role === 'STUDENT' || role === 'INSTRUCTOR';
const freezeArray = <T>(items: readonly T[]): readonly T[] => Object.freeze([...items]);
const percentLabel = (score: number | null): string => score === null ? 'No data' : `${Math.round(score * 100)}%`;
const bandLabel = (score: MasteryOutcomeScore | undefined): string => score?.isMeasured ? `${score.band}` : 'No measurement';
const dateAtStartOfDay = (value: string): number => Date.parse(`${value}T00:00:00.000Z`);


function studentScope(session: AuthSession | null, studentId: string): { readonly student: SeedStudent; readonly cohort: SeedCohort; readonly course: SeedCourse } | null {
  if (session === null || !roleSupportsAnalytics(session.account.roleCode) || studentId.trim() === '') return null;
  const student = SEED.students.find((item) => item.id === studentId);
  if (student === undefined) return null;
  const cohort = SEED.cohorts.find((item) => item.id === student.cohortId);
  const course = cohort === undefined ? undefined : SEED.courses.find((item) => item.id === cohort.courseId);
  if (cohort === undefined || course === undefined) return null;
  const grants = session.account.scopeGrants;
  const hasGrant = (kind: 'student' | 'cohort' | 'course', id: string): boolean => grants.some((grant) => grant.kind === kind && (grant.global === true || grant.ids.includes(id)));
  const allowed = session.account.roleCode === 'STUDENT'
    ? hasGrant('student', student.id) && session.account.scopeGrants.some((grant) => grant.kind === 'student' && grant.ids.includes(student.id))
    : session.account.roleCode === 'INSTRUCTOR'
      ? (hasGrant('student', student.id) || hasGrant('cohort', cohort.id) || hasGrant('course', course.id))
      : false;
  return allowed ? { student, cohort, course } : null;
}

function buildDataset(student: SeedStudent, cohort: SeedCohort, course: SeedCourse): AnalyticsDataset {
  const context: StudentAnalyticsContext = Object.freeze({ id: student.id, pseudonym: student.pseudonym, cohortId: cohort.id, cohortLabel: `${cohort.code} · ${cohort.name}`, courseId: course.id, courseLabel: `${course.code} · ${course.title}` });
  const outcomes = freezeArray(SEED.learningOutcomes.filter((item) => item.courseId === course.id).map((item) => Object.freeze({ id: item.id, courseId: item.courseId, code: item.code, title: item.title, description: item.description, level: item.level, status: 'published' as const, prerequisiteOutcomeIds: freezeArray(item.prerequisiteOutcomeIds), createdAt: item.createdAt, updatedAt: item.updatedAt, version: item.version })));
  const content = freezeArray(outcomes.map((outcome, index) => Object.freeze({ id: `ANALYTICS-CONTENT-${course.code}-${String(index + 1).padStart(2, '0')}` as ContentItemId, courseId: course.id as CourseId, title: `Practice ${outcome.code}: ${outcome.title}`, description: `Scoped practice for ${outcome.code}.`, learningOutcomeIds: freezeArray([outcome.id]), level: outcome.level, durationMinutes: 10 + index * 3, format: index % 2 === 0 ? 'exercise' as const : 'article' as const, accessConditions: Object.freeze({ visibility: 'enrolled' as const, requiresEnrollment: true }), status: 'published' as const, createdAt: course.createdAt, updatedAt: course.updatedAt, version: course.version })));
  const attempts = freezeArray(selectStudentPerformanceEvidence(student.id).map((record) => record.attempt));
  return Object.freeze({ context, student, cohort, course, outcomes, content, attempts, completedContentIds: freezeArray([content[0]?.id].filter((value): value is ContentItemId => value !== undefined)), lockedContentIds: freezeArray([content[1]?.id].filter((value): value is ContentItemId => value !== undefined)) });
}

const copyScenario = (controls: StudentAnalyticsScenarioControls): StudentAnalyticsScenarioControls => Object.freeze({ ...DEFAULT_MOCK_SCENARIO, ...controls });

@Injectable()
export class StudentAnalyticsFacade {
  private readonly sessionStore = inject(SessionStore);
  private readonly transport = inject(MockTransport);
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly router = inject(Router, { optional: true });
  private readonly destroyRef = inject(DestroyRef);
  private readonly session = this.sessionStore.session;
  private readonly routeStudentIdState = signal('');
  private readonly queryFiltersState = signal<StudentAnalyticsFilters>(EMPTY_FILTERS);
  private readonly requestStateState = signal<AnalyticsRequestState>(EMPTY_STATE);
  private readonly filtersState = signal<StudentAnalyticsFilters>(EMPTY_FILTERS);
  private readonly optionsState = signal<AnalyticsFilterOptions>(EMPTY_OPTIONS);
  private readonly contextState = signal<StudentAnalyticsContext | null>(null);
  private readonly datasetState = signal<AnalyticsDataset | null>(null);
  private readonly scenarioState = signal<StudentAnalyticsScenarioControls>(copyScenario({}));
  private revision = 0;
  private slowTimer: ReturnType<typeof setTimeout> | null = null;

  readonly requestState: Signal<AnalyticsRequestState> = this.requestStateState.asReadonly();
  readonly filters: Signal<StudentAnalyticsFilters> = this.filtersState.asReadonly();
  readonly filterOptions: Signal<AnalyticsFilterOptions> = this.optionsState.asReadonly();
  readonly studentContext: Signal<StudentAnalyticsContext | null> = this.contextState.asReadonly();
  private readonly filteredAttempts = computed(() => {
    const dataset = this.datasetState();
    const filters = this.filtersState();
    if (dataset === null) return Object.freeze([]) as readonly MasteryAttempt[];
    const start = filters.dateRange === 'last-14-days' ? dateAtStartOfDay('2026-06-04') : filters.dateRange === 'last-30-days' ? dateAtStartOfDay('2026-05-19') : Number.NEGATIVE_INFINITY;
    return freezeArray(dataset.attempts.filter((attempt) => (filters.outcomeId === '' || attempt.outcomeId === filters.outcomeId) && Date.parse(attempt.answeredAt) >= start));
  });
  private readonly filteredOutcomes = computed(() => {
    const dataset = this.datasetState();
    const outcomeId = this.filtersState().outcomeId;
    return dataset === null ? Object.freeze([]) as readonly LearningOutcome[] : freezeArray(dataset.outcomes.filter((outcome) => outcomeId === '' || outcome.id === outcomeId));
  });
  readonly kpis: Signal<readonly AnalyticsKpi[]> = computed(() => {
    const dataset = this.datasetState();
    if (dataset === null) return EMPTY_KPIS;
    const attempts = this.filteredAttempts();
    const scores = selectOutcomeMastery(attempts);
    const measured = scores.filter((score) => score.isMeasured);
    const average = measured.length === 0 ? null : measured.reduce((sum, item) => sum + item.score, 0) / measured.length;
    const recommendations = this.recommendations();
    return freezeArray([
      Object.freeze({ key: 'mastery' as const, label: 'Current mastery', value: percentLabel(average), detail: average === null ? 'No measured outcomes' : `${measured.length} measured outcome${measured.length === 1 ? '' : 's'}`, marker: average === null ? '?' : average >= 0.6 ? '↑' : '!' }),
      Object.freeze({ key: 'outcomes' as const, label: 'Outcomes measured', value: `${measured.length}/${this.filteredOutcomes().length}`, detail: 'Verified mastery evidence', marker: '◎' }),
      Object.freeze({ key: 'attempts' as const, label: 'Attempts in range', value: `${attempts.length}`, detail: 'Scored answer history', marker: '↗' }),
      Object.freeze({ key: 'recommendations' as const, label: 'Next recommendations', value: `${recommendations.length}`, detail: 'Completed and locked excluded', marker: '→' })
    ]);
  });
  readonly trendRows: Signal<readonly MasteryTrendRow[]> = computed(() => this.computeTrendRows());
  readonly trendSummary: Signal<MasteryTrendSummary> = computed(() => {
    const rows = this.trendRows();
    const measured = rows.filter((row) => row.score !== null);
    if (measured.length === 0) return EMPTY_SUMMARY;
    const first = measured[0];
    const last = measured[measured.length - 1];
    if (first === undefined || last === undefined) return EMPTY_SUMMARY;
    const delta = (last.score ?? 0) - (first.score ?? 0);
    return Object.freeze({ text: `Mastery moved from ${first.scoreLabel} to ${last.scoreLabel} across ${measured.length} measured periods. Status labels remain available in the table.`, startLabel: first.periodLabel, endLabel: last.periodLabel, changeLabel: `${delta >= 0 ? '+' : ''}${Math.round(delta * 100)} percentage points` });
  });
  readonly heatmapRows: Signal<readonly HeatmapRow[]> = computed(() => this.computeHeatmapRows());
  readonly heatmapLegend: Signal<readonly HeatmapLegendItem[]> = computed(() => HEATMAP_LEGEND);
  readonly heatmapTableSummary = computed(() => {
    const rows = this.heatmapRows();
    if (rows.length === 0) return 'No outcome-by-period mastery cells are available.';
    return `${rows.length} outcome row${rows.length === 1 ? '' : 's'} across ${PERIODS.length} periods. Each cell includes a numeric score and a text mastery band.`;
  });
  readonly riskStatus: Signal<StudentRiskStatus> = computed(() => {
    const scores = selectOutcomeMastery(this.filteredAttempts()).filter((score) => score.isMeasured);
    if (scores.length === 0) return EMPTY_RISK;
    const average = scores.reduce((sum, score) => sum + score.score, 0) / scores.length;
    const developing = scores.filter((score) => score.band === 'developing' || score.band === 'approaching').length;
    if (developing >= Math.ceil(scores.length / 2)) return Object.freeze({ label: 'Elevated support need', detail: `${developing} of ${scores.length} measured outcomes need targeted practice.`, band: 'elevated' as const, marker: '!' });
    if (average < 0.6) return Object.freeze({ label: 'Moderate support need', detail: `Average mastery is ${percentLabel(average)} across the selected range.`, band: 'moderate' as const, marker: 'i' });
    return Object.freeze({ label: 'On track', detail: `Average mastery is ${percentLabel(average)} with no broad support signal.`, band: 'low' as const, marker: '✓' });
  });
  readonly recommendations: Signal<readonly StudentAnalyticsRecommendation[]> = computed(() => {
    const dataset = this.datasetState();
    if (dataset === null) return EMPTY_RECOMMENDATIONS;
    const selected = this.filteredOutcomes();
    const eligibleContent = dataset.content.filter((item) => selected.some((outcome) => item.learningOutcomeIds.includes(outcome.id)));
    const entries = recommendLearningPathFromAttempts({ courseId: dataset.course.id as CourseId, attempts: this.filteredAttempts(), completedContentIds: dataset.completedContentIds, lockedContentIds: dataset.lockedContentIds }, eligibleContent, selected);
    return freezeArray(entries.flatMap((entry) => {
      const content = eligibleContent.find((item) => item.id === entry.contentItemId);
      const reason = entry.reasonDetails;
      return content === undefined || reason === undefined || entry.isCompleted || entry.isLocked ? [] : [Object.freeze({ contentId: content.id, contentTitle: content.title, contentFormat: content.format, order: entry.order, reason })];
    }));
  });

  constructor() {
    if (this.route !== null) {
      this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => this.routeStudentIdState.set(params.get('id') ?? ''));
      this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => this.applyQueryFilters(params));
    }
    effect(() => {
      const accountId = this.session()?.accountId ?? null;
      const studentId = this.routeStudentIdState();
      const query = this.queryFiltersState();
      this.configure(accountId, studentId, query);
    });
  }

  setMockScenario(controls: StudentAnalyticsScenarioControls): void { this.scenarioState.set(copyScenario(controls)); }
  resetMockScenario(): void { this.scenarioState.set(copyScenario({})); }
  updateFilters(update: Partial<StudentAnalyticsFilters>): void {
    const next = this.canonicalizeFilters({ ...this.filtersState(), ...update });
    this.filtersState.set(next);
    this.queryFiltersState.set(next);
    this.navigateFilters(next);
  }
  clearFilters(): void { this.updateFilters(EMPTY_FILTERS); }
  retry(): void { this.refresh(); }
  refresh(): void { this.load().subscribe({ error: () => undefined }); }
  load(): Observable<AnalyticsDataset | null> {
    const revision = ++this.revision;
    this.cancelSlowTimer();
    this.datasetState.set(null);
    const session = this.session();
    const targetId = this.routeStudentIdState();
    const scope = studentScope(session, targetId);
    if (session === null || scope === null) {
      this.contextState.set(null);
      this.optionsState.set(EMPTY_OPTIONS);
      this.filtersState.set(EMPTY_FILTERS);
      this.requestStateState.set(Object.freeze({ status: 'unauthorized', message: session === null ? 'Sign in with an authorized account to view this student analytics scope.' : 'This student is outside the authorized analytics scope.', retryable: false }));
      return of(null);
    }
    const dataset = buildDataset(scope.student, scope.cohort, scope.course);
    this.contextState.set(dataset.context);
    this.requestStateState.set(Object.freeze({ status: 'loading' }));
    this.slowTimer = setTimeout(() => { if (revision === this.revision && this.requestStateState().status === 'loading') this.requestStateState.set(Object.freeze({ status: 'slow', message: 'The analytics response is taking longer than expected. You can wait or retry.', retryable: true })); }, 400);
    const scenario = this.scenarioState();
    const controls: Partial<MockScenarioControls> = { latencyMs: scenario.latencyMs, outcome: scenario.outcome, transientServiceFailures: scenario.transientServiceFailures, retryLimit: scenario.retryLimit, retryDelayMs: scenario.retryDelayMs };
    return this.transport.execute({ method: 'GET', url: `/student/${targetId}/analytics` }, () => dataset, controls).pipe(
      map(() => {
        if (revision !== this.revision || this.session()?.accountId !== session.accountId || this.routeStudentIdState() !== targetId) return dataset;
        this.cancelSlowTimer();
        if (scenario.emptyAnalytics === true || this.filteredAttemptCount(dataset) === 0) {
          this.requestStateState.set(Object.freeze({ status: 'empty', message: 'No analytics match the selected student and filters.' }));
          return null;
        }
        this.datasetState.set(dataset);
        this.requestStateState.set(Object.freeze({ status: 'ready' }));
        return dataset;
      }),
      catchError((error: unknown) => {
        if (revision === this.revision && this.session()?.accountId === session.accountId && this.routeStudentIdState() === targetId) {
          this.cancelSlowTimer();
          const normalized = normalizeApplicationError(error);
          this.datasetState.set(null);
          this.contextState.set(null);
          this.requestStateState.set(Object.freeze({ status: normalized.kind === 'unauthorized' ? 'unauthorized' : 'error', message: normalized.kind === 'unauthorized' ? 'This account is no longer authorized for this student analytics scope.' : normalized.userMessage, retryable: normalized.retryable }));
        }
        return throwError(() => error);
      })
    );
  }

  private configure(_accountId: string | null, studentId: string, query: StudentAnalyticsFilters): void {
    const scope = studentScope(this.session(), studentId);
    if (scope === null) {
      this.contextState.set(null); this.optionsState.set(EMPTY_OPTIONS); this.filtersState.set(EMPTY_FILTERS); this.load().subscribe({ error: () => undefined }); return;
    }
    const dataset = buildDataset(scope.student, scope.cohort, scope.course);
    const options: AnalyticsFilterOptions = Object.freeze({ courses: Object.freeze([Object.freeze({ value: dataset.course.id, label: `${dataset.course.code} · ${dataset.course.title}` })]), dateRanges: DATE_OPTIONS, outcomes: freezeArray(dataset.outcomes.map((outcome) => Object.freeze({ value: outcome.id, label: `${outcome.code} · ${outcome.title}` }))) });
    this.optionsState.set(options);
    const next = this.canonicalizeFilters(query, options);
    this.filtersState.set(next);
    this.contextState.set(dataset.context);
    if (next.courseId !== query.courseId || next.dateRange !== query.dateRange || next.outcomeId !== query.outcomeId) this.navigateFilters(next);
    this.load().subscribe({ error: () => undefined });
  }
  private applyQueryFilters(params: ParamMap): void {
    const next = Object.freeze({ courseId: params.get('course') ?? '', dateRange: params.get('date') ?? 'all', outcomeId: params.get('outcome') ?? '' });
    const current = this.queryFiltersState();
    if (next.courseId !== current.courseId || next.dateRange !== current.dateRange || next.outcomeId !== current.outcomeId) this.queryFiltersState.set(next);
  }
  private canonicalizeFilters(value: StudentAnalyticsFilters, options = this.optionsState()): StudentAnalyticsFilters {
    const valid = (items: readonly AnalyticsFilterOption[], candidate: string): string => items.some((item) => item.value === candidate) ? candidate : '';
    const validDate = options.dateRanges.some((item) => item.value === value.dateRange) ? value.dateRange : 'all';
    return Object.freeze({ courseId: valid(options.courses, value.courseId), dateRange: validDate, outcomeId: valid(options.outcomes, value.outcomeId) });
  }
  private navigateFilters(filters: StudentAnalyticsFilters): void {
    if (this.router === null || this.route === null) return;
    void this.router.navigate([], { relativeTo: this.route, queryParams: { course: filters.courseId || null, date: filters.dateRange === 'all' ? null : filters.dateRange, outcome: filters.outcomeId || null }, queryParamsHandling: 'merge' });
  }
  private filteredAttemptCount(dataset: AnalyticsDataset): number {
    const filters = this.filtersState();
    const start = filters.dateRange === 'last-14-days' ? dateAtStartOfDay('2026-06-04') : filters.dateRange === 'last-30-days' ? dateAtStartOfDay('2026-05-19') : Number.NEGATIVE_INFINITY;
    return dataset.attempts.filter((attempt) => (filters.outcomeId === '' || attempt.outcomeId === filters.outcomeId) && Date.parse(attempt.answeredAt) >= start).length;
  }
  private computeTrendRows(): readonly MasteryTrendRow[] {
    const attempts = this.filteredAttempts();
    const outcomes = this.filteredOutcomes();
    if (attempts.length === 0 || outcomes.length === 0) return EMPTY_TREND;
    const outcomeIds = new Set(outcomes.map((outcome) => outcome.id));
    return freezeArray(PERIODS.map((period) => {
      const periodAttempts = attempts.filter((attempt) => attempt.answeredAt.slice(0, 10) <= period.value);
      const scores = selectOutcomeMastery(periodAttempts).filter((score) => outcomeIds.has(score.outcomeId) && score.isMeasured);
      const score = scores.length === 0 ? null : scores.reduce((sum, item) => sum + item.score, 0) / scores.length;
      const statusLabel = score === null ? 'No attempt in this period' : score >= 0.85 ? 'Advanced' : score >= 0.6 ? 'Proficient' : score >= 0.4 ? 'Approaching' : 'Developing';
      return Object.freeze({ period: period.value, periodLabel: period.label, score, scoreLabel: percentLabel(score), bandLabel: statusLabel, statusLabel, attemptCount: periodAttempts.length });
    }));
  }
  private computeHeatmapRows(): readonly HeatmapRow[] {
    const attempts = this.filteredAttempts();
    const outcomes = this.filteredOutcomes();
    if (attempts.length === 0 || outcomes.length === 0) return EMPTY_HEATMAP;
    const scoresByPeriod = PERIODS.map((period) => {
      const periodAttempts = attempts.filter((attempt) => attempt.answeredAt.slice(0, 10) <= period.value);
      return new Map(selectOutcomeMastery(periodAttempts).map((score) => [score.outcomeId, score] as const));
    });
    return freezeArray(outcomes.slice(0, 12).map((outcome) => Object.freeze({ outcomeId: outcome.id, outcomeCode: outcome.code, outcomeTitle: outcome.title, cells: freezeArray(PERIODS.map((period, index) => {
      const score = scoresByPeriod[index]?.get(outcome.id);
      return Object.freeze({ period: period.value, periodLabel: period.label, score: score?.isMeasured ? score.score : null, scoreLabel: score?.isMeasured ? percentLabel(score.score) : 'No data', band: score?.isMeasured ? score.band : 'unmeasured', statusLabel: score?.isMeasured ? `${score.band} mastery` : 'No attempt' });
    })) })));
  }
  private cancelSlowTimer(): void { if (this.slowTimer !== null) { clearTimeout(this.slowTimer); this.slowTimer = null; } }
}
