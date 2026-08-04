export const TRANSPORT_ERROR_STATUS = {
  service: 503,
  unauthorized: 401,
  conflict: 409,
  unexpected: 500
} as const;

export type TransportErrorKind = keyof typeof TRANSPORT_ERROR_STATUS;
export type ApplicationErrorKind = TransportErrorKind;

export interface TransportError {
  readonly kind: TransportErrorKind;
  readonly status: number;
  readonly attempt: number;
}

const TRANSPORT_ERROR_MESSAGES: Record<TransportErrorKind, string> = {
  service: 'Mock transport service failure',
  unauthorized: 'Mock transport unauthorized failure',
  conflict: 'Mock transport conflict failure',
  unexpected: 'Mock transport unexpected failure'
};

export class ApiTransportError extends Error implements TransportError {
  override readonly name = 'ApiTransportError';
  readonly status: number;

  constructor(
    readonly kind: TransportErrorKind,
    readonly attempt: number
  ) {
    super(TRANSPORT_ERROR_MESSAGES[kind]);
    this.status = TRANSPORT_ERROR_STATUS[kind];
  }
}

export interface ApplicationError {
  readonly kind: ApplicationErrorKind;
  readonly status: number;
  readonly attempt: number;
  readonly retryable: boolean;
  readonly userMessage: string;
}

const APPLICATION_ERROR_MESSAGES: Record<TransportErrorKind, string> = {
  service: 'The service is temporarily unavailable.',
  unauthorized: 'You are not authorized to perform this action.',
  conflict: 'This change conflicts with a newer version.',
  unexpected: 'Something unexpected happened.'
};

const isTransportErrorKind = (value: unknown): value is TransportErrorKind =>
  typeof value === 'string' && Object.hasOwn(TRANSPORT_ERROR_STATUS, value);

export function normalizeApplicationError(value: unknown): ApplicationError {
  let candidateKind: unknown;
  let candidateAttempt: unknown;

  if (typeof value === 'object' && value !== null) {
    if ('kind' in value) {
      candidateKind = value.kind;
    }
    if ('attempt' in value) {
      candidateAttempt = value.attempt;
    }
  }

  const kind = isTransportErrorKind(candidateKind) ? candidateKind : 'unexpected';
  const attempt =
    typeof candidateAttempt === 'number' &&
    Number.isInteger(candidateAttempt) &&
    candidateAttempt >= 1
      ? candidateAttempt
      : 1;

  return {
    kind,
    status: TRANSPORT_ERROR_STATUS[kind],
    attempt,
    retryable: kind === 'service',
    userMessage: APPLICATION_ERROR_MESSAGES[kind]
  };
}
