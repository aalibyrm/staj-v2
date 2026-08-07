import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, EMPTY } from 'rxjs';

import { ListQueryControlsComponent, type ListFilterOption, type ListSortOption } from '../../../shared/components/list-query-controls.component';
import { ListQueryStateFacade } from '../../../shared/state/list-query-state';
import { RequestStateComponent, type RequestStateKind } from '../../../shared/components/request-state.component';
import { AUDIT_CATEGORIES, AUDIT_STATUSES, type AuditLogRecord } from '../models/audit-log.models';
import { AuditLogFacade } from '../data-access/audit-log.facade';
import { AuditRecordDetailComponent } from './audit-record-detail.component';
import type { AuditLogQuery } from '../domain/audit-log-query';

const PAGE_SIZE_CHOICES: readonly number[] = Object.freeze([10, 20, 50]);
const DEFAULT_PAGE_SIZE = 20;

const humanizeToken = (token: string): string => token.replace(/-/gu, ' ').replace(/\b\w/gu, (c) => c.toUpperCase());

const MAX_DATE_FILTER_DAYS = 7;

const formatDayLabel = (day: string): string =>
  new Date(`${day}T00:00:00.000Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** One `from:`/`to:` filter option per distinct record day, newest first, capped to the most recent `MAX_DATE_FILTER_DAYS` days. */
const buildDateFilterOptions = (records: readonly AuditLogRecord[]): ListFilterOption[] => {
  const days = Array.from(new Set(records.map((record) => record.occurredAt.slice(0, 10))))
    .sort((left, right) => right.localeCompare(left))
    .slice(0, MAX_DATE_FILTER_DAYS);
  const fromOptions = days.map((day) => ({ value: `from:${day}`, label: `From ${formatDayLabel(day)}` }));
  const toOptions = days.map((day) => ({ value: `to:${day}`, label: `To ${formatDayLabel(day)}` }));
  return [...fromOptions, ...toOptions];
};

const REQUEST_STATE_MAP: Readonly<Record<string, RequestStateKind>> = Object.freeze({
  loading: 'loading',
  empty: 'empty',
  error: 'error',
  unauthorized: 'unauthorized'
});

@Component({
  selector: 'app-audit-log',
  standalone: true,
  imports: [ListQueryControlsComponent, RequestStateComponent, AuditRecordDetailComponent],
  providers: [ListQueryStateFacade, AuditLogFacade],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="audit-log" aria-labelledby="audit-log-heading">
      <header class="page-heading">
        <div>
          <span class="eyebrow">Compliance</span>
          <h1 id="audit-log-heading">Audit log</h1>
          <p>Append-only record of publish, score-change, session-termination, import, and override activity.</p>
        </div>
        <div class="page-actions">
          <button type="button" class="secondary-action" (click)="clearFilters()">Clear filters</button>
          @if (facade.canExport()) {
            <button type="button" class="primary-action" (click)="exportVisiblePage()">Export visible page</button>
          }
        </div>
      </header>

      <app-list-query-controls [filterOptions]="filterOptions()" [sortOptions]="sortOptions" />

      @if (requestKind(); as kind) {
        <app-request-state [state]="kind" [message]="facade.requestState().message" (retry)="retry()" />
      } @else {
        <section class="summary-card" aria-labelledby="audit-summary-heading">
          <h2 id="audit-summary-heading">Activity summary</h2>
          <div class="summary-grid">
            <div class="summary-figure"><span class="summary-label">Total</span><strong>{{ facade.summary().total }}</strong></div>
            @for (entry of facade.summary().byCategory; track entry.category) {
              <div class="summary-figure"><span class="summary-label">{{ humanizeToken(entry.category) }}</span><strong>{{ entry.count }}</strong></div>
            }
          </div>
        </section>

        <p class="live-region" aria-live="polite">{{ facade.page().total }} record{{ facade.page().total === 1 ? '' : 's' }} match the current filters.</p>

        <div class="table-card">
          <table class="audit-table">
            <caption class="sr-only">Audit records: time, actor, action, target, description, and status</caption>
            <thead>
              <tr>
                <th scope="col" class="col-time">Time</th>
                <th scope="col" class="col-actor">Actor</th>
                <th scope="col" class="col-action">Action</th>
                <th scope="col" class="col-target">Target</th>
                <th scope="col" class="col-description">Description</th>
                <th scope="col" class="col-status">Status</th>
              </tr>
            </thead>
            <tbody>
              @for (record of facade.page().items; track record.id) {
                <tr [class.is-selected]="facade.selectedRecord()?.id === record.id">
                  <td class="col-time"><time [attr.datetime]="record.occurredAt">{{ formatOccurredAt(record.occurredAt) }}</time></td>
                  <td class="col-actor">{{ record.actorLabel }}</td>
                  <td class="col-action">
                    <button type="button" class="row-select" [attr.aria-pressed]="facade.selectedRecord()?.id === record.id" (click)="openDetail(record.id, $event)">
                      {{ record.action }}
                      @if (facade.selectedRecord()?.id === record.id) { <span class="selected-marker">Selected</span> }
                    </button>
                  </td>
                  <td class="col-target">{{ record.targetType }} — {{ record.targetLabel }}</td>
                  <td class="col-description">{{ record.description }}</td>
                  <td class="col-status">
                    <span class="status-chip" [attr.data-status]="record.status">
                      <span aria-hidden="true">{{ record.status === 'success' ? '✓' : record.status === 'rejected' ? '⚠' : '✕' }}</span>
                      {{ record.status }}
                    </span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <footer class="pagination" aria-label="Audit log pagination">
          <label class="page-size-field">
            Rows per page
            <select [value]="pageSize()" (change)="setPageSize($event)">
              @for (size of pageSizeChoices; track size) { <option [value]="size">{{ size }}</option> }
            </select>
          </label>
          <span class="page-range">{{ pageRangeText() }}</span>
          <div class="page-buttons">
            <button type="button" [disabled]="facade.page().page <= 1" (click)="goToPage(facade.page().page - 1)">Previous</button>
            <button type="button" [disabled]="facade.page().page >= facade.page().pageCount" (click)="goToPage(facade.page().page + 1)">Next</button>
          </div>
        </footer>
      }

      @if (facade.selectedRecord(); as selected) {
        <app-audit-record-detail [record]="selected" [viewerRole]="facade.viewerRole()" (closed)="closeDetail()" />
      }
    </main>
  `,
  styles: [`:host{display:block}.audit-log{display:grid;gap:16px;padding:24px 28px 40px}.page-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}.page-heading h1{margin:2px 0 0;font-size:clamp(1.4rem,2vw,1.7rem)}.page-heading p{margin:4px 0 0;color:var(--ui-text-muted)}.eyebrow{display:block;color:var(--ui-text-muted);font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em}.page-actions{display:flex;gap:8px;flex-wrap:wrap}.primary-action,.secondary-action{min-height:40px;padding:8px 14px;border-radius:var(--ui-radius-sm);font-weight:700;cursor:pointer}.primary-action{border:1px solid var(--ui-primary);background:var(--ui-primary);color:#fff}.secondary-action{border:1px solid var(--ui-border-strong);background:var(--ui-surface);color:var(--ui-text)}.summary-card,.table-card{border:1px solid var(--ui-border);border-radius:var(--ui-radius-md);background:var(--ui-surface);box-shadow:var(--ui-shadow-sm);padding:18px}.summary-card h2{margin:0 0 12px;font-size:1rem}.summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px}.summary-figure{display:grid;gap:4px;padding:10px 12px;border:1px solid var(--ui-border);border-radius:var(--ui-radius-sm);background:var(--ui-surface-subtle)}.summary-label{color:var(--ui-text-muted);font-size:.74rem;font-weight:700}.summary-figure strong{font-size:1.2rem;font-variant-numeric:tabular-nums}.live-region{margin:0;color:var(--ui-text-muted);font-size:.82rem}.table-card{padding:0;overflow-x:auto}.audit-table{width:100%;border-collapse:collapse;font-size:.85rem}.audit-table th,.audit-table td{padding:10px 12px;border-bottom:1px solid var(--ui-border);text-align:left;vertical-align:top}.audit-table thead th{background:var(--ui-surface-subtle);font-size:.74rem;text-transform:uppercase;letter-spacing:.04em;color:var(--ui-text-muted)}tr.is-selected td{background:var(--ui-primary-soft)}.row-select{border:0;background:none;padding:0;font:inherit;color:var(--ui-primary);font-weight:700;cursor:pointer;text-align:left}.row-select:hover{text-decoration:underline}.selected-marker{margin-left:6px;font-size:.7rem;font-weight:800;color:var(--ui-primary)}.status-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;border:1px solid var(--ui-border-strong);font-size:.76rem;font-weight:700;text-transform:capitalize}.status-chip[data-status=success]{color:var(--ui-success);background:var(--ui-success-soft)}.status-chip[data-status=rejected]{color:var(--ui-warning);background:var(--ui-warning-soft)}.status-chip[data-status=failed]{color:var(--ui-danger);background:var(--ui-danger-soft)}.pagination{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:6px 2px}.page-size-field{display:flex;align-items:center;gap:8px;font-size:.82rem;color:var(--ui-text-muted)}.page-size-field select{min-height:36px;border:1px solid var(--ui-border-strong);border-radius:var(--ui-radius-sm)}.page-range{color:var(--ui-text-muted);font-size:.82rem}.page-buttons{display:flex;gap:8px}.page-buttons button{min-height:40px;padding:8px 14px;border:1px solid var(--ui-border-strong);border-radius:var(--ui-radius-sm);background:var(--ui-surface);cursor:pointer}.page-buttons button:disabled{opacity:.5;cursor:not-allowed}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}@media(max-width:600px){.audit-log{padding:16px}.col-actor,.col-description{display:none}.audit-table{table-layout:fixed}.page-heading{flex-direction:column;align-items:stretch}}`]
})
export class AuditLogComponent {
  readonly facade = inject(AuditLogFacade);
  private readonly queryFacade = inject(ListQueryStateFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly pageSize = signal(DEFAULT_PAGE_SIZE);
  readonly pageSizeChoices = PAGE_SIZE_CHOICES;
  private lastTrigger: HTMLElement | null = null;
  private loaded = false;

  readonly requestKind = computed<RequestStateKind | null>(() => REQUEST_STATE_MAP[this.facade.requestState().status] ?? null);

  readonly filterOptions = computed<readonly ListFilterOption[]>(() => {
    const records = this.facade.records();
    const categoryOptions = AUDIT_CATEGORIES.map((category) => ({ value: `category:${category}`, label: `Category: ${humanizeToken(category)}` }));
    const statusOptions = AUDIT_STATUSES.map((status) => ({ value: `status:${status}`, label: `Status: ${humanizeToken(status)}` }));
    const actorLabelById = new Map(records.map((record) => [record.actorId, record.actorLabel]));
    const actorOptions = Array.from(actorLabelById, ([actorId, label]) => ({ value: `actor:${actorId}`, label: `Actor: ${label}` }));
    const dateOptions = buildDateFilterOptions(records);
    return [...categoryOptions, ...statusOptions, ...actorOptions, ...dateOptions];
  });

  readonly sortOptions: readonly ListSortOption[] = Object.freeze([
    { value: 'occurredAt:desc', label: 'Newest first' },
    { value: 'occurredAt:asc', label: 'Oldest first' },
    { value: 'actor:asc', label: 'Actor A-Z' },
    { value: 'category:asc', label: 'Category A-Z' }
  ]);

  private readonly auditQuery = computed<AuditLogQuery>(() => {
    const state = this.queryFacade.state();
    return Object.freeze({
      search: state.search,
      filters: state.filters,
      sort: state.sort || 'occurredAt:desc',
      page: state.page,
      pageSize: this.pageSize()
    });
  });

  readonly pageRangeText = computed(() => {
    const page = this.facade.page();
    if (page.total === 0) return 'No records';
    const start = (page.page - 1) * page.pageSize + 1;
    const end = Math.min(page.page * page.pageSize, page.total);
    return `${start}–${end} of ${page.total}`;
  });

  constructor() {
    toObservable(this.auditQuery)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((query) => {
        if (!this.loaded) {
          this.loaded = true;
          this.facade.load(query).pipe(catchError(() => EMPTY)).subscribe();
          return;
        }
        this.facade.applyQuery(query);
      });
  }

  humanizeToken(token: string): string {
    return humanizeToken(token);
  }

  formatOccurredAt(value: string): string {
    return value.slice(0, 16).replace('T', ' ');
  }

  retry(): void {
    this.facade.retry().pipe(catchError(() => EMPTY)).subscribe();
  }

  clearFilters(): void {
    void this.queryFacade.reset();
  }

  setPageSize(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    const size = Number(target.value);
    if (Number.isFinite(size) && size > 0) {
      this.pageSize.set(size);
      void this.queryFacade.setPage(1);
    }
  }

  goToPage(page: number): void {
    void this.queryFacade.setPage(page);
  }

  openDetail(id: string, event: Event): void {
    this.lastTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    this.facade.select(id);
  }

  closeDetail(): void {
    this.facade.clearSelection();
    this.lastTrigger?.focus();
  }

  exportVisiblePage(): void {
    const rows = this.facade.page().items.map((record) => ({
      id: record.id,
      occurredAt: record.occurredAt,
      actor: record.actorLabel,
      action: record.action,
      target: `${record.targetType}:${record.targetId}`,
      status: record.status
    }));
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'audit-log-page.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }
}
