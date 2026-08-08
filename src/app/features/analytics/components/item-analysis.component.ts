import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { RequestStateComponent, type RequestStateKind } from '../../../shared/components/request-state.component';
import {
  ItemAnalysisFacade,
  type ItemAnalysisFilterKey,
  type ItemAnalysisFilters
} from '../data-access/item-analysis.facade';
import type { ItemAnalysisRow } from '../domain/item-analysis';

@Component({
  selector: 'app-item-analysis',
  standalone: true,
  imports: [RequestStateComponent],
  providers: [ItemAnalysisFacade],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="analytics-page" aria-labelledby="item-analysis-heading">
      <header class="page-heading">
        <div>
          <span class="eyebrow">Authorized item-quality scope</span>
          <h1 id="item-analysis-heading">Item analysis</h1>
          @if (facade.scope(); as scope) {
            <p class="page-context"><strong>{{ scope.courseLabel }}</strong><span>{{ scope.role === 'INSTRUCTOR' ? 'Instructor teaching scope' : 'Measurement workspace scope' }}</span></p>
          } @else {
            <p class="page-context">Question evidence is limited to courses authorized for this account.</p>
          }
        </div>
        @if (facade.scope(); as scope) {
          <aside class="scope-context" aria-label="Authorized item analysis scope">
            <span class="context-marker" aria-hidden="true">Q</span>
            <div><span>Authorized course scope</span><strong>{{ scope.courseLabel }}</strong><small>{{ scope.courseIds.length }} course{{ scope.courseIds.length === 1 ? '' : 's' }}</small></div>
          </aside>
        }
      </header>

      <form class="filter-bar" aria-label="Item analysis filters" (submit)="$event.preventDefault()">
        <label><span>Course</span><select [value]="facade.filters().course" (change)="changeFilter('course', $event)"><option value="" [selected]="facade.filters().course === ''">All authorized courses</option>@for (option of facade.filterOptions().courses; track option.value) { @if (option.value !== '') { <option [value]="option.value" [selected]="facade.filters().course === option.value">{{ option.label }}</option> } }</select></label>
        <label><span>Outcome</span><select [value]="facade.filters().outcome" (change)="changeFilter('outcome', $event)"><option value="" [selected]="facade.filters().outcome === ''">All authorized outcomes</option>@for (option of facade.filterOptions().outcomes; track option.value) { @if (option.value !== '') { <option [value]="option.value" [selected]="facade.filters().outcome === option.value">{{ option.label }}</option> } }</select></label>
        <label><span>Difficulty</span><select [value]="facade.filters().difficulty" (change)="changeFilter('difficulty', $event)"><option value="" [selected]="facade.filters().difficulty === ''">All difficulties</option>@for (option of facade.filterOptions().difficulties; track option.value) { @if (option.value !== '') { <option [value]="option.value" [selected]="facade.filters().difficulty === option.value">{{ option.label }}</option> } }</select></label>
        <label><span>Type</span><select [value]="facade.filters().type" (change)="changeFilter('type', $event)"><option value="" [selected]="facade.filters().type === ''">All item types</option>@for (option of facade.filterOptions().types; track option.value) { @if (option.value !== '') { <option [value]="option.value" [selected]="facade.filters().type === option.value">{{ option.label }}</option> } }</select></label>
        <button class="clear-action" type="button" (click)="facade.clearFilters()">Clear filters</button>
        <button class="clear-action" type="button" (click)="facade.refresh()">Refresh analysis</button>
      </form>

      <p class="live-status" role="status" aria-live="polite">{{ statusAnnouncement() }}</p>

      @if (requestKind(); as kind) {
        <app-request-state [state]="kind" [title]="requestTitle()" [message]="facade.requestState().message" (retry)="facade.retry()" />
      } @else if (facade.requestState().status === 'empty') {
        <app-request-state state="empty" title="No item analysis for this selection" [message]="facade.requestState().message" />
      } @else {
        <div class="analytics-grid">
          <section class="kpi-region" aria-labelledby="kpi-heading">
            <div class="section-heading"><div><span class="eyebrow">Verified response evidence</span><h2 id="kpi-heading">Item-quality snapshot</h2></div><span class="status-label">Read only</span></div>
            <div class="kpi-grid">@for (kpi of facade.kpis(); track kpi.key) { <article class="kpi-card"><span class="kpi-icon" aria-hidden="true">{{ kpi.marker }}</span><div><span class="kpi-label">{{ kpi.label }}</span><strong class="kpi-value">{{ kpi.value }}</strong><span class="kpi-detail">{{ kpi.detail }}</span></div></article> }</div>
          </section>

          <section class="card table-card" aria-labelledby="items-heading">
            <div class="section-heading"><div><span class="eyebrow">Question-level metrics</span><h2 id="items-heading">Item quality records</h2></div><span class="status-label">{{ facade.rows().length }} items</span></div>
            <p class="table-intro">Facility is the mean earned fraction. Discrimination compares the highest-scoring 27% with the lowest-scoring 27%; multiple-choice option percentages can exceed 100% because learners may select more than one option.</p>
            <div class="table-wrap">
              <table class="item-table">
                <caption>Authorized item quality metrics. Headers are static labels, not sort controls.</caption>
                <thead><tr><th scope="col" aria-sort="none">Question</th><th scope="col" aria-sort="none">Facility / difficulty</th><th scope="col" aria-sort="none">Discrimination</th><th scope="col" aria-sort="none">Responses</th><th scope="col" aria-sort="none">Outcome / type</th><th scope="col" aria-sort="none">Option analysis</th></tr></thead>
                <tbody>
                  @for (row of facade.rows(); track row.questionId) {
                    <tr>
                      <td data-label="Question"><strong>{{ row.questionTitle }}</strong><small>{{ row.questionId }}</small></td>
                      <td data-label="Facility / difficulty"><strong>{{ facilityLabel(row) }}</strong><small>{{ row.difficulty }} difficulty; facility is mean earned fraction</small></td>
                      <td data-label="Discrimination"><strong>{{ discriminationLabel(row) }}</strong><small>{{ row.discriminationLabel === 'insufficient-data' ? 'Insufficient data: fewer than two distinct learners.' : 'Quality label: ' + row.discriminationLabel }}</small></td>
                      <td data-label="Responses"><strong>{{ row.responseCount }}</strong><small>attempt count; learner responses</small></td>
                      <td data-label="Outcome / type"><strong>{{ row.outcomeLabel }}</strong><small>{{ row.type }}</small></td>
                      <td data-label="Option analysis"><details><summary>Open option analysis</summary>@if (row.optionAnalysis.status === 'not-applicable') { <p class="not-applicable">Not applicable for non-choice items. This {{ row.type }} item has no configured option analysis.</p> } @else { <p class="option-note">{{ row.optionAnalysis.allowsMultipleSelections ? 'Multiple-choice percentages may sum above 100% because selections are counted per respondent.' : 'Percentage is the share of respondents selecting the configured option.' }}</p><div class="option-table-wrap"><table class="option-table"><caption>Configured option selections for {{ row.questionId }}</caption><thead><tr><th scope="col">Option</th><th scope="col">Count</th><th scope="col">Share</th><th scope="col">Correct</th></tr></thead><tbody>@for (option of row.optionAnalysis.rows; track option.optionId) { <tr><td><span>{{ option.label }}</span><small>{{ option.optionId }}</small></td><td>{{ option.selectionCount }}</td><td>{{ option.respondentPercentage }}%</td><td><span class="non-color-marker" aria-label="{{ option.isCorrect ? 'Correct option' : 'Not a correct option' }}">{{ option.isCorrect ? 'Correct' : '—' }}</span></td></tr> }</tbody></table></div>@if (row.optionAnalysis.unlistedSelectionCount > 0) { <p class="warning-copy" role="alert">Warning: {{ row.optionAnalysis.unlistedSelectionCount }} selected option{{ row.optionAnalysis.unlistedSelectionCount === 1 ? '' : 's' }} were not configured for this item and are excluded from configured-option rows.</p> } } </details></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        </div>
      }
    </main>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .analytics-page { display: grid; gap: 20px; min-width: 0; max-width: 100%; padding: 4px; overflow: hidden; }
    .page-heading, .section-heading, .filter-bar, .kpi-grid, .analytics-grid, .scope-context { min-width: 0; }
    .page-heading, .section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
    h1, h2, p { margin: 0; } h1 { color: var(--ui-text); font-size: clamp(1.5rem, 3vw, 2rem); line-height: 1.2; } h2 { color: var(--ui-text); font-size: 1.1rem; line-height: 1.3; }
    .eyebrow, .kpi-label, .filter-bar span, .status-label { color: var(--ui-text-muted); font-size: 10px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
    .page-context, .live-status, .table-intro, .option-note { color: var(--ui-text-muted); font-size: 13px; line-height: 1.5; } .page-context { display: grid; gap: 2px; margin-top: 5px; } .page-context strong { color: var(--ui-text); font-size: 14px; }
    .scope-context { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md); background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); } .scope-context div { display: grid; gap: 2px; } .scope-context span, .scope-context small { color: var(--ui-text-muted); font-size: 11px; } .scope-context strong { color: var(--ui-text); font-size: 13px; }
    .context-marker, .kpi-icon { display: grid; place-items: center; flex: 0 0 auto; width: 34px; height: 34px; border: 1px solid var(--ui-border-strong); border-radius: 10px; color: var(--ui-primary); font-weight: 850; }
    .filter-bar { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; padding: 14px 16px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md); background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); } .filter-bar label { display: grid; min-width: 150px; flex: 1 1 150px; gap: 5px; } select, button { min-height: 40px; border: 1px solid var(--ui-border-strong); border-radius: var(--ui-radius-sm); font: inherit; } select { min-width: 0; padding: 8px 10px; background: var(--ui-surface); color: var(--ui-text); } button { cursor: pointer; padding: 8px 14px; font-weight: 700; } select:focus-visible, button:focus-visible, summary:focus-visible { outline: 3px solid color-mix(in srgb, var(--ui-focus) 35%, transparent); outline-offset: 2px; } .clear-action { color: var(--ui-primary); background: var(--ui-surface-subtle); }
    .analytics-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 16px; } .kpi-region { grid-column: 1 / -1; display: grid; gap: 12px; } .card { display: grid; align-content: start; gap: 16px; min-width: 0; padding: 18px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md); background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); } .table-card { grid-column: 1 / -1; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; } .kpi-card { display: flex; align-items: flex-start; gap: 11px; min-width: 0; padding: 15px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md); background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); } .kpi-card > div { display: grid; gap: 4px; min-width: 0; } .kpi-value { color: var(--ui-text); font-size: 1.45rem; font-variant-numeric: tabular-nums; } .kpi-detail { color: var(--ui-text-muted); font-size: 11px; line-height: 1.3; overflow-wrap: anywhere; } .status-label { display: inline-flex; align-items: center; min-height: 24px; padding: 3px 7px; border: 1px solid var(--ui-border-strong); border-radius: 999px; color: var(--ui-text); }
    .table-intro { max-width: 85ch; } .table-wrap { min-width: 0; overflow-x: auto; } table { width: 100%; border-collapse: collapse; } .item-table { min-width: 900px; } caption { padding-bottom: 10px; color: var(--ui-text-muted); text-align: left; font-size: 12px; } th, td { padding: 11px 10px; border-bottom: 1px solid var(--ui-border); color: var(--ui-text); text-align: left; vertical-align: top; } th { color: var(--ui-text-muted); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; } td strong, td small { display: block; } td small { margin-top: 3px; color: var(--ui-text-muted); font-size: 11px; } td strong { overflow-wrap: anywhere; }
    details { min-width: 0; } summary { cursor: pointer; color: var(--ui-primary); font-weight: 750; } .option-note, .not-applicable, .warning-copy { margin-top: 10px; font-size: 12px; line-height: 1.45; } .not-applicable { color: var(--ui-text-muted); } .warning-copy { padding: 9px; border: 2px solid var(--ui-border-strong); color: var(--ui-text); background: var(--ui-surface-subtle); } .option-table-wrap { margin-top: 10px; overflow-x: auto; } .option-table { min-width: 420px; } .option-table th, .option-table td { padding: 7px 8px; font-size: 12px; } .option-table td small { font-size: 10px; }
    .non-color-marker { font-weight: 800; }
    @media (max-width: 900px) { .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 600px) { .analytics-page { gap: 16px; padding: 0; } .page-heading, .section-heading { display: grid; gap: 8px; } .scope-context { justify-self: stretch; } .filter-bar { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; } .filter-bar label { min-width: 0; } .clear-action { width: 100%; } .kpi-grid { gap: 8px; } .kpi-card { padding: 12px; } .kpi-icon { width: 28px; height: 28px; } .kpi-value { font-size: 1.2rem; } .card { padding: 14px; } .item-table, .option-table { min-width: 0; } .item-table, .item-table thead, .item-table tbody, .item-table tr, .item-table td { display: block; width: 100%; } .item-table thead { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; } .item-table tr { padding: 8px 0; border-bottom: 1px solid var(--ui-border); } .item-table td { display: grid; grid-template-columns: minmax(7rem, 34%) minmax(0, 1fr); gap: 8px; padding: 9px 0; border: 0; } .item-table td::before { content: attr(data-label); color: var(--ui-text-muted); font-size: 10px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; } .item-table td[data-label="Option analysis"] { display: block; } .item-table td[data-label="Option analysis"]::before { display: block; margin-bottom: 5px; } .option-table { display: table; width: 100%; } .option-table thead, .option-table tbody, .option-table tr, .option-table th, .option-table td { display: table-cell; width: auto; } .option-table thead { position: static; height: auto; margin: 0; overflow: visible; clip: auto; white-space: normal; } }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; } }
  `]
})
export class ItemAnalysisComponent {
  readonly facade = inject(ItemAnalysisFacade);

  requestKind(): RequestStateKind | null {
    const status = this.facade.requestState().status;
    return status === 'loading' || status === 'slow' || status === 'error' || status === 'unauthorized' ? status : null;
  }

  requestTitle(): string {
    const status = this.facade.requestState().status;
    if (status === 'slow') return 'Item analysis response is taking longer';
    if (status === 'error') return 'Unable to load item analysis';
    if (status === 'unauthorized') return 'Item analysis access unavailable';
    return 'Loading item analysis';
  }

  statusAnnouncement(): string {
    const state = this.facade.requestState();
    if (state.status === 'ready') return 'Item analysis ready.';
    if (state.status === 'empty') return 'No item analysis matches the selected filters.';
    if (state.status === 'idle') return '';
    return `${state.status[0]?.toUpperCase() ?? ''}${state.status.slice(1)} item analysis.`;
  }

  changeFilter(key: ItemAnalysisFilterKey, event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    const update: Partial<ItemAnalysisFilters> = { [key]: target.value };
    this.facade.updateFilters(update);
  }

  facilityLabel(row: ItemAnalysisRow): string {
    return `${Math.round(row.facilityIndex * 100)}% facility`;
  }

  discriminationLabel(row: ItemAnalysisRow): string {
    return row.discrimination === null ? 'Not available' : `${row.discrimination.toFixed(4)} (${row.discriminationLabel})`;
  }
}
