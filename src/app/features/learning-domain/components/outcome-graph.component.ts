import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  InjectionToken,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
  type AfterViewInit,
  type OnDestroy,
  type OnInit
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { distinctUntilChanged, startWith } from 'rxjs';
import cytoscape from 'cytoscape';

import { LearningDomainFacade } from '../data-access/learning-domain.facade';
import { LearningDomainError, type ContentAccessContext } from '../data-access/learning-domain.repository';
import {
  LIFECYCLE_STATES,
  type ContentItem,
  type Course,
  type CourseId,
  type LearningOutcome,
  type LearningOutcomeId,
  type LearningOutcomeStatus,
  type LearningPathEntry,
  type LifecycleState
} from '../models/learning-domain.models';

export type OutcomeGraphViewMode = 'graph' | 'list';
export type OutcomeGraphFeedbackKind = 'success' | 'error' | 'validation' | 'conflict' | null;

export interface OutcomeGraphNode {
  readonly id: LearningOutcomeId;
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly courseId: CourseId;
  readonly courseLabel: string;
  readonly level: number;
  readonly status: LearningOutcomeStatus;
  readonly prerequisiteIds: readonly LearningOutcomeId[];
  readonly prerequisiteCount: number;
  readonly dependentIds: readonly LearningOutcomeId[];
  readonly dependentCount: number;
  readonly affectedCount: number;
  readonly content: readonly ContentItem[];
  readonly isRisky: boolean;
  readonly riskLabel: string;
  readonly masteryLabel: 'Not measured';
}

export interface OutcomeGraphEdge {
  readonly id: string;
  readonly source: LearningOutcomeId;
  readonly target: LearningOutcomeId;
}

export interface OutcomeGraphModel {
  readonly nodes: readonly OutcomeGraphNode[];
  readonly edges: readonly OutcomeGraphEdge[];
}

export interface OutcomeGraphRecommendation {
  readonly item: ContentItem;
  readonly entry: LearningPathEntry;
}

export interface OutcomeGraphFilters {
  readonly search?: string;
  readonly courseId?: CourseId;
  readonly level?: number;
  readonly status?: LifecycleState;
}

export interface OutcomeGraphElement {
  readonly group: 'nodes' | 'edges';
  readonly data: Readonly<Record<string, string | number>>;
}

export interface OutcomeGraphCore {
  on(event: string, selector: string, listener: (event: { target: { id(): string } }) => void): void;
  batch(callback: () => void): void;
  elements(): { remove(): void };
  add(elements: readonly OutcomeGraphElement[]): void;
  layout(options: Readonly<Record<string, unknown>>): { run(): void };
  zoom(): number;
  zoom(level: number): void;
  fit(target?: unknown, padding?: number): void;
  getElementById(id: string): { focus?: () => void };
  destroy(): void;
}

export type OutcomeGraphFactory = (options: Readonly<Record<string, unknown>>) => OutcomeGraphCore;

export const OUTCOME_GRAPH_FACTORY = new InjectionToken<OutcomeGraphFactory>('OUTCOME_GRAPH_FACTORY');

const defaultGraphFactory: OutcomeGraphFactory = (options) =>
  cytoscape(options as never) as unknown as OutcomeGraphCore;

const asCourseId = (value: string): CourseId => value as CourseId;
const asOutcomeId = (value: string): LearningOutcomeId => value as LearningOutcomeId;

const GRAPH_TOKEN_FALLBACKS = Object.freeze({
  primary: '#146ef5',
  text: '#0f172a',
  border: '#e2e8f0',
  borderStrong: '#cbd5e1',
  textMuted: '#64748b'
});

const statusLabel = (status: string): string =>
  status.length === 0 ? 'Unknown' : `${status.charAt(0).toUpperCase()}${status.slice(1)}`;

const matchesOutcome = (outcome: LearningOutcome, courses: ReadonlyMap<CourseId, Course>, filters: OutcomeGraphFilters): boolean => {
  const search = filters.search?.trim().toLocaleLowerCase() ?? '';
  const course = courses.get(outcome.courseId);
  return (
    (search.length === 0 || `${outcome.code} ${outcome.title} ${outcome.description}`.toLocaleLowerCase().includes(search)) &&
    (filters.courseId === undefined || outcome.courseId === filters.courseId) &&
    (filters.level === undefined || outcome.level === filters.level) &&
    (filters.status === undefined || outcome.status === filters.status)
  );
};

export const deriveOutcomeGraph = (
  outcomes: readonly LearningOutcome[],
  courses: readonly Course[],
  content: readonly ContentItem[],
  filters: OutcomeGraphFilters = {}
): OutcomeGraphModel => {
  const courseMap = new Map(courses.map((course) => [course.id, course]));
  const allById = new Map(outcomes.map((outcome) => [outcome.id, outcome]));
  const dependents = new Map<LearningOutcomeId, LearningOutcomeId[]>();
  for (const outcome of outcomes) {
    for (const prerequisiteId of outcome.prerequisiteOutcomeIds) {
      const current = dependents.get(prerequisiteId) ?? [];
      current.push(outcome.id);
      dependents.set(prerequisiteId, current);
    }
  }

  const visibleOutcomes = outcomes
    .filter((outcome) => matchesOutcome(outcome, courseMap, filters))
    .slice()
    .sort((left, right) => left.code.localeCompare(right.code) || left.id.localeCompare(right.id));
  const visibleIds = new Set(visibleOutcomes.map((outcome) => outcome.id));
  const nodes = visibleOutcomes.map((outcome): OutcomeGraphNode => {
    const prerequisiteIds = outcome.prerequisiteOutcomeIds.filter((id) => allById.has(id));
    const dependentIds = dependents.get(outcome.id) ?? [];
    const relatedContent = content.filter((item) => item.learningOutcomeIds.includes(outcome.id));
    const missingPrerequisite = outcome.prerequisiteOutcomeIds.some((id) => !allById.has(id));
    const riskLabel = missingPrerequisite
      ? 'Missing prerequisite reference'
      : outcome.status !== 'published'
        ? `Lifecycle: ${statusLabel(outcome.status)}`
        : prerequisiteIds.length > 2
          ? 'Dependency load: review prerequisites'
          : dependentIds.length === 0
            ? 'No downstream dependents'
            : '';
    const course = courseMap.get(outcome.courseId);
    return Object.freeze({
      id: outcome.id,
      code: outcome.code,
      title: outcome.title,
      description: outcome.description,
      courseId: outcome.courseId,
      courseLabel: course === undefined ? 'Course unavailable' : `${course.code} · ${course.title}`,
      level: outcome.level,
      status: outcome.status,
      prerequisiteIds: Object.freeze([...prerequisiteIds]),
      prerequisiteCount: prerequisiteIds.length,
      dependentIds: Object.freeze([...dependentIds]),
      dependentCount: dependentIds.length,
      affectedCount: dependentIds.length,
      content: Object.freeze([...relatedContent]),
      isRisky: riskLabel.length > 0,
      riskLabel,
      masteryLabel: 'Not measured' as const
    });
  });
  const edges = visibleOutcomes.flatMap((outcome) =>
    outcome.prerequisiteOutcomeIds
      .filter((prerequisiteId) => visibleIds.has(prerequisiteId))
      .map((prerequisiteId): OutcomeGraphEdge => ({
        id: `${prerequisiteId}->${outcome.id}`,
        source: prerequisiteId,
        target: outcome.id
      }))
  );
  return Object.freeze({
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges)
  });
};

const focusOutcomeGraph = (
  model: OutcomeGraphModel,
  selectedOutcomeId: LearningOutcomeId
): OutcomeGraphModel => {
  const selected = model.nodes.find((node) => node.id === selectedOutcomeId);
  if (selected === undefined) {
    return model;
  }
  const focusedIds = new Set<LearningOutcomeId>([
    selected.id,
    ...selected.prerequisiteIds,
    ...selected.dependentIds
  ]);
  const nodes = model.nodes.filter((node) => focusedIds.has(node.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = model.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  return Object.freeze({
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges)
  });
};

interface FilterFormValue {
  readonly search: string;
  readonly courseId: string;
  readonly level: number | null;
  readonly status: string;
}

@Component({
  selector: 'app-outcome-graph',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './outcome-graph.component.html',
  styleUrl: './outcome-graph.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OutcomeGraphComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router, { optional: true });
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly graphFactory = inject(OUTCOME_GRAPH_FACTORY, { optional: true }) ?? defaultGraphFactory;

  readonly facade = inject(LearningDomainFacade);
  readonly lifecycleStates = LIFECYCLE_STATES;
  readonly selectedOutcomeId = signal<LearningOutcomeId | null>(null);
  readonly viewMode = signal<OutcomeGraphViewMode>(this.defaultViewMode());
  readonly selectedCourseId = signal<CourseId | ''>('');
  readonly selectedLevel = signal<number | null>(null);
  readonly selectedStatus = signal<LearningOutcomeStatus | ''>('');
  readonly search = signal('');
  readonly hasAttemptedLoad = signal(false);
  readonly coursesLoaded = signal(false);
  readonly outcomesLoaded = signal(false);
  readonly contentLoaded = signal(false);
  readonly graphReady = signal(false);
  readonly isSaving = signal(false);
  readonly feedbackMessage = signal('');
  readonly feedbackKind = signal<OutcomeGraphFeedbackKind>(null);
  readonly liveMessage = signal('Loading courses, outcomes, and content.');
  readonly relationDraft = signal<readonly LearningOutcomeId[]>([]);
  readonly isGraphFocused = signal(false);

  readonly filterForm = new FormGroup({
    search: new FormControl('', { nonNullable: true }),
    courseId: new FormControl('', { nonNullable: true }),
    level: new FormControl<number | null>(null),
    status: new FormControl('', { nonNullable: true })
  });
  readonly prerequisiteControl = new FormControl<string[]>([], { nonNullable: true });

  @ViewChild('graphContainer') private graphContainer?: ElementRef<HTMLElement>;

  readonly courses = computed(() => this.facade.courses());
  readonly outcomes = computed(() => this.facade.outcomes());
  readonly content = computed(() => this.facade.content());
  readonly requests = computed(() => this.facade.requestStates());
  readonly isUnauthorized = computed(() =>
    [this.requests().courses, this.requests().outcomes, this.requests().content].some((request) => request.status === 'unauthorized')
  );
  readonly isLoading = computed(() =>
    !this.hasAttemptedLoad() || [this.requests().courses, this.requests().outcomes, this.requests().content].some((request) => request.status === 'loading')
  );
  readonly isServiceError = computed(() =>
    !this.isUnauthorized() && [this.requests().courses, this.requests().outcomes, this.requests().content].some((request) => request.status === 'error')
  );
  readonly isEmpty = computed(() => !this.isLoading() && !this.isServiceError() && this.outcomes().length === 0);
  readonly filters = computed<OutcomeGraphFilters>(() => ({
    ...(this.search().trim().length > 0 ? { search: this.search().trim() } : {}),
    ...(this.selectedCourseId().length > 0 ? { courseId: this.selectedCourseId() as CourseId } : {}),
    ...(this.selectedLevel() === null ? {} : { level: this.selectedLevel() as number }),
    ...(this.selectedStatus().length > 0 ? { status: this.selectedStatus() as LearningOutcomeStatus } : {})
  }));
  readonly graphModel = computed(() => deriveOutcomeGraph(this.outcomes(), this.courses(), this.content(), this.filters()));
  readonly renderedGraphModel = computed(() => {
    const selectedId = this.selectedOutcomeId();
    return this.isGraphFocused() && selectedId !== null
      ? focusOutcomeGraph(this.graphModel(), selectedId)
      : this.graphModel();
  });
  readonly levels = computed(() => Object.freeze([...new Set(this.outcomes().map((outcome) => outcome.level))].sort((left, right) => left - right)));
  readonly visibleNodes = computed(() => this.graphModel().nodes);
  readonly graphElements = computed<readonly OutcomeGraphElement[]>(() => [
    ...this.renderedGraphModel().nodes.map((node) => ({
      group: 'nodes' as const,
      data: { id: String(node.id), label: `${node.code}\n${node.title}`, status: node.status, level: node.level }
    })),
    ...this.renderedGraphModel().edges.map((edge) => ({
      group: 'edges' as const,
      data: { id: edge.id, source: String(edge.source), target: String(edge.target) }
    }))
  ]);
  readonly selectedOutcome = computed(() => {
    const id = this.selectedOutcomeId();
    return id === null ? undefined : this.graphModel().nodes.find((node) => node.id === id);
  });
  readonly prerequisiteCandidates = computed(() => {
    const selected = this.selectedOutcome();
    if (selected === undefined) {
      return Object.freeze([]) as readonly OutcomeGraphNode[];
    }
    return Object.freeze(this.graphModel().nodes.filter((node) => node.courseId === selected.courseId && node.id !== selected.id));
  });
  readonly riskyNodes = computed(() => this.graphModel().nodes.filter((node) => node.isRisky));
  readonly graphVisible = computed(() => this.viewMode() === 'graph' && !this.isLoading() && !this.isUnauthorized() && !this.isServiceError() && !this.isEmpty());
  readonly canEditRelations = computed(() => !this.isUnauthorized() && this.selectedOutcome() !== undefined && !this.isSaving());
  readonly recommendedContent = computed<readonly OutcomeGraphRecommendation[]>(() => {
    const selected = this.selectedOutcome();
    if (selected === undefined || typeof this.facade.recommendLearningPath !== 'function') {
      return Object.freeze([]);
    }
    const relatedIds = new Set(selected.content.map((item) => item.id));
    const contentById = new Map(this.content().map((item) => [item.id, item]));
    const entries = this.facade.recommendLearningPath({
      courseId: selected.courseId,
      masteryByOutcomeId: {},
      completedContentIds: [],
      lockedContentIds: []
    });
    return Object.freeze(entries.flatMap((entry) => {
      const item = contentById.get(entry.contentItemId);
      return item !== undefined && relatedIds.has(item.id) ? [Object.freeze({ item, entry })] : [];
    }));
  });
  readonly masteryAvailable = signal(false);
  private readonly staleSelectionEffect = effect(() => {
    const selectedId = this.selectedOutcomeId();
    const outcomes = this.outcomes();
    if (!this.outcomesLoaded() || selectedId === null || outcomes.some((outcome) => outcome.id === selectedId)) return;
    queueMicrotask(() => {
      if (this.selectedOutcomeId() === selectedId && !this.outcomes().some((outcome) => outcome.id === selectedId)) {
        this.clearStaleSelection();
      }
    });
  });

  private graph: OutcomeGraphCore | null = null;
  private graphRenderQueued = false;
  private syncingFromUrl = false;
  private staleSelectionAnnouncementPending = false;
  private rawCourseQuery = '';

  private readonly graphRenderEffect = effect(() => {
    this.graphElements();
    this.graphVisible();
    this.graphReady();
    this.selectedOutcomeId();
    this.scheduleGraphRender();
  });

  ngOnInit(): void {
    this.applyQuerySnapshot();
    this.route?.queryParams
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => this.applyQueryParams(params as Readonly<Record<string, unknown>>));
    this.filterForm.valueChanges
      .pipe(
        startWith(this.filterForm.getRawValue()),
        distinctUntilChanged((left, right) => JSON.stringify(left) === JSON.stringify(right)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => this.applyFilterForm(this.filterForm.getRawValue()));
    this.prerequisiteControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((values: string[]) => this.relationDraft.set(values.map(asOutcomeId)));
    this.loadData();
  }

  ngAfterViewInit(): void {
    this.graphReady.set(true);
    this.scheduleGraphRender();
  }

  ngOnDestroy(): void {
    this.destroyGraph();
  }

  loadData(): void {
    this.staleSelectionAnnouncementPending = false;
    this.hasAttemptedLoad.set(true);
    this.liveMessage.set('Loading courses, outcomes, and content.');
    this.facade.loadCourses().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.coursesLoaded.set(true);
        this.canonicalizeCourseQuery();
        if (!this.staleSelectionAnnouncementPending) this.liveMessage.set('Courses loaded.');
      },
      error: () => this.liveMessage.set('Courses could not be loaded. Try again.')
    });
    this.facade.loadOutcomes().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.outcomesLoaded.set(true);
        this.clearStaleSelection();
        if (!this.staleSelectionAnnouncementPending) this.liveMessage.set('Outcomes loaded.');
      },
      error: () => this.liveMessage.set('Outcomes could not be loaded. Try again.')
    });
    this.facade.loadContent({}, {
      contentAccess: { mode: 'management' } as ContentAccessContext
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.contentLoaded.set(true);
        if (!this.staleSelectionAnnouncementPending) this.liveMessage.set('Content loaded.');
      },
      error: () => this.liveMessage.set('Content could not be loaded. Try again.')
    });
  }

  retryLoad(): void {
    this.feedbackMessage.set('');
    this.feedbackKind.set(null);
    this.loadData();
  }

  resetFilters(): void {
    this.filterForm.reset({ search: '', courseId: '', level: null, status: '' });
    this.setViewMode(this.defaultViewMode());
    this.selectOutcome(null);
  }

  setViewMode(mode: OutcomeGraphViewMode): void {
    this.viewMode.set(mode);
    this.syncQuery({ view: mode });
    this.liveMessage.set(mode === 'graph' ? 'Graph view opened.' : 'Accessible list view opened.');
  }

  selectOutcome(value: LearningOutcome | OutcomeGraphNode | LearningOutcomeId | string | null): void {
    const id = typeof value === 'string' ? asOutcomeId(value) : value === null ? null : value.id;
    const selected = id === null ? undefined : this.graphModel().nodes.find((node) => node.id === id);
    if (selected === undefined) {
      if (id !== null) {
        this.liveMessage.set('The selected outcome is no longer available; selection cleared.');
      }
      this.selectedOutcomeId.set(null);
      this.relationDraft.set([]);
      this.prerequisiteControl.setValue([], { emitEvent: false });
      this.isGraphFocused.set(false);
      this.syncQuery({ selected: null });
      return;
    }
    this.selectedOutcomeId.set(selected.id);
    const ids = [...selected.prerequisiteIds];
    this.relationDraft.set(ids);
    this.prerequisiteControl.setValue(ids.map(String), { emitEvent: false });
    this.feedbackMessage.set('');
    this.feedbackKind.set(null);
    this.liveMessage.set(`${selected.code} selected. Inspector updated.`);
    this.syncQuery({ selected: String(selected.id) });
    queueMicrotask(() => this.document.getElementById('outcome-inspector-heading')?.focus());
  }

  savePrerequisites(): void {
    const selected = this.selectedOutcome();
    if (selected === undefined || this.isSaving()) {
      return;
    }
    const ids = [...this.relationDraft()];
    this.isSaving.set(true);
    this.feedbackMessage.set('Saving prerequisite relationships.');
    this.feedbackKind.set(null);
    this.liveMessage.set(`Saving prerequisites for ${selected.code}.`);
    this.facade.updateOutcome(
      selected.id,
      { prerequisiteOutcomeIds: ids },
      { expectedVersion: this.outcomes().find((outcome) => outcome.id === selected.id)?.version ?? 0 }
    ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (outcome: LearningOutcome) => {
        this.isSaving.set(false);
        const nextIds = [...outcome.prerequisiteOutcomeIds];
        this.relationDraft.set(nextIds);
        this.prerequisiteControl.setValue(nextIds.map(String), { emitEvent: false });
        this.feedbackKind.set('success');
        this.feedbackMessage.set('Prerequisite relationships saved.');
        this.liveMessage.set(`${outcome.code} prerequisites saved.`);
        this.focusFeedback();
      },
      error: (error: unknown) => {
        this.isSaving.set(false);
        const conflict = this.isConflictError(error);
        const validation = error instanceof LearningDomainError && error.code === 'validation';
        this.feedbackKind.set(conflict ? 'conflict' : validation ? 'validation' : 'error');
        this.feedbackMessage.set(this.errorMessage(error, validation ? 'Cycle detected. Choose a different prerequisite set.' : conflict ? 'This outcome changed elsewhere. Reload before saving.' : 'Prerequisites could not be saved. Try again.'));
        this.liveMessage.set(this.feedbackMessage());
        this.focusFeedback();
      }
    });
  }

  zoomGraph(direction: 'in' | 'out'): void {
    if (this.graph === null) return;
    const current = this.graph.zoom();
    this.graph.zoom(direction === 'in' ? current * 1.2 : current / 1.2);
  }

  fitGraph(): void {
    this.graph?.fit(undefined, 24);
  }

  focusSelectedGraph(): void {
    const id = this.selectedOutcomeId();
    if (id === null || this.selectedOutcome() === undefined) return;
    this.isGraphFocused.set(true);
    this.liveMessage.set('Focused graph shows the selected outcome and its direct prerequisites and dependents.');
    queueMicrotask(() => {
      const graph = this.graph;
      if (graph === null) return;
      const target = graph.getElementById(String(id));
      target.focus?.();
      graph.fit(target, 80);
    });
  }

  restoreFullGraph(): void {
    if (!this.isGraphFocused()) return;
    this.isGraphFocused.set(false);
    this.liveMessage.set('Full filtered outcome map restored.');
    this.fitGraph();
  }

  trackById(_index: number, value: { readonly id: string }): string {
    return value.id;
  }

  statusLabel(status: string): string {
    return statusLabel(status);
  }

  masteryLabel(): string {
    return 'Not measured';
  }

  private applyFilterForm(value: FilterFormValue): void {
    this.search.set(value.search.trim());
    this.selectedCourseId.set(value.courseId.length > 0 ? asCourseId(value.courseId) : '');
    this.selectedLevel.set(value.level === null || !Number.isInteger(value.level) || value.level < 0 ? null : value.level);
    this.selectedStatus.set(value.status.length > 0 ? value.status as LearningOutcomeStatus : '');
    const filter = this.filters();
    this.facade.setOutcomeFilter(filter);
    this.clearStaleSelection();
    if (!this.syncingFromUrl) {
      this.syncQuery({
        search: filter.search ?? null,
        course: filter.courseId === undefined ? null : String(filter.courseId),
        level: filter.level === undefined ? null : String(filter.level),
        status: filter.status ?? null
      });
    }
  }

  private applyQuerySnapshot(): void {
    if (this.route === null) return;
    this.applyQueryParams(this.route.snapshot.queryParams as Readonly<Record<string, unknown>>);
  }

  private applyQueryParams(params: Readonly<Record<string, unknown>>): void {
    const search = this.queryString(params['search']);
    const course = this.queryString(params['course']);
    const levelValue = this.queryLevel(params['level']);
    const status = this.queryString(params['status']);
    const view = this.queryString(params['view']);
    const selected = this.queryString(params['selected']);
    this.rawCourseQuery = course;
    this.syncingFromUrl = true;
    this.filterForm.reset({
      search,
      courseId: !this.coursesLoaded() || this.courses().some((candidate) => String(candidate.id) === course) ? course : '',
      level: levelValue,
      status: (LIFECYCLE_STATES as readonly string[]).includes(status) ? status : ''
    }, { emitEvent: true });
    if (view === 'graph' || view === 'list') this.viewMode.set(view);
    if (selected.length > 0) {
      this.selectedOutcomeId.set(asOutcomeId(selected));
    } else {
      this.selectOutcome(null);
    }
    this.syncingFromUrl = false;
    if (this.coursesLoaded()) this.canonicalizeCourseQuery();
  }

  private canonicalizeCourseQuery(): void {
    if (!this.coursesLoaded()) return;
    const canonicalCourse = this.rawCourseQuery.length > 0 && this.courses().some((candidate) => String(candidate.id) === this.rawCourseQuery)
      ? this.rawCourseQuery
      : '';
    if (this.filterForm.controls.courseId.value !== canonicalCourse) {
      this.syncingFromUrl = true;
      this.filterForm.controls.courseId.setValue(canonicalCourse, { emitEvent: true });
      this.syncingFromUrl = false;
    }
    if (canonicalCourse !== this.rawCourseQuery) {
      this.rawCourseQuery = canonicalCourse;
      this.syncQuery({ course: canonicalCourse.length > 0 ? canonicalCourse : null });
    }
  }

  private syncQuery(values: Readonly<Record<string, string | null>>): void {
    if (this.router === null || this.route === null || this.syncingFromUrl) return;
    void this.router.navigate([], { relativeTo: this.route, queryParams: values, queryParamsHandling: 'merge', replaceUrl: true });
  }

  private clearStaleSelection(): void {
    const id = this.selectedOutcomeId();
    if (id !== null && !this.outcomes().some((outcome) => outcome.id === id)) {
      this.staleSelectionAnnouncementPending = true;
      this.selectOutcome(null);
      this.liveMessage.set('The selected outcome is no longer available; selection cleared.');
    }
  }

  private scheduleGraphRender(): void {
    if (this.graphRenderQueued) return;
    this.graphRenderQueued = true;
    queueMicrotask(() => {
      this.graphRenderQueued = false;
      if (!this.graphVisible() || !this.graphReady() || this.graphContainer === undefined) {
        this.destroyGraph();
        return;
      }
      this.renderGraph();
    });
  }

  private renderGraph(): void {
    const container = this.graphContainer?.nativeElement;
    if (container === undefined) return;
    const elements = this.graphElements();
    if (this.graph === null) {
      const view = this.document.defaultView;
      const styles = view?.getComputedStyle(container);
      const token = (name: string, fallback: string): string => {
        const value = styles?.getPropertyValue(name).trim() || container.style.getPropertyValue(name).trim();
        return value.length > 0 ? value : fallback;
      };
      const primary = token('--ui-primary', GRAPH_TOKEN_FALLBACKS.primary);
      const text = token('--ui-text', GRAPH_TOKEN_FALLBACKS.text);
      const border = token('--ui-border', GRAPH_TOKEN_FALLBACKS.border);
      const borderStrong = token('--ui-border-strong', GRAPH_TOKEN_FALLBACKS.borderStrong);
      const textMuted = token('--ui-text-muted', GRAPH_TOKEN_FALLBACKS.textMuted);
      this.graph = this.graphFactory({
        container,
        elements,
        style: [
          { selector: 'node', style: { label: 'data(label)', 'background-color': primary, color: text, 'border-color': borderStrong, 'border-width': 1, width: 34, height: 34, 'font-size': 8, 'text-wrap': 'wrap', 'text-max-width': 100 } },
          { selector: 'edge', style: { width: 2, 'line-color': border, 'target-arrow-color': textMuted, 'target-arrow-shape': 'triangle', curveStyle: 'bezier' } }
        ],
        layout: { name: 'breadthfirst', directed: true, padding: 28, animate: !this.prefersReducedMotion() }
      });
      this.graph.on('tap', 'node', (event) => this.selectOutcome(event.target.id()));
    } else {
      this.graph.batch(() => {
        this.graph?.elements().remove();
        this.graph?.add(elements);
      });
      this.graph.layout({ name: 'breadthfirst', directed: true, padding: 28, animate: !this.prefersReducedMotion() }).run();
    }
  }

  private destroyGraph(): void {
    this.graph?.destroy();
    this.graph = null;
  }

  private defaultViewMode(): OutcomeGraphViewMode {
    const width = this.document.defaultView?.innerWidth ?? 1440;
    return width <= 520 ? 'list' : 'graph';
  }

  private prefersReducedMotion(): boolean {
    return this.document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  private queryString(value: unknown): string {
    return Array.isArray(value) ? String(value[0] ?? '') : typeof value === 'string' ? value : '';
  }
  private queryLevel(value: unknown): number | null {
    const raw = this.queryString(value).trim();
    if (raw.length === 0) return null;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  }

  private focusFeedback(): void {
    queueMicrotask(() => this.document.getElementById('outcome-graph-feedback')?.focus());
  }

  private isConflictError(error: unknown): boolean {
    return error instanceof LearningDomainError
      ? error.code === 'conflict'
      : typeof error === 'object' && error !== null && 'code' in error && error.code === 'conflict';
  }

  private errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
  }
}
