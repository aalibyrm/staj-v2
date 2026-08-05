import { ExamSessionDomainError } from '../models/exam-session.models';

export type ReferenceTimeEpochInput = number | string;

export type ReferenceTimeSyncAnchor = Readonly<{
  readonly referenceEpochMs: number;
  readonly monotonicObservedMs: number;
}>;

export type ReferenceTimeTimerSnapshot = Readonly<{
  readonly deadlineMs: number;
  readonly remainingMs: number;
  readonly warning: boolean;
  readonly expired: boolean;
}>;

export type ReferenceTimeTimerSelectionInput = Readonly<{
  readonly anchor: ReferenceTimeSyncAnchor;
  readonly monotonicNowMs: number;
  readonly sessionStartReferenceTime: ReferenceTimeEpochInput;
  readonly durationMs: number;
  readonly warningThresholdMs: number;
}>;

export class ReferenceTimeTimerDomainError extends ExamSessionDomainError {
  override readonly name: string = 'ReferenceTimeTimerDomainError';

  constructor(message: string, target?: string) {
    super('validation', message, target);
  }
}

const validationError = (message: string, target?: string): never => {
  throw new ReferenceTimeTimerDomainError(message, target);
};

const validateEpochMs = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return validationError(`${field} must be a nonnegative safe epoch-millisecond integer.`, field);
  }
  return value;
};

const validateMonotonicMs = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    return validationError(`${field} must be a finite nonnegative safe monotonic value.`, field);
  }
  return value;
};

const validateDurationMs = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    return validationError('durationMs must be a positive safe integer in milliseconds.', 'durationMs');
  }
  return value;
};

const validateWarningThresholdMs = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return validationError('warningThresholdMs must be a nonnegative safe integer in milliseconds.', 'warningThresholdMs');
  }
  return value;
};

const parseEpochMs = (value: ReferenceTimeEpochInput, field: string): number => {
  if (typeof value === 'number') return validateEpochMs(value, field);
  if (typeof value !== 'string' || value.trim().length === 0) {
    return validationError(`${field} must be an epoch-millisecond number or a valid timestamp string.`, field);
  }
  const normalized = value.trim();
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) {
    return validationError(`${field} must include an explicit timezone.`, field);
  }
  const parsed = Date.parse(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return validationError(`${field} must be a valid nonnegative timestamp.`, field);
  }
  return parsed;
};

const assertAnchor = (anchor: ReferenceTimeSyncAnchor): ReferenceTimeSyncAnchor => {
  if (anchor === null || typeof anchor !== 'object' || Array.isArray(anchor)) {
    return validationError('anchor must be a synchronization anchor.', 'anchor');
  }
  const source = anchor as ReferenceTimeSyncAnchor;
  validateEpochMs(source.referenceEpochMs, 'anchor.referenceEpochMs');
  validateMonotonicMs(source.monotonicObservedMs, 'anchor.monotonicObservedMs');
  return anchor;
};

export const createReferenceTimeAnchor = (
  referenceEpochMs: number,
  monotonicObservedMs: number
): ReferenceTimeSyncAnchor => Object.freeze({
  referenceEpochMs: validateEpochMs(referenceEpochMs, 'referenceEpochMs'),
  monotonicObservedMs: validateMonotonicMs(monotonicObservedMs, 'monotonicObservedMs')
});

export const deriveCurrentReferenceTime = (
  anchor: ReferenceTimeSyncAnchor,
  monotonicNowMs: number
): number => {
  const validatedAnchor = assertAnchor(anchor);
  const now = validateMonotonicMs(monotonicNowMs, 'monotonicNowMs');
  if (now < validatedAnchor.monotonicObservedMs) {
    return validationError('monotonicNowMs cannot regress below the synchronization observation.', 'monotonicNowMs');
  }
  const current = validatedAnchor.referenceEpochMs + (now - validatedAnchor.monotonicObservedMs);
  if (!Number.isFinite(current) || current < 0 || current > Number.MAX_SAFE_INTEGER) {
    return validationError('derived reference time must remain finite and safe.', 'monotonicNowMs');
  }
  return current;
};

export const computeReferenceTimeDeadline = (
  sessionStartReferenceTime: ReferenceTimeEpochInput,
  durationMs: number
): number => {
  const startMs = parseEpochMs(sessionStartReferenceTime, 'sessionStartReferenceTime');
  const duration = validateDurationMs(durationMs);
  const deadlineMs = startMs + duration;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 0) {
    return validationError('deadline must remain a nonnegative safe epoch-millisecond integer.', 'durationMs');
  }
  return deadlineMs;
};

export const selectReferenceTimeTimer = (
  input: ReferenceTimeTimerSelectionInput
): ReferenceTimeTimerSnapshot => {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return validationError('timer selection input must be an object.');
  }
  const source = input as ReferenceTimeTimerSelectionInput & { readonly wallClockMs?: unknown };
  if (source.wallClockMs !== undefined) {
    return validationError('device wall-clock readings are not accepted by the timer selector.', 'wallClockMs');
  }
  const deadlineMs = computeReferenceTimeDeadline(source.sessionStartReferenceTime, source.durationMs);
  const currentReferenceTimeMs = deriveCurrentReferenceTime(source.anchor, source.monotonicNowMs);
  const warningThresholdMs = validateWarningThresholdMs(source.warningThresholdMs);
  const remainingMs = Math.max(0, deadlineMs - currentReferenceTimeMs);
  return Object.freeze({
    deadlineMs,
    remainingMs,
    warning: remainingMs <= warningThresholdMs,
    expired: currentReferenceTimeMs >= deadlineMs
  });
};

