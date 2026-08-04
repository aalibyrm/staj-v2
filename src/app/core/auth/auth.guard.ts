import { inject } from '@angular/core';
import { Router, type CanMatchFn, type Route, type UrlSegment } from '@angular/router';

import {
  ROUTE_CAPABILITIES,
  decideRouteAccess,
  type RouteCapability
} from './authorization';
import { SessionStore } from './session.store';

export const ROUTE_CAPABILITIES_DATA_KEY = 'routeCapabilities' as const;

export type RouteCapabilitiesData = readonly [RouteCapability, ...RouteCapability[]];

const isRouteCapabilitiesData = (value: unknown): value is RouteCapabilitiesData => {
  if (!Array.isArray(value) || value.length === 0) {
    return false;
  }

  const knownCapabilities = Object.values(ROUTE_CAPABILITIES) as readonly RouteCapability[];
  return value.every((candidate) => {
    if (candidate === null || typeof candidate !== 'object') {
      return false;
    }

    const candidateRecord = candidate as Record<string, unknown>;
    const canonicalCapability = knownCapabilities.find(
      (knownCapability) => knownCapability.key === candidateRecord['key']
    );
    const allowedRoles = candidateRecord['allowedRoles'];

    return (
      canonicalCapability !== undefined &&
      Array.isArray(allowedRoles) &&
      allowedRoles.length === canonicalCapability.allowedRoles.length &&
      allowedRoles.every(
        (role, index) => role === canonicalCapability.allowedRoles[index]
      )
    );
  });
};

const attemptedUrlFromSegments = (segments: readonly UrlSegment[]): string =>
  `/${segments.map((segment) => segment.toString()).join('/')}`;

const unauthorizedUrlTree = (router: Router, segments: readonly UrlSegment[]) => {
  const returnUrl = attemptedUrlFromSegments(segments);
  return router.createUrlTree(['/unauthorized'], {
    queryParams: {
      returnUrl
    }
  });
};

export const authGuard: CanMatchFn = (route: Route, segments: UrlSegment[]) => {
  const capabilities = route.data?.[ROUTE_CAPABILITIES_DATA_KEY];
  const router = inject(Router);

  if (!isRouteCapabilitiesData(capabilities)) {
    return unauthorizedUrlTree(router, segments);
  }

  const session = inject(SessionStore).session();
  if (capabilities.some((capability) => decideRouteAccess(session, capability).allowed)) {
    return true;
  }

  return unauthorizedUrlTree(router, segments);
};
