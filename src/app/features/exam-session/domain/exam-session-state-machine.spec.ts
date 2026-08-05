import { describe, expect, it } from 'vitest';

import {
  EXAM_SESSION_STATES,
  createExamSession,
  type ExamSession,
  type ExamSessionState
} from '../models/exam-session.models';
import {
  canTransitionExamSession,
  EXAM_SESSION_TRANSITIONS,
  transitionExamSession,
  ExamSessionStateMachineError
} from './exam-session-state-machine';

const sessionAt = (state: ExamSessionState): ExamSession => createExamSession({
  id: 'session-1',
  routeToken: 'opaque-token',
  studentId: 'student-1',
  examId: 'exam-1',
  state,
  version: 1,
  createdAt: '2026-08-05T10:00:00.000Z',
  startedAt: '2026-08-05T10:00:00.000Z',
  referenceTime: '2026-08-05T10:00:00.000Z',
  durationMs: 90_000
});

const allowedTransitions = EXAM_SESSION_STATES.flatMap((from) =>
  EXAM_SESSION_TRANSITIONS[from].map((to) => [from, to] as const)
);

const invalidTransitions = EXAM_SESSION_STATES.flatMap((from) =>
  EXAM_SESSION_STATES
    .filter((to) => to !== from && !EXAM_SESSION_TRANSITIONS[from].includes(to))
    .map((to) => [from, to] as const)
);

describe('exam-session state machine', () => {
  it.each(allowedTransitions)('allows %s -> %s', (from, to) => {
    expect(canTransitionExamSession(from, to)).toBe(true);
    const current = sessionAt(from);
    const next = transitionExamSession(current, to);
    expect(next.state).toBe(to);
    expect(next.version).toBe(current.version + 1);
    expect(next.durationMs).toBe(current.durationMs);
    expect(current.state).toBe(from);
  });

  it.each(invalidTransitions)('rejects %s -> %s', (from, to) => {
    expect(canTransitionExamSession(from, to)).toBe(false);
    expect(() => transitionExamSession(sessionAt(from), to)).toThrowError(ExamSessionStateMachineError);
    expect(() => transitionExamSession(sessionAt(from), to)).toThrowError(
      expect.objectContaining({ code: 'invalid-transition' })
    );
  });

  it.each(EXAM_SESSION_STATES)('allows same-state %s requests as no-ops', (state) => {
    const current = sessionAt(state);
    const before = { ...current };
    expect(canTransitionExamSession(state, state)).toBe(true);
    const next = transitionExamSession(current, state);
    expect(next).toBe(current);
    expect(next.state).toBe(before.state);
    expect(next.version).toBe(before.version);
    expect(next.durationMs).toBe(before.durationMs);
    expect(current).toEqual(before);
  });

  it.each(['submitted', 'expired', 'terminated'] as const)('rejects every outgoing transition from terminal %s', (state) => {
    for (const nextState of EXAM_SESSION_STATES) {
      if (nextState === state) continue;
      expect(() => transitionExamSession(sessionAt(state), nextState)).toThrowError(
        expect.objectContaining({ code: 'invalid-transition' })
      );
    }
  });
});
