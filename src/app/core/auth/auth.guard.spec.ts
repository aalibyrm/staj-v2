import { Component } from '@angular/core';
import { provideRouter, Router, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TestBed } from '@angular/core/testing';

import {
  authGuard,
  ROUTE_CAPABILITIES_DATA_KEY,
  type RouteCapabilitiesData
} from './auth.guard';
import { ROUTE_CAPABILITIES } from './authorization';
import { SessionStore } from './session.store';

@Component({
  selector: 'app-guarded-test-page',
  standalone: true,
  template: '<main><h1>Guarded test page</h1></main>'
})
class GuardedTestPageComponent {}

const allowedLoader = vi.fn(() => Promise.resolve(GuardedTestPageComponent));
const deniedLoader = vi.fn(() => Promise.resolve(GuardedTestPageComponent));
const studentCapability: RouteCapabilitiesData = [ROUTE_CAPABILITIES.studentLearning];

const testRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'unauthorized'
  },
  {
    path: 'private/:id',
    pathMatch: 'full',
    canMatch: [authGuard],
    data: { [ROUTE_CAPABILITIES_DATA_KEY]: studentCapability },
    loadComponent: allowedLoader
  },
  {
    path: 'missing/:id',
    pathMatch: 'full',
    canMatch: [authGuard],
    loadComponent: deniedLoader
  },
  {
    path: 'empty/:id',
    pathMatch: 'full',
    canMatch: [authGuard],
    data: { [ROUTE_CAPABILITIES_DATA_KEY]: [] },
    loadComponent: deniedLoader
  },
  {
    path: 'malformed/:id',
    pathMatch: 'full',
    canMatch: [authGuard],
    data: {
      [ROUTE_CAPABILITIES_DATA_KEY]: [{ key: 'student-learning' }]
    },
    loadComponent: deniedLoader
  },
  {
    path: 'unauthorized',
    pathMatch: 'full',
    loadComponent: () =>
      import('../../shared/components/unauthorized-page.component').then(
        ({ UnauthorizedPageComponent }) => UnauthorizedPageComponent
      )
  }
];

describe('authGuard', () => {
  beforeEach(() => {
    allowedLoader.mockClear();
    deniedLoader.mockClear();
    TestBed.configureTestingModule({ providers: [provideRouter(testRoutes)] });
    TestBed.inject(SessionStore).signOut();
  });

  it('redirects unauthenticated dynamic requests with an encoded return URL before loading', async () => {
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);

    await harness.navigateByUrl('/private/request-token-42');

    expect(router.url).toBe('/unauthorized?returnUrl=%2Fprivate%2Frequest-token-42');
    expect(allowedLoader).not.toHaveBeenCalled();
    expect(deniedLoader).not.toHaveBeenCalled();
  });

  it('redirects a wrong-role request without invoking its lazy loader', async () => {
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);
    TestBed.inject(SessionStore).signIn('ACCOUNT-INSTRUCTOR-001');

    await harness.navigateByUrl('/private/instructor-token');

    expect(router.url).toBe('/unauthorized?returnUrl=%2Fprivate%2Finstructor-token');
    expect(allowedLoader).not.toHaveBeenCalled();
    expect(deniedLoader).not.toHaveBeenCalled();
  });

  it('loads an allowed route once for the permitted role', async () => {
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);
    TestBed.inject(SessionStore).signIn('ACCOUNT-STUDENT-001');

    await harness.navigateByUrl('/private/student-token');
    expect(router.url).toBe('/private/student-token');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe(
      'Guarded test page'
    );
    expect(allowedLoader).toHaveBeenCalledTimes(1);

    await harness.navigateByUrl('/private/another-student-token');
    expect(router.url).toBe('/private/another-student-token');
    expect(allowedLoader).toHaveBeenCalledTimes(1);
  });

  it('denies missing and malformed capability metadata by default', async () => {
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);
    TestBed.inject(SessionStore).signIn('ACCOUNT-STUDENT-001');

    for (const path of ['/missing/missing-token', '/empty/empty-token', '/malformed/malformed-token']) {
      await harness.navigateByUrl(path);
      expect(router.url).toBe(`/unauthorized?returnUrl=${encodeURIComponent(path)}`);
    }

    expect(deniedLoader).not.toHaveBeenCalled();
  });

  it('keeps unauthorized public, renders only safe internal paths, and does not loop', async () => {
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);

    await harness.navigateByUrl(
      '/unauthorized?returnUrl=%2Fcourses%2Fcourse-42%2Fpath'
    );
    expect(router.url).toBe('/unauthorized?returnUrl=%2Fcourses%2Fcourse-42%2Fpath');
    expect(harness.routeNativeElement?.querySelector('code')?.textContent).toBe(
      '/courses/course-42/path'
    );
    expect(harness.routeNativeElement?.querySelector('a')?.getAttribute('href')).toBe(
      '/learning/dashboard'
    );

    for (const url of [
      '/unauthorized?returnUrl=%2F%2Fevil.example',
      '/unauthorized?returnUrl=https%3A%2F%2Fevil.example',
      '/unauthorized?returnUrl=%2Funauthorized',
      '/unauthorized?returnUrl=%2Fbad%00path',
      '/unauthorized?returnUrl=%2Fbad%5Cpath'
    ]) {
      await harness.navigateByUrl(url);
      expect(router.url).toMatch(/^\/unauthorized\?returnUrl=/);
      expect(harness.routeNativeElement?.querySelector('code')).toBeNull();
      expect(harness.routeNativeElement?.querySelector('a')?.getAttribute('href')).toBe(
        '/learning/dashboard'
      );
    }

    await harness.navigateByUrl('/unauthorized');
    expect(router.url).toBe('/unauthorized');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe(
      'Access denied'
    );
  });
});
