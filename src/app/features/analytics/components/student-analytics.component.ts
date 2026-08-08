import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { RequestStateComponent, type RequestStateKind } from '../../../shared/components/request-state.component';
import { RecommendationReasonCardComponent, type RecommendationReasonCardModel } from '../../adaptive-learning/components/recommendation-reason-card.component';
import { StudentAnalyticsFacade, type AnalyticsFilterKey, type StudentAnalyticsFilters, type StudentAnalyticsRecommendation } from '../data-access/student-analytics.facade';
import { MasteryHeatmapComponent, MasteryTrendComponent } from './analytics-visualizations.component';

@Component({
  selector: 'app-student-analytics',
  standalone: true,
  imports: [RequestStateComponent, RecommendationReasonCardComponent, MasteryHeatmapComponent, MasteryTrendComponent],
  providers: [StudentAnalyticsFacade],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="analytics-page" aria-labelledby="student-analytics-heading">
      <header class="page-heading">
        <div>
          <span class="eyebrow">Student-scoped analytics</span>
          <h1 id="student-analytics-heading">Mastery analytics</h1>
          @if (facade.studentContext(); as student) {
            <p class="page-context"><strong>{{ student.pseudonym }}</strong><span>{{ student.courseLabel }} · {{ student.cohortLabel }}</span></p>
          } @else {
            <p class="page-context">Analytics is limited to the selected student and authorized course scope.</p>
          }
        </div>
        @if (facade.studentContext(); as student) {
          <aside class="student-context" aria-label="Selected student context"><span class="context-marker" aria-hidden="true">S</span><div><span>Selected student</span><strong>{{ student.pseudonym }}</strong><small>{{ student.id }}</small></div></aside>
        }
      </header>

      <form class="filter-bar" aria-label="Student analytics filters" (submit)="$event.preventDefault()">
        <label><span>Course</span><select [value]="facade.filters().courseId" (change)="changeFilter('courseId', $event)"><option value="" [selected]="facade.filters().courseId === ''">All authorized courses</option>@for (option of facade.filterOptions().courses; track option.value) { <option [value]="option.value" [selected]="facade.filters().courseId === option.value">{{ option.label }}</option> }</select></label>
        <label><span>Date range</span><select [value]="facade.filters().dateRange" (change)="changeFilter('dateRange', $event)">@for (option of facade.filterOptions().dateRanges; track option.value) { <option [value]="option.value" [selected]="facade.filters().dateRange === option.value">{{ option.label }}</option> }</select></label>
        <label><span>Outcome</span><select [value]="facade.filters().outcomeId" (change)="changeFilter('outcomeId', $event)"><option value="" [selected]="facade.filters().outcomeId === ''">All outcomes</option>@for (option of facade.filterOptions().outcomes; track option.value) { <option [value]="option.value" [selected]="facade.filters().outcomeId === option.value">{{ option.label }}</option> }</select></label>
        <button class="clear-action" type="button" (click)="facade.clearFilters()">Clear filters</button>
      </form>

      <p class="live-status" role="status" aria-live="polite">{{ statusAnnouncement() }}</p>

      @if (requestKind(); as kind) {
        <app-request-state [state]="kind" [title]="requestTitle()" [message]="facade.requestState().message" (retry)="facade.retry()" />
      } @else if (facade.requestState().status === 'empty') {
        <app-request-state state="empty" title="No analytics for this selection" [message]="facade.requestState().message" />
      } @else {
        <div class="analytics-grid">
          <section class="kpi-region" aria-labelledby="kpi-heading">
            <div class="section-heading"><div><span class="eyebrow">Verified attempt evidence</span><h2 id="kpi-heading">Student snapshot</h2></div><span class="status-label">Read only</span></div>
            <div class="kpi-grid">
              @for (kpi of facade.kpis(); track kpi.key) { <article class="kpi-card"><span class="kpi-icon" aria-hidden="true">{{ kpi.marker }}</span><div><span class="kpi-label">{{ kpi.label }}</span><strong class="kpi-value">{{ kpi.value }}</strong><span class="kpi-detail">{{ kpi.detail }}</span></div></article> }
            </div>
          </section>

          <section class="card trend-card" aria-labelledby="trend-region-heading">
            <div class="section-heading"><div><span class="eyebrow">Time series</span><h2 id="trend-region-heading">Mastery trend</h2></div><span class="status-label">Lazy visual</span></div>
            @defer (on viewport) { <app-mastery-trend [rows]="facade.trendRows()" [summary]="facade.trendSummary()" /> } @placeholder { <div class="chart-placeholder" role="status" aria-live="polite"><span class="placeholder-marker" aria-hidden="true">◌</span><strong>Mastery trend will load when visible</strong><span>Accessible trend table activates with the visual.</span></div> } @loading { <div class="chart-placeholder" role="status"><span class="placeholder-marker" aria-hidden="true">…</span><strong>Loading mastery trend</strong></div> }
          </section>

          <section class="card heatmap-card" aria-labelledby="heatmap-region-heading">
            <div class="section-heading"><div><span class="eyebrow">Outcome evidence</span><h2 id="heatmap-region-heading">Mastery heatmap</h2></div><span class="status-label">Table alternative</span></div>
            <app-mastery-heatmap [rows]="facade.heatmapRows()" [legend]="facade.heatmapLegend()" [summary]="facade.heatmapTableSummary()" />
          </section>

          <section class="card recommendation-panel" aria-labelledby="recommendation-heading">
            <div class="section-heading"><div><span class="eyebrow">Rule-based adaptive output</span><h2 id="recommendation-heading">Recommended next steps</h2></div><span class="status-label">Explainable</span></div>
            @if (facade.recommendations().length === 0) { <p class="inline-empty">No eligible recommendations remain after completed and locked content is excluded.</p> } @else { <div class="recommendation-list">@for (recommendation of facade.recommendations(); track recommendation.contentId) { <app-recommendation-reason-card [recommendation]="recommendationModel(recommendation)" /> }</div> }
          </section>

          <aside class="card risk-panel" aria-labelledby="risk-heading">
            <div class="section-heading"><div><span class="eyebrow">Selected-student context</span><h2 id="risk-heading">Support signal</h2></div></div>
            <div class="risk-summary" [attr.data-band]="facade.riskStatus().band"><span class="risk-marker" aria-hidden="true">{{ facade.riskStatus().marker }}</span><div><strong>{{ facade.riskStatus().label }}</strong><p>{{ facade.riskStatus().detail }}</p></div></div>
            <p class="scope-disclaimer">This read-only signal describes this student only. No cohort comparison or risky-student table is rendered in this slice.</p>
          </aside>
        </div>
      }
    </main>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .analytics-page { display: grid; gap: 20px; min-width: 0; max-width: 100%; padding: 4px; overflow: hidden; }
    .page-heading, .section-heading, .filter-bar, .kpi-grid, .analytics-grid, .student-context, .risk-summary { min-width: 0; }
    .page-heading, .section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
    h1, h2, p { margin: 0; }
    h1 { color: var(--ui-text); font-size: clamp(1.5rem, 3vw, 2rem); line-height: 1.2; }
    h2 { color: var(--ui-text); font-size: 1.1rem; line-height: 1.3; }
    .eyebrow, .kpi-label, .filter-bar span, .status-label { color: var(--ui-text-muted); font-size: 10px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
    .page-context, .live-status, .inline-empty, .scope-disclaimer { color: var(--ui-text-muted); font-size: 13px; line-height: 1.5; }
    .page-context { display: grid; gap: 2px; margin-top: 5px; }
    .page-context strong { color: var(--ui-text); font-size: 14px; }
    .student-context { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md); background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); }
    .student-context div { display: grid; gap: 2px; }
    .student-context span, .student-context small { color: var(--ui-text-muted); font-size: 11px; }
    .student-context strong { color: var(--ui-text); font-size: 13px; }
    .context-marker, .kpi-icon, .risk-marker { display: grid; place-items: center; flex: 0 0 auto; width: 34px; height: 34px; border: 1px solid var(--ui-border-strong); border-radius: 10px; color: var(--ui-primary); font-weight: 850; }
    .filter-bar { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; padding: 14px 16px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md); background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); }
    .filter-bar label { display: grid; min-width: 170px; flex: 1 1 170px; gap: 5px; }
    select, button { min-height: 40px; border: 1px solid var(--ui-border-strong); border-radius: var(--ui-radius-sm); font: inherit; }
    select { min-width: 0; padding: 8px 10px; background: var(--ui-surface); color: var(--ui-text); }
    button { cursor: pointer; padding: 8px 14px; font-weight: 700; }
    select:focus-visible, button:focus-visible { outline: 3px solid color-mix(in srgb, var(--ui-focus) 35%, transparent); outline-offset: 2px; }
    .clear-action { border-color: var(--ui-primary); background: var(--ui-primary-soft); color: var(--ui-primary); }
    .live-status { min-height: 1.3em; margin-top: -10px; }
    .analytics-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 16px; }
    .kpi-region { grid-column: 1 / -1; display: grid; gap: 12px; }
    .card { display: grid; align-content: start; gap: 16px; min-width: 0; padding: 18px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md); background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); }
    .trend-card { grid-column: span 7; }
    .heatmap-card { grid-column: span 5; }
    .recommendation-panel { grid-column: span 7; }
    .risk-panel { grid-column: span 5; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .kpi-card { display: flex; align-items: flex-start; gap: 11px; min-width: 0; padding: 15px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md); background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); }
    .kpi-card > div { display: grid; gap: 4px; min-width: 0; }
    .kpi-value { color: var(--ui-text); font-size: 1.45rem; font-variant-numeric: tabular-nums; }
    .kpi-detail { color: var(--ui-text-muted); font-size: 11px; line-height: 1.3; overflow-wrap: anywhere; }
    .status-label { display: inline-flex; align-items: center; min-height: 24px; padding: 3px 7px; border: 1px solid var(--ui-border-strong); border-radius: 999px; color: var(--ui-text); letter-spacing: normal; text-transform: none; white-space: nowrap; }
    .chart-placeholder { display: grid; justify-items: start; gap: 5px; min-height: 250px; align-content: center; padding: 18px; border: 1px dashed var(--ui-border-strong); border-radius: var(--ui-radius-sm); background: var(--ui-surface-subtle); color: var(--ui-text-muted); font-size: 12px; }
    .chart-placeholder strong { color: var(--ui-text); }
    .placeholder-marker { font-size: 22px; }
    .recommendation-list { display: grid; gap: 12px; max-height: 640px; overflow-y: auto; padding: 2px; }
    .risk-summary { display: flex; align-items: flex-start; gap: 12px; padding: 14px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm); background: var(--ui-surface-subtle); }
    .risk-summary strong { color: var(--ui-text); }
    .risk-summary p { margin-top: 4px; color: var(--ui-text-muted); font-size: 12px; line-height: 1.5; }
    .risk-summary[data-band="elevated"] .risk-marker { color: var(--ui-danger); } .risk-summary[data-band="moderate"] .risk-marker { color: var(--ui-warning); } .risk-summary[data-band="low"] .risk-marker { color: var(--ui-success); }
    .scope-disclaimer { padding-top: 3px; }
    @media (max-width: 900px) { .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .trend-card, .heatmap-card, .recommendation-panel, .risk-panel { grid-column: 1 / -1; } }
    @media (max-width: 600px) { .analytics-page { gap: 16px; padding: 0; } .page-heading, .section-heading { display: grid; gap: 8px; } .student-context { justify-self: stretch; } .filter-bar { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; } .filter-bar label { min-width: 0; } .clear-action { width: 100%; } .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; } .kpi-card { padding: 12px; } .kpi-icon { width: 28px; height: 28px; } .kpi-value { font-size: 1.2rem; } .card { padding: 14px; } .recommendation-list { max-height: none; } }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; } }
  `]
})
export class StudentAnalyticsComponent {
  readonly facade = inject(StudentAnalyticsFacade);

  requestKind(): RequestStateKind | null {
    const status = this.facade.requestState().status;
    return status === 'loading' || status === 'slow' || status === 'error' || status === 'unauthorized' ? status : null;
  }
  requestTitle(): string {
    const status = this.facade.requestState().status;
    if (status === 'slow') return 'Analytics response is taking longer';
    if (status === 'error') return 'Unable to load student analytics';
    if (status === 'unauthorized') return 'Student analytics access unavailable';
    return 'Loading student analytics';
  }
  statusAnnouncement(): string {
    const status = this.facade.requestState().status;
    return status === 'ready' ? 'Student analytics ready.' : status === 'empty' ? 'No analytics match the selected filters.' : status === 'idle' ? '' : `${status[0]?.toUpperCase() ?? ''}${status.slice(1)} student analytics.`;
  }
  changeFilter(key: AnalyticsFilterKey, event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    const update: Partial<StudentAnalyticsFilters> = key === 'courseId' ? { courseId: target.value } : key === 'dateRange' ? { dateRange: target.value } : { outcomeId: target.value };
    this.facade.updateFilters(update);
  }
  recommendationModel(value: StudentAnalyticsRecommendation): RecommendationReasonCardModel { return value; }
}
