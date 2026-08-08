import { firstValueFrom, of, Subject, throwError, type Observable } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { createSeedData } from '../../adaptive-learning/data-access/seed-data.factory';
import { QuestionBankRepository } from '../../question-bank/data-access/question-bank.facade';
import { asCourseId, asLearningOutcomeId, asQuestionId, asQuestionVersionId, type Question, type QuestionVersion } from '../../question-bank/models/question.models';
import {
  createExamBlueprint,
  validateExamBlueprint,
  type ExamBlueprint,
  type ExamBlueprintCurrentCoverageInput
} from '../models/exam-blueprint.models';
import type { Exam } from '../models/exam.models';
import { ExamBuilderFacade } from './exam-builder.facade';
import { ExamRepository } from './exam.repository';

const matchingCoverageFor = (target: ExamBlueprint): ExamBlueprintCurrentCoverageInput => ({
  outcomeBuckets: target.outcomeBuckets.map(({ key, targetQuestionCount, targetPoints }) => ({
    key,
    currentQuestionCount: targetQuestionCount,
    currentPoints: targetPoints
  })),
  difficultyBuckets: target.difficultyBuckets.map(({ key, targetQuestionCount, targetPoints }) => ({
    key,
    currentQuestionCount: targetQuestionCount,
    currentPoints: targetPoints
  })),
  questionTypeBuckets: target.questionTypeBuckets.map(({ key, targetQuestionCount, targetPoints }) => ({
    key,
    currentQuestionCount: targetQuestionCount,
    currentPoints: targetPoints
  }))
});

const selectionSnapshot = (id = 'Q-1', version = 1, points = 2): QuestionVersion => {
  const questionId = asQuestionId(id);
  const outcomeId = asLearningOutcomeId('OUTCOME-MATH101-2025-FALL-01');
  const courseId = asCourseId('COURSE-MATH101-2025-FALL');
  return {
    id: questionId,
    questionId,
    version,
    versionId: asQuestionVersionId(`${id}-v${version}`),
    status: 'published',
    courseId,
    outcomeId,
    course: { id: courseId, code: 'MATH-101', title: 'Foundations of Data Literacy' },
    outcome: { id: outcomeId, code: 'OUTCOME-01', title: 'Identify foundational concepts' },
    title: `Question ${id}`,
    stem: 'Stem',
    explanation: '',
    tags: ['math'],
    difficulty: 'easy',
    points,
    grade: 'foundation',
    type: 'single-choice',
    options: [{ id: 'A', label: 'A' }],
    answer: { kind: 'choice', optionIds: ['A'] },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    publishedAt: '2026-01-01T00:00:00.000Z',
    changeNote: 'seed'
  };
};

const selectionTarget = (count = 1, points = count * 2): ExamBlueprint => {
  const target = createExamBlueprint({
    targetQuestionCount: count,
    targetPoints: points,
    outcomeBuckets: [{ key: 'OUTCOME-MATH101-2025-FALL-01', targetQuestionCount: count, targetPoints: points }],
    difficultyBuckets: [{ key: 'easy', targetQuestionCount: count, targetPoints: points }],
    questionTypeBuckets: [{ key: 'single-choice', targetQuestionCount: count, targetPoints: points }]
  });
  if (target === null) throw new Error('Expected a valid selection target.');
  return target;
};

const questionRowFor = (snapshot: QuestionVersion): Question => ({
  ...snapshot,
  status: 'published',
  id: snapshot.questionId
});

const questionRepositoryStub = (
  list$: Observable<unknown>,
  history: readonly QuestionVersion[]
): QuestionBankRepository => ({
  listQuestions: vi.fn(() => list$),
  getQuestionVersionHistory: vi.fn(() => of(history))
} as unknown as QuestionBankRepository);
const examFor = (facade: ExamBuilderFacade, id = 'EXAM-1', status: 'draft' | 'published' = 'draft'): Exam => ({
  id,
  versionId: `${id}-v1`,
  version: 1,
  status,
  title: `${id} title`,
  durationMinutes: 60,
  rules: [],
  blueprint: facade.target(),
  questionVersions: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  publishedAt: status === 'published' ? '2026-01-01T00:00:00.000Z' : null,
  publishedBy: status === 'published' ? 'account-1' : null,
  changeNote: ''
} as unknown as Exam);

const examRepositoryStub = (
  getCurrent$: Observable<Exam>,
  history$: Observable<readonly Exam[]> = of([])
): ExamRepository => ({
  getCurrent: vi.fn(() => getCurrent$),
  listVersionHistory: vi.fn(() => history$)
} as unknown as ExamRepository);


describe('ExamBuilderFacade', () => {
  it('derives canonical seed choices, an initial valid target, and truthful missing comparison', () => {
    const facade = new ExamBuilderFacade();
    const seed = createSeedData();
    const currentCourse = seed.courses.find((course) => course.status === 'active') ?? seed.courses[0];
    if (currentCourse === undefined) throw new Error('Expected a seeded course.');
    const outcomes = seed.learningOutcomes.filter((outcome) => outcome.courseId === currentCourse.id);
    const choices = facade.outcomeChoices();

    expect(choices).toEqual(outcomes.map(({ id, code, title }) => ({ id, code, title })));
    expect(Object.isFrozen(choices)).toBe(true);
    expect(choices.every((choice) => Object.isFrozen(choice))).toBe(true);
    expect(validateExamBlueprint(facade.target())).toEqual([]);
    expect(facade.target().outcomeBuckets.map(({ key }) => key)).toEqual(outcomes.slice(0, 3).map(({ id }) => id));
    expect(facade.target().targetQuestionCount).toBe(6);
    expect(facade.target().targetPoints).toBe(12);
    expect(facade.comparison().status).toBe('missing');
    expect(facade.comparison().summary).toBe('No current coverage is selected; all target buckets are missing.');
  });

  it('applies a valid blueprint and announces the updated comparison', () => {
    const facade = new ExamBuilderFacade();
    const before = facade.target();
    const revised = {
      ...before,
      outcomeBuckets: before.outcomeBuckets.map((bucket, index) => ({ ...bucket, targetPoints: index + 3 })),
      difficultyBuckets: before.difficultyBuckets.map((bucket, index) => ({ ...bucket, targetPoints: index + 3 }))
    };

    expect(facade.applyBlueprint(revised)).toBe(true);
    expect(facade.target()).not.toBe(before);
    expect(facade.target().outcomeBuckets.map(({ targetPoints }) => targetPoints)).toEqual([3, 4, 5]);
    expect(facade.target().difficultyBuckets.map(({ targetPoints }) => targetPoints)).toEqual([3, 4, 5]);
    expect(facade.liveUpdateText()).toBe('Blueprint updated. No current coverage is selected; all target buckets are missing.');
  });

  it('rejects an invalid blueprint without mutating target, comparison, or announcement', () => {
    const facade = new ExamBuilderFacade();
    const beforeTarget = facade.target();
    const beforeCoverage = facade.currentCoverage();
    const beforeComparison = facade.comparison();
    const beforeAnnouncement = facade.liveUpdateText();
    const invalid = { ...beforeTarget, targetQuestionCount: 0 };

    expect(facade.applyBlueprint(invalid)).toBe(false);
    expect(facade.target()).toBe(beforeTarget);
    expect(facade.currentCoverage()).toBe(beforeCoverage);
    expect(facade.comparison()).toBe(beforeComparison);
    expect(facade.liveUpdateText()).toBe(beforeAnnouncement);
  });

  it('replaces coverage and comparison with deeply immutable, matching snapshots', () => {
    const facade = new ExamBuilderFacade();
    const input = matchingCoverageFor(facade.target());
    const beforeInput = JSON.stringify(input);

    facade.replaceCurrentCoverage(input);

    const coverage = facade.currentCoverage();
    const comparison = facade.comparison();
    expect(JSON.stringify(input)).toBe(beforeInput);
    expect(coverage).not.toBe(input);
    expect(Object.isFrozen(coverage)).toBe(true);
    expect(Object.isFrozen(coverage.outcomeBuckets)).toBe(true);
    expect(Object.isFrozen(coverage.outcomeBuckets[0])).toBe(true);
    expect(Object.isFrozen(coverage.difficultyBuckets)).toBe(true);
    expect(Object.isFrozen(coverage.difficultyBuckets[0])).toBe(true);
    expect(Object.isFrozen(coverage.questionTypeBuckets)).toBe(true);
    expect(Object.isFrozen(coverage.questionTypeBuckets[0])).toBe(true);
    expect(comparison.status).toBe('valid');
    expect(Object.isFrozen(comparison)).toBe(true);
    expect(Object.isFrozen(comparison.dimensions)).toBe(true);
    expect(Object.isFrozen(comparison.dimensions[0])).toBe(true);
    expect(Object.isFrozen(comparison.dimensions[0].buckets)).toBe(true);
    expect(Object.isFrozen(comparison.dimensions[0].buckets[0])).toBe(true);
  });

  it('tracks draft request state, normalized settings aliases, and truthful pinned selection readiness', () => {
    const facade = new ExamBuilderFacade();
    expect(facade.requestState().status).toBe('idle');
    expect(facade.selectedPinnedSnapshots()).toEqual([]);
    expect(facade.publishReady()).toBe(false);
    expect(facade.publishReadiness()).toBe(false);
    expect(facade.normalizedSettings()).toEqual(facade.settings());
    expect(facade.setSettings({ title: ' ', durationMinutes: 0, rules: [] })).toBe(false);
    expect(facade.settings().title).toBe('Untitled exam');
  });
  it('automatically selects one retained immutable snapshot without duplicate stable identity', async () => {
    const snapshot = selectionSnapshot();
    const row = questionRowFor(snapshot);
    const repository = questionRepositoryStub(of({ items: [row, row] }), [snapshot]);
    const facade = new ExamBuilderFacade(null, null, repository);
    expect(facade.applyBlueprint(selectionTarget())).toBe(true);

    const state = await firstValueFrom(facade.autoSelectQuestions());

    expect(state.status).toBe('success');
    expect(state.selected).toHaveLength(1);
    expect(state.selected[0]?.versionId).toBe(snapshot.versionId);
    expect(facade.selectedPinnedSnapshots()).toHaveLength(1);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.selected)).toBe(true);
    expect(Object.isFrozen(facade.selectedPinnedSnapshots()[0])).toBe(true);
  });

  it('returns explicit partial and empty unmet reasons from bounded selection', async () => {
    const snapshot = selectionSnapshot();
    const partialRepository = questionRepositoryStub(of({ items: [questionRowFor(snapshot)] }), [snapshot]);
    const partialFacade = new ExamBuilderFacade(null, null, partialRepository);
    expect(partialFacade.applyBlueprint(selectionTarget(2, 4))).toBe(true);
    const partial = await firstValueFrom(partialFacade.autoSelectQuestions());
    expect(partial.status).toBe('partial');
    expect(partial.selected).toHaveLength(1);
    expect(partial.unmetReasons.length).toBeGreaterThan(0);
    expect(partial.unmetReasons[0]?.message).toContain('missing');

    const emptyRepository = questionRepositoryStub(of({ items: [] }), []);
    const emptyFacade = new ExamBuilderFacade(null, null, emptyRepository);
    expect(emptyFacade.applyBlueprint(selectionTarget())).toBe(true);
    const empty = await firstValueFrom(emptyFacade.autoSelectQuestions());
    expect(empty.status).toBe('empty');
    expect(empty.selected).toEqual([]);
    expect(empty.unmetReasons.length).toBeGreaterThan(0);
  });

  it('keeps pinned selection unchanged on repository failure and exposes an error state', async () => {
    const snapshot = selectionSnapshot();
    const repository = questionRepositoryStub(throwError(() => new Error('question bank unavailable')), [snapshot]);
    const facade = new ExamBuilderFacade(null, null, repository);
    facade.setSelectedQuestionVersions([snapshot]);
    const before = facade.selectedPinnedSnapshots();

    await expect(firstValueFrom(facade.autoSelectQuestions())).rejects.toThrow('question bank unavailable');

    expect(facade.selectedPinnedSnapshots()).toBe(before);
    expect(facade.autoSelectionState().status).toBe('error');
  });

  it('ignores stale automatic-selection responses after a newer request', async () => {
    const first = new Subject<unknown>();
    const second = new Subject<unknown>();
    const firstSnapshot = selectionSnapshot('Q-1');
    const secondSnapshot = selectionSnapshot('Q-2');
    const repository = {
      listQuestions: vi.fn()
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second),
      getQuestionVersionHistory: vi.fn((id: string) => of([id === 'Q-2' ? secondSnapshot : firstSnapshot]))
    } as unknown as QuestionBankRepository;
    const facade = new ExamBuilderFacade(null, null, repository);
    expect(facade.applyBlueprint(selectionTarget())).toBe(true);
    facade.autoSelectQuestions().subscribe({ error: () => undefined });
    const latest = firstValueFrom(facade.autoSelectQuestions());
    second.next({ items: [questionRowFor(secondSnapshot)] });
    second.complete();
    await latest;
    first.next({ items: [questionRowFor(firstSnapshot)] });
    first.complete();

    expect(facade.selectedPinnedSnapshots().map((item) => item.questionId)).toEqual([secondSnapshot.questionId]);
  });
  it('transitions the current-exam load to slow at 400 ms and cleans the timer on success', () => {
    vi.useFakeTimers();
    try {
      const response = new Subject<Exam>();
      const repository = examRepositoryStub(response);
      const facade = new ExamBuilderFacade(repository);
      const exam = examFor(facade);
      facade.loadCurrent('EXAM-1').subscribe({ error: () => undefined });
      expect(facade.currentExamLoadState()).toMatchObject({ status: 'loading' });
      vi.advanceTimersByTime(399);
      expect(facade.currentExamLoadState().status).toBe('loading');
      vi.advanceTimersByTime(1);
      expect(facade.currentExamLoadState()).toMatchObject({ status: 'slow', retryable: true });
      response.next(exam);
      response.complete();
      expect(facade.currentExamLoadState()).toMatchObject({ status: 'success' });
      expect(Object.isFrozen(facade.currentExamLoadState())).toBe(true);
      vi.advanceTimersByTime(400);
      expect(facade.currentExamLoadState().status).toBe('success');
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('retries the unchanged current-exam id/options for service errors and never retries unauthorized loads', async () => {
    const getCurrent = vi.fn()
      .mockReturnValueOnce(throwError(() => ({ kind: 'service' })))
      .mockReturnValueOnce(of(undefined as unknown as Exam));
    const repository = { getCurrent, listVersionHistory: vi.fn(() => of([])) } as unknown as ExamRepository;
    const facade = new ExamBuilderFacade(repository);
    const exam = examFor(facade, 'EXAM-7');
    getCurrent.mockReset()
      .mockReturnValueOnce(throwError(() => ({ kind: 'service' })))
      .mockReturnValueOnce(of(exam));
    await expect(firstValueFrom(facade.loadCurrent('EXAM-7', { expectedVersion: 3 }))).rejects.toMatchObject({ kind: 'service' });
    expect(facade.currentExamLoadState()).toMatchObject({ status: 'error', retryable: true });
    await firstValueFrom(facade.retryLoadCurrent());
    expect(getCurrent).toHaveBeenNthCalledWith(2, 'EXAM-7', expect.objectContaining({ expectedVersion: 3 }));
    const unauthorizedRepository = { getCurrent: vi.fn(() => throwError(() => ({ kind: 'unauthorized' }))), listVersionHistory: vi.fn(() => of([])) } as unknown as ExamRepository;
    const unauthorizedFacade = new ExamBuilderFacade(unauthorizedRepository);
    await expect(firstValueFrom(unauthorizedFacade.loadCurrent('EXAM-8'))).rejects.toMatchObject({ kind: 'unauthorized' });
    expect(unauthorizedFacade.currentExamLoadState()).toMatchObject({ status: 'unauthorized' });
    unauthorizedFacade.retryLoadCurrent().subscribe();
    expect(unauthorizedRepository.getCurrent).toHaveBeenCalledTimes(1);
  });

  it('clears stale data at a new boundary and ignores superseded current-exam responses', async () => {
    const first = new Subject<Exam>();
    const second = new Subject<Exam>();
    const getCurrent = vi.fn();
    const repository = { getCurrent, listVersionHistory: vi.fn(() => of([])) } as unknown as ExamRepository;
    const facade = new ExamBuilderFacade(repository);
    const old = examFor(facade, 'EXAM-OLD', 'published');
    const latest = examFor(facade, 'EXAM-LATEST');
    getCurrent
      .mockReturnValueOnce(of(old))
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    await firstValueFrom(facade.loadCurrent('EXAM-OLD'));
    const snapshot = selectionSnapshot();
    facade.setSelectedQuestionVersions([snapshot]);
    expect(facade.currentExam()?.id).toBe('EXAM-OLD');
    facade.loadCurrent('EXAM-FIRST').subscribe({ error: () => undefined });
    facade.loadCurrent('EXAM-LATEST').subscribe({ error: () => undefined });
    expect(facade.currentExam()).toBeNull();
    expect(facade.history()).toEqual([]);
    expect(facade.selectedPinnedSnapshots()).toEqual([]);
    first.next(examFor(facade, 'EXAM-FIRST'));
    first.complete();
    expect(facade.currentExam()).toBeNull();
    second.next(latest);
    second.complete();
    expect(facade.currentExam()?.id).toBe('EXAM-LATEST');
    expect(facade.currentExamLoadState().status).toBe('success');
  });

  it('invalidates pending writes and neutralizes workflow feedback at a newer current-exam load boundary', async () => {
    const pendingWrite = new Subject<Exam>();
    const latestLoad = new Subject<Exam>();
    const getCurrent = vi.fn();
    const repository = {
      getCurrent,
      listVersionHistory: vi.fn(() => of([])),
      updateDraft: vi.fn(() => pendingWrite)
    } as unknown as ExamRepository;
    const facade = new ExamBuilderFacade(repository);
    const old = examFor(facade, 'EXAM-OLD');
    const latest = examFor(facade, 'EXAM-LATEST');
    const staleWrite = examFor(facade, 'EXAM-STALE');
    getCurrent.mockReturnValueOnce(of(old)).mockReturnValueOnce(latestLoad);

    await firstValueFrom(facade.loadCurrent('EXAM-OLD'));
    facade.saveDraft({ title: 'Pending change' }).subscribe({ error: () => undefined });
    expect(facade.requestState()).toMatchObject({ status: 'saving' });

    const latestSubscription = facade.loadCurrent('EXAM-LATEST').subscribe({ error: () => undefined });
    expect(facade.requestState()).toEqual({ status: 'idle' });
    expect(facade.currentExamLoadState()).toMatchObject({ status: 'loading' });
    latestLoad.next(latest);
    latestLoad.complete();
    expect(facade.currentExam()).toBe(latest);
    expect(facade.currentExamLoadState()).toMatchObject({ status: 'success' });
    expect(facade.requestState()).toEqual({ status: 'idle' });

    pendingWrite.next(staleWrite);
    pendingWrite.complete();
    expect(facade.currentExam()).toBe(latest);
    expect(facade.currentExamLoadState()).toMatchObject({ status: 'success' });
    expect(facade.requestState()).toEqual({ status: 'idle' });
    latestSubscription.unsubscribe();
  });
  it('invalidates pending save and history callbacks at the new-draft boundary', () => {
    const pendingSave = new Subject<Exam>();
    const pendingHistory = new Subject<readonly Exam[]>();
    const repository = {
      createDraft: vi.fn(() => pendingSave),
      listVersionHistory: vi.fn(() => pendingHistory)
    } as unknown as ExamRepository;
    const facade = new ExamBuilderFacade(repository);

    facade.saveDraft({ title: 'Stale draft' }).subscribe({ error: () => undefined });
    facade.loadHistory('EXAM-OLD').subscribe({ error: () => undefined });
    expect(facade.requestState()).toEqual({ status: 'loading' });

    facade.startNewDraft();
    const staleExam = examFor(facade, 'EXAM-STALE');
    pendingSave.next(staleExam);
    pendingSave.complete();
    pendingHistory.next([staleExam]);
    pendingHistory.complete();

    expect(facade.currentExam()).toBeNull();
    expect(facade.history()).toEqual([]);
    expect(facade.requestState()).toEqual({ status: 'idle' });
    expect(facade.currentExamLoadState()).toEqual({ status: 'idle', message: 'Ready for a new exam draft.' });
    expect(facade.settings()).toEqual({ title: 'Untitled exam', durationMinutes: 60, rules: [] });
    expect(facade.selectedQuestionVersions()).toEqual([]);
  });

  it('clears load timers and rejects responses after cancellation or destruction', () => {
    vi.useFakeTimers();
    try {
      const cancelled = new Subject<Exam>();
      const destroyed = new Subject<Exam>();
      const getCurrent = vi.fn().mockReturnValueOnce(cancelled).mockReturnValueOnce(destroyed);
      const repository = { getCurrent, listVersionHistory: vi.fn(() => of([])) } as unknown as ExamRepository;
      const facade = new ExamBuilderFacade(repository);
      const first = facade.loadCurrent('EXAM-CANCEL').subscribe({ error: () => undefined });
      first.unsubscribe();
      vi.advanceTimersByTime(401);
      expect(facade.currentExamLoadState().status).toBe('loading');
      facade.loadCurrent('EXAM-DESTROY').subscribe({ error: () => undefined });
      facade.ngOnDestroy();
      vi.advanceTimersByTime(401);
      destroyed.next(examFor(facade, 'EXAM-DESTROY'));
      destroyed.complete();
      expect(facade.currentExam()).toBeNull();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
