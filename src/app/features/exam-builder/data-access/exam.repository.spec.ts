import { firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { MockTransport } from '../../../core/api/mock-transport';
import { DEMO_ACCOUNTS } from '../../../core/auth/authorization';
import { SessionStore } from '../../../core/auth/session.store';
import {
  asCourseId,
  asLearningOutcomeId,
  asQuestionId,
  asQuestionVersionId
} from '../../question-bank/models/question.models';
import { createExamBlueprint } from '../models/exam-blueprint.models';
import { ExamRepository } from './exam.repository';

const sessionFor = (role: 'INSTRUCTOR' | 'MEASUREMENT_SPECIALIST' | 'PROGRAM_MANAGER' | 'STUDENT'): SessionStore => {
  const account = DEMO_ACCOUNTS.find((candidate) => candidate.roleCode === role);
  if (account === undefined) throw new Error(`Missing demo account for ${role}.`);
  const store = new SessionStore();
  store.signIn(account.id);
  return store;
};

const snapshot = {
  id: asQuestionId('Q-1'), questionId: asQuestionId('Q-1'), version: 1, versionId: asQuestionVersionId('Q-1-v1'), status: 'published', courseId: asCourseId('COURSE-1'), outcomeId: asLearningOutcomeId('OUT-1'),
  course: { id: asCourseId('COURSE-1'), code: 'C', title: 'Course' }, outcome: { id: asLearningOutcomeId('OUT-1'), code: 'O', title: 'Outcome' }, title: 'Question', stem: 'Stem', explanation: '', tags: [], difficulty: 'easy', points: 2,
  grade: 'foundation', type: 'single-choice', options: [{ id: 'A', label: 'A' }], answer: { kind: 'choice', optionIds: ['A'] },
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', publishedAt: '2026-01-01T00:00:00.000Z', changeNote: 'seed'
} as const;

const input = {
  title: '  Algebra exam ', durationMinutes: 30, rules: [{ key: 'shuffle', value: true }],
  blueprint: createExamBlueprint({ targetQuestionCount: 1, targetPoints: 2, outcomeBuckets: [{ key: 'OUT-1', targetQuestionCount: 1, targetPoints: 2 }], difficultyBuckets: [{ key: 'easy', targetQuestionCount: 1, targetPoints: 2 }], questionTypeBuckets: [{ key: 'single-choice', targetQuestionCount: 1, targetPoints: 2 }] })!,
  questionVersions: [snapshot]
};

describe('ExamRepository guarded version workflow', () => {
  it('publishes exact pinned coverage, retains history, and creates same-id successor', async () => {
    const store = sessionFor('INSTRUCTOR');
    const repository = new ExamRepository(new MockTransport(), store);
    const draft = await firstValueFrom(repository.createDraft(input));
    const published = await firstValueFrom(repository.publish(draft.id, { changeNote: ' First release ' }, { expectedVersion: draft.version }));
    const before = await firstValueFrom(repository.listVersionHistory(draft.id));
    await expect(firstValueFrom(repository.updateDraft(published.id, { title: 'missing guard' }))).rejects.toMatchObject({ code: 'conflict' });
    await expect(firstValueFrom(repository.publish(published.id))).rejects.toMatchObject({ code: 'conflict' });
    await expect(firstValueFrom(repository.updateDraft(published.id, { title: 'blocked' }, { expectedVersion: published.version }))).rejects.toMatchObject({ code: 'immutable' });
    await expect(firstValueFrom(repository.createSuccessor(published.id, { changeNote: 'guarded' }))).rejects.toMatchObject({ code: 'conflict' });
    const successor = await firstValueFrom(repository.createSuccessor(draft.id, { changeNote: ' Clarify wording ' }, { expectedVersion: published.version }));
    const after = await firstValueFrom(repository.listVersionHistory(draft.id));
    expect(published.status).toBe('published');
    expect(before).toHaveLength(1);
    expect(after).toEqual(before);
    expect(successor).toMatchObject({ id: published.id, version: published.version + 1, status: 'draft' });
    await expect(firstValueFrom(repository.updateDraft(published.id, { title: 'stale' }, { expectedVersion: published.version }))).rejects.toMatchObject({ code: 'conflict' });
  });

  it('rejects unauthorized, stale, missing-note, and invalid publication without mutation', async () => {
    const repository = new ExamRepository(new MockTransport(), sessionFor('INSTRUCTOR'));
    const draft = await firstValueFrom(repository.createDraft({ ...input, questionVersions: [] }));
    const before = repository.getSnapshot();
    await expect(firstValueFrom(repository.publish(draft.id, {}, { session: sessionFor('STUDENT').session(), expectedVersion: draft.version }))).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(firstValueFrom(repository.updateDraft(draft.id, { title: 'stale' }, { expectedVersion: draft.version + 1 }))).rejects.toMatchObject({ code: 'conflict' });
    await expect(firstValueFrom(repository.createSuccessor(draft.id, { changeNote: ' ' }, { expectedVersion: draft.version }))).rejects.toMatchObject({ code: 'validation' });
    await expect(firstValueFrom(repository.publish(draft.id, {}, { expectedVersion: draft.version }))).rejects.toMatchObject({ code: 'validation' });
    expect(repository.getSnapshot()).toEqual(before);
  });
});
