import { describe, expect, it } from 'vitest';

import {
  createExamSession,
  EXAM_SESSION_STATES,
  type ExamSessionCreateInput
} from './exam-session.models';
const input = (overrides: Partial<ExamSessionCreateInput> = {}): ExamSessionCreateInput => ({
  id: 'session-1',
  routeToken: 'opaque-route-token',
  studentId: 'student-1',
  examId: 'exam-1',
  state: 'created',
  version: 1,
  createdAt: '2026-08-05T10:00:00.000Z',
  startedAt: '2026-08-05T10:00:01.000Z',
  referenceTime: '2026-08-05T10:00:01.000Z',
  ...overrides
});

describe('ExamSession model', () => {
  it('exposes the required immutable identity and reference metadata', () => {
    const session = createExamSession(input());

    expect(session).toMatchObject({
      id: 'session-1',
      routeToken: 'opaque-route-token',
      studentId: 'student-1',
      examId: 'exam-1',
      state: 'created',
      version: 1,
      createdAt: '2026-08-05T10:00:00.000Z',
      startedAt: '2026-08-05T10:00:01.000Z',
      referenceTime: '2026-08-05T10:00:01.000Z'
    });
    expect(Object.isFrozen(session)).toBe(true);
  });

  it('defines exactly the lifecycle states', () => {
    expect(EXAM_SESSION_STATES).toEqual([
      'created',
      'active',
      'disconnected',
      'reconnecting',
      'submitted',
      'expired',
      'terminated'
    ]);
  });

  it.each([
    ['id', { id: '   ' }],
    ['routeToken', { routeToken: '   ' }],
    ['studentId', { studentId: '   ' }],
    ['examId', { examId: '   ' }],
    ['createdAt', { createdAt: '   ' }],
    ['startedAt', { startedAt: '   ' }],
    ['referenceTime', { referenceTime: '   ' }]
  ] as const)('rejects a blank %s', (_field, overrides) => {
    expect(() => createExamSession(input(overrides))).toThrowError();
  });

  it('rejects unsupported state and invalid version values', () => {
    expect(() => createExamSession(input({ state: 'paused' as never }))).toThrowError();
    expect(() => createExamSession(input({ version: 0 }))).toThrowError();
  });

  it('normalizes student and exam identifiers before freezing the session', () => {
    const session = createExamSession(input({
      studentId: '  student-1  ',
      examId: '  exam-1  '
    }));

    expect(session.studentId).toBe('student-1');
    expect(session.examId).toBe('exam-1');
  });
});
