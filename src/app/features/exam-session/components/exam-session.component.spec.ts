import { TestBed } from '@angular/core/testing';
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

  it('keeps the canonical student-only lazy route guarded', async () => {
    const route = adaptiveLearningRoutes.find((candidate) => candidate.path === 'exam-session/:token');
    expect(route?.canMatch).toContain(authGuard);
    expect(route?.data?.[ROUTE_CAPABILITIES_DATA_KEY]).toEqual([ROUTE_CAPABILITIES.studentLearning]);
    expect(route?.loadComponent).toBeTypeOf('function');
    expect(await route?.loadComponent?.()).toBe(ExamSessionComponent);
  });
});
