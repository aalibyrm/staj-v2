import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import {
  type ExamBlueprint,
  type ExamBlueprintBucketComparison,
  type ExamBlueprintComparison,
  type ExamBlueprintComparisonAggregateStatus
} from '../models/exam-blueprint.models';

@Component({
  selector: 'app-blueprint-constraint-panel',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="constraint-panel" aria-labelledby="constraint-panel-heading">
      <header class="panel-heading">
        <div>
          <span class="eyebrow">Coverage comparison</span>
          <h2 id="constraint-panel-heading">Target versus current coverage</h2>
          <p class="panel-description">Every target count and point bucket is compared with the selected coverage.</p>
        </div>
        <span class="aggregate-status" [attr.data-status]="comparison.status">
          <span aria-hidden="true">{{ statusSymbol(comparison.status) }}</span>&ngsp;
          <span>{{ aggregateLabel(comparison.status) }}</span>
        </span>
      </header>

      <p class="sr-only" id="constraint-panel-summary">{{ accessibleSummary() }}</p>
      <div class="matrix-scroll" tabindex="0" role="region" aria-label="Blueprint target and current coverage matrix">
        <table class="coverage-matrix">
          <caption>Blueprint target and current coverage by outcome, difficulty, and question type</caption>
          <thead>
            <tr>
              <th scope="col" class="key-column">Dimension / bucket</th>
              <th scope="col">Target count</th>
              <th scope="col">Current count</th>
              <th scope="col">Target points</th>
              <th scope="col">Current points</th>
              <th scope="col" class="status-column">Status and reason</th>
            </tr>
          </thead>
          <tbody>
            <tr class="dimension-row"><th scope="rowgroup" colspan="6">Outcome</th></tr>
            <tr *ngFor="let row of comparison.outcomeBuckets; trackBy: trackByKey">
              <th scope="row" class="key-column">{{ keyLabel(row.key) }}</th>
              <td>{{ row.targetQuestionCount }}</td>
              <td>{{ row.currentQuestionCount }}</td>
              <td>{{ formatPoints(row.targetPoints) }}</td>
              <td>{{ formatPoints(row.currentPoints) }}</td>
              <td class="status-column"><span class="row-status" [attr.data-status]="row.status">{{ statusSymbol(row.status) }} {{ statusLabel(row.status) }}</span><span class="reason">{{ row.reason }}</span></td>
            </tr>
            <tr class="dimension-row"><th scope="rowgroup" colspan="6">Difficulty</th></tr>
            <tr *ngFor="let row of comparison.difficultyBuckets; trackBy: trackByKey">
              <th scope="row" class="key-column">{{ keyLabel(row.key) }}</th>
              <td>{{ row.targetQuestionCount }}</td>
              <td>{{ row.currentQuestionCount }}</td>
              <td>{{ formatPoints(row.targetPoints) }}</td>
              <td>{{ formatPoints(row.currentPoints) }}</td>
              <td class="status-column"><span class="row-status" [attr.data-status]="row.status">{{ statusSymbol(row.status) }} {{ statusLabel(row.status) }}</span><span class="reason">{{ row.reason }}</span></td>
            </tr>
            <tr class="dimension-row"><th scope="rowgroup" colspan="6">Question type</th></tr>
            <tr *ngFor="let row of comparison.questionTypeBuckets; trackBy: trackByKey">
              <th scope="row" class="key-column">{{ keyLabel(row.key) }}</th>
              <td>{{ row.targetQuestionCount }}</td>
              <td>{{ row.currentQuestionCount }}</td>
              <td>{{ formatPoints(row.targetPoints) }}</td>
              <td>{{ formatPoints(row.currentPoints) }}</td>
              <td class="status-column"><span class="row-status" [attr.data-status]="row.status">{{ statusSymbol(row.status) }} {{ statusLabel(row.status) }}</span><span class="reason">{{ row.reason }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="totals">{{ accessibleSummary() }}</p>
    </section>
  `,
  styles: [`
    :host { display:block; min-width:0; }
    .constraint-panel { display:grid; gap:16px; padding:20px; border:1px solid var(--ui-border); border-radius:var(--ui-radius-md); background:var(--ui-surface); box-shadow:var(--ui-shadow-sm); min-width:0; }
    .panel-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
    h2, p { margin:0; }
    h2 { font-size:18px; }
    .eyebrow { color:var(--ui-text-muted); font-size:11px; font-weight:750; letter-spacing:.05em; text-transform:uppercase; }
    .panel-description, .reason { color:var(--ui-text-muted); font-size:12px; }
    .aggregate-status, .row-status { display:inline-flex; align-items:center; gap:5px; border:1px solid var(--ui-border-strong); border-radius:999px; padding:4px 9px; font-size:12px; font-weight:750; white-space:nowrap; }
    .aggregate-status[data-status="valid"], .row-status[data-status="met"] { background:var(--ui-success-soft); color:#166534; }
    .aggregate-status[data-status="partial"], .row-status[data-status="excess"] { background:var(--ui-warning-soft); color:#92400e; }
    .aggregate-status[data-status="missing"], .row-status[data-status="missing"] { background:var(--ui-danger-soft); color:#991b1b; }
    .matrix-scroll { max-width:100%; overflow-x:auto; border:1px solid var(--ui-border); border-radius:var(--ui-radius-sm); }
    .coverage-matrix { width:100%; min-width:780px; border-collapse:separate; border-spacing:0; font-size:13px; font-variant-numeric:tabular-nums; }
    caption { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
    th, td { border-bottom:1px solid var(--ui-border); padding:10px 12px; text-align:left; vertical-align:top; }
    thead th { background:var(--ui-surface-subtle); color:var(--ui-text-muted); font-size:11px; letter-spacing:.02em; text-transform:uppercase; }
    .dimension-row th { background:var(--ui-primary-soft); color:var(--ui-text); font-size:12px; letter-spacing:.03em; text-transform:uppercase; }
    tbody tr:last-child th, tbody tr:last-child td { border-bottom:0; }
    .key-column { position:sticky; left:0; z-index:1; min-width:180px; background:var(--ui-surface); }
    thead .key-column { background:var(--ui-surface-subtle); z-index:3; }
    .dimension-row .key-column, .dimension-row th { position:static; }
    .status-column { position:sticky; right:0; z-index:1; min-width:240px; background:var(--ui-surface); }
    thead .status-column { background:var(--ui-surface-subtle); z-index:3; }
    .reason { display:block; margin-top:4px; line-height:1.35; }
    .totals { color:var(--ui-text-muted); font-size:13px; }
    .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
    @media (max-width:760px) { .constraint-panel { padding:16px; } .panel-heading { flex-direction:column; } .aggregate-status { align-self:flex-start; } }
  `]
})
export class BlueprintConstraintPanelComponent {
  @Input({ required: true }) target!: ExamBlueprint;
  @Input({ required: true }) comparison!: ExamBlueprintComparison;

  aggregateLabel(status: ExamBlueprintComparisonAggregateStatus): string {
    return status === 'valid' ? 'Valid' : status === 'partial' ? 'Partial coverage' : 'Missing coverage';
  }

  statusLabel(status: string): string {
    return status === 'met' ? 'Met' : status === 'missing' ? 'Missing' : status === 'excess' ? 'Excess' : this.aggregateLabel(status as ExamBlueprintComparisonAggregateStatus);
  }

  statusSymbol(status: string): string {
    return status === 'met' || status === 'valid' ? '✓' : status === 'missing' ? '!' : '△';
  }

  formatPoints(value: number): string {
    return value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 6 });
  }

  keyLabel(value: string): string {
    return value.replace(/-/g, ' ');
  }

  trackByKey(_index: number, row: ExamBlueprintBucketComparison): string {
    return row.key;
  }

  accessibleSummary(): string {
    return `${this.comparison.summary} Target total: ${this.target.targetQuestionCount} questions and ${this.formatPoints(this.target.targetPoints)} points.`;
  }
}
