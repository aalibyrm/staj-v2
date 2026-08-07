import type { Route, Routes } from '@angular/router';

import {
  authGuard,
  ROUTE_CAPABILITIES_DATA_KEY,
  type RouteCapabilitiesData
} from '../../core/auth/auth.guard';
import { ROUTE_CAPABILITIES } from '../../core/auth/authorization';

const loadDataScopeDashboard = () =>
  import('./components/data-scope-dashboard.component').then(
    ({ DataScopeDashboardComponent }) => DataScopeDashboardComponent
  );
const loadOutcomeListEditor = () =>
  import('../learning-domain/components/outcome-list-editor.component').then(
    ({ OutcomeListEditorComponent }) => OutcomeListEditorComponent
  );
const loadOutcomeGraph = () =>
  import('../learning-domain/components/outcome-graph.component').then(
    ({ OutcomeGraphComponent }) => OutcomeGraphComponent
  );
const loadCourseContentCatalog = () =>
  import('../learning-domain/components/course-content-catalog.component').then(
    ({ CourseContentCatalogComponent }) => CourseContentCatalogComponent
  );
const loadQuestionBank = () =>
  import('../question-bank/components/question-bank.component').then(
    ({ QuestionBankComponent }) => QuestionBankComponent
  );
const loadExamBuilder = () =>
  import('../exam-builder/components/exam-builder.component').then(
    ({ ExamBuilderComponent }) => ExamBuilderComponent
  );
const loadExamSession = () =>
  import('../exam-session/components/exam-session.component').then(
    ({ ExamSessionComponent }) => ExamSessionComponent
  );
const loadRubricGrader = () =>
  import('../grading/components/rubric-grader.component').then(
    ({ RubricGraderComponent }) => RubricGraderComponent
  );
const loadAuditLog = () =>
  import('../audit/components/audit-log.component').then(
    ({ AuditLogComponent }) => AuditLogComponent
  );


const loadRoutePlaceholder = () =>
  import('../../shared/components/route-placeholder.component').then(
    ({ RoutePlaceholderComponent }) => RoutePlaceholderComponent
  );

const placeholderRoute = (
  path: string,
  title: string,
  capabilities: RouteCapabilitiesData
): Route => ({
  path,
  pathMatch: 'full',
  canMatch: [authGuard],
  data: {
    title,
    [ROUTE_CAPABILITIES_DATA_KEY]: capabilities
  },
  loadComponent: loadRoutePlaceholder
});

export const adaptiveLearningRoutes: Routes = [
  {
    path: 'learning/dashboard',
    pathMatch: 'full',
    canMatch: [authGuard],
    data: {
      title: 'Learning dashboard',
      [ROUTE_CAPABILITIES_DATA_KEY]: [
        ROUTE_CAPABILITIES.studentLearning,
        ROUTE_CAPABILITIES.instructorTeaching,
        ROUTE_CAPABILITIES.measurementWorkspace,
        ROUTE_CAPABILITIES.programWorkspace,
        ROUTE_CAPABILITIES.observerReports,
        ROUTE_CAPABILITIES.platformAdministration
      ]
    },
    loadComponent: loadDataScopeDashboard
  },
  {
    path: 'courses',
    pathMatch: 'full',
    canMatch: [authGuard],
    data: {
      title: 'Courses',
      [ROUTE_CAPABILITIES_DATA_KEY]: [
        ROUTE_CAPABILITIES.studentLearning,
        ROUTE_CAPABILITIES.instructorTeaching,
        ROUTE_CAPABILITIES.programWorkspace
      ]
    },
    loadComponent: loadCourseContentCatalog
  },
  placeholderRoute('courses/:id/path', 'Course path', [
    ROUTE_CAPABILITIES.studentLearning,
    ROUTE_CAPABILITIES.instructorTeaching
  ]),
  {
    path: 'outcomes',
    pathMatch: 'full',
    canMatch: [authGuard],
    data: {
      title: 'Outcomes',
      [ROUTE_CAPABILITIES_DATA_KEY]: [ROUTE_CAPABILITIES.programWorkspace]
    },
    loadComponent: loadOutcomeListEditor
  },
  {
    path: 'outcomes/map',
    pathMatch: 'full',
    canMatch: [authGuard],
    data: {
      title: 'Outcomes map',
      [ROUTE_CAPABILITIES_DATA_KEY]: [
        ROUTE_CAPABILITIES.instructorTeaching,
        ROUTE_CAPABILITIES.programWorkspace,
        ROUTE_CAPABILITIES.platformAdministration
      ]
    },
    loadComponent: loadOutcomeGraph
  },
{
    path: 'question-bank',
    pathMatch: 'full',
    canMatch: [authGuard],
    data: {
      title: 'Question bank',
      [ROUTE_CAPABILITIES_DATA_KEY]: [
        ROUTE_CAPABILITIES.instructorTeaching,
        ROUTE_CAPABILITIES.measurementWorkspace
      ]
    },
    loadComponent: loadQuestionBank
  },
  placeholderRoute('questions/:id', 'Question', [
    ROUTE_CAPABILITIES.instructorTeaching,
    ROUTE_CAPABILITIES.measurementWorkspace
  ]),
  {
    path: 'exams/new',
    pathMatch: 'full',
    canMatch: [authGuard],
    data: {
      title: 'Exam builder',
      [ROUTE_CAPABILITIES_DATA_KEY]: [
        ROUTE_CAPABILITIES.instructorTeaching,
        ROUTE_CAPABILITIES.measurementWorkspace,
        ROUTE_CAPABILITIES.programWorkspace
      ]
    },
    loadComponent: loadExamBuilder
  },
  {
    path: 'exams/:id/edit',
    pathMatch: 'full',
    canMatch: [authGuard],
    data: {
      title: 'Edit exam',
      [ROUTE_CAPABILITIES_DATA_KEY]: [
        ROUTE_CAPABILITIES.instructorTeaching,
        ROUTE_CAPABILITIES.measurementWorkspace,
        ROUTE_CAPABILITIES.programWorkspace
      ]
    },
    loadComponent: loadExamBuilder
  },
  placeholderRoute('exams', 'Exams', [
    ROUTE_CAPABILITIES.instructorTeaching,
    ROUTE_CAPABILITIES.measurementWorkspace,
    ROUTE_CAPABILITIES.programWorkspace
  ]),
  {
    path: 'exam-session/:token',
    pathMatch: 'full',
    canMatch: [authGuard],
    data: {
      title: 'Exam session',
      [ROUTE_CAPABILITIES_DATA_KEY]: [ROUTE_CAPABILITIES.studentLearning]
    },
    loadComponent: loadExamSession
  },
  placeholderRoute('grading', 'Grading', [ROUTE_CAPABILITIES.instructorTeaching]),
  {
    path: 'grading/:attemptId',
    pathMatch: 'full',
    canMatch: [authGuard],
    data: {
      title: 'Grading attempt',
      [ROUTE_CAPABILITIES_DATA_KEY]: [ROUTE_CAPABILITIES.instructorTeaching]
    },
    loadComponent: loadRubricGrader
  },
  placeholderRoute('student/:id/analytics', 'Student analytics', [
    ROUTE_CAPABILITIES.studentLearning,
    ROUTE_CAPABILITIES.instructorTeaching,
    ROUTE_CAPABILITIES.programWorkspace
  ]),
  placeholderRoute('cohort-analytics', 'Cohort analytics', [
    ROUTE_CAPABILITIES.instructorTeaching,
    ROUTE_CAPABILITIES.measurementWorkspace,
    ROUTE_CAPABILITIES.programWorkspace,
    ROUTE_CAPABILITIES.observerReports
  ]),
  placeholderRoute('item-analysis', 'Item analysis', [
    ROUTE_CAPABILITIES.instructorTeaching,
    ROUTE_CAPABILITIES.measurementWorkspace
  ]),
  {
    path: 'audit-log',
    pathMatch: 'full',
    canMatch: [authGuard],
    data: {
      title: 'Audit log',
      [ROUTE_CAPABILITIES_DATA_KEY]: [
        ROUTE_CAPABILITIES.measurementWorkspace,
        ROUTE_CAPABILITIES.programWorkspace,
        ROUTE_CAPABILITIES.observerReports,
        ROUTE_CAPABILITIES.platformAdministration
      ]
    },
    loadComponent: loadAuditLog
  },
];
