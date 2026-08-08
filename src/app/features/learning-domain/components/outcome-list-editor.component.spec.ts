import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LearningDomainFacade } from '../data-access/learning-domain.facade';
import {
  type LearningDomainRequestState
} from '../state/learning-domain.store';
import {
  type Course,
  type CourseId,
  type LearningOutcome,
  type LearningOutcomeCreateInput,
  type LearningOutcomeId,
  type LearningOutcomeUpdateInput
} from '../models/learning-domain.models';
import { OutcomeListEditorComponent } from './outcome-list-editor.component';

const courseOneId = 'course-one' as CourseId;
const courseTwoId = 'course-two' as CourseId;
const outcomeOneId = 'outcome-one' as LearningOutcomeId;
const outcomeTwoId = 'outcome-two' as LearningOutcomeId;
const outcomeThreeId = 'outcome-three' as LearningOutcomeId;

const course = (id: CourseId, code: string, title: string): Course => ({
  id,
  code,
  title,
  description: `${title} description`,
  instructorIds: [],
  learningOutcomeIds: [],
  status: 'published',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  version: 1
});

const outcome = (
  id: LearningOutcomeId,
  courseId: CourseId,
  code: string,
  title: string,
  status: LearningOutcome['status'],
  prerequisiteOutcomeIds: readonly LearningOutcomeId[] = []
): LearningOutcome => ({
  id,
  courseId,
  code,
  title,
  description: `${title} description`,
  level: 1,
  status,
  prerequisiteOutcomeIds,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  version: 1
});

const requestState = (status: LearningDomainRequestState['status']): LearningDomainRequestState => ({
  status,
  requestId: 1,
  error: status === 'error' ? new Error('Service unavailable') : null
});

type FailureMode = 'none' | 'error' | 'unauthorized';

class TestLearningDomainFacade {
  readonly courses = signal<readonly Course[]>([
    course(courseOneId, 'COURSE-1', 'Foundations'),
    course(courseTwoId, 'COURSE-2', 'Practice')
  ]);
  readonly outcomes = signal<readonly LearningOutcome[]>([
    outcome(outcomeOneId, courseOneId, 'OUT-1', 'Model outcomes', 'published'),
    outcome(outcomeTwoId, courseOneId, 'OUT-2', 'Analyze outcomes', 'draft', [outcomeOneId]),
    outcome(outcomeThreeId, courseTwoId, 'OUT-3', 'Practice outcomes', 'published')
  ]);
  readonly visibleOutcomes = signal<readonly LearningOutcome[]>(this.outcomes());
  readonly coursesRequestState = signal<LearningDomainRequestState>(requestState('idle'));
  readonly outcomesRequestState = signal<LearningDomainRequestState>(requestState('idle'));
  writeFailure = false;
  failureMode: FailureMode = 'none';

  readonly loadCourses = vi.fn(() => {
    if (this.failureMode === 'unauthorized') {
      this.coursesRequestState.set({ ...requestState('unauthorized'), error: new Error('Unauthorized') });
      return throwError(() => new Error('Unauthorized'));
    }
    if (this.failureMode === 'error') {
      this.coursesRequestState.set(requestState('error'));
      return throwError(() => new Error('Service unavailable'));
    }
    this.coursesRequestState.set(requestState('success'));
    return of(this.courses());
  });

  readonly loadOutcomes = vi.fn(() => {
    if (this.failureMode === 'unauthorized') {
      this.outcomesRequestState.set({ ...requestState('unauthorized'), error: new Error('Unauthorized') });
      return throwError(() => new Error('Unauthorized'));
    }
    if (this.failureMode === 'error') {
      this.outcomesRequestState.set(requestState('error'));
      return throwError(() => new Error('Service unavailable'));
    }
    this.outcomesRequestState.set(requestState('success'));
    return of(this.outcomes());
  });

  readonly setOutcomeFilter = vi.fn((filter: { search?: string; courseId?: CourseId; status?: string; minLevel?: number }) => {
    const search = filter.search?.toLocaleLowerCase() ?? '';
    this.visibleOutcomes.set(
      this.outcomes().filter(
        (candidate) =>
          (search.length === 0 || `${candidate.code} ${candidate.title}`.toLocaleLowerCase().includes(search)) &&
          (filter.courseId === undefined || candidate.courseId === filter.courseId) &&
          (filter.status === undefined || candidate.status === filter.status) &&
          (filter.minLevel === undefined || candidate.level >= filter.minLevel)
      )
    );
  });

  readonly createOutcome = vi.fn((input: LearningOutcomeCreateInput) => {
    if (this.writeFailure) {
      this.outcomesRequestState.set(requestState('error'));
      return throwError(() => new Error('Save failed'));
    }
    const created = outcome(
      'created-outcome' as LearningOutcomeId,
      input.courseId,
      input.code,
      input.title,
      input.status ?? 'draft',
      input.prerequisiteOutcomeIds ?? []
    );
    this.outcomes.set([...this.outcomes(), created]);
    this.visibleOutcomes.set(this.outcomes());
    this.outcomesRequestState.set(requestState('success'));
    return of(created);
  });

  readonly updateOutcome = vi.fn((id: LearningOutcomeId, input: LearningOutcomeUpdateInput) => {
    if (this.writeFailure) {
      this.outcomesRequestState.set(requestState('error'));
      return throwError(() => new Error('Save failed'));
    }
    const current = this.outcomes().find((candidate) => candidate.id === id);
    if (current === undefined) {
      return throwError(() => new Error('Missing outcome'));
    }
    const updated = { ...current, ...input, id } as LearningOutcome;
    this.outcomes.set(this.outcomes().map((candidate) => (candidate.id === id ? updated : candidate)));
    this.visibleOutcomes.set(this.outcomes());
    this.outcomesRequestState.set(requestState('success'));
    return of(updated);
  });
}

describe('OutcomeListEditorComponent', () => {
  let facade: TestLearningDomainFacade;

  beforeEach(() => {
    facade = new TestLearningDomainFacade();
    TestBed.configureTestingModule({
      imports: [OutcomeListEditorComponent],
      providers: [{ provide: LearningDomainFacade, useValue: facade }]
    });
  });

  const createFixture = (failureMode: FailureMode = 'none') => {
    facade.failureMode = failureMode;
    const fixture = TestBed.createComponent(OutcomeListEditorComponent);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance };
  };

  const fillForm = (component: OutcomeListEditorComponent, prerequisites: readonly string[] = []) => {
    component.editorForm.setValue({
      courseId: courseOneId,
      code: 'OUT-NEW',
      title: 'New measurable outcome',
      description: 'Description',
      level: 2,
      status: 'draft',
      prerequisiteOutcomeIds: [...prerequisites]
    });
  };

  it('loads courses and outcomes through the facade and renders accessible list/form controls', () => {
    const { fixture, component } = createFixture();

    expect(facade.loadCourses).toHaveBeenCalledTimes(1);
    expect(facade.loadOutcomes).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('h1')?.textContent.trim()).toBe('Outcomes');
    expect(fixture.nativeElement.querySelector('label[for="outcome-search"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('label[for="outcome-prerequisites"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[role="status"]')).not.toBeNull();
    expect(component.visibleOutcomes()).toHaveLength(3);
  });
  it('renders the shared slow state, hides stale rows, and retries without losing filters', () => {
    const { fixture } = createFixture();
    const callsBeforeRetry = facade.loadOutcomes.mock.calls.length;
    facade.outcomesRequestState.set(requestState('slow'));
    fixture.detectChanges();

    const state = fixture.nativeElement.querySelector('app-request-state');
    expect(state).not.toBeNull();
    expect(state?.querySelector('.request-state--slow')).not.toBeNull();
    expect(state?.textContent).toContain('Outcome list is taking longer than expected');
    expect(state?.textContent).toContain('Courses and outcomes are still loading.');
    expect(state?.querySelector('.retry-action')?.textContent?.trim()).toBe('Try again');
    expect(fixture.nativeElement.querySelector('.outcome-list')).toBeNull();
    expect(fixture.nativeElement.querySelector('form.editor-form')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Model outcomes');
    expect(fixture.nativeElement.querySelector('.outcome-workspace')?.getAttribute('aria-busy')).toBe('true');

    (state?.querySelector('.retry-action') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(facade.loadOutcomes.mock.calls.length).toBeGreaterThan(callsBeforeRetry);
  });

  it('keeps loading distinct from slow while hiding stale editor data', () => {
    const { fixture } = createFixture();
    facade.outcomesRequestState.set(requestState('loading'));
    fixture.detectChanges();

    const state = fixture.nativeElement.querySelector('app-request-state');
    expect(state?.querySelector('.request-state--loading')).not.toBeNull();
    expect(state?.querySelector('.request-state--slow')).toBeNull();
    expect(fixture.nativeElement.querySelector('.outcome-list')).toBeNull();
    expect(fixture.nativeElement.querySelector('form.editor-form')).toBeNull();
    expect(fixture.nativeElement.querySelector('.outcome-workspace')?.getAttribute('aria-busy')).toBe('true');
  });

  it('renders authorized empty outcomes without stale rows and keeps the editor available', () => {
    const { fixture } = createFixture();
    facade.outcomes.set([]);
    facade.visibleOutcomes.set([]);
    facade.outcomesRequestState.set(requestState('empty'));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No outcomes found');
    expect(fixture.nativeElement.querySelector('.outcome-list')).toBeNull();
    expect(fixture.nativeElement.querySelector('form.editor-form')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.outcome-workspace > app-request-state')).toBeNull();
  });

  it('blocks stale rows on a failed reload and applies unauthorized precedence', () => {
    const { fixture, component } = createFixture();
    facade.failureMode = 'error';
    component.loadData();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-request-state .request-state--assertive')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.outcome-list')).toBeNull();
    expect(fixture.nativeElement.querySelector('form.editor-form')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Model outcomes');

    facade.coursesRequestState.set(requestState('unauthorized'));
    facade.outcomesRequestState.set(requestState('error'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('permission');
    expect(fixture.nativeElement.querySelector('app-request-state .request-state[role="alert"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.request-state--error')).toBeNull();
    expect(fixture.nativeElement.querySelector('.outcome-list')).toBeNull();
  });
  it('ignores superseded outcome-list callbacks after a newer error', () => {
    const { component } = createFixture();
    const staleCourses = new Subject<readonly Course[]>();
    const staleOutcomes = new Subject<readonly LearningOutcome[]>();
    facade.loadCourses
      .mockImplementationOnce(() => staleCourses)
      .mockImplementationOnce(() => throwError(() => new Error('Latest courses failed')));
    facade.loadOutcomes
      .mockImplementationOnce(() => staleOutcomes)
      .mockImplementationOnce(() => throwError(() => new Error('Latest outcomes failed')));
    const courseValidity = vi.spyOn(component.editorForm.controls.courseId, 'updateValueAndValidity');
    const validityCallsBeforeRetry = courseValidity.mock.calls.length;

    component.loadData();
    component.loadData();
    facade.coursesRequestState.set(requestState('error'));
    facade.outcomesRequestState.set(requestState('error'));

    staleOutcomes.next(facade.outcomes());
    staleOutcomes.error(new Error('Old outcomes failed'));
    staleCourses.next(facade.courses());
    staleCourses.error(new Error('Old courses failed'));

    expect(component.coursesLoaded()).toBe(false);
    expect(component.outcomesLoaded()).toBe(false);
    expect(component.liveMessage()).toBe('Outcomes could not be loaded. Try again.');
    expect(courseValidity).toHaveBeenCalledTimes(validityCallsBeforeRetry);
  });


  it('creates and updates outcome payloads without replacing the form optimistically', () => {
    const { component } = createFixture();
    component.startCreate();
    fillForm(component, [outcomeOneId]);
    component.save();

    expect(facade.createOutcome).toHaveBeenCalledWith(expect.objectContaining({
      courseId: courseOneId,
      code: 'OUT-NEW',
      level: 2,
      prerequisiteOutcomeIds: [outcomeOneId],
      status: 'draft'
    }));

    component.selectOutcome(outcomeOneId);
    component.editorForm.controls.title.setValue('Updated title');
    component.save();
    expect(facade.updateOutcome).toHaveBeenCalledWith(
      outcomeOneId,
      expect.objectContaining({ title: 'Updated title', courseId: courseOneId })
    );
  });

  it('publishes with an explicit published status payload', () => {
    const { component } = createFixture();
    component.selectOutcome(outcomeTwoId);
    component.publish();

    expect(facade.updateOutcome).toHaveBeenCalledWith(
      outcomeTwoId,
      expect.objectContaining({ status: 'published' })
    );
  });

  it('blocks self and cross-course prerequisite relationships before writes', () => {
    const { component } = createFixture();
    component.selectOutcome(outcomeOneId);
    component.editorForm.controls.prerequisiteOutcomeIds.setValue([outcomeOneId as string]);
    component.save();
    expect(facade.updateOutcome).not.toHaveBeenCalled();

    component.startCreate();
    fillForm(component, [outcomeThreeId]);
    component.save();
    expect(facade.createOutcome).not.toHaveBeenCalled();
    expect(component.fieldError('prerequisiteOutcomeIds')).toContain('selected course');
  });

  it('blocks publishing when a selected prerequisite is not published', () => {
    const { component } = createFixture();
    component.startCreate();
    fillForm(component, [outcomeTwoId]);
    component.publish();

    expect(facade.createOutcome).not.toHaveBeenCalled();
    expect(component.fieldError('prerequisiteOutcomeIds')).toContain('Publish every');
  });

  it('clears invalid prerequisite selections and announces the course change', () => {
    const { component } = createFixture();
    component.startCreate();
    fillForm(component, [outcomeOneId]);
    component.editorForm.controls.courseId.setValue(courseTwoId);

    expect(component.editorForm.controls.prerequisiteOutcomeIds.value).toEqual([]);
    expect(component.liveMessage()).toContain('cleared');
  });

  it('renders retryable service errors and unauthorized state without editor actions', () => {
    const error = createFixture('error');
    expect(error.fixture.nativeElement.querySelector('.retry-action')).not.toBeNull();
    (error.fixture.nativeElement.querySelector('.retry-action') as HTMLButtonElement).click();
    expect(facade.loadOutcomes).toHaveBeenCalledTimes(2);

    const unauthorized = createFixture('unauthorized');
    expect(unauthorized.fixture.nativeElement.textContent).toContain('permission');
    expect(unauthorized.fixture.nativeElement.querySelector('form.editor-form')).toBeNull();
  });
  it('preserves edited values and exposes actionable feedback after a failed write', () => {
    const { fixture, component } = createFixture();
    component.selectOutcome(outcomeOneId);
    component.editorForm.controls.title.setValue('Edited but unsaved');
    facade.writeFailure = true;

    component.save();
    fixture.detectChanges();

    expect(facade.updateOutcome).toHaveBeenCalledWith(
      outcomeOneId,
      expect.objectContaining({ title: 'Edited but unsaved' })
    );
    expect(component.editorForm.controls.title.value).toBe('Edited but unsaved');
    expect(component.feedbackKind()).toBe('error');
    expect(component.feedbackMessage()).toContain('Save failed');
    expect(fixture.nativeElement.querySelector('.outcome-list')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('form.editor-form')).not.toBeNull();
  });

  it('keeps conflict feedback distinct from ordinary success feedback', () => {
    const { fixture, component } = createFixture();
    facade.outcomesRequestState.set({ status: 'conflict', requestId: 2, error: new Error('Version changed') });
    fixture.detectChanges();

    expect(component.isConflict()).toBe(true);
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('conflict');
  });
});
