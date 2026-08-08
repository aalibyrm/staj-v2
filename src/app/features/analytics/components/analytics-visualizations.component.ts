import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { HeatmapLegendItem, HeatmapRow, MasteryTrendRow, MasteryTrendSummary } from '../data-access/student-analytics.facade';

@Component({
  selector: 'app-mastery-trend',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="trend-visual" aria-labelledby="mastery-trend-title">
      <div class="chart-heading">
        <div><span class="eyebrow">Attempt history</span><h3 id="mastery-trend-title">Student mastery trend</h3></div>
        <span class="chart-badge">{{ rows().length }} periods</span>
      </div>
      <p class="summary" aria-live="polite">{{ summary().text }} {{ summary().changeLabel }}</p>
      <svg class="trend-svg" viewBox="0 0 720 220" role="img" aria-label="Mastery trend visual summary" aria-hidden="true" focusable="false">
        <line x1="50" y1="20" x2="50" y2="190" class="axis" /><line x1="50" y1="190" x2="690" y2="190" class="axis" />
        @for (row of rows(); track row.period; let index = $index) {
          <circle [attr.cx]="pointX(index)" [attr.cy]="pointY(row.score)" r="5" class="point" />
          @if (index > 0) { <line [attr.x1]="pointX(index - 1)" [attr.y1]="pointY(rows()[index - 1]?.score ?? null)" [attr.x2]="pointX(index)" [attr.y2]="pointY(row.score)" class="line" /> }
        }
      </svg>
      <div class="trend-table-wrap">
        <table class="trend-table">
          <caption>Mastery trend by period with numeric values and status labels</caption>
          <thead><tr><th scope="col">Period</th><th scope="col">Mastery</th><th scope="col">Status</th><th scope="col">Attempts</th></tr></thead>
          <tbody>
            @for (row of rows(); track row.period) {
              <tr><th scope="row">{{ row.periodLabel }}</th><td>{{ row.scoreLabel }}</td><td><span class="status-marker" aria-hidden="true">{{ marker(row.score) }}</span> {{ row.statusLabel }}</td><td>{{ row.attemptCount }}</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .trend-visual { display: grid; gap: 14px; min-width: 0; }
    .chart-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    h3, p { margin: 0; }
    h3 { color: var(--ui-text); font-size: 16px; }
    .eyebrow { color: var(--ui-text-muted); font-size: 10px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
    .chart-badge { border: 1px solid var(--ui-border-strong); border-radius: 999px; color: var(--ui-text-muted); font-size: 11px; padding: 4px 8px; white-space: nowrap; }
    .summary { border-left: 3px solid var(--ui-primary); background: var(--ui-primary-soft); color: var(--ui-text); font-size: 12px; line-height: 1.5; padding: 9px 11px; }
    .trend-svg { display: block; width: 100%; height: auto; min-height: 150px; background: linear-gradient(180deg, var(--ui-surface) 0%, var(--ui-surface-subtle) 100%); border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm); }
    .axis { stroke: var(--ui-border-strong); stroke-width: 1; }
    .line { stroke: var(--ui-primary); stroke-width: 3; stroke-linecap: round; }
    .point { fill: var(--ui-surface); stroke: var(--ui-primary); stroke-width: 3; }
    .trend-table-wrap { min-width: 0; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; color: var(--ui-text); font-size: 12px; }
    th, td { border-bottom: 1px solid var(--ui-border); padding: 8px; text-align: left; white-space: nowrap; }
    thead th { color: var(--ui-text-muted); font-size: 10px; text-transform: uppercase; }
    .status-marker { display: inline-grid; width: 20px; height: 20px; place-items: center; border: 1px solid var(--ui-border-strong); border-radius: 50%; font-weight: 800; }
    caption { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; } }
  `]
})
export class MasteryTrendComponent {
  readonly rows = input.required<readonly MasteryTrendRow[]>();
  readonly summary = input.required<MasteryTrendSummary>();
  readonly maxScore = computed(() => Math.max(1, ...this.rows().map((row) => row.score ?? 0)));
  pointX(index: number): number { return this.rows().length <= 1 ? 360 : 50 + (640 * index) / (this.rows().length - 1); }
  pointY(score: number | null): number { return score === null ? 190 : 190 - (score / this.maxScore()) * 150; }
  marker(score: number | null): string { return score === null ? '?' : score >= 0.85 ? '✓' : score >= 0.6 ? 'P' : score >= 0.4 ? 'A' : 'D'; }
}

@Component({
  selector: 'app-mastery-heatmap',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="heatmap-visual" aria-labelledby="mastery-heatmap-title">
      <div class="chart-heading"><div><span class="eyebrow">Outcome evidence</span><h3 id="mastery-heatmap-title">Outcome by period mastery</h3></div><span class="chart-badge">{{ rows().length }} outcomes</span></div>
      <p class="summary" aria-live="polite">{{ summary() }}</p>
      <div class="legend" aria-label="Mastery band legend">
        @for (item of legend(); track item.band) { <span class="legend-item"><span class="legend-marker" aria-hidden="true">{{ item.marker }}</span><strong>{{ item.label }}</strong><span>{{ item.range }}</span></span> }
      </div>
      <div class="table-scroll" tabindex="0" aria-label="Scrollable outcome mastery table">
        <table class="heatmap-table">
          <caption>Outcome mastery by period. Every cell includes a percentage and a text status.</caption>
          <thead><tr><th scope="col">Outcome</th>@for (period of periods(); track period) { <th scope="col">{{ period }}</th> }</tr></thead>
          <tbody>
            @for (row of rows(); track row.outcomeId) {
              <tr><th scope="row"><strong>{{ row.outcomeCode }}</strong><small>{{ row.outcomeTitle }}</small></th>@for (cell of row.cells; track cell.period) { <td [attr.data-band]="cell.band"><span class="cell-marker" aria-hidden="true">{{ marker(cell.band) }}</span><strong>{{ cell.scoreLabel }}</strong><small>{{ cell.statusLabel }}</small></td> }</tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .heatmap-visual { display: grid; gap: 14px; min-width: 0; }
    .chart-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    h3, p { margin: 0; }
    h3 { color: var(--ui-text); font-size: 16px; }
    .eyebrow { color: var(--ui-text-muted); font-size: 10px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
    .chart-badge { border: 1px solid var(--ui-border-strong); border-radius: 999px; color: var(--ui-text-muted); font-size: 11px; padding: 4px 8px; white-space: nowrap; }
    .summary { border-left: 3px solid var(--ui-teal); background: var(--ui-surface-subtle); color: var(--ui-text); font-size: 12px; line-height: 1.5; padding: 9px 11px; }
    .legend { display: flex; flex-wrap: wrap; gap: 8px 12px; color: var(--ui-text-muted); font-size: 11px; }
    .legend-item { display: inline-flex; align-items: center; gap: 5px; }
    .legend-marker, .cell-marker { display: inline-grid; width: 21px; height: 21px; place-items: center; border: 1px solid var(--ui-border-strong); border-radius: 5px; color: var(--ui-text); font-size: 10px; font-weight: 800; }
    .table-scroll { min-width: 0; max-width: 100%; overflow-x: auto; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm); }
    .table-scroll:focus-visible { outline: 3px solid color-mix(in srgb, var(--ui-focus) 35%, transparent); outline-offset: 2px; }
    table { width: 100%; min-width: 680px; border-collapse: collapse; color: var(--ui-text); font-size: 11px; }
    th, td { border-bottom: 1px solid var(--ui-border); border-right: 1px solid var(--ui-border); padding: 8px; text-align: left; vertical-align: top; }
    thead th { background: var(--ui-surface-subtle); color: var(--ui-text-muted); font-size: 10px; text-transform: uppercase; white-space: nowrap; }
    tbody th { min-width: 170px; }
    tbody th strong, tbody th small, td strong, td small { display: block; }
    tbody th small, td small { margin-top: 3px; color: var(--ui-text-muted); font-size: 10px; }
    td { min-width: 78px; }
    td[data-band="developing"] { background: var(--ui-danger-soft); } td[data-band="approaching"] { background: var(--ui-warning-soft); } td[data-band="proficient"] { background: var(--ui-success-soft); } td[data-band="advanced"] { background: color-mix(in srgb, var(--ui-teal) 12%, var(--ui-surface)); }
    @media (max-width: 600px) { .legend { gap: 7px; } .table-scroll { overscroll-behavior-x: contain; } }
  `]
})
export class MasteryHeatmapComponent {
  readonly rows = input.required<readonly HeatmapRow[]>();
  readonly legend = input.required<readonly HeatmapLegendItem[]>();
  readonly summary = input.required<string>();
  readonly periods = computed(() => this.rows()[0]?.cells.map((cell) => cell.periodLabel) ?? []);
  marker(band: string): string { return band === 'advanced' ? '✓' : band === 'proficient' ? 'P' : band === 'approaching' ? 'A' : band === 'developing' ? 'D' : '?'; }
}
