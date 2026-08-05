import { describe, expect, it, vi } from 'vitest';

import {
  createAnswerDraft
} from '../models/answer-draft.models';
import {
  createOfflineAnswerQueueBatch,
  createOfflineAnswerQueueRecord,
  OfflineAnswerQueueValidationError,
  type OfflineAnswerQueueBatch
} from '../models/offline-answer-queue.models';
import {
  OFFLINE_ANSWER_QUEUE_STORAGE_KEY,
  OfflineAnswerQueue
} from './offline-answer-queue';
import { InMemoryStorageAdapter, type StorageAdapter } from '../../../core/storage/storage-adapter';

describe('offline answer queue contract', () => {
  it('deeply freezes validated records and rejects malformed drafts or metadata', () => {
    const record = createOfflineAnswerQueueRecord({
      operationId: 'operation-1',
      sessionId: 'session-1',
      questionId: 'question-1',
      draft: createAnswerDraft('question-1', ['first'], false, 0),
      expectedVersion: 0,
      enqueueOrder: 1
    });

    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.draft)).toBe(true);
    expect(Object.isFrozen(record.draft.value)).toBe(true);
    expect(() => createOfflineAnswerQueueRecord({
      ...record,
      expectedVersion: 1
    })).toThrow(OfflineAnswerQueueValidationError);
    expect(() => createOfflineAnswerQueueBatch([
      record,
      { ...record }
    ])).toThrow(OfflineAnswerQueueValidationError);
  });

  it('canonicalizes order, persists before resolve, and survives service recreation', async () => {
    const storage: StorageAdapter<OfflineAnswerQueueBatch> = new InMemoryStorageAdapter<OfflineAnswerQueueBatch>();
    let operation = 0;
    const first = new OfflineAnswerQueue(storage, () => `operation-${++operation}`);
    const second = new OfflineAnswerQueue(storage, () => `recreated-${++operation}`);

    const firstEnqueue = first.enqueue({
      sessionId: 'session-1',
      questionId: 'question-2',
      draft: createAnswerDraft('question-2', 'second')
    });
    const secondEnqueue = first.enqueue({
      sessionId: 'session-1',
      questionId: 'question-1',
      draft: createAnswerDraft('question-1', 'first')
    });
    const records = await Promise.all([firstEnqueue, secondEnqueue]);

    expect(records.map((record) => record.enqueueOrder)).toEqual([1, 2]);
    expect(await second.read()).toEqual(records);
    expect(await second.count('session-1')).toBe(2);

    await second.remove(records[0].operationId);
    expect(await first.read()).toEqual([records[1]]);
    await second.replace(records[1].operationId, {
      ...records[1],
      draft: createAnswerDraft('question-1', 'updated', false, 0),
      expectedVersion: 0
    });
    expect((await first.read())[0].draft.value).toBe('updated');
  });

  it('rejects malformed persisted collections instead of replaying them', async () => {
    const storage = new InMemoryStorageAdapter<unknown>();
    await storage.write(OFFLINE_ANSWER_QUEUE_STORAGE_KEY, {
      schemaVersion: 1,
      nextEnqueueOrder: 2,
      records: [{ operationId: 'malformed' }]
    });
    const queue = new OfflineAnswerQueue(storage as StorageAdapter<never>);

    await expect(queue.read()).rejects.toBeInstanceOf(OfflineAnswerQueueValidationError);
  });

  it('retains the previous collection when a replacement write fails', async () => {
    const storage: StorageAdapter<OfflineAnswerQueueBatch> = new InMemoryStorageAdapter<OfflineAnswerQueueBatch>();
    const queue = new OfflineAnswerQueue(storage, () => 'operation-1');
    const record = await queue.enqueue({
      sessionId: 'session-1',
      questionId: 'question-1',
      draft: createAnswerDraft('question-1', 'answer')
    });
    const write = vi.spyOn(storage, 'write').mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(queue.remove(record.operationId)).rejects.toThrow('storage unavailable');
    write.mockRestore();
    expect(await queue.read()).toEqual([record]);
  });
});
