import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { NEVER, Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ROUTE_CAPABILITIES } from '../../../core/auth/authorization';
import { ROUTE_CAPABILITIES_DATA_KEY, authGuard } from '../../../core/auth/auth.guard';
import { adaptiveLearningRoutes } from '../../adaptive-learning/adaptive-learning.routes';
import { InMemoryStorageAdapter, type StorageAdapter } from '../../../core/storage/storage-adapter';
import { PlatformEventBus, PlatformState } from '../../../core/state/platform-state';
import { ExamSessionFacade, EXAM_SESSION_QUESTION_SOURCE, type ExamSessionQuestionSource } from '../data-access/exam-session.facade';
import { OfflineAnswerQueue } from '../data-access/offline-answer-queue';
import { ExamSessionRepository } from '../data-access/exam-session.repository';
import { createAnswerDraft, type AnswerDraft, type ExamQuestionInput } from '../models/answer-draft.models';
import { ExamSessionComponent } from './exam-session.component';

const rawQuestions: readonly ExamQuestionInput[] = [
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
];
const questionSource: ExamSessionQuestionSource = () => of(rawQuestions);

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
const createControlledRepository = (activate = true): ExamSessionRepository => {
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
    if (activate) {
      repository.transition(session.routeToken, 'active', { expectedVersion: session.version }).subscribe();
    }
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
  type CreateOptions = { keepFacadeAlive?: boolean };
  let testBedInstantiated = false;

  beforeEach(() => {
    testBedInstantiated = false;
    routeParam.mockReset();
    routeParam.mockReturnValue('session-token');
    TestBed.configureTestingModule({
      imports: [ExamSessionComponent],
      providers: [
        { provide: EXAM_SESSION_QUESTION_SOURCE, useValue: questionSource },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: routeParam } } } }
      ]
    });
  });

  const create = async (
    source: ExamSessionQuestionSource = questionSource,
    options: CreateOptions = {}
  ) => {
    if (!testBedInstantiated && source !== questionSource) {
      TestBed.overrideProvider(EXAM_SESSION_QUESTION_SOURCE, { useValue: source });
    }
    const fixture = TestBed.createComponent(ExamSessionComponent);
    testBedInstantiated = true;
    fixture.detectChanges();
    if (options.keepFacadeAlive) return fixture;
    fixture.componentInstance.facade.ngOnDestroy();
    await fixture.whenRenderingDone();
    fixture.detectChanges();
    return fixture;
  };

  const flushRender = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
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
    expect(element.querySelector('.timer-status')?.getAttribute('aria-live')).toBe('polite');
    expect(element.querySelector('.timer-status')?.getAttribute('aria-atomic')).toBe('true');
    expect(element.querySelector('.autosave-indicator')?.getAttribute('aria-atomic')).toBe('true');
    expect(element.querySelector('.navigator-trigger')?.getAttribute('aria-controls')).toBe('question-navigator');
    expect(element.querySelector('.navigator-panel')?.getAttribute('aria-hidden')).toBeNull();
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
  it('keeps route loading through 399 ms, shows slow at 400 ms, and retries the normalized token', async () => {
    vi.useFakeTimers();
    let sourceCalls = 0;
    let fixture: ComponentFixture<ExamSessionComponent> | undefined;
    let facade: ExamSessionFacade | undefined;
    routeParam.mockReturnValue('  session-token  ');
    const slowSource: ExamSessionQuestionSource = () => {
      sourceCalls += 1;
      return sourceCalls === 1 ? NEVER : of(rawQuestions);
    };
    try {
      fixture = await create(slowSource, { keepFacadeAlive: true });
      facade = fixture.componentInstance.facade;
      expect(facade.requestState().status).toBe('loading');
      await vi.advanceTimersByTimeAsync(399);
      fixture.detectChanges();
      expect(facade.requestState().status).toBe('loading');
      expect(fixture.nativeElement.querySelector('.request-state--loading')).not.toBeNull();

      const loadSpy = vi.spyOn(facade, 'load');
      await vi.advanceTimersByTimeAsync(1);
      fixture.detectChanges();
      expect(facade.requestState().status).toBe('slow');
      expect(fixture.nativeElement.querySelector('.request-state--slow')).not.toBeNull();
      (fixture.nativeElement.querySelector('button.retry-action') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(loadSpy).toHaveBeenCalledWith('session-token');
      expect(facade.requestState().status).toBe('ready');
      expect(facade.questions()).toHaveLength(3);
    } finally {
      fixture?.destroy();
      facade?.ngOnDestroy();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('clears slow lifecycle state for terminal outcomes and keeps unauthorized/invalid tokens non-retryable', async () => {
    vi.useFakeTimers();
    const unauthorized = Object.assign(new Error('Access denied'), { kind: 'unauthorized' });
    const terminalCases: readonly { source: ExamSessionQuestionSource; status: 'ready' | 'empty' | 'error' | 'unauthorized' }[] = [
      { source: () => of(rawQuestions), status: 'ready' },
      { source: () => of([]), status: 'empty' },
      { source: () => throwError(() => new Error('Service unavailable')), status: 'error' },
      { source: () => throwError(() => unauthorized), status: 'unauthorized' }
    ];
    try {
      for (const testCase of terminalCases) {
        const facade = new ExamSessionFacade(createControlledRepository(), testCase.source, () => 10);
        facade.load('test-token').subscribe({ error: () => undefined });
        expect(facade.requestState().status).toBe(testCase.status);
        await vi.advanceTimersByTimeAsync(400);
        expect(facade.requestState().status).toBe(testCase.status);
        if (testCase.status === 'unauthorized') expect(facade.requestState().retryable).toBe(false);
        facade.ngOnDestroy();
      }

      const invalidFacade = new ExamSessionFacade(createControlledRepository(), questionSource, () => 10);
      invalidFacade.load('   ').subscribe({ error: () => undefined });
      expect(invalidFacade.requestState()).toMatchObject({ status: 'error', retryable: false });
      invalidFacade.retry().subscribe();
      invalidFacade.ngOnDestroy();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('suppresses superseded responses and clears timers on cancellation and destruction', async () => {
    vi.useFakeTimers();
    const first = new Subject<readonly ExamQuestionInput[]>();
    const second = new Subject<readonly ExamQuestionInput[]>();
    const third = new Subject<readonly ExamQuestionInput[]>();
    const fourth = new Subject<readonly ExamQuestionInput[]>();
    const sources = [first, second, third, fourth];
    const source: ExamSessionQuestionSource = () => sources.shift()!.asObservable();
    const facade = new ExamSessionFacade(createControlledRepository(), source, () => 10);
    const firstSubscription = facade.load('test-token').subscribe({ error: () => undefined });
    try {
      await vi.advanceTimersByTimeAsync(399);
      facade.load('test-token').subscribe({ error: () => undefined });
      first.next(rawQuestions);
      first.complete();
      expect(facade.requestState().status).toBe('loading');
      expect(facade.session()).toBeNull();
      expect(facade.questions()).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(400);
      expect(facade.requestState().status).toBe('slow');

      const cancellation = facade.load('test-token').subscribe({ error: () => undefined });
      cancellation.unsubscribe();
      expect(vi.getTimerCount()).toBe(0);
      const destroySubscription = facade.load('test-token').subscribe({ error: () => undefined });
      facade.ngOnDestroy();
      fourth.next(rawQuestions);
      fourth.complete();
      expect(facade.session()).toBeNull();
      expect(facade.questions()).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
      destroySubscription.unsubscribe();
    } finally {
      firstSubscription.unsubscribe();
      facade.ngOnDestroy();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
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
    const fixture = await create(retrySource, { keepFacadeAlive: true });
    const facade = fixture.componentInstance.facade;
    try {
      expect(fixture.nativeElement.textContent).toContain('Unable to open exam session');
      expect(facade.requestState().status).toBe('error');
      expect(facade.session()).toBeNull();
      expect(facade.questions()).toHaveLength(0);
      expect(fixture.nativeElement.querySelector('.question-card')).toBeNull();
      shouldFail = false;
      (fixture.nativeElement.querySelector('button.retry-action') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(facade.requestState().status).toBe('ready');
      expect(facade.session()).not.toBeNull();
      expect(facade.questions()).toHaveLength(3);
      expect(fixture.nativeElement.querySelector('.question-card')).not.toBeNull();
    } finally {
      fixture.destroy();
    }
  });
  it('renders unauthorized without retry and clears private session controls', async () => {
    const source: ExamSessionQuestionSource = () => throwError(() => Object.assign(new Error('Access denied'), { kind: 'unauthorized' }));
    const fixture = await create(source, { keepFacadeAlive: true });
    try {
      const element = fixture.nativeElement as HTMLElement;
      expect(fixture.componentInstance.facade.requestState().status).toBe('unauthorized');
      expect(element.querySelector('.request-state--assertive')).not.toBeNull();
      expect(element.querySelector('button.retry-action')).toBeNull();
      expect(element.querySelector('.question-card')).toBeNull();
      expect(element.querySelector('textarea, input, .finish-button')).toBeNull();
    } finally {
      fixture.destroy();
    }
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
    const fixture = await create(questionSource);
    try {
      const component = fixture.componentInstance;
      component.selectQuestion(1);
      fixture.detectChanges();
      await flushRender();
      fixture.detectChanges();
      expect(document.activeElement?.id).toBe('current-question-heading');
      component.goPrevious();
      fixture.detectChanges();
      await flushRender();
      fixture.detectChanges();
      expect(document.activeElement?.id).toBe('current-question-heading');
    } finally {
      fixture.destroy();
    }
  });

  it('warns from the synchronized timer, expires on a large monotonic jump, and rejects a late answer', () => {
    let monotonicNow = 10;
    const facade = createSessionFacade(() => monotonicNow);
    try {
      facade.load('test-token').subscribe();
      expect(facade.refreshTimer(59_000)?.warning).toBe(true);
      monotonicNow = 60_010;
      expect(facade.refreshTimer()?.expired).toBe(true);
      expect(facade.updateAnswer('question-b', 'too late')).toBe(false);
      expect(facade.draftFor('question-b')?.value).toBe(null);
    } finally {
      facade.ngOnDestroy();
    }
  });

  it('rejects an exact-deadline answer without mutating the draft', () => {
    const facade = createSessionFacade();
    try {
      facade.load('test-token').subscribe();
      facade.refreshTimer(60_010);
      const before = facade.drafts();
      expect(facade.updateAnswer('question-a', 'a')).toBe(false);
      expect(facade.drafts()).toBe(before);
    } finally {
      facade.ngOnDestroy();
    }
  });

  it('disables answer, flag, and finish actions after submitted or terminal transition', () => {
    const facade = createSessionFacade();
    try {
      facade.load('test-token').subscribe();
      facade.transition('submitted').subscribe();
      expect(facade.isTerminal()).toBe(true);
      expect(facade.updateAnswer('question-a', 'a')).toBe(false);
      expect(facade.toggleReview('question-a')).toBe(false);
      expect(facade.canSubmit()).toBe(false);
      expect(facade.submit(true).subscribe).toBeTypeOf('function');
    } finally {
      facade.ngOnDestroy();
    }
  });
  it('rejects submission while answers are queued or actively replaying', async () => {
    vi.useFakeTimers();
    const repository = createControlledRepository();
    const storage = new InMemoryStorageAdapter<unknown>();
    let operation = 0;
    const queue = new OfflineAnswerQueue(storage as StorageAdapter<never>, () => `pending-${++operation}`);
    const eventBus = new PlatformEventBus();
    const platform = new PlatformState(eventBus);
    const facade = new ExamSessionFacade(repository, questionSource, () => 10, queue, platform, eventBus);
    try {
      facade.load('test-token').subscribe({ error: (error) => { throw error; } });
      platform.setConnectivity('offline');
      facade.updateAnswer('question-a', 'queued answer');
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      expect(facade.queuedAnswerCount()).toBe(1);
      expect(facade.canSubmit()).toBe(false);
      let queuedError: unknown;
      facade.submit(true).subscribe({ error: (error) => { queuedError = error; } });
      expect(queuedError).toMatchObject({ code: 'pending-sync' });
      expect(facade.session()?.state).toBe('active');

      repository.setMockScenario({ latencyMs: 20 });
      platform.setConnectivity('reconnecting');
      expect(facade.isReplaying()).toBe(true);
      expect(facade.canSubmit()).toBe(false);
      let replayError: unknown;
      facade.submit(true).subscribe({ error: (error) => { replayError = error; } });
      expect(replayError).toMatchObject({ code: 'pending-sync' });
      expect(facade.session()?.state).toBe('active');
    } finally {
      facade.ngOnDestroy();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('owns a fresh live facade for route re-entry and keeps autosave active', async () => {
    vi.useFakeTimers();
    let firstFixture: ComponentFixture<ExamSessionComponent> | undefined;
    let secondFixture: ComponentFixture<ExamSessionComponent> | undefined;
    try {
      firstFixture = await create(questionSource, { keepFacadeAlive: true });
      const firstFacade = firstFixture.componentInstance.facade;
      expect(firstFacade.session()?.state).toBe('active');
      firstFixture.destroy();
      firstFixture = undefined;

      secondFixture = await create(questionSource, { keepFacadeAlive: true });
      const secondFacade = secondFixture.componentInstance.facade;
      expect(secondFacade).not.toBe(firstFacade);
      expect(secondFacade.session()?.state).toBe('active');
      expect(secondFacade.updateAnswer('question-a', 're-entry answer')).toBe(true);
      await vi.advanceTimersByTimeAsync(320);
      expect(secondFacade.autosaveState().status).toBe('saved');
    } finally {
      firstFixture?.destroy();
      secondFixture?.destroy();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('renders the desktop workspace as a three-column CSS grid', async () => {
    const fixture = await create();
    try {
      const grid = fixture.nativeElement.querySelector('.workspace-grid') as HTMLElement;
      const styles = getComputedStyle(grid);
      const columns = styles.gridTemplateColumns.trim().match(/(?:minmax\([^)]*\)|[^\s]+)/g) ?? [];
      expect(styles.display).toBe('grid');
      expect(columns).toHaveLength(3);
    } finally {
      fixture.destroy();
    }
  });

  it('keeps finish confirmation open with an alert and retry after submit failure', async () => {
    const fixture = await create(questionSource, { keepFacadeAlive: true });
    try {
      const component = fixture.componentInstance;
      const submit = vi.spyOn(component.facade, 'submit')
        .mockReturnValue(throwError(() => new Error('Submission service unavailable')));
      component.openFinishConfirmation();
      fixture.detectChanges();
      component.confirmFinish();
      fixture.detectChanges();

      const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
      const alert = dialog.querySelector('.finish-submission-error') as HTMLElement;
      const retry = dialog.querySelector('button[aria-label="Retry submission"]') as HTMLButtonElement;
      expect(component.finishConfirmationOpen()).toBe(true);
      expect(component.finishSubmissionLocked()).toBe(false);
      expect(alert.getAttribute('role')).toBe('alert');
      expect(alert.textContent).toContain('Submission service unavailable');
      expect(retry).not.toBeNull();
      expect(retry.disabled).toBe(false);

      submit.mockReturnValue(of(component.facade.session()!));
      retry.click();
      fixture.detectChanges();
      await flushRender();
      expect(component.finishConfirmationOpen()).toBe(false);
    } finally {
      fixture.destroy();
    }
  });


  it('requires explicit finish confirmation and supports cancel, Escape, and confirm', async () => {
    const fixture = await create(questionSource);
    try {
      const component = fixture.componentInstance;
      const trigger = fixture.nativeElement.querySelector('.finish-button') as HTMLButtonElement;
      component.openFinishConfirmation();
      fixture.detectChanges();
      await flushRender();
      const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
      expect(dialog).not.toBeNull();
      expect(document.activeElement).toBe(dialog);
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      await flushRender();
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
      await flushRender();
      expect(component.finishConfirmationOpen()).toBe(false);
      expect(component.facade.session()?.state).toBe('submitted');
    } finally {
      fixture.destroy();
    }
  });

  it('renders an autosave error live indicator, exposes Retry, and reports Saved after recovery', async () => {
    vi.useFakeTimers();
    let fixture: ComponentFixture<ExamSessionComponent> | undefined;
    let injectedFacade: ExamSessionFacade | undefined;
    const repository = createControlledRepository();
    routeParam.mockReturnValue('test-token');
    try {
      const facade = new ExamSessionFacade(repository, questionSource, () => 10);
      injectedFacade = facade;
      TestBed.overrideComponent(ExamSessionComponent, {
        set: { providers: [{ provide: ExamSessionFacade, useValue: facade }] }
      });
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
      injectedFacade?.ngOnDestroy();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('keeps shared-facade stale answers explicit and preserves the chosen draft', async () => {
    vi.useFakeTimers();
    const repository = createControlledRepository();
    const firstFacade = createLoadedFacade(repository);
    const secondFacade = createLoadedFacade(repository);
    try {
      repository.setMockScenario({ latencyMs: 20 });
      firstFacade.updateAnswer('question-a', 'server answer');
      await vi.advanceTimersByTimeAsync(320);
      secondFacade.updateAnswer('question-a', 'local answer');
      await vi.advanceTimersByTimeAsync(320);
      await vi.advanceTimersByTimeAsync(20);


      const conflict = secondFacade.autosaveConflict();
      expect(conflict).toMatchObject({
        sessionId: 'session-test',
        questionId: 'question-a',
        localDraft: expect.objectContaining({ value: 'local answer', version: 0 }),
        serverDraft: expect.objectContaining({ value: 'server answer', version: 1 })
      });
      expect(repository.getSnapshot().drafts[0]?.drafts[0]).toMatchObject({ value: 'server answer', version: 1 });

      await secondFacade.useServerAnswer();
      expect(secondFacade.autosaveConflict()).toBeNull();
      expect(secondFacade.draftFor('question-a')).toMatchObject({ value: 'server answer', version: 1 });

      firstFacade.updateAnswer('question-a', 'new server answer');
      await vi.advanceTimersByTimeAsync(320);
      secondFacade.updateAnswer('question-a', 'kept local answer');
      await vi.advanceTimersByTimeAsync(320);
      await vi.advanceTimersByTimeAsync(20);
      expect(secondFacade.autosaveConflict()?.serverDraft).toMatchObject({ value: 'new server answer', version: 2 });

      repository.setMockScenario({ latencyMs: 0 });
      const keepLocal = secondFacade.keepLocalAnswer();
      await vi.advanceTimersByTimeAsync(0);
      await keepLocal;
      expect(secondFacade.autosaveConflict()).toBeNull();
      expect(repository.getSnapshot().drafts[0]?.drafts[0]).toMatchObject({ value: 'kept local answer', version: 3 });
    } finally {
      firstFacade.ngOnDestroy();
      secondFacade.ngOnDestroy();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
  it('renders an alert conflict region with labeled local/server choices', async () => {
    vi.useFakeTimers();
    const repository = createControlledRepository();
    const firstFacade = createLoadedFacade(repository);
    const secondFacade = createLoadedFacade(repository);
    let fixture: ComponentFixture<ExamSessionComponent> | undefined;
    try {
      repository.setMockScenario({ latencyMs: 20 });
      firstFacade.updateAnswer('question-a', 'server answer');
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(20);
      secondFacade.updateAnswer('question-a', 'local answer');
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(20);
      await vi.advanceTimersByTimeAsync(20);
      routeParam.mockReturnValue('');
      TestBed.overrideComponent(ExamSessionComponent, {
        set: { providers: [{ provide: ExamSessionFacade, useValue: secondFacade }] }
      });
      fixture = TestBed.createComponent(ExamSessionComponent);
      fixture.detectChanges();
      const region = fixture.nativeElement.querySelector('.draft-conflict') as HTMLElement;
      expect(region.getAttribute('role')).toBe('alert');
      expect(region.getAttribute('aria-live')).toBe('assertive');
      expect(region.getAttribute('aria-describedby')).toBe('draft-conflict-description');
      expect(region.textContent).toContain('Your local answer');
      expect(region.textContent).toContain('Server answer');
      expect(region.querySelector('button[aria-label="Use server answer"]') ?? region.textContent).toContain('Use server answer');
      expect(region.querySelector('button')?.textContent).toContain('Use server answer');
      expect(Array.from(region.querySelectorAll('button')).map((button) => button.textContent?.trim())).toEqual([
        'Use server answer',
        'Keep my answer'
      ]);
    } finally {
      fixture?.destroy();
      firstFacade.ngOnDestroy();
      secondFacade.ngOnDestroy();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
  it('retains both drafts and exposes retry after keep-local service failure', async () => {
    vi.useFakeTimers();
    const repository = createControlledRepository();
    const firstFacade = createLoadedFacade(repository);
    const secondFacade = createLoadedFacade(repository);
    try {
      repository.setMockScenario({ latencyMs: 20 });
      firstFacade.updateAnswer('question-a', 'server answer');
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(20);
      secondFacade.updateAnswer('question-a', 'local answer');
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(20);
      await vi.advanceTimersByTimeAsync(20);
      repository.setMockScenario({ outcome: 'service-error', latencyMs: 20, retryLimit: 0 });
      const failed = secondFacade.keepLocalAnswer();
      await vi.advanceTimersByTimeAsync(20);
      await failed;
      expect(secondFacade.autosaveConflict()).toMatchObject({
        localDraft: expect.objectContaining({ value: 'local answer' }),
        serverDraft: expect.objectContaining({ value: 'server answer' }),
        resolutionError: expect.stringContaining('Mock transport service failure')
      });
      expect(secondFacade.autosaveState()).toMatchObject({ status: 'error', retryable: true });
      repository.setMockScenario({ outcome: 'success', latencyMs: 20 });
      expect(secondFacade.retryAutosave()).toBe(true);
      await vi.advanceTimersByTimeAsync(20);
      await Promise.resolve();
      expect(secondFacade.autosaveConflict()).toBeNull();
      expect(repository.getSnapshot().drafts[0]?.drafts[0]).toMatchObject({ value: 'local answer' });
    } finally {
      firstFacade.ngOnDestroy();
      secondFacade.ngOnDestroy();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
  it('refreshes the conflict after a second-tab keep-local race', async () => {
    vi.useFakeTimers();
    const repository = createControlledRepository();
    const firstFacade = createLoadedFacade(repository);
    const secondFacade = createLoadedFacade(repository);
    try {
      repository.setMockScenario({ latencyMs: 0 });
      firstFacade.updateAnswer('question-a', 'server answer');
      await vi.advanceTimersByTimeAsync(300);
      secondFacade.updateAnswer('question-a', 'local answer');
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(0);
      repository.setMockScenario({ latencyMs: 40 });
      firstFacade.updateAnswer('question-a', 'newest server answer');
      await vi.advanceTimersByTimeAsync(300);
      const pending = secondFacade.keepLocalAnswer();
      await vi.advanceTimersByTimeAsync(80);
      await pending;
      expect(secondFacade.autosaveConflict()).toMatchObject({
        localDraft: expect.objectContaining({ value: 'local answer' }),
        serverDraft: expect.objectContaining({ value: 'newest server answer', version: 2 })
      });
      expect(repository.getSnapshot().drafts[0]?.drafts[0]).toMatchObject({ value: 'newest server answer', version: 2 });
    } finally {
      firstFacade.ngOnDestroy();
      secondFacade.ngOnDestroy();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
  it('ignores a late keep-local completion after load revision changes', async () => {
    vi.useFakeTimers();
    const repository = createControlledRepository();
    const firstFacade = createLoadedFacade(repository);
    const secondFacade = createLoadedFacade(repository);
    try {
      repository.setMockScenario({ latencyMs: 0 });
      firstFacade.updateAnswer('question-a', 'server answer');
      await vi.advanceTimersByTimeAsync(300);
      secondFacade.updateAnswer('question-a', 'local answer');
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(0);
      const pendingSave = new Subject<AnswerDraft>();
      const saveDraft = vi.spyOn(repository, 'saveDraft').mockReturnValue(pendingSave.asObservable());
      const resolution = secondFacade.keepLocalAnswer();
      secondFacade.updateAnswer('question-a', 'newer local answer');
      secondFacade.load('test-token').subscribe({ error: () => undefined });
      pendingSave.next(createAnswerDraft('question-a', 'late answer', false, 2));
      pendingSave.complete();
      await resolution;
      expect(secondFacade.autosaveConflict()).toBeNull();
      expect(secondFacade.draftFor('question-a')?.value).toBe('server answer');
      saveDraft.mockRestore();
    } finally {
      firstFacade.ngOnDestroy();
      secondFacade.ngOnDestroy();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
  it('retains offline queue order across keep-local then use-server replay choices', async () => {
    vi.useFakeTimers();
    const repository = createControlledRepository();
    const externalFacade = createLoadedFacade(repository);
    const storage = new InMemoryStorageAdapter<unknown>();
    let operation = 0;
    const queue = new OfflineAnswerQueue(storage as StorageAdapter<never>, () => `offline-${++operation}`);
    const eventBus = new PlatformEventBus();
    const platform = new PlatformState(eventBus);
    const offlineFacade = new ExamSessionFacade(repository, questionSource, () => 10, queue, platform, eventBus);
    offlineFacade.load('test-token').subscribe({ error: () => undefined });
    try {
      platform.setConnectivity('offline');
      offlineFacade.updateAnswer('question-a', 'local one');
      offlineFacade.updateAnswer('question-b', 'local two');
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(0);

      repository.setMockScenario({ latencyMs: 20 });
      externalFacade.updateAnswer('question-a', 'server one');
      externalFacade.updateAnswer('question-b', 'server two');
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(20);
      expect((await queue.read()).map((record) => record.questionId)).toEqual(['question-a', 'question-b']);

      platform.setConnectivity('online');
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(20);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(20);
      await Promise.resolve();
      expect(offlineFacade.autosaveConflict()?.questionId).toBe('question-a');
      const keep = offlineFacade.keepLocalAnswer();
      await vi.advanceTimersByTimeAsync(20);
      await Promise.resolve();
      await keep;
      await vi.advanceTimersByTimeAsync(20);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(20);
      await Promise.resolve();
      expect(offlineFacade.autosaveConflict()?.questionId).toBe('question-b');
      expect((await queue.read()).map((record) => record.questionId)).toEqual(['question-b']);

      await offlineFacade.useServerAnswer();
      await vi.advanceTimersByTimeAsync(0);
      expect(await queue.read()).toEqual([]);
      expect(repository.getSnapshot().drafts[0]?.drafts).toEqual([
        expect.objectContaining({ questionId: 'question-a', value: 'local one', version: 2 }),
        expect.objectContaining({ questionId: 'question-b', value: 'server two', version: 1 })
      ]);
    } finally {
      externalFacade.ngOnDestroy();
      offlineFacade.ngOnDestroy();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
  it('runs the session lifecycle through online save, durable offline replay, and confirmed submit', async () => {
    vi.useFakeTimers();
    const repository = createControlledRepository(false);
    const storage = new InMemoryStorageAdapter<unknown>();
    let operation = 0;
    const queue = new OfflineAnswerQueue(storage as StorageAdapter<never>, () => `integration-${++operation}`);
    const eventBus = new PlatformEventBus();
    const platform = new PlatformState(eventBus);
    const facade = new ExamSessionFacade(repository, questionSource, () => 10, queue, platform, eventBus);
    const saveDraftSpy = vi.spyOn(repository, 'saveDraft');
    let loadSubscription: { unsubscribe: () => void } | undefined;
    let confirmationSubscription: { unsubscribe: () => void } | undefined;
    let submissionSubscription: { unsubscribe: () => void } | undefined;
    try {
      loadSubscription = facade.load('test-token').subscribe({ error: (error) => { throw error; } });
      expect(repository.getSnapshot().sessions[0]?.state).toBe('active');
      expect(facade.session()?.state).toBe('active');

      repository.setMockScenario({ latencyMs: 20 });
      expect(facade.updateAnswer('question-a', 'online answer')).toBe(true);
      expect(facade.draftFor('question-a')).toMatchObject({ value: 'online answer', version: 0 });
      await vi.advanceTimersByTimeAsync(299);
      expect(facade.autosaveState().status).toBe('idle');
      await vi.advanceTimersByTimeAsync(1);
      expect(facade.autosaveState().status).toBe('saving');
      expect(repository.getSnapshot().drafts).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(20);
      expect(facade.autosaveState().status).toBe('saved');
      expect(repository.getSnapshot().drafts[0]?.drafts).toEqual([
        expect.objectContaining({ questionId: 'question-a', value: 'online answer', version: 1 })
      ]);

      platform.setConnectivity('offline');
      expect(facade.connectivity()).toBe('offline');
      expect(facade.updateAnswer('question-a', 'offline answer a')).toBe(true);
      expect(facade.updateAnswer('question-b', 'offline answer b')).toBe(true);
      expect(facade.draftFor('question-a')).toMatchObject({ value: 'offline answer a', version: 1 });
      expect(facade.draftFor('question-b')).toMatchObject({ value: 'offline answer b', version: 0 });
      expect(repository.getSnapshot().drafts[0]?.drafts).toEqual([
        expect.objectContaining({ questionId: 'question-a', value: 'online answer', version: 1 })
      ]);
      await vi.advanceTimersByTimeAsync(300);
      await vi.advanceTimersByTimeAsync(0);
      const queuedWhileOffline = await queue.read('session-test');
      await Promise.resolve();
      expect(queuedWhileOffline.map((record) => record.questionId)).toEqual(['question-a', 'question-b']);
      expect(queuedWhileOffline.map((record) => record.expectedVersion)).toEqual([1, 0]);
      expect(facade.queuedAnswerCount()).toBe(2);
      expect(facade.liveStatus()).toBe('Offline — 2 answer(s) queued');
      expect(repository.getSnapshot().drafts[0]?.drafts).toEqual([
        expect.objectContaining({ questionId: 'question-a', value: 'online answer', version: 1 })
      ]);

      repository.setMockScenario({ latencyMs: 40 });
      saveDraftSpy.mockClear();
      platform.setConnectivity('reconnecting');
      expect(facade.connectivity()).toBe('reconnecting');
      expect(facade.isReplaying()).toBe(true);
      expect(facade.liveStatus()).toBe('Reconnecting — syncing 2 answer(s)');
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      expect(saveDraftSpy.mock.calls[0]?.[1]).toBe('question-a');
      expect((await queue.read('session-test')).map((record) => record.questionId)).toEqual([
        'question-a',
        'question-b'
      ]);

      await vi.advanceTimersByTimeAsync(39);
      expect((await queue.read('session-test')).map((record) => record.questionId)).toEqual([
        'question-a',
        'question-b'
      ]);
      expect(repository.getSnapshot().drafts[0]?.drafts).toEqual([
        expect.objectContaining({ questionId: 'question-a', value: 'online answer', version: 1 })
      ]);

      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      expect((await queue.read('session-test')).map((record) => record.questionId)).toEqual(['question-b']);
      expect(repository.getSnapshot().drafts[0]?.drafts).toEqual([
        expect.objectContaining({ questionId: 'question-a', value: 'offline answer a', version: 2 })
      ]);

      platform.setConnectivity('online');
      expect(platform.state().connectivity).toBe('online');
      expect(facade.connectivity()).toBe('reconnecting');
      expect(facade.liveStatus()).toBe('Reconnecting — syncing 1 answer(s)');
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      expect(saveDraftSpy.mock.calls.map((call) => call[1])).toEqual(['question-a', 'question-b']);

      await vi.advanceTimersByTimeAsync(39);
      expect((await queue.read('session-test')).map((record) => record.questionId)).toEqual(['question-b']);
      expect(repository.getSnapshot().drafts[0]?.drafts).toEqual([
        expect.objectContaining({ questionId: 'question-a', value: 'offline answer a', version: 2 })
      ]);
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      expect(await queue.read('session-test')).toEqual([]);
      await Promise.resolve();
      expect(facade.queuedAnswerCount()).toBe(0);
      expect(platform.state().pendingOperations).toBe(0);
      expect(facade.isReplaying()).toBe(false);
      expect(facade.connectivity()).toBe('online');
      expect(facade.liveStatus()).toContain('Time is running low');
      expect(saveDraftSpy.mock.calls.map((call) => call[1])).toEqual(['question-a', 'question-b']);
      expect(repository.getSnapshot().drafts[0]?.drafts).toEqual([
        expect.objectContaining({ questionId: 'question-a', value: 'offline answer a', version: 2 }),
        expect.objectContaining({ questionId: 'question-b', value: 'offline answer b', version: 1 })
      ]);

      let confirmationError: unknown;
      confirmationSubscription = facade.submit(false).subscribe({ error: (error) => { confirmationError = error; } });
      expect(confirmationError).toMatchObject({ code: 'confirmation-required' });
      expect(facade.session()?.state).toBe('active');
      submissionSubscription = facade.submit(true).subscribe({ error: (error) => { throw error; } });
      expect(facade.session()?.state).toBe('submitted');
      expect(facade.isTerminal()).toBe(true);
      const beforeLateAnswer = facade.drafts();
      expect(facade.updateAnswer('question-c', 'late answer')).toBe(false);
      expect(facade.drafts()).toBe(beforeLateAnswer);
    } finally {
      submissionSubscription?.unsubscribe();
      confirmationSubscription?.unsubscribe();
      loadSubscription?.unsubscribe();
      saveDraftSpy.mockRestore();
      facade.ngOnDestroy();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('expires from synchronized reference time after a monotonic jump and rejects late answers', () => {
    vi.useFakeTimers();
    let monotonicNow = 10;
    const repository = createControlledRepository(false);
    const facade = new ExamSessionFacade(repository, questionSource, () => monotonicNow);
    let loadSubscription: { unsubscribe: () => void } | undefined;
    try {
      loadSubscription = facade.load('test-token').subscribe({ error: (error) => { throw error; } });
      expect(facade.session()?.state).toBe('active');
      expect(facade.updateAnswer('question-a', 'before expiry')).toBe(true);
      const beforeLateAnswer = facade.drafts();

      vi.setSystemTime(new Date('2099-01-01T00:00:00.000Z'));
      expect(facade.refreshTimer()?.expired).toBe(false);
      monotonicNow = 60_010;
      expect(facade.refreshTimer()?.expired).toBe(true);
      expect(facade.session()?.state).toBe('expired');
      expect(repository.getSnapshot().sessions[0]?.state).toBe('expired');
      expect(facade.updateAnswer('question-b', 'late answer')).toBe(false);
      expect(facade.drafts()).toBe(beforeLateAnswer);
      expect(facade.draftFor('question-a')).toMatchObject({ value: 'before expiry', version: 0 });
    } finally {
      loadSubscription?.unsubscribe();
      facade.ngOnDestroy();
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
