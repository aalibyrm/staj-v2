import { Injectable, type Signal, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, type ParamMap, type Params } from '@angular/router';
import { map } from 'rxjs';

export type ListQueryState = Readonly<{
  search: string;
  filters: readonly string[];
  sort: string;
  page: number;
}>;

export type ListQueryStateInput = Readonly<Partial<{
  search: unknown;
  filters: unknown;
  sort: unknown;
  page: unknown;
}>>;

export type ListQueryParamSource = ParamMap | Readonly<Record<string, unknown>> | null | undefined;

export const MAX_SEARCH_LENGTH = 120;
export const MAX_TOKEN_LENGTH = 64;
export const MAX_PAGE = 100_000;

const DEFAULT_SEARCH = '';
const DEFAULT_FILTERS: readonly string[] = [];
const DEFAULT_SORT = '';
const DEFAULT_PAGE = 1;
const TOKEN_PATTERN = /^[A-Za-z0-9]+(?:[._:-][A-Za-z0-9]+)*$/;

const freezeState = (state: {
  search: string;
  filters: readonly string[];
  sort: string;
  page: number;
}): ListQueryState => Object.freeze({
  search: state.search,
  filters: Object.freeze([...state.filters]),
  sort: state.sort,
  page: state.page
});

export const DEFAULT_LIST_QUERY_STATE: ListQueryState = freezeState({
  search: DEFAULT_SEARCH,
  filters: DEFAULT_FILTERS,
  sort: DEFAULT_SORT,
  page: DEFAULT_PAGE
});

const toSafeText = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }

  return String(value);
};

const isParamMap = (source: ListQueryParamSource): source is ParamMap => {
  if (typeof source !== 'object' || source === null) {
    return false;
  }

  try {
    const candidate = source as { get?: unknown; getAll?: unknown };
    return typeof candidate.get === 'function' && typeof candidate.getAll === 'function';
  } catch {
    return false;
  }
};

const readAll = (source: ListQueryParamSource, key: string): readonly unknown[] => {
  if (isParamMap(source)) {
    try {
      const values = source.getAll(key);
      return Array.isArray(values) ? values : [];
    } catch {
      return [];
    }
  }

  if (typeof source !== 'object' || source === null) {
    return [];
  }

  try {
    const value = source[key];
    if (Array.isArray(value)) {
      return value;
    }

    return value === null || value === undefined ? [] : [value];
  } catch {
    return [];
  }
};

const readOne = (source: ListQueryParamSource, key: string): unknown => {
  if (isParamMap(source)) {
    try {
      return source.get(key);
    } catch {
      return null;
    }
  }

  return readAll(source, key)[0] ?? null;
};

export const normalizeSearchValue = (value: unknown): string => {
  const text = toSafeText(value);
  return text === null ? DEFAULT_SEARCH : text.trim().slice(0, MAX_SEARCH_LENGTH);
};

export const normalizeTokenValue = (value: unknown): string | null => {
  const text = toSafeText(value);
  if (text === null) {
    return null;
  }

  const normalized = text.trim();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_TOKEN_LENGTH ||
    !TOKEN_PATTERN.test(normalized)
  ) {
    return null;
  }

  return normalized;
};

export const normalizePageValue = (value: unknown): number => {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 && value <= MAX_PAGE ? value : DEFAULT_PAGE;
  }

  const text = toSafeText(value)?.trim() ?? '';
  if (!/^\d+$/.test(text)) {
    return DEFAULT_PAGE;
  }

  const page = Number(text);
  return Number.isSafeInteger(page) && page > 0 && page <= MAX_PAGE ? page : DEFAULT_PAGE;
};

const normalizeFilters = (value: unknown): readonly string[] => {
  const values = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  const seen = new Set<string>();
  const filters: string[] = [];

  try {
    for (const item of values) {
      const filter = normalizeTokenValue(item);
      if (filter !== null && !seen.has(filter)) {
        seen.add(filter);
        filters.push(filter);
      }
    }
  } catch {
    return filters;
  }

  return filters;
};

export const normalizeListQueryState = (value: ListQueryStateInput | null | undefined): ListQueryState => {
  const source = value && typeof value === 'object' ? value : {};
  let search: unknown;
  let filters: unknown;
  let sort: unknown;
  let page: unknown;

  try {
    search = source.search;
    filters = source.filters;
    sort = source.sort;
    page = source.page;
  } catch {
    return DEFAULT_LIST_QUERY_STATE;
  }

  return freezeState({
    search: normalizeSearchValue(search),
    filters: normalizeFilters(filters),
    sort: normalizeTokenValue(sort) ?? DEFAULT_SORT,
    page: normalizePageValue(page)
  });
};

export const parseListQueryState = (source: ListQueryParamSource): ListQueryState => normalizeListQueryState({
  search: readOne(source, 'search'),
  filters: readAll(source, 'filter'),
  sort: readOne(source, 'sort'),
  page: readOne(source, 'page')
});

export const serializeListQueryState = (
  value: ListQueryStateInput | null | undefined
): Params => {
  const state = normalizeListQueryState(value);
  const params: Params = {};

  if (state.search !== DEFAULT_SEARCH) {
    params['search'] = state.search;
  }
  if (state.filters.length > 0) {
    params['filter'] = [...state.filters];
  }
  if (state.sort !== DEFAULT_SORT) {
    params['sort'] = state.sort;
  }
  if (state.page !== DEFAULT_PAGE) {
    params['page'] = state.page;
  }

  return params;
};

export const areListQueryStatesEqual = (
  left: ListQueryState,
  right: ListQueryState
): boolean => left.search === right.search &&
  left.sort === right.sort &&
  left.page === right.page &&
  left.filters.length === right.filters.length &&
  left.filters.every((filter, index) => filter === right.filters[index]);

export type ListQueryStateUpdate = Readonly<Partial<{
  search: unknown;
  filters: unknown;
  sort: unknown;
  page: unknown;
}>>;

@Injectable()
export class ListQueryStateFacade {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private navigationPromise: Promise<boolean> = Promise.resolve(true);

  readonly state: Signal<ListQueryState> = toSignal(
    this.route.queryParamMap.pipe(map((params) => parseListQueryState(params))),
    { initialValue: parseListQueryState(this.route.snapshot.queryParamMap) }
  );

  get lastNavigation(): Promise<boolean> {
    return this.navigationPromise;
  }

  update(update: ListQueryStateUpdate = {}): Promise<boolean> {
    const current = this.state();
    const requested = normalizeListQueryState({ ...current, ...update });

    if (areListQueryStatesEqual(current, requested)) {
      return this.remember(Promise.resolve(true));
    }

    return this.navigate(requested);
  }

  setSearch(search: unknown): Promise<boolean> {
    return this.update({ search: normalizeSearchValue(search), page: DEFAULT_PAGE });
  }

  setFilters(filters: readonly unknown[]): Promise<boolean> {
    return this.update({ filters, page: DEFAULT_PAGE });
  }

  toggleFilter(filter: unknown): Promise<boolean> {
    const normalized = normalizeTokenValue(filter);
    if (normalized === null) {
      return this.remember(Promise.resolve(true));
    }

    const currentFilters = [...this.state().filters];
    const existingIndex = currentFilters.indexOf(normalized);
    if (existingIndex === -1) {
      currentFilters.push(normalized);
    } else {
      currentFilters.splice(existingIndex, 1);
    }

    return this.setFilters(currentFilters);
  }

  setSort(sort: unknown): Promise<boolean> {
    return this.update({ sort: normalizeTokenValue(sort) ?? DEFAULT_SORT, page: DEFAULT_PAGE });
  }

  setPage(page: unknown): Promise<boolean> {
    return this.update({ page: normalizePageValue(page) });
  }

  reset(): Promise<boolean> {
    const queryParamMap = this.route.snapshot.queryParamMap;
    const hasOwnedParameters = ['search', 'filter', 'sort', 'page'].some((key) => queryParamMap.has(key));
    if (!hasOwnedParameters) {
      return this.remember(Promise.resolve(true));
    }

    return this.remember(this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        search: null,
        filter: null,
        sort: null,
        page: null
      },
      queryParamsHandling: 'merge'
    }));
  }

  private navigate(state: ListQueryState): Promise<boolean> {
    const serialized = serializeListQueryState(state);
    return this.remember(this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        search: serialized['search'] ?? null,
        filter: serialized['filter'] ?? null,
        sort: serialized['sort'] ?? null,
        page: serialized['page'] ?? null
      },
      queryParamsHandling: 'merge'
    }));
  }

  private remember(promise: Promise<boolean>): Promise<boolean> {
    this.navigationPromise = promise;
    return promise;
  }
}
