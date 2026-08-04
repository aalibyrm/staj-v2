import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { ListQueryControlsComponent, type ListFilterOption, type ListSortOption } from './list-query-controls.component';
import { RequestStateComponent } from './request-state.component';

@Component({
  selector: 'app-route-placeholder',
  standalone: true,
  imports: [ListQueryControlsComponent, RequestStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="placeholder-page" aria-labelledby="route-placeholder-heading">
      <header class="page-heading">
        <span class="eyebrow">Reserved workspace</span>
        <h1 id="route-placeholder-heading">{{ title }}</h1>
      </header>
      <p class="later-packet-message">This route is reserved for a later packet.</p>
      @if (isCoursesRoute) {
        <div class="courses-pattern" aria-label="Course list query demonstration">
          <app-list-query-controls
            [filterOptions]="courseFilterOptions"
            [sortOptions]="courseSortOptions"
          />
          <app-request-state
            state="empty"
            title="No course records yet"
            message="Course records arrive in the later domain packet."
          />
        </div>
      } @else {
        <div class="placeholder-surface" aria-label="Reserved feature area">
          <span class="surface-mark" aria-hidden="true"></span>
          <span>Feature content will be introduced in a later packet.</span>
        </div>
      }
    </section>
  `,
  styles: [`
    :host {
      display: block;
      min-height: 100%;
    }

    .placeholder-page {
      display: grid;
      align-content: start;
      gap: 12px;
      min-height: 100%;
      padding: 4px;
    }

    .page-heading {
      display: grid;
      gap: 4px;
    }

    .eyebrow {
      color: var(--ui-text-muted);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .later-packet-message {
      max-width: 56rem;
      color: var(--ui-text-muted);
    }

    .courses-pattern {
      display: grid;
      gap: 16px;
      min-width: 0;
    }

    .placeholder-surface {
      display: flex;
      align-items: center;
      min-height: 168px;
      gap: 12px;
      padding: 20px;
      border: 1px solid var(--ui-border);
      border-radius: var(--ui-radius-md);
      background: var(--ui-surface);
      box-shadow: var(--ui-shadow-sm);
      color: var(--ui-text-muted);
    }

    .surface-mark {
      width: 12px;
      height: 12px;
      flex: 0 0 12px;
      border: 2px solid var(--ui-border-strong);
      border-radius: 3px;
    }

    h1,
    p {
      margin: 0;
    }

    h1 {
      color: var(--ui-text);
      font-size: clamp(1.5rem, 3vw, 2rem);
      line-height: 1.2;
    }

  `]
})
export class RoutePlaceholderComponent {
  private readonly route = inject(ActivatedRoute);
  readonly title = String(this.route.snapshot.data['title'] ?? 'Reserved route');
  readonly isCoursesRoute = this.route.snapshot.routeConfig?.path === 'courses';

  readonly courseFilterOptions = [
    { value: 'active', label: 'Active' },
    { value: 'planned', label: 'Planned' },
    { value: 'archived', label: 'Archived' }
  ] as const satisfies readonly ListFilterOption[];

  readonly courseSortOptions = [
    { value: 'name-asc', label: 'Name, ascending' },
    { value: 'name-desc', label: 'Name, descending' },
    { value: 'updated-desc', label: 'Updated, newest first' }
  ] as const satisfies readonly ListSortOption[];
}
