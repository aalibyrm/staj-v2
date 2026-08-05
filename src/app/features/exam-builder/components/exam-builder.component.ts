import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { BlueprintConstraintEditorComponent } from './blueprint-constraint-editor.component';
import { BlueprintConstraintPanelComponent } from './blueprint-constraint-panel.component';
import { ExamBuilderFacade } from '../data-access/exam-builder.facade';
import type { ExamBlueprintBucketComparison } from '../models/exam-blueprint.models';
import type { ExamRuleInput } from '../models/exam.models';

@Component({
  selector: 'app-exam-builder',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, BlueprintConstraintEditorComponent, BlueprintConstraintPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="exam-builder-page" aria-labelledby="exam-builder-heading">
      <header class="page-header">
        <div>
          <span class="eyebrow">Exam builder</span>
          <h1 id="exam-builder-heading">Build an exam blueprint</h1>
          <p>Define the blueprint, pin published question versions, save a guarded draft, and publish only when every constraint matches.</p>
        </div>
      </header>

      <nav class="stepper-region" aria-label="Exam creation steps">
        <ol class="stepper">
          <li class="step step--active" aria-current="step"><span class="step-number">1</span><span><strong>Blueprint</strong><small>Define constraints</small></span></li>
          <li class="step"><span class="step-number">2</span><span><strong>Question selection</strong><small>Pin published versions</small></span></li>
          <li class="step"><span class="step-number">3</span><span><strong>Settings</strong><small>Duration and rules</small></span></li>
          <li class="step"><span class="step-number">4</span><span><strong>Publish review</strong><small>Guarded publication</small></span></li>
        </ol>
      </nav>

      <p class="sr-only" role="status" aria-live="polite">{{ facade.liveUpdateText() }}</p>
      <p class="workflow-feedback" role="status" aria-live="polite" [attr.data-status]="facade.requestState().status">
        <strong>{{ facade.requestState().status | titlecase }}</strong><span>{{ facade.actionableMessage() }}</span>
      </p>

      <div class="content-grid">
        <section class="primary-column" aria-label="Blueprint coverage and definition">
          <app-blueprint-constraint-panel [target]="facade.target()" [comparison]="facade.comparison()" />

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
            <div class="card-heading"><span class="eyebrow">Exam settings</span><span class="summary-status">{{ facade.currentExam()?.status ?? 'new draft' }}</span></div>
            <h2 id="settings-shell-heading">Duration and rules</h2>
            <form [formGroup]="form" (ngSubmit)="saveDraft()" aria-describedby="settings-help settings-errors">
              <p id="settings-help">Persistent labels keep settings editable before a draft is saved.</p>
              <label for="exam-title">Title</label>
              <input id="exam-title" type="text" formControlName="title" autocomplete="off" />
              <label for="exam-duration">Duration (whole minutes)</label>
              <input id="exam-duration" type="number" min="1" step="1" formControlName="durationMinutes" />
              <label for="exam-rules">Rules (one ordered value)</label>
              <input id="exam-rules" type="text" formControlName="rules" autocomplete="off" placeholder="shuffleQuestions: true" />
              <label for="successor-note">Successor change note</label>
              <textarea id="successor-note" rows="2" formControlName="changeNote" aria-describedby="successor-help"></textarea>
              <small id="successor-help">Required only when creating a successor from a published exam.</small>
              <p id="settings-errors" class="field-error" *ngIf="form.invalid && form.touched">Enter a nonblank title and positive whole-minute duration.</p>
              <div class="action-row">
                <button type="submit" [disabled]="form.invalid || isBusy()">{{ facade.currentExam()?.status === 'published' ? 'Create editable successor' : 'Save draft' }}</button>
                <button type="button" class="secondary-action" [disabled]="!facade.publishReady() || isBusy()" (click)="publish()">Publish exam</button>
              </div>
            </form>
          </section>

          <section class="selection-shell" aria-labelledby="selection-heading">
            <div class="card-heading"><span class="eyebrow">Question selection</span><span class="summary-status">{{ facade.selectedPinnedSnapshots().length }} pinned</span></div>
            <h2 id="selection-heading">Pinned published versions</h2>
            <p *ngIf="facade.selectedPinnedSnapshots().length === 0">No published question versions are selected. Add published snapshots through the facade before publishing.</p>
            <ol *ngIf="facade.selectedPinnedSnapshots().length > 0" class="snapshot-list">
              <li *ngFor="let snapshot of facade.selectedPinnedSnapshots(); trackBy: trackByVersion"><span>{{ snapshot.questionId }}</span><small>{{ snapshot.versionId }} · {{ snapshot.points }} points</small></li>
            </ol>
          </section>

          <section class="history-shell" aria-labelledby="history-heading" *ngIf="facade.history().length > 0 || facade.currentExam()?.status === 'published'">
            <div class="card-heading"><span class="eyebrow">Published history</span><span class="summary-status">Immutable</span></div>
            <h2 id="history-heading">Version history</h2>
            <ol class="history-list">
              <li *ngFor="let version of facade.history(); trackBy: trackByVersion"><strong>{{ version.versionId }}</strong><span>{{ version.title }}</span><small>{{ version.changeNote || 'Published version' }}</small></li>
              <li *ngIf="facade.currentExam()?.status === 'published'"><strong>{{ facade.currentExam()?.versionId }}</strong><span>Current published version</span><small>Direct edits are blocked.</small></li>
            </ol>
          </section>
        </aside>
      </div>
    </main>
  `,
  styles: [`
    :host { display:block; min-width:0; }
    .exam-builder-page { max-width:1320px; min-width:0; margin:0 auto; padding:24px 28px 40px; display:grid; gap:20px; overflow-x:hidden; }
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
    .summary-card, .settings-shell, .selection-shell, .history-shell { display:grid; gap:11px; padding:18px; border:1px solid var(--ui-border); border-radius:var(--ui-radius-md); background:var(--ui-surface); box-shadow:var(--ui-shadow-sm); min-width:0; }
    .summary-card[data-status="valid"] { border-color:var(--ui-success); }
    .summary-card[data-status="partial"] { border-color:var(--ui-warning); }
    .summary-card[data-status="missing"] { border-color:var(--ui-danger); }
    .card-heading { display:flex; align-items:center; justify-content:space-between; gap:10px; }
    .summary-status { border:1px solid var(--ui-border-strong); border-radius:999px; padding:3px 8px; font-size:11px; font-weight:800; text-transform:capitalize; white-space:nowrap; }
    .summary-card p, .settings-shell p, .selection-shell p, .history-shell p, .settings-shell small { color:var(--ui-text-muted); font-size:13px; line-height:1.45; }
    .reason-list { display:grid; gap:8px; margin:0; padding:0 0 0 18px; color:var(--ui-text-muted); font-size:12px; }
    .reason-list li { padding-left:2px; }
    .reason-list strong, .reason-list span { display:block; }
    .reason-list strong { color:var(--ui-text); font-size:12px; }
    form { display:grid; gap:7px; }
    label { color:var(--ui-text); font-size:12px; font-weight:750; }
    input, textarea { width:100%; box-sizing:border-box; border:1px solid var(--ui-border-strong); border-radius:var(--ui-radius-sm); background:var(--ui-surface); color:var(--ui-text); padding:8px 9px; font:inherit; font-size:13px; }
    input:focus-visible, textarea:focus-visible, button:focus-visible, summary:focus-visible { outline:3px solid color-mix(in srgb, var(--ui-primary) 35%, transparent); outline-offset:2px; }
    .field-error { color:var(--ui-danger) !important; font-size:12px !important; }
    .action-row { display:flex; flex-wrap:wrap; gap:8px; margin-top:5px; }
    button { border:1px solid var(--ui-primary); border-radius:var(--ui-radius-sm); background:var(--ui-primary); color:#fff; padding:8px 10px; font:inherit; font-size:12px; font-weight:800; cursor:pointer; }
    button:disabled { cursor:not-allowed; opacity:.55; }
    button.secondary-action { border-color:var(--ui-border-strong); background:var(--ui-surface); color:var(--ui-text); }
    .workflow-feedback { display:flex; flex-wrap:wrap; gap:8px; align-items:baseline; border-left:4px solid var(--ui-border-strong); padding:7px 10px; font-size:12px; }
    .workflow-feedback[data-status="error"], .workflow-feedback[data-status="conflict"], .workflow-feedback[data-status="unauthorized"] { border-left-color:var(--ui-danger); }
    .workflow-feedback[data-status="success"] { border-left-color:var(--ui-success); }
    .workflow-feedback[data-status="saving"], .workflow-feedback[data-status="publishing"], .workflow-feedback[data-status="loading"] { border-left-color:var(--ui-warning); }
    .snapshot-list, .history-list { display:grid; gap:7px; margin:0; padding-left:18px; font-size:12px; min-width:0; }
    .snapshot-list li, .history-list li { display:grid; gap:2px; min-width:0; }
    .snapshot-list span, .history-list strong { overflow-wrap:anywhere; }
    .snapshot-list small, .history-list span, .history-list small { color:var(--ui-text-muted); }
    .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
    @media (max-width:980px) { .exam-builder-page { padding:20px 18px 32px; } .content-grid { grid-template-columns:1fr; } .secondary-column { grid-template-columns:repeat(2,minmax(0,1fr)); align-items:start; } }
    @media (max-width:680px) { .exam-builder-page { padding:16px 12px 24px; } .stepper { grid-template-columns:1fr 1fr; } .secondary-column { grid-template-columns:1fr; } }
  `]
})
export class ExamBuilderComponent {
  readonly facade = inject(ExamBuilderFacade);
  readonly form = new FormGroup({
    title: new FormControl('Untitled exam', { nonNullable: true, validators: [Validators.required] }),
    durationMinutes: new FormControl(60, { nonNullable: true, validators: [Validators.required, Validators.min(1), Validators.pattern(/^\d+$/)] }),
    rules: new FormControl('', { nonNullable: true }),
    changeNote: new FormControl('', { nonNullable: true })
  });
  readonly unmetRows = computed(() => {
    const comparison = this.facade.comparison();
    return [...comparison.outcomeBuckets, ...comparison.difficultyBuckets, ...comparison.questionTypeBuckets].filter((row) => row.status !== 'met');
  });

  summaryDescription(): string {
    const comparison = this.facade.comparison();
    return comparison.status === 'valid' ? 'All target count and point buckets match current coverage.' : 'Resolve the listed reasons before publishing; coverage is derived from pinned snapshots.';
  }

  isBusy(): boolean {
    const status = this.facade.requestState().status;
    return status === 'loading' || status === 'saving' || status === 'publishing';
  }

  saveDraft(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.isBusy()) return;
    const values = this.form.getRawValue();
    this.facade.saveDraft({ title: values.title, durationMinutes: values.durationMinutes, rules: this.rulesFromText(values.rules), changeNote: values.changeNote }).subscribe({ error: () => undefined });
  }

  publish(): void {
    if (this.isBusy() || !this.facade.publishReady()) return;
    this.facade.publishExam(this.form.controls.changeNote.value).subscribe({ error: () => undefined });
  }

  private rulesFromText(value: string): readonly ExamRuleInput[] {
    const trimmed = value.trim();
    if (trimmed.length === 0) return [];
    const separator = trimmed.indexOf(':');
    if (separator < 0) return [{ key: trimmed, value: true }];
    return [{ key: trimmed.slice(0, separator), value: trimmed.slice(separator + 1).trim() || true }];
  }

  trackByKey(_index: number, row: ExamBlueprintBucketComparison): string { return row.key; }
  trackByVersion(_index: number, row: { readonly versionId: string }): string { return row.versionId; }
}
