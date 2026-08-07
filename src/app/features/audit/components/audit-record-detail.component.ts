import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnInit,
  ViewChild,
  afterNextRender,
  computed,
  inject,
  input,
  output
} from '@angular/core';

import type { RoleCode } from '../../../core/auth/authorization';
import { REDACTED_FIELD_VALUE, type AuditLogRecord, type AuditReadableValue } from '../models/audit-log.models';

type ReadableRow = Readonly<{ path: string; value: string }>;

const formatScalar = (value: AuditReadableValue): string => {
  if (value === null) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
};

/** Flattens an `AuditReadableValue` tree into displayable `path: value` rows for the change-details table. */
const flattenReadable = (value: AuditReadableValue, prefix = ''): ReadableRow[] => {
  if (value === null || typeof value !== 'object') {
    return [{ path: prefix || 'value', value: formatScalar(value) }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenReadable(item, prefix ? `${prefix}[${index}]` : `[${index}]`));
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return [{ path: prefix || 'value', value: '—' }];
  return entries.flatMap(([key, nested]) => flattenReadable(nested, prefix ? `${prefix}.${key}` : key));
};

const humanizeRoleCode = (role: string): string => role.replace(/_/gu, ' ').toLowerCase().replace(/\b\w/gu, (c) => c.toUpperCase());

type ChangeRow = Readonly<{ path: string; before: string; after: string }>;

@Component({
  selector: 'app-audit-record-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (record(); as record) {
      <section #panel class="audit-detail" role="dialog" aria-modal="true" aria-labelledby="audit-detail-title" tabindex="-1" (keydown.escape)="closed.emit()">
        <div class="audit-detail-heading">
          <span class="eyebrow">Audit record</span>
          <h2 id="audit-detail-title">{{ record.action }}</h2>
          <button type="button" class="close-action" aria-label="Close audit record detail" (click)="closed.emit()">&times;</button>
        </div>
        <dl class="audit-detail-fields">
          <div><dt>Occurred at</dt><dd><time [attr.datetime]="record.occurredAt">{{ record.occurredAt }}</time></dd></div>
          <div><dt>Actor</dt><dd>{{ record.actorLabel }} <small>({{ humanizeRole(record.actorRole) }})</small></dd></div>
          <div><dt>Category</dt><dd>{{ humanizeRole(record.category) }}</dd></div>
          <div><dt>Status</dt><dd><span class="status-marker" [attr.data-status]="record.status"><span aria-hidden="true">{{ statusGlyph(record.status) }}</span> {{ record.status }}</span></dd></div>
          <div><dt>Target</dt><dd>{{ record.targetType }} — {{ record.targetLabel }} <small>({{ record.targetId }})</small></dd></div>
        </dl>
        <section class="audit-detail-block" aria-labelledby="audit-detail-description-heading">
          <h3 id="audit-detail-description-heading">Description</h3>
          <p>{{ record.description }}</p>
        </section>
        @if (changeRows().length > 0) {
          <section class="audit-detail-block" aria-labelledby="audit-detail-changes-heading">
            <h3 id="audit-detail-changes-heading">Change details</h3>
            <table class="change-table">
              <thead><tr><th scope="col">Field</th><th scope="col">Previous</th><th scope="col">New</th></tr></thead>
              <tbody>
                @for (row of changeRows(); track row.path) {
                  <tr><th scope="row">{{ row.path }}</th><td>{{ row.before }}</td><td>{{ row.after }}</td></tr>
                }
              </tbody>
            </table>
          </section>
        }
        @if (record.reason) {
          <section class="audit-detail-block" aria-labelledby="audit-detail-reason-heading">
            <h3 id="audit-detail-reason-heading">Reason</h3>
            <p>{{ record.reason }}</p>
          </section>
        }
        <section class="audit-detail-block" aria-labelledby="audit-detail-trace-heading">
          <h3 id="audit-detail-trace-heading">Trace identifiers</h3>
          <dl class="audit-detail-fields">
            <div><dt>Trace ID</dt><dd>{{ traceValue(record.traceId) }}</dd></div>
            <div><dt>Request ID</dt><dd>{{ traceValue(record.requestId) }}</dd></div>
            <div><dt>User agent</dt><dd>{{ traceValue(record.userAgent) }}</dd></div>
          </dl>
          @if (record.traceId === redactedValue) {
            <p class="redacted-note">Redacted — only a Platform Administrator account can view trace identifiers. Your role is {{ humanizeRole(viewerRole() ?? '') }}.</p>
          }
        </section>
      </section>
    }
  `,
  styles: [`:host{display:block}.audit-detail{display:grid;gap:14px;padding:18px;border-radius:var(--ui-radius-md);border:1px solid var(--ui-border);background:var(--ui-surface);box-shadow:var(--ui-shadow-md)}.audit-detail-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.audit-detail-heading h2{margin:2px 0 0;font-size:1.1rem}.eyebrow{display:block;color:var(--ui-text-muted);font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em}.close-action{min-height:36px;min-width:36px;border:1px solid var(--ui-border-strong);border-radius:var(--ui-radius-sm);background:var(--ui-surface);cursor:pointer;font-size:1.1rem;line-height:1}.close-action:hover{background:var(--ui-surface-subtle)}.audit-detail-fields{display:grid;gap:8px;margin:0}.audit-detail-fields div{display:flex;justify-content:space-between;gap:12px;font-size:.85rem}.audit-detail-fields dt{color:var(--ui-text-muted);font-weight:700}.audit-detail-fields dd{margin:0;text-align:right}.audit-detail-block{border-top:1px solid var(--ui-border);padding-top:12px}.audit-detail-block h3{margin:0 0 8px;font-size:.85rem;font-weight:750}.audit-detail-block p{margin:0;font-size:.86rem;line-height:1.5}.status-marker{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;border:1px solid var(--ui-border-strong);font-size:.78rem;font-weight:700;text-transform:capitalize}.status-marker[data-status=success]{color:var(--ui-success);background:var(--ui-success-soft)}.status-marker[data-status=rejected]{color:var(--ui-warning);background:var(--ui-warning-soft)}.status-marker[data-status=failed]{color:var(--ui-danger);background:var(--ui-danger-soft)}.change-table{width:100%;border-collapse:collapse;font-size:.82rem}.change-table th,.change-table td{padding:6px 8px;border-bottom:1px solid var(--ui-border);text-align:left}.redacted-note{margin:8px 0 0;font-size:.78rem;color:var(--ui-text-muted)}`]
})
export class AuditRecordDetailComponent implements OnInit {
  private readonly renderInjector = inject(Injector);
  readonly redactedValue = REDACTED_FIELD_VALUE;

  readonly record = input<AuditLogRecord | null>(null);
  readonly viewerRole = input<RoleCode | null>(null);
  readonly closed = output<void>();

  @ViewChild('panel') private panel?: ElementRef<HTMLElement>;

  readonly changeRows = computed<readonly ChangeRow[]>(() => {
    const record = this.record();
    if (record === null || (record.before === null && record.after === null)) return [];
    const beforeRows = record.before === null ? [] : flattenReadable(record.before);
    const afterRows = record.after === null ? [] : flattenReadable(record.after);
    const beforeByPath = new Map(beforeRows.map((row) => [row.path, row.value]));
    const afterByPath = new Map(afterRows.map((row) => [row.path, row.value]));
    const paths = new Set([...beforeByPath.keys(), ...afterByPath.keys()]);
    return Array.from(paths, (path) => ({ path, before: beforeByPath.get(path) ?? '—', after: afterByPath.get(path) ?? '—' }));
  });

  ngOnInit(): void {
    afterNextRender({ write: () => this.panel?.nativeElement.focus() }, { injector: this.renderInjector });
  }

  humanizeRole(role: string): string {
    return humanizeRoleCode(role);
  }

  traceValue(value: string): string {
    return value === this.redactedValue ? 'Redacted' : value;
  }

  statusGlyph(status: string): string {
    return status === 'success' ? '✓' : status === 'rejected' ? '⚠' : '✕';
  }
}
