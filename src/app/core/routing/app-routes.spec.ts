import { Component } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TestBed } from '@angular/core/testing';

import { routes } from '../../app.routes';
import {
  authGuard,
  adaptiveLearningRootGuard,
  ROUTE_CAPABILITIES_DATA_KEY
} from '../auth/auth.guard';
import { DEMO_ACCOUNTS, ROLE_CODES, ROUTE_CAPABILITIES, type RoleCode } from '../auth/authorization';
import { SessionStore } from '../auth/session.store';
import { UnauthorizedPageComponent } from '../../shared/components/unauthorized-page.component';
import { RoutePlaceholderComponent } from '../../shared/components/route-placeholder.component';
import { OutcomeListEditorComponent } from '../../features/learning-domain/components/outcome-list-editor.component';
import { OutcomeGraphComponent } from '../../features/learning-domain/components/outcome-graph.component';
import { CourseContentCatalogComponent } from '../../features/learning-domain/components/course-content-catalog.component';
import { QuestionBankComponent } from '../../features/question-bank/components/question-bank.component';
import { adaptiveLearningRoutes } from '../../features/adaptive-learning/adaptive-learning.routes';
import { ExamBuilderComponent } from '../../features/exam-builder/components/exam-builder.component';


@Component({
  standalone: true,
  template: '<h1>Boundary feature page</h1>'
})
class BoundaryFeaturePageComponent {}

const accountIdFor = (role: RoleCode): string => {
  const account = DEMO_ACCOUNTS.find((candidate) => candidate.roleCode === role);
  if (account === undefined) {
    throw new Error(`Missing demo account for ${role}.`);
  }
  return account.id;
};

const concreteRoutes: ReadonlyArray<readonly [string, string, RoleCode]> = [
  ['/courses', 'Course catalog', 'STUDENT'],
  ['/courses/course-42/path', 'Course path', 'STUDENT'],
  ['/outcomes', 'Outcomes', 'PROGRAM_MANAGER'],
  ['/outcomes/map', 'Outcomes map', 'PROGRAM_MANAGER'],
  ['/question-bank', 'Question bank', 'INSTRUCTOR'],
  ['/questions/question-7', 'Question', 'INSTRUCTOR'],
  ['/exams/new', 'Build an exam blueprint', 'INSTRUCTOR'],
  ['/exams', 'Exams', 'INSTRUCTOR'],
  ['/exam-session/session-token', 'Exam session', 'STUDENT'],
  ['/grading', 'Grading', 'INSTRUCTOR'],
  ['/grading/attempt-12', 'Grading attempt', 'INSTRUCTOR'],
  ['/student/student-9/analytics', 'Student analytics', 'STUDENT'],
  ['/cohort-analytics', 'Cohort analytics', 'INSTRUCTOR'],
  ['/item-analysis', 'Item analysis', 'INSTRUCTOR'],
  ['/audit-log', 'Audit log', 'MEASUREMENT_SPECIALIST']
];

describe('application routes', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes)]
    });
    TestBed.inject(SessionStore).signOut();
  });

  it('keeps the adaptive-learning feature behind a lazy root boundary', () => {
    const featureBoundary = routes.find(
      (route) => route.path === '' && route.loadChildren !== undefined
    );

    expect(featureBoundary).toBeDefined();
    expect(typeof featureBoundary?.loadChildren).toBe('function');
    expect(featureBoundary?.children).toBeUndefined();
    expect(featureBoundary?.component).toBeUndefined();
    expect(featureBoundary?.canMatch).toContain(adaptiveLearningRootGuard);

    const unauthorizedRoute = routes.find((route) => route.path === 'unauthorized');
    expect(unauthorizedRoute?.component).toBe(UnauthorizedPageComponent);
    expect(unauthorizedRoute?.loadComponent).toBeUndefined();
    expect(routes.some((route) => route.path === '**')).toBe(true);
  });

  it('denies direct product URLs before invoking the root feature loader', async () => {
    TestBed.resetTestingModule();
    const childLoader = vi.fn(() => Promise.resolve(BoundaryFeaturePageComponent));
    const featureLoader = vi.fn(() =>
      Promise.resolve([
        {
          path: 'grading',
          pathMatch: 'full' as const,
          canMatch: [authGuard],
          data: {
            [ROUTE_CAPABILITIES_DATA_KEY]: [ROUTE_CAPABILITIES.instructorTeaching]
          },
          loadComponent: childLoader
        }
      ])
    );

    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: 'unauthorized',
            pathMatch: 'full',
            component: UnauthorizedPageComponent
          },
          {
            path: '',
            canMatch: [adaptiveLearningRootGuard],
            loadChildren: featureLoader
          },
          {
            path: '**',
            redirectTo: 'learning/dashboard'
          }
        ])
      ]
    });

    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);
    const sessionStore = TestBed.inject(SessionStore);

    await harness.navigateByUrl('/grading/attempt-12');
    expect(router.url).toBe('/unauthorized?returnUrl=%2Fgrading%2Fattempt-12');
    expect(featureLoader).not.toHaveBeenCalled();

    sessionStore.signIn(accountIdFor('STUDENT'));
    await harness.navigateByUrl('/grading');
    expect(router.url).toBe('/unauthorized?returnUrl=%2Fgrading');
    expect(featureLoader).not.toHaveBeenCalled();

    sessionStore.signIn(accountIdFor('INSTRUCTOR'));
    await harness.navigateByUrl('/grading');
    expect(router.url).toBe('/grading');
    expect(featureLoader).toHaveBeenCalledTimes(1);
    expect(childLoader).toHaveBeenCalledTimes(1);
  });

  it('resolves every concrete route for its permitted demo role', async () => {
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);
    const sessionStore = TestBed.inject(SessionStore);

    for (const [url, expectedHeading, role] of concreteRoutes) {
      sessionStore.signIn(accountIdFor(role));
      await harness.navigateByUrl(url);

      expect(router.url).toBe(url);
      expect(
        harness.routeNativeElement?.querySelector(
          'section[aria-labelledby="route-placeholder-heading"], section[aria-labelledby="learning-dashboard-heading"], section[aria-labelledby="outcome-list-editor-heading"], section[aria-labelledby="outcome-map-heading"], section[aria-labelledby="question-bank-heading"], main[aria-labelledby="catalog-heading"], main[aria-labelledby="exam-builder-heading"]'
        )
      ).not.toBeNull();
      expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe(
        expectedHeading
      );
    }
  });
  it('lazy-loads the guarded concrete question bank for permitted roles and denies unrelated roles', async () => {
    const questionRoute = adaptiveLearningRoutes.find((route) => route.path === 'question-bank');
    expect(questionRoute?.pathMatch).toBe('full');
    expect(questionRoute?.canMatch).toContain(authGuard);
    expect(questionRoute?.component).toBeUndefined();
    expect(questionRoute?.data?.[ROUTE_CAPABILITIES_DATA_KEY]).toEqual([
      ROUTE_CAPABILITIES.instructorTeaching,
      ROUTE_CAPABILITIES.measurementWorkspace
    ]);
    expect(await questionRoute?.loadComponent?.()).toBe(QuestionBankComponent);

    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);
    const sessionStore = TestBed.inject(SessionStore);
    for (const role of ['INSTRUCTOR', 'MEASUREMENT_SPECIALIST'] as const) {
      sessionStore.signIn(accountIdFor(role));
      await harness.navigateByUrl('/question-bank');
      expect(router.url).toBe('/question-bank');
      expect(harness.routeNativeElement?.querySelector('#question-bank-heading')?.textContent?.trim()).toBe('Question bank');
    }
    sessionStore.signIn(accountIdFor('STUDENT'));
    await harness.navigateByUrl('/unauthorized');
    await harness.navigateByUrl('/question-bank');
    expect(router.url).toBe('/unauthorized?returnUrl=%2Fquestion-bank');
  });
  it('lazy-loads /exams/new for instructor and measurement specialist and removes the old alias', async () => {
    const examRoute = adaptiveLearningRoutes.find((route) => route.path === 'exams/new');
    expect(adaptiveLearningRoutes.some((route) => route.path === 'exam-builder')).toBe(false);
    expect(examRoute?.pathMatch).toBe('full');
    expect(examRoute?.canMatch).toContain(authGuard);
    expect(examRoute?.component).toBeUndefined();
    expect(examRoute?.data?.[ROUTE_CAPABILITIES_DATA_KEY]).toEqual([
      ROUTE_CAPABILITIES.instructorTeaching,
      ROUTE_CAPABILITIES.measurementWorkspace
    ]);
    expect(await examRoute?.loadComponent?.()).toBe(ExamBuilderComponent);

    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);
    const sessionStore = TestBed.inject(SessionStore);
    for (const role of ['INSTRUCTOR', 'MEASUREMENT_SPECIALIST'] as const) {
      sessionStore.signIn(accountIdFor(role));
      await harness.navigateByUrl('/exams/new');
      expect(router.url).toBe('/exams/new');
      expect(harness.routeNativeElement?.querySelector('#exam-builder-heading')).not.toBeNull();
    }
    sessionStore.signIn(accountIdFor('STUDENT'));
    await harness.navigateByUrl('/unauthorized');
    await harness.navigateByUrl('/exams/new');
    expect(router.url).toBe('/unauthorized?returnUrl=%2Fexams%2Fnew');
  });

  it('resolves the lazy outcome map for its three roles and denies an unrelated role', async () => {
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);
    const sessionStore = TestBed.inject(SessionStore);

    for (const role of ['INSTRUCTOR', 'PROGRAM_MANAGER', 'PLATFORM_ADMINISTRATOR'] as const) {
      sessionStore.signIn(accountIdFor(role));
      await harness.navigateByUrl('/unauthorized');
      await harness.navigateByUrl('/outcomes/map');
      expect(router.url).toBe('/outcomes/map');
      expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe('Outcomes map');
    }

    sessionStore.signIn(accountIdFor('STUDENT'));
    await harness.navigateByUrl('/unauthorized');
    await harness.navigateByUrl('/outcomes/map');
    expect(router.url).toBe('/unauthorized?returnUrl=%2Foutcomes%2Fmap');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe('Access denied');
  });


  it('lazy-loads the guarded outcomes editor and map while leaving /outcomes unchanged', async () => {
    const outcomesRoute = adaptiveLearningRoutes.find((route) => route.path === 'outcomes');
    const mapRoute = adaptiveLearningRoutes.find((route) => route.path === 'outcomes/map');

    expect(outcomesRoute?.pathMatch).toBe('full');
    expect(outcomesRoute?.canMatch).toContain(authGuard);
    expect(outcomesRoute?.component).toBeUndefined();
    expect(typeof outcomesRoute?.loadComponent).toBe('function');
    expect(outcomesRoute?.data?.['title']).toBe('Outcomes');
    expect(outcomesRoute?.data?.[ROUTE_CAPABILITIES_DATA_KEY]).toEqual([
      ROUTE_CAPABILITIES.programWorkspace
    ]);
    expect(await outcomesRoute?.loadComponent?.()).toBe(OutcomeListEditorComponent);

    expect(mapRoute?.pathMatch).toBe('full');
    expect(mapRoute?.canMatch).toContain(authGuard);
    expect(mapRoute?.data?.['title']).toBe('Outcomes map');
    expect(mapRoute?.data?.[ROUTE_CAPABILITIES_DATA_KEY]).toEqual([
      ROUTE_CAPABILITIES.instructorTeaching,
      ROUTE_CAPABILITIES.programWorkspace,
      ROUTE_CAPABILITIES.platformAdministration
    ]);
    expect(await mapRoute?.loadComponent?.()).toBe(OutcomeGraphComponent);
  });
  it('lazy-loads the courses catalog and preserves the guarded course path placeholder', async () => {
    const coursesRoute = adaptiveLearningRoutes.find((route) => route.path === 'courses');
    const pathRoute = adaptiveLearningRoutes.find((route) => route.path === 'courses/:id/path');

    expect(coursesRoute?.pathMatch).toBe('full');
    expect(coursesRoute?.canMatch).toContain(authGuard);
    expect(coursesRoute?.component).toBeUndefined();
    expect(coursesRoute?.data?.['title']).toBe('Courses');
    expect(coursesRoute?.data?.[ROUTE_CAPABILITIES_DATA_KEY]).toEqual([
      ROUTE_CAPABILITIES.studentLearning,
      ROUTE_CAPABILITIES.instructorTeaching,
      ROUTE_CAPABILITIES.programWorkspace
    ]);
    expect(await coursesRoute?.loadComponent?.()).toBe(CourseContentCatalogComponent);

    expect(pathRoute?.path).toBe('courses/:id/path');
    expect(pathRoute?.canMatch).toContain(authGuard);
    expect(pathRoute?.data?.['title']).toBe('Course path');
    expect(pathRoute?.data?.[ROUTE_CAPABILITIES_DATA_KEY]).toEqual([
      ROUTE_CAPABILITIES.studentLearning,
      ROUTE_CAPABILITIES.instructorTeaching
    ]);
    expect(await pathRoute?.loadComponent?.()).toBe(RoutePlaceholderComponent);
  });

  it('keeps the dashboard reachable for every canonical role', async () => {
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);
    const sessionStore = TestBed.inject(SessionStore);

    for (const role of ROLE_CODES) {
      sessionStore.signIn(accountIdFor(role));
      const url = `/learning/dashboard?role=${role}`;
      await harness.navigateByUrl(url);

      expect(router.url).toBe(url);
      expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe(
        'Learning dashboard'
      );
    }
  });

  it('redirects the root and unknown URLs to the dashboard while authorized', async () => {
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);
    TestBed.inject(SessionStore).signIn(accountIdFor('STUDENT'));

    await harness.navigateByUrl('/');
    expect(router.url).toBe('/learning/dashboard');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe(
      'Learning dashboard'
    );

    await harness.navigateByUrl('/not-a-product-route');
    expect(router.url).toBe('/learning/dashboard');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe(
      'Learning dashboard'
    );
  });

  it('denies a cross-role direct URL and leaves the public unauthorized state reachable', async () => {
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);
    const sessionStore = TestBed.inject(SessionStore);

    sessionStore.signIn(accountIdFor('STUDENT'));
    await harness.navigateByUrl('/grading/attempt-12');

    expect(router.url).toBe('/unauthorized?returnUrl=%2Fgrading%2Fattempt-12');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe(
      'Access denied'
    );

    sessionStore.signOut();
    await harness.navigateByUrl('/unauthorized');
    expect(router.url).toBe('/unauthorized');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe(
      'Access denied'
    );
  });
});
