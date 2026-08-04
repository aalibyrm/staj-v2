import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TestBed } from '@angular/core/testing';

import { routes } from '../../app.routes';

describe('application routes', () => {
  const concreteRoutes: ReadonlyArray<readonly [string, string]> = [
    ['/learning/dashboard', 'Learning dashboard'],
    ['/courses', 'Courses'],
    ['/courses/course-42/path', 'Course path'],
    ['/outcomes', 'Outcomes'],
    ['/outcomes/map', 'Outcomes map'],
    ['/question-bank', 'Question bank'],
    ['/questions/question-7', 'Question'],
    ['/exam-builder', 'Exam builder'],
    ['/exams', 'Exams'],
    ['/exam-session/session-token', 'Exam session'],
    ['/grading', 'Grading'],
    ['/grading/attempt-12', 'Grading attempt'],
    ['/student/student-9/analytics', 'Student analytics'],
    ['/cohort-analytics', 'Cohort analytics'],
    ['/item-analysis', 'Item analysis'],
    ['/audit-log', 'Audit log']
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes)]
    });
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

  it('resolves every concrete route to its accessible heading', async () => {
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);

    for (const [url, expectedHeading] of concreteRoutes) {
      await harness.navigateByUrl(url);

      expect(router.url).toBe(url);
      expect(harness.routeNativeElement?.querySelector('main')).not.toBeNull();
      expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe(
        expectedHeading
      );
    }
  });

  it('redirects the root and unknown URLs to the dashboard', async () => {
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);

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
});
