import type { Route, Routes } from '@angular/router';

const loadRoutePlaceholder = () =>
  import('../../shared/components/route-placeholder.component').then(
    ({ RoutePlaceholderComponent }) => RoutePlaceholderComponent
  );

const placeholderRoute = (path: string, title: string): Route => ({
  path,
  pathMatch: 'full',
  loadComponent: loadRoutePlaceholder,
  data: { title }
});

export const adaptiveLearningRoutes: Routes = [
  placeholderRoute('learning/dashboard', 'Learning dashboard'),
  placeholderRoute('courses', 'Courses'),
  placeholderRoute('courses/:id/path', 'Course path'),
  placeholderRoute('outcomes', 'Outcomes'),
  placeholderRoute('outcomes/map', 'Outcomes map'),
  placeholderRoute('question-bank', 'Question bank'),
  placeholderRoute('questions/:id', 'Question'),
  placeholderRoute('exam-builder', 'Exam builder'),
  placeholderRoute('exams', 'Exams'),
  placeholderRoute('exam-session/:token', 'Exam session'),
  placeholderRoute('grading', 'Grading'),
  placeholderRoute('grading/:attemptId', 'Grading attempt'),
  placeholderRoute('student/:id/analytics', 'Student analytics'),
  placeholderRoute('cohort-analytics', 'Cohort analytics'),
  placeholderRoute('item-analysis', 'Item analysis'),
  placeholderRoute('audit-log', 'Audit log'),
  {
    path: '**',
    redirectTo: '/learning/dashboard'
  }
];
