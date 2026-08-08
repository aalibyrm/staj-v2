import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { DEMO_ACCOUNTS, type AuthSession } from '../../../core/auth/authorization';
import { SessionStore } from '../../../core/auth/session.store';
import { RubricGradingFacade, type RubricGradingRequestState } from '../data-access/rubric-grading.facade';
import { RubricGradingRepository } from '../data-access/rubric-grading.repository';
import { MockTransport } from '../../../core/api/mock-transport';
import type { GradingWorkflowState, GradingWorkflowStatus } from '../models/grading-workflow.models';
import type { RubricGrading } from '../models/rubric.models';
import { provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';
import { RouterTestingHarness } from '@angular/router/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { RubricGraderComponent } from './rubric-grader.component';
import { ScoreChangePanelComponent } from './score-change-panel.component';

const instructorAccount = DEMO_ACCOUNTS.find((account) => account.roleCode === 'INSTRUCTOR')!;
const studentAccount = DEMO_ACCOUNTS.find((account) => account.roleCode === 'STUDENT')!;

/** An instructor session whose student-scope grant is global, so it matches any fixture attempt's student. */
const authorizedInstructorSession = (): AuthSession =>
  Object.freeze({
    accountId: instructorAccount.id,
    account: Object.freeze({
      ...instructorAccount,
      scopeGrants: Object.freeze([Object.freeze({ kind: 'student' as const, ids: [], global: true })])
    })
  });

const studentSession = (): AuthSession => Object.freeze({ accountId: studentAccount.id, account: studentAccount });

const sessionStoreProvider = (session: AuthSession | null) => ({
  provide: SessionStore,
  useValue: { session: signal(session) }
});

describe('RubricGraderComponent', () => {
  it('loads the route attempt, renders native level radios, validates required selections, and shows workflow status', async () => {
    TestBed.configureTestingModule({
      imports: [RubricGraderComponent],
      providers: [
        provideRouter([{ path: 'grading/:attemptId', component: RubricGraderComponent }]),
        sessionStoreProvider(authorizedInstructorSession())
      ]
    });
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/grading/attempt-ui', RubricGraderComponent);
    await harness.fixture.whenStable();
    await vi.waitFor(() => {
      expect(component.facade.context()?.attemptId).toBe('attempt-ui');
    });
    harness.detectChanges();
    const element = harness.routeNativeElement as HTMLElement;
    expect(element.querySelectorAll('input[type="radio"]').length).toBeGreaterThan(0);
    expect(element.querySelectorAll('textarea').length).toBeGreaterThan(0);
    const workflowStatus = element.querySelector('.workflow-status');
    expect(workflowStatus?.getAttribute('aria-live')).toBe('polite');
    expect(workflowStatus?.textContent).toContain('Pending');
    expect(workflowStatus?.textContent).toContain('0 / 3 criteria scored');
    component.reviewRubric();
    harness.detectChanges();
    await harness.fixture.whenRenderingDone();
    const summary = element.querySelector<HTMLElement>('.validation-summary');
    expect(summary).not.toBeNull();
    expect(summary?.getAttribute('role')).toBe('alert');
    expect(summary?.querySelectorAll('li')).toHaveLength(3);
    expect(document.activeElement).toBe(summary);
  });

  it('recalculates a live total after every criterion selection without a save action', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RubricGraderComponent],
      providers: [
        provideRouter([{ path: 'grading/:attemptId', component: RubricGraderComponent }]),
        sessionStoreProvider(authorizedInstructorSession())
      ]
    });
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/grading/attempt-live', RubricGraderComponent);
    await harness.fixture.whenStable();
    await vi.waitFor(() => {
      expect(component.scoringState()?.total).toBe(0);
    });
    harness.detectChanges();
    component.facade.rubric()?.criteria.forEach((criterion, index) => {
      component.criterionForm(index).controls.levelId.setValue(criterion.levels.at(-1)?.id ?? null);
    });
    harness.detectChanges();

    expect(component.scoringState()?.total).toBe(100);
    expect(harness.routeNativeElement?.textContent).toContain('No changes are saved');
    expect(harness.routeNativeElement?.querySelector('button[type="submit"]')?.textContent).toContain('Review rubric');
  });

  it('shows the unauthorized request state and renders no response, rubric, or form content for a denied role', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RubricGraderComponent],
      providers: [
        provideRouter([{ path: 'grading/:attemptId', component: RubricGraderComponent }]),
        sessionStoreProvider(studentSession())
      ]
    });
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/grading/attempt-denied', RubricGraderComponent);
    await harness.fixture.whenStable();
    await vi.waitFor(() => expect(component.facade.requestState().status).toBe('unauthorized'));
    harness.detectChanges();
    await harness.fixture.whenRenderingDone();
    const element = harness.routeNativeElement as HTMLElement;
    const state = element.querySelector('app-request-state') as HTMLElement;
    expect(state.textContent).toContain('Grading unavailable');
    expect(state.textContent).toContain('Your role does not permit grading this attempt.');
    expect(state.querySelector('[role="alert"]')).not.toBeNull();
    expect(state.querySelector('button.retry-action')).toBeNull();
    expect(element.querySelector('form.grading-form')).toBeNull();
    expect(element.querySelectorAll('input[type="radio"]').length).toBe(0);
    expect(element.querySelectorAll('textarea').length).toBe(0);
    expect(element.textContent).not.toContain('Explain the reasoning');
  });

  it('retries through the facade and applies recovered grading when context was cleared', async () => {
    TestBed.resetTestingModule();
    const recovered = new RubricGradingRepository().fixtureForAttempt('attempt-retry');
    const requestState = signal<RubricGradingRequestState>({
      status: 'error',
      message: 'Service unavailable',
      retryable: true
    });
    const grading = signal<RubricGrading | null>(null);
    const rubric = signal<RubricGrading['rubric'] | null>(null);
    const workflowState = signal<GradingWorkflowState | null>(null);
    const workflowStatus = signal<GradingWorkflowStatus | null>(null);
    let loadMode: 'error' | 'unauthorized' | 'empty' = 'error';
    const errorMessage = signal('Service unavailable');
    const load = vi.fn(() => {
      grading.set(null);
      rubric.set(null);
      workflowState.set(null);
      workflowStatus.set(null);
      if (loadMode === 'unauthorized') {
        errorMessage.set('This grading attempt is outside your data scope.');
        requestState.set({ status: 'unauthorized', message: errorMessage(), retryable: false });
        return of(null);
      }
      if (loadMode === 'empty') {
        errorMessage.set('No grading attempt is available for this route.');
        requestState.set({ status: 'empty', message: errorMessage(), retryable: false });
        return of(null);
      }
      errorMessage.set('Service unavailable');
      requestState.set({ status: 'error', message: errorMessage(), retryable: true });
      return throwError(() => new Error('service'));
    });
    const retry = vi.fn(() => {
      grading.set(recovered);
      rubric.set(recovered.rubric);
      requestState.set({ status: 'ready' });
      workflowState.set({
        status: 'pending',
        criterionCount: recovered.rubric.criteria.length,
        scoredCriterionCount: 0,
        evaluationCount: 1,
        isComplete: false
      });
      workflowStatus.set('pending');
      return of(recovered);
    });
    const facade = {
      requestState,
      errorMessage,
      grading,
      context: signal<RubricGrading['context'] | null>(null),
      rubric,
      workflowState,
      workflowStatus,
      isGradable: signal(false),
      scoreChangeHistory: signal([]),
      reEvaluationTimeline: signal([]),
      scoreChangeState: signal({ status: 'idle' }),
      previousScoreChangeTotal: signal(0),
      displayedScoreTotal: signal(0),
      lastNotification: signal(null),
      load,
      retry
    } as unknown as RubricGradingFacade;

    TestBed.configureTestingModule({
      imports: [RubricGraderComponent],
      providers: [provideRouter([{ path: 'grading/:attemptId', component: RubricGraderComponent }])]
    });
    TestBed.overrideComponent(RubricGraderComponent, {
      set: { providers: [{ provide: RubricGradingFacade, useValue: facade }] }
    });
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/grading/attempt-retry', RubricGraderComponent);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(facade.context()).toBeNull();
    const failedElement = harness.routeNativeElement as HTMLElement;
    expect(failedElement.textContent).toContain('Unable to load grading');
    expect(failedElement.textContent).toContain('Service unavailable');
    expect(failedElement.querySelector('form.grading-form')).toBeNull();
    expect(failedElement.querySelector('button.retry-action')).not.toBeNull();

    const retryButton = harness.routeNativeElement?.querySelector<HTMLButtonElement>('.retry-action');
    expect(retryButton).not.toBeNull();
    retryButton?.click();
    harness.detectChanges();

    expect(retry).toHaveBeenCalledTimes(1);
    expect(component.rubricForm.controls.criteria.length).toBe(recovered.rubric.criteria.length);
    expect(component.scoringState()).not.toBeNull();
    expect(harness.routeNativeElement?.querySelector('form.grading-form')).not.toBeNull();
    expect(harness.routeNativeElement?.textContent).toContain(recovered.context.attemptId);
    expect(harness.routeNativeElement?.querySelector('.workflow-status')?.textContent).toContain('Pending');
    loadMode = 'unauthorized';
    component.load('attempt-retry');
    harness.detectChanges();
    const deniedElement = harness.routeNativeElement as HTMLElement;
    expect(load).toHaveBeenCalledTimes(2);
    expect(deniedElement.textContent).toContain('Grading unavailable');
    expect(deniedElement.textContent).toContain('This grading attempt is outside your data scope.');
    expect(deniedElement.querySelector('form.grading-form')).toBeNull();
    expect(deniedElement.textContent).not.toContain(recovered.context.attemptId);
    expect(deniedElement.querySelector('button.retry-action')).toBeNull();
    loadMode = 'empty';
    component.load('attempt-retry');
    harness.detectChanges();
    const emptyElement = harness.routeNativeElement as HTMLElement;
    expect(load).toHaveBeenCalledTimes(3);
    expect(emptyElement.textContent).toContain('No grading attempt found');
    expect(emptyElement.querySelector('form.grading-form')).toBeNull();
    expect(emptyElement.textContent).toContain('This route does not resolve to an available grading attempt.');
  });

  it('renders distinct loading and slow grading states at 399/400 ms and recovers the cleared form on retry', async () => {
    TestBed.resetTestingModule();
    vi.useFakeTimers();
    let harness: RouterTestingHarness | undefined;
    try {
      const repository = new RubricGradingRepository(new MockTransport());
      repository.setMockScenario({ latencyMs: 1_000 });
      TestBed.configureTestingModule({
        imports: [RubricGraderComponent],
        providers: [
          provideRouter([{ path: 'grading/:attemptId', component: RubricGraderComponent }]),
          sessionStoreProvider(authorizedInstructorSession()),
          { provide: RubricGradingRepository, useValue: repository }
        ]
      });
      harness = await RouterTestingHarness.create();
      const component = await harness.navigateByUrl('/grading/attempt-slow', RubricGraderComponent);
      harness.detectChanges();
      await vi.advanceTimersByTimeAsync(399);
      harness.detectChanges();
      expect(component.facade.requestState().status).toBe('loading');
      expect(harness.routeNativeElement?.querySelector('.request-state--loading')).not.toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      harness.detectChanges();
      expect(component.facade.requestState().status).toBe('slow');
      expect(harness.routeNativeElement?.querySelector('.request-state--slow')).not.toBeNull();
      expect(harness.routeNativeElement?.textContent).toContain('Grading attempt is taking longer');
      expect(harness.routeNativeElement?.querySelector('form.grading-form')).toBeNull();

      repository.resetMockScenario();
      (harness.routeNativeElement?.querySelector('button.retry-action') as HTMLButtonElement).click();
      await vi.advanceTimersByTimeAsync(0);
      harness.detectChanges();
      expect(component.facade.requestState().status).toBe('ready');
      expect(harness.routeNativeElement?.querySelector('form.grading-form')).not.toBeNull();
      expect(component.rubricForm.controls.criteria.length).toBeGreaterThan(0);
    } finally {
      harness?.fixture.destroy();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('reflects live rubric selections in the workflow status region as criteria are scored', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RubricGraderComponent],
      providers: [
        provideRouter([{ path: 'grading/:attemptId', component: RubricGraderComponent }]),
        sessionStoreProvider(authorizedInstructorSession())
      ]
    });
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/grading/attempt-status-flow', RubricGraderComponent);
    await harness.fixture.whenStable();
    await vi.waitFor(() => {
      expect(component.facade.rubric()?.criteria.length).toBe(3);
    });
    harness.detectChanges();
    const element = harness.routeNativeElement as HTMLElement;

    expect(element.querySelector('.workflow-status')?.getAttribute('data-workflow-status')).toBe('pending');
    expect(element.querySelector('.workflow-status')?.textContent).toContain('Pending');
    expect(element.querySelector('.workflow-status')?.textContent).toContain('0 / 3 criteria scored');

    const criteria = component.facade.rubric()!.criteria;
    component.criterionForm(0).controls.levelId.setValue(criteria[0].levels.at(-1)!.id);
    harness.detectChanges();
    expect(element.querySelector('.workflow-status')?.getAttribute('data-workflow-status')).toBe('partial');
    expect(element.querySelector('.workflow-status')?.textContent).toContain('Partially graded');
    expect(element.querySelector('.workflow-status')?.textContent).toContain('1 / 3 criteria scored');

    criteria.forEach((criterion, index) => {
      component.criterionForm(index).controls.levelId.setValue(criterion.levels.at(-1)!.id);
    });
    harness.detectChanges();
    expect(element.querySelector('.workflow-status')?.getAttribute('data-workflow-status')).toBe('graded');
    expect(element.querySelector('.workflow-status')?.textContent).toContain('Graded');
    expect(element.querySelector('.workflow-status')?.textContent).toContain('3 / 3 criteria scored');
  });

  it('shows re-evaluated once every criterion is scored on an attempt with two or more evaluations', async () => {
    TestBed.resetTestingModule();
    const base = new RubricGradingRepository().fixtureForAttempt('attempt-reeval');
    const regraded: RubricGrading = {
      ...base,
      selectedLevelIds: Object.fromEntries(
        base.rubric.criteria.map((criterion) => [criterion.id, criterion.levels.at(-1)!.id])
      )
    };
    const requestState = signal<RubricGradingRequestState>({ status: 'ready' });
    const grading = signal<RubricGrading | null>(regraded);
    const rubric = signal<RubricGrading['rubric'] | null>(regraded.rubric);
    const workflowState = signal<GradingWorkflowState | null>({
      status: 're-evaluated',
      criterionCount: regraded.rubric.criteria.length,
      scoredCriterionCount: regraded.rubric.criteria.length,
      evaluationCount: 2,
      isComplete: true
    });
    const workflowStatus = signal<GradingWorkflowStatus | null>('re-evaluated');
    const load = vi.fn(() => of(regraded));
    const retry = vi.fn(() => of(regraded));
    const facade = {
      requestState,
      errorMessage: signal(''),
      grading,
      context: signal(regraded.context),
      rubric,
      workflowState,
      workflowStatus,
      isGradable: signal(true),
      scoreChangeHistory: signal([]),
      reEvaluationTimeline: signal([]),
      scoreChangeState: signal({ status: 'idle' }),
      previousScoreChangeTotal: signal(0),
      displayedScoreTotal: signal(0),
      lastNotification: signal(null),
      load,
      retry
    } as unknown as RubricGradingFacade;

    TestBed.configureTestingModule({
      imports: [RubricGraderComponent],
      providers: [provideRouter([{ path: 'grading/:attemptId', component: RubricGraderComponent }])]
    });
    TestBed.overrideComponent(RubricGraderComponent, {
      set: { providers: [{ provide: RubricGradingFacade, useValue: facade }] }
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/grading/attempt-reeval', RubricGraderComponent);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(load).toHaveBeenCalledTimes(1);
    const workflowStatusEl = harness.routeNativeElement?.querySelector('.workflow-status');
    expect(workflowStatusEl?.getAttribute('data-workflow-status')).toBe('re-evaluated');
    expect(workflowStatusEl?.textContent).toContain('Re-evaluated');
    expect(workflowStatusEl?.textContent).toContain('3 / 3 criteria scored');
  });

  it('blocks the score change confirmation while the reason is blank, then applies it and renders the timeline', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RubricGraderComponent],
      providers: [
        provideRouter([{ path: 'grading/:attemptId', component: RubricGraderComponent }]),
        sessionStoreProvider(authorizedInstructorSession())
      ]
    });
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/grading/attempt-score-change', RubricGraderComponent);
    await harness.fixture.whenStable();
    await vi.waitFor(() => {
      expect(component.facade.rubric()?.criteria.length).toBe(3);
    });
    component.facade.rubric()?.criteria.forEach((criterion, index) => {
      component.criterionForm(index).controls.levelId.setValue(criterion.levels.at(-1)?.id ?? null);
    });
    harness.detectChanges();

    const element = harness.routeNativeElement as HTMLElement;
    expect(element.textContent).toContain('No score changes have been recorded');
    const applyButton = element.querySelector<HTMLButtonElement>('.review-actions .secondary-action');
    expect(applyButton?.disabled).toBe(false);
    applyButton?.click();
    harness.detectChanges();
    await harness.fixture.whenRenderingDone();

    const panel = element.querySelector<HTMLElement>('.score-change-confirmation');
    expect(panel?.getAttribute('role')).toBe('dialog');
    expect(document.activeElement).toBe(panel);

    const confirmButton = panel?.querySelector<HTMLButtonElement>('button[type="button"]:not(.secondary-action)');
    expect(confirmButton?.disabled).toBe(true);
    const scoreChangePanel = harness.fixture.debugElement.query(By.directive(ScoreChangePanelComponent)).componentInstance as ScoreChangePanelComponent;
    scoreChangePanel.confirm();
    harness.detectChanges();
    await harness.fixture.whenRenderingDone();
    const alertMessage = panel?.querySelector<HTMLElement>('[role="alert"]');
    expect(alertMessage?.textContent).toContain('Enter a nonblank reason');
    const reasonTextarea = panel?.querySelector<HTMLTextAreaElement>('#score-change-reason');
    expect(document.activeElement).toBe(reasonTextarea);
    expect(element.querySelector('.score-change-confirmation')).not.toBeNull();

    reasonTextarea!.value = 'Reconsidered the reasoning criterion after a second read.';
    reasonTextarea!.dispatchEvent(new Event('input'));
    harness.detectChanges();
    expect(confirmButton?.disabled).toBe(false);
    confirmButton?.click();
    harness.detectChanges();
    await vi.waitFor(() => {
      expect(component.facade.scoreChangeState().status).toBe('saved');
    });
    harness.detectChanges();
    await harness.fixture.whenRenderingDone();

    expect(element.querySelector('.score-change-confirmation')).toBeNull();
    expect(component.liveStatus()).toContain('Score change applied');
    expect(component.facade.scoreChangeHistory()).toHaveLength(1);
    const timelineItem = element.querySelector<HTMLElement>('.reevaluation-item');
    expect(timelineItem?.textContent).toContain('Reconsidered the reasoning criterion after a second read.');
    expect(timelineItem?.textContent).toContain(instructorAccount.id);
    expect(timelineItem?.textContent).toContain('Evaluation 2');
    expect(document.activeElement).toBe(applyButton);
    expect(applyButton?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(applyButton?.getAttribute('aria-expanded')).toBe('false');
    applyButton?.click();
    harness.detectChanges();
    await harness.fixture.whenRenderingDone();
    const reopenedPanel = element.querySelector<HTMLElement>('.score-change-confirmation');
    expect(reopenedPanel).not.toBeNull();
    reopenedPanel?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    harness.detectChanges();
    expect(element.querySelector('.score-change-confirmation')).toBeNull();
    expect(document.activeElement).toBe(applyButton);
  });

  it('shows the pending marker while saving, then the assertive failure alert with a retry action that reopens the confirmation dialog', async () => {
    TestBed.resetTestingModule();
    const repository = new RubricGradingRepository(new MockTransport());
    const sessionStore = { session: signal(authorizedInstructorSession()) } as unknown as SessionStore;
    const facade = new RubricGradingFacade(repository, sessionStore);

    TestBed.configureTestingModule({
      imports: [RubricGraderComponent],
      providers: [provideRouter([{ path: 'grading/:attemptId', component: RubricGraderComponent }])]
    });
    TestBed.overrideComponent(RubricGraderComponent, {
      set: { providers: [{ provide: RubricGradingFacade, useValue: facade }] }
    });
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/grading/attempt-optimistic-ui', RubricGraderComponent);
    await harness.fixture.whenStable();
    await vi.waitFor(() => {
      expect(component.facade.rubric()?.criteria.length).toBe(3);
    });
    component.facade.rubric()?.criteria.forEach((criterion, index) => {
      component.criterionForm(index).controls.levelId.setValue(criterion.levels.at(-1)?.id ?? null);
    });
    harness.detectChanges();

    const element = harness.routeNativeElement as HTMLElement;
    const applyButton = element.querySelector<HTMLButtonElement>('.review-actions .secondary-action');
    applyButton?.click();
    harness.detectChanges();
    await harness.fixture.whenRenderingDone();

    repository.setMockScenario({ outcome: 'service-error' });
    const reasonTextarea = element.querySelector<HTMLTextAreaElement>('#score-change-reason');
    reasonTextarea!.value = 'Reconsidered after a second read, expecting failure.';
    reasonTextarea!.dispatchEvent(new Event('input'));
    harness.detectChanges();
    const confirmButton = element
      .querySelector<HTMLElement>('.score-change-confirmation')
      ?.querySelector<HTMLButtonElement>('button[type="button"]:not(.secondary-action)');
    confirmButton?.click();
    harness.detectChanges();

    expect(element.querySelector('.score-change-confirmation')).toBeNull();
    expect(element.textContent).toContain('Applying…');

    await vi.waitFor(() => {
      expect(component.facade.lastNotification()).not.toBeNull();
    });
    harness.detectChanges();
    await harness.fixture.whenRenderingDone();

    const alert = element.querySelector<HTMLElement>('[role="alert"][aria-live="assertive"]');
    expect(alert?.textContent).toContain('The service is temporarily unavailable.');
    expect(component.liveStatus()).toContain('previous total was restored');
    const retryButton = alert?.querySelector<HTMLButtonElement>('button');
    expect(retryButton).not.toBeNull();

    retryButton?.click();
    harness.detectChanges();
    await harness.fixture.whenRenderingDone();
    expect(element.querySelector('.score-change-confirmation')).not.toBeNull();
  });
});
