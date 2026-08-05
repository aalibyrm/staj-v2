import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
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
  type LearningOutcomeId
} from '../models/learning-domain.models';
import { type LearningDomainRequestState, type LearningDomainResource } from '../state/learning-domain.store';

const courseId = 'course-1' as CourseId;
const firstId = 'outcome-1' as LearningOutcomeId;
const secondId = 'outcome-2' as LearningOutcomeId;
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
  readonly loadCourses = vi.fn(() => { this.requestStates.update((value) => ({ ...value, courses: requestState('success') })); return of([course]); });
  readonly loadOutcomes = vi.fn(() => { this.requestStates.update((value) => ({ ...value, outcomes: requestState('success') })); return of([first, second]); });
  readonly loadContent = vi.fn(() => { this.requestStates.update((value) => ({ ...value, content: requestState('success') })); return of([content]); });
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
    expect(model.nodes[1]?.masteryLabel).toBe('Not available');
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
