import { describe, expect, it } from 'vitest';

import {
  COHORT_PRIVACY_MINIMUM,
  selectCohortPrivacy,
  type CohortPrivacyResult
} from './cohort-privacy';

type Row = Readonly<{
  readonly studentId: string;
  readonly pseudonym: string;
  readonly score: number;
  readonly rank: number;
}>;

const rows = (count: number): readonly Row[] =>
  Array.from({ length: count }, (_, index) => ({
    studentId: `student-${index + 1}`,
    pseudonym: `Learner ${index + 1}`,
    score: index / Math.max(1, count),
    rank: index + 1
  }));

const statusOf = (result: CohortPrivacyResult<Row>): 'blocked' | 'allowed' => result.status;

describe('selectCohortPrivacy', () => {
  it('exports the positive default minimum', () => {
    expect(COHORT_PRIVACY_MINIMUM).toBe(5);
  });

  it('blocks four rows and exposes no copied individual detail', () => {
    const result = selectCohortPrivacy(rows(4));

    expect(statusOf(result)).toBe('blocked');
    expect(result.rows).toEqual([]);
    expect(result.rows.length).toBe(0);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.rows)).toBe(true);
  });

  it('allows exactly five rows and copies every row in deterministic order', () => {
    const input = rows(5);
    const result = selectCohortPrivacy(input);

    expect(statusOf(result)).toBe('allowed');
    expect(result.rows).toEqual(input);
    expect(result.rows).not.toBe(input);
    expect(result.rows.map((row) => row.studentId)).toEqual([
      'student-1',
      'student-2',
      'student-3',
      'student-4',
      'student-5'
    ]);
    expect(Object.isFrozen(result.rows)).toBe(true);
    expect(Object.isFrozen(result.rows[0])).toBe(true);
  });

  it('produces repeatable frozen output for an unchanged input', () => {
    const input = rows(6);
    const first = selectCohortPrivacy(input);
    const second = selectCohortPrivacy(input);

    expect(first).toEqual(second);
    expect(first.rows).not.toBe(second.rows);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(second)).toBe(true);
  });

  it('rejects a non-positive or non-integer configured minimum', () => {
    for (const minimum of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => selectCohortPrivacy(rows(5), minimum)).toThrow(
        'Cohort privacy minimum must be a positive integer.'
      );
    }
  });

  it('does not mutate the input rows or their order', () => {
    const input = rows(5).map((row) => ({ ...row }));
    const before = JSON.stringify(input);

    selectCohortPrivacy(input);

    expect(JSON.stringify(input)).toBe(before);
    expect(input.map((row) => row.studentId)).toEqual([
      'student-1',
      'student-2',
      'student-3',
      'student-4',
      'student-5'
    ]);
  });
});
