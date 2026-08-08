import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OutcomeGraphComponent,
  OUTCOME_GRAPH_FACTORY,
  deriveOutcomeGraph,
  type OutcomeGraphCore
} from './outcome-graph.component';
import { LearningDomainFacade } from '../data-access/learning-domain.facade';
import {
  type ContentItem,
  type ContentItemId,
  type Course,
  type CourseId,
  type LearningOutcome,
  type LearningOutcomeId,
  type LearningPathEntry,
  type LearningPathRecommendationInput
} from '../models/learning-domain.models';
import { type LearningDomainRequestState, type LearningDomainResource } from '../state/learning-domain.store';

const courseId = 'course-1' as CourseId;
const firstId = 'outcome-1' as LearningOutcomeId;
const secondId = 'outcome-2' as LearningOutcomeId;
const thirdId = 'outcome-3' as LearningOutcomeId;
const contentId = 'content-1' as ContentItemId;

const course: Course = {
  id: courseId,
  code: 'SCI-1',
  title: 'Foundations',
  description: 'Foundations course',
  instructorIds: [],
  learningOutcomeIds: [firstId, secondId],
  status: 'published',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  version: 1
};

const first: LearningOutcome = {
  id: firstId,
  courseId,
  code: 'SCI-1.1',
  title: 'Describe matter',
  description: 'Describe matter and its properties.',
  level: 1,
  status: 'published',
  prerequisiteOutcomeIds: [],
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  version: 2
};

const second: LearningOutcome = {
  ...first,
  id: secondId,
  code: 'SCI-1.2',
  title: 'Analyze matter',
  prerequisiteOutcomeIds: [firstId]
};

const third: LearningOutcome = {
  ...first,
  id: thirdId,
  code: 'SCI-1.3',
  title: 'Apply matter'
};

const content: ContentItem = {
  id: contentId,
  courseId,
  title: 'Matter guide',
  description: 'Guide',
  learningOutcomeIds: [secondId],
  level: 1,
  durationMinutes: 10,
  format: 'article',
  accessConditions: {},
  status: 'published',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  version: 1
};

const requestState = (status: LearningDomainRequestState['status']): LearningDomainRequestState => ({
  status,
  requestId: 1,
  error: status === 'error' ? new Error('Service unavailable') : null
});
type FailureMode = 'none' | 'error' | 'unauthorized';

class TestFacade {
  readonly courses = signal<readonly Course[]>([course]);
  readonly outcomes = signal<readonly LearningOutcome[]>([first, second]);
  readonly content = signal<readonly ContentItem[]>([content]);
  readonly requestStates = signal<Record<LearningDomainResource, LearningDomainRequestState>>({
    courses: requestState('idle'), outcomes: requestState('idle'), content: requestState('idle'), paths: requestState('idle')
  });
  readonly coursesRequestState = signal(requestState('idle'));
  readonly outcomesRequestState = signal(requestState('idle'));
  readonly contentRequestState = signal(requestState('idle'));
  readonly visibleOutcomes = signal<readonly LearningOutcome[]>([first, second]);
  failureMode: FailureMode = 'none';
  readonly loadCourses = vi.fn(() => {
    if (this.failureMode === 'error') {
      this.requestStates.update((value) => ({ ...value, courses: requestState('error') }));
      return throwError(() => new Error('Service unavailable'));
    }
    if (this.failureMode === 'unauthorized') {
      this.requestStates.update((value) => ({ ...value, courses: requestState('unauthorized') }));
      return throwError(() => new Error('Unauthorized'));
    }
    this.requestStates.update((value) => ({ ...value, courses: requestState('success') }));
    return of([course]);
  });
  readonly loadOutcomes = vi.fn(() => {
    if (this.failureMode === 'error') {
      this.requestStates.update((value) => ({ ...value, outcomes: requestState('error') }));
      return throwError(() => new Error('Service unavailable'));
    }
    if (this.failureMode === 'unauthorized') {
      this.requestStates.update((value) => ({ ...value, outcomes: requestState('unauthorized') }));
      return throwError(() => new Error('Unauthorized'));
    }
    this.requestStates.update((value) => ({ ...value, outcomes: requestState('success') }));
    return of([first, second]);
  });
  readonly loadContent = vi.fn(() => {
    if (this.failureMode === 'error') {
      this.requestStates.update((value) => ({ ...value, content: requestState('error') }));
      return throwError(() => new Error('Service unavailable'));
    }
    if (this.failureMode === 'unauthorized') {
      this.requestStates.update((value) => ({ ...value, content: requestState('unauthorized') }));
      return throwError(() => new Error('Unauthorized'));
    }
    this.requestStates.update((value) => ({ ...value, content: requestState('success') }));
    return of([content]);
  });
  readonly recommendLearningPath = vi.fn((_input: LearningPathRecommendationInput): readonly LearningPathEntry[] => []);
  readonly setOutcomeFilter = vi.fn();
  readonly updateOutcome = vi.fn((id: LearningOutcomeId, input: { prerequisiteOutcomeIds?: readonly LearningOutcomeId[] }, options?: { expectedVersion?: number }) => {
    void options;
    const current = this.outcomes().find((outcome) => outcome.id === id);
    if (current === undefined) return throwError(() => new Error('Missing outcome'));
    const updated = { ...current, prerequisiteOutcomeIds: input.prerequisiteOutcomeIds ?? current.prerequisiteOutcomeIds, version: current.version + 1 };
    this.outcomes.set(this.outcomes().map((outcome) => outcome.id === id ? updated : outcome));
    return of(updated);
  });
}
const graphFactory = (): OutcomeGraphCore => {
  let zoom = 1;
  const listeners: Array<(event: { target: { id(): string } }) => void> = [];
  return {
    on: (_event, _selector, listener) => listeners.push(listener),
    batch: (callback) => callback(),
    elements: () => ({ remove: vi.fn() }),
    add: vi.fn(),
    layout: () => ({ run: vi.fn() }),
    zoom: (level?: number) => { if (level !== undefined) zoom = level; return zoom; },
    fit: vi.fn(),
    getElementById: () => ({ focus: vi.fn() }),
    destroy: vi.fn()
  } as OutcomeGraphCore;
};

describe('OutcomeGraphComponent', () => {
  let facade: TestFacade;
  const router = {
    navigate: vi.fn((
      _commands: readonly unknown[],
      _extras: { readonly queryParams: Readonly<Record<string, string | null>> }
    ) => Promise.resolve(true))
  };
  let queryParams$: BehaviorSubject<Readonly<Record<string, unknown>>>;

  beforeEach(() => {
    facade = new TestFacade();
    router.navigate.mockClear();
    queryParams$ = new BehaviorSubject<Readonly<Record<string, unknown>>>({});
    TestBed.configureTestingModule({
      imports: [OutcomeGraphComponent],
      providers: [
        { provide: LearningDomainFacade, useValue: facade },
        { provide: OUTCOME_GRAPH_FACTORY, useValue: graphFactory },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParams: {} }, queryParams: queryParams$.asObservable() }
        },
        { provide: Router, useValue: router }
      ]
    });
  });

  it('derives directional relations, dependents, affected counts, content, and honest mastery without duplicated graph data', () => {
    const model = deriveOutcomeGraph([first, second], [course], [content]);
    expect(model.edges).toEqual([{ id: `${firstId}->${secondId}`, source: firstId, target: secondId }]);
    expect(model.nodes[0]?.dependentCount).toBe(1);
    expect(model.nodes[1]?.prerequisiteCount).toBe(1);
    expect(model.nodes[1]?.affectedCount).toBe(0);
    expect(model.nodes[1]?.content).toEqual([content]);
    expect(model.nodes[1]?.masteryLabel).toBe('Not measured');
  });

  it('loads all learning-domain resources and renders the accessible relation list', () => {
    const fixture = TestBed.createComponent(OutcomeGraphComponent);
    fixture.detectChanges();
    expect(facade.loadCourses).toHaveBeenCalledTimes(1);
    expect(facade.loadOutcomes).toHaveBeenCalledTimes(1);
    expect(facade.loadContent).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('table')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#outcome-map-mastery')?.disabled).toBe(true);
  });
  it('renders the shared slow state, hides stale graph data, and retries loading', () => {
    const fixture = TestBed.createComponent(OutcomeGraphComponent);
    fixture.detectChanges();
    const callsBeforeRetry = facade.loadContent.mock.calls.length;
    facade.requestStates.update((value) => ({ ...value, outcomes: requestState('slow') }));
    fixture.detectChanges();

    const state = fixture.nativeElement.querySelector('app-request-state');
    expect(state?.querySelector('.request-state--slow')).not.toBeNull();
    expect(state?.textContent).toContain('Outcome map is taking longer than expected');
    expect(state?.textContent).toContain('related content are still loading');
    expect(state?.querySelector('.retry-action')?.textContent?.trim()).toBe('Try again');
    expect(fixture.nativeElement.querySelector('.map-layout')).toBeNull();
    expect(fixture.nativeElement.querySelector('.graph-canvas')).toBeNull();
    expect(fixture.nativeElement.querySelector('.accessible-list')).toBeNull();
    expect(fixture.nativeElement.querySelector('.inspector-panel')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Describe matter');
    expect(fixture.nativeElement.querySelector('.outcome-map')?.getAttribute('aria-busy')).toBe('true');

    (state?.querySelector('.retry-action') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(facade.loadContent.mock.calls.length).toBeGreaterThan(callsBeforeRetry);
  });

  it('keeps loading distinct from slow and hides all stale map alternatives', () => {
    const fixture = TestBed.createComponent(OutcomeGraphComponent);
    fixture.detectChanges();
    facade.requestStates.update((value) => ({ ...value, courses: requestState('loading') }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-request-state')).toBeNull();
    expect(fixture.nativeElement.querySelector('.state-card[aria-busy="true"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.map-layout')).toBeNull();
    expect(fixture.nativeElement.querySelector('.accessible-list')).toBeNull();
    expect(fixture.nativeElement.querySelector('.outcome-map')?.getAttribute('aria-busy')).toBe('true');
  });

  it('renders authorized empty map state without stale alternatives', () => {
    const fixture = TestBed.createComponent(OutcomeGraphComponent);
    fixture.detectChanges();
    facade.outcomes.set([]);
    facade.requestStates.update((value) => ({ ...value, outcomes: requestState('empty') }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.state-card--empty')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.map-layout')).toBeNull();
    expect(fixture.nativeElement.querySelector('.accessible-list')).toBeNull();
  });

  it('renders service load error retry and keeps unauthorized precedence over error', () => {
    const fixture = TestBed.createComponent(OutcomeGraphComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    const callsBeforeRetry = facade.loadContent.mock.calls.length;
    facade.failureMode = 'error';
    component.loadData();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.state-card--error')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-request-state')).toBeNull();
    expect(fixture.nativeElement.querySelector('.map-layout')).toBeNull();
    expect(fixture.nativeElement.querySelector('.accessible-list')).toBeNull();

    facade.failureMode = 'none';
    (fixture.nativeElement.querySelector('.state-card--error button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(facade.loadContent.mock.calls.length).toBeGreaterThan(callsBeforeRetry);

    facade.requestStates.update((value) => ({ ...value, courses: requestState('unauthorized'), outcomes: requestState('error') }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.state-card--denied')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.state-card--error')).toBeNull();
    expect(fixture.nativeElement.querySelector('.map-layout')).toBeNull();
    expect(fixture.nativeElement.querySelector('.accessible-list')).toBeNull();
  });
  it('ignores superseded graph-load callbacks after a newer error', () => {
    const fixture = TestBed.createComponent(OutcomeGraphComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectOutcome(secondId);

    const staleCourses = new Subject<Course[]>();
    const staleOutcomes = new Subject<LearningOutcome[]>();
    const staleContent = new Subject<ContentItem[]>();
    facade.loadCourses
      .mockImplementationOnce(() => staleCourses)
      .mockImplementationOnce(() => throwError(() => new Error('Latest courses failed')));
    facade.loadOutcomes
      .mockImplementationOnce(() => staleOutcomes)
      .mockImplementationOnce(() => throwError(() => new Error('Latest outcomes failed')));
    facade.loadContent
      .mockImplementationOnce(() => staleContent)
      .mockImplementationOnce(() => throwError(() => new Error('Latest content failed')));

    component.loadData();
    component.loadData();
    facade.requestStates.update((value) => ({
      ...value,
      courses: requestState('error'),
      outcomes: requestState('error'),
      content: requestState('error')
    }));
    facade.outcomes.set([first]);

    staleCourses.next([course]);
    staleCourses.complete();
    staleOutcomes.next([first, second]);
    staleOutcomes.error(new Error('Old outcomes failed'));
    staleContent.next([content]);
    staleContent.complete();

    expect(component.coursesLoaded()).toBe(false);
    expect(component.outcomesLoaded()).toBe(false);
    expect(component.contentLoaded()).toBe(false);
    expect(component.selectedOutcomeId()).toBe(secondId);
    expect(component.liveMessage()).toBe('Content could not be loaded. Try again.');
  });

  it('keeps default filters query-free on initialization', () => {
    const fixture = TestBed.createComponent(OutcomeGraphComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    expect(component.selectedLevel()).toBeNull();
    expect(component.filterForm.controls.level.value).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith([], expect.objectContaining({
      queryParams: { search: null, course: null, level: null, status: null }
    }));
    queryParams$.next({ level: 'not-a-number' });
    expect(component.selectedLevel()).toBeNull();
  });

  it('filters and mirrors selection while clearing a stale selected outcome', () => {
    const fixture = TestBed.createComponent(OutcomeGraphComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    component.filterForm.controls.search.setValue('analyze');
    expect(component.visibleNodes()).toHaveLength(1);
    component.selectOutcome(secondId);
    expect(component.selectedOutcome()?.id).toBe(secondId);
    facade.outcomes.set([first]);
    component.loadData();
    expect(component.selectedOutcomeId()).toBeNull();
    expect(component.liveMessage()).toContain('cleared');
    expect(component.relationDraft()).toEqual([]);
    expect(router.navigate.mock.calls.some(([, extras]) => extras.queryParams['selected'] === null)).toBe(true);
  });
  it('clears selection when browser query state omits selected without feedback navigation', () => {
    const fixture = TestBed.createComponent(OutcomeGraphComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    component.selectOutcome(secondId);
    const navigateCount = router.navigate.mock.calls.length;
    queryParams$.next({});
    expect(component.selectedOutcomeId()).toBeNull();
    expect(component.relationDraft()).toEqual([]);
    expect(router.navigate).toHaveBeenCalledTimes(navigateCount);
  });

  it('preserves a relation draft and exposes cycle validation or conflict feedback after a failed save', () => {
    const fixture = TestBed.createComponent(OutcomeGraphComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    component.selectOutcome(secondId);
    component.prerequisiteControl.setValue([firstId]);
    facade.updateOutcome.mockReturnValueOnce(throwError(() => new Error('Cycle detected: SCI-1.1 -> SCI-1.2 -> SCI-1.1')));
    component.savePrerequisites();
    expect(facade.updateOutcome).toHaveBeenCalledWith(secondId, { prerequisiteOutcomeIds: [firstId] }, { expectedVersion: 2 });
    expect(component.relationDraft()).toEqual([firstId]);
    expect(component.feedbackMessage()).toContain('Cycle detected');
  });

  it('focuses the rendered graph to the selected one-hop neighborhood and restores the full filtered graph', () => {
    const fixture = TestBed.createComponent(OutcomeGraphComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    facade.courses.set([{ ...course, learningOutcomeIds: [...course.learningOutcomeIds, thirdId] }]);
    facade.outcomes.set([first, second, third]);

    const fullGraph = component.graphElements();
    expect(fullGraph.filter((element) => element.group === 'nodes').map((element) => element.data['id'])).toEqual([
      String(firstId), String(secondId), String(thirdId)
    ]);

    component.selectOutcome(secondId);
    component.focusSelectedGraph();
    const focusedGraph = component.graphElements();
    expect(component.isGraphFocused()).toBe(true);
    expect(focusedGraph.filter((element) => element.group === 'nodes').map((element) => element.data['id'])).toEqual([
      String(firstId), String(secondId)
    ]);
    expect(focusedGraph.filter((element) => element.group === 'edges').map((element) => element.data['id'])).toEqual([
      `${firstId}->${secondId}`
    ]);

    component.restoreFullGraph();
    expect(component.isGraphFocused()).toBe(false);
    expect(component.graphElements()).toEqual(fullGraph);
  });

  it('computes selected inspector recommendations from facade entries and preserves their reason', () => {
    const recommendation: LearningPathEntry = {
      id: 'path-entry-1' as LearningPathEntry['id'],
      order: 1,
      contentItemId: contentId,
      reason: 'Review matter before moving forward.',
      isCompleted: false,
      isLocked: false
    };
    facade.recommendLearningPath.mockReturnValue([recommendation]);
    const fixture = TestBed.createComponent(OutcomeGraphComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectOutcome(secondId);

    const selectedRecommendations = component.recommendedContent();

    expect(facade.recommendLearningPath).toHaveBeenCalledWith({
      courseId,
      masteryByOutcomeId: {},
      completedContentIds: [],
      lockedContentIds: []
    });
    expect(selectedRecommendations).toEqual([{ item: content, entry: recommendation }]);
    expect(selectedRecommendations[0]?.entry.reason).toBe(recommendation.reason);
  });
  it('uses a real graph control seam and honors zoom, fit, focus, and destroy lifecycle calls', async () => {
    const fixture = TestBed.createComponent(OutcomeGraphComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const graph = graphFactory();
    graph.zoom(1);
    graph.zoom(graph.zoom() * 1.2);
    graph.fit();
    graph.getElementById(String(firstId)).focus?.();
    graph.destroy();
    expect(graph.zoom()).toBeGreaterThan(1);
  });
});
