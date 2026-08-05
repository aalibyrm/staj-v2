import {
  OBJECTIVE_SCORING_ERROR_CODES,
  OBJECTIVE_SCORING_RULES,
  ObjectiveScoringDomainError,
  type ObjectiveResponse,
  type ObjectiveScoringInput,
  type ObjectiveScoringResult,
  type ObjectiveScoringRule,
  type ObjectiveScoringStatus
} from '../models/objective-scoring.models';

type PreparedObjectiveAnswer =
  | Readonly<{
      readonly kind: 'choice';
      readonly correctOptionIds: ReadonlySet<string>;
    }>
  | Readonly<{
      readonly kind: 'boolean';
      readonly value: boolean;
    }>
  | Readonly<{
      readonly kind: 'matching';
      readonly configuredPairs: ReadonlyMap<string, string>;
    }>
  | Readonly<{
      readonly kind: 'short-answer';
      readonly acceptedAnswers: ReadonlySet<string>;
    }>;

type ObjectiveResponseKind = ObjectiveResponse['kind'];

const OBJECTIVE_RESPONSE_KINDS = Object.freeze([
  'choice',
  'boolean',
  'matching',
  'short-answer',
  'unanswered'
] as const);


const isNonblankString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isObjectiveResponseKind = (value: unknown): value is ObjectiveResponseKind =>
  (OBJECTIVE_RESPONSE_KINDS as readonly string[]).includes(value as string);

const fail = (
  code: ObjectiveScoringDomainError['code'],
  message: string,
  target?: string
): never => {
  throw new ObjectiveScoringDomainError(code, message, target);
};

const validateMaximumPoints = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fail(
      OBJECTIVE_SCORING_ERROR_CODES.invalidMaximumPoints,
      'maximumPoints must be a finite positive number.',
      'maximumPoints'
    );
  }
  return value;
};

const validateRule = (value: unknown): ObjectiveScoringRule => {
  if (!(OBJECTIVE_SCORING_RULES as readonly string[]).includes(value as string)) {
    return fail(
      OBJECTIVE_SCORING_ERROR_CODES.invalidRule,
      'rule must be all-or-nothing or proportional.',
      'rule'
    );
  }
  return value as ObjectiveScoringRule;
};

const normalizeShortAnswer = (value: string): string => value.trim().toLowerCase();

const prepareConfiguredAnswer = (answer: unknown): PreparedObjectiveAnswer => {
  if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) {
    return fail(
      OBJECTIVE_SCORING_ERROR_CODES.malformedConfiguredAnswer,
      'Configured answer must be a supported objective answer.',
      'answer'
    );
  }
  const configuredAnswer = answer as Record<string, unknown>;
  if (typeof configuredAnswer['kind'] !== 'string') {
    return fail(
      OBJECTIVE_SCORING_ERROR_CODES.malformedConfiguredAnswer,
      'Configured answer must be a supported objective answer.',
      'answer'
    );
  }

  switch (configuredAnswer['kind']) {
    case 'choice': {
      const optionIds = configuredAnswer['optionIds'];
      if (!Array.isArray(optionIds)) {
        return fail(
          OBJECTIVE_SCORING_ERROR_CODES.malformedConfiguredAnswer,
          'Configured choice answer optionIds must be an array of nonblank strings.',
          'answer.optionIds'
        );
      }
      if (optionIds.length === 0) {
        return fail(
          OBJECTIVE_SCORING_ERROR_CODES.emptyConfiguredAnswer,
          'Configured choice answer must contain at least one correct option.',
          'answer.optionIds'
        );
      }
      const correctOptionIds = new Set<string>();
      for (const optionId of optionIds) {
        if (!isNonblankString(optionId)) {
          return fail(
            OBJECTIVE_SCORING_ERROR_CODES.malformedConfiguredAnswer,
            'Configured choice option IDs must be nonblank strings.',
            'answer.optionIds'
          );
        }
        if (correctOptionIds.has(optionId)) {
          return fail(
            OBJECTIVE_SCORING_ERROR_CODES.duplicateConfiguredAnswer,
            'Configured choice answer cannot contain duplicate option IDs.',
            'answer.optionIds'
          );
        }
        correctOptionIds.add(optionId);
      }
      return { kind: 'choice', correctOptionIds };
    }

    case 'boolean':
      if (typeof configuredAnswer['value'] !== 'boolean') {
        return fail(
          OBJECTIVE_SCORING_ERROR_CODES.malformedConfiguredAnswer,
          'Configured boolean answer value must be a boolean.',
          'answer.value'
        );
      }
      return { kind: 'boolean', value: configuredAnswer['value'] };

    case 'matching': {
      const pairs = configuredAnswer['pairs'];
      if (!Array.isArray(pairs)) {
        return fail(
          OBJECTIVE_SCORING_ERROR_CODES.malformedConfiguredAnswer,
          'Configured matching answer pairs must be an array.',
          'answer.pairs'
        );
      }
      if (pairs.length === 0) {
        return fail(
          OBJECTIVE_SCORING_ERROR_CODES.emptyConfiguredAnswer,
          'Configured matching answer must contain at least one pair.',
          'answer.pairs'
        );
      }
      const configuredPairs = new Map<string, string>();
      for (const pair of pairs) {
        if (pair === null || typeof pair !== 'object' || Array.isArray(pair)) {
          return fail(
            OBJECTIVE_SCORING_ERROR_CODES.malformedConfiguredAnswer,
            'Configured matching pairs require nonblank prompt and answer strings.',
            'answer.pairs'
          );
        }
        const configuredPair = pair as Record<string, unknown>;
        if (!isNonblankString(configuredPair['prompt']) || !isNonblankString(configuredPair['answer'])) {
          return fail(
            OBJECTIVE_SCORING_ERROR_CODES.malformedConfiguredAnswer,
            'Configured matching pairs require nonblank prompt and answer strings.',
            'answer.pairs'
          );
        }
        if (configuredPairs.has(configuredPair['prompt'])) {
          return fail(
            OBJECTIVE_SCORING_ERROR_CODES.duplicateConfiguredAnswer,
            'Configured matching answer cannot contain duplicate prompts.',
            'answer.pairs'
          );
        }
        configuredPairs.set(configuredPair['prompt'], configuredPair['answer']);
      }
      return { kind: 'matching', configuredPairs };
    }

    case 'short-answer': {
      const acceptedAnswers = configuredAnswer['acceptedAnswers'];
      if (!Array.isArray(acceptedAnswers)) {
        return fail(
          OBJECTIVE_SCORING_ERROR_CODES.malformedConfiguredAnswer,
          'Configured short-answer acceptedAnswers must be an array of strings.',
          'answer.acceptedAnswers'
        );
      }
      if (acceptedAnswers.length === 0) {
        return fail(
          OBJECTIVE_SCORING_ERROR_CODES.emptyConfiguredAnswer,
          'Configured short-answer answer must contain at least one accepted form.',
          'answer.acceptedAnswers'
        );
      }
      const normalizedAcceptedAnswers = new Set<string>();
      for (const acceptedAnswer of acceptedAnswers) {
        if (!isNonblankString(acceptedAnswer)) {
          return fail(
            OBJECTIVE_SCORING_ERROR_CODES.malformedConfiguredAnswer,
            'Configured short-answer forms must be nonblank strings.',
            'answer.acceptedAnswers'
          );
        }
        const normalized = normalizeShortAnswer(acceptedAnswer);
        if (normalizedAcceptedAnswers.has(normalized)) {
          return fail(
            OBJECTIVE_SCORING_ERROR_CODES.duplicateConfiguredAnswer,
            'Configured short-answer forms cannot duplicate after normalization.',
            'answer.acceptedAnswers'
          );
        }
        normalizedAcceptedAnswers.add(normalized);
      }
      return { kind: 'short-answer', acceptedAnswers: normalizedAcceptedAnswers };
    }

    case 'essay':
      return fail(
        OBJECTIVE_SCORING_ERROR_CODES.manualGradingRequired,
        'Essay answers require manual grading.',
        'answer.kind'
      );

    default:
      return fail(
        OBJECTIVE_SCORING_ERROR_CODES.malformedConfiguredAnswer,
        'Configured answer kind is not supported for objective scoring.',
        'answer.kind'
      );
  }
};

const clampFraction = (value: number): number => {
  if (!Number.isFinite(value)) return value === Number.POSITIVE_INFINITY ? 1 : 0;
  return Math.min(1, Math.max(0, value));
};

const statusForFraction = (fraction: number): ObjectiveScoringStatus => {
  if (fraction === 1) return 'correct';
  if (fraction > 0) return 'partial';
  return 'incorrect';
};

const resultForFraction = (
  maximumPoints: number,
  rawFraction: number,
  statusOverride?: ObjectiveScoringStatus
): ObjectiveScoringResult => {
  const earnedFraction = clampFraction(rawFraction);
  const awardedPoints = Math.min(maximumPoints, Math.max(0, maximumPoints * earnedFraction));
  return Object.freeze({
    awardedPoints,
    maximumPoints,
    earnedFraction,
    status: statusOverride ?? statusForFraction(earnedFraction)
  });
};

const malformedResponse = (message: string, target = 'response'): never =>
  fail(OBJECTIVE_SCORING_ERROR_CODES.malformedResponse, message, target);

const validateChoiceResponse = (response: Record<string, unknown>): ReadonlySet<string> => {
  if (!Array.isArray(response['optionIds'])) {
    return malformedResponse('Submitted choice optionIds must be an array of nonblank strings.', 'response.optionIds');
  }
  const selectedOptionIds = new Set<string>();
  for (const optionId of response['optionIds']) {
    if (!isNonblankString(optionId)) {
      return malformedResponse('Submitted choice option IDs must be nonblank strings.', 'response.optionIds');
    }
    selectedOptionIds.add(optionId);
  }
  return selectedOptionIds;
};

const validateMatchingResponse = (response: Record<string, unknown>): ReadonlyMap<string, string> => {
  if (!Array.isArray(response['pairs'])) {
    return malformedResponse('Submitted matching pairs must be an array.', 'response.pairs');
  }
  const submittedPairs = new Map<string, string>();
  for (const pair of response['pairs']) {
    if (pair === null || typeof pair !== 'object' || Array.isArray(pair)) {
      return malformedResponse(
        'Submitted matching pairs require nonblank prompt and answer strings.',
        'response.pairs'
      );
    }
    const submittedPair = pair as Record<string, unknown>;
    if (!isNonblankString(submittedPair['prompt']) || !isNonblankString(submittedPair['answer'])) {
      return malformedResponse(
        'Submitted matching pairs require nonblank prompt and answer strings.',
        'response.pairs'
      );
    }
    if (submittedPairs.has(submittedPair['prompt'])) {
      return malformedResponse('Submitted matching pairs cannot repeat a prompt.', 'response.pairs');
    }
    submittedPairs.set(submittedPair['prompt'], submittedPair['answer']);
  }
  return submittedPairs;
};

const scoreChoice = (
  answer: Extract<PreparedObjectiveAnswer, { readonly kind: 'choice' }>,
  response: Record<string, unknown>,
  rule: ObjectiveScoringRule,
  maximumPoints: number
): ObjectiveScoringResult => {
  const selectedOptionIds = validateChoiceResponse(response);
  if (rule === 'all-or-nothing') {
    const exact = selectedOptionIds.size === answer.correctOptionIds.size &&
      [...selectedOptionIds].every((optionId) => answer.correctOptionIds.has(optionId));
    return resultForFraction(maximumPoints, exact ? 1 : 0);
  }

  let correctSelected = 0;
  let incorrectSelected = 0;
  for (const optionId of selectedOptionIds) {
    if (answer.correctOptionIds.has(optionId)) correctSelected += 1;
    else incorrectSelected += 1;
  }
  const rawFraction = (correctSelected - incorrectSelected) / answer.correctOptionIds.size;
  return resultForFraction(maximumPoints, rawFraction);
};

const scoreBoolean = (
  answer: Extract<PreparedObjectiveAnswer, { readonly kind: 'boolean' }>,
  response: Record<string, unknown>,
  maximumPoints: number
): ObjectiveScoringResult => {
  if (typeof response['value'] !== 'boolean') {
    return malformedResponse('Submitted boolean value must be a boolean.', 'response.value');
  }
  return resultForFraction(maximumPoints, response['value'] === answer.value ? 1 : 0);
};

const scoreMatching = (
  answer: Extract<PreparedObjectiveAnswer, { readonly kind: 'matching' }>,
  response: Record<string, unknown>,
  rule: ObjectiveScoringRule,
  maximumPoints: number
): ObjectiveScoringResult => {
  const submittedPairs = validateMatchingResponse(response);
  let correctlyMatched = 0;
  for (const [prompt, configuredAnswer] of answer.configuredPairs) {
    if (submittedPairs.get(prompt) === configuredAnswer) correctlyMatched += 1;
  }
  if (rule === 'all-or-nothing') {
    const exact = submittedPairs.size === answer.configuredPairs.size &&
      correctlyMatched === answer.configuredPairs.size;
    return resultForFraction(maximumPoints, exact ? 1 : 0);
  }
  return resultForFraction(maximumPoints, correctlyMatched / answer.configuredPairs.size);
};

const scoreShortAnswer = (
  answer: Extract<PreparedObjectiveAnswer, { readonly kind: 'short-answer' }>,
  response: Record<string, unknown>,
  maximumPoints: number
): ObjectiveScoringResult => {
  if (!isNonblankString(response['value'])) {
    return malformedResponse('Submitted short-answer value must be a nonblank string.', 'response.value');
  }
  return resultForFraction(
    maximumPoints,
    answer.acceptedAnswers.has(normalizeShortAnswer(response['value'])) ? 1 : 0
  );
};

/** Scores one objective response without mutating the configured answer or submitted response. */
export const scoreObjectiveAnswer = (input: ObjectiveScoringInput): ObjectiveScoringResult => {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return fail(
      OBJECTIVE_SCORING_ERROR_CODES.malformedInput,
      'Objective scoring input must be an object.',
      'input'
    );
  }
  const scoringInput = input as Record<string, unknown>;
  const maximumPoints = validateMaximumPoints(scoringInput['maximumPoints']);
  const rule = validateRule(scoringInput['rule']);
  const answer = prepareConfiguredAnswer(scoringInput['answer']);
  const response = scoringInput['response'];

  if (response === null || response === undefined) {
    return resultForFraction(maximumPoints, 0, 'unanswered');
  }
  if (typeof response !== 'object' || Array.isArray(response)) {
    return malformedResponse('Submitted response must be an object or null.');
  }
  const submittedResponse = response as Record<string, unknown>;
  if (submittedResponse['kind'] === 'unanswered') {
    return resultForFraction(maximumPoints, 0, 'unanswered');
  }
  if (!isObjectiveResponseKind(submittedResponse['kind'])) {
    return malformedResponse('Submitted response kind is not supported.', 'response.kind');
  }
  if (submittedResponse['kind'] !== answer.kind) {
    return fail(
      OBJECTIVE_SCORING_ERROR_CODES.responseKindMismatch,
      `Submitted response kind ${submittedResponse['kind']} does not match configured answer kind ${answer.kind}.`,
      'response.kind'
    );
  }

  switch (answer.kind) {
    case 'choice':
      return scoreChoice(answer, submittedResponse, rule, maximumPoints);
    case 'boolean':
      return scoreBoolean(answer, submittedResponse, maximumPoints);
    case 'matching':
      return scoreMatching(answer, submittedResponse, rule, maximumPoints);
    case 'short-answer':
      return scoreShortAnswer(answer, submittedResponse, maximumPoints);
  }
};
