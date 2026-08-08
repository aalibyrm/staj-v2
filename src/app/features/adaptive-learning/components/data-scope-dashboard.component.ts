import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { RequestStateComponent, type RequestStateKind } from '../../../shared/components/request-state.component';
import { RecommendationReasonCardComponent, type RecommendationReasonCardModel } from './recommendation-reason-card.component';
import { ScopedDataFacade, type DashboardFilterKey, type DashboardFilters, type ScopedDataRecord } from '../data-access/scoped-data.facade';

@Component({
  selector: 'app-data-scope-dashboard',
  standalone: true,
  imports: [RequestStateComponent, RecommendationReasonCardComponent],
  providers: [ScopedDataFacade],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="scope-dashboard" aria-labelledby="learning-dashboard-heading">
      <header class="page-heading">
        <div>
          <span class="eyebrow">Authorized learning scope</span>
          <h1 id="learning-dashboard-heading">Learning dashboard</h1>
          <p class="dashboard-explanation">A role-aware view of progress, study priorities, upcoming work, and scoped activity.</p>
        </div>
        <div class="account-context" role="status" aria-live="polite">
          <span>{{ facade.roleLabel() }}</span>
          <strong>{{ facade.accountLabel() }}</strong>
        </div>
      </header>

      <form class="filter-row" aria-label="Dashboard filters" (submit)="$event.preventDefault()">
        <label>
          <span>Term</span>
          <select [value]="facade.filters().termId" (change)="changeFilter('termId', $event)">
            <option value="">All terms</option>
            @for (option of facade.roleScopedFilters().terms; track option.value) { <option [value]="option.value">{{ option.label }}</option> }
          </select>
        </label>
        <label>
          <span>Course</span>
          <select [value]="facade.filters().courseId" (change)="changeFilter('courseId', $event)">
            <option value="">All courses</option>
            @for (option of facade.roleScopedFilters().courses; track option.value) { <option [value]="option.value">{{ option.label }}</option> }
          </select>
        </label>
        <label>
          <span>Class or cohort</span>
          <select [value]="facade.filters().cohortId" (change)="changeFilter('cohortId', $event)">
            <option value="">All classes</option>
            @for (option of facade.roleScopedFilters().cohorts; track option.value) { <option [value]="option.value">{{ option.label }}</option> }
          </select>
        </label>
        <label>
          <span>Date range</span>
          <select [value]="facade.filters().dateRange" (change)="changeFilter('dateRange', $event)">
            @for (option of facade.roleScopedFilters().dateRanges; track option.value) { <option [value]="option.value">{{ option.label }}</option> }
          </select>
        </label>
        <button class="clear-action" type="button" (click)="facade.clearFilters()">Clear filters</button>
      </form>

      <p class="scope-note" role="status" aria-live="polite">
        Showing {{ facade.visibleRecords().length }} authorized scope record{{ facade.visibleRecords().length === 1 ? '' : 's' }}.
      </p>

      @if (requestKind(); as kind) {
        <app-request-state
          [state]="kind"
          [title]="requestTitle()"
          [message]="facade.requestState().message"
          (retry)="facade.retry()"
        />
      } @else if (facade.requestState().status === 'empty') {
        <app-request-state state="empty" title="No learning data in this scope" message="The authorized filters currently match no dashboard data." />
      } @else {
        <div class="dashboard-grid">
          <section class="widget-strip" aria-labelledby="kpi-heading">
            <div class="section-heading">
              <div><span class="eyebrow">Scope snapshot</span><h2 id="kpi-heading">Key indicators</h2></div>
            </div>
            @if (facade.widgetStatus('kpis') === 'error') {
              <app-request-state state="error" title="Indicators unavailable" message="The key indicator region failed while other dashboard regions remain available." (retry)="facade.retryWidget('kpis')" />
            } @else {
              <div class="kpi-grid">
                @for (kpi of facade.kpis(); track kpi.key) {
                  <article class="kpi-card">
                    <span class="kpi-label">{{ kpi.label }}</span>
                    <strong class="kpi-value">{{ kpi.value }}</strong>
                    <span class="trend" [attr.data-direction]="kpi.trendDirection"><span aria-hidden="true">{{ trendMarker(kpi.trendDirection) }}</span> {{ kpi.trend }}</span>
                  </article>
                }
              </div>
            }
          </section>

          <section class="card progress-card" aria-labelledby="progress-heading">
            <div class="section-heading">
              <div><span class="eyebrow">Outcome progress</span><h2 id="progress-heading">Mastery and progress</h2></div>
              <span class="status-label">Text summary available</span>
            </div>
            @if (facade.widgetStatus('progress') === 'error') {
              <app-request-state state="error" title="Progress unavailable" message="The mastery summary failed while successful widgets remain visible." (retry)="facade.retryWidget('progress')" />
            } @else {
              <p class="accessible-summary" aria-live="polite">{{ facade.accessibleProgressSummary() }}</p>
              <div class="table-wrap">
                <table class="progress-table">
                  <caption class="sr-only">Outcome mastery: code, outcome, score, band, and attempt count</caption>
                  <thead><tr><th scope="col">Outcome</th><th scope="col">Score</th><th scope="col">Band</th><th scope="col">Attempts</th></tr></thead>
                  <tbody>
                    @for (row of facade.progressSummary(); track row.outcomeId) {
                      <tr><th scope="row"><span>{{ row.outcomeCode }}</span><small>{{ row.outcomeTitle }}</small></th><td>{{ row.scoreLabel }}</td><td><span class="band-label">{{ row.band }}</span></td><td>{{ row.attemptCount }}</td></tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </section>

          <section class="card recommendation-panel" aria-labelledby="recommendation-heading">
            <div class="section-heading"><div><span class="eyebrow">Rule-based study plan</span><h2 id="recommendation-heading">Recommended next steps</h2></div><span class="status-label">Explainable</span></div>
            @if (facade.widgetStatus('recommendations') === 'error') {
              <app-request-state state="error" title="Study plan unavailable" message="Recommendations failed while successful dashboard widgets remain visible." (retry)="facade.retryWidget('recommendations')" />
            } @else if (facade.recommendations().length === 0) {
              <p class="inline-empty">No eligible study recommendations in this scope.</p>
            } @else {
              <div class="recommendation-list">
                @for (recommendation of facade.recommendations(); track recommendation.contentId) {
                  <app-recommendation-reason-card [recommendation]="recommendationModel(recommendation)" />
                }
              </div>
            }
          </section>

          <section class="card outcome-panel" aria-labelledby="outcomes-heading">
            <div class="section-heading"><div><span class="eyebrow">Outcome signals</span><h2 id="outcomes-heading">Weak and strong outcomes</h2></div></div>
            @if (facade.widgetStatus('outcomes') === 'error') {
              <app-request-state state="error" title="Outcome signals unavailable" message="The outcome list failed while successful regions remain visible." (retry)="facade.retryWidget('outcomes')" />
            } @else {
              <div class="outcome-columns">
                <section aria-labelledby="weak-outcomes-heading"><h3 id="weak-outcomes-heading">Needs practice</h3><ol class="outcome-list">@for (outcome of facade.weakOutcomes(); track outcome.outcomeId) {<li><span><strong>{{ outcome.outcomeCode }}</strong> {{ outcome.outcomeTitle }}</span><span class="outcome-meta">{{ outcome.scoreLabel }} · {{ outcome.band }}</span></li>} </ol><p class="sr-only">Weak outcomes use score and band text; status is not color-dependent.</p></section>
                <section aria-labelledby="strong-outcomes-heading"><h3 id="strong-outcomes-heading">Maintaining well</h3><ol class="outcome-list">@for (outcome of facade.strongOutcomes(); track outcome.outcomeId) {<li><span><strong>{{ outcome.outcomeCode }}</strong> {{ outcome.outcomeTitle }}</span><span class="outcome-meta">{{ outcome.scoreLabel }} · {{ outcome.band }}</span></li>} </ol></section>
              </div>
            }
          </section>

          <section class="card upcoming-panel" aria-labelledby="upcoming-heading">
            <div class="section-heading"><div><span class="eyebrow">Schedule</span><h2 id="upcoming-heading">Upcoming activity and exams</h2></div></div>
            @if (facade.widgetStatus('upcoming') === 'error') {
              <app-request-state state="error" title="Upcoming work unavailable" message="The upcoming activity region failed while successful widgets remain visible." (retry)="facade.retryWidget('upcoming')" />
            } @else {
              <div class="table-wrap"><table class="upcoming-table"><caption class="sr-only">Upcoming work in the authorized scope</caption><thead><tr><th scope="col">Item</th><th scope="col">Type</th><th scope="col">Date</th></tr></thead><tbody>@for (item of facade.upcomingItems(); track item.id) {<tr><th scope="row"><span>{{ item.title }}</span><small>{{ item.courseLabel }}</small></th><td>{{ item.kind }}</td><td><time [attr.datetime]="item.date">{{ item.date }}</time></td></tr>}</tbody></table></div>
            }
          </section>

          <section class="card activity-panel" aria-labelledby="activity-heading">
            <div class="section-heading"><div><span class="eyebrow">Audit-friendly feed</span><h2 id="activity-heading">Scoped activity</h2></div></div>
            @if (facade.widgetStatus('activity') === 'error') {
              <app-request-state state="error" title="Activity unavailable" message="The activity feed failed while successful dashboard widgets remain visible." (retry)="facade.retryWidget('activity')" />
            } @else {
              <ul class="activity-list">@for (item of facade.activity(); track item.id) {<li><span class="activity-marker" aria-hidden="true">{{ activityMarker(item.marker) }}</span><div><strong>{{ item.label }}</strong><span>{{ item.context }}</span></div><time [attr.datetime]="item.occurredAt">{{ formatDate(item.occurredAt) }}</time></li>}</ul>
            }
          </section>
        </div>
      }
    </main>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .scope-dashboard { display: grid; gap: 20px; min-width: 0; max-width: 100%; padding: 4px; overflow: hidden; }
    .page-heading, .section-heading, .account-context, .filter-row, .kpi-grid, .dashboard-grid, .outcome-columns, .activity-list { min-width: 0; }
    .page-heading, .section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
    .page-heading { align-items: end; }
    .page-heading h1, .section-heading h2, .section-heading h3, p { margin: 0; }
    h1 { color: var(--ui-text); font-size: clamp(1.5rem, 3vw, 2rem); line-height: 1.2; }
    h2 { color: var(--ui-text); font-size: 1.1rem; line-height: 1.3; }
    h3 { color: var(--ui-text); font-size: 14px; }
    .eyebrow, .kpi-label, .filter-row span, .status-label { color: var(--ui-text-muted); font-size: 11px; font-weight: 750; letter-spacing: .05em; text-transform: uppercase; }
    .dashboard-explanation, .scope-note, .accessible-summary, .inline-empty { color: var(--ui-text-muted); font-size: 13px; line-height: 1.5; }
    .dashboard-explanation { max-width: 52rem; margin-top: 4px; }
    .account-context { display: grid; gap: 3px; justify-items: end; color: var(--ui-text-muted); font-size: 12px; }
    .account-context strong { color: var(--ui-text); font-size: 13px; }
    .filter-row { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; padding: 14px 16px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md); background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); }
    .filter-row label { display: grid; min-width: 150px; flex: 1 1 150px; gap: 5px; }
    select, button { min-height: 40px; border: 1px solid var(--ui-border-strong); border-radius: var(--ui-radius-sm); font: inherit; }
    select { min-width: 0; padding: 8px 10px; background: var(--ui-surface); color: var(--ui-text); }
    button { cursor: pointer; padding: 8px 14px; font-weight: 700; }
    button:focus-visible, select:focus-visible { outline: 3px solid color-mix(in srgb, var(--ui-focus) 35%, transparent); outline-offset: 2px; }
    .clear-action { border-color: var(--ui-primary); background: var(--ui-primary-soft); color: var(--ui-primary); }
    .scope-note { margin-top: -8px; }
    .dashboard-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 16px; }
    .widget-strip { grid-column: 1 / -1; display: grid; gap: 12px; }
    .card { display: grid; align-content: start; gap: 16px; min-width: 0; padding: 18px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md); background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); }
    .progress-card { grid-column: span 7; }
    .recommendation-panel { grid-column: span 5; }
    .outcome-panel { grid-column: span 7; }
    .upcoming-panel { grid-column: span 5; }
    .activity-panel { grid-column: 1 / -1; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .kpi-card { display: grid; gap: 8px; min-width: 0; padding: 16px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md); background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); }
    .kpi-value { color: var(--ui-text); font-size: 1.45rem; font-variant-numeric: tabular-nums; }
    .trend { color: var(--ui-text-muted); font-size: 11px; line-height: 1.3; }
    .trend[data-direction="up"] { color: var(--ui-success); } .trend[data-direction="down"] { color: var(--ui-danger); }
    .trend span, .activity-marker { font-weight: 850; }
    .table-wrap { min-width: 0; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; color: var(--ui-text); font-size: 12px; }
    th, td { padding: 10px 8px; border-bottom: 1px solid var(--ui-border); text-align: left; vertical-align: top; }
    thead th { color: var(--ui-text-muted); font-size: 11px; font-weight: 750; text-transform: uppercase; }
    tbody th { font-weight: 700; } tbody th span, tbody th small { display: block; } tbody th small { margin-top: 3px; color: var(--ui-text-muted); font-size: 11px; font-weight: 400; }
    .band-label, .status-label { display: inline-flex; align-items: center; min-height: 24px; padding: 3px 7px; border: 1px solid var(--ui-border-strong); border-radius: 999px; color: var(--ui-text); font-size: 11px; letter-spacing: normal; text-transform: none; }
    .accessible-summary { padding: 10px 12px; border-left: 3px solid var(--ui-primary); background: var(--ui-surface-subtle); }
    .recommendation-list { display: grid; gap: 12px; max-height: 620px; overflow: auto; padding: 2px; }
    .outcome-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
    .outcome-columns section { display: grid; align-content: start; gap: 10px; min-width: 0; }
    .outcome-list { display: grid; gap: 8px; margin: 0; padding-left: 20px; }
    .outcome-list li { display: grid; gap: 3px; min-width: 0; padding-left: 3px; color: var(--ui-text); font-size: 12px; }
    .outcome-list li span:first-child { overflow-wrap: anywhere; } .outcome-meta { color: var(--ui-text-muted); font-size: 11px; }
    .activity-list { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }
    .activity-list li { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; align-items: start; gap: 10px; padding: 12px 0; border-bottom: 1px solid var(--ui-border); }
    .activity-list li:last-child { border-bottom: 0; } .activity-marker { display: grid; width: 24px; height: 24px; place-items: center; border: 1px solid var(--ui-border-strong); border-radius: 50%; color: var(--ui-text); }
    .activity-list strong, .activity-list li div span { display: block; overflow-wrap: anywhere; } .activity-list strong { color: var(--ui-text); font-size: 12px; } .activity-list li div span, .activity-list time { color: var(--ui-text-muted); font-size: 11px; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    @media (max-width: 900px) { .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .progress-card, .recommendation-panel, .outcome-panel, .upcoming-panel { grid-column: 1 / -1; } }
    @media (max-width: 600px) { .scope-dashboard { gap: 16px; padding: 0; } .page-heading, .section-heading { display: grid; gap: 8px; } .account-context { justify-items: start; } .filter-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; } .filter-row label { min-width: 0; } .clear-action { width: 100%; } .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; } .kpi-card { padding: 12px; } .kpi-value { font-size: 1.25rem; } .card { padding: 14px; } .outcome-columns { grid-template-columns: 1fr; gap: 16px; } .activity-list li { grid-template-columns: 28px minmax(0, 1fr); } .activity-list time { grid-column: 2; } }
  `]
})
export class DataScopeDashboardComponent {
  readonly facade = inject(ScopedDataFacade);

  requestKind(): RequestStateKind | null {
    const status = this.facade.requestState().status;
    return status === 'loading' || status === 'slow' || status === 'error' || status === 'unauthorized' ? status : null;
  }
  requestTitle(): string {
    const status = this.facade.requestState().status;
    if (status === 'slow') return 'Dashboard response is taking longer';
    if (status === 'error') return 'Unable to load dashboard';
    if (status === 'unauthorized') return 'Dashboard access unavailable';
    return 'Loading dashboard';
  }
  changeFilter(key: DashboardFilterKey, event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    const update: Partial<DashboardFilters> = key === 'termId'
      ? { termId: target.value }
      : key === 'courseId'
        ? { courseId: target.value }
        : key === 'cohortId'
          ? { cohortId: target.value }
          : { dateRange: target.value };
    this.facade.updateFilters(update);
  }
  recommendationModel(value: { readonly contentId: string; readonly contentTitle: string; readonly contentFormat: string; readonly order: number; readonly reason: RecommendationReasonCardModel['reason'] }): RecommendationReasonCardModel {
    return value;
  }
  trendMarker(direction: 'up' | 'down' | 'flat'): string { return direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→'; }
  activityMarker(marker: 'success' | 'info' | 'warning'): string { return marker === 'success' ? '✓' : marker === 'warning' ? '!' : 'i'; }
  formatDate(value: string): string { return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(value)); }
  accessLabel(record: ScopedDataRecord): string { return record.accessMode === 'read-only' ? 'Read only' : 'Granted scope'; }
}
