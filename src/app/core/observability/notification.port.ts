import type { ApplicationError, ApplicationErrorKind } from '../api/api-error';

export type NotificationActionType = 'retry';

export interface NotificationAction {
  readonly type: NotificationActionType;
  readonly label: string;
}

export interface NotificationMessage {
  readonly kind: ApplicationErrorKind;
  readonly text: string;
  readonly actions: readonly NotificationAction[];
}

export abstract class NotificationPort {
  abstract notify(message: NotificationMessage): void;
}

const RETRY_ACTIONS: readonly NotificationAction[] = Object.freeze([
  Object.freeze({ type: 'retry' as const, label: 'Retry' })
]);
const NO_ACTIONS: readonly NotificationAction[] = Object.freeze([]);

export function mapApplicationErrorToNotification(error: ApplicationError): NotificationMessage {
  switch (error.kind) {
    case 'service':
      return {
        kind: 'service',
        text: 'The service is temporarily unavailable. Retry the request.',
        actions: RETRY_ACTIONS
      };
    case 'unauthorized':
      return {
        kind: 'unauthorized',
        text: 'You are not authorized to perform this action.',
        actions: NO_ACTIONS
      };
    case 'conflict':
      return {
        kind: 'conflict',
        text: 'This change conflicts with a newer version. Refresh before trying again.',
        actions: NO_ACTIONS
      };
    case 'unexpected':
      return {
        kind: 'unexpected',
        text: 'An unexpected error occurred.',
        actions: NO_ACTIONS
      };
    default:
      return {
        kind: 'unexpected',
        text: 'An unexpected error occurred.',
        actions: NO_ACTIONS
      };
  }
}
