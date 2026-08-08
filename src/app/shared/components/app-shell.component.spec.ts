import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { describe, expect, it } from 'vitest';

import { routes } from '../../app.routes';
import { DEMO_ACCOUNTS, type RoleCode } from '../../core/auth/authorization';
import { SessionStore } from '../../core/auth/session.store';
import { PlatformState } from '../../core/state/platform-state';
import { AppShellComponent } from './app-shell.component';

const expectedMenuByRole: Readonly<Record<RoleCode, readonly string[]>> = {
  STUDENT: ['Dashboard', 'Courses'],
  INSTRUCTOR: [
    'Dashboard',
    'Courses',
    'Question bank',
    'Exams',
    'Grading',
    'Cohort analytics',
    'Item analysis'
  ],
  MEASUREMENT_SPECIALIST: [
    'Dashboard',
    'Question bank',
    'Exams',
    'Cohort analytics',
    'Item analysis',
    'Audit log'
  ],
  PROGRAM_MANAGER: [
    'Dashboard',
    'Courses',
    'Outcomes',
    'Cohort analytics',
    'Audit log'
  ],
  OBSERVER: ['Dashboard', 'Cohort analytics', 'Audit log'],
  PLATFORM_ADMINISTRATOR: ['Dashboard', 'Audit log']
};

const createShell = async () => {
  await TestBed.configureTestingModule({
    imports: [AppShellComponent],
    providers: [provideRouter(routes)]
  }).compileComponents();

  const fixture = TestBed.createComponent(AppShellComponent);
  const router = TestBed.inject(Router);
  const sessionStore = TestBed.inject(SessionStore);
  sessionStore.signOut();
  fixture.detectChanges();

  return { fixture, router, sessionStore };
};

const navigate = async (
  router: Router,
  fixture: ComponentFixture<AppShellComponent>,
  url: string
): Promise<void> => {
  await router.navigateByUrl(url);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
};

const menuLabels = (fixture: ComponentFixture<AppShellComponent>): string[] => {
  const element: HTMLElement = fixture.nativeElement;
  return Array.from(element.querySelectorAll<HTMLAnchorElement>('.navigation-link')).map(
    (link) => link.textContent?.trim() ?? ''
  );
};

describe('AppShellComponent', () => {
  it('keeps public unauthorized content inside one shell main landmark', async () => {
    const { fixture, router } = await createShell();
    await navigate(router, fixture, '/unauthorized?returnUrl=%2Fgrading');

    const element: HTMLElement = fixture.nativeElement;
    const select = element.querySelector<HTMLSelectElement>('#demo-account');
    if (select === null) {
      throw new Error('Demo account selector was not rendered.');
    }
    expect(select.value).toBe('');
    expect(element.querySelectorAll('main')).toHaveLength(1);
    expect(element.querySelector('section[aria-labelledby="access-denied-heading"] h1')?.textContent).toBe(
      'Access denied'
    );
    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      'You do not have permission'
    );
    expect(element.querySelector('code')?.textContent).toBe('/grading');
    expect(element.querySelector('a[href="/learning/dashboard"]')?.textContent).toContain(
      'Return to dashboard'
    );
    expect(menuLabels(fixture)).toEqual([]);
  });

  it('renders canonical connectivity text in both shell status treatments', async () => {
    const { fixture } = await createShell();
    const platformState = TestBed.inject(PlatformState);
    const element: HTMLElement = fixture.nativeElement;
    const statusTexts = (): string[] =>
      Array.from(element.querySelectorAll<HTMLElement>('.system-status')).map(
        (status) => status.textContent?.replace(/System status/gu, '').trim() ?? ''
      );

    expect(statusTexts()).toEqual(['Online', 'Online']);

    platformState.setConnectivity('reconnecting');
    fixture.detectChanges();
    expect(statusTexts()).toEqual(['Reconnecting', 'Reconnecting']);

    platformState.setConnectivity('offline');
    fixture.detectChanges();
    expect(statusTexts()).toEqual(['Offline', 'Offline']);
  });

  it('labels unavailable term, search, and notification controls without sample data', async () => {
    const { fixture } = await createShell();
    const element: HTMLElement = fixture.nativeElement;
    const term = element.querySelector<HTMLSelectElement>('#term-selector');
    const search = element.querySelector<HTMLInputElement>('#global-search-input');
    const notifications = element.querySelector<HTMLButtonElement>(
      '[data-top-bar-control="notifications"]'
    );

    expect(element.querySelector('label[for="term-selector"]')?.textContent).toContain('Term');
    expect(term?.disabled).toBe(true);
    expect(term?.getAttribute('aria-label')).toBe('Term selector unavailable');
    expect(term?.getAttribute('aria-describedby')).toBe('term-selector-unavailable');
    expect(search?.disabled).toBe(true);
    expect(search?.getAttribute('aria-label')).toBe('Global search unavailable');
    expect(search?.getAttribute('aria-describedby')).toBe('global-search-unavailable');
    expect(search?.getAttribute('placeholder')).toBe('Search unavailable');
    expect(notifications?.disabled).toBe(true);
    expect(notifications?.getAttribute('aria-label')).toBe('Notifications unavailable');
    expect(notifications?.getAttribute('aria-describedby')).toBe('notifications-unavailable');
    expect(element.textContent).not.toMatch(/Ayşe Aydın|1,248|12,356|%67/u);
  });


  it('offers every canonical account and derives the exact role menus after switching', async () => {
    const { fixture, router } = await createShell();
    const element: HTMLElement = fixture.nativeElement;
    const select = element.querySelector<HTMLSelectElement>('#demo-account');
    if (select === null) {
      throw new Error('Demo account selector was not rendered.');
    }

    expect(select).not.toBeNull();
    expect(Array.from(select.options).filter((option) => option.value !== '').map((option) => option.value)).toEqual(
      DEMO_ACCOUNTS.map((account) => account.id)
    );
    expect(select.options[0]?.disabled).toBe(true);

    for (const account of DEMO_ACCOUNTS) {
      select.value = account.id;
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(router.url).toBe('/learning/dashboard');
      expect(menuLabels(fixture)).toEqual(expectedMenuByRole[account.roleCode]);
    }
  });

  it('marks the active route and leaves forbidden entries out of a student menu', async () => {
    const { fixture, router, sessionStore } = await createShell();
    const element: HTMLElement = fixture.nativeElement;
    sessionStore.signIn('ACCOUNT-STUDENT-001');
    await navigate(router, fixture, '/courses');

    const activeLink = element.querySelector<HTMLAnchorElement>(
      '.navigation-link[aria-current="page"]'
    );
    expect(activeLink?.textContent).toContain('Courses');
    expect(activeLink?.classList.contains('is-active')).toBe(true);
    expect(menuLabels(fixture)).not.toContain('Question bank');
    expect(menuLabels(fixture)).not.toContain('Audit log');
  });

  it('opens the drawer, moves focus inside, and restores focus on Escape', async () => {
    const { fixture, router, sessionStore } = await createShell();
    const element: HTMLElement = fixture.nativeElement;
    sessionStore.signIn('ACCOUNT-STUDENT-001');
    await navigate(router, fixture, '/learning/dashboard');

    const trigger = element.querySelector<HTMLButtonElement>('.menu-trigger');
    const drawer = element.querySelector<HTMLElement>('#app-navigation');
    if (trigger === null || drawer === null) {
      throw new Error('Drawer controls were not rendered.');
    }

    expect(trigger).not.toBeNull();
    expect(drawer).not.toBeNull();
    trigger.focus();
    trigger.click();
    fixture.detectChanges();

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(drawer.contains(document.activeElement)).toBe(true);

    drawer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });
  it('keeps Tab focus inside the open drawer and wraps at the last navigation link', async () => {
    const { fixture, router, sessionStore } = await createShell();
    sessionStore.signIn('ACCOUNT-STUDENT-001');
    await navigate(router, fixture, '/learning/dashboard');

    const element = fixture.nativeElement as HTMLElement;
    const trigger = element.querySelector<HTMLButtonElement>('.menu-trigger');
    const drawer = element.querySelector<HTMLElement>('#app-navigation');
    const links = Array.from(element.querySelectorAll<HTMLAnchorElement>('.navigation-link'));
    if (trigger === null || drawer === null || links.length < 2) {
      throw new Error('Drawer navigation links were not rendered.');
    }

    trigger.click();
    fixture.detectChanges();
    links.at(-1)?.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    drawer.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(links[0]);
  });
});
