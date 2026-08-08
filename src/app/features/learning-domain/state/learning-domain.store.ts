import { Injectable, computed, signal, type Signal } from '@angular/core';

import {
  cloneContentItem,
  cloneCourse,
  cloneLearningOutcome,
  cloneLearningPath,
  type ContentItem,
  type ContentItemFilter,
  type ContentItemId,
  type Course,
  type CourseFilter,
  type CourseId,
  type LearningOutcome,
  type LearningOutcomeFilter,
  type LearningOutcomeId,
  type LearningPath,
  type LearningPathFilter,
  type LearningPathId,
  type LearningDomainQuery,
  type LifecycleState,
  type SortDirection
} from '../models/learning-domain.models';
import type { LearningDomainErrorCode } from '../data-access/learning-domain.repository';

export type LearningDomainResource = 'courses' | 'outcomes' | 'content' | 'paths';

export type LearningDomainRequestStatus =
  | 'idle'
  | 'loading'
  | 'slow'
  | 'success'
  | 'empty'
  | 'error'
  | 'unauthorized'
  | 'conflict';

export interface LearningDomainRequestState {
  readonly status: LearningDomainRequestStatus;
  readonly requestId: number;
  readonly error: unknown | null;
  readonly errorCode?: LearningDomainErrorCode;
}

export interface NormalizedEntityState<TEntity> {
  readonly ids: readonly string[];
  readonly entities: Readonly<Record<string, TEntity>>;
}

export interface LearningDomainFilters {
  readonly courses: CourseFilter;
  readonly outcomes: LearningOutcomeFilter;
  readonly content: ContentItemFilter;
  readonly paths: LearningPathFilter;
}

export interface LearningDomainStoreState {
  readonly courses: NormalizedEntityState<Course>;
  readonly outcomes: NormalizedEntityState<LearningOutcome>;
  readonly content: NormalizedEntityState<ContentItem>;
  readonly paths: NormalizedEntityState<LearningPath>;
  readonly filters: LearningDomainFilters;
  readonly requests: Readonly<Record<LearningDomainResource, LearningDomainRequestState>>;
}

const EMPTY_ENTITIES: Readonly<Record<string, never>> = Object.freeze({});

const emptyCollection = <TEntity>(): NormalizedEntityState<TEntity> =>
  Object.freeze({
    ids: Object.freeze([]),
    entities: EMPTY_ENTITIES as Readonly<Record<string, TEntity>>
  });

const emptyFilter = Object.freeze({});

const idleRequest = (): LearningDomainRequestState =>
  Object.freeze({ status: 'idle' as const, requestId: 0, error: null });

const initialFilters: LearningDomainFilters = Object.freeze({
  courses: emptyFilter,
  outcomes: emptyFilter,
  content: emptyFilter,
  paths: emptyFilter
});

const initialRequests: Readonly<Record<LearningDomainResource, LearningDomainRequestState>> = Object.freeze({
  courses: idleRequest(),
  outcomes: idleRequest(),
  content: idleRequest(),
  paths: idleRequest()
});

const initialState: LearningDomainStoreState = Object.freeze({
  courses: emptyCollection<Course>(),
  outcomes: emptyCollection<LearningOutcome>(),
  content: emptyCollection<ContentItem>(),
  paths: emptyCollection<LearningPath>(),
  filters: initialFilters,
  requests: initialRequests
});

const immutableFilter = <TFilter extends object>(filter: TFilter): TFilter =>
  Object.freeze({
    ...filter,
    ...(Array.isArray((filter as { readonly statuses?: readonly unknown[] }).statuses)
      ? { statuses: Object.freeze([...(filter as { readonly statuses: readonly unknown[] }).statuses]) }
      : {}),
    ...(Array.isArray((filter as { readonly formats?: readonly unknown[] }).formats)
      ? { formats: Object.freeze([...(filter as { readonly formats: readonly unknown[] }).formats]) }
      : {})
  }) as TFilter;

const filterKey = (filter: object): string => JSON.stringify(filter);

const sameFilter = (left: object, right: object): boolean => filterKey(left) === filterKey(right);

const matchesSearch = (search: string | undefined, values: readonly string[]): boolean => {
  if (search === undefined || search.trim().length === 0) {
    return true;
  }
  const needle = search.trim().toLocaleLowerCase();
  return values.some((value) => value.toLocaleLowerCase().includes(needle));
};

const matchesStatus = (
  value: LifecycleState,
  status: LifecycleState | undefined,
  statuses: readonly LifecycleState[] | undefined
): boolean =>
  (status === undefined || value === status) &&
  (statuses === undefined || statuses.length === 0 || statuses.includes(value));

const compareValues = (left: string | number, right: string | number): number =>
  left < right ? -1 : left > right ? 1 : 0;

const direction = (value: SortDirection | undefined): 1 | -1 => (value === 'desc' ? -1 : 1);

const sortByStableId = <TEntity extends { readonly id: string }>(
  values: readonly TEntity[],
  selector: (value: TEntity) => string | number,
  sortDirection: SortDirection | undefined
): readonly TEntity[] => {
  const sorted = [...values].sort((left, right) => {
    const primary = compareValues(selector(left), selector(right)) * direction(sortDirection);
    return primary === 0 ? compareValues(left.id, right.id) : primary;
  });
  return Object.freeze(sorted);
};

const sameArray = <T>(left: readonly T[], right: readonly T[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const sameAccessConditions = (
  left: ContentItem['accessConditions'],
  right: ContentItem['accessConditions']
): boolean =>
  left.visibility === right.visibility &&
  left.requiresEnrollment === right.requiresEnrollment &&
  sameArray(left.requiredOutcomeIds ?? [], right.requiredOutcomeIds ?? []) &&
  sameArray(left.requiredRoleCodes ?? [], right.requiredRoleCodes ?? []) &&
  left.availableFrom === right.availableFrom &&
  left.availableUntil === right.availableUntil;

const sameReasonDetails = (
  left: LearningPath['entries'][number]['reasonDetails'],
  right: LearningPath['entries'][number]['reasonDetails']
): boolean => {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  const leftFactors = Object.keys(left.factors);
  const rightFactors = Object.keys(right.factors);
  return (
    left.code === right.code &&
    left.summary === right.summary &&
    left.detail === right.detail &&
    leftFactors.length === rightFactors.length &&
    leftFactors.every((key) => left.factors[key] === right.factors[key])
  );
};

const sameCourse = (left: Course, right: Course): boolean =>
  left.id === right.id &&
  left.code === right.code &&
  left.title === right.title &&
  left.description === right.description &&
  left.termId === right.termId &&
  left.status === right.status &&
  left.createdAt === right.createdAt &&
  left.updatedAt === right.updatedAt &&
  left.version === right.version &&
  sameArray(left.instructorIds, right.instructorIds) &&
  sameArray(left.learningOutcomeIds, right.learningOutcomeIds);

const sameOutcome = (left: LearningOutcome, right: LearningOutcome): boolean =>
  left.id === right.id &&
  left.courseId === right.courseId &&
  left.code === right.code &&
  left.title === right.title &&
  left.description === right.description &&
  left.level === right.level &&
  left.status === right.status &&
  left.createdAt === right.createdAt &&
  left.updatedAt === right.updatedAt &&
  left.version === right.version &&
  sameArray(left.prerequisiteOutcomeIds, right.prerequisiteOutcomeIds);

const sameContent = (left: ContentItem, right: ContentItem): boolean =>
  left.id === right.id &&
  left.courseId === right.courseId &&
  left.title === right.title &&
  left.description === right.description &&
  left.level === right.level &&
  left.durationMinutes === right.durationMinutes &&
  left.format === right.format &&
  left.status === right.status &&
  left.createdAt === right.createdAt &&
  left.updatedAt === right.updatedAt &&
  left.version === right.version &&
  sameArray(left.learningOutcomeIds, right.learningOutcomeIds) &&
  sameAccessConditions(left.accessConditions, right.accessConditions);

const samePath = (left: LearningPath, right: LearningPath): boolean =>
  left.id === right.id &&
  left.courseId === right.courseId &&
  left.title === right.title &&
  left.description === right.description &&
  left.status === right.status &&
  left.reason === right.reason &&
  left.createdAt === right.createdAt &&
  left.updatedAt === right.updatedAt &&
  left.version === right.version &&
  left.entries.length === right.entries.length &&
  left.entries.every((entry, index) => {
    const other = right.entries[index];
    return (
      entry.id === other.id &&
      entry.order === other.order &&
      entry.contentItemId === other.contentItemId &&
      entry.reason === other.reason &&
      entry.isCompleted === other.isCompleted &&
      entry.isLocked === other.isLocked &&
      sameReasonDetails(entry.reasonDetails, other.reasonDetails)
    );
  });

const materialize = <TEntity>(collection: NormalizedEntityState<TEntity>): readonly TEntity[] =>
  Object.freeze(collection.ids.flatMap((id) => {
    const entity = collection.entities[id];
    return entity === undefined ? [] : [entity];
  }));

const upsertCollection = <TEntity extends { readonly id: string }>(
  collection: NormalizedEntityState<TEntity>,
  value: TEntity,
  clone: (entity: TEntity) => TEntity,
  equal: (left: TEntity, right: TEntity) => boolean
): NormalizedEntityState<TEntity> => {
  const entity = clone(value);
  const previous = collection.entities[entity.id];
  if (previous !== undefined && equal(previous, entity)) {
    return collection;
  }

  const entities = { ...collection.entities, [entity.id]: entity };
  const ids = previous === undefined ? [...collection.ids, entity.id] : [...collection.ids];
  return Object.freeze({
    ids: Object.freeze(ids),
    entities: Object.freeze(entities)
  });
};

const replaceCollection = <TEntity extends { readonly id: string }>(
  collection: NormalizedEntityState<TEntity>,
  values: readonly TEntity[],
  clone: (entity: TEntity) => TEntity,
  equal: (left: TEntity, right: TEntity) => boolean
): NormalizedEntityState<TEntity> => {
  const normalized = values.map(clone);
  if (
    normalized.length === collection.ids.length &&
    normalized.every((entity, index) => {
      const previous = collection.entities[collection.ids[index]];
      return collection.ids[index] === entity.id && previous !== undefined && equal(previous, entity);
    })
  ) {
    return collection;
  }

  const entities: Record<string, TEntity> = {};
  for (const entity of normalized) {
    entities[entity.id] = entity;
  }
  return Object.freeze({
    ids: Object.freeze(normalized.map((entity) => entity.id)),
    entities: Object.freeze(entities)
  });
};

const deleteFromCollection = <TEntity>(
  collection: NormalizedEntityState<TEntity>,
  id: string
): NormalizedEntityState<TEntity> => {
  if (collection.entities[id] === undefined) {
    return collection;
  }
  const entities = { ...collection.entities } as Record<string, TEntity>;
  delete entities[id];
  return Object.freeze({
    ids: Object.freeze(collection.ids.filter((currentId) => currentId !== id)),
    entities: Object.freeze(entities)
  });
};

const filterCourses = (values: readonly Course[], filter: CourseFilter): readonly Course[] => {
  const filtered = values.filter(
    (course) =>
      matchesSearch(filter.search, [course.code, course.title, course.description]) &&
      matchesStatus(course.status, filter.status, filter.statuses) &&
      (filter.termId === undefined || course.termId === filter.termId)
  );
  const field = filter.sortBy ?? 'code';
  return sortByStableId(
    filtered,
    (course) =>
      field === 'updatedAt' ? course.updatedAt : field === 'title' ? course.title : field === 'status' ? course.status : course.code,
    filter.sortDirection
  );
};

const filterOutcomes = (
  values: readonly LearningOutcome[],
  filter: LearningOutcomeFilter
): readonly LearningOutcome[] => {
  const filtered = values.filter(
    (outcome) =>
      matchesSearch(filter.search, [outcome.code, outcome.title, outcome.description]) &&
      (filter.courseId === undefined || outcome.courseId === filter.courseId) &&
      matchesStatus(outcome.status, filter.status, filter.statuses) &&
      (filter.level === undefined || outcome.level === filter.level) &&
      (filter.minLevel === undefined || outcome.level >= filter.minLevel) &&
      (filter.maxLevel === undefined || outcome.level <= filter.maxLevel)
  );
  const field = filter.sortBy ?? 'code';
  return sortByStableId(
    filtered,
    (outcome) =>
      field === 'updatedAt'
        ? outcome.updatedAt
        : field === 'title'
          ? outcome.title
          : field === 'level'
            ? outcome.level
            : field === 'status'
              ? outcome.status
              : outcome.code,
    filter.sortDirection
  );
};

const filterContent = (values: readonly ContentItem[], filter: ContentItemFilter): readonly ContentItem[] => {
  const outcomeId = filter.outcomeId ?? filter.learningOutcomeId;
  const filtered = values.filter(
    (content) =>
      matchesSearch(filter.search, [content.title, content.description]) &&
      (filter.courseId === undefined || content.courseId === filter.courseId) &&
      (outcomeId === undefined || content.learningOutcomeIds.includes(outcomeId)) &&
      matchesStatus(content.status, filter.status, filter.statuses) &&
      (filter.level === undefined || content.level === filter.level) &&
      (filter.minLevel === undefined || content.level >= filter.minLevel) &&
      (filter.maxLevel === undefined || content.level <= filter.maxLevel) &&
      (filter.format === undefined || content.format === filter.format) &&
      (filter.formats === undefined || filter.formats.length === 0 || filter.formats.includes(content.format))
  );
  const field = filter.sortBy ?? 'title';
  return sortByStableId(
    filtered,
    (content) =>
      field === 'updatedAt'
        ? content.updatedAt
        : field === 'level'
          ? content.level
          : field === 'durationMinutes'
            ? content.durationMinutes
            : field === 'format'
              ? content.format
              : field === 'status'
                ? content.status
                : content.title,
    filter.sortDirection
  );
};

const filterPaths = (values: readonly LearningPath[], filter: LearningPathFilter): readonly LearningPath[] => {
  const filtered = values.filter(
    (path) =>
      matchesSearch(filter.search, [path.title, path.description, path.reason]) &&
      (filter.courseId === undefined || path.courseId === filter.courseId) &&
      matchesStatus(path.status, filter.status, filter.statuses)
  );
  const field = filter.sortBy ?? 'title';
  return sortByStableId(
    filtered,
    (path) => (field === 'updatedAt' ? path.updatedAt : field === 'status' ? path.status : path.title),
    filter.sortDirection
  );
};

@Injectable({ providedIn: 'root' })
export class LearningDomainStore {
  private readonly writableState = signal<LearningDomainStoreState>(initialState);

  readonly state: Signal<LearningDomainStoreState> = this.writableState.asReadonly();
  readonly snapshot: Signal<LearningDomainStoreState> = this.state;

  readonly courseIds = computed(() => this.state().courses.ids);
  readonly outcomeIds = computed(() => this.state().outcomes.ids);
  readonly contentIds = computed(() => this.state().content.ids);
  readonly pathIds = computed(() => this.state().paths.ids);

  readonly courseEntities = computed(() => this.state().courses.entities);
  readonly outcomeEntities = computed(() => this.state().outcomes.entities);
  readonly contentEntities = computed(() => this.state().content.entities);
  readonly pathEntities = computed(() => this.state().paths.entities);

  readonly courses = computed(() => materialize(this.state().courses));
  readonly outcomes = computed(() => materialize(this.state().outcomes));
  readonly content = computed(() => materialize(this.state().content));
  readonly paths = computed(() => materialize(this.state().paths));

  readonly courseFilter = computed(() => this.state().filters.courses);
  readonly outcomeFilter = computed(() => this.state().filters.outcomes);
  readonly contentFilter = computed(() => this.state().filters.content);
  readonly pathFilter = computed(() => this.state().filters.paths);

  readonly filteredCourses = computed(() => filterCourses(this.courses(), this.courseFilter()));
  readonly filteredOutcomes = computed(() => filterOutcomes(this.outcomes(), this.outcomeFilter()));
  readonly filteredContent = computed(() => filterContent(this.content(), this.contentFilter()));
  readonly filteredPaths = computed(() => filterPaths(this.paths(), this.pathFilter()));

  readonly visibleCourses = this.filteredCourses;
  readonly visibleOutcomes = this.filteredOutcomes;
  readonly visibleContent = this.filteredContent;
  readonly visiblePaths = this.filteredPaths;

  readonly requestStates = computed(() => this.state().requests);
  readonly coursesRequestState = computed(() => this.state().requests.courses);
  readonly outcomesRequestState = computed(() => this.state().requests.outcomes);
  readonly contentRequestState = computed(() => this.state().requests.content);
  readonly pathsRequestState = computed(() => this.state().requests.paths);
  readonly requestState = this.requestStates;

  courseById(id: CourseId): Course | undefined {
    return this.state().courses.entities[id];
  }

  outcomeById(id: LearningOutcomeId): LearningOutcome | undefined {
    return this.state().outcomes.entities[id];
  }

  contentById(id: ContentItemId): ContentItem | undefined {
    return this.state().content.entities[id];
  }

  pathById(id: LearningPathId): LearningPath | undefined {
    return this.state().paths.entities[id];
  }

  selectCourse(id: CourseId): Signal<Course | undefined> {
    return computed(() => this.state().courses.entities[id]);
  }

  selectOutcome(id: LearningOutcomeId): Signal<LearningOutcome | undefined> {
    return computed(() => this.state().outcomes.entities[id]);
  }

  selectContent(id: ContentItemId): Signal<ContentItem | undefined> {
    return computed(() => this.state().content.entities[id]);
  }

  selectPath(id: LearningPathId): Signal<LearningPath | undefined> {
    return computed(() => this.state().paths.entities[id]);
  }

  selectCourses(filter: CourseFilter = {}): Signal<readonly Course[]> {
    const normalized = immutableFilter(filter);
    return computed(() => filterCourses(this.courses(), normalized));
  }

  selectOutcomes(filter: LearningOutcomeFilter = {}): Signal<readonly LearningOutcome[]> {
    const normalized = immutableFilter(filter);
    return computed(() => filterOutcomes(this.outcomes(), normalized));
  }

  selectContentItems(filter: ContentItemFilter = {}): Signal<readonly ContentItem[]> {
    const normalized = immutableFilter(filter);
    return computed(() => filterContent(this.content(), normalized));
  }

  selectPaths(filter: LearningPathFilter = {}): Signal<readonly LearningPath[]> {
    const normalized = immutableFilter(filter);
    return computed(() => filterPaths(this.paths(), normalized));
  }

  getSnapshot(): LearningDomainStoreState {
    return this.state();
  }

  setQuery(query: LearningDomainQuery): void {
    const current = this.state().filters;
    const next: LearningDomainFilters = Object.freeze({
      courses: immutableFilter(query.courses ?? current.courses),
      outcomes: immutableFilter(query.outcomes ?? current.outcomes),
      content: immutableFilter(query.content ?? current.content),
      paths: immutableFilter(query.paths ?? current.paths)
    });
    if (
      sameFilter(current.courses, next.courses) &&
      sameFilter(current.outcomes, next.outcomes) &&
      sameFilter(current.content, next.content) &&
      sameFilter(current.paths, next.paths)
    ) {
      return;
    }
    this.commit({ ...this.state(), filters: next });
  }

  setCourseFilter(filter: CourseFilter): void {
    this.updateFilter('courses', filter);
  }

  setOutcomeFilter(filter: LearningOutcomeFilter): void {
    this.updateFilter('outcomes', filter);
  }

  setContentFilter(filter: ContentItemFilter): void {
    this.updateFilter('content', filter);
  }

  setPathFilter(filter: LearningPathFilter): void {
    this.updateFilter('paths', filter);
  }

  replaceCourses(values: readonly Course[]): void {
    const next = replaceCollection(this.state().courses, values, cloneCourse, sameCourse);
    if (next !== this.state().courses) {
      this.commit({ ...this.state(), courses: next });
    }
  }

  replaceOutcomes(values: readonly LearningOutcome[]): void {
    const next = replaceCollection(this.state().outcomes, values, cloneLearningOutcome, sameOutcome);
    if (next !== this.state().outcomes) {
      this.commit({ ...this.state(), outcomes: next });
    }
  }

  replaceContent(values: readonly ContentItem[]): void {
    const next = replaceCollection(this.state().content, values, cloneContentItem, sameContent);
    if (next !== this.state().content) {
      this.commit({ ...this.state(), content: next });
    }
  }

  replacePaths(values: readonly LearningPath[]): void {
    const next = replaceCollection(this.state().paths, values, cloneLearningPath, samePath);
    if (next !== this.state().paths) {
      this.commit({ ...this.state(), paths: next });
    }
  }

  upsertCourse(value: Course): void {
    const next = upsertCollection(this.state().courses, value, cloneCourse, sameCourse);
    if (next !== this.state().courses) {
      this.commit({ ...this.state(), courses: next });
    }
  }

  upsertOutcome(value: LearningOutcome): void {
    const next = upsertCollection(this.state().outcomes, value, cloneLearningOutcome, sameOutcome);
    if (next !== this.state().outcomes) {
      this.commit({ ...this.state(), outcomes: next });
    }
  }

  upsertContent(value: ContentItem): void {
    const next = upsertCollection(this.state().content, value, cloneContentItem, sameContent);
    if (next !== this.state().content) {
      this.commit({ ...this.state(), content: next });
    }
  }

  upsertPath(value: LearningPath): void {
    const next = upsertCollection(this.state().paths, value, cloneLearningPath, samePath);
    if (next !== this.state().paths) {
      this.commit({ ...this.state(), paths: next });
    }
  }

  deleteCourse(id: CourseId): void {
    const next = deleteFromCollection(this.state().courses, id);
    if (next !== this.state().courses) {
      this.commit({ ...this.state(), courses: next });
    }
  }

  deleteOutcome(id: LearningOutcomeId): void {
    const next = deleteFromCollection(this.state().outcomes, id);
    if (next !== this.state().outcomes) {
      this.commit({ ...this.state(), outcomes: next });
    }
  }

  deleteContent(id: ContentItemId): void {
    const next = deleteFromCollection(this.state().content, id);
    if (next !== this.state().content) {
      this.commit({ ...this.state(), content: next });
    }
  }

  deletePath(id: LearningPathId): void {
    const next = deleteFromCollection(this.state().paths, id);
    if (next !== this.state().paths) {
      this.commit({ ...this.state(), paths: next });
    }
  }

  beginRequest(resource: LearningDomainResource, requestId: number): void {
    const previous = this.state().requests[resource];
    if (previous.status === 'loading' && previous.requestId === requestId && previous.error === null) {
      return;
    }
    this.setRequest(resource, {
      status: 'loading',
      requestId,
      error: null
    });
  }
  markRequestSlow(resource: LearningDomainResource, requestId: number): boolean {
    const previous = this.state().requests[resource];
    if (previous.requestId !== requestId || previous.status !== 'loading') {
      return false;
    }
    this.setRequest(resource, { status: 'slow', requestId, error: null });
    return true;
  }


  completeRequest(resource: LearningDomainResource, requestId: number, itemCount: number): boolean {
    const previous = this.state().requests[resource];
    if (previous.requestId !== requestId) {
      return false;
    }
    const status = itemCount === 0 ? 'empty' : 'success';
    this.setRequest(resource, { status, requestId, error: null });
    return true;
  }

  failRequest(
    resource: LearningDomainResource,
    requestId: number,
    error: unknown,
    status: Exclude<LearningDomainRequestStatus, 'idle' | 'loading' | 'slow' | 'success' | 'empty'> = 'error',
    errorCode?: LearningDomainErrorCode
  ): boolean {
    const previous = this.state().requests[resource];
    if (previous.requestId !== requestId) {
      return false;
    }
    this.setRequest(resource, { status, requestId, error, errorCode });
    return true;
  }

  private updateFilter(resource: LearningDomainResource, filter: object): void {
    const current = this.state();
    const currentFilter = current.filters[resource];
    const nextFilter = immutableFilter(filter);
    if (sameFilter(currentFilter, nextFilter)) {
      return;
    }
    this.commit({
      ...current,
      filters: Object.freeze({
        ...current.filters,
        [resource]: nextFilter
      })
    });
  }




  private setRequest(resource: LearningDomainResource, request: LearningDomainRequestState): void {
    const previous = this.state().requests[resource];
    const next = Object.freeze(request);
    if (
      previous.status === next.status &&
      previous.requestId === next.requestId &&
      previous.error === next.error &&
      previous.errorCode === next.errorCode
    ) {
      return;
    }
    this.commit({
      ...this.state(),
      requests: Object.freeze({
        ...this.state().requests,
        [resource]: next
      })
    });
  }

  private commit(next: LearningDomainStoreState): void {
    const previous = this.state();
    if (previous === next) {
      return;
    }
    this.writableState.set(Object.freeze(next));
  }
}
