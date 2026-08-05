import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { NEVER, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ROUTE_CAPABILITIES } from '../../../core/auth/authorization';
import { ROUTE_CAPABILITIES_DATA_KEY, authGuard } from '../../../core/auth/auth.guard';
import { adaptiveLearningRoutes } from '../../adaptive-learning/adaptive-learning.routes';
import { ExamSessionFacade, EXAM_SESSION_QUESTION_SOURCE, type ExamSessionQuestionSource } from '../data-access/exam-session.facade';
import { ExamSessionRepository } from '../data-access/exam-session.repository';
import { ExamSessionComponent } from './exam-session.component';

const questionSource: ExamSessionQuestionSource = () => of([
  {
    id: 'question-a',
    order: 1,
    prompt: 'Choose the first observation.',
    kind: 'single' as const,
    points: 1,
    options: [{ id: 'a', label: 'Observation A' }, { id: 'b', label: 'Observation B' }]
  },
  {
    id: 'question-b',
    order: 2,
    prompt: 'Write the next step.',
    kind: 'text' as const,
    points: 1,
    options: []
  },
  {
    id: 'question-c',
    order: 3,
    prompt: 'Select the review evidence.',
    kind: 'multiple' as const,
    points: 1,
    options: [{ id: 'a', label: 'Recent evidence' }, { id: 'b', label: 'Relevant evidence' }]
  }
]);

const createSessionFacade = (nowSource: () => number = () => 10): ExamSessionFacade => {
  const repository = new ExamSessionRepository({
    tokenSource: () => 'test-token',
    referenceTimeSource: () => '2026-01-01T00:00:00.000Z'
  });
  repository.open({
    routeToken: 'test-token',
    studentId: 'student-test',
    examId: 'exam-test',
    durationMs: 60_000,
    referenceTime: '2026-01-01T00:00:00.000Z'
  }).subscribe((session) => {
    repository.transition(session.routeToken, 'active', { expectedVersion: session.version }).subscribe();
  });
  return new ExamSessionFacade(repository, questionSource, nowSource);
};
const createControlledRepository = (): ExamSessionRepository => {
  const repository = new ExamSessionRepository({
    idSource: () => 'session-test',
    tokenSource: () => 'test-token',
    referenceTimeSource: () => '2026-01-01T00:00:00.000Z'
  });
  repository.open({
    routeToken: 'test-token',
    studentId: 'student-test',
    examId: 'exam-test',
    durationMs: 60_000,
    referenceTime: '2026-01-01T00:00:00.000Z'
  }).subscribe((session) => {
    repository.transition(session.routeToken, 'active', { expectedVersion: session.version }).subscribe();
  });
  return repository;
};

const createLoadedFacade = (repository: ExamSessionRepository): ExamSessionFacade => {
  const facade = new ExamSessionFacade(repository, questionSource, () => 10);
  facade.load('test-token').subscribe({ error: (error) => { throw error; } });
  return facade;
};

describe('ExamSessionComponent and ExamSessionFacade', () => {
  const routeParam = vi.fn(() => 'session-token');

  beforeEach(() => {
    routeParam.mockReset();
    routeParam.mockReturnValue('session-token');
    TestBed.configureTestingModule({
      imports: [ExamSessionComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: routeParam } } } }
      ]
    });
  });

  const create = async (source: ExamSessionQuestionSource = questionSource) => {
    TestBed.overrideProvider(EXAM_SESSION_QUESTION_SOURCE, { useValue: source });
    const fixture = TestBed.createComponent(ExamSessionComponent);
    fixture.detectChanges();
    fixture.componentInstance.facade.ngOnDestroy();
    await fixture.whenRenderingDone();
    fixture.detectChanges();
    return fixture;
  };

  it('renders active workspace hierarchy without correctness or solution leakage', async () => {
    const fixture = await create();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('#exam-session-heading')?.textContent).toContain('Exam session');
    expect(element.querySelector('.navigator-panel')).not.toBeNull();
    expect(element.querySelector('.question-card')).not.toBeNull();
    expect(element.querySelector('.summary-region')).not.toBeNull();
    expect(element.textContent?.toLowerCase()).not.toContain('solution');
    expect(element.textContent?.toLowerCase()).not.toContain('correct answer');
    expect(element.querySelector('[aria-live="polite"]')).not.toBeNull();
    expect(element.querySelector('.navigator-trigger')?.getAttribute('aria-controls')).toBe('question-navigator');
    expect(element.querySelector('.navigator-key')?.textContent).toContain('Answered');
    expect(element.querySelector('.navigator-key')?.textContent).toContain('Unanswered');
    expect(element.querySelector('.navigator-key')?.textContent).toContain('Flagged');
  });
  it('renders the accessible autosave live indicator and exposes a retry action state', async () => {
    const fixture = await create();
    const indicator = fixture.nativeElement.querySelector('.autosave-indicator') as HTMLElement;
    expect(indicator).not.toBeNull();
    expect(indicator.getAttribute('aria-live')).toBe('polite');
    expect(fixture.nativeElement.textContent).toContain('No answers yet');
  });

  it('uses a loading skeleton while the question request is slow', async () => {
    const fixture = await create(() => NEVER);
    expect(fixture.nativeElement.querySelector('app-request-state')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Loading exam session');
  });

  it('renders an empty question set without private answer controls', async () => {
    const fixture = await create(() => of([]));
    expect(fixture.nativeElement.textContent).toContain('No questions available');
    expect(fixture.nativeElement.querySelector('.question-card')).toBeNull();
  });

  it('renders service error and retries through the facade', async () => {
    let shouldFail = true;
    const retrySource: ExamSessionQuestionSource = (session) => shouldFail
      ? throwError(() => new Error('Service unavailable'))
      : questionSource(session);
    const fixture = await create(retrySource);
    expect(fixture.nativeElement.textContent).toContain('Unable to open exam session');
    shouldFail = false;
    (fixture.nativeElement.querySelector('button.retry-action') as HTMLButtonElement).click();
    fixture.componentInstance.facade.ngOnDestroy();
    await fixture.whenRenderingDone();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.question-card')).not.toBeNull();
  });

  it('updates answers immutably, derives progress, navigates, and toggles review', () => {
    const facade = createSessionFacade();
    facade.load('test-token').subscribe();
    const before = facade.drafts();
    expect(facade.progress()).toMatchObject({ total: 3, answered: 0, unanswered: 3, flagged: 0, current: 1 });
    expect(facade.updateAnswer('question-a', 'a')).toBe(true);
    expect(facade.drafts()).not.toBe(before);
    expect(before[0].answered).toBe(false);
    expect(facade.draftFor('question-a')?.answered).toBe(true);
    expect(facade.progress()).toMatchObject({ answered: 1, unanswered: 2 });
    expect(facade.goNext()).toBe(true);
    expect(facade.currentIndex()).toBe(1);
    expect(facade.goPrevious()).toBe(true);
    expect(facade.navigateTo(2)).toBe(true);
    expect(facade.toggleReview('question-c')).toBe(true);
    expect(facade.progress().flagged).toBe(1);
  });
  it('keeps an answer local immediately and reports saving then saved after the 300 ms debounce', async () => {
    vi.useFakeTimers();
    const repository = createControlledRepository();
    const facade = createLoadedFacade(repository);
    try {
      repository.setMockScenario({ latencyMs: 40 });
      expect(facade.updateAnswer('question-a', 'a')).toBe(true);
      expect(facade.draftFor('question-a')).toMatchObject({ value: 'a', version: 0 });
      expect(facade.autosaveState().status).toBe('idle');

      await vi.advanceTimersByTimeAsync(299);
      expect(facade.autosaveState().status).toBe('idle');
      await vi.advanceTimersByTimeAsync(1);
      expect(facade.autosaveState().status).toBe('saving');
      await vi.advanceTimersByTimeAsync(40);

      expect(facade.autosaveState().status).toBe('saved');
      expect(facade.draftFor('question-a')).toMatchObject({ value: 'a', version: 1 });
    } finally {
      facade.ngOnDestroy();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('persists only the latest rapid same-question edit with the next version', async () => {
    vi.useFakeTimers();
    const repository = createControlledRepository();
    const facade = createLoadedFacade(repository);
    try {
      repository.setMockScenario({ latencyMs: 400 });
      facade.updateAnswer('question-a', 'first');
      await vi.advanceTimersByTimeAsync(300);
      expect(facade.autosaveState().status).toBe('saving');

      await vi.advanceTimersByTimeAsync(50);
      facade.updateAnswer('question-a', 'latest');
      await vi.advanceTimersByTimeAsync(299);
      expect(repository.getSnapshot().drafts).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(facade.autosaveState().status).toBe('saving');
      await vi.advanceTimersByTimeAsync(400);

      expect(repository.getSnapshot().drafts).toEqual([expect.objectContaining({
        sessionId: 'session-test',
        drafts: [expect.objectContaining({ questionId: 'question-a', value: 'latest', version: 1 })]
      })]);
      expect(facade.draftFor('question-a')).toMatchObject({ value: 'latest', version: 1 });
    } finally {
      facade.ngOnDestroy();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('preserves the local answer on service error and retries after the repository recovers', async () => {
    vi.useFakeTimers();
    const repository = createControlledRepository();
    const facade = createLoadedFacade(repository);
    try {
      repository.setMockScenario({ outcome: 'service-error', latencyMs: 40, retryLimit: 0 });
      facade.updateAnswer('question-a', 'retry me');
      await vi.advanceTimersByTimeAsync(300);
      expect(facade.autosaveState().status).toBe('saving');
      await vi.advanceTimersByTimeAsync(40);

      expect(facade.autosaveState()).toMatchObject({ status: 'error', retryable: true });
      expect(facade.draftFor('question-a')).toMatchObject({ value: 'retry me', version: 0 });
      expect(repository.getSnapshot().drafts).toHaveLength(0);

      repository.setMockScenario({ outcome: 'success', latencyMs: 40 });
      expect(facade.retryAutosave()).toBe(true);
      expect(facade.autosaveState().status).toBe('saving');
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(40);

      expect(facade.autosaveState().status).toBe('saved');
      expect(repository.getSnapshot().drafts).toEqual([expect.objectContaining({
        sessionId: 'session-test',
        drafts: [expect.objectContaining({ value: 'retry me', version: 1 })]
      })]);
    } finally {
      facade.ngOnDestroy();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('hydrates persisted drafts on a new facade load', async () => {
    vi.useFakeTimers();
    const repository = createControlledRepository();
    const firstFacade = createLoadedFacade(repository);
    let secondFacade: ExamSessionFacade | null = null;
    try {
      repository.setMockScenario({ latencyMs: 20 });
      firstFacade.updateAnswer('question-a', 'persisted answer');
      await vi.advanceTimersByTimeAsync(320);
      expect(repository.getSnapshot().drafts).toEqual([expect.objectContaining({
        sessionId: 'session-test',
        drafts: [expect.objectContaining({ value: 'persisted answer', version: 1 })]
      })]);

      firstFacade.ngOnDestroy();
      repository.resetMockScenario();
      secondFacade = createLoadedFacade(repository);
      expect(secondFacade.draftFor('question-a')).toMatchObject({ value: 'persisted answer', version: 1 });
    } finally {
      firstFacade.ngOnDestroy();
      secondFacade?.ngOnDestroy();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('autosaves review-flag changes with the latest persisted flag', async () => {
    vi.useFakeTimers();
    const repository = createControlledRepository();
    const facade = createLoadedFacade(repository);
    try {
      repository.setMockScenario({ latencyMs: 20 });
      expect(facade.toggleReview('question-a')).toBe(true);
      expect(facade.draftFor('question-a')).toMatchObject({ flagged: true, version: 0 });
      await vi.advanceTimersByTimeAsync(300);
      expect(facade.autosaveState().status).toBe('saving');
      await vi.advanceTimersByTimeAsync(20);

      expect(facade.autosaveState().status).toBe('saved');
      expect(repository.getSnapshot().drafts).toEqual([expect.objectContaining({
        sessionId: 'session-test',
        drafts: [expect.objectContaining({ questionId: 'question-a', flagged: true, version: 1 })]
      })]);
    } finally {
      facade.ngOnDestroy();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('does not persist or retain autosave work when destroyed before debounce', async () => {
    vi.useFakeTimers();
    const repository = createControlledRepository();
    const facade = createLoadedFacade(repository);
    try {
      repository.setMockScenario({ latencyMs: 20 });
      facade.updateAnswer('question-a', 'discarded');
      expect(facade.draftFor('question-a')).toMatchObject({ value: 'discarded', version: 0 });

      facade.ngOnDestroy();
      expect(facade.autosaveState().status).toBe('idle');
      expect(facade.retryAutosave()).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(repository.getSnapshot().drafts).toHaveLength(0);
    } finally {
      facade.ngOnDestroy();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });


  it('moves focus to the new question heading after direct, previous, and next navigation', async () => {
    const fixture = await create();
    const component = fixture.componentInstance;
    component.selectQuestion(1);
    fixture.detectChanges();
    await fixture.whenRenderingDone();
    fixture.detectChanges();
    expect(document.activeElement?.id).toBe('current-question-heading');
    component.goPrevious();
    fixture.detectChanges();
    await fixture.whenRenderingDone();
    expect(document.activeElement?.id).toBe('current-question-heading');
  });

  it('warns from the synchronized timer, expires on a large monotonic jump, and rejects a late answer', () => {
    let monotonicNow = 10;
    const facade = createSessionFacade(() => monotonicNow);
    facade.load('test-token').subscribe();
    expect(facade.refreshTimer(59_000)?.warning).toBe(true);
    monotonicNow = 60_010;
    expect(facade.refreshTimer()?.expired).toBe(true);
    expect(facade.updateAnswer('question-b', 'too late')).toBe(false);
    expect(facade.draftFor('question-b')?.value).toBe(null);
  });

  it('rejects an exact-deadline answer without mutating the draft', () => {
    const facade = createSessionFacade();
    facade.load('test-token').subscribe();
    facade.refreshTimer(60_010);
    const before = facade.drafts();
    expect(facade.updateAnswer('question-a', 'a')).toBe(false);
    expect(facade.drafts()).toBe(before);
  });

  it('disables answer, flag, and finish actions after submitted or terminal transition', () => {
    const facade = createSessionFacade();
    facade.load('test-token').subscribe();
    facade.transition('submitted').subscribe();
    expect(facade.isTerminal()).toBe(true);
    expect(facade.updateAnswer('question-a', 'a')).toBe(false);
    expect(facade.toggleReview('question-a')).toBe(false);
    expect(facade.canSubmit()).toBe(false);
    expect(facade.submit(true).subscribe).toBeTypeOf('function');
  });

  it('requires explicit finish confirmation and supports cancel, Escape, and confirm', async () => {
    const fixture = await create();
    const component = fixture.componentInstance;
    const trigger = fixture.nativeElement.querySelector('.finish-button') as HTMLButtonElement;
    component.openFinishConfirmation();
    fixture.detectChanges();
    await fixture.whenRenderingDone();
    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).not.toBeNull();
    expect(document.activeElement).toBe(dialog);
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    await fixture.whenRenderingDone();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    component.openFinishConfirmation();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.dialog-actions .secondary-action') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(component.finishConfirmationOpen()).toBe(false);
    component.openFinishConfirmation();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.dialog-actions .primary-action') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenRenderingDone();
    expect(component.finishConfirmationOpen()).toBe(false);
    expect(component.facade.session()?.state).toBe('submitted');
  });

  it('renders an autosave error live indicator, exposes Retry, and reports Saved after recovery', async () => {
    vi.useFakeTimers();
    let fixture: ComponentFixture<ExamSessionComponent> | undefined;
    const repository = createControlledRepository();
    routeParam.mockReturnValue('test-token');
    try {
      const facade = new ExamSessionFacade(repository, questionSource, () => 10);
      TestBed.overrideProvider(ExamSessionFacade, { useValue: facade });
      fixture = TestBed.createComponent(ExamSessionComponent);
      fixture.detectChanges();

      repository.setMockScenario({ outcome: 'service-error', latencyMs: 20, retryLimit: 0 });
      fixture.componentInstance.facade.updateAnswer('question-a', 'component retry');
      fixture.detectChanges();
      await vi.advanceTimersByTimeAsync(300);
      fixture.detectChanges();
      await vi.advanceTimersByTimeAsync(20);
      fixture.detectChanges();

      const indicator = fixture.nativeElement.querySelector('.autosave-indicator') as HTMLElement;
      expect(indicator.getAttribute('aria-live')).toBe('polite');
      expect(indicator.textContent).toContain('Error:');
      const retryButton = fixture.nativeElement.querySelector('button[aria-label="Retry autosave"]') as HTMLButtonElement;
      expect(retryButton).not.toBeNull();
      expect(retryButton.disabled).toBe(false);
      expect(retryButton.tabIndex).toBeGreaterThanOrEqual(0);
      retryButton.focus();
      expect(document.activeElement).toBe(retryButton);

      repository.setMockScenario({ outcome: 'success', latencyMs: 20 });
      retryButton.click();
      fixture.detectChanges();
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(20);
      fixture.detectChanges();

      expect(indicator.textContent).toContain('Saved');
    } finally {
      fixture?.destroy();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('keeps the canonical student-only lazy route guarded', async () => {
    const route = adaptiveLearningRoutes.find((candidate) => candidate.path === 'exam-session/:token');
    expect(route?.canMatch).toContain(authGuard);
    expect(route?.data?.[ROUTE_CAPABILITIES_DATA_KEY]).toEqual([ROUTE_CAPABILITIES.studentLearning]);
    expect(route?.loadComponent).toBeTypeOf('function');
    expect(await route?.loadComponent?.()).toBe(ExamSessionComponent);
  });
});
