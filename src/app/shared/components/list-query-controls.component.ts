import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged } from 'rxjs';

import {
  ListQueryStateFacade,
  MAX_SEARCH_LENGTH,
  normalizeListQueryState,
  normalizeTokenValue
} from '../state/list-query-state';

export type ListFilterOption = Readonly<{
  value: string;
  label: string;
}>;

export type ListSortOption = Readonly<{
  value: string;
  label: string;
}>;

export type ActiveListFilter = Readonly<{
  value: string;
  label: string;
}>;

@Component({
  selector: 'app-list-query-controls',
  standalone: true,
  imports: [ReactiveFormsModule],
  providers: [ListQueryStateFacade],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="list-query-controls" [formGroup]="form" (submit)="$event.preventDefault()">
      <div class="criteria-grid">
        <div class="control-group search-control">
          <label [for]="searchId">Search</label>
          <input
            [id]="searchId"
            type="search"
            formControlName="search"
            [attr.maxlength]="maxSearchLength"
            autocomplete="off"
            [attr.aria-describedby]="summaryId"
          />
        </div>

        <div class="control-group filter-control">
          <label [for]="filtersId">Filters</label>
          <select
            [id]="filtersId"
            formControlName="filters"
            multiple
            size="3"
            (change)="onFiltersChange($event)"
            [attr.aria-describedby]="activeFiltersId + ' ' + summaryId"
          >
            @for (option of filterOptions(); track option.value) {
              <option [value]="option.value" [attr.data-query-value]="option.value">{{ option.label }}</option>
            }
          </select>
        </div>

        <div class="control-group sort-control">
          <label [for]="sortId">Sort</label>
          <select [id]="sortId" formControlName="sort" [attr.aria-describedby]="summaryId">
            <option value="">Default order</option>
            @for (option of sortOptions(); track option.value) {
              <option [value]="option.value">{{ option.label }}</option>
            }
          </select>
        </div>

        <div class="criteria-actions" aria-label="Query actions">
          <button type="button" class="control-action" (click)="reset()">Reset</button>
          <div class="page-actions" aria-label="Page controls">
            <button
              type="button"
              class="control-action"
              [disabled]="!canPrevious()"
              aria-label="Previous page"
              (click)="previousPage()"
            >
              Previous
            </button>
            <button
              type="button"
              class="control-action"
              aria-label="Next page"
              (click)="nextPage()"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <div [id]="activeFiltersId" class="active-filters" aria-label="Active filters">
        <span class="active-filters-label">Active filters:</span>
        @if (activeFilters().length > 0) {
          @for (filter of activeFilters(); track filter.value) {
            <button
              type="button"
              class="filter-chip"
              [attr.aria-label]="'Remove filter ' + filter.label"
              (click)="removeFilter(filter.value)"
            >
              {{ filter.label }}
              <span aria-hidden="true">×</span>
            </button>
          }
        } @else {
          <span>None</span>
        }
      </div>

      <p [id]="summaryId" class="query-summary" role="status" aria-live="polite">
        {{ querySummary() }}
      </p>
    </form>
  `,
  styles: [`
    :host {
      display: block;
      min-width: 0;
    }

    .list-query-controls {
      display: grid;
      gap: 16px;
      padding: 20px;
      border: 1px solid var(--ui-border);
      border-radius: var(--ui-radius-md);
      background: var(--ui-surface);
      box-shadow: var(--ui-shadow-sm);
    }

    .criteria-grid {
      display: grid;
      grid-template-columns: minmax(12rem, 1.4fr) minmax(10rem, 1fr) minmax(10rem, 1fr) auto;
      align-items: end;
      gap: 12px;
    }

    .control-group {
      display: grid;
      min-width: 0;
      gap: 6px;
    }

    label,
    .active-filters-label {
      color: var(--ui-text);
      font-size: 12px;
      font-weight: 700;
    }

    input,
    select {
      width: 100%;
      min-height: 44px;
      padding: 9px 11px;
      border: 1px solid var(--ui-border-strong);
      border-radius: var(--ui-radius-sm);
      background: var(--ui-surface);
      color: var(--ui-text);
    }

    select[multiple] {
      min-height: 96px;
      padding: 4px;
    }

    option {
      padding: 5px 6px;
    }

    .criteria-actions,
    .page-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .criteria-actions {
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .control-action,
    .filter-chip {
      min-height: 44px;
      padding: 8px 12px;
      border: 1px solid var(--ui-border-strong);
      border-radius: var(--ui-radius-sm);
      background: var(--ui-surface);
      color: var(--ui-text);
      cursor: pointer;
      font-weight: 650;
    }

    .control-action:hover,
    .filter-chip:hover {
      background: var(--ui-surface-subtle);
    }

    .control-action:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }

    .active-filters {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      color: var(--ui-text-muted);
      font-size: 13px;
    }

    .filter-chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 36px;
      padding: 5px 10px;
      color: var(--ui-text);
      font-size: 13px;
    }

    .filter-chip span {
      font-size: 16px;
      line-height: 1;
    }

    .query-summary {
      margin: 0;
      color: var(--ui-text-muted);
      font-size: 13px;
    }

    @media (max-width: 860px) {
      .criteria-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .search-control {
        grid-column: 1 / -1;
      }

      .criteria-actions {
        grid-column: 1 / -1;
        justify-content: flex-start;
      }
    }

    @media (max-width: 600px) {
      .list-query-controls {
        padding: 16px;
      }

      .criteria-grid {
        grid-template-columns: 1fr;
      }

      .search-control,
      .criteria-actions {
        grid-column: auto;
      }

      .criteria-actions,
      .page-actions {
        width: 100%;
      }

      .criteria-actions {
        align-items: stretch;
        flex-direction: column;
      }

      .page-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .control-action {
        width: 100%;
      }
    }
  `]
})
export class ListQueryControlsComponent {
  readonly filterOptions = input<readonly ListFilterOption[]>([]);
  readonly sortOptions = input<readonly ListSortOption[]>([]);
  readonly maxSearchLength = MAX_SEARCH_LENGTH;
  private static nextInstanceId = 0;
  readonly idPrefix = `list-query-${ListQueryControlsComponent.nextInstanceId++}`;
  readonly searchId = `${this.idPrefix}-search`;
  readonly filtersId = `${this.idPrefix}-filters`;
  readonly sortId = `${this.idPrefix}-sort`;
  readonly activeFiltersId = `${this.idPrefix}-active-filters`;
  readonly summaryId = `${this.idPrefix}-summary`;

  readonly form = new FormGroup({
    search: new FormControl('', { nonNullable: true }),
    filters: new FormControl<string[]>([], { nonNullable: true }),
    sort: new FormControl('', { nonNullable: true })
  });

  private readonly destroyRef = inject(DestroyRef);
  private readonly queryFacade = inject(ListQueryStateFacade);

  private readonly filterOptionMap = computed(() => {
    const options = new Map<string, ListFilterOption>();
    for (const option of this.filterOptions()) {
      const value = normalizeListQueryState({ filters: [option.value] }).filters[0];
      if (value && !options.has(value)) {
        options.set(value, option);
      }
    }
    return options;
  });

  private readonly sortOptionMap = computed(() => {
    const options = new Map<string, ListSortOption>();
    for (const option of this.sortOptions()) {
      const value = normalizeTokenValue(option.value);
      if (value && !options.has(value)) {
        options.set(value, option);
      }
    }
    return options;
  });

  private readonly effectiveState = computed(() => {
    const state = this.queryFacade.state();
    const filterOptions = this.filterOptionMap();
    const sortOptions = this.sortOptionMap();

    return {
      search: state.search,
      filters: state.filters.filter((filter) => filterOptions.has(filter)),
      sort: sortOptions.has(state.sort) ? state.sort : '',
      page: state.page
    };
  });

  readonly activeFilters = computed<readonly ActiveListFilter[]>(() => {
    const options = this.filterOptionMap();
    return this.effectiveState().filters.map((value) => ({
      value,
      label: options.get(value)?.label ?? value
    }));
  });

  readonly canPrevious = computed(() => this.effectiveState().page > 1);

  readonly querySummary = computed(() => {
    const state = this.effectiveState();
    const parts = [`Page ${state.page}`];

    if (state.search) {
      parts.push(`Search: ${state.search}`);
    }
    if (state.filters.length > 0) {
      parts.push(`Filters: ${this.activeFilters().map((filter) => filter.label).join(', ')}`);
    }
    if (state.sort) {
      parts.push(`Sort: ${this.sortOptionMap().get(state.sort)?.label ?? state.sort}`);
    }

    return parts.join('. ') + '.';
  });

  constructor() {
    effect(() => {
      const state = this.effectiveState();
      this.form.patchValue({
        search: state.search,
        filters: [...state.filters],
        sort: state.sort
      }, { emitEvent: false });
    });

    this.form.controls.search.valueChanges.pipe(
      debounceTime(250),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((search: string) => {
      void this.queryFacade.setSearch(search);
    });

    this.form.controls.sort.valueChanges.pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((sort: string) => {
      const normalized = normalizeTokenValue(sort);
      void this.queryFacade.setSort(normalized && this.sortOptionMap().has(normalized) ? normalized : '');
    });
  }

  onFiltersChange(event: Event): void {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) {
      return;
    }

    const filters = this.allowedFilters(
      Array.from(select.selectedOptions, (option) => option.getAttribute('data-query-value') ?? '')
    );
    this.form.controls.filters.patchValue([...filters], { emitEvent: false });
    void this.queryFacade.setFilters(filters);
  }

  reset(): void {
    void this.queryFacade.reset();
  }

  nextPage(): void {
    void this.queryFacade.setPage(this.effectiveState().page + 1);
  }

  previousPage(): void {
    void this.queryFacade.setPage(Math.max(1, this.effectiveState().page - 1));
  }

  removeFilter(filter: string): void {
    void this.queryFacade.setFilters(this.effectiveState().filters.filter((value) => value !== filter));
  }

  private allowedFilters(filters: readonly string[]): readonly string[] {
    const options = this.filterOptionMap();
    return normalizeListQueryState({ filters }).filters.filter((filter) => options.has(filter));
  }
}
