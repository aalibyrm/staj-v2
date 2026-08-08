import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { RequestStateComponent, type RequestStateKind } from '../../../shared/components/request-state.component';
import { CohortAnalyticsFacade, type CohortAnalyticsFilterKey, type CohortAnalyticsFilters } from '../data-access/cohort-analytics.facade';

@Component({
  selector: 'app-cohort-analytics',
  standalone: true,
  imports: [RequestStateComponent],
  providers: [CohortAnalyticsFacade],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="analytics-page" aria-labelledby="cohort-analytics-heading">
      <header class="page-heading">
        <div>
          <span class="eyebrow">Authorized cohort scope</span>
          <h1 id="cohort-analytics-heading">Cohort analytics</h1>
          @if (facade.cohortContext(); as cohort) {
            <p class="page-context"><strong>{{ cohort.cohortLabel }}</strong><span>{{ cohort.courseLabel }}</span></p>
          } @else {
            <p class="page-context">Aggregate learning evidence is limited to cohorts authorized for this account.</p>
          }
        </div>
        @if (facade.cohortContext(); as cohort) {
          <aside class="scope-context" aria-label="Selected cohort context"><span class="context-marker" aria-hidden="true">C</span><div><span>Authorized cohort scope</span><strong>{{ cohort.cohortLabel }}</strong><small>{{ cohort.cohortIds.length }} cohort{{ cohort.cohortIds.length === 1 ? '' : 's' }}</small></div></aside>
        }
      </header>

      <form class="filter-bar" aria-label="Cohort analytics filters" (submit)="$event.preventDefault()">
        <label><span>Course</span><select [value]="facade.filters().courseId" (change)="changeFilter('courseId', $event)"><option value="" [selected]="facade.filters().courseId === ''">All authorized courses</option>@for (option of facade.filterOptions().courses; track option.value) { <option [value]="option.value" [selected]="facade.filters().courseId === option.value">{{ option.label }}</option> }</select></label>
        <label><span>Cohort</span><select [value]="facade.filters().cohortId" (change)="changeFilter('cohortId', $event)"><option value="" [selected]="facade.filters().cohortId === ''">All authorized cohorts</option>@for (option of facade.filterOptions().cohorts; track option.value) { <option [value]="option.value" [selected]="facade.filters().cohortId === option.value">{{ option.label }}</option> }</select></label>
        <label><span>Date range</span><select [value]="facade.filters().dateRange" (change)="changeFilter('dateRange', $event)">@for (option of facade.filterOptions().dateRanges; track option.value) { <option [value]="option.value" [selected]="facade.filters().dateRange === option.value">{{ option.label }}</option> }</select></label>
        <button class="clear-action" type="button" (click)="facade.clearFilters()">Clear filters</button>
      </form>

      <p class="live-status" role="status" aria-live="polite">{{ statusAnnouncement() }}</p>

      @if (requestKind(); as kind) {
        <app-request-state [state]="kind" [title]="requestTitle()" [message]="facade.requestState().message" (retry)="facade.retry()" />
      } @else if (facade.requestState().status === 'empty') {
        <app-request-state state="empty" title="No cohort analytics for this selection" [message]="facade.requestState().message" />
      } @else {
        <div class="analytics-grid">
          <section class="kpi-region" aria-labelledby="kpi-heading">
            <div class="section-heading"><div><span class="eyebrow">Verified aggregate evidence</span><h2 id="kpi-heading">Cohort snapshot</h2></div><span class="status-label">Read only</span></div>
            <div class="kpi-grid">@for (kpi of facade.kpis(); track kpi.key) { <article class="kpi-card"><span class="kpi-icon" aria-hidden="true">{{ kpi.marker }}</span><div><span class="kpi-label">{{ kpi.label }}</span><strong class="kpi-value">{{ kpi.value }}</strong><span class="kpi-detail">{{ kpi.detail }}</span></div></article> }</div>
          </section>

          <section class="card summary-card" aria-labelledby="summary-heading">
            <div class="section-heading"><div><span class="eyebrow">Accessible aggregate summary</span><h2 id="summary-heading">Cohort overview</h2></div><span class="status-label">No individual detail</span></div>
            @if (facade.summary(); as summary) { <p class="summary-copy">{{ summary.learnerCount }} learner{{ summary.learnerCount === 1 ? '' : 's' }} in the authorized scope; average mastery is {{ summary.averageScoreLabel }} across {{ summary.measuredLearnerCount }} measured learner{{ summary.measuredLearnerCount === 1 ? '' : 's' }}.</p><dl class="summary-list"><div><dt>Measured outcomes</dt><dd>{{ summary.measuredOutcomeCount }}</dd></div><div><dt>Attempts in range</dt><dd>{{ summary.attemptCount }}</dd></div><div><dt>Privacy minimum</dt><dd>{{ facade.privacy().minimum }}</dd></div></dl> }
          </section>

          @if (facade.privacy().status === 'blocked') {
            <section class="privacy-notice" role="alert" aria-labelledby="privacy-heading"><span class="notice-marker" aria-hidden="true">!</span><div><h2 id="privacy-heading">Individual comparison is unavailable</h2><p>This cohort contains {{ facade.privacy().count }} learner{{ facade.privacy().count === 1 ? '' : 's' }}. Individual comparison rows remain hidden until the cohort reaches the privacy minimum of {{ facade.privacy().minimum }} learners.</p></div></section>
          } @else {
            <section class="card table-card" aria-labelledby="comparison-heading"><div class="section-heading"><div><span class="eyebrow">Authorized comparison</span><h2 id="comparison-heading">Individual mastery comparison</h2></div><span class="status-label">{{ facade.comparisonRows().length }} rows</span></div><div class="table-wrap"><table><caption>Individual mastery comparison for the authorized cohort scope</caption><thead><tr><th scope="col">Rank</th><th scope="col">Learner</th><th scope="col">Mastery</th><th scope="col">Status</th><th scope="col">Attempts</th></tr></thead><tbody>@for (row of facade.comparisonRows(); track row.studentId) { <tr><td>{{ row.rank }}</td><td><strong>{{ row.pseudonym }}</strong><small>{{ row.cohortLabel }}</small></td><td>{{ row.scoreLabel }}</td><td><span class="status-marker" aria-hidden="true">{{ row.marker }}</span> {{ row.statusLabel }}</td><td>{{ row.attemptCount }}</td></tr> }</tbody></table></div></section>
          }
        </div>
      }
    </main>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .analytics-page { display: grid; gap: 20px; min-width: 0; max-width: 100%; padding: 4px; overflow: hidden; }
    .page-heading, .section-heading, .filter-bar, .kpi-grid, .analytics-grid, .scope-context, .summary-list, .privacy-notice { min-width: 0; }
    .page-heading, .section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
    h1, h2, p, dl { margin: 0; } h1 { color: var(--ui-text); font-size: clamp(1.5rem, 3vw, 2rem); line-height: 1.2; } h2 { color: var(--ui-text); font-size: 1.1rem; line-height: 1.3; }
    .eyebrow, .kpi-label, .filter-bar span, .status-label { color: var(--ui-text-muted); font-size: 10px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
    .page-context, .live-status, .summary-copy { color: var(--ui-text-muted); font-size: 13px; line-height: 1.5; } .page-context { display: grid; gap: 2px; margin-top: 5px; } .page-context strong { color: var(--ui-text); font-size: 14px; }
    .scope-context { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md); background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); } .scope-context div { display: grid; gap: 2px; } .scope-context span, .scope-context small { color: var(--ui-text-muted); font-size: 11px; } .scope-context strong { color: var(--ui-text); font-size: 13px; }
    .context-marker, .kpi-icon, .notice-marker { display: grid; place-items: center; flex: 0 0 auto; width: 34px; height: 34px; border: 1px solid var(--ui-border-strong); border-radius: 10px; color: var(--ui-primary); font-weight: 850; }
    .filter-bar { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; padding: 14px 16px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md); background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); } .filter-bar label { display: grid; min-width: 170px; flex: 1 1 170px; gap: 5px; } select, button { min-height: 40px; border: 1px solid var(--ui-border-strong); border-radius: var(--ui-radius-sm); font: inherit; } select { min-width: 0; padding: 8px 10px; background: var(--ui-surface); color: var(--ui-text); } button { cursor: pointer; padding: 8px 14px; font-weight: 700; } select:focus-visible, button:focus-visible { outline: 3px solid color-mix(in srgb, var(--ui-focus) 35%, transparent); outline-offset: 2px; } .clear-action { border-color: var(--ui-primary); background: var(--ui-primary-soft); color: var(--ui-primary); } .live-status { min-height: 1.3em; margin-top: -10px; }
    .analytics-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 16px; } .kpi-region { grid-column: 1 / -1; display: grid; gap: 12px; } .card { display: grid; align-content: start; gap: 16px; min-width: 0; padding: 18px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md); background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); } .summary-card, .table-card { grid-column: 1 / -1; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; } .kpi-card { display: flex; align-items: flex-start; gap: 11px; min-width: 0; padding: 15px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md); background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); } .kpi-card > div { display: grid; gap: 4px; min-width: 0; } .kpi-value { color: var(--ui-text); font-size: 1.45rem; font-variant-numeric: tabular-nums; } .kpi-detail { color: var(--ui-text-muted); font-size: 11px; line-height: 1.3; overflow-wrap: anywhere; } .status-label { display: inline-flex; align-items: center; min-height: 24px; padding: 3px 7px; border: 1px solid var(--ui-border-strong); border-radius: 999px; color: var(--ui-text); letter-spacing: normal; text-transform: none; white-space: nowrap; }
    .summary-copy { max-width: 72ch; } .summary-list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; } .summary-list div { display: grid; gap: 4px; padding: 12px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm); background: var(--ui-surface-subtle); } dt { color: var(--ui-text-muted); font-size: 11px; } dd { margin: 0; color: var(--ui-text); font-size: 1.2rem; font-weight: 800; }
    .privacy-notice { grid-column: 1 / -1; display: flex; align-items: flex-start; gap: 12px; padding: 18px; border: 2px solid var(--ui-border-strong); border-radius: var(--ui-radius-md); background: var(--ui-surface-subtle); } .privacy-notice h2 { color: var(--ui-text); } .privacy-notice p { margin-top: 5px; color: var(--ui-text-muted); font-size: 13px; line-height: 1.5; } .notice-marker { color: var(--ui-warning); }
    .table-wrap { min-width: 0; overflow-x: auto; } table { width: 100%; border-collapse: collapse; min-width: 620px; } caption { padding-bottom: 10px; color: var(--ui-text-muted); text-align: left; font-size: 12px; } th, td { padding: 11px 10px; border-bottom: 1px solid var(--ui-border); color: var(--ui-text); text-align: left; vertical-align: top; } th { color: var(--ui-text-muted); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; } td strong, td small { display: block; } td small { margin-top: 3px; color: var(--ui-text-muted); font-size: 11px; } .status-marker { display: inline-grid; place-items: center; width: 22px; height: 22px; border: 1px solid var(--ui-border-strong); border-radius: 50%; font-weight: 800; }
    @media (max-width: 900px) { .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } } @media (max-width: 600px) { .analytics-page { gap: 16px; padding: 0; } .page-heading, .section-heading { display: grid; gap: 8px; } .scope-context { justify-self: stretch; } .filter-bar { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; } .filter-bar label { min-width: 0; } .clear-action { width: 100%; } .kpi-grid { gap: 8px; } .kpi-card { padding: 12px; } .kpi-icon { width: 28px; height: 28px; } .kpi-value { font-size: 1.2rem; } .card, .privacy-notice { padding: 14px; } .summary-list { grid-template-columns: 1fr; } }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; } }
  `]
})
export class CohortAnalyticsComponent {
  readonly facade = inject(CohortAnalyticsFacade);
  requestKind(): RequestStateKind | null { const status = this.facade.requestState().status; return status === 'loading' || status === 'slow' || status === 'error' || status === 'unauthorized' ? status : null; }
  requestTitle(): string { const status = this.facade.requestState().status; if (status === 'slow') return 'Cohort analytics response is taking longer'; if (status === 'error') return 'Unable to load cohort analytics'; if (status === 'unauthorized') return 'Cohort analytics access unavailable'; return 'Loading cohort analytics'; }
  statusAnnouncement(): string { const state = this.facade.requestState(); if (state.status === 'ready' && this.facade.privacy().status === 'blocked') return `Cohort analytics ready. Individual comparison is blocked at ${this.facade.privacy().count} learners; minimum ${this.facade.privacy().minimum}.`; if (state.status === 'ready') return 'Cohort analytics ready.'; if (state.status === 'empty') return 'No cohort analytics match the selected filters.'; if (state.status === 'idle') return ''; return `${state.status[0]?.toUpperCase() ?? ''}${state.status.slice(1)} cohort analytics.`; }
  changeFilter(key: CohortAnalyticsFilterKey, event: Event): void { const target = event.target; if (!(target instanceof HTMLSelectElement)) return; const update: Partial<CohortAnalyticsFilters> = key === 'courseId' ? { courseId: target.value } : key === 'cohortId' ? { cohortId: target.value } : { dateRange: target.value }; this.facade.updateFilters(update); }
}
