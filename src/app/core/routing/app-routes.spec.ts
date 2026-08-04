import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TestBed } from '@angular/core/testing';

import { routes } from '../../app.routes';
import { DEMO_ACCOUNTS, ROLE_CODES, type RoleCode } from '../auth/authorization';
import { SessionStore } from '../auth/session.store';

const accountIdFor = (role: RoleCode): string => {
  const account = DEMO_ACCOUNTS.find((candidate) => candidate.roleCode === role);
  if (account === undefined) {
    throw new Error(`Missing demo account for ${role}.`);
  }
  return account.id;
};

const concreteRoutes: ReadonlyArray<readonly [string, string, RoleCode]> = [
  ['/learning/dashboard', 'Learning dashboard', 'STUDENT'],
  ['/courses', 'Courses', 'STUDENT'],
  ['/courses/course-42/path', 'Course path', 'STUDENT'],
  ['/outcomes', 'Outcomes', 'PROGRAM_MANAGER'],
  ['/outcomes/map', 'Outcomes map', 'PROGRAM_MANAGER'],
  ['/question-bank', 'Question bank', 'INSTRUCTOR'],
  ['/questions/question-7', 'Question', 'INSTRUCTOR'],
  ['/exam-builder', 'Exam builder', 'INSTRUCTOR'],
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
  });

  it('resolves every concrete route for its permitted demo role', async () => {
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);
    const sessionStore = TestBed.inject(SessionStore);

    for (const [url, expectedHeading, role] of concreteRoutes) {
      sessionStore.signIn(accountIdFor(role));
      await harness.navigateByUrl(url);

      expect(router.url).toBe(url);
      expect(harness.routeNativeElement?.querySelector('main')).not.toBeNull();
      expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe(
        expectedHeading
      );
    }
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
