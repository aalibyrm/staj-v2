import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnInit,
  ViewChild,
  afterNextRender,
  inject,
  input,
  output
} from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
  type ValidationErrors
} from '@angular/forms';

const scoreChangeReasonNotBlankValidator = (control: AbstractControl): ValidationErrors | null => {
  const value = control.value;
  return typeof value === 'string' && value.trim().length > 0 ? null : { blank: true };
};

/**
 * Confirmation dialog for applying a rubric score change. Owns the reason
 * form control and its validation; the host decides when to render it and
 * what happens after a confirmed or cancelled outcome.
 */
@Component({
  selector: 'app-score-change-panel',
  standalone: true,
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      #panel
      class="score-change-confirmation"
      role="dialog"
      aria-modal="true"
      aria-labelledby="score-change-confirmation-title"
      aria-describedby="score-change-confirmation-description score-change-reason-help"
      tabindex="-1"
      (keydown.escape)="cancelled.emit()"
    >
      <span class="eyebrow">Confirm score change</span>
      <h2 id="score-change-confirmation-title">Apply this score change?</h2>
      <p id="score-change-confirmation-description">A reason is required and is recorded with this change. It cannot be skipped.</p>
      <dl class="score-change-confirmation-details">
        <div><dt>Previous total</dt><dd>{{ previousTotal().toFixed(2) }}</dd></div>
        <div><dt>New total</dt><dd>{{ nextTotal().toFixed(2) }}</dd></div>
      </dl>
      <form [formGroup]="form">
        <label for="score-change-reason">Reason for this change <span class="required-mark">Required</span></label>
        <textarea
          #reasonInput
          id="score-change-reason"
          formControlName="reason"
          rows="3"
          [attr.maxlength]="maxReasonLength()"
          aria-describedby="score-change-reason-help"
          [attr.aria-invalid]="form.controls.reason.invalid && form.controls.reason.touched ? 'true' : null"
        ></textarea>
        <small id="score-change-reason-help" class="field-help">A reason is required and cannot be skipped. {{ form.controls.reason.value.length }} / {{ maxReasonLength() }}</small>
        @if (form.controls.reason.invalid && form.controls.reason.touched) {
          <p class="field-error" role="alert">Enter a nonblank reason before applying this score change.</p>
        }
      </form>
      @if (errorMessage()) {
        <p class="field-error" role="alert">{{ errorMessage() }}</p>
      }
      <div class="score-change-confirmation-actions">
        <button type="button" [disabled]="form.invalid || submitting()" [attr.aria-busy]="submitting()" (click)="confirm()">Confirm score change</button>
        <button type="button" class="secondary-action" [disabled]="submitting()" (click)="cancelled.emit()">Cancel</button>
      </div>
    </section>
  `,
  styles: [`:host{display:block}.score-change-confirmation{display:grid;gap:10px;padding:16px;border-radius:var(--r);margin-top:16px;border:2px solid var(--ui-primary);background:var(--ui-primary-soft)}.score-change-confirmation-details{display:grid;gap:7px;margin:0;font-size:.78rem}.score-change-confirmation-details div{display:flex;justify-content:space-between;gap:10px}.score-change-confirmation-details dt{color:var(--ui-text-muted);font-weight:750}.score-change-confirmation-details dd{margin:0;font-weight:750}.score-change-confirmation-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:2px}.score-change-confirmation form{display:grid;gap:6px}.score-change-confirmation label{color:var(--ui-text-muted);font-size:.78rem;font-weight:800}.score-change-confirmation p{font-size:.82rem;line-height:1.45}.score-change-confirmation textarea,.secondary-action{border:1px solid var(--ui-border-strong);border-radius:var(--s);color:var(--ui-text);background:var(--ui-surface)}.score-change-confirmation textarea{width:100%;min-height:64px;resize:vertical;padding:9px}.required-mark,.eyebrow{font-weight:800;text-transform:uppercase}.required-mark{color:var(--ui-danger);font-size:.7rem}.eyebrow,.field-help{display:block;color:var(--ui-text-muted);font-size:.72rem}.eyebrow{margin-bottom:5px;letter-spacing:.08em}.field-error{display:block;font-size:.75rem;margin-top:6px;color:var(--ui-danger);font-weight:700}.secondary-action{min-height:44px;padding:9px 18px;font-weight:800;cursor:pointer}.secondary-action:hover{background:var(--ui-surface-subtle)}@media(max-width:760px){.score-change-confirmation-actions button{flex:1 1 auto}}`]
})
export class ScoreChangePanelComponent implements OnInit {
  private readonly renderInjector = inject(Injector);

  readonly previousTotal = input.required<number>();
  readonly nextTotal = input.required<number>();
  readonly submitting = input.required<boolean>();
  readonly errorMessage = input.required<string | null>();
  readonly maxReasonLength = input.required<number>();

  readonly confirmed = output<string>();
  readonly cancelled = output<void>();

  readonly form = new FormGroup({
    reason: new FormControl('', { nonNullable: true, validators: [Validators.required, scoreChangeReasonNotBlankValidator] })
  });

  @ViewChild('panel') private panel?: ElementRef<HTMLElement>;
  @ViewChild('reasonInput') private reasonInput?: ElementRef<HTMLTextAreaElement>;

  ngOnInit(): void {
    this.form.controls.reason.addValidators(Validators.maxLength(this.maxReasonLength()));
    this.form.controls.reason.updateValueAndValidity({ emitEvent: false });
    afterNextRender({ write: () => this.panel?.nativeElement.focus() }, { injector: this.renderInjector });
  }

  confirm(): void {
    const reason = this.form.controls.reason;
    reason.markAsTouched();
    if (reason.invalid) {
      afterNextRender({ write: () => this.reasonInput?.nativeElement.focus() }, { injector: this.renderInjector });
      return;
    }
    this.confirmed.emit(reason.value);
  }

}
