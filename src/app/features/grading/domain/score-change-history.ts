/**
 * Pure score-change history operations: chronological append with duplicate
 * and out-of-order guards, evaluation counting, a newest-first re-evaluation
 * timeline view (persisted and optimistic), and the readable audit draft for
 * a persisted change. No Angular, RxJS, transport, or storage imports —
 * everything here is deterministic and side-effect free.
 */
import { SCORE_CHANGE_ERROR_CODES, ScoreChangeError, type ScoreChangeEntry } from '../models/score-change.models';
import type { AuditEventDraft } from '../../../core/observability/observability.ports';

export type ReEvaluationTimelineItem = Readonly<{
  readonly id: string;
  readonly occurredAt: string;
  readonly actorId: string;
  readonly previousPoints: number;
  readonly nextPoints: number;
  readonly delta: number;
  readonly reason: string;
  readonly evaluationNumber: number;
  /** `true` only for the optimistic, not-yet-persisted item `selectOptimisticTimeline` prepends. */
  readonly pending: boolean;
}>;

/** An in-flight score change applied optimistically before persistence confirms it. */
export type PendingScoreChange = Readonly<{
  readonly previousPoints: number;
  readonly nextPoints: number;
  readonly reason: string;
  readonly actorId: string;
}>;

const EMPTY_TIMELINE: readonly ReEvaluationTimelineItem[] = Object.freeze([]);

/**
 * Appends `entry` to `history` in chronological order, returning a new
 * frozen array. Rejects a repeated `id` and a timestamp strictly earlier
 * than the last entry's; equal timestamps are allowed.
 */
export const appendScoreChange = (
  history: readonly ScoreChangeEntry[],
  entry: ScoreChangeEntry
): readonly ScoreChangeEntry[] => {
  if (history.some((existing) => existing.id === entry.id)) {
    throw new ScoreChangeError(
      SCORE_CHANGE_ERROR_CODES.duplicateEntry,
      `A score-change entry with id "${entry.id}" already exists.`,
      'id'
    );
  }
  const last = history[history.length - 1];
  if (last !== undefined && Date.parse(entry.occurredAt) < Date.parse(last.occurredAt)) {
    throw new ScoreChangeError(
      SCORE_CHANGE_ERROR_CODES.outOfOrder,
      'A score-change entry cannot be recorded before the most recently recorded entry.',
      'occurredAt'
    );
  }
  return Object.freeze([...history, entry]);
};

/** An untouched attempt is its own first evaluation; each persisted change adds one more. */
export const deriveEvaluationCount = (history: readonly ScoreChangeEntry[]): number => history.length + 1;

/** Newest-first read view of the history; an empty history yields a shared frozen empty array. */
export const selectReEvaluationTimeline = (history: readonly ScoreChangeEntry[]): readonly ReEvaluationTimelineItem[] => {
  if (history.length === 0) return EMPTY_TIMELINE;
  return Object.freeze(
    [...history]
      .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
      .map((entry) =>
        Object.freeze({
          id: entry.id,
          occurredAt: entry.occurredAt,
          actorId: entry.actorId,
          previousPoints: entry.previousPoints,
          nextPoints: entry.nextPoints,
          delta: entry.delta,
          reason: entry.reason,
          evaluationNumber: entry.evaluationNumber,
          pending: false
        })
      )
  );
};

/** `deriveEvaluationCount`, plus one more evaluation while a change is pending but not yet persisted. */
export const deriveOptimisticEvaluationCount = (
  history: readonly ScoreChangeEntry[],
  pending: PendingScoreChange | null
): number => deriveEvaluationCount(history) + (pending === null ? 0 : 1);

/**
 * `selectReEvaluationTimeline` with the in-flight `pending` change prepended
 * as one extra, newest item (`id: 'pending'`, no `occurredAt`) when a change
 * is being applied optimistically. Returns the persisted timeline unchanged
 * when `pending` is `null`.
 */
export const selectOptimisticTimeline = (
  history: readonly ScoreChangeEntry[],
  pending: PendingScoreChange | null
): readonly ReEvaluationTimelineItem[] => {
  const persisted = selectReEvaluationTimeline(history);
  if (pending === null) return persisted;
  const pendingItem: ReEvaluationTimelineItem = Object.freeze({
    id: 'pending',
    occurredAt: '',
    actorId: pending.actorId,
    previousPoints: pending.previousPoints,
    nextPoints: pending.nextPoints,
    delta: pending.nextPoints - pending.previousPoints,
    reason: pending.reason,
    evaluationNumber: deriveEvaluationCount(history) + 1,
    pending: true
  });
  return Object.freeze([pendingItem, ...persisted]);
};

/**
 * Builds the single readable audit event for a persisted score change. The
 * exam id rides along as a readable field on `before`/`after`; the student
 * id is never included, so nothing leaks beyond `targetId` (the attempt id).
 */
export const buildScoreChangeAuditDraft = (
  entry: ScoreChangeEntry,
  target: Readonly<{ readonly attemptId: string; readonly studentId: string; readonly examId: string }>
): AuditEventDraft =>
  Object.freeze({
    action: 'grading.score-change',
    actor: entry.actorId,
    targetType: 'grading-attempt',
    targetId: entry.attemptId,
    occurredAt: entry.occurredAt,
    before: Object.freeze({ points: entry.previousPoints, examId: target.examId }),
    after: Object.freeze({ points: entry.nextPoints, examId: target.examId }),
    mandatoryReason: entry.reason
  });
