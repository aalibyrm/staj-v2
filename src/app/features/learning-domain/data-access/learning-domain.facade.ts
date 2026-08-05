import { Injectable, Optional } from '@angular/core';
import { defer, throwError, type Observable } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

import { ApiTransportError } from '../../../core/api/api-error';
import {
  type ContentItem,
  type ContentItemCreateInput,
  type ContentItemFilter,
  type ContentItemId,
  type ContentItemUpdateInput,
  type Course,
  type CourseCreateInput,
  type CourseFilter,
  type CourseId,
  type CourseUpdateInput,
  type LearningOutcome,
  type LearningOutcomeCreateInput,
  type LearningOutcomeFilter,
  type LearningOutcomeId,
  type LearningOutcomeUpdateInput,
  type LearningPath,
  type LearningPathCreateInput,
  type LearningPathEntry,
  type LearningPathFilter,
  type LearningPathId,
  type LearningPathRecommendationInput,
  type LearningPathUpdateInput
} from '../models/learning-domain.models';
import { recommendLearningPath as buildLearningPathRecommendation } from '../models/learning-path-recommendation';
import {
  LearningDomainError,
  LearningDomainRepository,
  type LearningDomainOperationOptions
} from './learning-domain.repository';
import {
  LearningDomainStore,
  type LearningDomainRequestStatus,
  type LearningDomainResource
} from '../state/learning-domain.store';

@Injectable({ providedIn: 'root' })
export class LearningDomainFacade {
  private readonly repository: LearningDomainRepository;
  private readonly store: LearningDomainStore;
  private readonly latestRequestIds: Record<LearningDomainResource, number> = {
    courses: 0,
    outcomes: 0,
    content: 0,
    paths: 0
  };
  private requestSequence = 0;

  get state() {
    return this.store.state;
  }

  get snapshot() {
    return this.store.snapshot;
  }

  get courses() {
    return this.store.courses;
  }

  get outcomes() {
    return this.store.outcomes;
  }

  get content() {
    return this.store.content;
  }

  get paths() {
    return this.store.paths;
  }

  get filteredCourses() {
    return this.store.filteredCourses;
  }

  get filteredOutcomes() {
    return this.store.filteredOutcomes;
  }

  get filteredContent() {
    return this.store.filteredContent;
  }

  get filteredPaths() {
    return this.store.filteredPaths;
  }

  get visibleCourses() {
    return this.filteredCourses;
  }

  get visibleOutcomes() {
    return this.filteredOutcomes;
  }

  get visibleContent() {
    return this.filteredContent;
  }

  get visiblePaths() {
    return this.filteredPaths;
  }

  get requestStates() {
    return this.store.requestStates;
  }

  get requestState() {
    return this.requestStates;
  }

  get coursesRequestState() {
    return this.store.coursesRequestState;
  }

  get outcomesRequestState() {
    return this.store.outcomesRequestState;
  }

  get contentRequestState() {
    return this.store.contentRequestState;
  }

  get pathsRequestState() {
    return this.store.pathsRequestState;
  }

  constructor(
    @Optional() repository: LearningDomainRepository | null = null,
    @Optional() store: LearningDomainStore | null = null
  ) {
    this.repository = repository ?? new LearningDomainRepository();
    this.store = store ?? new LearningDomainStore();
  }

  recommendLearningPath(input: LearningPathRecommendationInput): readonly LearningPathEntry[] {
    return buildLearningPathRecommendation(input, this.store.content(), this.store.outcomes());
  }

  setCourseFilter(filter: CourseFilter): void {
    this.store.setCourseFilter(filter);
  }

  setOutcomeFilter(filter: LearningOutcomeFilter): void {
    this.store.setOutcomeFilter(filter);
  }

  setContentFilter(filter: ContentItemFilter): void {
    this.store.setContentFilter(filter);
  }

  setPathFilter(filter: LearningPathFilter): void {
    this.store.setPathFilter(filter);
  }

  loadCourses(
    filter: CourseFilter = {},
    options?: LearningDomainOperationOptions
  ): Observable<readonly Course[]> {
    return defer(() => {
      this.store.setCourseFilter(filter);
      const requestId = this.begin('courses');
      return this.repository.listCourses(filter, options).pipe(
        tap((courses) => {
          if (!this.isCurrent('courses', requestId)) {
            return;
          }
          this.store.replaceCourses(courses);
          this.store.completeRequest('courses', requestId, courses.length);
        }),
        catchError((error: unknown) => this.handleFailure<readonly Course[]>('courses', requestId, error))
      );
    });
  }

  loadOutcomes(
    filter: LearningOutcomeFilter = {},
    options?: LearningDomainOperationOptions
  ): Observable<readonly LearningOutcome[]> {
    return defer(() => {
      this.store.setOutcomeFilter(filter);
      const requestId = this.begin('outcomes');
      return this.repository.listOutcomes(filter, options).pipe(
        tap((outcomes) => {
          if (!this.isCurrent('outcomes', requestId)) {
            return;
          }
          this.store.replaceOutcomes(outcomes);
          this.store.completeRequest('outcomes', requestId, outcomes.length);
        }),
        catchError((error: unknown) => this.handleFailure<readonly LearningOutcome[]>('outcomes', requestId, error))
      );
    });
  }

  loadContent(
    filter: ContentItemFilter = {},
    options?: LearningDomainOperationOptions
  ): Observable<readonly ContentItem[]> {
    return defer(() => {
      this.store.setContentFilter(filter);
      const requestId = this.begin('content');
      return this.repository.listContent(filter, options).pipe(
        tap((content) => {
          if (!this.isCurrent('content', requestId)) {
            return;
          }
          this.store.replaceContent(content);
          this.store.completeRequest('content', requestId, content.length);
        }),
        catchError((error: unknown) => this.handleFailure<readonly ContentItem[]>('content', requestId, error))
      );
    });
  }

  loadContentItems(
    filter: ContentItemFilter = {},
    options?: LearningDomainOperationOptions
  ): Observable<readonly ContentItem[]> {
    return this.loadContent(filter, options);
  }

  loadPaths(
    filter: LearningPathFilter = {},
    options?: LearningDomainOperationOptions
  ): Observable<readonly LearningPath[]> {
    return defer(() => {
      this.store.setPathFilter(filter);
      const requestId = this.begin('paths');
      return this.repository.listPaths(filter, options).pipe(
        tap((paths) => {
          if (!this.isCurrent('paths', requestId)) {
            return;
          }
          this.store.replacePaths(paths);
          this.store.completeRequest('paths', requestId, paths.length);
        }),
        catchError((error: unknown) => this.handleFailure<readonly LearningPath[]>('paths', requestId, error))
      );
    });
  }

  loadLearningPaths(
    filter: LearningPathFilter = {},
    options?: LearningDomainOperationOptions
  ): Observable<readonly LearningPath[]> {
    return this.loadPaths(filter, options);
  }

  createCourse(input: CourseCreateInput, options?: LearningDomainOperationOptions): Observable<Course> {
    return defer(() => {
      const requestId = this.begin('courses');
      return this.repository.createCourse(input, options).pipe(
        tap((course) => {
          if (!this.isCurrent('courses', requestId)) {
            return;
          }
          this.store.upsertCourse(course);
          this.store.completeRequest('courses', requestId, 1);
        }),
        catchError((error: unknown) => this.handleFailure<Course>('courses', requestId, error))
      );
    });
  }

  updateCourse(
    id: CourseId,
    input: CourseUpdateInput,
    options?: LearningDomainOperationOptions
  ): Observable<Course> {
    return defer(() => {
      const requestId = this.begin('courses');
      return this.repository.updateCourse(id, input, options).pipe(
        tap((course) => {
          if (!this.isCurrent('courses', requestId)) {
            return;
          }
          this.store.upsertCourse(course);
          this.store.completeRequest('courses', requestId, 1);
        }),
        catchError((error: unknown) => this.handleFailure<Course>('courses', requestId, error))
      );
    });
  }

  deleteCourse(id: CourseId, options?: LearningDomainOperationOptions): Observable<void> {
    return defer(() => {
      const requestId = this.begin('courses');
      return this.repository.deleteCourse(id, options).pipe(
        tap(() => {
          if (!this.isCurrent('courses', requestId)) {
            return;
          }
          this.store.deleteCourse(id);
          this.store.completeRequest('courses', requestId, 1);
        }),
        catchError((error: unknown) => this.handleFailure<void>('courses', requestId, error))
      );
    });
  }

  createOutcome(
    input: LearningOutcomeCreateInput,
    options?: LearningDomainOperationOptions
  ): Observable<LearningOutcome> {
    return defer(() => {
      const requestId = this.begin('outcomes');
      return this.repository.createOutcome(input, options).pipe(
        tap((outcome) => {
          if (!this.isCurrent('outcomes', requestId)) {
            return;
          }
          this.store.upsertOutcome(outcome);
          this.store.completeRequest('outcomes', requestId, 1);
        }),
        catchError((error: unknown) => this.handleFailure<LearningOutcome>('outcomes', requestId, error))
      );
    });
  }

  updateOutcome(
    id: LearningOutcomeId,
    input: LearningOutcomeUpdateInput,
    options?: LearningDomainOperationOptions
  ): Observable<LearningOutcome> {
    return defer(() => {
      const requestId = this.begin('outcomes');
      return this.repository.updateOutcome(id, input, options).pipe(
        tap((outcome) => {
          if (!this.isCurrent('outcomes', requestId)) {
            return;
          }
          this.store.upsertOutcome(outcome);
          this.store.completeRequest('outcomes', requestId, 1);
        }),
        catchError((error: unknown) => this.handleFailure<LearningOutcome>('outcomes', requestId, error))
      );
    });
  }

  deleteOutcome(id: LearningOutcomeId, options?: LearningDomainOperationOptions): Observable<void> {
    return defer(() => {
      const requestId = this.begin('outcomes');
      return this.repository.deleteOutcome(id, options).pipe(
        tap(() => {
          if (!this.isCurrent('outcomes', requestId)) {
            return;
          }
          this.store.deleteOutcome(id);
          this.store.completeRequest('outcomes', requestId, 1);
        }),
        catchError((error: unknown) => this.handleFailure<void>('outcomes', requestId, error))
      );
    });
  }

  createContent(
    input: ContentItemCreateInput,
    options?: LearningDomainOperationOptions
  ): Observable<ContentItem> {
    return defer(() => {
      const requestId = this.begin('content');
      return this.repository.createContent(input, options).pipe(
        tap((content) => {
          if (!this.isCurrent('content', requestId)) {
            return;
          }
          this.store.upsertContent(content);
          this.store.completeRequest('content', requestId, 1);
        }),
        catchError((error: unknown) => this.handleFailure<ContentItem>('content', requestId, error))
      );
    });
  }

  createContentItem(
    input: ContentItemCreateInput,
    options?: LearningDomainOperationOptions
  ): Observable<ContentItem> {
    return this.createContent(input, options);
  }

  updateContent(
    id: ContentItemId,
    input: ContentItemUpdateInput,
    options?: LearningDomainOperationOptions
  ): Observable<ContentItem> {
    return defer(() => {
      const requestId = this.begin('content');
      return this.repository.updateContent(id, input, options).pipe(
        tap((content) => {
          if (!this.isCurrent('content', requestId)) {
            return;
          }
          this.store.upsertContent(content);
          this.store.completeRequest('content', requestId, 1);
        }),
        catchError((error: unknown) => this.handleFailure<ContentItem>('content', requestId, error))
      );
    });
  }

  updateContentItem(
    id: ContentItemId,
    input: ContentItemUpdateInput,
    options?: LearningDomainOperationOptions
  ): Observable<ContentItem> {
    return this.updateContent(id, input, options);
  }

  deleteContent(id: ContentItemId, options?: LearningDomainOperationOptions): Observable<void> {
    return defer(() => {
      const requestId = this.begin('content');
      return this.repository.deleteContent(id, options).pipe(
        tap(() => {
          if (!this.isCurrent('content', requestId)) {
            return;
          }
          this.store.deleteContent(id);
          this.store.completeRequest('content', requestId, 1);
        }),
        catchError((error: unknown) => this.handleFailure<void>('content', requestId, error))
      );
    });
  }

  deleteContentItem(id: ContentItemId, options?: LearningDomainOperationOptions): Observable<void> {
    return this.deleteContent(id, options);
  }

  createPath(input: LearningPathCreateInput, options?: LearningDomainOperationOptions): Observable<LearningPath> {
    return defer(() => {
      const requestId = this.begin('paths');
      return this.repository.createPath(input, options).pipe(
        tap((path) => {
          if (!this.isCurrent('paths', requestId)) {
            return;
          }
          this.store.upsertPath(path);
          this.store.completeRequest('paths', requestId, 1);
        }),
        catchError((error: unknown) => this.handleFailure<LearningPath>('paths', requestId, error))
      );
    });
  }

  createLearningPath(input: LearningPathCreateInput, options?: LearningDomainOperationOptions): Observable<LearningPath> {
    return this.createPath(input, options);
  }

  updatePath(
    id: LearningPathId,
    input: LearningPathUpdateInput,
    options?: LearningDomainOperationOptions
  ): Observable<LearningPath> {
    return defer(() => {
      const requestId = this.begin('paths');
      return this.repository.updatePath(id, input, options).pipe(
        tap((path) => {
          if (!this.isCurrent('paths', requestId)) {
            return;
          }
          this.store.upsertPath(path);
          this.store.completeRequest('paths', requestId, 1);
        }),
        catchError((error: unknown) => this.handleFailure<LearningPath>('paths', requestId, error))
      );
    });
  }

  updateLearningPath(
    id: LearningPathId,
    input: LearningPathUpdateInput,
    options?: LearningDomainOperationOptions
  ): Observable<LearningPath> {
    return this.updatePath(id, input, options);
  }

  deletePath(id: LearningPathId, options?: LearningDomainOperationOptions): Observable<void> {
    return defer(() => {
      const requestId = this.begin('paths');
      return this.repository.deletePath(id, options).pipe(
        tap(() => {
          if (!this.isCurrent('paths', requestId)) {
            return;
          }
          this.store.deletePath(id);
          this.store.completeRequest('paths', requestId, 1);
        }),
        catchError((error: unknown) => this.handleFailure<void>('paths', requestId, error))
      );
    });
  }

  deleteLearningPath(id: LearningPathId, options?: LearningDomainOperationOptions): Observable<void> {
    return this.deletePath(id, options);
  }

  private begin(resource: LearningDomainResource): number {
    this.requestSequence += 1;
    this.latestRequestIds[resource] = this.requestSequence;
    this.store.beginRequest(resource, this.requestSequence);
    return this.requestSequence;
  }

  private isCurrent(resource: LearningDomainResource, requestId: number): boolean {
    return this.latestRequestIds[resource] === requestId;
  }

  private handleFailure<T>(
    resource: LearningDomainResource,
    requestId: number,
    error: unknown
  ): Observable<T> {
    if (this.isCurrent(resource, requestId)) {
      const status = this.statusForError(error);
      const errorCode = error instanceof LearningDomainError ? error.code : undefined;
      this.store.failRequest(resource, requestId, error, status, errorCode);
    }
    return throwError(() => error);
  }

  private statusForError(error: unknown): Exclude<LearningDomainRequestStatus, 'idle' | 'loading' | 'success' | 'empty'> {
    if (error instanceof ApiTransportError) {
      if (error.kind === 'unauthorized') {
        return 'unauthorized';
      }
      if (error.kind === 'conflict') {
        return 'conflict';
      }
      return 'error';
    }
    if (error instanceof LearningDomainError) {
      if (error.code === 'unauthorized') {
        return 'unauthorized';
      }
      if (error.code === 'conflict') {
        return 'conflict';
      }
    }
    return 'error';
  }
}
