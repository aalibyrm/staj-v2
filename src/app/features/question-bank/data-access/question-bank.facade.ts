import { Injectable, Optional, computed, signal, type Signal } from '@angular/core';
import { defer, of, throwError, type Observable } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';

import { AuditPort, type AuditEventDraft } from '../../../core/observability/observability.ports';
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
  asCourseId,
  asLearningOutcomeId,
  asQuestionId,
  asQuestionVersionId,
  isQuestionSort,
  questionReferenceFromCourse,
  questionReferenceFromOutcome,
  questionVersionIdFor,
  type Question,
  type QuestionAnswer,
  type QuestionBankRequestState,
  type QuestionCourseReference,
  type QuestionCreateInput,
  type QuestionDifficulty,
  type QuestionEditorReferenceData,
  type ExamQuestionReference,
  type QuestionId,
  type QuestionListQuery,
  type QuestionListQueryInput,
  type QuestionListResponse,
  type QuestionOption,
  type QuestionOutcomeReference,
  type QuestionPublishInput,
  type QuestionSort,
  type QuestionStatus,
  type QuestionStatusCounts,
  type QuestionSuccessorInput,
  type QuestionType,
  type QuestionUpdateInput,
  type QuestionBulkActionInput,
  type QuestionBulkFailure,
  type QuestionBulkItemResult,
  type QuestionBulkRequest,
  type QuestionBulkResult,
  type QuestionBulkSuccess,
  type QuestionBulkTarget,
  type EditableQuestionStatus,
  type QuestionBulkFailureCode,
  type QuestionVersion
} from '../models/question.models';

const AUTHORIZED_QUESTION_ROLES = Object.freeze(['INSTRUCTOR', 'MEASUREMENT_SPECIALIST'] as const);
const QUESTIONS_PER_COURSE = 18;
const MAX_SEARCH_LENGTH = 120;
const QUESTION_PAGE_SIZE_MAX = 50;
const QUESTION_PAGE_MAX = MAX_PAGE;
const DEFAULT_PUBLISH_CHANGE_NOTE = 'Initial publication';

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
  readonly expectedVersion?: number;
}

export type QuestionBankErrorCode =
  | 'not-found'
  | 'unauthorized'
  | 'validation'
  | 'conflict'
  | 'not-editable';

export class QuestionBankError extends Error {
  override readonly name = 'QuestionBankError';

  constructor(
    readonly code: QuestionBankErrorCode,
    message: string,
    readonly id?: string
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type QuestionBankSaveStatus =
  | 'idle'
  | 'saving'
  | 'success'
  | 'error'
  | 'unauthorized'
  | 'conflict';

export interface QuestionBankSaveRequestState {
  readonly status: QuestionBankSaveStatus;
  readonly message?: string;
  readonly questionId?: QuestionId;
  readonly retryable?: boolean;
}
export type QuestionBankBulkStatus =
  | 'idle'
  | 'pending'
  | 'success'
  | 'partial'
  | 'error'
  | 'unauthorized';

export interface QuestionBankBulkRequestState {
  readonly status: QuestionBankBulkStatus;
  readonly message?: string;
  readonly retryable?: boolean;
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
const normalizeQuestionEnum = (value: unknown, supported: readonly string[]): string => {
  const token = toSafeToken(value);
  return supported.includes(token) ? token : '';
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
    grade: normalizeQuestionEnum(source['grade'], QUESTION_GRADES),
    difficulty: normalizeQuestionEnum(source['difficulty'], QUESTION_DIFFICULTIES),
    status: normalizeQuestionEnum(source['status'], QUESTION_STATUSES),
    type: normalizeQuestionEnum(source['type'], QUESTION_TYPES),
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

const cloneQuestionVersion = (version: QuestionVersion): QuestionVersion => deepFreeze({
  ...version,
  course: { ...version.course },
  outcome: { ...version.outcome },
  tags: [...version.tags],
  options: version.options.map((option) => ({ ...option })),
  answer: cloneQuestionAnswer(version.answer)
});

const cloneExamQuestionReference = (reference: ExamQuestionReference): ExamQuestionReference => Object.freeze({
  questionId: reference.questionId,
  version: reference.version,
  versionId: reference.versionId
});

const readExamQuestionReference = (value: unknown): ExamQuestionReference | null => {
  if (!isRecord(value)) return null;
  const questionId = value['questionId'];
  const version = value['version'];
  const versionId = value['versionId'];
  if (
    typeof questionId !== 'string' ||
    questionId.length === 0 ||
    typeof version !== 'number' ||
    !Number.isInteger(version) ||
    version <= 0 ||
    typeof versionId !== 'string' ||
    versionId.length === 0
  ) {
    return null;
  }
  return {
    questionId: asQuestionId(questionId),
    version,
    versionId: asQuestionVersionId(versionId)
  };
};

const normalizeChangeNote = (value: unknown, fallback = ''): string =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;

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
  readonly outcomes: readonly SeedLearningOutcome[];
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
    courses: Object.freeze(courses.sort(idSort)),
    outcomes: Object.freeze(seed.learningOutcomes.map((outcome) => ({
      ...outcome,
      prerequisiteOutcomeIds: [...outcome.prerequisiteOutcomeIds]
    })))
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
  private readonly audit: AuditPort | null;
  private readonly questionEntities = new Map<QuestionId, Question>();
  private readonly questionVersionEntities = new Map<QuestionId, Map<number, QuestionVersion>>();
  private readonly courseEntities = new Map<string, QuestionCourseReference>();
  private readonly outcomeEntities = new Map<string, QuestionOutcomeReference>();
  private readonly outcomeCourseIds = new Map<string, string>();
  private scenarioControls: MockScenarioControls = { ...DEFAULT_MOCK_SCENARIO };
  private questionSequence = 1;

  constructor(
    @Optional() transport: MockTransport | null = null,
    @Optional() audit: AuditPort | null = null
  ) {
    this.transport = transport ?? new MockTransport();
    this.audit = audit;
    const seed = createQuestionSeedData();
    for (const question of seed.questions) {
      const retained = cloneQuestion(question);
      this.questionEntities.set(question.id, retained);
      if (retained.status === 'published') {
        this.retainVersionSnapshot(this.createVersionSnapshot(
          retained,
          retained.updatedAt,
          'Seeded published version'
        ));
      }
    }
    for (const course of seed.courses) {
      this.courseEntities.set(String(course.id), Object.freeze({ ...course }));
    }
    for (const outcome of seed.outcomes) {
      const reference = questionReferenceFromOutcome(outcome);
      this.outcomeEntities.set(String(outcome.id), Object.freeze({ ...reference }));
      this.outcomeCourseIds.set(String(outcome.id), String(outcome.courseId));
    }
  }

  listQuestions(
    input: QuestionListQueryInput = {},
    options: QuestionBankRequestOptions = {}
  ): Observable<QuestionListResponse> {
    return defer(() => {
      const query = normalizeQuestionListQuery(input);
      const access = getAccess(options);
      const controls = this.controlsFor(options);
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
      const controls = this.controlsFor(options);
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
          const question = this.questionEntities.get(asQuestionId(String(id)));
          if (question === undefined || !access.courseIds.includes(String(question.courseId))) {
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

  getQuestionVersionHistory(
    id: QuestionId | string,
    options: QuestionBankRequestOptions = {}
  ): Observable<readonly QuestionVersion[]> {
    return defer(() => {
      const access = getAccess(options);
      const controls = this.controlsFor(options);
      const request = { method: 'GET' as const, url: `/question-bank/questions/${String(id)}/versions` };
      if (access === null) {
        return this.transport.execute(
          request,
          () => {
            throw new ApiTransportError('unauthorized', 1);
          },
          { ...controls, outcome: 'unauthorized' }
        ).pipe(map(({ body }) => body));
      }
      return this.transport.execute(
        request,
        () => {
          const question = this.questionEntities.get(asQuestionId(String(id)));
          if (question === undefined || !access.courseIds.includes(String(question.courseId))) {
            throw new QuestionBankError('not-found', 'The selected question is no longer available in this scope.', String(id));
          }
          const versions = this.questionVersionEntities.get(question.id);
          return Object.freeze(
            [...(versions?.values() ?? [])]
              .sort((left, right) => left.version - right.version)
              .map(cloneQuestionVersion)
          );
        },
        controls
      ).pipe(map(({ body }) => body));
    });
  }

  pinExamQuestionReference(
    reference: ExamQuestionReference,
    options: QuestionBankRequestOptions = {}
  ): Observable<ExamQuestionReference> {
    return defer(() => {
      const rawReference: Record<string, unknown> = isRecord(reference) ? reference : {};
      const questionId = typeof rawReference['questionId'] === 'string' ? rawReference['questionId'] : '';
      const versionId = typeof rawReference['versionId'] === 'string' ? rawReference['versionId'] : '';
      const request = {
        method: 'POST' as const,
        url: `/question-bank/questions/${questionId}/versions/${versionId}/exam-reference`,
        body: reference
      };
      const access = getAccess(options);
      const controls = this.controlsFor(options);
      if (access === null) {
        return this.transport.execute(
          request,
          () => {
            throw new QuestionBankError(
              'unauthorized',
              'You are not authorized to modify questions in the active course scope.'
            );
          },
          controls
        ).pipe(map(({ body }) => body));
      }

      const normalized = readExamQuestionReference(reference);
      if (normalized === null) {
        return this.transport.execute(
          request,
          () => {
            throw new QuestionBankError('validation', 'A question ID, positive version, and version ID are required.');
          },
          controls
        ).pipe(map(({ body }) => body));
      }

      const current = this.questionEntities.get(normalized.questionId);
      if (current === undefined) {
        return this.transport.execute(
          request,
          () => {
            throw new QuestionBankError(
              'not-found',
              'The selected question is no longer available in this scope.',
              String(normalized.questionId)
            );
          },
          controls
        ).pipe(map(({ body }) => body));
      }
      if (!access.courseIds.includes(String(current.courseId))) {
        return this.transport.execute(
          request,
          () => {
            throw new QuestionBankError(
              'unauthorized',
              'You are not authorized to modify questions in the active course scope.',
              String(normalized.questionId)
            );
          },
          controls
        ).pipe(map(({ body }) => body));
      }

      return this.transport.execute(
        request,
        () => {
          const snapshot = this.questionVersionEntities.get(normalized.questionId)?.get(normalized.version);
          if (
            snapshot === undefined ||
            snapshot.status !== 'published' ||
            snapshot.questionId !== normalized.questionId ||
            snapshot.versionId !== normalized.versionId
          ) {
            throw new QuestionBankError(
              'not-found',
              'The requested published question version is no longer available.',
              String(normalized.versionId)
            );
          }
          return cloneExamQuestionReference(normalized);
        },
        controls
      ).pipe(map(({ body }) => body));
    });
  }

  resolveExamQuestionReference(
    reference: ExamQuestionReference,
    options: QuestionBankRequestOptions = {}
  ): Observable<QuestionVersion> {
    return defer(() => {
      const rawReference: Record<string, unknown> = isRecord(reference) ? reference : {};
      const questionId = typeof rawReference['questionId'] === 'string' ? rawReference['questionId'] : '';
      const versionId = typeof rawReference['versionId'] === 'string' ? rawReference['versionId'] : '';
      const request = {
        method: 'GET' as const,
        url: `/question-bank/questions/${questionId}/versions/${versionId}`
      };
      const access = getAccess(options);
      const controls = this.controlsFor(options);
      if (access === null) {
        return this.transport.execute(
          request,
          () => {
            throw new ApiTransportError('unauthorized', 1);
          },
          { ...controls, outcome: 'unauthorized' }
        ).pipe(map(({ body }) => body));
      }

      const normalized = readExamQuestionReference(reference);
      if (normalized === null) {
        return this.transport.execute(
          request,
          () => {
            throw new QuestionBankError('not-found', 'The requested published question version is no longer available.');
          },
          controls
        ).pipe(map(({ body }) => body));
      }

      return this.transport.execute(
        request,
        () => {
          const snapshot = this.questionVersionEntities.get(normalized.questionId)?.get(normalized.version);
          if (
            snapshot === undefined ||
            snapshot.status !== 'published' ||
            snapshot.questionId !== normalized.questionId ||
            snapshot.versionId !== normalized.versionId ||
            !access.courseIds.includes(String(snapshot.courseId))
          ) {
            throw new QuestionBankError(
              'not-found',
              'The requested published question version is no longer available.',
              String(normalized.versionId)
            );
          }
          return cloneQuestionVersion(snapshot);
        },
        controls
      ).pipe(map(({ body }) => body));
    });
  }


  listCourseOptions(options: QuestionBankRequestOptions = {}): Observable<readonly QuestionCourseReference[]> {
    return defer(() => {
      const access = getAccess(options);
      const controls = this.controlsFor(options);
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
          [...this.courseEntities.values()]
            .filter((course) => access.courseIds.includes(String(course.id)))
            .map((course) => Object.freeze({ ...course }))
        ),
        controls
      ).pipe(map(({ body }) => body));
    });
  }

  listOutcomeOptions(
    courseId: string,
    options: QuestionBankRequestOptions = {}
  ): Observable<readonly QuestionOutcomeReference[]> {
    return defer(() => {
      const access = getAccess(options);
      const controls = this.controlsFor(options);
      const url = `/question-bank/courses/${String(courseId)}/outcomes`;
      if (access === null) {
        return this.transport.execute(
          { method: 'GET', url },
          () => Object.freeze([] as readonly QuestionOutcomeReference[]),
          { ...controls, outcome: 'unauthorized' }
        ).pipe(map(({ body }) => body));
      }
      return this.transport.execute(
        { method: 'GET', url },
        () => {
          if (!access.courseIds.includes(String(courseId)) || !this.courseEntities.has(String(courseId))) {
            throw new QuestionBankError('unauthorized', 'You are not authorized to view outcomes for this course.');
          }
          return Object.freeze(
            [...this.outcomeEntities.entries()]
              .filter(([id]) => this.outcomeCourseIds.get(id) === String(courseId))
              .map(([, outcome]) => Object.freeze({ ...outcome }))
          );
        },
        controls
      ).pipe(map(({ body }) => body));
    });
  }

  createQuestion(
    input: QuestionCreateInput,
    options: QuestionBankRequestOptions = {}
  ): Observable<Question> {
    return defer(() => {
      const access = getAccess(options);
      const controls = this.controlsFor(options);
      const request = { method: 'POST' as const, url: '/question-bank/questions', body: input };
      if (access === null) {
        return this.unauthorizedWrite(request, controls);
      }

      const requestedCourseId = this.readId(input, 'courseId');
      if (requestedCourseId !== null && !access.courseIds.includes(requestedCourseId)) {
        return this.unauthorizedWrite(request, controls);
      }
      const normalized = this.normalizePayload(input);
      if (!access.courseIds.includes(String(normalized.courseId))) {
        return this.unauthorizedWrite(request, controls);
      }

      return this.transport.execute(
        request,
        () => {
          const id = this.nextQuestionId(normalized.courseId);
          const timestamp = new Date().toISOString();
          const next = deepFreeze({
            id,
            createdAt: timestamp,
            updatedAt: timestamp,
            version: 1,
            ...normalized,
            course: Object.freeze({ ...this.courseEntities.get(String(normalized.courseId))! }),
            outcome: Object.freeze({ ...this.outcomeEntities.get(String(normalized.outcomeId))! })
          }) as Question;
          this.questionEntities.set(id, next);
          return cloneQuestion(next);
        },
        controls
      ).pipe(map(({ body }) => body));
    });
  }

  updateQuestion(
    id: QuestionId | string,
    input: QuestionUpdateInput,
    options: QuestionBankRequestOptions = {}
  ): Observable<Question> {
    return defer(() => {
      const access = getAccess(options);
      const controls = this.controlsFor(options);
      const request = { method: 'PATCH' as const, url: `/question-bank/questions/${String(id)}`, body: input };
      if (access === null) {
        return this.unauthorizedWrite(request, controls);
      }
      const current = this.questionEntities.get(asQuestionId(String(id)));
      if (current === undefined) {
        return this.transport.execute(
          request,
          () => {
            throw new QuestionBankError('not-found', 'The selected question is no longer available in this scope.', String(id));
          },
          controls
        ).pipe(map(({ body }) => body));
      }
      if (!access.courseIds.includes(String(current.courseId))) {
        return this.unauthorizedWrite(request, controls);
      }
      const requestedCourseId = this.readId(input, 'courseId');
      if (requestedCourseId !== null && !access.courseIds.includes(requestedCourseId)) {
        return this.unauthorizedWrite(request, controls);
      }
      if (current.status === 'published' || current.status === 'archived') {
        return this.transport.execute(
          request,
          () => {
            throw new QuestionBankError(
              'not-editable',
              'Published and archived questions are preview-only here. Create a new version instead of editing the published entity.',
              String(id)
            );
          },
          controls
        ).pipe(map(({ body }) => body));
      }
      this.assertExpectedVersion(current, options);
      const normalized = this.normalizePayload(input, current);
      if (!access.courseIds.includes(String(normalized.courseId))) {
        return this.unauthorizedWrite(request, controls);
      }

      return this.transport.execute(
        request,
        () => {
          const next = deepFreeze({
            ...current,
            ...normalized,
            id: current.id,
            createdAt: current.createdAt,
            updatedAt: new Date().toISOString(),
            version: current.version + 1,
            course: Object.freeze({ ...this.courseEntities.get(String(normalized.courseId))! }),
            outcome: Object.freeze({ ...this.outcomeEntities.get(String(normalized.outcomeId))! })
          }) as Question;
          this.questionEntities.set(current.id, next);
          return cloneQuestion(next);
        },
        controls
      ).pipe(map(({ body }) => body));
    });
  }

  bulkUpdateQuestions(
    request: QuestionBulkRequest,
    options: QuestionBankRequestOptions = {}
  ): Observable<QuestionBulkResult> {
    return defer(() => {
      const access = getAccess(options);
      const controls = this.controlsFor(options);
      const normalized = this.normalizeBulkRequest(request);
      const transportRequest = {
        method: 'PATCH' as const,
        url: '/question-bank/questions/bulk',
        body: normalized
      };
      if (access === null) {
        return this.transport.execute(
          transportRequest,
          () => {
            throw new QuestionBankError(
              'unauthorized',
              'You are not authorized to modify questions in the active course scope.'
            );
          },
          { ...controls, outcome: 'unauthorized' }
        ).pipe(map(({ body }) => body));
      }

      return this.transport.execute(
        transportRequest,
        () => {
          const results: QuestionBulkItemResult[] = [];
          for (const target of normalized.targets) {
            results.push(this.processBulkTarget(target, normalized.action, access, options));
          }
          return this.freezeBulkResult(results);
        },
        controls
      ).pipe(map(({ body }) => body));
    });
  }

  publishQuestion(
    id: QuestionId | string,
    input: QuestionPublishInput = {},
    options: QuestionBankRequestOptions = {}
  ): Observable<Question> {
    return defer(() => {
      const requestOptions = options;
      const note = normalizeChangeNote(input.changeNote, DEFAULT_PUBLISH_CHANGE_NOTE);
      const access = getAccess(requestOptions);
      const controls = this.controlsFor(requestOptions);
      const request = { method: 'POST' as const, url: `/question-bank/questions/${String(id)}/publish`, body: { changeNote: note } };
      if (access === null) return this.unauthorizedWrite(request, controls);
      const current = this.questionEntities.get(asQuestionId(String(id)));
      if (current === undefined) {
        return this.transport.execute(request, () => {
          throw new QuestionBankError('not-found', 'The selected question is no longer available in this scope.', String(id));
        }, controls).pipe(map(({ body }) => body));
      }
      if (!access.courseIds.includes(String(current.courseId))) return this.unauthorizedWrite(request, controls);
      this.assertExpectedVersion(current, requestOptions);
      if (current.status !== 'draft' && current.status !== 'review') {
        return this.transport.execute(request, () => {
          throw new QuestionBankError('not-editable', 'Only draft and review questions can be published.', String(id));
        }, controls).pipe(map(({ body }) => body));
      }
      return this.transport.execute(request, () => {
        const latest = this.questionEntities.get(current.id);
        if (latest === undefined) throw new QuestionBankError('not-found', 'The selected question is no longer available in this scope.', String(id));
        this.assertExpectedVersion(latest, requestOptions);
        if (latest.status !== 'draft' && latest.status !== 'review') {
          throw new QuestionBankError('not-editable', 'Only draft and review questions can be published.', String(id));
        }
        const publishedAt = new Date().toISOString();
        const next = deepFreeze({
          ...latest,
          status: 'published' as const,
          updatedAt: publishedAt
        }) as Question;
        this.retainVersionSnapshot(this.createVersionSnapshot(next, publishedAt, note));
        this.questionEntities.set(next.id, next);
        return cloneQuestion(next);
      }, controls).pipe(map(({ body }) => body));
    });
  }

  createQuestionSuccessor(
    id: QuestionId | string,
    input: QuestionSuccessorInput,
    options: QuestionBankRequestOptions = {}
  ): Observable<Question> {
    return defer(() => {
      const requestOptions = options;
      const note = normalizeChangeNote(input.changeNote);
      const access = getAccess(requestOptions);
      const controls = this.controlsFor(requestOptions);
      const request = { method: 'POST' as const, url: `/question-bank/questions/${String(id)}/successors`, body: { changeNote: note } };
      if (access === null) return this.unauthorizedWrite(request, controls);
      if (note.length === 0) {
        return this.transport.execute(request, () => {
          throw new QuestionBankError('validation', 'A nonblank change note is required to create a successor.', String(id));
        }, controls).pipe(map(({ body }) => body));
      }
      const current = this.questionEntities.get(asQuestionId(String(id)));
      if (current === undefined) {
        return this.transport.execute(request, () => {
          throw new QuestionBankError('not-found', 'The selected question is no longer available in this scope.', String(id));
        }, controls).pipe(map(({ body }) => body));
      }
      if (!access.courseIds.includes(String(current.courseId))) return this.unauthorizedWrite(request, controls);
      this.assertExpectedVersion(current, requestOptions);
      if (current.status !== 'published') {
        return this.transport.execute(request, () => {
          throw new QuestionBankError('not-editable', 'Only published questions can create an editable successor.', String(id));
        }, controls).pipe(map(({ body }) => body));
      }
      return this.transport.execute(request, () => {
        const latest = this.questionEntities.get(current.id);
        if (latest === undefined) throw new QuestionBankError('not-found', 'The selected question is no longer available in this scope.', String(id));
        this.assertExpectedVersion(latest, requestOptions);
        if (latest.status !== 'published') {
          throw new QuestionBankError('not-editable', 'Only published questions can create an editable successor.', String(id));
        }
        if (this.questionVersionEntities.get(latest.id)?.has(latest.version) !== true) {
          this.retainVersionSnapshot(this.createVersionSnapshot(latest, latest.updatedAt, 'Published version'));
        }
        const next = deepFreeze({
          ...latest,
          status: 'draft' as const,
          updatedAt: new Date().toISOString(),
          version: latest.version + 1
        }) as Question;
        this.questionEntities.set(next.id, next);
        return cloneQuestion(next);
      }, controls).pipe(map(({ body }) => body));
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

  getSnapshot(): Readonly<{
    readonly questions: readonly Question[];
    readonly versions: readonly QuestionVersion[];
  }> {
    const versions: QuestionVersion[] = [];
    for (const history of this.questionVersionEntities.values()) {
      versions.push(...history.values());
    }
    versions.sort((left, right) => left.versionId < right.versionId ? -1 : left.versionId > right.versionId ? 1 : 0);
    return Object.freeze({
      questions: Object.freeze([...this.questionEntities.values()].map(cloneQuestion)),
      versions: Object.freeze(versions.map(cloneQuestionVersion))
    });
  }

  private createVersionSnapshot(
    question: Question,
    publishedAt: string,
    changeNote: string
  ): QuestionVersion {
    return cloneQuestionVersion({
      ...question,
      questionId: question.id,
      versionId: questionVersionIdFor(question.id, question.version),
      publishedAt,
      changeNote: normalizeChangeNote(changeNote, DEFAULT_PUBLISH_CHANGE_NOTE)
    } as QuestionVersion);
  }

  private retainVersionSnapshot(snapshot: QuestionVersion): void {
    const history = this.questionVersionEntities.get(snapshot.questionId) ?? new Map<number, QuestionVersion>();
    history.set(snapshot.version, snapshot);
    this.questionVersionEntities.set(snapshot.questionId, history);
  }

  private buildListResponse(
    query: QuestionListQuery,
    access: NormalizedQuestionAccess
  ): QuestionListResponse {
    const scoped = [...this.questionEntities.values()].filter((question) =>
      access.courseIds.includes(String(question.courseId))
    );
    const searchAndFilters = scoped.filter((question) =>
      matchesSearch(question, query.search) &&
      (query.course.length === 0 || String(question.courseId) === query.course) &&
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

  private controlsFor(options: QuestionBankRequestOptions): Partial<MockScenarioControls> {
    const {
      session: _session,
      access: _access,
      expectedVersion: _expectedVersion,
      ...controls
    } = options;
    return { ...this.scenarioControls, ...controls };
  }

  private normalizeBulkRequest(request: QuestionBulkRequest): Readonly<{
    readonly targets: readonly QuestionBulkTarget[];
    readonly action: QuestionBulkActionInput;
  }> {
    if (!isRecord(request)) {
      throw new QuestionBankError('validation', 'Bulk question input must be an object.');
    }
    const rawTargets = request['targets'];
    if (!Array.isArray(rawTargets) || rawTargets.length === 0) {
      throw new QuestionBankError('validation', 'Select at least one question for a bulk operation.');
    }
    const targets: QuestionBulkTarget[] = [];
    const seenIds = new Set<string>();
    for (const rawTarget of rawTargets) {
      const target = isRecord(rawTarget) ? rawTarget : {};
      const rawId = typeof target['id'] === 'string' ? target['id'].trim() : '';
      if (seenIds.has(rawId)) {
        continue;
      }
      seenIds.add(rawId);
      const expectedVersion = typeof target['expectedVersion'] === 'number' &&
        Number.isInteger(target['expectedVersion']) &&
        target['expectedVersion'] > 0
        ? target['expectedVersion']
        : 0;
      targets.push(Object.freeze({
        id: asQuestionId(rawId),
        expectedVersion
      }));
    }

    const rawAction = isRecord(request['action']) ? request['action'] : null;
    if (rawAction === null) {
      throw new QuestionBankError('validation', 'A bulk tag or status action is required.');
    }
    const hasAddTags = rawAction['addTags'] !== undefined;
    const hasReplaceTags = rawAction['replaceTags'] !== undefined;
    if (hasAddTags && hasReplaceTags) {
      throw new QuestionBankError('validation', 'Choose tag addition or tag replacement, not both.');
    }
    const addTags = hasAddTags ? this.normalizeTags(rawAction['addTags']) : undefined;
    const replaceTags = hasReplaceTags ? this.normalizeTags(rawAction['replaceTags']) : undefined;
    const rawStatus = rawAction['status'];
    if (
      rawStatus !== undefined &&
      rawStatus !== 'draft' &&
      rawStatus !== 'review'
    ) {
      throw new QuestionBankError('validation', 'Bulk status must be draft or review.');
    }
    if (!hasAddTags && !hasReplaceTags && rawStatus === undefined) {
      throw new QuestionBankError('validation', 'A bulk tag or status action is required.');
    }

    const action: QuestionBulkActionInput = {
      ...(addTags === undefined ? {} : { addTags }),
      ...(replaceTags === undefined ? {} : { replaceTags }),
      ...(rawStatus === undefined ? {} : { status: rawStatus as EditableQuestionStatus })
    };
    return Object.freeze({
      targets: Object.freeze(targets),
      action: Object.freeze(action)
    });
  }

  private processBulkTarget(
    target: QuestionBulkTarget,
    action: QuestionBulkActionInput,
    access: NormalizedQuestionAccess,
    options: QuestionBankRequestOptions
  ): QuestionBulkItemResult {
    if (String(target.id).trim().length === 0 || target.expectedVersion <= 0) {
      return this.bulkFailure(target, 'validation', 'A question ID and positive expected version are required.');
    }
    const current = this.questionEntities.get(target.id);
    if (current === undefined) {
      return this.bulkFailure(target, 'not-found', 'The selected question is no longer available in this scope.');
    }
    if (!access.courseIds.includes(String(current.courseId))) {
      return this.bulkFailure(target, 'unauthorized', 'You are not authorized to modify this question in the active course scope.');
    }
    if (current.status === 'published' || current.status === 'archived') {
      return this.bulkFailure(
        target,
        'not-editable',
        'Published and archived questions are immutable and cannot receive bulk edits.'
      );
    }
    if (target.expectedVersion !== current.version) {
      return this.bulkFailure(
        target,
        'conflict',
        `Question ${current.id} changed elsewhere. Reload the question before trying again.`
      );
    }

    try {
      const nextTags = action.replaceTags !== undefined
        ? this.normalizeTags(action.replaceTags)
        : action.addTags !== undefined
          ? this.normalizeTags([...current.tags, ...action.addTags])
          : current.tags;
      const nextStatus = action.status ?? current.status;
      const tagsChanged = current.tags.length !== nextTags.length ||
        current.tags.some((tag, index) => tag !== nextTags[index]);
      if (!tagsChanged && nextStatus === current.status) {
        return this.bulkFailure(target, 'validation', 'The requested bulk action would not change this question.');
      }
      const before = cloneQuestion(current);
      const occurredAt = new Date().toISOString();
      const next = deepFreeze({
        ...current,
        tags: nextTags,
        status: nextStatus,
        updatedAt: occurredAt,
        version: current.version + 1
      }) as Question;
      this.questionEntities.set(current.id, next);
      this.recordBulkAudit(before, next, occurredAt, options);
      const after = cloneQuestion(next);
      return {
        kind: 'success',
        id: current.id,
        expectedVersion: target.expectedVersion,
        before,
        after,
        question: after
      };
    } catch (error: unknown) {
      const code: QuestionBulkFailureCode = error instanceof QuestionBankError ? error.code : 'validation';
      const message = error instanceof Error ? error.message : 'The bulk action could not be applied.';
      return this.bulkFailure(target, code, message);
    }
  }

  private bulkFailure(
    target: QuestionBulkTarget,
    code: QuestionBulkFailureCode,
    message: string
  ): QuestionBulkFailure {
    return Object.freeze({
      kind: 'failure',
      id: target.id,
      expectedVersion: target.expectedVersion,
      code,
      message
    });
  }

  private freezeBulkResult(results: readonly QuestionBulkItemResult[]): QuestionBulkResult {
    const items = Object.freeze([...results]);
    const successes = Object.freeze(
      results.filter((result): result is QuestionBulkSuccess => result.kind === 'success')
    );
    const failures = Object.freeze(
      results.filter((result): result is QuestionBulkFailure => result.kind === 'failure')
    );
    return deepFreeze({
      items,
      successes,
      failures,
      counts: Object.freeze({
        total: items.length,
        succeeded: successes.length,
        failed: failures.length
      })
    });
  }

  private recordBulkAudit(
    before: Question,
    after: Question,
    occurredAt: string,
    options: QuestionBankRequestOptions
  ): void {
    if (this.audit === null) {
      return;
    }
    const event: AuditEventDraft = {
      action: 'question.bulk-update',
      actor: String(options.session?.accountId ?? 'unknown-account'),
      targetType: 'question',
      targetId: String(after.id),
      occurredAt,
      before: {
        status: before.status,
        tags: before.tags,
        version: before.version,
        updatedAt: before.updatedAt
      },
      after: {
        status: after.status,
        tags: after.tags,
        version: after.version,
        updatedAt: after.updatedAt
      }
    };
    try {
      void Promise.resolve(this.audit.record(event)).catch(() => undefined);
    } catch {
      return;
    }
  }


  private unauthorizedWrite<TRequest extends { readonly method: 'POST' | 'PATCH'; readonly url: string; readonly body: unknown }>(
    request: TRequest,
    controls: Partial<MockScenarioControls>
  ): Observable<Question> {
    return this.transport.execute(
      request,
      () => {
        throw new QuestionBankError(
          'unauthorized',
          'You are not authorized to modify questions in the active course scope.'
        );
      },
      controls
    ).pipe(map(({ body }) => body));
  }

  private readId(input: unknown, key: string): string | null {
    if (!isRecord(input) || input[key] === undefined) {
      return null;
    }
    return typeof input[key] === 'string' && input[key].trim().length > 0 ? input[key].trim() : null;
  }

  private nextQuestionId(courseId: string): QuestionId {
    const course = this.courseEntities.get(String(courseId));
    const courseToken = normalizeSeedToken(course?.code) || normalizeSeedToken(courseId) || 'course';
    const identity = normalizeSeedToken(courseId).replace(/^COURSE-/i, '') || courseToken;
    let id: QuestionId;
    do {
      id = asQuestionId(
        `QUESTION-${courseToken}-${identity}-NEW-${String(this.questionSequence).padStart(4, '0')}`
      );
      this.questionSequence += 1;
    } while (this.questionEntities.has(id));
    return id;
  }

  private assertExpectedVersion(current: Question, options: QuestionBankRequestOptions): void {
    if (options.expectedVersion !== undefined && options.expectedVersion !== current.version) {
      throw new QuestionBankError(
        'conflict',
        `Question ${current.id} changed elsewhere. Reload the question before trying again.`,
        String(current.id)
      );
    }
  }

  private normalizePayload(
    input: unknown,
    current?: Question
  ): Readonly<{
    readonly courseId: Question['courseId'];
    readonly outcomeId: Question['outcomeId'];
    readonly title: string;
    readonly stem: string;
    readonly explanation: string;
    readonly tags: readonly string[];
    readonly difficulty: Question['difficulty'];
    readonly points: number;
    readonly grade: Question['grade'];
    readonly type: Question['type'];
    readonly options: readonly QuestionOption[];
    readonly answer: QuestionAnswer;
    readonly status: 'draft' | 'review';
  }> {
    if (!isRecord(input)) {
      throw new QuestionBankError('validation', 'Question input must be an object.');
    }
    const value = (key: string, fallback: unknown): unknown =>
      input[key] === undefined ? fallback : input[key];
    const courseIdValue = this.requiredText(value('courseId', current?.courseId), 'Course');
    const outcomeIdValue = this.requiredText(value('outcomeId', current?.outcomeId), 'Outcome');
    if (!this.courseEntities.has(courseIdValue)) {
      throw new QuestionBankError('validation', 'Select an available course.');
    }
    const outcome = this.outcomeEntities.get(outcomeIdValue);
    if (outcome === undefined || this.outcomeCourseIds.get(outcomeIdValue) !== courseIdValue) {
      throw new QuestionBankError('validation', 'The selected outcome must belong to the selected course.');
    }
    const title = this.requiredText(value('title', current?.title), 'Title');
    const stem = this.requiredText(value('stem', current?.stem), 'Stem');
    const explanation = this.requiredText(value('explanation', current?.explanation), 'Explanation');
    const tags = this.normalizeTags(value('tags', current?.tags));
    const difficultyValue = value('difficulty', current?.difficulty);
    const gradeValue = value('grade', current?.grade);
    const typeValue = value('type', current?.type);
    if (!(QUESTION_DIFFICULTIES as readonly string[]).includes(String(difficultyValue))) {
      throw new QuestionBankError('validation', 'Choose a supported difficulty.');
    }
    if (!(QUESTION_GRADES as readonly string[]).includes(String(gradeValue))) {
      throw new QuestionBankError('validation', 'Choose a supported grade.');
    }
    if (!(QUESTION_TYPES as readonly string[]).includes(String(typeValue))) {
      throw new QuestionBankError('validation', 'Choose a supported question type.');
    }
    const pointsValue = value('points', current?.points);
    if (typeof pointsValue !== 'number' || !Number.isFinite(pointsValue) || pointsValue <= 0) {
      throw new QuestionBankError('validation', 'Points must be a positive number.');
    }
    const normalizedAnswer = this.normalizeAnswer(
      typeValue as QuestionType,
      value('options', current?.options),
      value('answer', current?.answer)
    );
    const statusValue = value('status', current?.status ?? 'draft');
    if (statusValue !== 'draft' && statusValue !== 'review') {
      throw new QuestionBankError(
        'not-editable',
        'Only draft and review questions can be saved here. Published and archived questions require a later version workflow.'
      );
    }
    return deepFreeze({
      courseId: asCourseId(courseIdValue),
      outcomeId: asLearningOutcomeId(outcomeIdValue),
      title,
      stem,
      explanation,
      tags,
      difficulty: difficultyValue as Question['difficulty'],
      points: pointsValue,
      grade: gradeValue as Question['grade'],
      type: typeValue as QuestionType,
      options: normalizedAnswer.options,
      answer: normalizedAnswer.answer,
      status: statusValue
    });
  }

  private requiredText(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new QuestionBankError('validation', `${label} is required.`);
    }
    return value.trim();
  }

  private normalizeTags(value: unknown): readonly string[] {
    const raw = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(',')
        : null;
    if (raw === null || raw.some((tag) => typeof tag !== 'string')) {
      throw new QuestionBankError('validation', 'Tags must be a list of text tokens.');
    }
    const seen = new Set<string>();
    const tags: string[] = [];
    for (const token of raw as readonly string[]) {
      const normalized = token.trim();
      const key = normalized.toLocaleLowerCase();
      if (normalized.length > 0 && !seen.has(key)) {
        seen.add(key);
        tags.push(normalized);
      }
    }
    return Object.freeze(tags);
  }

  private normalizeAnswer(
    type: QuestionType,
    rawOptions: unknown,
    rawAnswer: unknown
  ): { readonly options: readonly QuestionOption[]; readonly answer: QuestionAnswer } {
    const answer = isRecord(rawAnswer) ? rawAnswer : null;
    if (type === 'single-choice' || type === 'multiple-choice') {
      const options = this.normalizeOptions(rawOptions);
      if (answer?.['kind'] !== 'choice' || !Array.isArray(answer['optionIds'])) {
        throw new QuestionBankError('validation', 'Choose at least one correct option.');
      }
      const optionIds = answer['optionIds'];
      if (optionIds.some((id) => typeof id !== 'string')) {
        throw new QuestionBankError('validation', 'Correct option IDs must be text.');
      }
      const selected = (optionIds as readonly string[]).map((id) => id.trim());
      const available = new Set(options.map((option) => option.id));
      const unique = [...new Set(selected)];
      if (unique.some((id) => id.length === 0 || !available.has(id))) {
        throw new QuestionBankError('validation', 'Choose correct options from the available options.');
      }
      if (type === 'single-choice' && unique.length !== 1) {
        throw new QuestionBankError('validation', 'Single-choice questions require exactly one correct option.');
      }
      if (type === 'multiple-choice' && unique.length < 1) {
        throw new QuestionBankError('validation', 'Multiple-choice questions require at least one correct option.');
      }
      return {
        options,
        answer: Object.freeze({ kind: 'choice', optionIds: Object.freeze(unique) })
      };
    }
    if (type === 'true-false') {
      if (answer?.['kind'] !== 'boolean' || typeof answer['value'] !== 'boolean') {
        throw new QuestionBankError('validation', 'Choose true or false for the answer.');
      }
      return {
        options: Object.freeze([
          Object.freeze({ id: 'true', label: 'True' }),
          Object.freeze({ id: 'false', label: 'False' })
        ]),
        answer: Object.freeze({ kind: 'boolean', value: answer['value'] })
      };
    }
    if (type === 'matching') {
      if (answer?.['kind'] !== 'matching' || !Array.isArray(answer['pairs']) || answer['pairs'].length < 2) {
        throw new QuestionBankError('validation', 'Matching questions require at least two pairs.');
      }
      const seen = new Set<string>();
      const pairs = answer['pairs'].map((pair, index) => {
        if (!isRecord(pair)) {
          throw new QuestionBankError('validation', `Matching pair ${index + 1} is invalid.`);
        }
        const prompt = this.requiredText(pair['prompt'], `Matching prompt ${index + 1}`);
        const response = this.requiredText(pair['answer'], `Matching answer ${index + 1}`);
        const key = prompt.toLocaleLowerCase();
        if (seen.has(key)) {
          throw new QuestionBankError('validation', 'Matching prompts must be unique.');
        }
        seen.add(key);
        return Object.freeze({ prompt, answer: response });
      });
      return {
        options: Object.freeze([]),
        answer: Object.freeze({ kind: 'matching', pairs: Object.freeze(pairs) })
      };
    }
    if (type === 'short-answer') {
      if (answer?.['kind'] !== 'short-answer' || !Array.isArray(answer['acceptedAnswers'])) {
        throw new QuestionBankError('validation', 'Add at least one accepted short answer.');
      }
      const seen = new Set<string>();
      const acceptedAnswers: string[] = [];
      for (const value of answer['acceptedAnswers']) {
        const accepted = this.requiredText(value, 'Accepted answer');
        const key = accepted.toLocaleLowerCase();
        if (seen.has(key)) {
          throw new QuestionBankError('validation', 'Accepted short answers must be unique.');
        }
        seen.add(key);
        acceptedAnswers.push(accepted);
      }
      if (acceptedAnswers.length === 0) {
        throw new QuestionBankError('validation', 'Add at least one accepted short answer.');
      }
      return {
        options: Object.freeze([]),
        answer: Object.freeze({ kind: 'short-answer', acceptedAnswers: Object.freeze(acceptedAnswers) })
      };
    }
    if (answer?.['kind'] !== 'essay') {
      throw new QuestionBankError('validation', 'Essay questions require rubric guidance.');
    }
    return {
      options: Object.freeze([]),
      answer: Object.freeze({
        kind: 'essay',
        rubricHint: this.requiredText(answer['rubricHint'], 'Rubric hint')
      })
    };
  }

  private normalizeOptions(value: unknown): readonly QuestionOption[] {
    if (!Array.isArray(value) || value.length === 0) {
      throw new QuestionBankError('validation', 'Add at least one answer option.');
    }
    const ids = new Set<string>();
    const labels = new Set<string>();
    const options = value.map((option, index) => {
      if (!isRecord(option)) {
        throw new QuestionBankError('validation', `Option ${index + 1} is invalid.`);
      }
      const id = this.requiredText(option['id'], `Option ${index + 1} ID`);
      const label = this.requiredText(option['label'], `Option ${index + 1}`);
      const labelKey = label.toLocaleLowerCase();
      if (ids.has(id) || labels.has(labelKey)) {
        throw new QuestionBankError('validation', 'Option IDs and labels must be unique.');
      }
      ids.add(id);
      labels.add(labelKey);
      return Object.freeze({ id, label });
    });
    return Object.freeze(options);
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
  private readonly writableOutcomeOptions = signal<readonly QuestionOutcomeReference[]>([]);
  private readonly writableSaveRequestState = signal<QuestionBankSaveRequestState>({ status: 'idle' });
  private readonly writableBulkRequestState = signal<QuestionBankBulkRequestState>({ status: 'idle' });
  private readonly writableBulkResult = signal<QuestionBulkResult | null>(null);
  private readonly writableVersionHistory = signal<readonly QuestionVersion[]>([]);
  private lastQuery: QuestionListQuery = normalizeQuestionListQuery();

  readonly requestState: Signal<QuestionBankRequestState> = this.writableRequestState.asReadonly();
  readonly pageResult: Signal<QuestionListResponse | null> = this.writablePageResult.asReadonly();
  readonly result: Signal<QuestionListResponse | null> = this.pageResult;
  readonly selectedId: Signal<QuestionId | null> = this.writableSelectedId.asReadonly();
  readonly selectedQuestion: Signal<Question | null> = this.writableSelectedQuestion.asReadonly();
  readonly selectedEntity: Signal<Question | null> = this.selectedQuestion;
  readonly selectionNotice: Signal<string> = this.writableSelectionNotice.asReadonly();
  readonly courseOptions: Signal<readonly QuestionCourseReference[]> = this.writableCourseOptions.asReadonly();
  readonly outcomeOptions: Signal<readonly QuestionOutcomeReference[]> = this.writableOutcomeOptions.asReadonly();
  readonly saveRequestState: Signal<QuestionBankSaveRequestState> = this.writableSaveRequestState.asReadonly();
  readonly saveState: Signal<QuestionBankSaveRequestState> = this.saveRequestState;
  readonly bulkRequestState: Signal<QuestionBankBulkRequestState> = this.writableBulkRequestState.asReadonly();
  readonly bulkState: Signal<QuestionBankBulkRequestState> = this.bulkRequestState;
  readonly bulkResult: Signal<QuestionBulkResult | null> = this.writableBulkResult.asReadonly();
  readonly versionHistory: Signal<readonly QuestionVersion[]> = this.writableVersionHistory.asReadonly();
  readonly saveFeedback = computed(() => this.saveRequestState().message ?? '');
  readonly editorReferences = computed<QuestionEditorReferenceData>(() => ({
    courses: this.courseOptions(),
    outcomes: this.outcomeOptions()
  }));
  readonly statusCounts = computed<QuestionStatusCounts>(() =>
    this.pageResult()?.statusCounts ?? EMPTY_QUESTION_STATUS_COUNTS
  );
  readonly total = computed(() => this.pageResult()?.total ?? 0);
  readonly currentPage = computed(() => this.pageResult()?.page ?? DEFAULT_QUESTION_PAGE);
  readonly totalPages = computed(() => this.pageResult()?.totalPages ?? 0);
  readonly errorMessage = computed(() => this.requestState().message ?? '');
  readonly bulkFeedback = computed(() => this.bulkRequestState().message ?? '');

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
        const status = error instanceof QuestionBankError && error.code === 'unauthorized'
          ? 'unauthorized'
          : normalized.kind === 'unauthorized' ? 'unauthorized' : 'error';
        this.writablePageResult.set(null);
        this.writableRequestState.set({
          status,
          message: error instanceof QuestionBankError ? error.message : normalized.userMessage
        });
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
        this.setSelectedQuestion(question);
      }),
      map((question) => question),
      catchError((error: unknown) => {
        const normalizedError = normalizeApplicationError(error);
        if (
          (error instanceof QuestionBankError && error.code === 'unauthorized') ||
          normalizedError.kind === 'unauthorized'
        ) {
          this.writableRequestState.set({
            status: 'unauthorized',
            message: error instanceof QuestionBankError ? error.message : normalizedError.userMessage
          });
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

  loadOutcomeOptions(
    courseId: string | null | undefined,
    options: QuestionBankRequestOptions = {}
  ): Observable<readonly QuestionOutcomeReference[]> {
    if (typeof courseId !== 'string' || courseId.trim().length === 0) {
      this.writableOutcomeOptions.set([]);
      return of([]);
    }
    return defer(() => this.repository.listOutcomeOptions(courseId.trim(), {
      ...this.sessionOptions(),
      ...options
    })).pipe(
      tap((outcomes) => this.writableOutcomeOptions.set(outcomes))
    );
  }

  createQuestion(
    input: QuestionCreateInput,
    options: QuestionBankRequestOptions = {}
  ): Observable<Question> {
    return this.writeQuestion(() => this.repository.createQuestion(input, {
      ...this.sessionOptions(),
      ...options
    }));
  }

  updateQuestion(
    id: QuestionId | string,
    input: QuestionUpdateInput,
    options: QuestionBankRequestOptions = {}
  ): Observable<Question> {
    return this.writeQuestion(() => this.repository.updateQuestion(id, input, {
      ...this.sessionOptions(),
      ...options
    }));
  }

  bulkUpdateQuestions(
    request: QuestionBulkRequest,
    options: QuestionBankRequestOptions = {}
  ): Observable<QuestionBulkResult> {
    const previousSelected = this.writableSelectedQuestion();
    const requestOptions = {
      ...this.sessionOptions(),
      ...options
    };
    this.writableBulkRequestState.set({ status: 'pending' });
    this.writableBulkResult.set(null);
    return defer(() => this.repository.bulkUpdateQuestions(request, requestOptions)).pipe(
      switchMap((result) => {
        this.writableBulkResult.set(result);
        return defer(() => this.repository.listQuestions(this.lastQuery, requestOptions)).pipe(
          tap((response) => this.applyBulkRefresh(response, result, previousSelected)),
          map(() => result)
        );
      }),
      tap((result) => {
        const { succeeded, failed } = result.counts;
        this.writableBulkRequestState.set({
          status: failed === 0 ? 'success' : 'partial',
          message: failed === 0
            ? `${succeeded} question${succeeded === 1 ? '' : 's'} updated successfully.`
            : `${succeeded} question${succeeded === 1 ? '' : 's'} updated; ${failed} failed.`
        });
      }),
      catchError((error: unknown) => {
        const normalized = normalizeApplicationError(error);
        const unauthorized = error instanceof QuestionBankError && error.code === 'unauthorized' ||
          normalized.kind === 'unauthorized';
        this.writableBulkRequestState.set({
          status: unauthorized ? 'unauthorized' : 'error',
          message: error instanceof QuestionBankError ? error.message : normalized.userMessage,
          retryable: normalized.retryable
        });
        return throwError(() => error);
      })
    );
  }

  publishQuestion(
    id: QuestionId | string,
    input: QuestionPublishInput = {},
    options: QuestionBankRequestOptions = {}
  ): Observable<Question> {
    return this.writeQuestion(
      () => this.repository.publishQuestion(id, input, {
        ...this.sessionOptions(),
        ...options
      }),
      'Question published successfully.'
    );
  }

  createQuestionSuccessor(
    id: QuestionId | string,
    input: QuestionSuccessorInput,
    options: QuestionBankRequestOptions = {}
  ): Observable<Question> {
    return this.writeQuestion(
      () => this.repository.createQuestionSuccessor(id, input, {
        ...this.sessionOptions(),
        ...options
      }),
      'New editable question version created successfully.'
    );
  }


  getQuestionVersionHistory(
    id: QuestionId | string,
    options: QuestionBankRequestOptions = {}
  ): Observable<readonly QuestionVersion[]> {
    return defer(() => this.repository.getQuestionVersionHistory(id, {
      ...this.sessionOptions(),
      ...options
    }));
  }

  loadQuestionVersionHistory(
    id: QuestionId | string,
    options: QuestionBankRequestOptions = {}
  ): Observable<readonly QuestionVersion[]> {
    return this.getQuestionVersionHistory(id, options).pipe(
      tap((history) => this.writableVersionHistory.set(history)),
      catchError((error: unknown) => {
        this.writableVersionHistory.set([]);
        return throwError(() => error);
      })
    );
  }


  setMockScenario(controls: Partial<MockScenarioControls>): void {
    this.repository.setMockScenario(controls);
  }

  resetMockScenario(): void {
    this.repository.resetMockScenario();
  }

  private applyBulkRefresh(
    response: QuestionListResponse,
    result: QuestionBulkResult,
    selectedBefore: Question | null
  ): void {
    this.lastQuery = response.query;
    this.writablePageResult.set(response);
    this.writableRequestState.set({
      status: response.total === 0 ? 'empty' : 'success'
    });
    if (selectedBefore === null) {
      return;
    }
    const selectedResult = result.items.find((item) => item.id === selectedBefore.id);
    if (selectedResult?.kind === 'success') {
      this.setSelectedQuestion(selectedResult.after);
      return;
    }
    if (
      selectedResult?.kind === 'failure' &&
      (selectedResult.code === 'not-found' || selectedResult.code === 'unauthorized')
    ) {
      this.clearSelection('Selection cleared because the question is missing or outside the active scope.');
      return;
    }
    const refreshed = response.items.find((question) => question.id === selectedBefore.id);
    this.setSelectedQuestion(refreshed ?? selectedBefore);
  }

  private writeQuestion(
    factory: () => Observable<Question>,
    successMessage = 'Question saved successfully.'
  ): Observable<Question> {
    const previousSelected = this.writableSelectedQuestion();
    this.writableSaveRequestState.set({ status: 'saving' });
    return defer(factory).pipe(
      tap((question) => {
        this.setSelectedQuestion(question);
        this.mergeSavedQuestion(question, previousSelected);
        this.writableSaveRequestState.set({
          status: 'success',
          message: successMessage,
          questionId: question.id
        });
      }),
      catchError((error: unknown) => {
        const normalized = normalizeApplicationError(error);
        const domain = error instanceof QuestionBankError ? error : null;
        const status: QuestionBankSaveStatus =
          domain?.code === 'conflict' || normalized.kind === 'conflict'
            ? 'conflict'
            : domain?.code === 'unauthorized' || normalized.kind === 'unauthorized'
              ? 'unauthorized'
              : 'error';
        const message = domain?.message ?? normalized.userMessage;
        this.writableSaveRequestState.set({
          status,
          message,
          questionId: domain?.id === undefined ? undefined : asQuestionId(domain.id),
          retryable: normalized.retryable || status === 'conflict'
        });
        return throwError(() => error);
      })
    );
  }

  private setSelectedQuestion(question: Question): void {
    this.writableSelectedId.set(question.id);
    this.writableSelectedQuestion.set(cloneQuestion(question));
    this.writableSelectionNotice.set('');
  }

  private mergeSavedQuestion(question: Question, selectedBeforeSave: Question | null = null): void {
    const current = this.writablePageResult();
    if (current === null) {
      return;
    }
    const query = current.query;
    const existingIndex = current.items.findIndex((item) => item.id === question.id);
    const previous = existingIndex < 0
      ? selectedBeforeSave?.id === question.id ? selectedBeforeSave : undefined
      : current.items[existingIndex];
    const beforeIncluded = previous !== undefined && this.matchesListQuery(previous, query);
    const afterIncluded = this.matchesListQuery(question, query);
    const pageItems = [...current.items];
    if (existingIndex >= 0) {
      pageItems.splice(existingIndex, 1);
    }
    if (afterIncluded) {
      pageItems.push(question);
    }
    const total = current.total + Number(afterIncluded) - Number(beforeIncluded);
    const counts: Record<QuestionStatus, number> = {
      ...current.statusCounts
    };
    const beforeCounted = previous !== undefined && this.matchesCountQuery(previous, query);
    const afterCounted = this.matchesCountQuery(question, query);
    if (beforeCounted) {
      counts[previous!.status] = Math.max(0, counts[previous!.status] - 1);
    }
    if (afterCounted) {
      counts[question.status] += 1;
    }
    const sorted = pageItems.sort((left, right) => compareQuestions(left, right, query.sort));
    const totalPages = total === 0 ? 0 : Math.ceil(total / query.pageSize);
    const page = totalPages === 0 ? 1 : Math.min(current.page, totalPages);
    const offset = totalPages === 0 ? 0 : (page - 1) * query.pageSize;
    this.writablePageResult.set(
      freezeResponse(sorted.slice(offset, offset + query.pageSize), total, page, query.pageSize, totalPages, query, counts)
    );
  }

  private matchesListQuery(question: Question, query: QuestionListQuery): boolean {
    return this.matchesCountQuery(question, query) &&
      (query.status.length === 0 || question.status === query.status);
  }

  private matchesCountQuery(question: Question, query: QuestionListQuery): boolean {
    return matchesSearch(question, query.search) &&
      (query.course.length === 0 || String(question.courseId) === query.course) &&
      (query.grade.length === 0 || question.grade === query.grade) &&
      (query.difficulty.length === 0 || question.difficulty === query.difficulty) &&
      (query.type.length === 0 || question.type === query.type);
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
