import { Injectable, Optional } from '@angular/core';
import { defer, map, type Observable } from 'rxjs';

import {
  DEFAULT_MOCK_SCENARIO,
  MockTransport,
  type MockHttpMethod,
  type MockScenarioControls
} from '../../../core/api/mock-transport';
import { findOutcomePrerequisiteCycle } from '../models/outcome-cycle';

import {
  cloneContentItem,
  cloneCourse,
  cloneLearningOutcome,
  cloneLearningPath,
  cloneLearningPathEntry,
  CONTENT_FORMATS,
  LEARNING_PATH_REASON_CODES,
  LIFECYCLE_STATES,
  type ContentAccessConditions,
  type ContentFormat,
  type ContentItem,
  type ContentItemCreateInput,
  type ContentItemUpdateInput,
  type ContentItemFilter,
  type ContentItemId,
  type ContentItemStatus,
  type Course,
  type CourseCreateInput,
  type CourseFilter,
  type CourseId,
  type CourseStatus,
  type CourseUpdateInput,
  type LearningOutcome,
  type LearningOutcomeCreateInput,
  type LearningOutcomeFilter,
  type LearningOutcomeId,
  type LearningOutcomeStatus,
  type LearningOutcomeUpdateInput,
  type LearningPath,
  type LearningPathCreateInput,
  type LearningPathEntry,
  type LearningPathEntryId,
  type LearningPathEntryInput,
  type LearningPathFilter,
  type LearningPathId,
  type LearningPathReason,
  type LearningPathReasonCode,
  type LearningPathStatus,
  type LearningPathUpdateInput,
  type LifecycleState
} from '../models/learning-domain.models';

export type LearningDomainEntityName = 'course' | 'outcome' | 'content' | 'path';

export type LearningDomainErrorCode =
  | 'not-found'
  | 'invalid-reference'
  | 'validation'
  | 'conflict'
  | 'unauthorized';

export class LearningDomainError extends Error {
  override readonly name = 'LearningDomainError';

  constructor(
    readonly code: LearningDomainErrorCode,
    message: string,
    readonly entity?: LearningDomainEntityName,
    readonly id?: string,
    readonly referenceEntity?: LearningDomainEntityName,
    readonly referenceId?: string
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type ContentAccessMode = 'consume' | 'management';

export interface ContentAccessContext {
  readonly mode: ContentAccessMode;
  readonly authenticated: boolean;
  readonly enrolledCourseIds: readonly CourseId[];
  readonly completedOutcomeIds: readonly LearningOutcomeId[];
  readonly roleCodes: readonly string[];
  readonly referenceTime: string;
}

export interface LearningDomainOperationOptions extends Partial<MockScenarioControls> {
  readonly expectedVersion?: number;
  readonly contentAccess?: ContentAccessContext;
}

export type LearningDomainRequestOptions = LearningDomainOperationOptions;

export interface LearningDomainRepositorySnapshot {
  readonly courses: readonly Course[];
  readonly outcomes: readonly LearningOutcome[];
  readonly content: readonly ContentItem[];
  readonly paths: readonly LearningPath[];
}

const asCourseId = (value: string): CourseId => value as CourseId;
const asLearningOutcomeId = (value: string): LearningOutcomeId => value as LearningOutcomeId;
const asContentItemId = (value: string): ContentItemId => value as ContentItemId;
const asLearningPathId = (value: string): LearningPathId => value as LearningPathId;
const asLearningPathEntryId = (value: string): LearningPathEntryId => value as LearningPathEntryId;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isLifecycleState = (value: unknown): value is LifecycleState =>
  typeof value === 'string' && (LIFECYCLE_STATES as readonly string[]).includes(value);

const isContentFormat = (value: unknown): value is ContentFormat =>
  typeof value === 'string' && (CONTENT_FORMATS as readonly string[]).includes(value);

const isLearningPathReasonCode = (value: unknown): value is LearningPathReasonCode =>
  typeof value === 'string' && (LEARNING_PATH_REASON_CODES as readonly string[]).includes(value);

const assertRecord: (value: unknown, label: string) => asserts value is Record<string, unknown> = (value, label) => {
  if (!isRecord(value)) {
    throw new LearningDomainError('validation', `${label} must be an object.`);
  }
};

const assertNonEmptyString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new LearningDomainError('validation', `${label} must not be empty.`);
  }
  return value.trim();
};

const assertString = (value: unknown, label: string): string => {
  if (typeof value !== 'string') {
    throw new LearningDomainError('validation', `${label} must be a string.`);
  }
  return value;
};

const assertInteger = (value: unknown, label: string, minimum = 0): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    throw new LearningDomainError('validation', `${label} must be an integer >= ${minimum}.`);
  }
  return value;
};

const assertBoolean = (value: unknown, label: string): boolean => {
  if (typeof value !== 'boolean') {
    throw new LearningDomainError('validation', `${label} must be a boolean.`);
  }
  return value;
};

const assertLifecycleState = (value: unknown, label: string): LifecycleState => {
  if (!isLifecycleState(value)) {
    throw new LearningDomainError('validation', `${label} has an unsupported lifecycle state.`);
  }
  return value;
};

const assertContentFormat = (value: unknown, label: string): ContentFormat => {
  if (!isContentFormat(value)) {
    throw new LearningDomainError('validation', `${label} has an unsupported content format.`);
  }
  return value;
};

const assertLearningPathReason = (value: unknown, label: string): LearningPathReason => {
  assertRecord(value, label);
  const code = value['code'];
  if (!isLearningPathReasonCode(code)) {
    throw new LearningDomainError('validation', `${label} code is unsupported.`);
  }
  const summary = assertString(value['summary'], `${label} summary`);
  const detail = assertString(value['detail'], `${label} detail`);
  const factorsValue = value['factors'];
  assertRecord(factorsValue, `${label} factors`);
  const factors: Record<string, string | number | boolean> = {};
  for (const [factorKey, factorValue] of Object.entries(factorsValue)) {
    if (
      typeof factorValue !== 'string' &&
      typeof factorValue !== 'number' &&
      typeof factorValue !== 'boolean'
    ) {
      throw new LearningDomainError('validation', `${label} factors must contain only primitive values.`);
    }
    factors[factorKey] = factorValue;
  }
  return { code, summary, detail, factors };
};

const immutableArray = <T>(values: readonly T[]): readonly T[] => Object.freeze([...values]);

const cloneAccess = (value: ContentAccessConditions | undefined): ContentAccessConditions => {
  const source = value ?? {};
  return Object.freeze({
    visibility: source.visibility ?? 'enrolled',
    requiresEnrollment: source.requiresEnrollment ?? true,
    requiredOutcomeIds:
      source.requiredOutcomeIds === undefined ? immutableArray([]) : immutableArray(source.requiredOutcomeIds),
    requiredRoleCodes:
      source.requiredRoleCodes === undefined ? immutableArray([]) : immutableArray(source.requiredRoleCodes),
    availableFrom: source.availableFrom,
    availableUntil: source.availableUntil
  });
};
const isIsoDate = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value));

type NormalizedContentAccessContext = Readonly<{
  readonly mode: ContentAccessMode;
  readonly authenticated?: boolean;
  readonly enrolledCourseIds?: readonly string[];
  readonly completedOutcomeIds?: readonly string[];
  readonly roleCodes?: readonly string[];
  readonly referenceTime?: string;
}> | null | undefined;

const normalizeContentAccessContext = (
  context: ContentAccessContext | undefined
): NormalizedContentAccessContext => {
  if (context === undefined) {
    return undefined;
  }
  if (!isRecord(context) || (context.mode !== 'consume' && context.mode !== 'management')) {
    return null;
  }
  if (context.mode === 'management') {
    return Object.freeze({ mode: 'management' });
  }
  if (
    typeof context.authenticated !== 'boolean' ||
    !Array.isArray(context.enrolledCourseIds) ||
    !Array.isArray(context.completedOutcomeIds) ||
    !Array.isArray(context.roleCodes) ||
    !context.enrolledCourseIds.every((value) => typeof value === 'string') ||
    !context.completedOutcomeIds.every((value) => typeof value === 'string') ||
    !context.roleCodes.every((value) => typeof value === 'string') ||
    !isIsoDate(context.referenceTime)
  ) {
    return null;
  }
  return Object.freeze({
    mode: 'consume',
    authenticated: context.authenticated,
    enrolledCourseIds: immutableArray(context.enrolledCourseIds),
    completedOutcomeIds: immutableArray(context.completedOutcomeIds),
    roleCodes: immutableArray(context.roleCodes),
    referenceTime: context.referenceTime
  });
};

const isContentAccessible = (
  content: ContentItem,
  context: NormalizedContentAccessContext
): boolean => {
  if (context === undefined || context?.mode === 'management') {
    return true;
  }
  if (
    context === null ||
    context.mode !== 'consume' ||
    context.authenticated !== true ||
    context.enrolledCourseIds === undefined ||
    context.completedOutcomeIds === undefined ||
    context.roleCodes === undefined ||
    context.referenceTime === undefined
  ) {
    return false;
  }

  const conditions = content.accessConditions;
  const enrolled = context.enrolledCourseIds.includes(content.courseId);
  const requiresEnrollment =
    conditions.visibility === 'enrolled' || conditions.requiresEnrollment === true;
  if (requiresEnrollment && !enrolled) {
    return false;
  }
  if (
    conditions.visibility === 'restricted' &&
    (conditions.requiredRoleCodes?.length ?? 0) > 0 &&
    !conditions.requiredRoleCodes?.some((roleCode) => context.roleCodes?.includes(roleCode))
  ) {
    return false;
  }
  const completedOutcomes = new Set(context.completedOutcomeIds);
  if (!(conditions.requiredOutcomeIds ?? []).every((outcomeId) => completedOutcomes.has(outcomeId))) {
    return false;
  }
  const referenceTimestamp = Date.parse(context.referenceTime);
  if (conditions.availableFrom !== undefined) {
    if (!isIsoDate(conditions.availableFrom) || referenceTimestamp < Date.parse(conditions.availableFrom)) {
      return false;
    }
  }
  if (conditions.availableUntil !== undefined) {
    if (!isIsoDate(conditions.availableUntil) || referenceTimestamp > Date.parse(conditions.availableUntil)) {
      return false;
    }
  }
  return conditions.visibility === 'public'
    ? conditions.requiresEnrollment !== true || enrolled
    : true;
};

const cloneReason = (value: LearningPathReason | undefined): LearningPathReason | undefined =>
  value === undefined
    ? undefined
    : Object.freeze({
        ...value,
        factors: Object.freeze({ ...value.factors })
      });

const now = (): string => new Date().toISOString();

const idSort = (left: { readonly id: string }, right: { readonly id: string }): number =>
  left.id < right.id ? -1 : left.id > right.id ? 1 : 0;

const compareValues = (left: string | number, right: string | number): number =>
  left < right ? -1 : left > right ? 1 : 0;

const sortDirection = (value: 'asc' | 'desc' | undefined): 1 | -1 => (value === 'desc' ? -1 : 1);

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

const seedCourse = (
  id: CourseId,
  code: string,
  title: string,
  description: string,
  status: CourseStatus,
  learningOutcomeIds: readonly LearningOutcomeId[]
): Course =>
  cloneCourse({
    id,
    code,
    title,
    description,
    termId: 'term-2025-spring',
    instructorIds: Object.freeze(['instructor-program-team']),
    learningOutcomeIds,
    status,
    createdAt: '2025-01-10T09:00:00.000Z',
    updatedAt: '2025-01-10T09:00:00.000Z',
    version: 1
  });

const seedOutcome = (
  id: LearningOutcomeId,
  courseId: CourseId,
  code: string,
  title: string,
  description: string,
  level: number,
  status: LearningOutcomeStatus,
  prerequisiteOutcomeIds: readonly LearningOutcomeId[]
): LearningOutcome =>
  cloneLearningOutcome({
    id,
    courseId,
    code,
    title,
    description,
    level,
    status,
    prerequisiteOutcomeIds,
    createdAt: '2025-01-10T09:00:00.000Z',
    updatedAt: '2025-01-10T09:00:00.000Z',
    version: 1
  });

const seedContent = (
  id: ContentItemId,
  courseId: CourseId,
  title: string,
  description: string,
  learningOutcomeIds: readonly LearningOutcomeId[],
  level: number,
  durationMinutes: number,
  format: ContentFormat,
  status: ContentItemStatus,
  accessConditions: ContentAccessConditions
): ContentItem =>
  cloneContentItem({
    id,
    courseId,
    title,
    description,
    learningOutcomeIds,
    level,
    durationMinutes,
    format,
    status,
    accessConditions,
    createdAt: '2025-01-10T09:00:00.000Z',
    updatedAt: '2025-01-10T09:00:00.000Z',
    version: 1
  });

const seedEntry = (
  id: LearningPathEntryId,
  order: number,
  contentItemId: ContentItemId,
  reason: string,
  isCompleted = false,
  isLocked = false
): LearningPathEntry =>
  cloneLearningPathEntry({
    id,
    order,
    contentItemId,
    reason,
    isCompleted,
    isLocked
  });

const createSeedData = (): LearningDomainRepositorySnapshot => {
  const foundationsId = asCourseId('course-foundations');
  const applicationId = asCourseId('course-application');
  const assessmentId = asCourseId('course-assessment');

  const foundationsModelId = asLearningOutcomeId('outcome-foundations-models');
  const foundationsAnalysisId = asLearningOutcomeId('outcome-foundations-analysis');
  const applicationDesignId = asLearningOutcomeId('outcome-application-design');
  const applicationBuildId = asLearningOutcomeId('outcome-application-build');
  const assessmentEvidenceId = asLearningOutcomeId('outcome-assessment-evidence');

  const foundationsContentId = asContentItemId('content-foundations-models');
  const foundationsPracticeId = asContentItemId('content-foundations-practice');
  const applicationContentId = asContentItemId('content-application-design');
  const applicationBuildContentId = asContentItemId('content-application-build');
  const assessmentContentId = asContentItemId('content-assessment-evidence');

  const courses = [
    seedCourse(
      foundationsId,
      'LD-101',
      'Learning Design Foundations',
      'Core concepts for modeling outcomes and planning learning experiences.',
      'published',
      [foundationsModelId, foundationsAnalysisId]
    ),
    seedCourse(
      applicationId,
      'LD-201',
      'Applied Learning Design',
      'Apply outcome evidence to structured learning activities.',
      'published',
      [applicationDesignId, applicationBuildId]
    ),
    seedCourse(
      assessmentId,
      'LD-301',
      'Assessment Evidence',
      'Interpret evidence and align assessment decisions to outcomes.',
      'draft',
      [assessmentEvidenceId]
    )
  ];

  const outcomes = [
    seedOutcome(
      foundationsModelId,
      foundationsId,
      'OUT-101',
      'Describe learning models',
      'Describe the purpose and boundaries of common learning models.',
      1,
      'published',
      []
    ),
    seedOutcome(
      foundationsAnalysisId,
      foundationsId,
      'OUT-102',
      'Analyze outcome alignment',
      'Analyze alignment between outcomes, activities, and evidence.',
      2,
      'published',
      [foundationsModelId]
    ),
    seedOutcome(
      applicationDesignId,
      applicationId,
      'OUT-201',
      'Design an outcome sequence',
      'Design a coherent sequence from prerequisite outcomes to practice.',
      2,
      'published',
      []
    ),
    seedOutcome(
      applicationBuildId,
      applicationId,
      'OUT-202',
      'Build a learning activity',
      'Build an activity that gives learners observable outcome evidence.',
      3,
      'draft',
      [applicationDesignId]
    ),
    seedOutcome(
      assessmentEvidenceId,
      assessmentId,
      'OUT-301',
      'Interpret assessment evidence',
      'Interpret assessment evidence while documenting decision rationale.',
      3,
      'draft',
      []
    )
  ];

  const content = [
    seedContent(
      foundationsContentId,
      foundationsId,
      'Outcome modeling primer',
      'A concise reading on writing measurable outcomes.',
      [foundationsModelId],
      1,
      18,
      'article',
      'published',
      { visibility: 'public', requiresEnrollment: false }
    ),
    seedContent(
      foundationsPracticeId,
      foundationsId,
      'Alignment practice lab',
      'An interactive activity for checking outcome alignment.',
      [foundationsAnalysisId],
      2,
      32,
      'interactive',
      'published',
      { visibility: 'enrolled', requiresEnrollment: true, requiredOutcomeIds: [foundationsModelId] }
    ),
    seedContent(
      applicationContentId,
      applicationId,
      'Sequence design walkthrough',
      'A guided walkthrough for sequencing outcome practice.',
      [applicationDesignId],
      2,
      24,
      'video',
      'published',
      { visibility: 'enrolled', requiresEnrollment: true }
    ),
    seedContent(
      applicationBuildContentId,
      applicationId,
      'Activity build worksheet',
      'A document template for building outcome evidence.',
      [applicationBuildId],
      3,
      28,
      'document',
      'draft',
      { visibility: 'restricted', requiresEnrollment: true, requiredOutcomeIds: [applicationDesignId] }
    ),
    seedContent(
      assessmentContentId,
      assessmentId,
      'Evidence interpretation clinic',
      'An exercise for interpreting assessment evidence.',
      [assessmentEvidenceId],
      3,
      35,
      'exercise',
      'draft',
      { visibility: 'enrolled', requiresEnrollment: true }
    )
  ];

  const paths = [
    cloneLearningPath({
      id: asLearningPathId('path-foundations-core'),
      courseId: foundationsId,
      title: 'Foundations core path',
      description: 'A sequenced route through the foundations outcomes.',
      status: 'published',
      reason: 'Start with the prerequisite model, then practice alignment.',
      entries: [
        seedEntry('path-foundations-core-entry-1' as LearningPathEntryId, 1, foundationsContentId, 'Builds the prerequisite model.'),
        seedEntry('path-foundations-core-entry-2' as LearningPathEntryId, 2, foundationsPracticeId, 'Applies the newly introduced model.')
      ],
      createdAt: '2025-01-10T09:00:00.000Z',
      updatedAt: '2025-01-10T09:00:00.000Z',
      version: 1
    }),
    cloneLearningPath({
      id: asLearningPathId('path-application-core'),
      courseId: applicationId,
      title: 'Applied design path',
      description: 'A sequenced route from design into activity construction.',
      status: 'draft',
      reason: 'Complete sequence design before building the activity.',
      entries: [
        seedEntry('path-application-core-entry-1' as LearningPathEntryId, 1, applicationContentId, 'Introduces sequence design.'),
        seedEntry(
          'path-application-core-entry-2' as LearningPathEntryId,
          2,
          applicationBuildContentId,
          'Depends on the sequence design outcome.',
          false,
          true
        )
      ],
      createdAt: '2025-01-10T09:00:00.000Z',
      updatedAt: '2025-01-10T09:00:00.000Z',
      version: 1
    })
  ];

  return Object.freeze({
    courses: Object.freeze(courses),
    outcomes: Object.freeze(outcomes),
    content: Object.freeze(content),
    paths: Object.freeze(paths)
  });
};

@Injectable({ providedIn: 'root' })
export class LearningDomainRepository {
  private readonly transport: MockTransport;
  private readonly courseEntities = new Map<CourseId, Course>();
  private readonly outcomeEntities = new Map<LearningOutcomeId, LearningOutcome>();
  private readonly contentEntities = new Map<ContentItemId, ContentItem>();
  private readonly pathEntities = new Map<LearningPathId, LearningPath>();
  private scenarioControls: MockScenarioControls = { ...DEFAULT_MOCK_SCENARIO };
  private sequence = 1;

  constructor(@Optional() transport: MockTransport | null = null) {
    this.transport = transport ?? new MockTransport();
    const seed = createSeedData();
    for (const course of seed.courses) {
      this.courseEntities.set(course.id, cloneCourse(course));
    }
    for (const outcome of seed.outcomes) {
      this.outcomeEntities.set(outcome.id, cloneLearningOutcome(outcome));
    }
    for (const content of seed.content) {
      this.contentEntities.set(content.id, cloneContentItem(content));
    }
    for (const path of seed.paths) {
      this.pathEntities.set(path.id, cloneLearningPath(path));
    }
  }

  setMockScenario(controls: Partial<MockScenarioControls>): void {
    if (!isRecord(controls)) {
      throw new TypeError('Mock scenario controls must be an object.');
    }
    this.scenarioControls = Object.freeze({ ...this.scenarioControls, ...controls });
  }

  setMockControls(controls: Partial<MockScenarioControls>): void {
    this.setMockScenario(controls);
  }

  resetMockScenario(): void {
    this.scenarioControls = { ...DEFAULT_MOCK_SCENARIO };
  }

  getMockScenario(): Readonly<MockScenarioControls> {
    return Object.freeze({ ...this.scenarioControls });
  }

  getSnapshot(): LearningDomainRepositorySnapshot {
    return Object.freeze({
      courses: Object.freeze([...this.courseEntities.values()].sort(idSort).map(cloneCourse)),
      outcomes: Object.freeze([...this.outcomeEntities.values()].sort(idSort).map(cloneLearningOutcome)),
      content: Object.freeze([...this.contentEntities.values()].sort(idSort).map(cloneContentItem)),
      paths: Object.freeze([...this.pathEntities.values()].sort(idSort).map(cloneLearningPath))
    });
  }

  listCourses(filter: CourseFilter = {}, options?: LearningDomainOperationOptions): Observable<readonly Course[]> {
    return defer(() => {
      const normalized = this.normalizeCourseFilter(filter);
      return this.execute('GET', '/learning-domain/courses', normalized, () => {
        const results = [...this.courseEntities.values()]
          .filter((course) => this.matchesCourse(course, normalized))
          .sort((left, right) => this.compareCourse(left, right, normalized))
          .map(cloneCourse);
        return Object.freeze(results);
      }, options);
    });
  }

  getCourse(id: CourseId, options?: LearningDomainOperationOptions): Observable<Course> {
    return defer(() =>
      this.execute('GET', `/learning-domain/courses/${id}`, undefined, () => {
        const course = this.courseEntities.get(id);
        if (course === undefined) {
          throw this.notFound('course', id);
        }
        return cloneCourse(course);
      }, options)
    );
  }

  createCourse(input: CourseCreateInput, options?: LearningDomainOperationOptions): Observable<Course> {
    return defer(() => {
      assertRecord(input, 'Course input');
      const id = input.id ?? asCourseId(this.nextId('course'));
      const normalized = this.normalizeCourseCreate(input, id);
      this.validateCourseOutcomeReferences(id, normalized.learningOutcomeIds);
      return this.execute('POST', '/learning-domain/courses', input, () => {
        if (this.courseEntities.has(id)) {
          throw this.conflict('course', id, 'A course with this ID already exists.');
        }
        this.courseEntities.set(id, normalized);
        return cloneCourse(normalized);
      }, options);
    });
  }

  updateCourse(
    id: CourseId,
    input: CourseUpdateInput,
    options?: LearningDomainOperationOptions
  ): Observable<Course> {
    return defer(() =>
      this.execute('PATCH', `/learning-domain/courses/${id}`, input, () => {
        const current = this.courseEntities.get(id);
        if (current === undefined) {
          throw this.notFound('course', id);
        }
        this.assertExpectedVersion('course', current.version, options);
        const patch = input ?? {};
        const learningOutcomeIds = patch.learningOutcomeIds ?? current.learningOutcomeIds;
        this.validateCourseOutcomeReferences(id, learningOutcomeIds);
        const next = cloneCourse({
          ...current,
          ...patch,
          code: patch.code ?? current.code,
          title: patch.title ?? current.title,
          description: patch.description ?? current.description,
          termId: patch.termId ?? current.termId,
          instructorIds: patch.instructorIds ?? current.instructorIds,
          learningOutcomeIds,
          status: patch.status ?? current.status,
          updatedAt: now(),
          version: current.version + 1
        });
        this.courseEntities.set(id, next);
        return cloneCourse(next);
      }, options)
    );
  }

  deleteCourse(id: CourseId, options?: LearningDomainOperationOptions): Observable<void> {
    return defer(() =>
      this.execute('DELETE', `/learning-domain/courses/${id}`, undefined, () => {
        const current = this.courseEntities.get(id);
        if (current === undefined) {
          throw this.notFound('course', id);
        }
        if ([...this.outcomeEntities.values()].some((outcome) => outcome.courseId === id)) {
          throw this.invalidReference('course', id, 'outcome', undefined, 'Delete outcomes before deleting their course.');
        }
        if ([...this.contentEntities.values()].some((content) => content.courseId === id)) {
          throw this.invalidReference('course', id, 'content', undefined, 'Delete content before deleting its course.');
        }
        if ([...this.pathEntities.values()].some((path) => path.courseId === id)) {
          throw this.invalidReference('course', id, 'path', undefined, 'Delete paths before deleting their course.');
        }
        this.courseEntities.delete(id);
        return undefined;
      }, options)
    );
  }

  listOutcomes(
    filter: LearningOutcomeFilter = {},
    options?: LearningDomainOperationOptions
  ): Observable<readonly LearningOutcome[]> {
    return defer(() => {
      const normalized = this.normalizeOutcomeFilter(filter);
      return this.execute('GET', '/learning-domain/outcomes', normalized, () => {
        const results = [...this.outcomeEntities.values()]
          .filter((outcome) => this.matchesOutcome(outcome, normalized))
          .sort((left, right) => this.compareOutcome(left, right, normalized))
          .map(cloneLearningOutcome);
        return Object.freeze(results);
      }, options);
    });
  }
  listLearningOutcomes(
    filter: LearningOutcomeFilter = {},
    options?: LearningDomainOperationOptions
  ): Observable<readonly LearningOutcome[]> {
    return this.listOutcomes(filter, options);
  }

  getOutcome(id: LearningOutcomeId, options?: LearningDomainOperationOptions): Observable<LearningOutcome> {
    return defer(() =>
      this.execute('GET', `/learning-domain/outcomes/${id}`, undefined, () => {
        const outcome = this.outcomeEntities.get(id);
        if (outcome === undefined) {
          throw this.notFound('outcome', id);
        }
        return cloneLearningOutcome(outcome);
      }, options)
    );
  }
  getLearningOutcome(
    id: LearningOutcomeId,
    options?: LearningDomainOperationOptions
  ): Observable<LearningOutcome> {
    return this.getOutcome(id, options);
  }

  createOutcome(
    input: LearningOutcomeCreateInput,
    options?: LearningDomainOperationOptions
  ): Observable<LearningOutcome> {
    return defer(() => {
      assertRecord(input, 'Learning outcome input');
      const id = input.id ?? asLearningOutcomeId(this.nextId('outcome'));
      const normalized = this.normalizeOutcomeCreate(input, id);
      this.assertCourseExists(normalized.courseId, 'outcome', id);
      this.validateOutcomePrerequisites(normalized.courseId, normalized.prerequisiteOutcomeIds);
      return this.execute('POST', '/learning-domain/outcomes', input, () => {
        if (this.outcomeEntities.has(id)) {
          throw this.conflict('outcome', id, 'A learning outcome with this ID already exists.');
        }
        this.assertOutcomePrerequisiteGraphIsAcyclic(normalized);
        this.outcomeEntities.set(id, normalized);
        const course = this.courseEntities.get(normalized.courseId);
        if (course !== undefined && !course.learningOutcomeIds.includes(id)) {
          this.courseEntities.set(
            course.id,
            cloneCourse({
              ...course,
              learningOutcomeIds: [...course.learningOutcomeIds, id],
              updatedAt: now(),
              version: course.version + 1
            })
          );
        }
        return cloneLearningOutcome(normalized);
      }, options);
    });
  }

  updateOutcome(
    id: LearningOutcomeId,
    input: LearningOutcomeUpdateInput,
    options?: LearningDomainOperationOptions
  ): Observable<LearningOutcome> {
    return defer(() =>
      this.execute('PATCH', `/learning-domain/outcomes/${id}`, input, () => {
        const current = this.outcomeEntities.get(id);
        if (current === undefined) {
          throw this.notFound('outcome', id);
        }
        this.assertExpectedVersion('outcome', current.version, options);
        const patch = input ?? {};
        const courseId = patch.courseId ?? current.courseId;
        const prerequisiteOutcomeIds = patch.prerequisiteOutcomeIds ?? current.prerequisiteOutcomeIds;
        this.assertCourseExists(courseId, 'outcome', id);
        this.validateOutcomePrerequisites(courseId, prerequisiteOutcomeIds);
        if (courseId !== current.courseId) {
          if ([...this.contentEntities.values()].some((content) => content.learningOutcomeIds.includes(id))) {
            throw this.invalidReference(
              'outcome',
              id,
              'content',
              undefined,
              'An outcome referenced by content cannot change course.'
            );
          }
        }
        const next = cloneLearningOutcome({
          ...current,
          ...patch,
          courseId,
          code: patch.code ?? current.code,
          title: patch.title ?? current.title,
          description: patch.description ?? current.description,
          level: patch.level ?? current.level,
          status: patch.status ?? current.status,
          prerequisiteOutcomeIds,
          updatedAt: now(),
          version: current.version + 1
        });
        this.assertOutcomePrerequisiteGraphIsAcyclic(next);
        this.outcomeEntities.set(id, next);
        if (courseId !== current.courseId) {
          this.moveOutcomeBetweenCourses(id, current.courseId, courseId);
        }
        return cloneLearningOutcome(next);
      }, options)
    );
  }

  deleteOutcome(id: LearningOutcomeId, options?: LearningDomainOperationOptions): Observable<void> {
    return defer(() =>
      this.execute('DELETE', `/learning-domain/outcomes/${id}`, undefined, () => {
        const current = this.outcomeEntities.get(id);
        if (current === undefined) {
          throw this.notFound('outcome', id);
        }
        const dependentOutcome = [...this.outcomeEntities.values()].find((outcome) =>
          outcome.id !== id && outcome.prerequisiteOutcomeIds.includes(id)
        );
        if (dependentOutcome !== undefined) {
          throw this.invalidReference(
            'outcome',
            id,
            'outcome',
            dependentOutcome.id,
            'Another outcome still lists this outcome as a prerequisite.'
          );
        }
        const dependentContent = [...this.contentEntities.values()].find((content) =>
          content.learningOutcomeIds.includes(id)
        );
        if (dependentContent !== undefined) {
          throw this.invalidReference(
            'outcome',
            id,
            'content',
            dependentContent.id,
            'Content still references this outcome.'
          );
        }
        this.outcomeEntities.delete(id);
        const course = this.courseEntities.get(current.courseId);
        if (course !== undefined) {
          this.courseEntities.set(
            course.id,
            cloneCourse({
              ...course,
              learningOutcomeIds: course.learningOutcomeIds.filter((outcomeId) => outcomeId !== id),
              updatedAt: now(),
              version: course.version + 1
            })
          );
        }
        return undefined;
      }, options)
    );
  }

  listContent(
    filter: ContentItemFilter = {},
    options?: LearningDomainOperationOptions
  ): Observable<readonly ContentItem[]> {
    return defer(() => {
      const normalized = this.normalizeContentFilter(filter);
      const accessContext = normalizeContentAccessContext(options?.contentAccess);
      return this.execute('GET', '/learning-domain/content', normalized, () => {
        const results = [...this.contentEntities.values()]
          .filter((content) => this.matchesContent(content, normalized))
          .filter((content) => isContentAccessible(content, accessContext))
          .sort((left, right) => this.compareContent(left, right, normalized))
          .map(cloneContentItem);
        return Object.freeze(results);
      }, options);
    });
  }

  listContentItems(
    filter: ContentItemFilter = {},
    options?: LearningDomainOperationOptions
  ): Observable<readonly ContentItem[]> {
    return this.listContent(filter, options);
  }

  getContent(id: ContentItemId, options?: LearningDomainOperationOptions): Observable<ContentItem> {
    return defer(() =>
      this.execute('GET', `/learning-domain/content/${id}`, undefined, () => {
        const content = this.contentEntities.get(id);
        if (content === undefined) {
          throw this.notFound('content', id);
        }
        return cloneContentItem(content);
      }, options)
    );
  }

  getContentItem(id: ContentItemId, options?: LearningDomainOperationOptions): Observable<ContentItem> {
    return this.getContent(id, options);
  }

  createContent(
    input: ContentItemCreateInput,
    options?: LearningDomainOperationOptions
  ): Observable<ContentItem> {
    return defer(() => {
      assertRecord(input, 'Content item input');
      const id = input.id ?? asContentItemId(this.nextId('content'));
      const normalized = this.normalizeContentCreate(input, id);
      this.assertCourseExists(normalized.courseId, 'content', id);
      this.validateContentOutcomeReferences(normalized.courseId, normalized.learningOutcomeIds);
      return this.execute('POST', '/learning-domain/content', input, () => {
        if (this.contentEntities.has(id)) {
          throw this.conflict('content', id, 'A content item with this ID already exists.');
        }
        this.contentEntities.set(id, normalized);
        return cloneContentItem(normalized);
      }, options);
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
    return defer(() =>
      this.execute('PATCH', `/learning-domain/content/${id}`, input, () => {
        const current = this.contentEntities.get(id);
        if (current === undefined) {
          throw this.notFound('content', id);
        }
        this.assertExpectedVersion('content', current.version, options);
        const patch = input ?? {};
        const courseId = patch.courseId ?? current.courseId;
        const learningOutcomeIds =
          patch.learningOutcomeIds ?? patch.outcomeIds ?? current.learningOutcomeIds;
        this.assertCourseExists(courseId, 'content', id);
        this.validateContentOutcomeReferences(courseId, learningOutcomeIds);
        const next = cloneContentItem({
          ...current,
          ...patch,
          courseId,
          title: patch.title ?? current.title,
          description: patch.description ?? current.description,
          learningOutcomeIds,
          level: patch.level ?? current.level,
          durationMinutes: patch.durationMinutes ?? current.durationMinutes,
          format: patch.format ?? current.format,
          accessConditions: patch.accessConditions ?? current.accessConditions,
          status: patch.status ?? current.status,
          updatedAt: now(),
          version: current.version + 1
        });
        this.contentEntities.set(id, next);
        return cloneContentItem(next);
      }, options)
    );
  }

  updateContentItem(
    id: ContentItemId,
    input: ContentItemUpdateInput,
    options?: LearningDomainOperationOptions
  ): Observable<ContentItem> {
    return this.updateContent(id, input, options);
  }

  deleteContent(id: ContentItemId, options?: LearningDomainOperationOptions): Observable<void> {
    return defer(() =>
      this.execute('DELETE', `/learning-domain/content/${id}`, undefined, () => {
        if (!this.contentEntities.has(id)) {
          throw this.notFound('content', id);
        }
        const dependentPath = [...this.pathEntities.values()].find((path) =>
          path.entries.some((entry) => entry.contentItemId === id)
        );
        if (dependentPath !== undefined) {
          throw this.invalidReference(
            'content',
            id,
            'path',
            dependentPath.id,
            'A learning path still references this content item.'
          );
        }
        this.contentEntities.delete(id);
        return undefined;
      }, options)
    );
  }

  deleteContentItem(id: ContentItemId, options?: LearningDomainOperationOptions): Observable<void> {
    return this.deleteContent(id, options);
  }

  listPaths(
    filter: LearningPathFilter = {},
    options?: LearningDomainOperationOptions
  ): Observable<readonly LearningPath[]> {
    return defer(() => {
      const normalized = this.normalizePathFilter(filter);
      return this.execute('GET', '/learning-domain/paths', normalized, () => {
        const results = [...this.pathEntities.values()]
          .filter((path) => this.matchesPath(path, normalized))
          .sort((left, right) => this.comparePath(left, right, normalized))
          .map(cloneLearningPath);
        return Object.freeze(results);
      }, options);
    });
  }

  listLearningPaths(
    filter: LearningPathFilter = {},
    options?: LearningDomainOperationOptions
  ): Observable<readonly LearningPath[]> {
    return this.listPaths(filter, options);
  }

  getPath(id: LearningPathId, options?: LearningDomainOperationOptions): Observable<LearningPath> {
    return defer(() =>
      this.execute('GET', `/learning-domain/paths/${id}`, undefined, () => {
        const path = this.pathEntities.get(id);
        if (path === undefined) {
          throw this.notFound('path', id);
        }
        return cloneLearningPath(path);
      }, options)
    );
  }

  getLearningPath(id: LearningPathId, options?: LearningDomainOperationOptions): Observable<LearningPath> {
    return this.getPath(id, options);
  }

  createPath(
    input: LearningPathCreateInput,
    options?: LearningDomainOperationOptions
  ): Observable<LearningPath> {
    return defer(() => {
      assertRecord(input, 'Learning path input');
      const id = input.id ?? asLearningPathId(this.nextId('path'));
      const normalized = this.normalizePathCreate(input, id);
      this.assertCourseExists(normalized.courseId, 'path', id);
      this.validatePathEntries(normalized.courseId, normalized.entries);
      return this.execute('POST', '/learning-domain/paths', input, () => {
        if (this.pathEntities.has(id)) {
          throw this.conflict('path', id, 'A learning path with this ID already exists.');
        }
        this.pathEntities.set(id, normalized);
        return cloneLearningPath(normalized);
      }, options);
    });
  }

  createLearningPath(
    input: LearningPathCreateInput,
    options?: LearningDomainOperationOptions
  ): Observable<LearningPath> {
    return this.createPath(input, options);
  }

  updatePath(
    id: LearningPathId,
    input: LearningPathUpdateInput,
    options?: LearningDomainOperationOptions
  ): Observable<LearningPath> {
    return defer(() =>
      this.execute('PATCH', `/learning-domain/paths/${id}`, input, () => {
        const current = this.pathEntities.get(id);
        if (current === undefined) {
          throw this.notFound('path', id);
        }
        this.assertExpectedVersion('path', current.version, options);
        const patch = input ?? {};
        const courseId = patch.courseId ?? current.courseId;
        const entries =
          patch.entries === undefined
            ? current.entries
            : this.normalizePathEntries(id, patch.entries);
        this.assertCourseExists(courseId, 'path', id);
        this.validatePathEntries(courseId, entries);
        const next = cloneLearningPath({
          ...current,
          ...patch,
          courseId,
          title: patch.title ?? current.title,
          description: patch.description ?? current.description,
          status: patch.status ?? current.status,
          reason: patch.reason ?? current.reason,
          entries,
          updatedAt: now(),
          version: current.version + 1
        });
        this.pathEntities.set(id, next);
        return cloneLearningPath(next);
      }, options)
    );
  }

  updateLearningPath(
    id: LearningPathId,
    input: LearningPathUpdateInput,
    options?: LearningDomainOperationOptions
  ): Observable<LearningPath> {
    return this.updatePath(id, input, options);
  }

  deletePath(id: LearningPathId, options?: LearningDomainOperationOptions): Observable<void> {
    return defer(() =>
      this.execute('DELETE', `/learning-domain/paths/${id}`, undefined, () => {
        if (!this.pathEntities.has(id)) {
          throw this.notFound('path', id);
        }
        this.pathEntities.delete(id);
        return undefined;
      }, options)
    );
  }

  deleteLearningPath(id: LearningPathId, options?: LearningDomainOperationOptions): Observable<void> {
    return this.deletePath(id, options);
  }

  private execute<TResponse, TBody = unknown>(
    method: MockHttpMethod,
    url: string,
    body: TBody,
    successBodyFactory: () => TResponse,
    options?: LearningDomainOperationOptions
  ): Observable<TResponse> {
    return this.transport
      .execute({ method, url, body }, successBodyFactory, this.controlsFor(options))
      .pipe(map((response) => response.body));
  }

  private controlsFor(options: LearningDomainOperationOptions | undefined): Partial<MockScenarioControls> {
    if (options === undefined) {
      return { ...this.scenarioControls };
    }
    const { expectedVersion: _expectedVersion, contentAccess: _contentAccess, ...controls } = options;
    return { ...this.scenarioControls, ...controls };
  }

  private assertExpectedVersion(
    entity: LearningDomainEntityName,
    currentVersion: number,
    options: LearningDomainOperationOptions | undefined
  ): void {
    if (options?.expectedVersion !== undefined && options.expectedVersion !== currentVersion) {
      throw this.conflict(entity, undefined, 'The entity version is stale.');
    }
  }

  private normalizeCourseFilter(filter: CourseFilter): CourseFilter {
    assertRecord(filter, 'Course filter');
    return Object.freeze({ ...filter });
  }

  private normalizeOutcomeFilter(filter: LearningOutcomeFilter): LearningOutcomeFilter {
    assertRecord(filter, 'Learning outcome filter');
    return Object.freeze({ ...filter });
  }

  private normalizeContentFilter(filter: ContentItemFilter): ContentItemFilter {
    assertRecord(filter, 'Content filter');
    return Object.freeze({ ...filter });
  }

  private normalizePathFilter(filter: LearningPathFilter): LearningPathFilter {
    assertRecord(filter, 'Learning path filter');
    return Object.freeze({ ...filter });
  }

  private matchesCourse(course: Course, filter: CourseFilter): boolean {
    return (
      matchesSearch(filter.search, [course.code, course.title, course.description]) &&
      matchesStatus(course.status, filter.status, filter.statuses) &&
      (filter.termId === undefined || course.termId === filter.termId)
    );
  }

  private compareCourse(left: Course, right: Course, filter: CourseFilter): number {
    const field = filter.sortBy ?? 'code';
    const leftValue = field === 'updatedAt' ? left.updatedAt : field === 'title' ? left.title : field === 'status' ? left.status : left.code;
    const rightValue = field === 'updatedAt' ? right.updatedAt : field === 'title' ? right.title : field === 'status' ? right.status : right.code;
    return compareValues(leftValue, rightValue) * sortDirection(filter.sortDirection) || idSort(left, right);
  }

  private matchesOutcome(outcome: LearningOutcome, filter: LearningOutcomeFilter): boolean {
    return (
      matchesSearch(filter.search, [outcome.code, outcome.title, outcome.description]) &&
      (filter.courseId === undefined || outcome.courseId === filter.courseId) &&
      matchesStatus(outcome.status, filter.status, filter.statuses) &&
      (filter.level === undefined || outcome.level === filter.level) &&
      (filter.minLevel === undefined || outcome.level >= filter.minLevel) &&
      (filter.maxLevel === undefined || outcome.level <= filter.maxLevel)
    );
  }

  private compareOutcome(left: LearningOutcome, right: LearningOutcome, filter: LearningOutcomeFilter): number {
    const field = filter.sortBy ?? 'code';
    const leftValue: string | number =
      field === 'updatedAt' ? left.updatedAt : field === 'title' ? left.title : field === 'level' ? left.level : field === 'status' ? left.status : left.code;
    const rightValue: string | number =
      field === 'updatedAt' ? right.updatedAt : field === 'title' ? right.title : field === 'level' ? right.level : field === 'status' ? right.status : right.code;
    return compareValues(leftValue, rightValue) * sortDirection(filter.sortDirection) || idSort(left, right);
  }

  private matchesContent(content: ContentItem, filter: ContentItemFilter): boolean {
    const outcomeId = filter.outcomeId ?? filter.learningOutcomeId;
    const formats = filter.formats;
    return (
      matchesSearch(filter.search, [content.title, content.description]) &&
      (filter.courseId === undefined || content.courseId === filter.courseId) &&
      (outcomeId === undefined || content.learningOutcomeIds.includes(outcomeId)) &&
      matchesStatus(content.status, filter.status, filter.statuses) &&
      (filter.level === undefined || content.level === filter.level) &&
      (filter.minLevel === undefined || content.level >= filter.minLevel) &&
      (filter.maxLevel === undefined || content.level <= filter.maxLevel) &&
      (filter.format === undefined || content.format === filter.format) &&
      (formats === undefined || formats.length === 0 || formats.includes(content.format))
    );
  }

  private compareContent(left: ContentItem, right: ContentItem, filter: ContentItemFilter): number {
    const field = filter.sortBy ?? 'title';
    const leftValue: string | number =
      field === 'updatedAt'
        ? left.updatedAt
        : field === 'level'
          ? left.level
          : field === 'durationMinutes'
            ? left.durationMinutes
            : field === 'format'
              ? left.format
              : field === 'status'
                ? left.status
                : left.title;
    const rightValue: string | number =
      field === 'updatedAt'
        ? right.updatedAt
        : field === 'level'
          ? right.level
          : field === 'durationMinutes'
            ? right.durationMinutes
            : field === 'format'
              ? right.format
              : field === 'status'
                ? right.status
                : right.title;
    return compareValues(leftValue, rightValue) * sortDirection(filter.sortDirection) || idSort(left, right);
  }

  private matchesPath(path: LearningPath, filter: LearningPathFilter): boolean {
    return (
      matchesSearch(filter.search, [path.title, path.description, path.reason]) &&
      (filter.courseId === undefined || path.courseId === filter.courseId) &&
      matchesStatus(path.status, filter.status, filter.statuses)
    );
  }

  private comparePath(left: LearningPath, right: LearningPath, filter: LearningPathFilter): number {
    const field = filter.sortBy ?? 'title';
    const leftValue = field === 'updatedAt' ? left.updatedAt : field === 'status' ? left.status : left.title;
    const rightValue = field === 'updatedAt' ? right.updatedAt : field === 'status' ? right.status : right.title;
    return compareValues(leftValue, rightValue) * sortDirection(filter.sortDirection) || idSort(left, right);
  }

  private normalizeCourseCreate(input: CourseCreateInput, id: CourseId): Course {
    const code = assertNonEmptyString(input.code, 'Course code');
    const title = assertNonEmptyString(input.title, 'Course title');
    const status = assertLifecycleState(input.status ?? 'draft', 'Course status');
    return cloneCourse({
      id,
      code,
      title,
      description: input.description?.trim() ?? '',
      termId: input.termId?.trim(),
      instructorIds: immutableArray(input.instructorIds ?? []),
      learningOutcomeIds: immutableArray(input.learningOutcomeIds ?? []),
      status,
      createdAt: now(),
      updatedAt: now(),
      version: 1
    });
  }

  private normalizeOutcomeCreate(input: LearningOutcomeCreateInput, id: LearningOutcomeId): LearningOutcome {
    const courseId = assertNonEmptyString(input.courseId, 'Learning outcome course ID') as CourseId;
    const code = assertNonEmptyString(input.code, 'Learning outcome code');
    const title = assertNonEmptyString(input.title, 'Learning outcome title');
    const status = assertLifecycleState(input.status ?? 'draft', 'Learning outcome status');
    const level = assertInteger(input.level ?? 1, 'Learning outcome level');
    return cloneLearningOutcome({
      id,
      courseId,
      code,
      title,
      description: input.description?.trim() ?? '',
      level,
      status,
      prerequisiteOutcomeIds: immutableArray(input.prerequisiteOutcomeIds ?? []),
      createdAt: now(),
      updatedAt: now(),
      version: 1
    });
  }

  private normalizeContentCreate(input: ContentItemCreateInput, id: ContentItemId): ContentItem {
    const courseId = assertNonEmptyString(input.courseId, 'Content course ID') as CourseId;
    const learningOutcomeIds = input.learningOutcomeIds ?? input.outcomeIds ?? [];
    const title = assertNonEmptyString(input.title, 'Content title');
    const level = assertInteger(input.level ?? 1, 'Content level');
    const durationMinutes = assertInteger(input.durationMinutes ?? 1, 'Content duration', 1);
    const format = assertContentFormat(input.format ?? 'article', 'Content format');
    const status = assertLifecycleState(input.status ?? 'draft', 'Content status');
    return cloneContentItem({
      id,
      courseId,
      title,
      description: input.description?.trim() ?? '',
      learningOutcomeIds: immutableArray(learningOutcomeIds),
      level,
      durationMinutes,
      format,
      accessConditions: cloneAccess(input.accessConditions),
      status,
      createdAt: now(),
      updatedAt: now(),
      version: 1
    });
  }

  private normalizePathCreate(input: LearningPathCreateInput, id: LearningPathId): LearningPath {
    const courseId = assertNonEmptyString(input.courseId, 'Learning path course ID') as CourseId;
    const title = assertNonEmptyString(input.title, 'Learning path title');
    return cloneLearningPath({
      id,
      courseId,
      title,
      description: input.description?.trim() ?? '',
      status: assertLifecycleState(input.status ?? 'draft', 'Learning path status'),
      reason: input.reason?.trim() ?? '',
      entries: this.normalizePathEntries(id, input.entries ?? []),
      createdAt: now(),
      updatedAt: now(),
      version: 1
    });
  }

  private normalizePathEntries(
    pathId: LearningPathId,
    entries: readonly LearningPathEntryInput[]
  ): readonly LearningPathEntry[] {
    const normalized = entries.map((entry, index) => {
      assertRecord(entry, 'Learning path entry');
      const contentItemIdValue = entry['contentItemId'] ?? entry['contentId'];
      const contentItemId =
        contentItemIdValue === undefined
          ? undefined
          : asContentItemId(assertNonEmptyString(contentItemIdValue, 'Learning path entry content ID'));
      if (contentItemId === undefined) {
        throw new LearningDomainError('validation', 'Learning path entry content ID is required.');
      }
      const orderValue = entry['order'] ?? entry['position'];
      const order = assertInteger(orderValue ?? index + 1, 'Learning path entry order', 1);
      const idValue = entry['id'];
      const id =
        idValue === undefined
          ? asLearningPathEntryId(`${pathId}-entry-${order}`)
          : asLearningPathEntryId(assertNonEmptyString(idValue, 'Learning path entry ID'));
      const reasonValue = entry['reason'];
      const reason =
        reasonValue === undefined
          ? 'Continue with the next recommended activity.'
          : assertString(reasonValue, 'Learning path entry reason').trim();
      const reasonDetailsValue = entry['reasonDetails'];
      const reasonDetails =
        reasonDetailsValue === undefined
          ? undefined
          : assertLearningPathReason(reasonDetailsValue, 'Learning path entry reason details');
      const isCompletedValue = entry['isCompleted'];
      const isCompleted =
        isCompletedValue === undefined
          ? false
          : assertBoolean(isCompletedValue, 'Learning path entry completion state');
      const isLockedValue = entry['isLocked'];
      const isLocked =
        isLockedValue === undefined
          ? false
          : assertBoolean(isLockedValue, 'Learning path entry lock state');
      return cloneLearningPathEntry({
        id,
        order,
        contentItemId,
        reason,
        reasonDetails: cloneReason(reasonDetails),
        isCompleted,
        isLocked
      });
    });
    return immutableArray([...normalized].sort((left, right) => left.order - right.order || idSort(left, right)));
  }

  private assertCourseExists(courseId: CourseId, entity: LearningDomainEntityName, id: string): void {
    if (!this.courseEntities.has(courseId)) {
      throw this.invalidReference(entity, id, 'course', courseId, 'The referenced course does not exist.');
    }
  }

  private validateCourseOutcomeReferences(courseId: CourseId, outcomeIds: readonly LearningOutcomeId[]): void {
    for (const outcomeId of outcomeIds) {
      const outcome = this.outcomeEntities.get(outcomeId);
      if (outcome === undefined) {
        throw this.invalidReference('course', courseId, 'outcome', outcomeId, 'The referenced outcome does not exist.');
      }
      if (outcome.courseId !== courseId) {
        throw this.invalidReference('course', courseId, 'outcome', outcomeId, 'The outcome belongs to another course.');
      }
    }
  }

  private validateOutcomePrerequisites(courseId: CourseId, prerequisiteOutcomeIds: readonly LearningOutcomeId[]): void {
    for (const prerequisiteOutcomeId of prerequisiteOutcomeIds) {
      const prerequisite = this.outcomeEntities.get(prerequisiteOutcomeId);
      if (prerequisite === undefined) {
        throw this.invalidReference('outcome', undefined, 'outcome', prerequisiteOutcomeId, 'The prerequisite outcome does not exist.');
      }
      if (prerequisite.courseId !== courseId) {
        throw this.invalidReference('outcome', undefined, 'outcome', prerequisiteOutcomeId, 'The prerequisite belongs to another course.');
      }
    }
  }

  private assertOutcomePrerequisiteGraphIsAcyclic(candidate: LearningOutcome): void {
    const prospectiveOutcomes = [...this.outcomeEntities.values()];
    const candidateIndex = prospectiveOutcomes.findIndex((outcome) => outcome.id === candidate.id);
    if (candidateIndex === -1) {
      prospectiveOutcomes.push(candidate);
    } else {
      prospectiveOutcomes[candidateIndex] = candidate;
    }

    const cycle = findOutcomePrerequisiteCycle(prospectiveOutcomes);
    if (cycle === null) {
      return;
    }

    const cyclePath = cycle
      .map((outcomeId) => prospectiveOutcomes.find((outcome) => outcome.id === outcomeId)?.code ?? outcomeId)
      .join(' -> ');
    throw new LearningDomainError(
      'validation',
      `Learning outcome prerequisite cycle detected: ${cyclePath}.`,
      'outcome',
      candidate.id
    );
  }

  private validateContentOutcomeReferences(
    courseId: CourseId,
    outcomeIds: readonly LearningOutcomeId[]
  ): void {
    for (const outcomeId of outcomeIds) {
      const outcome = this.outcomeEntities.get(outcomeId);
      if (outcome === undefined) {
        throw this.invalidReference('content', undefined, 'outcome', outcomeId, 'The referenced outcome does not exist.');
      }
      if (outcome.courseId !== courseId) {
        throw this.invalidReference('content', undefined, 'outcome', outcomeId, 'The outcome belongs to another course.');
      }
    }
  }

  private validatePathEntries(courseId: CourseId, entries: readonly LearningPathEntry[]): void {
    const seenOrders = new Set<number>();
    for (const entry of entries) {
      if (seenOrders.has(entry.order)) {
        throw new LearningDomainError('validation', 'Learning path entry order values must be unique.');
      }
      seenOrders.add(entry.order);
      const content = this.contentEntities.get(entry.contentItemId);
      if (content === undefined) {
        throw this.invalidReference('path', undefined, 'content', entry.contentItemId, 'The path content item does not exist.');
      }
      if (content.courseId !== courseId) {
        throw this.invalidReference('path', undefined, 'content', entry.contentItemId, 'The content belongs to another course.');
      }
    }
  }

  private moveOutcomeBetweenCourses(
    outcomeId: LearningOutcomeId,
    previousCourseId: CourseId,
    nextCourseId: CourseId
  ): void {
    const previousCourse = this.courseEntities.get(previousCourseId);
    const nextCourse = this.courseEntities.get(nextCourseId);
    if (previousCourse !== undefined) {
      this.courseEntities.set(
        previousCourse.id,
        cloneCourse({
          ...previousCourse,
          learningOutcomeIds: previousCourse.learningOutcomeIds.filter((id) => id !== outcomeId),
          updatedAt: now(),
          version: previousCourse.version + 1
        })
      );
    }
    if (nextCourse !== undefined && !nextCourse.learningOutcomeIds.includes(outcomeId)) {
      this.courseEntities.set(
        nextCourse.id,
        cloneCourse({
          ...nextCourse,
          learningOutcomeIds: [...nextCourse.learningOutcomeIds, outcomeId],
          updatedAt: now(),
          version: nextCourse.version + 1
        })
      );
    }
  }

  private nextId(prefix: string): string {
    const id = `${prefix}-${this.sequence}`;
    this.sequence += 1;
    return id;
  }


  private notFound(entity: LearningDomainEntityName, id: string): LearningDomainError {
    return new LearningDomainError('not-found', `Unknown ${entity} ID: ${id}.`, entity, id);
  }

  private invalidReference(
    entity: LearningDomainEntityName,
    id: string | undefined,
    referenceEntity: LearningDomainEntityName,
    referenceId: string | undefined,
    message: string
  ): LearningDomainError {
    return new LearningDomainError('invalid-reference', message, entity, id, referenceEntity, referenceId);
  }

  private conflict(
    entity: LearningDomainEntityName,
    id: string | undefined,
    message: string
  ): LearningDomainError {
    return new LearningDomainError('conflict', message, entity, id);
  }
}
