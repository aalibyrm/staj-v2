import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { RequestStateComponent } from '../../../shared/components/request-state.component';
import {
  ScopedDataFacade,
  type ScopedDataRecord
} from '../data-access/scoped-data.facade';

@Component({
  selector: 'app-data-scope-dashboard',
  standalone: true,
  imports: [RequestStateComponent],
  providers: [ScopedDataFacade],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="scope-dashboard" aria-labelledby="learning-dashboard-heading">
      <header class="page-heading">
        <span class="eyebrow">Authorized learning scope</span>
        <h1 id="learning-dashboard-heading">Learning dashboard</h1>
        <p class="dashboard-explanation">
          This view contains only learning records authorized for the active account by the data-scope policy.
        </p>
      </header>

      <div class="scope-summary" role="status" aria-live="polite">
        <div>
          <span class="summary-label">Active account</span>
          <strong>{{ facade.accountLabel() }}</strong>
        </div>
        <div>
          <span class="summary-label">Role</span>
          <strong>{{ facade.roleLabel() }}</strong>
        </div>
      </div>

      <div class="records-heading">
        <div>
          <span class="eyebrow">Policy-filtered view</span>
          <h2>Authorized records</h2>
        </div>
        <strong class="record-count">{{ facade.visibleRecords().length }}</strong>
      </div>

      @if (facade.visibleRecords().length === 0) {
        <app-request-state
          state="empty"
          [title]="emptyStateTitle()"
          [message]="emptyStateMessage()"
        />
      } @else {
        <ul class="record-list">
          @for (record of facade.visibleRecords(); track record.id) {
            <li class="record-row">
              <div class="record-kind">{{ record.kindLabel }}</div>
              <div class="record-copy">
                <h3>{{ record.primaryText }}</h3>
                <p>{{ record.secondaryContext }}</p>
              </div>
              <span
                class="record-access"
                [class.record-access--readonly]="record.accessMode === 'read-only'"
              >
                {{ accessLabel(record) }}
              </span>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: [`
    :host {
      display: block;
      min-height: 100%;
    }

    .scope-dashboard {
      display: grid;
      align-content: start;
      gap: 20px;
      min-height: 100%;
      padding: 4px;
    }

    .page-heading,
    .records-heading,
    .record-copy {
      display: grid;
      gap: 4px;
      min-width: 0;
    }

    .eyebrow,
    .summary-label {
      color: var(--ui-text-muted);
      font-size: 11px;
      font-weight: 750;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    h1,
    h2,
    h3,
    p {
      margin: 0;
    }

    h1 {
      color: var(--ui-text);
      font-size: clamp(1.5rem, 3vw, 2rem);
      line-height: 1.2;
    }

    h2 {
      color: var(--ui-text);
      font-size: 1.1rem;
      line-height: 1.3;
    }

    .dashboard-explanation {
      max-width: 48rem;
      color: var(--ui-text-muted);
    }

    .scope-summary {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 1px;
      overflow: hidden;
      border: 1px solid var(--ui-border);
      border-radius: var(--ui-radius-md);
      background: var(--ui-border);
      box-shadow: var(--ui-shadow-sm);
    }

    .scope-summary > div {
      display: grid;
      gap: 3px;
      min-width: 0;
      padding: 16px 18px;
      background: var(--ui-surface);
    }

    .scope-summary strong {
      overflow: hidden;
      color: var(--ui-text);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .records-heading {
      grid-template-columns: 1fr auto;
      align-items: end;
      gap: 12px;
    }

    .record-count {
      display: grid;
      min-width: 42px;
      min-height: 34px;
      padding: 4px 10px;
      place-items: center;
      border: 1px solid var(--ui-border-strong);
      border-radius: var(--ui-radius-sm);
      background: var(--ui-surface);
      color: var(--ui-text);
      font-size: 15px;
    }

    .record-list {
      display: grid;
      gap: 10px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .record-row {
      display: grid;
      grid-template-columns: minmax(72px, 0.18fr) minmax(0, 1fr) auto;
      align-items: center;
      gap: 14px;
      min-width: 0;
      padding: 16px 18px;
      border: 1px solid var(--ui-border);
      border-radius: var(--ui-radius-md);
      background: var(--ui-surface);
      box-shadow: var(--ui-shadow-sm);
    }

    .record-kind {
      color: var(--ui-primary);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .record-copy h3 {
      overflow: hidden;
      color: var(--ui-text);
      font-size: 14px;
      line-height: 1.35;
      text-overflow: ellipsis;
    }

    .record-copy p {
      overflow: hidden;
      color: var(--ui-text-muted);
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .record-access {
      padding: 5px 9px;
      border: 1px solid var(--ui-success);
      border-radius: 999px;
      background: var(--ui-success-soft);
      color: var(--ui-success);
      font-size: 11px;
      font-weight: 800;
      white-space: nowrap;
    }

    .record-access--readonly {
      border-color: var(--ui-purple);
      background: color-mix(in srgb, var(--ui-purple) 10%, var(--ui-surface));
      color: var(--ui-purple);
    }

    @media (max-width: 600px) {
      .scope-dashboard {
        gap: 16px;
        padding: 0;
      }

      .scope-summary {
        grid-template-columns: 1fr;
      }

      .record-row {
        grid-template-columns: 1fr auto;
        align-items: start;
        gap: 8px 12px;
      }

      .record-kind {
        grid-column: 1 / -1;
      }

      .record-copy p {
        white-space: normal;
      }
    }
  `]
})
export class DataScopeDashboardComponent {
  readonly facade = inject(ScopedDataFacade);
  readonly emptyStateTitle = computed(() =>
    !this.facade.isAuthenticated()
      ? 'Select an account to view records'
      : 'No authorized records'
  );
  readonly emptyStateMessage = computed(() =>
    !this.facade.isAuthenticated()
      ? 'Choose an authenticated demo account to view its policy-authorized learning records.'
      : 'This account has no matching course, cohort, or student records in the demonstration dataset.'
  );

  accessLabel(record: ScopedDataRecord): string {
    return record.accessMode === 'read-only' ? 'Read only' : 'Granted scope';
  }
}
