import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import {
  BlueprintConstraintEditorComponent
} from './blueprint-constraint-editor.component';
import { BlueprintConstraintPanelComponent } from './blueprint-constraint-panel.component';
import { ExamBuilderFacade } from '../data-access/exam-builder.facade';
import type { ExamBlueprintBucketComparison } from '../models/exam-blueprint.models';

@Component({
  selector: 'app-exam-builder',
  standalone: true,
  imports: [CommonModule, BlueprintConstraintEditorComponent, BlueprintConstraintPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="exam-builder-page" aria-labelledby="exam-builder-heading">
      <header class="page-header">
        <div>
          <span class="eyebrow">Exam builder</span>
          <h1 id="exam-builder-heading">Build an exam blueprint</h1>
          <p>Define the blueprint, compare selected coverage, and resolve every constraint before later exam steps.</p>
        </div>
      </header>

      <nav class="stepper-region" aria-label="Exam creation steps">
        <ol class="stepper">
          <li class="step step--active" aria-current="step"><span class="step-number">1</span><span><strong>Blueprint</strong><small>Define constraints</small></span></li>
          <li class="step"><span class="step-number">2</span><span><strong>Question selection</strong><small>Available in a later step</small></span></li>
          <li class="step"><span class="step-number">3</span><span><strong>Settings</strong><small>Available in a later step</small></span></li>
          <li class="step"><span class="step-number">4</span><span><strong>Publish review</strong><small>Available in a later step</small></span></li>
        </ol>
      </nav>

      <p class="sr-only" role="status" aria-live="polite">{{ facade.liveUpdateText() }}</p>

      <div class="content-grid">
        <section class="primary-column" aria-label="Blueprint coverage and definition">
          <app-blueprint-constraint-panel
            [target]="facade.target()"
            [comparison]="facade.comparison()"
          />

          <details class="editor-disclosure">
            <summary>Adjust blueprint constraints</summary>
            <p class="editor-disclosure-description">Open the subordinate editor to revise the target counts and points.</p>
            <app-blueprint-constraint-editor
              [outcomeChoices]="facade.outcomeChoices()"
              [initialBlueprint]="facade.target()"
              (submitted)="facade.applyBlueprint($event)"
            />
          </details>
        </section>

        <aside class="secondary-column" aria-label="Validation and settings">
          <section class="summary-card" [attr.data-status]="facade.comparison().status" aria-labelledby="validation-summary-heading">
            <div class="card-heading"><span class="eyebrow">Validation summary</span><span class="summary-status">{{ facade.comparison().status | titlecase }}</span></div>
            <h2 id="validation-summary-heading">{{ facade.comparison().summary }}</h2>
            <p>{{ summaryDescription() }}</p>
            <ul *ngIf="unmetRows().length > 0" class="reason-list">
              <li *ngFor="let row of unmetRows(); trackBy: trackByKey"><strong>{{ row.key }}</strong><span>{{ row.reason }}</span></li>
            </ul>
          </section>

          <section class="settings-shell" aria-labelledby="settings-shell-heading">
            <span class="eyebrow">Later step</span>
            <h2 id="settings-shell-heading">Settings</h2>
            <p>Exam settings will appear after question selection is implemented. No settings are editable in this blueprint step.</p>
            <dl>
              <div><dt>Current step</dt><dd>Blueprint</dd></div>
              <div><dt>Next step</dt><dd>Question selection</dd></div>
            </dl>
          </section>
        </aside>
      </div>
    </main>
  `,
  styles: [`
    :host { display:block; min-width:0; }
    .exam-builder-page { max-width:1320px; min-width:0; margin:0 auto; padding:24px 28px 40px; display:grid; gap:20px; }
    .page-header { display:flex; justify-content:space-between; gap:16px; }
    h1, h2, p { margin:0; }
    h1 { margin-top:3px; font-size:28px; line-height:1.2; }
    h2 { font-size:17px; line-height:1.35; }
    .page-header p { margin-top:6px; color:var(--ui-text-muted); font-size:14px; }
    .eyebrow { color:var(--ui-text-muted); font-size:11px; font-weight:750; letter-spacing:.05em; text-transform:uppercase; }
    .stepper-region { border:1px solid var(--ui-border); border-radius:var(--ui-radius-md); background:var(--ui-surface); box-shadow:var(--ui-shadow-sm); }
    .stepper { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); list-style:none; margin:0; padding:14px 18px; gap:10px; }
    .step { display:flex; align-items:center; gap:9px; min-width:0; color:var(--ui-text-muted); }
    .step-number { display:grid; place-items:center; width:28px; height:28px; flex:0 0 28px; border:1px solid var(--ui-border-strong); border-radius:50%; font-size:12px; font-weight:800; }
    .step strong, .step small { display:block; }
    .step strong { color:var(--ui-text); font-size:13px; }
    .step small { margin-top:2px; font-size:11px; line-height:1.25; }
    .step--active .step-number { border-color:var(--ui-primary); background:var(--ui-primary); color:#fff; }
    .step--active small { color:var(--ui-primary); }
    .content-grid { display:grid; grid-template-columns:minmax(0,1fr) 340px; align-items:start; gap:20px; min-width:0; }
    .primary-column, .secondary-column { display:grid; gap:20px; min-width:0; }
    .editor-disclosure { display:grid; gap:12px; padding:14px; border:1px solid var(--ui-border); border-radius:var(--ui-radius-md); background:var(--ui-surface-subtle); }
    .editor-disclosure > summary { cursor:pointer; color:var(--ui-text); font-size:14px; font-weight:800; }
    .editor-disclosure-description { color:var(--ui-text-muted); font-size:13px; line-height:1.4; }
    .summary-card, .settings-shell { display:grid; gap:11px; padding:18px; border:1px solid var(--ui-border); border-radius:var(--ui-radius-md); background:var(--ui-surface); box-shadow:var(--ui-shadow-sm); }
    .summary-card[data-status="valid"] { border-color:var(--ui-success); }
    .summary-card[data-status="partial"] { border-color:var(--ui-warning); }
    .summary-card[data-status="missing"] { border-color:var(--ui-danger); }
    .card-heading { display:flex; align-items:center; justify-content:space-between; gap:10px; }
    .summary-status { border:1px solid var(--ui-border-strong); border-radius:999px; padding:3px 8px; font-size:11px; font-weight:800; text-transform:capitalize; }
    .summary-card p, .settings-shell p { color:var(--ui-text-muted); font-size:13px; line-height:1.45; }
    .reason-list { display:grid; gap:8px; margin:0; padding:0 0 0 18px; color:var(--ui-text-muted); font-size:12px; }
    .reason-list li { padding-left:2px; }
    .reason-list strong, .reason-list span { display:block; }
    .reason-list strong { color:var(--ui-text); font-size:12px; }
    dl { display:grid; gap:8px; margin:2px 0 0; }
    dl div { display:flex; justify-content:space-between; gap:12px; padding-top:8px; border-top:1px solid var(--ui-border); font-size:12px; }
    dt { color:var(--ui-text-muted); }
    dd { margin:0; font-weight:700; text-align:right; }
    .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
    @media (max-width:980px) { .exam-builder-page { padding:20px 18px 32px; } .content-grid { grid-template-columns:1fr; } .secondary-column { grid-template-columns:repeat(2,minmax(0,1fr)); align-items:start; } }
    @media (max-width:680px) { .exam-builder-page { padding:16px 12px 24px; } .stepper { grid-template-columns:1fr 1fr; } .secondary-column { grid-template-columns:1fr; } }
  `]
})
export class ExamBuilderComponent {
  readonly facade = inject(ExamBuilderFacade);
  readonly unmetRows = computed(() => {
    const comparison = this.facade.comparison();
    return [
      ...comparison.outcomeBuckets,
      ...comparison.difficultyBuckets,
      ...comparison.questionTypeBuckets
    ].filter((row) => row.status !== 'met');
  });

  summaryDescription(): string {
    const comparison = this.facade.comparison();
    return comparison.status === 'valid'
      ? 'All target count and point buckets match current coverage.'
      : 'Resolve the listed reasons before a later packet can select or publish an exam.';
  }

  trackByKey(_index: number, row: ExamBlueprintBucketComparison): string {
    return row.key;
  }
}
