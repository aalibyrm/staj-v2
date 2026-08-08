import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { firstValueFrom } from 'rxjs';

import {
  DATA_SCOPE_KINDS,
  DEMO_ACCOUNTS,
  decideDataScopeAccess,
  type AuthSession,
  type DemoAccount,
  type RoleCode
} from '../../../core/auth/authorization';
import { SessionStore } from '../../../core/auth/session.store';
import { createSeedData } from './seed-data.factory';
import { ScopedDataFacade } from './scoped-data.facade';
import { DataScopeDashboardComponent } from '../components/data-scope-dashboard.component';
import { RecommendationReasonCardComponent } from '../components/recommendation-reason-card.component';

type DemonstrationAccount = Extract<
  RoleCode,
  'STUDENT' | 'INSTRUCTOR' | 'PROGRAM_MANAGER' | 'OBSERVER'
>;

const EXPECTED_IDS: Readonly<Record<DemonstrationAccount, readonly string[]>> = {
  STUDENT: [
    'COURSE-MATH101-2025-FALL',
    'COHORT-MATH101-2025-FALL-A',
    'STUDENT-MATH101-2025-FALL-A-01'
  ],
  INSTRUCTOR: [
    'COURSE-MATH101-2025-FALL',
    'COHORT-MATH101-2025-FALL-A',
    'STUDENT-MATH101-2025-FALL-A-01',
    'STUDENT-MATH101-2025-FALL-A-02',
    'STUDENT-MATH101-2025-FALL-A-03'
  ],
  PROGRAM_MANAGER: ['COURSE-MATH101-2025-FALL', 'COHORT-MATH101-2025-FALL-A'],
  OBSERVER: ['COHORT-MATH101-2025-FALL-A']
};

const accountFor = (role: RoleCode): DemoAccount => {
  const account = DEMO_ACCOUNTS.find((candidate) => candidate.roleCode === role);
  if (account === undefined) {
    throw new Error(`Missing demo account for ${role}.`);
  }
  return account;
};

const sessionFor = (account: DemoAccount): AuthSession => ({
  accountId: account.id,
  account
});

const createDashboard = async (): Promise<{
  fixture: ComponentFixture<DataScopeDashboardComponent>;
  sessionStore: SessionStore;
  facade: ScopedDataFacade;
}> => {
  await TestBed.configureTestingModule({ imports: [DataScopeDashboardComponent] }).compileComponents();
  const fixture = TestBed.createComponent(DataScopeDashboardComponent);
  const sessionStore = TestBed.inject(SessionStore);
  sessionStore.signOut();
  fixture.detectChanges();
  return {
    fixture,
    sessionStore,
    facade: fixture.debugElement.injector.get(ScopedDataFacade)
  };
};

describe('ScopedDataFacade', () => {
  it('returns exact policy-filtered rows in deterministic order for four roles', async () => {
    const { facade, sessionStore } = await createDashboard();

    for (const role of Object.keys(EXPECTED_IDS) as DemonstrationAccount[]) {
      const account = accountFor(role);
      sessionStore.signIn(account.id);
      const session = sessionStore.session();
      if (session === null) {
        throw new Error('Expected an authenticated session.');
      }

      const records = facade.visibleRecords();
      expect(records.map((record) => record.id)).toEqual(EXPECTED_IDS[role]);
      expect(records).toHaveLength(EXPECTED_IDS[role].length);
      expect(records.every((record) => Object.isFrozen(record))).toBe(true);
      expect(Object.isFrozen(records)).toBe(true);

      for (const record of records) {
        const grant = account.scopeGrants.find(
          (candidate) =>
            candidate.kind === record.kind &&
            (candidate.global === true || candidate.ids.includes(record.id))
        );
        expect(grant).toBeDefined();
        expect(decideDataScopeAccess(session, { kind: record.kind, id: record.id }).allowed).toBe(true);
        expect(record.accessMode).toBe(grant?.readOnly === true ? 'read-only' : 'granted');
      }
    }
  });

  it('fails closed for null, administrator, unsupported, and unrelated scope while honoring canonical measurement grant', async () => {
    const { facade, sessionStore } = await createDashboard();
    expect(facade.isAuthenticated()).toBe(false);
    expect(facade.visibleRecords()).toEqual([]);
    expect(Object.isFrozen(facade.visibleRecords())).toBe(true);

    const measurement = accountFor('MEASUREMENT_SPECIALIST');
    sessionStore.signIn(measurement.id);
    expect(facade.isAuthenticated()).toBe(true);
    const measurementRecords = facade.visibleRecords();
    expect(measurementRecords.map((record) => record.id)).toEqual([
      'COURSE-MATH101-2025-FALL'
    ]);
    expect(measurementRecords[0]?.accessMode).toBe('granted');

    const administrator = accountFor('PLATFORM_ADMINISTRATOR');
    sessionStore.signIn(administrator.id);
    expect(facade.visibleRecords()).toEqual([]);

    const student = accountFor('STUDENT');
    sessionStore.signIn(student.id);
    const session = sessionStore.session();
    if (session === null) {
      throw new Error('Expected an authenticated session.');
    }
    const records = facade.visibleRecords();
    expect(records.map((record) => record.kind)).toEqual(['course', 'cohort', 'student']);
    expect(records.some((record) => record.id === 'COURSE-EDU201-2025-FALL')).toBe(false);
    expect(DATA_SCOPE_KINDS.includes('program')).toBe(true);
    expect(facade.accountLabel()).toBe(student.displayLabel);
    expect(facade.roleLabel()).toBe('Student');
  });

  it('does not retain rows when the session switches and marks observer scope read-only', async () => {
    const { facade, sessionStore } = await createDashboard();
    const roles: DemonstrationAccount[] = ['STUDENT', 'INSTRUCTOR', 'PROGRAM_MANAGER', 'OBSERVER'];

    for (const role of roles) {
      sessionStore.switchAccount(accountFor(role).id);
      expect(facade.visibleRecords().map((record) => record.id)).toEqual(EXPECTED_IDS[role]);
      expect(facade.visibleRecords().every((record) =>
        record.accessMode === (role === 'OBSERVER' ? 'read-only' : 'granted')
      )).toBe(true);
    }
  });
});

describe('DataScopeDashboardComponent', () => {
  it('renders the scoped dashboard hierarchy, accessible progress summary, and engine reason output', async () => {
    const { fixture, sessionStore, facade } = await createDashboard();
    sessionStore.signIn(accountFor('INSTRUCTOR').id);
    fixture.detectChanges();
    await vi.waitFor(() => expect(facade.requestState().status).toBe('ready'));
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('h1')?.textContent).toContain('Learning dashboard');
    expect(element.querySelector('.filter-row')).not.toBeNull();
    expect(element.querySelector('.kpi-grid')).not.toBeNull();
    expect(element.querySelector('.progress-table')).not.toBeNull();
    expect(element.querySelector('.recommendation-panel')).not.toBeNull();
    expect(element.querySelector('.outcome-panel')).not.toBeNull();
    expect(element.querySelector('.upcoming-panel')).not.toBeNull();
    expect(element.querySelector('.activity-panel')).not.toBeNull();
    expect(element.querySelectorAll('app-recommendation-reason-card').length).toBeGreaterThan(0);
    expect(element.textContent).toContain('weak-outcome');
    expect(element.textContent).toContain('Prioritize');
    expect(element.textContent).toContain('Relevant factors');
    expect(facade.recommendations().every((recommendation) => Object.isFrozen(recommendation))).toBe(true);
    expect(Object.isFrozen(facade.recommendations())).toBe(true);
    expect(element.querySelector('.progress-table caption')?.textContent).toContain('Outcome mastery');
  });

  it('keeps exact role and data-scope isolation across account switching', async () => {
    const { fixture, sessionStore, facade } = await createDashboard();
    const seed = createSeedData();
    for (const role of ['STUDENT', 'INSTRUCTOR', 'PROGRAM_MANAGER', 'OBSERVER'] as const) {
      sessionStore.switchAccount(accountFor(role).id);
      fixture.detectChanges();
      await vi.waitFor(() => expect(facade.requestState().status).toBe('ready'));
      fixture.detectChanges();
      const allowedIds = new Set(EXPECTED_IDS[role]);
      const relatedCourseIds = new Set(
        seed.courses
          .filter((course) => allowedIds.has(course.id) || seed.cohorts.some((cohort) => allowedIds.has(cohort.id) && cohort.courseId === course.id))
          .map((course) => course.id)
      );
      const allowedPresentation = facade.visibleRecords().flatMap((record) => [record.primaryText, record.secondaryContext]);
      const hasAllowedPresentation = (token: string): boolean => allowedPresentation.some((field) => field.includes(token));
      const serialized = fixture.nativeElement.outerHTML;
      for (const course of seed.courses) {
        if (!relatedCourseIds.has(course.id)) {
          expect(serialized).not.toContain(course.id);
          if (!hasAllowedPresentation(course.code)) expect(serialized).not.toContain(course.code);
          if (!hasAllowedPresentation(course.title)) expect(serialized).not.toContain(course.title);
        }
      }
      for (const cohort of seed.cohorts) {
        if (!allowedIds.has(cohort.id)) {
          expect(serialized).not.toContain(cohort.id);
          if (!hasAllowedPresentation(cohort.code)) expect(serialized).not.toContain(cohort.code);
          if (!hasAllowedPresentation(cohort.name)) expect(serialized).not.toContain(cohort.name);
        }
      }
      for (const student of seed.students) {
        if (!allowedIds.has(student.id)) {
          expect(serialized).not.toContain(student.id);
          expect(serialized).not.toContain(student.pseudonym);
        }
      }
      if (role === 'STUDENT') {
        const authorizedCohort = seed.cohorts.find((cohort) => allowedIds.has(cohort.id));
        const sibling = seed.cohorts.find((cohort) => authorizedCohort !== undefined && cohort.courseId === authorizedCohort.courseId && !allowedIds.has(cohort.id));
        if (sibling !== undefined) {
          expect(serialized).not.toContain(sibling.id);
          expect(serialized).not.toContain(sibling.code);
          expect(serialized).not.toContain(sibling.name);
        }
      }
      expect(facade.visibleRecords().map((record) => record.id)).toEqual(EXPECTED_IDS[role]);
      expect(facade.visibleRecords().every((record) => record.accessMode === (role === 'OBSERVER' ? 'read-only' : 'granted'))).toBe(true);
    }
  });

  it('exposes empty authorized scope distinctly from unauthenticated and denied scope', async () => {
    const { fixture, sessionStore, facade } = await createDashboard();
    expect(facade.requestState().status).toBe('unauthorized');
    sessionStore.signIn(accountFor('PLATFORM_ADMINISTRATOR').id);
    fixture.detectChanges();
    await vi.waitFor(() => expect(facade.requestState().status).toBe('unauthorized'));
    sessionStore.signIn(accountFor('STUDENT').id);
    fixture.detectChanges();
    await vi.waitFor(() => expect(facade.requestState().status).toBe('ready'));
    facade.setMockScenario({ outcome: 'unauthorized' });
    await expect(firstValueFrom(facade.load())).rejects.toBeTruthy();
    expect(facade.requestState().status).toBe('unauthorized');
    facade.setMockScenario({ emptyAuthorizedScope: true });
    await firstValueFrom(facade.load());
    fixture.detectChanges();
    expect(facade.requestState().status).toBe('empty');
    expect(fixture.nativeElement.textContent).toContain('No learning data in this scope');
  });

  it('keeps loading and slow context, retries service errors, and preserves successful widgets on partial failure', async () => {
    const { fixture, sessionStore, facade } = await createDashboard();
    sessionStore.signIn(accountFor('INSTRUCTOR').id);
    fixture.detectChanges();
    await vi.waitFor(() => expect(facade.requestState().status).toBe('ready'));
    facade.setMockScenario({ latencyMs: 500 });
    const slowLoad = facade.load();
    expect(facade.requestState().status).toBe('loading');
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(facade.requestState().status).toBe('slow');
    await firstValueFrom(slowLoad);
    expect(facade.requestState().status).toBe('ready');
    facade.setMockScenario({ outcome: 'service-error' });
    await expect(firstValueFrom(facade.load())).rejects.toBeTruthy();
    expect(facade.requestState().status).toBe('error');
    facade.resetMockScenario();
    await firstValueFrom(facade.load());
    expect(facade.requestState().status).toBe('ready');
    facade.setMockScenario({ widgetFailures: ['progress'] });
    await firstValueFrom(facade.load());
    fixture.detectChanges();
    expect(facade.widgetStatus('progress')).toBe('error');
    expect(facade.kpis().length).toBeGreaterThan(0);
    expect(facade.recommendations().length).toBeGreaterThan(0);
    facade.retryWidget('progress');
    expect(facade.widgetStatus('progress')).toBe('ready');
  });
});

describe('RecommendationReasonCardComponent', () => {
  it('renders input-driven identity, machine code, explanation, and factor list without transport access', async () => {
    await TestBed.configureTestingModule({ imports: [RecommendationReasonCardComponent] }).compileComponents();
    const fixture = TestBed.createComponent(RecommendationReasonCardComponent);
    fixture.componentRef.setInput('recommendation', {
      contentId: 'content-input-test',
      contentTitle: 'Input-driven practice',
      contentFormat: 'exercise',
      order: 2,
      reason: {
        code: 'weak-outcome',
        summary: 'Prioritize OUTCOME-01',
        detail: 'The measured mastery is below the practice threshold.',
        factors: Object.freeze({ mastery: 0.32, outcomeCode: 'OUTCOME-01', masteryState: 'measured' })
      }
    });
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('h3')?.textContent).toContain('Input-driven practice');
    expect(element.textContent).toContain('weak-outcome');
    expect(element.textContent).toContain('Prioritize OUTCOME-01');
    expect(element.textContent).toContain('The measured mastery');
    expect(element.querySelectorAll('.factor-list li')).toHaveLength(3);
    expect(element.querySelector('[aria-labelledby]')).not.toBeNull();
  });
});


function roleLabel(role: RoleCode): string {
  return role
    .toLowerCase()
    .split('_')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}
