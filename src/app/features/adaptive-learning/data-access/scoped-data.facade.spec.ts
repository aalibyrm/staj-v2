import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

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
  it('switches real accounts without rendering denied ids or primary text', async () => {
    const { fixture, sessionStore, facade } = await createDashboard();
    const element: HTMLElement = fixture.nativeElement;
    const seed = createSeedData();

    for (const role of ['STUDENT', 'INSTRUCTOR', 'PROGRAM_MANAGER', 'OBSERVER'] as const) {
      const account = accountFor(role);
      sessionStore.switchAccount(account.id);
      fixture.detectChanges();

      const rows = element.querySelectorAll('.record-row');
      expect(rows).toHaveLength(EXPECTED_IDS[role].length);
      expect(element.querySelector('.scope-summary')?.getAttribute('aria-live')).toBe('polite');
      expect(element.textContent).toContain(account.displayLabel);
      expect(element.textContent).toContain(roleLabel(role));

      const serialized = element.outerHTML;
      const allowedIds = new Set(EXPECTED_IDS[role]);
      const allowedPresentation = facade.visibleRecords().flatMap((record) => [
        record.primaryText,
        record.secondaryContext
      ]);
      const hasAllowedPresentation = (token: string): boolean =>
        allowedPresentation.some((field) => field.includes(token));
      for (const course of seed.courses) {
        if (!allowedIds.has(course.id)) {
          expect(serialized).not.toContain(course.id);
          if (!hasAllowedPresentation(course.code)) {
            expect(serialized).not.toContain(course.code);
          }
          if (!hasAllowedPresentation(course.title)) {
            expect(serialized).not.toContain(course.title);
          }
        }
      }
      for (const cohort of seed.cohorts) {
        if (!allowedIds.has(cohort.id)) {
          expect(serialized).not.toContain(cohort.id);
          if (!hasAllowedPresentation(cohort.code)) {
            expect(serialized).not.toContain(cohort.code);
          }
          if (!hasAllowedPresentation(cohort.name)) {
            expect(serialized).not.toContain(cohort.name);
          }
        }
      }
      for (const student of seed.students) {
        if (!allowedIds.has(student.id)) {
          expect(serialized).not.toContain(student.id);
          expect(serialized).not.toContain(student.pseudonym);
        }
      }

      const accessLabels = Array.from(element.querySelectorAll('.record-access')).map((node) =>
        node.textContent?.trim()
      );
      expect(accessLabels).toEqual(
        Array.from({ length: EXPECTED_IDS[role].length }, () =>
          role === 'OBSERVER' ? 'Read only' : 'Granted scope'
        )
      );
    }
  });

  it('renders truthful empty state for unauthenticated and administrator roles while exposing the measurement grant', async () => {
    const { fixture, sessionStore, facade } = await createDashboard();
    const element: HTMLElement = fixture.nativeElement;

    expect(facade.isAuthenticated()).toBe(false);
    expect(element.querySelectorAll('.record-row')).toHaveLength(0);
    expect(element.textContent).toContain('Select an account to view records');
    expect(element.textContent).toContain('Choose an authenticated demo account');

    sessionStore.signIn(accountFor('MEASUREMENT_SPECIALIST').id);
    fixture.detectChanges();
    expect(facade.isAuthenticated()).toBe(true);
    expect(element.querySelectorAll('.record-row')).toHaveLength(1);
    expect(element.textContent).toContain('Foundations of Data Literacy');
    expect(element.textContent).not.toContain('No authorized records');

    sessionStore.signIn(accountFor('PLATFORM_ADMINISTRATOR').id);
    fixture.detectChanges();
    expect(element.querySelectorAll('.record-row')).toHaveLength(0);
    expect(element.querySelector('app-request-state')).not.toBeNull();
    expect(element.textContent).toContain('No authorized records');
  });
});


function roleLabel(role: RoleCode): string {
  return role
    .toLowerCase()
    .split('_')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}
