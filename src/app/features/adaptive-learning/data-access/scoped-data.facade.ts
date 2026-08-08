import { DestroyRef, Injectable, computed, effect, inject, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, type ParamMap } from '@angular/router';
import { catchError, map, of, throwError, type Observable } from 'rxjs';

import { normalizeApplicationError } from '../../../core/api/api-error';
import { DEFAULT_MOCK_SCENARIO, MockTransport, type MockScenarioControls } from '../../../core/api/mock-transport';
import { decideDataScopeAccess, type AuthSession, type DataScopeGrant, type RoleCode } from '../../../core/auth/authorization';
import { SessionStore } from '../../../core/auth/session.store';
import { recommendLearningPathFromAttempts } from '../../analytics/domain/recommendation-engine';
import { selectOutcomeMasteryById } from '../../analytics/domain/mastery-calculation';
import { createMasteryAttempt, type MasteryAttempt } from '../../analytics/models/mastery.models';
import type { ContentItem, ContentItemId, CourseId, LearningOutcome, LearningPathReason, LearningOutcomeId } from '../../learning-domain/models/learning-domain.models';
import { createSeedData } from './seed-data.factory';

export type ScopedDataKind = 'course' | 'cohort' | 'student';
export type ScopedDataAccessMode = 'granted' | 'read-only';
export type ScopedDataRecord = Readonly<{ readonly id: string; readonly kind: ScopedDataKind; readonly kindLabel: string; readonly primaryText: string; readonly secondaryContext: string; readonly accessMode: ScopedDataAccessMode }>;
type CandidateRecord = Readonly<{ readonly id: string; readonly kind: ScopedDataKind; readonly kindLabel: string; readonly primaryText: string; readonly secondaryContext: string }>;
type CourseContext = Readonly<{ readonly code: string; readonly title: string }>;
type CohortContext = Readonly<{ readonly code: string; readonly name: string; readonly courseId: string }>;

export type DashboardRequestStatus = 'idle' | 'loading' | 'slow' | 'ready' | 'empty' | 'error' | 'unauthorized';
export type DashboardWidgetKey = 'kpis' | 'progress' | 'recommendations' | 'outcomes' | 'upcoming' | 'activity';
export type DashboardWidgetStatus = 'ready' | 'empty' | 'error';
export type DashboardFilterKey = 'termId' | 'courseId' | 'cohortId' | 'dateRange';
export type DashboardRequestState = Readonly<{ readonly status: DashboardRequestStatus; readonly message?: string; readonly retryable?: boolean }>;
export type DashboardFilterOption = Readonly<{ readonly value: string; readonly label: string }>;
export type DashboardFilterOptions = Readonly<{ readonly terms: readonly DashboardFilterOption[]; readonly courses: readonly DashboardFilterOption[]; readonly cohorts: readonly DashboardFilterOption[]; readonly dateRanges: readonly DashboardFilterOption[] }>;
export type DashboardFilters = Readonly<{ readonly termId: string; readonly courseId: string; readonly cohortId: string; readonly dateRange: string }>;
export type DashboardKpi = Readonly<{ readonly key: 'learners' | 'mastery' | 'recommendations' | 'upcoming'; readonly label: string; readonly value: string; readonly trend: string; readonly trendDirection: 'up' | 'down' | 'flat' }>;
export type DashboardProgressSummary = Readonly<{ readonly outcomeId: LearningOutcomeId; readonly outcomeCode: string; readonly outcomeTitle: string; readonly score: number; readonly scoreLabel: string; readonly band: string; readonly attemptCount: number }>;
export type DashboardOutcomeSummary = DashboardProgressSummary & Readonly<{ readonly courseLabel: string; readonly accessibleSummary: string }>;
export type DashboardUpcomingItem = Readonly<{ readonly id: string; readonly title: string; readonly courseLabel: string; readonly date: string; readonly kind: 'Assessment' | 'Study item'; readonly scopeLabel: string }>;
export type DashboardActivityItem = Readonly<{ readonly id: string; readonly label: string; readonly context: string; readonly occurredAt: string; readonly marker: 'success' | 'info' | 'warning' }>;
export type DashboardRecommendation = Readonly<{ readonly contentId: ContentItemId; readonly contentTitle: string; readonly contentFormat: string; readonly order: number; readonly reason: LearningPathReason }>;
export type ScopedDataScenarioControls = Readonly<Partial<MockScenarioControls> & { readonly widgetFailures?: readonly DashboardWidgetKey[]; readonly emptyAuthorizedScope?: boolean }>;

export type DashboardData = Readonly<{ readonly kpis: readonly DashboardKpi[]; readonly progressSummary: readonly DashboardProgressSummary[]; readonly weakOutcomes: readonly DashboardOutcomeSummary[]; readonly strongOutcomes: readonly DashboardOutcomeSummary[]; readonly upcomingItems: readonly DashboardUpcomingItem[]; readonly activity: readonly DashboardActivityItem[]; readonly recommendations: readonly DashboardRecommendation[] }>;
type DashboardFixture = Readonly<{ readonly courseId: CourseId; readonly courseLabel: string; readonly outcomes: readonly LearningOutcome[]; readonly content: readonly ContentItem[]; readonly attempts: readonly MasteryAttempt[]; readonly completedContentIds: readonly ContentItemId[]; readonly lockedContentIds: readonly ContentItemId[] }>;

const EMPTY_RECORDS: readonly ScopedDataRecord[] = Object.freeze([]);
const EMPTY_DATA: DashboardData = Object.freeze({ kpis: Object.freeze([]), progressSummary: Object.freeze([]), weakOutcomes: Object.freeze([]), strongOutcomes: Object.freeze([]), upcomingItems: Object.freeze([]), activity: Object.freeze([]), recommendations: Object.freeze([]) });
const WIDGET_KEYS: readonly DashboardWidgetKey[] = Object.freeze(['kpis', 'progress', 'recommendations', 'outcomes', 'upcoming', 'activity']);
const EMPTY_WIDGET_STATES: Readonly<Record<DashboardWidgetKey, DashboardWidgetStatus>> = Object.freeze({ kpis: 'empty', progress: 'empty', recommendations: 'empty', outcomes: 'empty', upcoming: 'empty', activity: 'empty' });
const EMPTY_FILTERS: DashboardFilters = Object.freeze({ termId: '', courseId: '', cohortId: '', dateRange: 'all' });
const DATE_OPTIONS: readonly DashboardFilterOption[] = Object.freeze([Object.freeze({ value: 'all', label: 'All upcoming dates' }), Object.freeze({ value: 'next-7-days', label: 'Next 7 days' }), Object.freeze({ value: 'next-30-days', label: 'Next 30 days' })]);
const EMPTY_FILTER_OPTIONS: DashboardFilterOptions = Object.freeze({ terms: Object.freeze([]), courses: Object.freeze([]), cohorts: Object.freeze([]), dateRanges: DATE_OPTIONS });
const statusLabel = (status: string): string => `${status.slice(0, 1).toUpperCase()}${status.slice(1)}`;

const buildCandidateCatalog = (): readonly CandidateRecord[] => {
  const seed = createSeedData();
  const courseContexts = new Map<string, CourseContext>(seed.courses.map((course) => [course.id, Object.freeze({ code: course.code, title: course.title })] as const));
  const cohortContexts = new Map<string, CohortContext>(seed.cohorts.map((cohort) => [cohort.id, Object.freeze({ code: cohort.code, name: cohort.name, courseId: cohort.courseId })] as const));
  const candidates: CandidateRecord[] = [];
  for (const course of seed.courses) candidates.push(Object.freeze({ id: course.id, kind: 'course', kindLabel: 'Course', primaryText: course.title, secondaryContext: `${course.code} · Status: ${statusLabel(course.status)}` }));
  for (const cohort of seed.cohorts) {
    const course = courseContexts.get(cohort.courseId);
    candidates.push(Object.freeze({ id: cohort.id, kind: 'cohort', kindLabel: 'Cohort', primaryText: `${cohort.code} — ${cohort.name}`, secondaryContext: `${course?.code ?? 'Course context unavailable'} · Status: ${statusLabel(cohort.status)}` }));
  }
  for (const student of seed.students) {
    const cohort = cohortContexts.get(student.cohortId);
    candidates.push(Object.freeze({ id: student.id, kind: 'student', kindLabel: 'Student', primaryText: student.pseudonym, secondaryContext: cohort === undefined ? 'Cohort context unavailable' : `${cohort.code} — ${cohort.name}` }));
  }
  return Object.freeze(candidates);
};
const CANDIDATE_CATALOG = buildCandidateCatalog();
const roleLabelFor = (roleCode: RoleCode | undefined): string => roleCode === undefined ? 'No role selected' : roleCode.toLowerCase().split('_').map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(' ');
const matchingGrant = (session: AuthSession, candidate: CandidateRecord): DataScopeGrant | undefined => session.account.scopeGrants.find((grant) => grant.kind === candidate.kind && (grant.global === true || grant.ids.includes(candidate.id)));

const buildDashboardFixtures = (): readonly DashboardFixture[] => {
  const seed = createSeedData();
  return seed.courses.filter((course) => course.status === 'active').map((course) => {
    const outcomes = Object.freeze(seed.learningOutcomes.filter((outcome) => outcome.courseId === course.id).map((outcome) => Object.freeze({ id: outcome.id, courseId: outcome.courseId, code: outcome.code, title: outcome.title, description: outcome.description, level: outcome.level, status: 'published' as const, prerequisiteOutcomeIds: Object.freeze([...outcome.prerequisiteOutcomeIds]), createdAt: outcome.createdAt, updatedAt: outcome.updatedAt, version: outcome.version })));
    const content = Object.freeze(outcomes.map((outcome, index) => Object.freeze({ id: `CONTENT-${course.code}-${String(index + 1).padStart(2, '0')}` as ContentItemId, courseId: course.id, title: `Practice: ${outcome.title}`, description: `A scoped practice item for ${outcome.code}.`, learningOutcomeIds: Object.freeze([outcome.id]), level: outcome.level, durationMinutes: 12 + index * 4, format: index % 2 === 0 ? 'exercise' as const : 'article' as const, accessConditions: Object.freeze({ visibility: 'enrolled' as const, requiresEnrollment: true }), status: 'published' as const, createdAt: course.createdAt, updatedAt: course.updatedAt, version: course.version })));
    const fractions = [0.24, 0.82, 0.48, 0.91, 0.64, 0.36] as const;
    const attempts = Object.freeze(outcomes.map((outcome, index) => createMasteryAttempt({ outcomeId: outcome.id, questionId: `QUESTION-${course.code}-${String(index + 1).padStart(2, '0')}`, difficulty: index % 3 === 0 ? 'easy' : index % 3 === 1 ? 'hard' : 'medium', earnedFraction: fractions[index] ?? 0.5, answeredAt: `2026-05-${String(index + 10).padStart(2, '0')}T10:00:00.000Z` })));
    return Object.freeze({ courseId: course.id, courseLabel: `${course.code} · ${course.title}`, outcomes, content, attempts, completedContentIds: Object.freeze([content[0]?.id].filter((id): id is ContentItemId => id !== undefined)), lockedContentIds: Object.freeze([content[1]?.id].filter((id): id is ContentItemId => id !== undefined)) });
  });
};
const DASHBOARD_FIXTURES = buildDashboardFixtures();
const freezeData = (value: DashboardData): DashboardData => Object.freeze({ kpis: Object.freeze([...value.kpis]), progressSummary: Object.freeze([...value.progressSummary]), weakOutcomes: Object.freeze([...value.weakOutcomes]), strongOutcomes: Object.freeze([...value.strongOutcomes]), upcomingItems: Object.freeze([...value.upcomingItems]), activity: Object.freeze([...value.activity]), recommendations: Object.freeze([...value.recommendations]) });

@Injectable()
export class ScopedDataFacade {
  private readonly sessionStore = inject(SessionStore);
  private readonly transport = inject(MockTransport);
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly router = inject(Router, { optional: true });
  private readonly destroyRef = inject(DestroyRef);
  private readonly session = this.sessionStore.session;
  private readonly requestStateState = signal<DashboardRequestState>({ status: 'unauthorized' });
  private readonly dashboardDataState = signal<DashboardData>(EMPTY_DATA);
  private readonly widgetStatesState = signal<Readonly<Record<DashboardWidgetKey, DashboardWidgetStatus>>>(EMPTY_WIDGET_STATES);
  private readonly filtersState = signal<DashboardFilters>(EMPTY_FILTERS);
  private readonly filterOptionsState = signal<DashboardFilterOptions>(EMPTY_FILTER_OPTIONS);
  private readonly scenarioState = signal<ScopedDataScenarioControls>(Object.freeze({ ...DEFAULT_MOCK_SCENARIO }));
  private revision = 0;
  private slowTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAccountId: string | null | undefined;

  readonly isAuthenticated = computed(() => this.session() !== null);
  readonly accountLabel = computed(() => this.session()?.account.displayLabel ?? 'No account selected');
  readonly roleLabel = computed(() => roleLabelFor(this.session()?.account.roleCode));
  readonly visibleRecords = computed<readonly ScopedDataRecord[]>(() => {
    const session = this.session();
    if (session === null) return EMPTY_RECORDS;
    const records: ScopedDataRecord[] = [];
    for (const candidate of CANDIDATE_CATALOG) {
      const decision = decideDataScopeAccess(session, { kind: candidate.kind, id: candidate.id });
      const grant = matchingGrant(session, candidate);
      if (!decision.allowed || grant === undefined) continue;
      records.push(Object.freeze({ id: candidate.id, kind: candidate.kind, kindLabel: candidate.kindLabel, primaryText: candidate.primaryText, secondaryContext: candidate.secondaryContext, accessMode: grant.readOnly === true ? 'read-only' : 'granted' }));
    }
    return Object.freeze(records);
  });
  readonly requestState: Signal<DashboardRequestState> = this.requestStateState.asReadonly();
  readonly filters: Signal<DashboardFilters> = this.filtersState.asReadonly();
  readonly roleScopedFilters: Signal<DashboardFilterOptions> = this.filterOptionsState.asReadonly();
  readonly kpis: Signal<readonly DashboardKpi[]> = computed(() => this.dashboardDataState().kpis);
  readonly progressSummary: Signal<readonly DashboardProgressSummary[]> = computed(() => this.dashboardDataState().progressSummary);
  readonly weakOutcomes: Signal<readonly DashboardOutcomeSummary[]> = computed(() => this.dashboardDataState().weakOutcomes);
  readonly strongOutcomes: Signal<readonly DashboardOutcomeSummary[]> = computed(() => this.dashboardDataState().strongOutcomes);
  readonly upcomingItems: Signal<readonly DashboardUpcomingItem[]> = computed(() => this.dashboardDataState().upcomingItems);
  readonly activity: Signal<readonly DashboardActivityItem[]> = computed(() => this.dashboardDataState().activity);
  readonly recommendations: Signal<readonly DashboardRecommendation[]> = computed(() => this.dashboardDataState().recommendations);
  readonly widgetStates: Signal<Readonly<Record<DashboardWidgetKey, DashboardWidgetStatus>>> = this.widgetStatesState.asReadonly();
  readonly accessibleProgressSummary = computed(() => {
    const rows = this.progressSummary();
    if (rows.length === 0) return 'No mastery measurements are available in the authorized scope.';
    return rows.map((row) => `${row.outcomeCode}, ${row.outcomeTitle}: ${row.scoreLabel}, ${row.band}.`).join(' ');
  });

  constructor() {
    if (this.route !== null) this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => this.applyQueryFilters(params));
    effect(() => {
      const accountId = this.session()?.accountId ?? null;
      if (accountId === this.lastAccountId) return;
      this.lastAccountId = accountId;
      this.refreshFilterOptions();
      this.refresh();
    });
  }

  setMockScenario(controls: ScopedDataScenarioControls): void {
    const widgetFailures = Object.freeze((controls.widgetFailures ?? []).filter((key): key is DashboardWidgetKey => WIDGET_KEYS.includes(key)));
    this.scenarioState.set(Object.freeze({ ...DEFAULT_MOCK_SCENARIO, ...controls, widgetFailures }));
  }
  resetMockScenario(): void { this.scenarioState.set(Object.freeze({ ...DEFAULT_MOCK_SCENARIO })); }
  updateFilters(update: Partial<DashboardFilters>): void { const next = this.canonicalizeFilters({ ...this.filtersState(), ...update }); this.filtersState.set(next); this.navigateFilters(next); this.refresh(); }
  clearFilters(): void { const next = this.canonicalizeFilters(EMPTY_FILTERS); this.filtersState.set(next); this.navigateFilters(next); this.refresh(); }

  load(): Observable<DashboardData> {
    const revision = ++this.revision;
    this.cancelSlowTimer();
    this.clearDashboardData();
    const session = this.session();
    if (session === null) {
      this.requestStateState.set(Object.freeze({ status: 'unauthorized', message: 'Sign in with an authorized account to view this dashboard.', retryable: false }));
      return of(EMPTY_DATA);
    }
    if (this.visibleRecords().length === 0) {
      this.requestStateState.set(Object.freeze({ status: 'unauthorized', message: 'This account has no authorized learning dashboard scope.', retryable: false }));
      return of(EMPTY_DATA);
    }
    this.requestStateState.set(Object.freeze({ status: 'loading' }));
    this.slowTimer = setTimeout(() => {
      if (revision === this.revision && this.requestStateState().status === 'loading') this.requestStateState.set(Object.freeze({ status: 'slow', message: 'The dashboard is still loading. You can wait or try again.', retryable: true }));
    }, 400);
    const scenario = this.scenarioState();
    const transportControls: Partial<MockScenarioControls> = { latencyMs: scenario.latencyMs, outcome: scenario.outcome, transientServiceFailures: scenario.transientServiceFailures, retryLimit: scenario.retryLimit, retryDelayMs: scenario.retryDelayMs };
    return this.transport.execute({ method: 'GET', url: '/learning/dashboard' }, () => Object.freeze({ accountId: session.accountId }), transportControls).pipe(
      map(() => this.buildDashboardData()),
      map((data) => {
        if (revision !== this.revision || this.session()?.accountId !== session.accountId) return data;
        this.cancelSlowTimer();
        const emptyScope = scenario.emptyAuthorizedScope === true;
        const nextData = emptyScope ? EMPTY_DATA : data;
        this.dashboardDataState.set(nextData);
        this.widgetStatesState.set(emptyScope ? EMPTY_WIDGET_STATES : this.widgetStatesFor(scenario.widgetFailures ?? []));
        this.requestStateState.set(Object.freeze({ status: emptyScope || this.hasNoDashboardItems(nextData) ? 'empty' : 'ready', ...(emptyScope ? { message: 'No learning data matches the authorized filters.' } : {}) }));
        return nextData;
      }),
      catchError((error: unknown) => {
        if (revision === this.revision && this.session()?.accountId === session.accountId) {
          this.cancelSlowTimer();
          const normalized = normalizeApplicationError(error);
          this.clearDashboardData();
          this.requestStateState.set(Object.freeze({ status: normalized.kind === 'unauthorized' ? 'unauthorized' : 'error', message: normalized.kind === 'unauthorized' ? 'This account is no longer authorized for the dashboard scope.' : normalized.userMessage, retryable: normalized.retryable }));
        }
        return throwError(() => error);
      })
    );
  }
  refresh(): void { this.load().subscribe({ error: () => undefined }); }
  retry(): void { this.refresh(); }
  retryWidget(widget: DashboardWidgetKey): void {
    const current = this.widgetStatesState();
    if (!WIDGET_KEYS.includes(widget) || current[widget] !== 'error') return;
    this.widgetStatesState.set(Object.freeze({ ...current, [widget]: 'ready' }));
  }
  widgetStatus(widget: DashboardWidgetKey): DashboardWidgetStatus { return this.widgetStatesState()[widget]; }
  filterLabel(key: DashboardFilterKey): string {
    const value = this.filtersState()[key];
    if (value === '') return key === 'dateRange' ? 'All upcoming dates' : 'All';
    const options = key === 'termId' ? this.filterOptionsState().terms : key === 'courseId' ? this.filterOptionsState().courses : key === 'cohortId' ? this.filterOptionsState().cohorts : DATE_OPTIONS;
    return options.find((option) => option.value === value)?.label ?? 'All';
  }

  private refreshFilterOptions(): void {
    const session = this.session();
    if (session === null) { this.filterOptionsState.set(EMPTY_FILTER_OPTIONS); this.filtersState.set(EMPTY_FILTERS); return; }
    const records = this.visibleRecords();
    const seed = createSeedData();
    const courseIds = new Set(records.filter((record) => record.kind === 'course').map((record) => record.id));
    const cohortIds = new Set(records.filter((record) => record.kind === 'cohort').map((record) => record.id));
    for (const cohort of seed.cohorts) if (cohortIds.has(cohort.id)) courseIds.add(cohort.courseId);
    const courses = seed.courses.filter((course) => courseIds.has(course.id));
    const cohorts = seed.cohorts.filter((cohort) => cohortIds.has(cohort.id));
    const termIds = new Set(courses.map((course) => course.termId));
    const options: DashboardFilterOptions = Object.freeze({ terms: Object.freeze(seed.terms.filter((term) => termIds.has(term.id)).map((term) => Object.freeze({ value: term.id, label: term.name }))), courses: Object.freeze(courses.map((course) => Object.freeze({ value: course.id, label: `${course.code} · ${course.title}` }))), cohorts: Object.freeze(cohorts.map((cohort) => Object.freeze({ value: cohort.id, label: `${cohort.code} · ${cohort.name}` }))), dateRanges: DATE_OPTIONS });
    this.filterOptionsState.set(options);
    this.filtersState.set(this.canonicalizeFilters(this.filtersState(), options));
  }
  private canonicalizeFilters(value: DashboardFilters, options = this.filterOptionsState()): DashboardFilters {
    const values = (items: readonly DashboardFilterOption[]): Set<string> => new Set(items.map((item) => item.value));
    const terms = values(options.terms); const courses = values(options.courses); const cohorts = values(options.cohorts); const dates = values(options.dateRanges);
    return Object.freeze({ termId: terms.has(value.termId) ? value.termId : '', courseId: courses.has(value.courseId) ? value.courseId : '', cohortId: cohorts.has(value.cohortId) ? value.cohortId : '', dateRange: dates.has(value.dateRange) ? value.dateRange : 'all' });
  }
  private applyQueryFilters(params: ParamMap): void {
    const next = this.canonicalizeFilters({ termId: params.get('term') ?? '', courseId: params.get('course') ?? '', cohortId: params.get('cohort') ?? '', dateRange: params.get('date') ?? 'all' });
    const current = this.filtersState();
    if (next.termId !== current.termId || next.courseId !== current.courseId || next.cohortId !== current.cohortId || next.dateRange !== current.dateRange) { this.filtersState.set(next); this.refresh(); }
  }
  private navigateFilters(filters: DashboardFilters): void {
    if (this.router === null || this.route === null) return;
    void this.router.navigate([], { relativeTo: this.route, queryParams: { term: filters.termId || null, course: filters.courseId || null, cohort: filters.cohortId || null, date: filters.dateRange === 'all' ? null : filters.dateRange }, queryParamsHandling: 'merge' });
  }

  private buildDashboardData(): DashboardData {
    const scope = this.scopedFixtures();
    if (scope.length === 0) return EMPTY_DATA;
    const progressScores = scope.flatMap((fixture) => {
      const scores = selectOutcomeMasteryById(fixture.attempts);
      return fixture.outcomes.map((outcome): DashboardProgressSummary => {
        const score = scores[outcome.id];
        return Object.freeze({ outcomeId: outcome.id, outcomeCode: outcome.code, outcomeTitle: outcome.title, score: score?.score ?? 0, scoreLabel: score?.isMeasured ? `${Math.round(score.score * 100)}%` : 'Not measured', band: score?.band ?? 'unmeasured', attemptCount: score?.attemptCount ?? 0 });
      });
    });
    const courseForOutcome = (outcomeId: LearningOutcomeId): string => scope.find((fixture) => fixture.outcomes.some((item) => item.id === outcomeId))?.courseLabel ?? '';
    const weakOutcomes = progressScores.filter((outcome) => outcome.band === 'developing' || outcome.band === 'approaching').map((outcome) => Object.freeze({ ...outcome, courseLabel: courseForOutcome(outcome.outcomeId), accessibleSummary: `${outcome.outcomeTitle} is ${outcome.scoreLabel} (${outcome.band}).` }));
    const strongOutcomes = progressScores.filter((outcome) => outcome.band === 'proficient' || outcome.band === 'advanced').map((outcome) => Object.freeze({ ...outcome, courseLabel: courseForOutcome(outcome.outcomeId), accessibleSummary: `${outcome.outcomeTitle} is ${outcome.scoreLabel} (${outcome.band}).` }));
    const recommendations = scope.flatMap((fixture) => {
      const entries = recommendLearningPathFromAttempts({ courseId: fixture.courseId as ContentItem['courseId'], attempts: fixture.attempts, completedContentIds: fixture.completedContentIds, lockedContentIds: fixture.lockedContentIds }, fixture.content, fixture.outcomes);
      return entries.flatMap((entry) => {
        const content = fixture.content.find((item) => item.id === entry.contentItemId);
        return content === undefined || entry.reasonDetails === undefined ? [] : [Object.freeze({ contentId: content.id, contentTitle: content.title, contentFormat: content.format, order: entry.order, reason: entry.reasonDetails })];
      });
    });
    const average = progressScores.length === 0 ? 0 : progressScores.reduce((sum, item) => sum + item.score, 0) / progressScores.length;
    const upcoming = scope.flatMap((fixture) => [Object.freeze({ id: `ASSESSMENT-${fixture.courseId}`, title: `${fixture.courseLabel} checkpoint`, courseLabel: fixture.courseLabel, date: '2026-08-18', kind: 'Assessment' as const, scopeLabel: this.roleLabel() }), Object.freeze({ id: `STUDY-${fixture.courseId}`, title: fixture.content[2]?.title ?? 'Next study item', courseLabel: fixture.courseLabel, date: '2026-08-21', kind: 'Study item' as const, scopeLabel: this.roleLabel() })]);
    const activity = scope.flatMap((fixture) => [Object.freeze({ id: `ACTIVITY-COURSE-${fixture.courseId}`, label: `${fixture.courseLabel} dashboard refreshed`, context: 'Authorized scope', occurredAt: '2026-08-08T09:20:00.000Z', marker: 'info' as const }), Object.freeze({ id: `ACTIVITY-PRACTICE-${fixture.courseId}`, label: `${fixture.outcomes[0]?.code ?? 'Outcome'} practice completed`, context: 'Learning activity', occurredAt: '2026-08-07T15:10:00.000Z', marker: 'success' as const })]);
    return freezeData({
      kpis: Object.freeze([Object.freeze({ key: 'learners', label: 'Learners in scope', value: this.scopedLearnerCount().toString(), trend: 'Scoped total', trendDirection: 'flat' as const }), Object.freeze({ key: 'mastery', label: 'Average mastery', value: `${Math.round(average * 100)}%`, trend: 'Across measured outcomes', trendDirection: average >= 0.6 ? 'up' as const : 'down' as const }), Object.freeze({ key: 'recommendations', label: 'Study recommendations', value: recommendations.length.toString(), trend: `${scope.length} course${scope.length === 1 ? '' : 's'}`, trendDirection: 'flat' as const }), Object.freeze({ key: 'upcoming', label: 'Upcoming items', value: upcoming.length.toString(), trend: 'Next 30 days', trendDirection: 'flat' as const })]),
      progressSummary: Object.freeze(progressScores), weakOutcomes: Object.freeze(weakOutcomes), strongOutcomes: Object.freeze(strongOutcomes), upcomingItems: Object.freeze(upcoming), activity: Object.freeze(activity), recommendations: Object.freeze(recommendations)
    });
  }
  private scopedFixtures(): readonly DashboardFixture[] {
    const records = this.visibleRecords();
    const courseIds = new Set(records.filter((record) => record.kind === 'course').map((record) => record.id));
    const seed = createSeedData();
    for (const cohort of seed.cohorts) if (records.some((record) => record.kind === 'cohort' && record.id === cohort.id)) courseIds.add(cohort.courseId);
    const filters = this.filtersState();
    const termCourseIds = new Set(seed.courses.filter((course) => filters.termId === '' || course.termId === filters.termId).map((course) => course.id));
    const cohortCourseIds = new Set(seed.cohorts.filter((cohort) => filters.cohortId === '' || cohort.id === filters.cohortId).map((cohort) => cohort.courseId));
    return DASHBOARD_FIXTURES.filter((fixture) => courseIds.has(fixture.courseId) && termCourseIds.has(fixture.courseId) && (filters.courseId === '' || fixture.courseId === filters.courseId) && (filters.cohortId === '' || cohortCourseIds.has(fixture.courseId)));
  }
  private scopedLearnerCount(): number {
    const records = this.visibleRecords();
    const explicitStudents = records.filter((record) => record.kind === 'student').length;
    if (explicitStudents > 0) return explicitStudents;
    const seed = createSeedData();
    const cohortIds = new Set(records.filter((record) => record.kind === 'cohort').map((record) => record.id));
    return seed.cohorts.filter((cohort) => cohortIds.has(cohort.id)).reduce((sum, cohort) => sum + cohort.studentIds.length, 0);
  }
  private hasNoDashboardItems(data: DashboardData): boolean { return data.kpis.length === 0 || (data.progressSummary.length === 0 && data.recommendations.length === 0 && data.upcomingItems.length === 0 && data.activity.length === 0); }
  private widgetStatesFor(failures: readonly DashboardWidgetKey[]): Readonly<Record<DashboardWidgetKey, DashboardWidgetStatus>> {
    const failed = new Set(failures);
    return Object.freeze(Object.fromEntries(WIDGET_KEYS.map((key) => [key, failed.has(key) ? 'error' : 'ready'])) as Record<DashboardWidgetKey, DashboardWidgetStatus>);
  }
  private clearDashboardData(): void { this.dashboardDataState.set(EMPTY_DATA); this.widgetStatesState.set(EMPTY_WIDGET_STATES); }
  private cancelSlowTimer(): void { if (this.slowTimer !== null) { clearTimeout(this.slowTimer); this.slowTimer = null; } }
}
