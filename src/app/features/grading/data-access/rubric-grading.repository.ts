import { Inject, Injectable, Optional } from '@angular/core';
import { defer, map, Observable, of, timer } from 'rxjs';

import {
  DEFAULT_MOCK_SCENARIO,
  MockTransport,
  type MockScenarioControls
} from '../../../core/api/mock-transport';
import {
  createRubricGrading,
  RubricDomainError,
  type RubricGrading
} from '../models/rubric.models';

export type RubricGradingReadOptions = Readonly<Partial<MockScenarioControls> & {
  readonly empty?: boolean;
}>;

export type RubricGradingRepositorySnapshot = Readonly<{
  readonly grading: RubricGrading | null;
  readonly attemptId: string;
}>;

export class RubricGradingRepositoryError extends Error {
  override readonly name = 'RubricGradingRepositoryError';

  constructor(
    readonly code: 'validation' | 'not-found',
    message: string,
    readonly target?: string
  ) {
    super(message);
  }
}

const nonblank = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const normalizeAttemptId = (value: unknown): string => {
  if (!nonblank(value)) {
    throw new RubricGradingRepositoryError('validation', 'An attempt id is required.', 'attemptId');
  }
  return value.trim();
};

/** Demo instructor scope grant, duplicated per convention (see scoped-data.facade.spec.ts) to avoid importing core/auth from a data-access fixture. */
const DEMO_SCOPED_STUDENT_IDS = Object.freeze([
  'STUDENT-MATH101-2025-FALL-A-01',
  'STUDENT-MATH101-2025-FALL-A-02',
  'STUDENT-MATH101-2025-FALL-A-03'
] as const);

/** Deterministically maps an attempt id to one of the demo-scoped student ids so the fixture stays reachable by the demo instructor. */
const selectDemoScopedStudentId = (attemptId: string): (typeof DEMO_SCOPED_STUDENT_IDS)[number] => {
  const charCodeSum = Array.from(attemptId).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return DEMO_SCOPED_STUDENT_IDS[charCodeSum % DEMO_SCOPED_STUDENT_IDS.length];
};

const studentLabelFor = (studentId: string): string => `Student ${studentId.split('-').slice(-2).join('-')}`;

const createNeutralFixture = (attemptId: string): RubricGrading => {
  const studentId = selectDemoScopedStudentId(attemptId);
  return createRubricGrading({
  context: {
    attemptId,
    studentId,
    studentName: studentLabelFor(studentId),
    examId: 'written-response-assessment',
    examTitle: 'Written response assessment',
    courseTitle: 'Reasoning practice',
    questionNumber: 1,
    questionCount: 1
  },
  responsePreview: {
    questionId: `response-${attemptId}`,
    questionPrompt: 'Explain the reasoning behind your response.',
    responseText: 'The response presents a claim and supports it with relevant evidence.',
    attachmentCount: 0
  },
  rubric: {
    id: 'written-response-rubric',
    title: 'Written response rubric',
    description: 'Use each criterion to evaluate the submitted response.',
    maximumPoints: 100,
    criteria: [
      {
        id: 'criterion-reasoning',
        title: 'Reasoning',
        description: 'Assesses the clarity and sequence of the response reasoning.',
        weight: 0.4,
        maxScore: 4,
        levels: [
          { id: 'level-0', label: 'Not demonstrated', description: 'No assessable evidence.', score: 0 },
          { id: 'level-1', label: 'Emerging', description: 'Reasoning is only partly established.', score: 1 },
          { id: 'level-2', label: 'Developing', description: 'Reasoning is present with gaps.', score: 2 },
          { id: 'level-3', label: 'Proficient', description: 'Reasoning is clear and mostly complete.', score: 3 },
          { id: 'level-4', label: 'Advanced', description: 'Reasoning is precise and comprehensive.', score: 4 }
        ]
      },
      {
        id: 'criterion-evidence',
        title: 'Evidence',
        description: 'Assesses relevance and use of supporting evidence.',
        weight: 0.35,
        maxScore: 4,
        levels: [
          { id: 'level-0', label: 'Not demonstrated', description: 'No supporting evidence is present.', score: 0 },
          { id: 'level-1', label: 'Emerging', description: 'Evidence is limited or unclear.', score: 1 },
          { id: 'level-2', label: 'Developing', description: 'Evidence is partly relevant.', score: 2 },
          { id: 'level-3', label: 'Proficient', description: 'Evidence generally supports the response.', score: 3 },
          { id: 'level-4', label: 'Advanced', description: 'Evidence is relevant and well integrated.', score: 4 }
        ]
      },
      {
        id: 'criterion-communication',
        title: 'Communication',
        description: 'Assesses organization and readable expression.',
        weight: 0.25,
        maxScore: 4,
        levels: [
          { id: 'level-0', label: 'Not demonstrated', description: 'Meaning cannot be assessed.', score: 0 },
          { id: 'level-1', label: 'Emerging', description: 'Expression needs substantial clarification.', score: 1 },
          { id: 'level-2', label: 'Developing', description: 'Expression is understandable in parts.', score: 2 },
          { id: 'level-3', label: 'Proficient', description: 'Expression is organized and readable.', score: 3 },
          { id: 'level-4', label: 'Advanced', description: 'Expression is concise, coherent, and polished.', score: 4 }
        ]
      }
    ]
  },
  selectedLevelIds: {},
  criterionComments: {},
  overallFeedback: ''
  });
};

@Injectable({ providedIn: 'root' })
export class RubricGradingRepository {
  private readonly transport: MockTransport;
  private scenarioControls: MockScenarioControls = Object.freeze({ ...DEFAULT_MOCK_SCENARIO });

  constructor(@Optional() @Inject(MockTransport) transport: MockTransport | null = null) {
    this.transport = transport ?? new MockTransport();
  }

  getByAttemptId(attemptId: string, options: RubricGradingReadOptions = {}): Observable<RubricGrading | null> {
    return defer(() => {
      const normalizedAttemptId = normalizeAttemptId(attemptId);
      const controls = { ...this.scenarioControls, ...options };
      if (options.empty === true) {
        return timer(controls.latencyMs ?? 0).pipe(map(() => null));
      }
      const successBodyFactory = (): RubricGrading => createNeutralFixture(normalizedAttemptId);
      return this.transport.execute(
        {
          method: 'GET',
          url: `/grading-attempts/${encodeURIComponent(normalizedAttemptId)}`
        },
        successBodyFactory,
        controls
      ).pipe(map((response) => response.body));
    });
  }

  read(attemptId: string, options: RubricGradingReadOptions = {}): Observable<RubricGrading | null> {
    return this.getByAttemptId(attemptId, options);
  }

  load(attemptId: string, options: RubricGradingReadOptions = {}): Observable<RubricGrading | null> {
    return this.getByAttemptId(attemptId, options);
  }

  setMockScenario(controls: Partial<MockScenarioControls>): void {
    if (controls === null || typeof controls !== 'object' || Array.isArray(controls)) {
      throw new TypeError('Mock scenario controls must be an object.');
    }
    this.scenarioControls = Object.freeze({ ...this.scenarioControls, ...controls });
  }

  resetMockScenario(): void {
    this.scenarioControls = Object.freeze({ ...DEFAULT_MOCK_SCENARIO });
  }

  getMockScenario(): Readonly<MockScenarioControls> {
    return Object.freeze({ ...this.scenarioControls });
  }

  fixtureForAttempt(attemptId: string): RubricGrading {
    return createNeutralFixture(normalizeAttemptId(attemptId));
  }
}

export { createNeutralFixture };
export { RubricDomainError as RubricGradingDomainError };
