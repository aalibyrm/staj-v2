import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  ViewChild,
  afterNextRender,
  inject,
  signal
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { RequestStateComponent } from '../../../shared/components/request-state.component';
import { ExamSessionFacade } from '../data-access/exam-session.facade';
import type { AnswerDraft, ExamQuestion } from '../models/answer-draft.models';

@Component({
  selector: 'app-exam-session',
  standalone: true,
  imports: [CommonModule, RequestStateComponent],
  providers: [ExamSessionFacade],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="exam-session-page" aria-labelledby="exam-session-heading">
      <section class="route-boundary-marker" aria-labelledby="route-placeholder-heading">
        <h2 id="route-placeholder-heading" class="visually-hidden">Exam session</h2>
      </section>

      @if (facade.requestState().status === 'loading') {
        <app-request-state state="loading" title="Loading exam session" message="Preparing the question workspace." />
      } @else if (facade.requestState().status === 'empty') {
        <app-request-state state="empty" title="No questions available" message="This exam session does not contain a question set." />
      } @else if (facade.requestState().status === 'error' || facade.requestState().status === 'unauthorized') {
        <app-request-state
          [state]="facade.requestState().status === 'unauthorized' ? 'unauthorized' : 'error'"
          title="Unable to open exam session"
          [message]="facade.requestState().message"
          (retry)="retry()"
        />
      } @else if (facade.session() !== null && facade.questions().length > 0) {
        <header class="exam-header">
          <div class="exam-heading">
            <span class="eyebrow">Student workspace</span>
            <h1 id="exam-session-heading">Exam session</h1>
            <p>Focused practice session · {{ facade.questions().length }} questions</p>
          </div>
          <div class="session-status-strip" aria-label="Exam session status">
            <div class="status-item">
              <span class="status-label">Progress</span>
              <strong>{{ facade.progress().answered }} / {{ facade.progress().total }} answered</strong>
            </div>
            <div class="status-item timer-status" role="status" aria-live="polite" aria-atomic="true">
              <span class="status-label">Reference-time remaining</span>
              <strong [class.warning-text]="facade.timer()?.warning" [class.expired-text]="facade.isExpired()">
                {{ formatDuration(facade.timer()?.remainingMs ?? 0) }}
              </strong>
            </div>
            <div class="status-item">
              <span class="status-label">Draft status</span>
              <strong>{{ facade.localDraftStatus() === 'local' ? 'Local draft only' : 'No answers yet' }}</strong>
              <span class="autosave-indicator" role="status" aria-live="polite" aria-atomic="true">{{ autosaveLabel() }}</span>
              @if (facade.autosaveState().status === 'error' && facade.autosaveState().retryable) {
                <button type="button" class="secondary-action" aria-label="Retry autosave" (click)="retryAutosave()">Retry</button>
              }
              @if (facade.replayError() !== null) {
                <button type="button" class="secondary-action" aria-label="Retry queued answer sync" (click)="retryQueuedReplay()">Retry sync</button>
              }
            </div>
          </div>
        </header>
        @if (facade.autosaveConflict(); as conflict) {
          <section
            class="draft-conflict"
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            aria-labelledby="draft-conflict-heading"
          >
            <div class="draft-conflict-heading">
              <div>
                <span class="eyebrow">Draft conflict</span>
                <h2 id="draft-conflict-heading">This answer changed in another tab.</h2>
              </div>
              @if (conflict.resolutionStatus === 'resolving') {
                <span class="draft-conflict-status">Resolving conflict…</span>
              }
            </div>
            <p>Choose which answer to keep. Neither draft is replaced until you choose.</p>
            <dl class="draft-conflict-choices">
              <div>
                <dt>Your local answer</dt>
                <dd>{{ answerSummary(conflict.localDraft) }}</dd>
              </div>
              <div>
                <dt>Server answer</dt>
                <dd>{{ answerSummary(conflict.serverDraft) }}</dd>
              </div>
            </dl>
            @if (conflict.resolutionError !== null) {
              <p class="draft-conflict-error" role="alert">Resolution failed: {{ conflict.resolutionError }} Try again.</p>
            }
            <div class="draft-conflict-actions">
              <button
                type="button"
                class="secondary-action"
                [disabled]="conflict.resolutionStatus === 'resolving'"
                (click)="useServerAnswer()"
              >Use server answer</button>
              <button
                type="button"
                class="primary-action"
                [disabled]="conflict.resolutionStatus === 'resolving'"
                (click)="keepLocalAnswer()"
              >Keep my answer</button>
            </div>
          </section>
        }


        <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ facade.liveStatus() }}</p>

        <div class="workspace-grid">
          <div class="navigator-region">
            <button
              #navigatorTrigger
              class="navigator-trigger secondary-action"
              type="button"
              aria-controls="question-navigator"
              [attr.aria-expanded]="navigatorOpen()"
              (click)="toggleNavigator()"
            >
              <span aria-hidden="true">☰</span> Question navigator
            </button>
            <aside
              #navigatorPanel
              id="question-navigator"
              class="navigator-panel"
              [class.is-collapsed]="!navigatorOpen()"
              [attr.aria-hidden]="!navigatorOpen() ? 'true' : null"
              aria-label="Question navigator"
              tabindex="-1"
              (keydown)="onNavigatorKeydown($event)"
            >
              <div class="panel-heading">
                <div>
                  <span class="eyebrow">Question navigator</span>
                  <h2>Question list</h2>
                </div>
                <button type="button" class="icon-button" aria-label="Close question navigator" (click)="closeNavigator()">×</button>
              </div>
              <div class="navigator-key" aria-label="Question state key">
                <span>● Answered</span><span>○ Unanswered</span><span>⚑ Flagged</span>
              </div>
              <ol class="question-list">
                @for (question of facade.questions(); track trackQuestion($index, question)) {
                  <li>
                    <button
                      type="button"
                      class="question-nav-button"
                      [class.is-current]="facade.currentIndex() === $index"
                      [class.is-answered]="facade.draftFor(question.id)?.answered"
                      [class.is-flagged]="facade.draftFor(question.id)?.flagged"
                      [attr.aria-current]="facade.currentIndex() === $index ? 'step' : null"
                      [attr.aria-label]="questionLabel($index, question)"
                      (click)="selectQuestion($index)"
                    >
                      <span class="question-number" aria-hidden="true">{{ $index + 1 }}</span>
                      <span class="question-nav-copy">
                        <strong>Question {{ $index + 1 }}</strong>
                        <small>{{ questionStatus(question) }}</small>
                      </span>
                      <span class="question-nav-symbol" aria-hidden="true">{{ questionSymbol(question) }}</span>
                    </button>
                  </li>
                }
              </ol>
            </aside>
          </div>

          <section class="question-region" aria-label="Question and answer">
            @if (facade.currentQuestion(); as question) {
              <article class="question-card" [attr.data-state]="facade.isExpired() ? 'expired' : facade.session()?.state">
                <div class="question-card-heading">
                  <div>
                    <span class="eyebrow">Question {{ facade.currentIndex() + 1 }} of {{ facade.questions().length }}</span>
                    <h2 #questionHeading tabindex="-1" id="current-question-heading">{{ question.prompt }}</h2>
                  </div>
                  <button
                    type="button"
                    class="flag-button secondary-action"
                    [disabled]="!facade.canAnswer()"
                    [attr.aria-pressed]="facade.draftFor(question.id)?.flagged ?? false"
                    (click)="toggleReview(question.id)"
                  >
                    <span aria-hidden="true">⚑</span> {{ facade.draftFor(question.id)?.flagged ? 'Flagged for review' : 'Flag for review' }}
                  </button>
                </div>

                @if (question.kind === 'text') {
                  <label class="answer-label" [for]="'answer-' + question.id">Your answer</label>
                  <textarea
                    class="text-answer"
                    [id]="'answer-' + question.id"
                    rows="5"
                    [value]="textAnswer(question.id)"
                    [disabled]="!facade.canAnswer()"
                    (input)="updateTextAnswer(question.id, $event)"
                  ></textarea>
                } @else {
                  <fieldset class="answer-options" [disabled]="!facade.canAnswer()">
                    <legend>Choose an answer</legend>
                    @for (option of question.options; track option.id) {
                      <label class="answer-option" [class.is-selected]="isOptionSelected(question, option.id)">
                        <input
                          [type]="question.kind === 'multiple' ? 'checkbox' : 'radio'"
                          [name]="'answer-' + question.id"
                          [value]="option.id"
                          [checked]="isOptionSelected(question, option.id)"
                          (change)="updateOptionAnswer(question, option.id)"
                        />
                        <span>{{ option.label }}</span>
                      </label>
                    }
                  </fieldset>
                }

                @if (facade.isExpired()) {
                  <p class="terminal-message" role="alert">Time has expired. Answers are locked.</p>
                } @else if (facade.isTerminal()) {
                  <p class="terminal-message" role="status">This session is {{ facade.session()?.state }}. Answers are locked.</p>
                }
              </article>
            }
            <nav class="question-actions" aria-label="Question actions">
              <button type="button" class="secondary-action" [disabled]="facade.currentIndex() === 0 || facade.isTerminal()" (click)="goPrevious()">← Previous</button>
              <button type="button" class="secondary-action" [disabled]="!facade.currentQuestion() || facade.isTerminal()" (click)="toggleReview(facade.currentQuestion()!.id)">
                ⚑ {{ facade.currentQuestion() && facade.draftFor(facade.currentQuestion()!.id)?.flagged ? 'Unflag' : 'Flag' }}
              </button>
              <button type="button" class="primary-action" [disabled]="facade.currentIndex() >= facade.questions().length - 1 || facade.isTerminal()" (click)="goNext()">Next →</button>
            </nav>
          </section>

          <aside class="summary-region" aria-label="Session summary">
            <section class="summary-card" aria-labelledby="summary-heading">
              <div class="card-heading"><span class="eyebrow">Session summary</span><span class="summary-mark" aria-hidden="true">◷</span></div>
              <h2 id="summary-heading">Answer overview</h2>
              <dl class="summary-list">
                <div><dt>Total questions</dt><dd>{{ facade.progress().total }}</dd></div>
                <div><dt>Answered</dt><dd>{{ facade.progress().answered }}</dd></div>
                <div><dt>Unanswered</dt><dd>{{ facade.progress().unanswered }}</dd></div>
                <div><dt>Flagged for review</dt><dd>{{ facade.progress().flagged }}</dd></div>
              </dl>
            </section>
            <section class="timer-card" aria-labelledby="timer-heading">
              <span class="eyebrow">Reference timer</span>
              <h2 id="timer-heading">{{ formatDuration(facade.timer()?.remainingMs ?? 0) }}</h2>
              <p [class.warning-text]="facade.timer()?.warning" [class.expired-text]="facade.isExpired()">
                {{ facade.isExpired() ? 'Expired' : facade.timer()?.warning ? 'Time is running low' : 'Time remaining' }}
              </p>
            </section>
            <section class="finish-card" aria-labelledby="finish-heading">
              <h2 id="finish-heading">Finish session</h2>
              <p>Review your local answers before submitting. Submission cannot be undone.</p>
              <button
                #finishTrigger
                type="button"
                class="finish-button"
                [disabled]="!facade.canSubmit() || finishSubmissionLocked()"
                aria-haspopup="dialog"
                [attr.aria-expanded]="finishConfirmationOpen()"
                (click)="openFinishConfirmation()"
              >Finish exam</button>
            </section>
          </aside>
        </div>

        @if (finishConfirmationOpen()) {
          <section
            #finishDialog
            class="finish-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="finish-confirmation-title"
            aria-describedby="finish-confirmation-description"
            tabindex="-1"
            (keydown)="onFinishDialogKeydown($event)"
          >
            <span class="eyebrow">Confirm submission</span>
            <h2 id="finish-confirmation-title">Submit this exam session?</h2>
            <p id="finish-confirmation-description">Your local answer draft will be submitted and the session will close. You can cancel and continue answering.</p>
            @if (submissionError(); as errorMessage) {
              <p class="terminal-message finish-submission-error" role="alert" aria-live="assertive" aria-atomic="true">
                Submission failed: {{ errorMessage }}
              </p>
              <button
                type="button"
                class="secondary-action"
                aria-label="Retry submission"
                [disabled]="finishSubmissionLocked()"
                (click)="retryFinish()"
              >Retry submission</button>
            }
            <div class="dialog-actions">
              <button type="button" class="primary-action" [disabled]="finishSubmissionLocked()" (click)="confirmFinish()">Confirm submission</button>
              <button type="button" class="secondary-action" [disabled]="finishSubmissionLocked()" (click)="cancelFinish()">Cancel</button>
            </div>
          </section>
        }
      }
    </main>
  `,
  styles: [`
    :host { display:block; min-width:0; }
    button { background:var(--ui-surface); border-radius:var(--ui-radius-sm); }
    .exam-session-page { max-width:1440px; margin:0 auto; padding:24px 28px 36px; display:grid; gap:18px; overflow-x:hidden; color:var(--ui-text); }
    .route-boundary-marker { display:none; }
    .exam-header { display:flex; align-items:flex-end; justify-content:space-between; gap:20px; padding:18px 20px; }
    .exam-heading { min-width:0; }
    h1, h2, p { margin:0; }
    h1 { margin:3px 0 0; font-size:28px; line-height:1.2; }
    h2 { font-size:17px; line-height:1.35; }
    .exam-heading p { margin:6px 0 0; color:var(--ui-text-muted); font-size:13px; }
    .eyebrow, .status-label, .draft-conflict-choices dt { color:var(--ui-text-muted); font-size:11px; font-weight:750; text-transform:uppercase; }
    .eyebrow, .status-label { letter-spacing:.05em; }
    .session-status-strip { display:grid; grid-template-columns:repeat(3,minmax(120px,1fr)); gap:16px; min-width:min(620px,60%); }
    .status-item { display:grid; gap:5px; padding-left:16px; border-left:1px solid var(--ui-border); }
    .status-item strong { font-size:14px; }
    .timer-status strong { font-size:20px; }
    .timer-status strong, .summary-list dd, .timer-card h2 { font-variant-numeric:tabular-nums; }
    .warning-text { color:var(--ui-warning) !important; }
    .expired-text { color:var(--ui-danger) !important; }
    .draft-conflict { display:grid; gap:12px; padding:16px 18px; border:2px solid var(--ui-danger); border-radius:var(--ui-radius-md); background:var(--ui-danger-soft); }
    .draft-conflict-heading h2 { margin:4px 0 0; }
    .draft-conflict-status { color:var(--ui-danger); font-size:12px; font-weight:750; }
    .draft-conflict-choices { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; margin:0; }
    .draft-conflict-choices div { min-width:0; padding:10px 12px; border:1px solid var(--ui-border-strong); border-radius:var(--ui-radius-sm); background:var(--ui-surface); }
    .draft-conflict-choices dd { margin:5px 0 0; overflow-wrap:anywhere; font-size:13px; }
    .draft-conflict-error { color:var(--ui-danger); font-weight:750; }
    .draft-conflict-actions { flex-wrap:wrap; }
    .exam-header, .navigator-panel, .question-card, .summary-card, .timer-card, .finish-card { border:1px solid var(--ui-border); border-radius:var(--ui-radius-md); background:var(--ui-surface); box-shadow:var(--ui-shadow-sm); }
    .navigator-panel, .question-region, .summary-region { min-width:0; display:grid; gap:14px; }
    .navigator-panel { padding:16px; }
    .panel-heading, .card-heading, .question-card-heading, .draft-conflict-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; }
    .draft-conflict-heading { gap:12px; }
    .panel-heading h2 { margin:3px 0 0; }
    .icon-button { display:none; width:36px; height:36px; border:1px solid var(--ui-border); font-size:20px; }
    .navigator-key { display:grid; gap:5px; color:var(--ui-text-muted); font-size:11px; }
    .question-list { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:7px; list-style:none; margin:0; padding:0; }
    .question-nav-button, .answer-option { display:flex; align-items:center; min-height:48px; border:1px solid var(--ui-border); border-radius:var(--ui-radius-sm); cursor:pointer; }
    .question-nav-button { gap:7px; padding:6px; color:inherit; text-align:left; }
    .question-nav-button:is(:hover,:focus-visible) { border-color:var(--ui-primary); }
    .question-nav-button.is-current { border:2px solid var(--ui-primary); background:var(--ui-primary-soft); }
    .question-nav-button.is-answered { border-left:4px solid var(--ui-success); }
    .question-nav-button.is-flagged { box-shadow:inset 0 -3px 0 var(--ui-warning); }
    .question-number { display:grid; place-items:center; height:24px; flex:0 0 24px; border:1px solid var(--ui-border-strong); border-radius:50%; font-size:11px; font-weight:800; }
    .question-nav-copy { min-width:0; font-size:11px; }
    .question-nav-copy :is(strong,small) { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .question-nav-copy small { margin-top:2px; color:var(--ui-text-muted); font-size:10px; }
    .question-nav-symbol { margin-left:auto; font-size:13px; }
    .question-card { display:grid; gap:22px; min-height:420px; padding:24px; }
    .question-card-heading h2 { max-width:66ch; margin:6px 0 0; font-size:19px; }
    .secondary-action, .primary-action, .finish-button { min-height:44px; padding:9px 16px; font-size:13px; font-weight:750; cursor:pointer; }
    .secondary-action { border:1px solid currentColor; color:var(--ui-primary); }
    .primary-action { border:1px solid var(--ui-primary); background:var(--ui-primary); color:#fff; }
    .finish-button { border:1px solid currentColor; color:var(--ui-danger); }
    button:disabled, textarea:disabled { cursor:not-allowed; opacity:.55; }
    .answer-options { display:grid; gap:10px; min-width:0; margin:0; padding:0; border:0; }
    .answer-options legend, .answer-label { margin-bottom:2px; color:var(--ui-text-muted); font-size:12px; font-weight:750; }
    .answer-option { gap:12px; padding:10px 14px; }
    .answer-option.is-selected { border-color:var(--ui-primary); background:var(--ui-primary-soft); }
    .answer-option input { width:18px; height:18px; accent-color:var(--ui-primary); }
    .text-answer { min-height:140px; padding:12px; resize:vertical; border:1px solid var(--ui-border-strong); border-radius:var(--ui-radius-sm); line-height:1.45; }
    .terminal-message { padding:12px; border:1px solid currentColor; border-radius:var(--ui-radius-sm); background:var(--ui-danger-soft); color:var(--ui-danger); font-size:13px; font-weight:700; }
    .summary-card, .timer-card, .finish-card { display:grid; gap:12px; padding:18px; }
    .summary-mark { color:var(--ui-primary); font-size:20px; }
    .summary-list { display:grid; gap:10px; margin:0; font-size:13px; }
    .summary-list div { display:flex; justify-content:space-between; gap:10px; padding-bottom:9px; border-bottom:1px solid var(--ui-border); }
    .summary-list dt { color:var(--ui-text-muted); }
    .summary-list dd { margin:0; font-weight:800; }
    .timer-card h2 { font-size:30px; }
    :is(.timer-card,.finish-card) p { color:var(--ui-text-muted); font-size:12px; line-height:1.45; }
    .finish-dialog { position:fixed; z-index:20; inset:50% auto auto 50%; width:min(520px,calc(100vw - 32px)); transform:translate(-50%,-50%); display:grid; gap:13px; padding:24px; border:1px solid var(--ui-border-strong); border-radius:var(--ui-radius-lg); background:var(--ui-surface); box-shadow:var(--ui-shadow-md); }
    .finish-dialog::before { content:""; position:fixed; z-index:-1; inset:calc(50% - 50vh) calc(50% - 50vw); background:rgb(15 23 42 / .36); }
    .finish-dialog p { color:var(--ui-text-muted); font-size:13px; }
    .finish-submission-error { color:var(--ui-danger); }
    .draft-conflict-actions, .dialog-actions { display:flex; justify-content:flex-end; gap:10px; }
    .navigator-trigger { display:none; }
    .workspace-grid { display:grid; grid-template-columns:minmax(200px,240px) minmax(0,1fr) minmax(240px,300px); align-items:start; gap:16px; min-width:0; }
    .sr-only, .visually-hidden { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
    @media (max-width:1100px) {
      .workspace-grid { grid-template-columns:minmax(180px,200px) minmax(0,1fr); }
      .summary-region { grid-column:1 / -1; grid-template-columns:repeat(3,minmax(0,1fr)); }
      .timer-card { position:static; }
    }
    @media (max-width:960px) {
      .exam-session-page { padding:16px 14px 28px; }
      .exam-header { position:sticky; top:0; z-index:8; display:grid; gap:16px; }
      .session-status-strip { min-width:0; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
      .status-item { padding-left:8px; }
      .status-item strong { font-size:12px; }
      .timer-status strong { font-size:17px; }
      .workspace-grid { grid-template-columns:minmax(0,1fr); }
      .navigator-trigger { display:inline-flex; align-items:center; justify-content:center; gap:8px; }
      .navigator-panel { position:fixed; z-index:15; inset:74px 14px auto 14px; max-height:calc(100vh - 96px); overflow:auto; box-shadow:var(--ui-shadow-md); }
      .navigator-panel.is-collapsed { display:none; }
      .icon-button { display:block; }
      .question-list { grid-template-columns:repeat(3,minmax(0,1fr)); }
      .question-card { min-height:0; padding:18px; }
      .draft-conflict-choices, .draft-conflict-actions { grid-template-columns:minmax(0,1fr); }
      .draft-conflict-actions { display:grid; }
      .question-card-heading { display:grid; }
      .summary-region { grid-column:auto; grid-template-columns:minmax(0,1fr); }
      .timer-card { position:sticky; top:8px; }
      .dialog-actions { display:grid; grid-template-columns:1fr; }
    }
    @media (prefers-reduced-motion:reduce) { *, *::before, *::after { transition:none !important; animation:none !important; } }
  `]
})
export class ExamSessionComponent {
  readonly facade = inject(ExamSessionFacade);
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly renderInjector = inject(Injector);
  readonly navigatorOpen = signal(false);
  readonly finishConfirmationOpen = signal(false);
  readonly finishSubmissionLocked = signal(false);
  readonly submissionError = signal<string | null>(null);
  @ViewChild('navigatorTrigger') private navigatorTrigger?: ElementRef<HTMLButtonElement>;
  @ViewChild('navigatorPanel') private navigatorPanel?: ElementRef<HTMLElement>;
  @ViewChild('questionHeading') private questionHeading?: ElementRef<HTMLHeadingElement>;
  @ViewChild('finishTrigger') private finishTrigger?: ElementRef<HTMLButtonElement>;
  @ViewChild('finishDialog') private finishDialog?: ElementRef<HTMLElement>;
  private loadedRouteToken: string | null = null;

  ngOnInit(): void {
    const routeToken = this.route?.snapshot.paramMap.get('token')?.trim() ?? '';
    if (routeToken.length === 0 || this.loadedRouteToken === routeToken) return;
    this.loadedRouteToken = routeToken;
    this.facade.load(routeToken).subscribe({ error: () => undefined });
  }

  retryAutosave(): void {
    this.facade.retryAutosave();
  }

  retryQueuedReplay(): void {
    this.facade.retryQueuedReplay();
  }

  useServerAnswer(): void {
    void this.facade.useServerAnswer();
  }

  keepLocalAnswer(): void {
    void this.facade.keepLocalAnswer();
  }

  autosaveLabel(): string {
    const conflict = this.facade.autosaveConflict();
    if (conflict !== null) {
      if (conflict.resolutionStatus === 'resolving') return 'Resolving answer conflict';
      if (conflict.resolutionError !== null) return `Resolution error: ${conflict.resolutionError}`;
      return 'Conflict — choose local or server answer';
    }
    const replayError = this.facade.replayError();
    if (replayError !== null) return `Sync error: ${replayError}`;
    if (this.facade.isOffline()) return `Offline — ${this.facade.queuedAnswerCount()} answer(s) queued`;
    if (this.facade.isReconnecting()) return `Reconnecting — syncing ${this.facade.queuedAnswerCount()} answer(s)`;
    const state = this.facade.autosaveState();
    if (state.status === 'saving') return 'Saving';
    if (state.status === 'saved') return state.savedAt === null ? 'Saved' : `Saved ${state.savedAt}`;
    if (state.status === 'error') return state.message.trim().length > 0 ? `Error: ${state.message}` : 'Error';
    return '';
  }

  answerSummary(draft: AnswerDraft): string {
    const question = this.facade.questions().find((candidate) => candidate.id === draft.questionId);
    const values = Array.isArray(draft.value) ? draft.value : [draft.value];
    const labels = values.map((value) => {
      if (value === null || value === '') return 'No answer';
      const option = question?.options.find((candidate) => candidate.id === String(value));
      return option?.label ?? String(value);
    });
    const answer = labels.join(', ');
    return `${answer} · ${draft.flagged ? 'Flagged for review' : 'Not flagged'}`;
  }
  retry(): void {
    this.facade.retry().subscribe({ error: () => undefined });
  }

  selectQuestion(index: number): void {
    if (!this.facade.navigateTo(index)) return;
    this.closeNavigator();
    this.focusQuestionHeading();
  }

  goPrevious(): void {
    if (this.facade.goPrevious()) this.focusQuestionHeading();
  }

  goNext(): void {
    if (this.facade.goNext()) this.focusQuestionHeading();
  }

  toggleReview(questionId: string): void {
    this.facade.toggleReview(questionId);
  }

  updateOptionAnswer(question: ExamQuestion, optionId: string): void {
    if (question.kind === 'multiple') {
      const current = this.facade.draftFor(question.id)?.value;
      const selected = Array.isArray(current) ? [...current] : [];
      const index = selected.indexOf(optionId);
      if (index >= 0) selected.splice(index, 1);
      else selected.push(optionId);
      this.facade.updateAnswer(question.id, selected);
      return;
    }
    this.facade.updateAnswer(question.id, optionId);
  }

  updateTextAnswer(questionId: string, event: Event): void {
    const target = event.target;
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      this.facade.updateAnswer(questionId, target.value);
    }
  }

  textAnswer(questionId: string): string {
    const value = this.facade.draftFor(questionId)?.value;
    return typeof value === 'string' ? value : '';
  }

  isOptionSelected(question: ExamQuestion, optionId: string): boolean {
    const value = this.facade.draftFor(question.id)?.value;
    return Array.isArray(value) ? value.includes(optionId) : value === optionId;
  }

  questionStatus(question: ExamQuestion): string {
    const draft = this.facade.draftFor(question.id);
    if (draft?.flagged && draft.answered) return 'Answered · Flagged';
    if (draft?.flagged) return 'Unanswered · Flagged';
    return draft?.answered ? 'Answered' : 'Unanswered';
  }

  questionSymbol(question: ExamQuestion): string {
    const draft = this.facade.draftFor(question.id);
    if (draft?.flagged) return '⚑';
    return draft?.answered ? '●' : '○';
  }

  questionLabel(index: number, question: ExamQuestion): string {
    return `Question ${index + 1}: ${this.questionStatus(question)}${this.facade.currentIndex() === index ? ' · Current' : ''}`;
  }

  trackQuestion(_index: number, question: ExamQuestion): string {
    return question.id;
  }

  toggleNavigator(): void {
    if (this.navigatorOpen()) this.closeNavigator();
    else this.openNavigator();
  }

  openNavigator(): void {
    this.navigatorOpen.set(true);
    afterNextRender({ write: () => this.navigatorPanel?.nativeElement.focus() }, { injector: this.renderInjector });
  }

  closeNavigator(): void {
    if (!this.navigatorOpen()) return;
    this.navigatorOpen.set(false);
    afterNextRender({ write: () => this.navigatorTrigger?.nativeElement.focus() }, { injector: this.renderInjector });
  }

  onNavigatorKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeNavigator();
      return;
    }
    this.cycleFocus(event, this.navigatorPanel?.nativeElement);
  }

  private cycleFocus(event: KeyboardEvent, container: HTMLElement | undefined): void {
    if (event.key !== 'Tab' || container === undefined) return;
    const focusable = Array.from(container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    ));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  openFinishConfirmation(): void {
    if (!this.facade.canSubmit() || this.finishSubmissionLocked()) return;
    this.submissionError.set(null);
    this.finishConfirmationOpen.set(true);
    afterNextRender({ write: () => this.finishDialog?.nativeElement.focus() }, { injector: this.renderInjector });
  }

  cancelFinish(): void {
    if (!this.finishConfirmationOpen()) return;
    this.finishConfirmationOpen.set(false);
    this.submissionError.set(null);
    afterNextRender({ write: () => this.finishTrigger?.nativeElement.focus() }, { injector: this.renderInjector });
  }

  confirmFinish(): void {
    if (!this.finishConfirmationOpen() || this.finishSubmissionLocked()) return;
    this.finishSubmissionLocked.set(true);
    this.facade.submit(true).subscribe({
      next: () => this.finishCompleted(),
      error: (error: unknown) => {
        this.finishSubmissionLocked.set(false);
        this.submissionError.set(
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : 'Exam submission failed. Please try again.'
        );
      }
    });
  }

  retryFinish(): void {
    this.confirmFinish();
  }

  onFinishDialogKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelFinish();
      return;
    }
    this.cycleFocus(event, this.finishDialog?.nativeElement);
  }

  formatDuration(durationMs: number): string {
    const totalSeconds = Math.max(0, Math.ceil(durationMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  private finishCompleted(): void {
    this.finishSubmissionLocked.set(false);
    this.submissionError.set(null);
    this.finishConfirmationOpen.set(false);
    afterNextRender({ write: () => this.finishTrigger?.nativeElement.focus() }, { injector: this.renderInjector });
  }

  private focusQuestionHeading(): void {
    afterNextRender({ write: () => this.questionHeading?.nativeElement.focus() }, { injector: this.renderInjector });
  }
}
