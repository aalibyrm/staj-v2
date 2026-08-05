import {
  createAnswerDraft,
  type AnswerDraft,
  type AnswerValue
} from './answer-draft.models';

export const OFFLINE_ANSWER_QUEUE_SCHEMA_VERSION = 1 as const;

type OfflineAnswerQueueSchemaVersion = typeof OFFLINE_ANSWER_QUEUE_SCHEMA_VERSION;

export type OfflineAnswerQueueRecord = Readonly<{
  readonly operationId: string;
  readonly sessionId: string;
  readonly questionId: string;
  readonly draft: AnswerDraft;
  readonly expectedVersion: number;
  readonly enqueueOrder: number;
}>;

export type OfflineAnswerQueueRecordInput = Readonly<{
  readonly operationId: string;
  readonly sessionId: string;
  readonly questionId: string;
  readonly draft: AnswerDraft;
  readonly expectedVersion: number;
  readonly enqueueOrder: number;
}>;

export type OfflineAnswerQueueBatch = Readonly<{
  readonly schemaVersion: OfflineAnswerQueueSchemaVersion;
  readonly nextEnqueueOrder: number;
  readonly records: readonly OfflineAnswerQueueRecord[];
}>;

export class OfflineAnswerQueueValidationError extends Error {
  override readonly name = 'OfflineAnswerQueueValidationError';
  readonly code = 'OFFLINE_ANSWER_QUEUE_INVALID' as const;

  constructor(message: string) {
    super(message);
  }
}

const nonblank = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const safePositiveInteger = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new OfflineAnswerQueueValidationError(`${field} must be a positive safe integer.`);
  }
  return value;
};

const safeNonnegativeInteger = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new OfflineAnswerQueueValidationError(`${field} must be a nonnegative safe integer.`);
  }
  return value;
};

const normalizeIdentifier = (value: unknown, field: string): string => {
  if (!nonblank(value)) {
    throw new OfflineAnswerQueueValidationError(`${field} must be a nonblank string.`);
  }
  return value.trim();
};

const normalizeDraft = (draft: unknown, questionId: string): AnswerDraft => {
  if (draft === null || typeof draft !== 'object' || Array.isArray(draft)) {
    throw new OfflineAnswerQueueValidationError('Queued answer draft must be an object.');
  }
  const source = draft as {
    readonly questionId?: unknown;
    readonly value?: unknown;
    readonly flagged?: unknown;
    readonly version?: unknown;
    readonly savedAt?: unknown;
  };
  if (String(source.questionId).trim() !== questionId) {
    throw new OfflineAnswerQueueValidationError('Queued answer draft questionId must match the record.');
  }
  if (typeof source.flagged !== 'boolean') {
    throw new OfflineAnswerQueueValidationError('Queued answer draft flagged must be a boolean.');
  }
  try {
    return createAnswerDraft(
      questionId,
      source.value as AnswerValue,
      source.flagged,
      {
        version: source.version as number,
        savedAt: source.savedAt as string | null | undefined
      }
    );
  } catch (error: unknown) {
    throw new OfflineAnswerQueueValidationError(
      error instanceof Error ? error.message : 'Queued answer draft is invalid.'
    );
  }
};

export const createOfflineAnswerQueueRecord = (
  input: OfflineAnswerQueueRecordInput
): OfflineAnswerQueueRecord => {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new OfflineAnswerQueueValidationError('Queued answer record must be an object.');
  }
  const operationId = normalizeIdentifier(input.operationId, 'operationId');
  const sessionId = normalizeIdentifier(input.sessionId, 'sessionId');
  const questionId = normalizeIdentifier(input.questionId, 'questionId');
  const expectedVersion = safeNonnegativeInteger(input.expectedVersion, 'expectedVersion');
  const enqueueOrder = safePositiveInteger(input.enqueueOrder, 'enqueueOrder');
  const draft = normalizeDraft(input.draft, questionId);
  if (draft.version !== expectedVersion) {
    throw new OfflineAnswerQueueValidationError(
      'Queued answer draft version must equal expectedVersion.'
    );
  }
  return Object.freeze({
    operationId,
    sessionId,
    questionId,
    draft,
    expectedVersion,
    enqueueOrder
  });
};

const sortRecords = (left: OfflineAnswerQueueRecord, right: OfflineAnswerQueueRecord): number =>
  left.enqueueOrder - right.enqueueOrder || left.operationId.localeCompare(right.operationId);

export const createOfflineAnswerQueueBatch = (
  records: readonly OfflineAnswerQueueRecord[] = [],
  nextEnqueueOrder?: number
): OfflineAnswerQueueBatch => {
  if (!Array.isArray(records)) {
    throw new OfflineAnswerQueueValidationError('Queued answer records must be an array.');
  }
  const normalized = records.map((record) => createOfflineAnswerQueueRecord(record));
  const operationIds = new Set<string>();
  const enqueueOrders = new Set<number>();
  for (const record of normalized) {
    if (operationIds.has(record.operationId)) {
      throw new OfflineAnswerQueueValidationError('Queued answer operation IDs must be unique.');
    }
    if (enqueueOrders.has(record.enqueueOrder)) {
      throw new OfflineAnswerQueueValidationError('Queued answer enqueue orders must be unique.');
    }
    operationIds.add(record.operationId);
    enqueueOrders.add(record.enqueueOrder);
  }
  normalized.sort(sortRecords);
  const maxOrder = normalized.at(-1)?.enqueueOrder ?? 0;
  const nextOrder = nextEnqueueOrder ?? maxOrder + 1;
  if (!Number.isSafeInteger(nextOrder) || nextOrder <= maxOrder) {
    throw new OfflineAnswerQueueValidationError(
      'nextEnqueueOrder must be greater than every queued answer enqueueOrder.'
    );
  }
  return Object.freeze({
    schemaVersion: OFFLINE_ANSWER_QUEUE_SCHEMA_VERSION,
    nextEnqueueOrder: nextOrder,
    records: Object.freeze(normalized)
  });
};

export const parseOfflineAnswerQueueBatch = (value: unknown): OfflineAnswerQueueBatch => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new OfflineAnswerQueueValidationError('Persisted offline answer queue must be an object.');
  }
  const source = value as {
    readonly schemaVersion?: unknown;
    readonly nextEnqueueOrder?: unknown;
    readonly records?: unknown;
  };
  if (source.schemaVersion !== OFFLINE_ANSWER_QUEUE_SCHEMA_VERSION) {
    throw new OfflineAnswerQueueValidationError('Persisted offline answer queue schema is unsupported.');
  }
  if (!Array.isArray(source.records)) {
    throw new OfflineAnswerQueueValidationError('Persisted offline answer queue records must be an array.');
  }
  const nextOrder = safePositiveInteger(source.nextEnqueueOrder, 'nextEnqueueOrder');
  return createOfflineAnswerQueueBatch(
    source.records as readonly OfflineAnswerQueueRecord[],
    nextOrder
  );
};

export const isOfflineAnswerQueueRecord = (value: unknown): value is OfflineAnswerQueueRecord => {
  try {
    createOfflineAnswerQueueRecord(value as OfflineAnswerQueueRecordInput);
    return true;
  } catch {
    return false;
  }
};

export const isOfflineAnswerQueueBatch = (value: unknown): value is OfflineAnswerQueueBatch => {
  try {
    parseOfflineAnswerQueueBatch(value);
    return true;
  } catch {
    return false;
  }
};
