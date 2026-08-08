import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output
} from '@angular/core';

export type RequestStateKind = 'loading' | 'empty' | 'slow' | 'error' | 'unauthorized';

type RequestStateCopy = Readonly<{
  title: string;
  message: string;
  symbol: string;
}>;

const REQUEST_STATE_COPY: Readonly<Record<RequestStateKind, RequestStateCopy>> = {
  loading: {
    title: 'Loading',
    message: 'Content is loading. Please wait.',
    symbol: '…'
  },
  empty: {
    title: 'No results',
    message: 'There is no content to display yet.',
    symbol: '○'
  },
  slow: {
    title: 'Taking longer than expected',
    message: 'The request is still in progress. You can wait or try again.',
    symbol: '…'
  },
  error: {
    title: 'Unable to load content',
    message: "We couldn't complete the request. Try again.",
    symbol: '!'
  },
  unauthorized: {
    title: 'Access unavailable',
    message: 'You do not have permission to view this content.',
    symbol: '×'
  }
};

@Component({
  selector: 'app-request-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="request-state"
      [class.request-state--loading]="state() === 'loading'"
      [class.request-state--slow]="state() === 'slow'"
      [class.request-state--assertive]="isAssertive()"
      [attr.aria-busy]="state() === 'loading' ? 'true' : null"
      [attr.aria-live]="isAssertive() ? 'assertive' : 'polite'"
      [attr.aria-atomic]="'true'"
      [attr.role]="isAssertive() ? 'alert' : 'status'"
      [attr.aria-labelledby]="titleId"
      [attr.aria-describedby]="messageId"
    >
      <span class="state-symbol" aria-hidden="true">{{ stateCopy().symbol }}</span>
      <div class="state-content">
        <h2 [id]="titleId">{{ displayTitle() }}</h2>
        <p [id]="messageId">{{ displayMessage() }}</p>
        @if (state() === 'loading') {
          <div class="loading-skeleton" aria-hidden="true">
            <span class="skeleton-line skeleton-line--wide"></span>
            <span class="skeleton-line skeleton-line--medium"></span>
            <span class="skeleton-line skeleton-line--short"></span>
          </div>
        }
        @if (canRetry()) {
          <button type="button" class="retry-action" (click)="retry.emit()">Try again</button>
        }
      </div>
    </section>
  `,
  styles: [`
    :host {
      display: block;
      min-width: 0;
    }

    .request-state {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      padding: clamp(20px, 4vw, 32px);
      border: 1px solid var(--ui-border);
      border-radius: var(--ui-radius-md);
      background: var(--ui-surface);
      box-shadow: var(--ui-shadow-sm);
      color: var(--ui-text);
    }

    .request-state--assertive {
      border-color: var(--ui-border-strong);
      background: var(--ui-surface-subtle);
    }

    .state-symbol {
      display: grid;
      width: 36px;
      height: 36px;
      flex: 0 0 36px;
      place-items: center;
      border: 2px solid var(--ui-border-strong);
      border-radius: 50%;
      color: var(--ui-text);
      font-size: 20px;
      font-weight: 800;
      line-height: 1;
    }

    .request-state--loading .state-symbol,
    .request-state--slow .state-symbol {
      border-radius: var(--ui-radius-sm);
    }

    .state-content {
      display: grid;
      min-width: 0;
      gap: 8px;
    }

    h2,
    p {
      margin: 0;
    }

    h2 {
      color: var(--ui-text);
      font-size: 1rem;
      line-height: 1.3;
    }

    p {
      max-width: 60ch;
      color: var(--ui-text-muted);
    }

    .loading-skeleton {
      display: grid;
      gap: 8px;
      width: min(100%, 28rem);
      margin-top: 4px;
    }

    .skeleton-line {
      display: block;
      height: 12px;
      border-radius: 999px;
      background: var(--ui-border);
    }

    .skeleton-line--wide {
      width: 100%;
    }

    .skeleton-line--medium {
      width: 76%;
    }

    .skeleton-line--short {
      width: 48%;
    }

    .retry-action {
      min-width: 104px;
      min-height: 44px;
      margin-top: 4px;
      padding: 8px 16px;
      border: 1px solid var(--ui-primary);
      border-radius: var(--ui-radius-sm);
      background: var(--ui-primary);
      color: var(--ui-surface);
      cursor: pointer;
      font-weight: 700;
    }

    .retry-action:hover {
      background: var(--ui-primary-hover);
      border-color: var(--ui-primary-hover);
    }

    @media (max-width: 600px) {
      .request-state {
        gap: 12px;
        padding: 20px;
      }

      .state-symbol {
        width: 32px;
        height: 32px;
        flex-basis: 32px;
      }
    }
  `]
})
export class RequestStateComponent {
  readonly state = input<RequestStateKind>('loading');
  readonly title = input<string | undefined>();
  readonly message = input<string | undefined>();
  readonly retry = output<void>();

  readonly stateCopy = computed(() => REQUEST_STATE_COPY[this.state()]);
  readonly displayTitle = computed(() => this.title()?.trim() || this.stateCopy().title);
  readonly displayMessage = computed(() => this.message()?.trim() || this.stateCopy().message);
  readonly canRetry = computed(() => this.state() === 'slow' || this.state() === 'error');

  private static nextInstanceId = 0;
  readonly idPrefix = `request-state-${RequestStateComponent.nextInstanceId++}`;
  readonly titleId = `${this.idPrefix}-title`;
  readonly messageId = `${this.idPrefix}-message`;

  readonly isAssertive = computed(() => this.state() === 'error' || this.state() === 'unauthorized');
}
