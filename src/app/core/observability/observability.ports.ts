import { NotificationPort } from './notification.port';

export type AuditReadableValue =
  | string
  | number
  | boolean
  | null
  | readonly AuditReadableValue[]
  | Readonly<{ readonly [key: string]: AuditReadableValue }>;

export type AuditOccurredAtReference = string;

export interface AuditEventDraft {
  readonly action: string;
  readonly actor: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly occurredAt: AuditOccurredAtReference;
  readonly before?: AuditReadableValue;
  readonly after?: AuditReadableValue;
  readonly mandatoryReason?: string;
}

export interface AuditEvent extends AuditEventDraft {}

export abstract class AuditPort {
  abstract record(event: AuditEventDraft): void | Promise<void>;
}

export type TelemetryScalar = string | number | boolean;
export type TelemetryAttributes = Readonly<Record<string, TelemetryScalar>>;

export interface TelemetryEvent {
  readonly name: string;
  readonly attributes?: TelemetryAttributes;
}

export abstract class TelemetryPort {
  abstract track(event: TelemetryEvent): void | Promise<void>;
}

export interface ObservabilityPortGroup {
  readonly audit: AuditPort;
  readonly telemetry: TelemetryPort;
  readonly notification: NotificationPort;
}
