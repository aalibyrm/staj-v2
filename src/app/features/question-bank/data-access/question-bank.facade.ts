import { Injectable, Optional, computed, signal, type Signal } from '@angular/core';
import { defer, of, throwError, type Observable } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';

import { ApiTransportError, normalizeApplicationError } from '../../../core/api/api-error';
import {
  DEFAULT_MOCK_SCENARIO,
  MockTransport,
  type MockScenarioControls
} from '../../../core/api/mock-transport';
import {
  type AuthSession,
  type RoleCode
} from '../../../core/auth/authorization';
import { SessionStore } from '../../../core/auth/session.store';
import {
  MAX_PAGE,
  normalizePageValue,
  normalizeSearchValue,
  normalizeTokenValue
} from '../../../shared/state/list-query-state';
import { createSeedData } from '../../adaptive-learning/data-access/seed-data.factory';
import type {
  SeedCourse,
  SeedLearningOutcome
} from '../../adaptive-learning/models/seed-domain.models';
import {
  DEFAULT_QUESTION_PAGE,
  DEFAULT_QUESTION_PAGE_SIZE,
  DEFAULT_QUESTION_SORT,
  EMPTY_QUESTION_STATUS_COUNTS,
  QUESTION_DIFFICULTIES,
  QUESTION_GRADES,
  QUESTION_SORTS,
  QUESTION_STATUSES,
  QUESTION_TYPES,
  asQuestionId,
  isQuestionSort,
  questionReferenceFromCourse,
  questionReferenceFromOutcome,
  type Question,
  type QuestionAnswer,
  type QuestionBankRequestState,
  type QuestionCourseReference,
  type QuestionDifficulty,
  type QuestionId,
  type QuestionListQuery,
  type QuestionListQueryInput,
  type QuestionListResponse,
  type QuestionOption,
  type QuestionSort,
  type QuestionStatus,
  type QuestionStatusCounts,
  type QuestionType
} from '../models/question.models';

const AUTHORIZED_QUESTION_ROLES = Object.freeze(['INSTRUCTOR', 'MEASUREMENT_SPECIALIST'] as const);
const QUESTIONS_PER_COURSE = 18;
const MAX_SEARCH_LENGTH = 120;
const QUESTION_PAGE_SIZE_MAX = 50;
const QUESTION_PAGE_MAX = MAX_PAGE;

type AuthorizedQuestionRole = (typeof AUTHORIZED_QUESTION_ROLES)[number];

type NormalizedQuestionAccess = Readonly<{
  role: AuthorizedQuestionRole;
  courseIds: readonly string[];
}>;

export interface QuestionBankAccessContext {
  readonly authenticated: boolean;
  readonly role: RoleCode | string | null;
  readonly courseIds: readonly string[];
}

export interface QuestionBankRequestOptions extends Partial<MockScenarioControls> {
  readonly session?: AuthSession | null;
  readonly access?: QuestionBankAccessContext | null;
}

export type QuestionBankErrorCode = 'not-found' | 'unauthorized';

export class QuestionBankError extends Error {
  override readonly name = 'QuestionBankError';

  constructor(
    readonly code: QuestionBankErrorCode,
    message: string
  ) {
    super(message);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const deepFreeze = <T>(value: T): T => {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return value;
};

const toSafeToken = (value: unknown): string => normalizeTokenValue(value) ?? '';

const normalizeSeedToken = (value: unknown): string => {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return '';
  }
  return String(value)
    .trim()
    .replace(/[^A-Za-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
};

const normalizePageSize = (value: unknown): number => {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return Math.min(Math.max(value, 1), QUESTION_PAGE_SIZE_MAX);
  }

  const token = toSafeToken(value);
  if (!/^\d+$/.test(token)) {
    return DEFAULT_QUESTION_PAGE_SIZE;
  }

  const parsed = Number(token);
  return Number.isSafeInteger(parsed)
    ? Math.min(Math.max(parsed, 1), QUESTION_PAGE_SIZE_MAX)
    : DEFAULT_QUESTION_PAGE_SIZE;
};

const normalizeQuestionSort = (value: unknown): QuestionSort => {
  const token = toSafeToken(value);
  if (isQuestionSort(token)) {
    return token;
  }

  const aliases: Readonly<Record<string, QuestionSort>> = {
    updated: DEFAULT_QUESTION_SORT,
    'updated-desc': 'updatedAt-desc',
    'updated-asc': 'updatedAt-asc',
    id: 'id-asc',
    title: 'title-asc',
    difficulty: 'difficulty-asc',
    points: 'points-desc'
  };
  return aliases[token] ?? DEFAULT_QUESTION_SORT;
};

export const normalizeQuestionListQuery = (
  input: QuestionListQueryInput | null | undefined = undefined
): QuestionListQuery => {
  const source = isRecord(input) ? input : {};
  const courseCandidate = source['course'] ?? source['courseId'];
  const page = normalizePageValue(source['page']);
  return Object.freeze({
    search: normalizeSearchValue(source['search']).slice(0, MAX_SEARCH_LENGTH),
    course: toSafeToken(courseCandidate),
    grade: toSafeToken(source['grade']),
    difficulty: toSafeToken(source['difficulty']),
    status: toSafeToken(source['status']),
    type: toSafeToken(source['type']),
    sort: normalizeQuestionSort(source['sort']),
    page,
    pageSize: normalizePageSize(source['pageSize'])
  });
};

const emptyStatusCounts = (): Record<QuestionStatus, number> => ({
  draft: 0,
  review: 0,
  published: 0,
  archived: 0
});

const cloneQuestionAnswer = (answer: QuestionAnswer): QuestionAnswer => {
  switch (answer.kind) {
    case 'choice':
      return { kind: 'choice', optionIds: [...answer.optionIds] };
    case 'boolean':
      return { kind: 'boolean', value: answer.value };
    case 'matching':
      return {
        kind: 'matching',
        pairs: answer.pairs.map((pair) => ({ ...pair }))
      };
    case 'short-answer':
      return { kind: 'short-answer', acceptedAnswers: [...answer.acceptedAnswers] };
    case 'essay':
      return { kind: 'essay', rubricHint: answer.rubricHint };
  }
};

const cloneQuestion = (question: Question): Question => deepFreeze({
  ...question,
  course: { ...question.course },
  outcome: { ...question.outcome },
  tags: [...question.tags],
  options: question.options.map((option) => ({ ...option })),
  answer: cloneQuestionAnswer(question.answer)
});

const idSort = (left: { readonly id: string }, right: { readonly id: string }): number =>
  left.id < right.id ? -1 : left.id > right.id ? 1 : 0;

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const directionFor = (sort: QuestionSort): 1 | -1 =>
  sort.endsWith('-desc') ? -1 : 1;

const compareDifficulty = (left: QuestionDifficulty, right: QuestionDifficulty): number => {
  const order: Readonly<Record<QuestionDifficulty, number>> = { easy: 1, medium: 2, hard: 3 };
  return order[left] - order[right];
};

const compareQuestions = (left: Question, right: Question, sort: QuestionSort): number => {
  let comparison: number;
  switch (sort) {
    case 'updatedAt-desc':
    case 'updatedAt-asc':
      comparison = compareText(left.updatedAt, right.updatedAt);
      break;
    case 'id-asc':
    case 'id-desc':
      comparison = compareText(left.id, right.id);
      break;
    case 'title-asc':
    case 'title-desc':
      comparison = compareText(left.title, right.title);
      break;
    case 'difficulty-asc':
      comparison = compareDifficulty(left.difficulty, right.difficulty);
      break;
    case 'points-desc':
      comparison = left.points - right.points;
      break;
  }

  if (comparison === 0) {
    return idSort(left, right);
  }
  return comparison * directionFor(sort);
};

const matchesSearch = (question: Question, search: string): boolean => {
  if (search.length === 0) {
    return true;
  }

  const candidate = [
    question.id,
    question.title,
    question.stem,
    question.course.code,
    question.course.title,
    question.outcome.code,
    question.outcome.title,
    ...question.tags
  ].join(' ').toLocaleLowerCase();
  return candidate.includes(search.toLocaleLowerCase());
};

const buildQuestionAnswer = (
  type: QuestionType,
  index: number,
  options: readonly QuestionOption[]
): QuestionAnswer => {
  switch (type) {
    case 'single-choice':
      return { kind: 'choice', optionIds: [options[index % options.length].id] };
    case 'multiple-choice':
      return {
        kind: 'choice',
        optionIds: [options[index % options.length].id, options[(index + 2) % options.length].id]
      };
    case 'true-false':
      return { kind: 'boolean', value: index % 2 === 0 };
    case 'matching':
      return {
        kind: 'matching',
        pairs: [
          { prompt: `Concept ${index + 1}`, answer: `Evidence ${index + 1}` },
          { prompt: `Concept ${index + 2}`, answer: `Evidence ${index + 2}` }
        ]
      };
    case 'short-answer':
      return {
        kind: 'short-answer',
        acceptedAnswers: [`response-${index + 1}`, `answer-${index + 1}`]
      };
    case 'essay':
      return {
        kind: 'essay',
        rubricHint: 'Explain the relationship and support the response with course evidence.'
      };
  }
};

const optionsFor = (type: QuestionType, index: number): readonly QuestionOption[] => {
  if (type === 'true-false') {
    return Object.freeze([
      { id: 'true', label: 'True' },
      { id: 'false', label: 'False' }
    ]);
  }
  if (type === 'matching' || type === 'short-answer' || type === 'essay') {
    return Object.freeze([]);
  }
  return Object.freeze([
    { id: `option-a-${index + 1}`, label: 'The first supported interpretation' },
    { id: `option-b-${index + 1}`, label: 'A related but incomplete interpretation' },
    { id: `option-c-${index + 1}`, label: 'An unrelated interpretation' },
    { id: `option-d-${index + 1}`, label: 'The interpretation contradicted by evidence' }
  ]);
};

const createQuestionSeed = (
  course: SeedCourse,
  outcome: SeedLearningOutcome,
  courseIndex: number,
  index: number
): Question => {
  const type = QUESTION_TYPES[index % QUESTION_TYPES.length];
  const options = optionsFor(type, index);
  const sequence = courseIndex * QUESTIONS_PER_COURSE + index;
  const updatedAt = new Date(Date.UTC(2025, 0, 2 + sequence)).toISOString();
  const createdAt = new Date(Date.UTC(2024, 5, 2 + sequence)).toISOString();
  const courseToken = normalizeSeedToken(course.code) ||
    normalizeSeedToken(course.id).replace(/^COURSE-/i, '') ||
    'course';
  const courseIdentity = normalizeSeedToken(course.id).replace(/^COURSE-/i, '') || `${courseToken}-${courseIndex + 1}`;
  const id = asQuestionId(`QUESTION-${courseToken}-${courseIdentity}-${String(index + 1).padStart(3, '0')}`);
  const question: Question = {
    id,
    createdAt,
    updatedAt,
    version: 1 + (index % 3),
    status: QUESTION_STATUSES[(index + courseIndex) % QUESTION_STATUSES.length],
    courseId: course.id,
    outcomeId: outcome.id,
    course: questionReferenceFromCourse(course),
    outcome: questionReferenceFromOutcome(outcome),
    title: `${outcome.code} practice item ${index + 1}`,
    stem: `Which response best demonstrates ${outcome.title.toLocaleLowerCase()} in ${course.title}?`,
    explanation: `This item checks ${outcome.title.toLocaleLowerCase()} and relates the answer to evidence from ${course.code}.`,
    tags: [courseToken.toLocaleLowerCase(), outcome.code.toLocaleLowerCase(), type],
    difficulty: QUESTION_DIFFICULTIES[(index + courseIndex) % QUESTION_DIFFICULTIES.length],
    points: 2 + (index % 5),
    grade: QUESTION_GRADES[(index + courseIndex) % QUESTION_GRADES.length],
    type,
    options,
    answer: buildQuestionAnswer(type, index, options)
  };
  return deepFreeze(question);
};

const createQuestionSeedData = (): Readonly<{
  readonly questions: readonly Question[];
  readonly courses: readonly QuestionCourseReference[];
}> => {
  const seed = createSeedData();
  const questions: Question[] = [];
  const courses: QuestionCourseReference[] = [];
  seed.courses.forEach((course, courseIndex) => {
    courses.push(questionReferenceFromCourse(course));
    const outcomes = seed.learningOutcomes.filter((outcome) => outcome.courseId === course.id);
    if (outcomes.length === 0) {
      return;
    }
    for (let index = 0; index < QUESTIONS_PER_COURSE; index += 1) {
      const outcome = outcomes[index % outcomes.length];
      questions.push(createQuestionSeed(course, outcome, courseIndex, index));
    }
  });
  return deepFreeze({
    questions: Object.freeze(questions),
    courses: Object.freeze(courses.sort(idSort))
  });
};

const normalizeScenarioControls = (
  current: MockScenarioControls,
  options: QuestionBankRequestOptions
): Partial<MockScenarioControls> => {
  const {
    session: _session,
    access: _access,
    ...scenarioOptions
  } = options;
  return { ...current, ...scenarioOptions };
};

const sessionAccess = (session: AuthSession | null | undefined): NormalizedQuestionAccess | null => {
  if (!isRecord(session) || session['accountId'] === undefined || !isRecord(session['account'])) {
    return null;
  }
  const account = session['account'];
  const role = account['roleCode'];
  if (!(AUTHORIZED_QUESTION_ROLES as readonly string[]).includes(String(role))) {
    return null;
  }
  const grants = account['scopeGrants'];
  if (!Array.isArray(grants)) {
    return null;
  }
  const courseIds = grants.flatMap((grant) => {
    if (!isRecord(grant) || grant['kind'] !== 'course' || grant['global'] === true || !Array.isArray(grant['ids'])) {
      return [];
    }
    return grant['ids'].filter((id): id is string => typeof id === 'string' && id.length > 0);
  });
  if (courseIds.length === 0) {
    return null;
  }
  return Object.freeze({
    role: role as AuthorizedQuestionRole,
    courseIds: Object.freeze([...new Set(courseIds)])
  });
};

const explicitAccess = (access: QuestionBankAccessContext | null | undefined): NormalizedQuestionAccess | null => {
  if (!isRecord(access) || access['authenticated'] !== true) {
    return null;
  }
  const role = access['role'];
  if (typeof role !== 'string' || !(AUTHORIZED_QUESTION_ROLES as readonly string[]).includes(role)) {
    return null;
  }
  const courseIds = access['courseIds'];
  if (!Array.isArray(courseIds)) {
    return null;
  }
  const normalizedCourseIds = courseIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (normalizedCourseIds.length === 0) {
    return null;
  }
  return Object.freeze({
    role: role as AuthorizedQuestionRole,
    courseIds: Object.freeze([...new Set(normalizedCourseIds)])
  });
};

const getAccess = (options: QuestionBankRequestOptions): NormalizedQuestionAccess | null => {
  if (options.access !== undefined) {
    return explicitAccess(options.access);
  }
  return sessionAccess(options.session);
};

const cloneStatusCounts = (counts: QuestionStatusCounts): QuestionStatusCounts => Object.freeze({
  draft: counts.draft,
  review: counts.review,
  published: counts.published,
  archived: counts.archived
});

const freezeResponse = (
  items: readonly Question[],
  total: number,
  page: number,
  pageSize: number,
  totalPages: number,
  query: QuestionListQuery,
  statusCounts: QuestionStatusCounts
): QuestionListResponse => deepFreeze({
  items: Object.freeze(items.map(cloneQuestion)),
  total,
  page,
  pageSize,
  totalPages,
  hasPreviousPage: page > 1,
  hasNextPage: page < totalPages,
  query: Object.freeze({ ...query, page }),
  statusCounts: cloneStatusCounts(statusCounts)
});

@Injectable({ providedIn: 'root' })
export class QuestionBankRepository {
  private readonly transport: MockTransport;
  private readonly questions: readonly Question[];
  private readonly courses: readonly QuestionCourseReference[];
  private scenarioControls: MockScenarioControls = { ...DEFAULT_MOCK_SCENARIO };

  constructor(@Optional() transport: MockTransport | null = null) {
    this.transport = transport ?? new MockTransport();
    const seed = createQuestionSeedData();
    this.questions = seed.questions;
    this.courses = seed.courses;
  }

  listQuestions(
    input: QuestionListQueryInput = {},
    options: QuestionBankRequestOptions = {}
  ): Observable<QuestionListResponse> {
    return defer(() => {
      const query = normalizeQuestionListQuery(input);
      const access = getAccess(options);
      const controls = normalizeScenarioControls(this.scenarioControls, options);
      if (access === null) {
        return this.transport.execute(
          { method: 'GET', url: '/question-bank/questions', body: query },
          () => freezeResponse([], 0, 1, query.pageSize, 0, query, emptyStatusCounts()),
          { ...controls, outcome: 'unauthorized' }
        ).pipe(map(({ body }) => body));
      }

      return this.transport.execute(
        { method: 'GET', url: '/question-bank/questions', body: query },
        () => this.buildListResponse(query, access),
        controls
      ).pipe(map(({ body }) => body));
    });
  }

  list(input: QuestionListQueryInput = {}, options: QuestionBankRequestOptions = {}): Observable<QuestionListResponse> {
    return this.listQuestions(input, options);
  }

  getQuestion(id: QuestionId | string, options: QuestionBankRequestOptions = {}): Observable<Question> {
    return defer(() => {
      const access = getAccess(options);
      const controls = normalizeScenarioControls(this.scenarioControls, options);
      if (access === null) {
        return this.transport.execute(
          { method: 'GET', url: `/question-bank/questions/${String(id)}` },
          () => {
            throw new ApiTransportError('unauthorized', 1);
          },
          { ...controls, outcome: 'unauthorized' }
        ).pipe(map(({ body }) => body));
      }

      return this.transport.execute(
        { method: 'GET', url: `/question-bank/questions/${String(id)}` },
        () => {
          const question = this.questions.find(
            (candidate) => candidate.id === id && access.courseIds.includes(candidate.courseId)
          );
          if (question === undefined) {
            throw new QuestionBankError('not-found', 'The selected question is no longer available in this scope.');
          }
          return cloneQuestion(question);
        },
        controls
      ).pipe(map(({ body }) => body));
    });
  }

  get(id: QuestionId | string, options: QuestionBankRequestOptions = {}): Observable<Question> {
    return this.getQuestion(id, options);
  }

  listCourseOptions(options: QuestionBankRequestOptions = {}): Observable<readonly QuestionCourseReference[]> {
    return defer(() => {
      const access = getAccess(options);
      const controls = normalizeScenarioControls(this.scenarioControls, options);
      if (access === null) {
        return this.transport.execute(
          { method: 'GET', url: '/question-bank/courses' },
          () => Object.freeze([] as readonly QuestionCourseReference[]),
          { ...controls, outcome: 'unauthorized' }
        ).pipe(map(({ body }) => body));
      }
      return this.transport.execute(
        { method: 'GET', url: '/question-bank/courses' },
        () => Object.freeze(
          this.courses
            .filter((course) => access.courseIds.includes(course.id))
            .map((course) => Object.freeze({ ...course }))
        ),
        controls
      ).pipe(map(({ body }) => body));
    });
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

  getSnapshot(): Readonly<{ readonly questions: readonly Question[] }> {
    return Object.freeze({
      questions: Object.freeze(this.questions.map(cloneQuestion))
    });
  }

  private buildListResponse(
    query: QuestionListQuery,
    access: NormalizedQuestionAccess
  ): QuestionListResponse {
    const scoped = this.questions.filter((question) => access.courseIds.includes(question.courseId));
    const searchAndFilters = scoped.filter((question) =>
      matchesSearch(question, query.search) &&
      (query.course.length === 0 || question.courseId === query.course) &&
      (query.grade.length === 0 || question.grade === query.grade) &&
      (query.difficulty.length === 0 || question.difficulty === query.difficulty) &&
      (query.type.length === 0 || question.type === query.type)
    );
    const counts = emptyStatusCounts();
    for (const question of searchAndFilters) {
      counts[question.status] += 1;
    }
    const filtered = query.status.length === 0
      ? searchAndFilters
      : searchAndFilters.filter((question) => question.status === query.status);
    const sorted = [...filtered].sort((left, right) => compareQuestions(left, right, query.sort));
    const total = sorted.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / query.pageSize);
    const page = totalPages === 0 ? 1 : Math.min(query.page, totalPages);
    const offset = totalPages === 0 ? 0 : (page - 1) * query.pageSize;
    const items = sorted.slice(offset, offset + query.pageSize);
    return freezeResponse(items, total, page, query.pageSize, totalPages, query, counts);
  }
}

@Injectable({ providedIn: 'root' })
export class QuestionBankFacade {
  private readonly repository: QuestionBankRepository;
  private readonly sessionStore: SessionStore;
  private readonly writableRequestState = signal<QuestionBankRequestState>({ status: 'idle' });
  private readonly writablePageResult = signal<QuestionListResponse | null>(null);
  private readonly writableSelectedId = signal<QuestionId | null>(null);
  private readonly writableSelectedQuestion = signal<Question | null>(null);
  private readonly writableSelectionNotice = signal('');
  private readonly writableCourseOptions = signal<readonly QuestionCourseReference[]>([]);
  private lastQuery: QuestionListQuery = normalizeQuestionListQuery();

  readonly requestState: Signal<QuestionBankRequestState> = this.writableRequestState.asReadonly();
  readonly pageResult: Signal<QuestionListResponse | null> = this.writablePageResult.asReadonly();
  readonly result: Signal<QuestionListResponse | null> = this.pageResult;
  readonly selectedId: Signal<QuestionId | null> = this.writableSelectedId.asReadonly();
  readonly selectedQuestion: Signal<Question | null> = this.writableSelectedQuestion.asReadonly();
  readonly selectedEntity: Signal<Question | null> = this.selectedQuestion;
  readonly selectionNotice: Signal<string> = this.writableSelectionNotice.asReadonly();
  readonly courseOptions: Signal<readonly QuestionCourseReference[]> = this.writableCourseOptions.asReadonly();
  readonly statusCounts = computed<QuestionStatusCounts>(() =>
    this.pageResult()?.statusCounts ?? EMPTY_QUESTION_STATUS_COUNTS
  );
  readonly total = computed(() => this.pageResult()?.total ?? 0);
  readonly currentPage = computed(() => this.pageResult()?.page ?? DEFAULT_QUESTION_PAGE);
  readonly totalPages = computed(() => this.pageResult()?.totalPages ?? 0);
  readonly errorMessage = computed(() => this.requestState().message ?? '');

  constructor(
    @Optional() repository: QuestionBankRepository | null = null,
    @Optional() sessionStore: SessionStore | null = null
  ) {
    this.repository = repository ?? new QuestionBankRepository();
    this.sessionStore = sessionStore ?? new SessionStore();
  }

  loadQuestions(
    input: QuestionListQueryInput = {},
    options: QuestionBankRequestOptions = {}
  ): Observable<QuestionListResponse> {
    const query = normalizeQuestionListQuery(input);
    this.lastQuery = query;
    this.writableRequestState.set({ status: 'loading' });
    this.writablePageResult.set(null);
    this.clearSelection('');
    return defer(() => this.repository.listQuestions(query, {
      ...this.sessionOptions(),
      ...options
    })).pipe(
      tap((response) => {
        this.lastQuery = response.query;
        this.writablePageResult.set(response);
        this.writableRequestState.set({
          status: response.total === 0 ? 'empty' : 'success'
        });
      }),
      catchError((error: unknown) => {
        const normalized = normalizeApplicationError(error);
        const status = normalized.kind === 'unauthorized' ? 'unauthorized' : 'error';
        this.writablePageResult.set(null);
        this.writableRequestState.set({ status, message: normalized.userMessage });
        return throwError(() => error);
      })
    );
  }

  load(input: QuestionListQueryInput = {}, options: QuestionBankRequestOptions = {}): Observable<QuestionListResponse> {
    return this.loadQuestions(input, options);
  }

  retry(options: QuestionBankRequestOptions = {}): Observable<QuestionListResponse> {
    return this.loadQuestions(this.lastQuery, options);
  }

  selectQuestion(
    id: QuestionId | string | null | undefined,
    options: QuestionBankRequestOptions = {}
  ): Observable<Question | null> {
    const normalized = typeof id === 'string' && id.trim().length > 0 ? asQuestionId(id.trim()) : null;
    if (normalized === null) {
      this.clearSelection('');
      return of(null);
    }

    return defer(() => this.repository.getQuestion(normalized, {
      ...this.sessionOptions(),
      ...options
    })).pipe(
      tap((question) => {
        this.writableSelectedId.set(question.id);
        this.writableSelectedQuestion.set(question);
        this.writableSelectionNotice.set('');
      }),
      map((question) => question),
      catchError((error: unknown) => {
        const normalizedError = normalizeApplicationError(error);
        if (normalizedError.kind === 'unauthorized') {
          this.writableRequestState.set({ status: 'unauthorized', message: normalizedError.userMessage });
          this.clearSelection('Selection cleared because access to the question scope is unavailable.');
        } else {
          this.clearSelection('Selection cleared because the question is missing or stale.');
        }
        return of(null);
      })
    );
  }

  select(id: QuestionId | string | null | undefined, options: QuestionBankRequestOptions = {}): Observable<Question | null> {
    return this.selectQuestion(id, options);
  }

  clearSelection(reason = 'Selection cleared.'): void {
    this.writableSelectedId.set(null);
    this.writableSelectedQuestion.set(null);
    this.writableSelectionNotice.set(reason);
  }

  loadCourseOptions(options: QuestionBankRequestOptions = {}): Observable<readonly QuestionCourseReference[]> {
    return defer(() => this.repository.listCourseOptions({
      ...this.sessionOptions(),
      ...options
    })).pipe(
      tap((courses) => this.writableCourseOptions.set(courses))
    );
  }

  setMockScenario(controls: Partial<MockScenarioControls>): void {
    this.repository.setMockScenario(controls);
  }

  resetMockScenario(): void {
    this.repository.resetMockScenario();
  }

  private sessionOptions(): QuestionBankRequestOptions {
    return { session: this.sessionStore.session() };
  }
}

export {
  AUTHORIZED_QUESTION_ROLES,
  QUESTION_PAGE_MAX,
  QUESTION_PAGE_SIZE_MAX,
  QUESTION_DIFFICULTIES,
  QUESTION_GRADES,
  QUESTION_STATUSES,
  QUESTION_TYPES,
  QUESTION_SORTS
};
