import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal, type OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Subject, catchError, debounceTime, distinctUntilChanged, EMPTY, switchMap, tap } from 'rxjs';

import { SessionStore } from '../../../core/auth/session.store';
import { RequestStateComponent } from '../../../shared/components/request-state.component';
import { LearningDomainFacade } from '../data-access/learning-domain.facade';
import type { ContentAccessContext, LearningDomainOperationOptions } from '../data-access/learning-domain.repository';
import {
  CONTENT_FORMATS,
  LIFECYCLE_STATES,
  type ContentFormat,
  type ContentItem,
  type ContentItemFilter,
  type CourseId,
  type LifecycleState
} from '../models/learning-domain.models';

const PAGE_SIZE = 25;
const DEFAULT_SORT = 'title';
const DEFAULT_DIRECTION = 'asc';
const MANAGEMENT_ROLES = ['INSTRUCTOR', 'PROGRAM_MANAGER'] as const;

type CatalogFormValue = {
  readonly search: string;
  readonly courseId: string;
  readonly level: string;
  readonly format: string;
  readonly status: string;
  readonly sortBy: string;
  readonly sortDirection: string;
};

type CatalogRequest = {
  readonly value: CatalogFormValue;
  readonly syncQuery: boolean;
  readonly force: boolean;
};

type QueryParamSource = { readonly get: (name: string) => string | null };


@Component({
  selector: 'app-course-content-catalog',
  standalone: true,
  imports: [ReactiveFormsModule, RequestStateComponent],
  templateUrl: './course-content-catalog.component.html',
  styleUrl: './course-content-catalog.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CourseContentCatalogComponent implements OnInit {
  private readonly facade = inject(LearningDomainFacade);
  private readonly sessionStore = inject(SessionStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly filterRequests = new Subject<CatalogRequest>();
  private lastCanonicalQuery: string | null = null;

  readonly lifecycleStates = LIFECYCLE_STATES;
  readonly contentFormats = CONTENT_FORMATS;
  readonly pageSize = PAGE_SIZE;
  readonly skeletonRows = [1, 2, 3, 4, 5];
  readonly filterForm = new FormGroup({
    search: new FormControl('', { nonNullable: true }),
    courseId: new FormControl('', { nonNullable: true }),
    level: new FormControl('', { nonNullable: true }),
    format: new FormControl('', { nonNullable: true }),
    status: new FormControl('', { nonNullable: true }),
    sortBy: new FormControl(DEFAULT_SORT, { nonNullable: true }),
    sortDirection: new FormControl(DEFAULT_DIRECTION, { nonNullable: true })
  });
  readonly currentFormValue = signal<CatalogFormValue>(this.filterForm.getRawValue());

  readonly courses = computed(() => this.facade.courses());
  readonly outcomes = computed(() => this.facade.outcomes());
  readonly content = computed(() => this.facade.content());
  readonly courseRequest = computed(() => this.facade.coursesRequestState());
  readonly outcomeRequest = computed(() => this.facade.outcomesRequestState());
  readonly contentRequest = computed(() => this.facade.contentRequestState());
  readonly authorizedSession = computed(() => {
    const role = this.sessionStore.role();
    return this.sessionStore.session() !== null && (role === 'STUDENT' || MANAGEMENT_ROLES.includes(role as (typeof MANAGEMENT_ROLES)[number]));
  });
  readonly managementMode = computed(() => {
    const role = this.sessionStore.role();
    return MANAGEMENT_ROLES.includes(role as (typeof MANAGEMENT_ROLES)[number]);
  });
  readonly viewLabel = computed(() => this.managementMode() ? 'Management view' : 'Consume view');
  readonly accessContextLabel = computed(() => {
    if (this.managementMode()) {
      return 'Management catalog: all matching content is visible for administration; student consumption rules are not granted.';
    }
    return 'Student access context: course grants are used; completed outcomes are empty because no completion source is available.';
  });
  readonly liveMessage = signal('');
  readonly hasAttemptedLoad = signal(false);
  readonly hasSuccessfulContentLoad = signal(false);
  readonly renderLimit = signal(PAGE_SIZE);
  readonly isLoading = computed(() => {
    const statuses = [this.courseRequest().status, this.outcomeRequest().status, this.contentRequest().status];
    return this.authorizedSession() && !this.isUnauthorized() &&
      !statuses.includes('error') && !statuses.includes('slow') &&
      (!this.hasAttemptedLoad() || statuses.includes('loading') ||
        (this.contentRequest().status !== 'error' && this.contentRequest().status !== 'slow' && !this.hasSuccessfulContentLoad()));
  });
  readonly isUnauthorized = computed(() => !this.authorizedSession() ||
    this.courseRequest().status === 'unauthorized' || this.outcomeRequest().status === 'unauthorized' || this.contentRequest().status === 'unauthorized');
  readonly isServiceError = computed(() => !this.isUnauthorized() &&
    [this.courseRequest(), this.outcomeRequest(), this.contentRequest()].some((state) => state.status === 'error'));
  readonly isSlow = computed(() => !this.isUnauthorized() && !this.isServiceError() &&
    [this.courseRequest(), this.outcomeRequest(), this.contentRequest()].some((state) => state.status === 'slow'));
  readonly isBusy = computed(() => this.isLoading() || this.isSlow());
  readonly hasActiveFilter = computed(() => {
    const value = this.currentFormValue();
    return value.search.trim().length > 0 || value.courseId.length > 0 || value.level.length > 0 ||
      value.format.length > 0 || value.status.length > 0;
  });
  readonly outcomeCodes = computed(() => {
    const codes: Record<string, string> = {};
    for (const outcome of this.outcomes()) codes[outcome.id] = outcome.code;
    return codes;
  });
  readonly renderedContent = computed(() => this.content().slice(0, this.renderLimit()));
  readonly hasMoreContent = computed(() => this.renderedContent().length < this.content().length);
  readonly emptyTitle = computed(() => this.hasActiveFilter() ? 'No accessible content matches these filters' : 'No accessible content');
  readonly emptyMessage = computed(() => this.hasActiveFilter()
    ? 'No accessible rows matched the selected filters. Adjust the filters or clear them to search again.'
    : this.managementMode()
      ? 'No content is available for this catalog.'
      : 'No content is available in the current student access scope. Inaccessible rows are not shown.');

  ngOnInit(): void {
    this.filterRequests.pipe(
      distinctUntilChanged((left, right) =>
        !right.force && JSON.stringify(left.value) === JSON.stringify(right.value)
      ),
      debounceTime(200),
      tap(({ value, syncQuery }) => {
        if (syncQuery) this.syncQuery(value);
      }),
      switchMap(({ value }) => this.authorizedSession()
        ? this.facade.loadContent(this.toContentFilter(value), this.contentOptions()).pipe(
            tap(() => {
              this.hasSuccessfulContentLoad.set(true);
              this.renderLimit.set(PAGE_SIZE);
              this.liveMessage.set('Content catalog loaded.');
            }),
            catchError(() => EMPTY)
          )
        : EMPTY),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();

    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.applyQueryParams(params);
    });
    this.filterForm.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      const value = this.filterForm.getRawValue();
      this.currentFormValue.set(value);
      this.filterRequests.next({ value, syncQuery: true, force: false });
    });
    this.loadCoursesAndOutcomes();
  }

  loadCoursesAndOutcomes(): void {
    this.hasAttemptedLoad.set(true);
    if (!this.authorizedSession()) {
      this.liveMessage.set('Course catalog access is unavailable.');
      return;
    }
    this.liveMessage.set('Loading courses, outcomes, and content.');
    this.facade.loadCourses().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.liveMessage.set('Courses loaded.'),
      error: () => this.liveMessage.set('Courses could not be loaded. Try again.')
    });
    this.facade.loadOutcomes().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.liveMessage.set('Outcomes loaded.'),
      error: () => this.liveMessage.set('Outcomes could not be loaded. Try again.')
    });
  }

  retryLoad(): void {
    this.hasSuccessfulContentLoad.set(false);
    this.renderLimit.set(PAGE_SIZE);
    this.loadCoursesAndOutcomes();
    this.filterRequests.next({ value: this.filterForm.getRawValue(), syncQuery: false, force: true });
  }

  resetFilters(): void {
    this.filterForm.reset({ search: '', courseId: '', level: '', format: '', status: '', sortBy: DEFAULT_SORT, sortDirection: DEFAULT_DIRECTION });
  }

  showMore(): void {
    this.renderLimit.update((limit) => Math.min(limit + PAGE_SIZE, this.content().length));
  }

  relatedOutcomeCodes(item: ContentItem): string {
    const codes = this.outcomeCodes();
    return item.learningOutcomeIds.map((id) => codes[id] ?? String(id)).join(', ') || 'No related outcomes';
  }

  accessSummary(item: ContentItem): string {
    const conditions = item.accessConditions;
    const summary = [conditions.visibility === 'public' && conditions.requiresEnrollment !== true ? 'Public' : 'Enrollment required'];
    if (conditions.visibility === 'restricted') summary.push('Restricted');
    if ((conditions.requiredOutcomeIds?.length ?? 0) > 0) summary.push(`Requires ${conditions.requiredOutcomeIds?.length} completed outcome(s)`);
    if ((conditions.requiredRoleCodes?.length ?? 0) > 0) summary.push(`Role: ${conditions.requiredRoleCodes?.join(', ')}`);
    if (conditions.availableFrom !== undefined) summary.push(`Available from ${conditions.availableFrom}`);
    if (conditions.availableUntil !== undefined) summary.push(`Available until ${conditions.availableUntil}`);
    return summary.join('; ');
  }

  courseContext(courseId: CourseId): string {
    const course = this.courses().find((candidate) => candidate.id === courseId);
    return course === undefined ? String(courseId) : `${course.code} · ${course.title}`;
  }

  formatLabel(format: ContentFormat): string {
    return format.replace('-', ' ');
  }

  statusLabel(status: LifecycleState): string {
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  private applyQueryParams(params: QueryParamSource): void {
    const value: CatalogFormValue = {
      search: params.get('search') ?? '',
      courseId: params.get('course') ?? '',
      level: this.validLevel(params.get('level')),
      format: this.validFormat(params.get('format')),
      status: this.validStatus(params.get('status')),
      sortBy: this.validSortBy(params.get('sortBy')),
      sortDirection: params.get('direction') === 'desc' ? 'desc' : DEFAULT_DIRECTION
    };
    const canonical = this.canonicalQuery(value);
    if (canonical === this.lastCanonicalQuery) return;
    const syncQuery = this.lastCanonicalQuery === null;
    this.lastCanonicalQuery = canonical;
    this.filterForm.reset(value, { emitEvent: false });
    this.currentFormValue.set(value);
    this.filterRequests.next({ value, syncQuery, force: false });
  }

  private syncQuery(value: CatalogFormValue): void {
    const canonical = this.canonicalQuery(value);
    this.lastCanonicalQuery = canonical;
    const queryParams: Record<string, string | null> = {};
    if (value.search.trim()) queryParams['search'] = value.search.trim();
    if (value.courseId) queryParams['course'] = value.courseId;
    if (value.level) queryParams['level'] = value.level;
    if (value.format) queryParams['format'] = value.format;
    if (value.status) queryParams['status'] = value.status;
    if (value.sortBy !== DEFAULT_SORT) queryParams['sortBy'] = value.sortBy;
    if (value.sortDirection !== DEFAULT_DIRECTION) queryParams['direction'] = value.sortDirection;
    void this.router.navigate([], { relativeTo: this.route, queryParams, replaceUrl: true });
  }

  private canonicalQuery(value: CatalogFormValue): string {
    const params: Record<string, string> = {};
    if (value.search.trim()) params['search'] = value.search.trim();
    if (value.courseId) params['course'] = value.courseId;
    if (value.level) params['level'] = value.level;
    if (value.format) params['format'] = value.format;
    if (value.status) params['status'] = value.status;
    if (value.sortBy !== DEFAULT_SORT) params['sortBy'] = value.sortBy;
    if (value.sortDirection !== DEFAULT_DIRECTION) params['direction'] = value.sortDirection;
    return JSON.stringify(params);
  }

  private toContentFilter(value: CatalogFormValue): ContentItemFilter {
    const filter: ContentItemFilter = {
      search: value.search.trim() || undefined,
      courseId: value.courseId ? value.courseId as CourseId : undefined,
      level: value.level ? Number(value.level) : undefined,
      format: value.format ? value.format as ContentFormat : undefined,
      status: value.status ? value.status as LifecycleState : undefined,
      sortBy: value.sortBy as ContentItemFilter['sortBy'],
      sortDirection: value.sortDirection as 'asc' | 'desc'
    };
    return filter;
  }

  private contentOptions(): LearningDomainOperationOptions {
    const session = this.sessionStore.session();
    const role = session?.account.roleCode;
    const enrolledCourseIds = session?.account.scopeGrants
      .filter((grant) => grant.kind === 'course')
      .flatMap((grant) => grant.ids) ?? [];
    const access: ContentAccessContext = {
      mode: this.managementMode() ? 'management' : 'consume',
      authenticated: session !== null,
      enrolledCourseIds: enrolledCourseIds as CourseId[],
      completedOutcomeIds: [],
      roleCodes: role === undefined ? [] : [role],
      referenceTime: new Date().toISOString()
    };
    return { contentAccess: access };
  }

  private validLevel(value: string | null): string {
    return value !== null && /^\d+$/.test(value) ? value : '';
  }

  private validFormat(value: string | null): string {
    return value !== null && (CONTENT_FORMATS as readonly string[]).includes(value) ? value : '';
  }

  private validStatus(value: string | null): string {
    return value !== null && (LIFECYCLE_STATES as readonly string[]).includes(value) ? value : '';
  }

  private validSortBy(value: string | null): string {
    return value !== null && ['title', 'level', 'durationMinutes', 'format', 'status', 'updatedAt'].includes(value) ? value : DEFAULT_SORT;
  }
}
