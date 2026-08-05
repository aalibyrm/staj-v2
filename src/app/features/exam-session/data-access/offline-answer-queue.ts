import { Inject, Injectable, InjectionToken, Optional } from '@angular/core';

import {
  createAnswerDraft,
  type AnswerDraft,
  type AnswerValue
} from '../models/answer-draft.models';
import {
  createOfflineAnswerQueueBatch,
  createOfflineAnswerQueueRecord,
  parseOfflineAnswerQueueBatch,
  type OfflineAnswerQueueBatch,
  type OfflineAnswerQueueRecord,
  type OfflineAnswerQueueRecordInput
} from '../models/offline-answer-queue.models';
import {
  createBrowserStorageAdapter,
  type StorageAdapter
} from '../../../core/storage/storage-adapter';

export const OFFLINE_ANSWER_QUEUE_DATABASE_NAME = 'adaptive-exam-session-offline-queue';
export const OFFLINE_ANSWER_QUEUE_STORE_NAME = 'answer-operations';
export const OFFLINE_ANSWER_QUEUE_STORAGE_KEY = 'exam-session-answer-operations';

export type OfflineAnswerQueueStorage = StorageAdapter<OfflineAnswerQueueBatch>;

export type OfflineAnswerQueueEnqueueInput = Readonly<{
  readonly sessionId: string;
  readonly questionId: string;
  readonly draft: AnswerDraft;
  readonly expectedVersion?: number;
}>;

export const OFFLINE_ANSWER_QUEUE_STORAGE = new InjectionToken<OfflineAnswerQueueStorage>(
  'OFFLINE_ANSWER_QUEUE_STORAGE',
  {
    providedIn: 'root',
    factory: () => createBrowserStorageAdapter<OfflineAnswerQueueBatch>({
      databaseName: OFFLINE_ANSWER_QUEUE_DATABASE_NAME,
      storeName: OFFLINE_ANSWER_QUEUE_STORE_NAME,
      version: 1
    })
  }
);

export type OfflineAnswerQueueOperationIdSource = () => string;

let fallbackOperationSequence = 0;
const defaultOperationIdSource: OfflineAnswerQueueOperationIdSource = () => {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid !== undefined) return `offline-answer-${randomUuid}`;
  fallbackOperationSequence += 1;
  return `offline-answer-${Date.now()}-${fallbackOperationSequence}`;
};

export const OFFLINE_ANSWER_QUEUE_OPERATION_ID_SOURCE = new InjectionToken<OfflineAnswerQueueOperationIdSource>(
  'OFFLINE_ANSWER_QUEUE_OPERATION_ID_SOURCE',
  { providedIn: 'root', factory: () => defaultOperationIdSource }
);

const nonblank = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const normalizeIdentifier = (value: unknown, field: string): string => {
  if (!nonblank(value)) throw new TypeError(`${field} must be a nonblank string.`);
  return value.trim();
};

const normalizeExpectedVersion = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('expectedVersion must be a nonnegative safe integer.');
  }
  return value;
};

const normalizeDraft = (draft: AnswerDraft, questionId: string, expectedVersion: number): AnswerDraft => {
  if (draft === null || typeof draft !== 'object' || Array.isArray(draft)) {
    throw new TypeError('Queued answer draft must be an object.');
  }
  if (String(draft.questionId).trim() !== questionId) {
    throw new TypeError('Queued answer draft questionId must match the request.');
  }
  if (draft.version !== expectedVersion) {
    throw new TypeError('Queued answer draft version must equal expectedVersion.');
  }
  return createAnswerDraft(questionId, draft.value as AnswerValue, draft.flagged, {
    version: expectedVersion,
    savedAt: draft.savedAt
  });
};

const equalOperationId = (record: OfflineAnswerQueueRecord, operationId: string): boolean =>
  record.operationId === operationId;

@Injectable({ providedIn: 'root' })
export class OfflineAnswerQueue {
  private readonly storage: OfflineAnswerQueueStorage;
  private readonly operationIdSource: OfflineAnswerQueueOperationIdSource;
  private operation: Promise<unknown> = Promise.resolve();

  constructor(
    @Optional() @Inject(OFFLINE_ANSWER_QUEUE_STORAGE) storage: OfflineAnswerQueueStorage | null = null,
    @Optional() @Inject(OFFLINE_ANSWER_QUEUE_OPERATION_ID_SOURCE)
    operationIdSource: OfflineAnswerQueueOperationIdSource | null = null
  ) {
    this.storage = storage ?? createBrowserStorageAdapter<OfflineAnswerQueueBatch>({
      databaseName: OFFLINE_ANSWER_QUEUE_DATABASE_NAME,
      storeName: OFFLINE_ANSWER_QUEUE_STORE_NAME,
      version: 1
    });
    this.operationIdSource = operationIdSource ?? defaultOperationIdSource;
  }

  read(sessionId?: string): Promise<readonly OfflineAnswerQueueRecord[]> {
    const normalizedSessionId = sessionId === undefined ? undefined : normalizeIdentifier(sessionId, 'sessionId');
    return this.serialize(async () => {
      const batch = await this.readBatch();
      if (normalizedSessionId === undefined) return batch.records;
      return Object.freeze(batch.records.filter((record) => record.sessionId === normalizedSessionId));
    });
  }

  list(sessionId?: string): Promise<readonly OfflineAnswerQueueRecord[]> {
    return this.read(sessionId);
  }

  count(sessionId?: string): Promise<number> {
    return this.read(sessionId).then((records) => records.length);
  }

  enqueue(input: OfflineAnswerQueueEnqueueInput): Promise<OfflineAnswerQueueRecord> {
    const sessionId = normalizeIdentifier(input.sessionId, 'sessionId');
    const questionId = normalizeIdentifier(input.questionId, 'questionId');
    const expectedVersion = normalizeExpectedVersion(input.expectedVersion ?? input.draft.version);
    const draft = normalizeDraft(input.draft, questionId, expectedVersion);
    return this.serialize(async () => {
      const batch = await this.readBatch();
      const previous = batch.records
        .filter((record) => record.sessionId === sessionId && record.questionId === questionId)
        .at(-1);
      const effectiveExpectedVersion = previous === undefined
        ? expectedVersion
        : Math.max(expectedVersion, previous.expectedVersion + 1);
      if (!Number.isSafeInteger(effectiveExpectedVersion)) {
        throw new RangeError('Queued answer expectedVersion exceeded the safe integer range.');
      }
      const effectiveDraft = effectiveExpectedVersion === draft.version
        ? draft
        : createAnswerDraft(questionId, draft.value, draft.flagged, {
          version: effectiveExpectedVersion,
          savedAt: draft.savedAt
        });
      let operationId = normalizeIdentifier(this.operationIdSource(), 'operationId');
      let attempts = 0;
      while (batch.records.some((record) => record.operationId === operationId)) {
        attempts += 1;
        if (attempts > 100) throw new Error('Could not allocate a unique queued answer operation ID.');
        operationId = normalizeIdentifier(this.operationIdSource(), 'operationId');
      }
      const record = createOfflineAnswerQueueRecord({
        operationId,
        sessionId,
        questionId,
        draft: effectiveDraft,
        expectedVersion: effectiveExpectedVersion,
        enqueueOrder: batch.nextEnqueueOrder
      });
      const nextOrder = batch.nextEnqueueOrder + 1;
      if (!Number.isSafeInteger(nextOrder)) {
        throw new RangeError('Queued answer enqueueOrder exceeded the safe integer range.');
      }
      const nextBatch = createOfflineAnswerQueueBatch([...batch.records, record], nextOrder);
      await this.storage.write(OFFLINE_ANSWER_QUEUE_STORAGE_KEY, nextBatch);
      return record;
    });
  }

  remove(operationId: string): Promise<void> {
    const normalizedOperationId = normalizeIdentifier(operationId, 'operationId');
    return this.serialize(async () => {
      const batch = await this.readBatch();
      if (!batch.records.some((record) => equalOperationId(record, normalizedOperationId))) return;
      const nextBatch = createOfflineAnswerQueueBatch(
        batch.records.filter((record) => !equalOperationId(record, normalizedOperationId)),
        batch.nextEnqueueOrder
      );
      await this.storage.write(OFFLINE_ANSWER_QUEUE_STORAGE_KEY, nextBatch);
    });
  }

  replace(operationId: string, replacement: OfflineAnswerQueueRecord): Promise<OfflineAnswerQueueRecord> {
    const normalizedOperationId = normalizeIdentifier(operationId, 'operationId');
    const normalizedReplacement = createOfflineAnswerQueueRecord(replacement as OfflineAnswerQueueRecordInput);
    if (normalizedReplacement.operationId !== normalizedOperationId) {
      throw new TypeError('Replacement operationId must match the requested operationId.');
    }
    return this.serialize(async () => {
      const batch = await this.readBatch();
      const index = batch.records.findIndex((record) => record.operationId === normalizedOperationId);
      if (index < 0) throw new Error(`Queued answer operation ${normalizedOperationId} was not found.`);
      const existing = batch.records[index];
      if (existing.enqueueOrder !== normalizedReplacement.enqueueOrder ||
        existing.sessionId !== normalizedReplacement.sessionId ||
        existing.questionId !== normalizedReplacement.questionId) {
        throw new TypeError('Replacement must preserve operation identity and enqueue order.');
      }
      const records = [...batch.records];
      records[index] = normalizedReplacement;
      const nextBatch = createOfflineAnswerQueueBatch(records, batch.nextEnqueueOrder);
      await this.storage.write(OFFLINE_ANSWER_QUEUE_STORAGE_KEY, nextBatch);
      return normalizedReplacement;
    });
  }

  private readBatch(): Promise<OfflineAnswerQueueBatch> {
    return this.storage.read(OFFLINE_ANSWER_QUEUE_STORAGE_KEY).then((value) =>
      value === undefined
        ? createOfflineAnswerQueueBatch()
        : parseOfflineAnswerQueueBatch(value)
    );
  }

  private serialize<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    const result = this.operation.then(operation, operation);
    this.operation = result.then(() => undefined, () => undefined);
    return result;
  }
}
