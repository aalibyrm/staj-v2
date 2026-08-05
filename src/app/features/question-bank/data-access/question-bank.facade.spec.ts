import { firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { MockTransport } from '../../../core/api/mock-transport';
import { DEMO_ACCOUNTS } from '../../../core/auth/authorization';
import { SessionStore } from '../../../core/auth/session.store';
import {
  QuestionBankFacade,
  QuestionBankRepository
} from './question-bank.facade';

const signedIn = (role: 'INSTRUCTOR' | 'MEASUREMENT_SPECIALIST' | 'STUDENT'): SessionStore => {
  const account = DEMO_ACCOUNTS.find((candidate) => candidate.roleCode === role);
  if (account === undefined) throw new Error(`Missing account for ${role}.`);
  const store = new SessionStore();
  store.signIn(account.id);
  return store;
};

describe('QuestionBankRepository publish/version workflow', () => {
  it('publishes a frozen snapshot matching the published entity', async () => {
    const repository = new QuestionBankRepository(new MockTransport());
    const session = signedIn('INSTRUCTOR').session();
    const draft = (await firstValueFrom(repository.listQuestions({ status: 'draft', pageSize: 50 }, { session }))).items[0];
    if (draft === undefined) throw new Error('Expected a draft question.');

    const published = await firstValueFrom(repository.publishQuestion(draft.id, { changeNote: '  First release  ' }, { session, expectedVersion: draft.version }));
    const history = await firstValueFrom(repository.getQuestionVersionHistory(draft.id, { session }));
    const snapshot = history.find((version) => version.version === published.version);

    expect(published.status).toBe('published');
    expect(snapshot).toBeDefined();
    expect(snapshot).toMatchObject({ questionId: published.id, versionId: `${published.id}-v${published.version}`, changeNote: 'First release', publishedAt: published.updatedAt });
    expect(snapshot?.title).toBe(published.title);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot?.options)).toBe(true);
    expect(() => { (snapshot as { title: string }).title = 'mutated'; }).toThrow();
  });

  it('creates one stable-id successor with an incremented version and mandatory normalized note', async () => {
    const repository = new QuestionBankRepository(new MockTransport());
    const session = signedIn('INSTRUCTOR').session();
    const published = (await firstValueFrom(repository.listQuestions({ status: 'published', pageSize: 50 }, { session }))).items[0];
    if (published === undefined) throw new Error('Expected a published question.');
    const before = await firstValueFrom(repository.getQuestionVersionHistory(published.id, { session }));

    const successor = await firstValueFrom(repository.createQuestionSuccessor(published.id, { changeNote: '  Clarify the evidence  ' }, { session, expectedVersion: published.version }));
    const after = await firstValueFrom(repository.getQuestionVersionHistory(published.id, { session }));

    expect(successor).toMatchObject({ id: published.id, version: published.version + 1, status: 'draft' });
    expect(after).toEqual(before);
    await expect(firstValueFrom(repository.createQuestionSuccessor(successor.id, { changeNote: 'second attempt' }, { session, expectedVersion: successor.version }))).rejects.toMatchObject({ code: 'not-editable' });
    await expect(firstValueFrom(repository.createQuestionSuccessor(published.id, { changeNote: '   ' }, { session, expectedVersion: published.version }))).rejects.toMatchObject({ code: 'validation' });
  });

  it('preserves entity and retained snapshots on unauthorized, stale, and service failures', async () => {
    const repository = new QuestionBankRepository(new MockTransport());
    const session = signedIn('INSTRUCTOR').session();
    const draft = (await firstValueFrom(repository.listQuestions({ status: 'draft', pageSize: 50 }, { session }))).items[0];
    if (draft === undefined) throw new Error('Expected a draft question.');
    const before = repository.getSnapshot();

    await expect(firstValueFrom(repository.publishQuestion(draft.id, {}, { session: signedIn('STUDENT').session(), expectedVersion: draft.version }))).rejects.toMatchObject({ code: 'unauthorized' });
    expect(repository.getSnapshot()).toEqual(before);
    await expect(firstValueFrom(repository.publishQuestion(draft.id, {}, { session, expectedVersion: draft.version + 1 }))).rejects.toMatchObject({ code: 'conflict' });
    expect(repository.getSnapshot()).toEqual(before);
    repository.setMockScenario({ outcome: 'service-error' });
    await expect(firstValueFrom(repository.publishQuestion(draft.id, {}, { session, expectedVersion: draft.version }))).rejects.toMatchObject({ kind: 'service' });
    expect(repository.getSnapshot()).toEqual(before);
  });
});

describe('QuestionBankFacade publish/version workflow', () => {
  it('exposes scoped history and retains selected state after a successful successor', async () => {
    const store = signedIn('INSTRUCTOR');
    const facade = new QuestionBankFacade(new QuestionBankRepository(new MockTransport()), store);
    const response = await firstValueFrom(facade.loadQuestions({ status: 'published', pageSize: 50 }));
    const published = response.items[0];
    if (published === undefined) throw new Error('Expected a published question.');
    await firstValueFrom(facade.selectQuestion(published.id));
    const history = await firstValueFrom(facade.loadQuestionVersionHistory(published.id));
    expect(history.length).toBeGreaterThan(0);

    const successor = await firstValueFrom(facade.createQuestionSuccessor(published.id, { changeNote: 'Refine wording' }, { expectedVersion: published.version }));
    expect(facade.selectedQuestion()).toMatchObject({ id: published.id, version: published.version + 1, status: 'draft' });
    expect(successor.id).toBe(published.id);
    expect(facade.saveRequestState().status).toBe('success');
  });
  it('keeps filtered totals and aggregate status counts stable across publish then successor', async () => {
    const facade = new QuestionBankFacade(new QuestionBankRepository(new MockTransport()), signedIn('INSTRUCTOR'));
    const response = await firstValueFrom(facade.loadQuestions({ status: 'draft', pageSize: 50 }));
    const draft = response.items[0];
    if (draft === undefined) throw new Error('Expected a draft question.');
    await firstValueFrom(facade.selectQuestion(draft.id));
    const initialTotal = facade.total();
    const initialCounts = facade.statusCounts();
    const initialStatusTotal = Object.values(initialCounts).reduce((sum, count) => sum + count, 0);

    const published = await firstValueFrom(facade.publishQuestion(draft.id, {}, { expectedVersion: draft.version }));
    expect(facade.total()).toBe(initialTotal - 1);
    expect(facade.statusCounts().draft).toBe(initialCounts.draft - 1);
    expect(facade.statusCounts().published).toBe(initialCounts.published + 1);
    await firstValueFrom(facade.createQuestionSuccessor(published.id, { changeNote: 'Restore editable work' }, { expectedVersion: published.version }));

    expect(facade.total()).toBe(initialTotal);
    expect(facade.statusCounts().draft).toBe(initialCounts.draft);
    expect(facade.statusCounts().published).toBe(initialCounts.published);
    expect(Object.values(facade.statusCounts()).reduce((sum, count) => sum + count, 0)).toBe(initialStatusTotal);
  });
});
