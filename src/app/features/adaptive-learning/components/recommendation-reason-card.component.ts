import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { LearningPathReason } from '../../learning-domain/models/learning-domain.models';

export type RecommendationReasonCardModel = Readonly<{
  readonly contentId: string;
  readonly contentTitle: string;
  readonly contentFormat: string;
  readonly order: number;
  readonly reason: LearningPathReason;
}>;

@Component({
  selector: 'app-recommendation-reason-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="reason-card" [attr.aria-labelledby]="headingId()">
      <header class="reason-card__header">
        <div class="reason-card__identity">
          <span class="reason-card__order" aria-label="Recommendation order">#{{ recommendation().order }}</span>
          <div>
            <p class="reason-card__eyebrow">{{ recommendation().contentFormat }}</p>
            <h3 [id]="headingId()">{{ recommendation().contentTitle }}</h3>
            <p class="reason-card__id">{{ recommendation().contentId }}</p>
          </div>
        </div>
        <span class="reason-code" aria-label="Recommendation reason code">
          <span aria-hidden="true">i</span>
          {{ recommendation().reason.code }}
        </span>
      </header>

      <div class="reason-card__copy">
        <p class="reason-card__summary">{{ recommendation().reason.summary }}</p>
        <p>{{ recommendation().reason.detail }}</p>
      </div>

      <section class="factor-section" [attr.aria-labelledby]="factorHeadingId()">
        <h4 [id]="factorHeadingId()">Relevant factors</h4>
        <ul class="factor-list">
          @for (factor of factors(); track factor.key) {
            <li>
              <span class="factor-key">{{ factor.key }}</span>
              <span class="factor-value">{{ factor.value }}</span>
            </li>
          }
        </ul>
      </section>
    </article>
  `,
  styles: [`
    :host {
      display: block;
      min-width: 0;
    }

    .reason-card {
      display: grid;
      gap: 16px;
      min-width: 0;
      padding: 18px;
      border: 1px solid var(--ui-border);
      border-radius: var(--ui-radius-md);
      background: var(--ui-surface);
      box-shadow: var(--ui-shadow-sm);
    }

    .reason-card__header,
    .reason-card__identity {
      display: flex;
      min-width: 0;
      align-items: flex-start;
      gap: 12px;
    }

    .reason-card__header {
      justify-content: space-between;
    }

    .reason-card__identity > div {
      min-width: 0;
    }

    .reason-card__order {
      display: grid;
      width: 32px;
      height: 32px;
      flex: 0 0 32px;
      place-items: center;
      border: 1px solid var(--ui-border-strong);
      border-radius: 50%;
      color: var(--ui-text);
      font-size: 12px;
      font-weight: 800;
      font-variant-numeric: tabular-nums;
    }

    .reason-card__eyebrow,
    .reason-card__id,
    h3,
    h4,
    p {
      margin: 0;
    }

    .reason-card__eyebrow,
    .reason-card__id,
    .factor-key {
      color: var(--ui-text-muted);
      font-size: 11px;
    }

    .reason-card__eyebrow {
      font-weight: 750;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    h3 {
      overflow-wrap: anywhere;
      color: var(--ui-text);
      font-size: 15px;
      line-height: 1.35;
    }

    .reason-card__id {
      overflow-wrap: anywhere;
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    }

    .reason-code {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      gap: 6px;
      min-height: 28px;
      padding: 4px 8px;
      border: 1px solid var(--ui-border-strong);
      border-radius: 999px;
      color: var(--ui-text);
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      font-size: 11px;
      font-weight: 750;
      white-space: nowrap;
    }

    .reason-code > span {
      display: grid;
      width: 16px;
      height: 16px;
      place-items: center;
      border: 1px solid currentColor;
      border-radius: 50%;
      font-size: 10px;
    }

    .reason-card__copy {
      display: grid;
      gap: 6px;
      color: var(--ui-text-muted);
      font-size: 13px;
      line-height: 1.5;
    }

    .reason-card__summary {
      color: var(--ui-text);
      font-weight: 750;
    }

    .factor-section {
      display: grid;
      gap: 8px;
      min-width: 0;
      padding-top: 12px;
      border-top: 1px solid var(--ui-border);
    }

    h4 {
      color: var(--ui-text);
      font-size: 12px;
    }

    .factor-list {
      display: grid;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .factor-list li {
      display: grid;
      grid-template-columns: minmax(96px, 0.65fr) minmax(0, 1fr);
      gap: 8px;
      min-width: 0;
      font-size: 12px;
    }

    .factor-value {
      overflow-wrap: anywhere;
      color: var(--ui-text);
      font-weight: 650;
    }

    @media (max-width: 600px) {
      .reason-card {
        padding: 16px;
      }

      .reason-card__header {
        display: grid;
        gap: 10px;
      }

      .reason-code {
        justify-self: start;
      }
    }
  `]
})
export class RecommendationReasonCardComponent {
  readonly recommendation = input.required<RecommendationReasonCardModel>();
  readonly headingId = computed(() => `recommendation-${this.recommendation().contentId}-heading`);
  readonly factorHeadingId = computed(() => `recommendation-${this.recommendation().contentId}-factors`);
  readonly factors = computed(() => Object.freeze(
    Object.entries(this.recommendation().reason.factors).map(([key, value]) => ({
      key,
      value: typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)
    }))
  ));
}
