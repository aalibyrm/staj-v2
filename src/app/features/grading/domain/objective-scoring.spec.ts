import { describe, expect, it } from 'vitest';

import type {
  QuestionAnswer,
  QuestionMatchingPair
} from '../../question-bank/models/question.models';
import {
  ObjectiveScoringDomainError,
  type ObjectiveResponse,
  type ObjectiveScoringRule
} from '../models/objective-scoring.models';
import { scoreObjectiveAnswer } from './objective-scoring';

const choiceAnswer = (optionIds: readonly string[] = ['a', 'b']): QuestionAnswer => ({
  kind: 'choice',
  optionIds
});

const booleanAnswer = (value: boolean): QuestionAnswer => ({
  kind: 'boolean',
  value
});

const matchingAnswer = (pairs: readonly QuestionMatchingPair[] = [
  { prompt: 'one', answer: '1' },
  { prompt: 'two', answer: '2' }
]): QuestionAnswer => ({
  kind: 'matching',
  pairs
});

const shortAnswer = (acceptedAnswers: readonly string[] = ['Paris']): QuestionAnswer => ({
  kind: 'short-answer',
  acceptedAnswers
});

const score = (
  answer: QuestionAnswer,
  response: ObjectiveResponse | null | undefined,
  rule: ObjectiveScoringRule = 'all-or-nothing',
  maximumPoints = 10
) => scoreObjectiveAnswer({ answer, response, rule, maximumPoints });

const expectDomainError = (operation: () => unknown, code: string): void => {
  let caught: unknown;
  try {
    operation();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ObjectiveScoringDomainError);
  expect(caught).toMatchObject({ code });
};

const invalidAnswer = (value: unknown): QuestionAnswer => value as QuestionAnswer;
const invalidResponse = (value: unknown): ObjectiveResponse => value as ObjectiveResponse;

describe('scoreObjectiveAnswer', () => {
  it('awards exact choice credit independent of order and submitted duplicates', () => {
    const result = score(
      choiceAnswer(['a', 'b']),
      { kind: 'choice', optionIds: ['b', 'a', 'a'] },
      'all-or-nothing',
      5
    );

    expect(result).toEqual({
      awardedPoints: 5,
      maximumPoints: 5,
      earnedFraction: 1,
      status: 'correct'
    });
  });

  it('applies proportional choice credit and clamps duplicate or indiscriminate selection', () => {
    const partial = score(
      choiceAnswer(['a', 'b', 'c']),
      { kind: 'choice', optionIds: ['c', 'c'] },
      'proportional',
      6
    );
    const clamped = score(
      choiceAnswer(['a']),
      { kind: 'choice', optionIds: ['a', 'wrong', 'wrong'] },
      'proportional',
      6
    );
    const upperClamped = score(
      choiceAnswer(['a', 'b']),
      { kind: 'choice', optionIds: ['a', 'b', 'b'] },
      'proportional',
      6
    );

    expect(partial).toEqual({
      awardedPoints: 2,
      maximumPoints: 6,
      earnedFraction: 1 / 3,
      status: 'partial'
    });
    expect(clamped).toEqual({
      awardedPoints: 0,
      maximumPoints: 6,
      earnedFraction: 0,
      status: 'incorrect'
    });
    expect(upperClamped).toEqual({
      awardedPoints: 6,
      maximumPoints: 6,
      earnedFraction: 1,
      status: 'correct'
    });
  });

  it('uses exact boolean scoring under both rules', () => {
    for (const rule of ['all-or-nothing', 'proportional'] as const) {
      expect(score(booleanAnswer(true), { kind: 'boolean', value: true }, rule, 2.5)).toEqual({
        awardedPoints: 2.5,
        maximumPoints: 2.5,
        earnedFraction: 1,
        status: 'correct'
      });
      expect(score(booleanAnswer(true), { kind: 'boolean', value: false }, rule, 2.5)).toEqual({
        awardedPoints: 0,
        maximumPoints: 2.5,
        earnedFraction: 0,
        status: 'incorrect'
      });
    }
  });

  it('matches every configured prompt exactly or proportionally independent of pair order', () => {
    const exact = score(
      matchingAnswer(),
      {
        kind: 'matching',
        pairs: [
          { prompt: 'two', answer: '2' },
          { prompt: 'one', answer: '1' }
        ]
      },
      'all-or-nothing',
      7.5
    );
    const partial = score(
      matchingAnswer(),
      {
        kind: 'matching',
        pairs: [
          { prompt: 'two', answer: 'wrong' },
          { prompt: 'one', answer: '1' }
        ]
      },
      'proportional',
      7.5
    );
    const extraPair = score(
      matchingAnswer(),
      {
        kind: 'matching',
        pairs: [
          { prompt: 'one', answer: '1' },
          { prompt: 'two', answer: '2' },
          { prompt: 'extra', answer: 'ignored for proportional counting' }
        ]
      },
      'all-or-nothing'
    );

    expect(exact).toEqual({
      awardedPoints: 7.5,
      maximumPoints: 7.5,
      earnedFraction: 1,
      status: 'correct'
    });
    expect(partial).toEqual({
      awardedPoints: 3.75,
      maximumPoints: 7.5,
      earnedFraction: 0.5,
      status: 'partial'
    });
    expect(extraPair).toEqual({
      awardedPoints: 0,
      maximumPoints: 10,
      earnedFraction: 0,
      status: 'incorrect'
    });
  });

  it('uses trimmed locale-insensitive lowercase short-answer matching under both rules', () => {
    for (const rule of ['all-or-nothing', 'proportional'] as const) {
      expect(score(shortAnswer(['Paris', 'Lyon']), { kind: 'short-answer', value: '  pArIs  ' }, rule, 3.25))
        .toEqual({
          awardedPoints: 3.25,
          maximumPoints: 3.25,
          earnedFraction: 1,
          status: 'correct'
        });
      expect(score(shortAnswer(['Paris']), { kind: 'short-answer', value: 'London' }, rule, 3.25))
        .toEqual({
          awardedPoints: 0,
          maximumPoints: 3.25,
          earnedFraction: 0,
          status: 'incorrect'
        });
    }
  });

  it('returns an immutable unanswered result for null and explicit unanswered responses', () => {
    const answer = choiceAnswer(['a']);
    const nullResult = score(answer, null, 'proportional', 2.5);
    const explicitResult = score(answer, { kind: 'unanswered' }, 'all-or-nothing', 2.5);

    expect(nullResult).toEqual({
      awardedPoints: 0,
      maximumPoints: 2.5,
      earnedFraction: 0,
      status: 'unanswered'
    });
    expect(explicitResult).toEqual(nullResult);
    expect(Object.isFrozen(nullResult)).toBe(true);
  });

  it('does not mutate configured answers or responses and freezes each result', () => {
    const optionIds = ['a', 'b', 'a'];
    const answer = choiceAnswer(['a', 'b']);
    const response = { kind: 'choice' as const, optionIds };
    const answerBefore = JSON.stringify(answer);
    const responseBefore = JSON.stringify(response);

    const result = score(answer, response, 'proportional');

    expect(JSON.stringify(answer)).toBe(answerBefore);
    expect(JSON.stringify(response)).toBe(responseBefore);
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.awardedPoints).toBe(10);
  });

  it('rejects invalid maximum points and scoring rules with stable domain codes', () => {
    for (const maximumPoints of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expectDomainError(
        () => scoreObjectiveAnswer({
          answer: choiceAnswer(['a']),
          response: { kind: 'choice', optionIds: ['a'] },
          maximumPoints,
          rule: 'all-or-nothing'
        }),
        'invalid-maximum-points'
      );
    }
    expectDomainError(
      () => scoreObjectiveAnswer({
        answer: choiceAnswer(['a']),
        response: { kind: 'choice', optionIds: ['a'] },
        maximumPoints: 1,
        rule: 'unknown' as ObjectiveScoringRule
      }),
      'invalid-rule'
    );
  });

  it('rejects empty, duplicate, and malformed configured answers', () => {
    const cases: readonly [unknown, string][] = [
      [{ kind: 'choice', optionIds: [] }, 'empty-configured-answer'],
      [{ kind: 'choice', optionIds: ['a', 'a'] }, 'duplicate-configured-answer'],
      [{ kind: 'choice', optionIds: [''] }, 'malformed-configured-answer'],
      [{ kind: 'boolean', value: 'true' }, 'malformed-configured-answer'],
      [{ kind: 'matching', pairs: [] }, 'empty-configured-answer'],
      [{ kind: 'matching', pairs: [{ prompt: 'one', answer: '1' }, { prompt: 'one', answer: '2' }] }, 'duplicate-configured-answer'],
      [{ kind: 'matching', pairs: [{ prompt: 'one', answer: '' }] }, 'malformed-configured-answer'],
      [{ kind: 'short-answer', acceptedAnswers: [] }, 'empty-configured-answer'],
      [{ kind: 'short-answer', acceptedAnswers: ['Paris', ' paris '] }, 'duplicate-configured-answer'],
      [{ kind: 'short-answer', acceptedAnswers: [42] }, 'malformed-configured-answer'],
      [{ kind: 'unknown' }, 'malformed-configured-answer']
    ];

    for (const [answer, code] of cases) {
      expectDomainError(
        () => scoreObjectiveAnswer({
          answer: invalidAnswer(answer),
          response: null,
          maximumPoints: 1,
          rule: 'all-or-nothing'
        }),
        code
      );
    }
  });

  it('rejects response-kind mismatches and malformed submitted values or pairs', () => {
    expectDomainError(
      () => score(choiceAnswer(['a']), { kind: 'boolean', value: true }),
      'response-kind-mismatch'
    );
    expectDomainError(
      () => score(choiceAnswer(['a']), invalidResponse({ kind: 'choice', optionIds: ['a', 3] })),
      'malformed-response'
    );
    expectDomainError(
      () => score(booleanAnswer(true), invalidResponse({ kind: 'boolean', value: 'true' })),
      'malformed-response'
    );
    expectDomainError(
      () => score(matchingAnswer(), invalidResponse({ kind: 'matching', pairs: [{ prompt: 'one', answer: '' }] })),
      'malformed-response'
    );
    expectDomainError(
      () => score(matchingAnswer(), invalidResponse({
        kind: 'matching',
        pairs: [{ prompt: 'one', answer: '1' }, { prompt: 'one', answer: '1' }]
      })),
      'malformed-response'
    );
    expectDomainError(
      () => score(shortAnswer(), invalidResponse({ kind: 'short-answer', value: 42 })),
      'malformed-response'
    );
    expectDomainError(
      () => score(choiceAnswer(['a']), invalidResponse({ kind: 'not-object' })),
      'malformed-response'
    );
  });

  it('rejects essay answers that require manual grading', () => {
    expectDomainError(
      () => scoreObjectiveAnswer({
        answer: { kind: 'essay', rubricHint: 'Explain.' },
        response: null,
        maximumPoints: 4,
        rule: 'all-or-nothing'
      }),
      'manual-grading-required'
    );
  });
});
