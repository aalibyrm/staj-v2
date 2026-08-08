export const COHORT_PRIVACY_MINIMUM = 5;

export type CohortPrivacyStatus = 'blocked' | 'allowed';

export type CohortPrivacyResult<T extends object> =
  | Readonly<{
      readonly status: 'blocked';
      readonly rows: readonly [];
    }>
  | Readonly<{
      readonly status: 'allowed';
      readonly rows: readonly T[];
    }>;

const EMPTY_ROWS: readonly [] = Object.freeze([]);

const assertMinimum = (minimum: number): void => {
  if (typeof minimum !== 'number' || !Number.isInteger(minimum) || minimum <= 0) {
    throw new TypeError('Cohort privacy minimum must be a positive integer.');
  }
};

/**
 * Applies the cohort disclosure boundary without changing the source collection.
 * A blocked result never copies an individual row; an allowed result copies and freezes
 * every row in deterministic source order.
 */
export function selectCohortPrivacy<T extends object>(
  rows: readonly T[],
  minimum = COHORT_PRIVACY_MINIMUM
): CohortPrivacyResult<T> {
  assertMinimum(minimum);
  if (!Array.isArray(rows)) {
    throw new TypeError('Cohort privacy rows must be an array.');
  }

  if (rows.length < minimum) {
    return Object.freeze({ status: 'blocked' as const, rows: EMPTY_ROWS });
  }

  const copiedRows = Object.freeze(
    rows.map((row) => {
      if (row === null || typeof row !== 'object') {
        throw new TypeError('Cohort privacy rows must contain objects.');
      }
      return Object.freeze({ ...row }) as T;
    })
  );
  return Object.freeze({ status: 'allowed' as const, rows: copiedRows });
}

export const applyCohortPrivacy = selectCohortPrivacy;
export const selectCohortPrivacyRows = selectCohortPrivacy;

export default COHORT_PRIVACY_MINIMUM;
