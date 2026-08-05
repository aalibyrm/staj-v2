import { firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { MockTransport } from '../../../core/api/mock-transport';
import { AuditPort } from '../../../core/observability/observability.ports';
import { DEMO_ACCOUNTS } from '../../../core/auth/authorization';
import { SessionStore } from '../../../core/auth/session.store';
import {
  QuestionBankFacade,
  QuestionBankRepository,
  normalizeQuestionListQuery
} from './question-bank.facade';
import { asQuestionId, asQuestionVersionId } from '../models/question.models';

const signedIn = (role: 'INSTRUCTOR' | 'MEASUREMENT_SPECIALIST' | 'STUDENT'): SessionStore => {
  const account = DEMO_ACCOUNTS.find((candidate) => candidate.roleCode === role);
  if (account === undefined) throw new Error(`Missing account for ${role}.`);
  const store = new SessionStore();
  store.signIn(account.id);
  return store;
};

describe('normalizeQuestionListQuery enum filters', () => {
  it('preserves supported values and removes unsupported enum tokens', () => {
    expect(normalizeQuestionListQuery({
      course: 'COURSE-SCOPE-01',
      grade: 'foundation',
      difficulty: 'medium',
      status: 'published',
      type: 'essay'
    })).toMatchObject({
      course: 'COURSE-SCOPE-01',
      grade: 'foundation',
      difficulty: 'medium',
      status: 'published',
      type: 'essay'
    });
    expect(normalizeQuestionListQuery({ grade: 'invalid-grade' }).grade).toBe('');
    expect(normalizeQuestionListQuery({ difficulty: 'invalid-difficulty' }).difficulty).toBe('');
    expect(normalizeQuestionListQuery({ status: 'invalid-status' }).status).toBe('');
    expect(normalizeQuestionListQuery({ type: 'invalid-type' }).type).toBe('');
  });
});

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

describe('QuestionBankRepository exam question reference snapshots', () => {
  it('pins and resolves the retained publication after creating an editable successor', async () => {
    const repository = new QuestionBankRepository(new MockTransport());
    const session = signedIn('INSTRUCTOR').session();
    const published = (await firstValueFrom(repository.listQuestions({ status: 'published', pageSize: 50 }, { session }))).items[0];
    if (published === undefined) throw new Error('Expected a published question.');
    const history = await firstValueFrom(repository.getQuestionVersionHistory(published.id, { session }));
    const snapshot = history.find((version) => version.version === published.version);
    if (snapshot === undefined) throw new Error('Expected the published version snapshot.');
    const pinned = await firstValueFrom(repository.pinExamQuestionReference({
      questionId: snapshot.questionId,
      version: snapshot.version,
      versionId: snapshot.versionId
    }, { session }));
    const resolvedBefore = await firstValueFrom(repository.resolveExamQuestionReference(pinned, { session }));

    expect(pinned).toEqual({
      questionId: snapshot.questionId,
      version: snapshot.version,
      versionId: snapshot.versionId
    });
    expect(Object.isFrozen(pinned)).toBe(true);
    expect(resolvedBefore).toEqual(snapshot);
    expect(Object.isFrozen(resolvedBefore)).toBe(true);
    expect(Object.isFrozen(resolvedBefore.options)).toBe(true);
    expect(() => Object.assign(pinned, { version: 99 })).toThrow();
    expect(() => Object.assign(resolvedBefore, { title: 'mutated' })).toThrow();

    const successor = await firstValueFrom(repository.createQuestionSuccessor(
      published.id,
      { changeNote: '  Refine wording  ' },
      { session, expectedVersion: published.version }
    ));
    const current = await firstValueFrom(repository.getQuestion(published.id, { session }));
    const resolvedAfter = await firstValueFrom(repository.resolveExamQuestionReference(pinned, { session }));

    expect(successor).toMatchObject({ id: published.id, version: published.version + 1, status: 'draft' });
    expect(current).toMatchObject({ id: published.id, version: published.version + 1, status: 'draft' });
    expect(resolvedAfter).toEqual(snapshot);
    expect(resolvedAfter.versionId).toBe(snapshot.versionId);
    expect(resolvedAfter.status).toBe('published');
  });

  it('rejects nonexistent, nonpublished, or unauthorized references without mutation', async () => {
    const repository = new QuestionBankRepository(new MockTransport());
    const session = signedIn('INSTRUCTOR').session();
    const published = (await firstValueFrom(repository.listQuestions({ status: 'published', pageSize: 50 }, { session }))).items[0];
    if (published === undefined) throw new Error('Expected a published question.');
    const history = await firstValueFrom(repository.getQuestionVersionHistory(published.id, { session }));
    const snapshot = history.find((version) => version.version === published.version);
    if (snapshot === undefined) throw new Error('Expected the published version snapshot.');
    const pinned = {
      questionId: snapshot.questionId,
      version: snapshot.version,
      versionId: snapshot.versionId
    };
    const successor = await firstValueFrom(repository.createQuestionSuccessor(
      published.id,
      { changeNote: '  Refine wording  ' },
      { session, expectedVersion: published.version }
    ));
    const afterSuccessor = repository.getSnapshot();
    const nonpublished = {
      questionId: successor.id,
      version: successor.version,
      versionId: asQuestionVersionId(`${successor.id}-v${successor.version}`)
    };
    const missing = {
      questionId: published.id,
      version: successor.version + 99,
      versionId: asQuestionVersionId(`${published.id}-v${successor.version + 99}`)
    };
    const mismatched = {
      questionId: pinned.questionId,
      version: pinned.version,
      versionId: asQuestionVersionId('QUESTION-version-mismatch')
    };

    for (const reference of [nonpublished, missing, mismatched]) {
      await expect(firstValueFrom(repository.pinExamQuestionReference(reference, { session }))).rejects.toMatchObject({ code: 'not-found' });
      await expect(firstValueFrom(repository.resolveExamQuestionReference(reference, { session }))).rejects.toMatchObject({ code: 'not-found' });
    }
    await expect(firstValueFrom(repository.pinExamQuestionReference(pinned, { session: signedIn('STUDENT').session() }))).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(firstValueFrom(repository.resolveExamQuestionReference(pinned, { session: signedIn('STUDENT').session() }))).rejects.toMatchObject({ kind: 'unauthorized' });
    expect(repository.getSnapshot()).toEqual(afterSuccessor);
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

describe('QuestionBankRepository bulk operations', () => {
  it('keeps deterministic partial results, protects immutable rows, normalizes tags, and audits successes only', async () => {
    const events: unknown[] = [];
    const audit = { record: (event: unknown): void => { events.push(event); } } as unknown as AuditPort;
    const repository = new QuestionBankRepository(new MockTransport(), audit);
    const session = signedIn('INSTRUCTOR').session();
    const rows = (await firstValueFrom(repository.listQuestions({ pageSize: 50 }, { session }))).items;
    const first = rows.find((question) => question.status === 'draft');
    const stale = rows.find((question) => question.status === 'review');
    const published = rows.find((question) => question.status === 'published');
    const archived = rows.find((question) => question.status === 'archived');
    if (first === undefined || stale === undefined || published === undefined || archived === undefined) {
      throw new Error('Expected editable, published, and archived seed rows.');
    }
    const result = await firstValueFrom(repository.bulkUpdateQuestions({
      targets: [
        { id: first.id, expectedVersion: first.version },
        { id: first.id, expectedVersion: first.version },
        { id: stale.id, expectedVersion: stale.version + 1 },
        { id: published.id, expectedVersion: published.version },
        { id: archived.id, expectedVersion: archived.version },
        { id: asQuestionId('QUESTION-MISSING'), expectedVersion: 1 }
      ],
      action: { addTags: [' bulk ', 'Bulk'] }
    }, { session }));

    expect(result.items.map((item) => item.id)).toEqual([first.id, stale.id, published.id, archived.id, 'QUESTION-MISSING']);
    expect(result.counts).toEqual({ total: 5, succeeded: 1, failed: 4 });
    expect(result.successes[0]?.after.tags).toContain('bulk');
    expect(result.failures.map((failure) => failure.code)).toEqual(['conflict', 'not-editable', 'not-editable', 'not-found']);
    expect(events).toHaveLength(1);
    expect(repository.getSnapshot().questions.find((question) => question.id === published.id)).toEqual(published);
    expect(repository.getSnapshot().questions.find((question) => question.id === archived.id)).toEqual(archived);
    expect(Object.isFrozen(result)).toBe(true);
  });
});

describe('QuestionBankFacade bulk operations', () => {
  it('refreshes the current query and keeps a valid inspector selection after success', async () => {
    const store = signedIn('INSTRUCTOR');
    const facade = new QuestionBankFacade(new QuestionBankRepository(new MockTransport()), store);
    const page = await firstValueFrom(facade.loadQuestions({ search: 'foundations', pageSize: 50 }));
    const draft = page.items.find((question) => question.status === 'draft');
    if (draft === undefined) throw new Error('Expected a draft question.');
    await firstValueFrom(facade.selectQuestion(draft.id));
    const result = await firstValueFrom(facade.bulkUpdateQuestions({
      targets: [{ id: draft.id, expectedVersion: draft.version }],
      action: { status: 'review' }
    }));
    expect(result.counts).toEqual({ total: 1, succeeded: 1, failed: 0 });
    expect(facade.bulkRequestState().status).toBe('success');
    expect(facade.pageResult()?.query.search).toBe('foundations');
    expect(facade.selectedQuestion()).toMatchObject({ id: draft.id, status: 'review' });
  });
});
