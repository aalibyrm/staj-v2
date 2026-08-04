import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, computed, inject, signal, type AfterViewChecked } from '@angular/core';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterOutlet,
  type ActivatedRouteSnapshot
} from '@angular/router';
import { filter } from 'rxjs';

import {
  DEMO_ACCOUNTS,
  ROUTE_CAPABILITIES,
  decideRouteAccess,
  type RoleCode,
  type RouteCapability
} from '../../core/auth/authorization';
import { SessionStore } from '../../core/auth/session.store';
import { PlatformState } from '../../core/state/platform-state';

type NavigationItem = Readonly<{
  label: string;
  path: string;
  icon: string;
  capabilities: readonly RouteCapability[];
}>;

const NAVIGATION_ITEMS: readonly NavigationItem[] = [
  {
    label: 'Dashboard',
    path: '/learning/dashboard',
    icon: 'D',
    capabilities: [
      ROUTE_CAPABILITIES.studentLearning,
      ROUTE_CAPABILITIES.instructorTeaching,
      ROUTE_CAPABILITIES.measurementWorkspace,
      ROUTE_CAPABILITIES.programWorkspace,
      ROUTE_CAPABILITIES.observerReports,
      ROUTE_CAPABILITIES.platformAdministration
    ]
  },
  {
    label: 'Courses',
    path: '/courses',
    icon: 'C',
    capabilities: [
      ROUTE_CAPABILITIES.studentLearning,
      ROUTE_CAPABILITIES.instructorTeaching,
      ROUTE_CAPABILITIES.programWorkspace
    ]
  },
  {
    label: 'Question bank',
    path: '/question-bank',
    icon: 'Q',
    capabilities: [
      ROUTE_CAPABILITIES.instructorTeaching,
      ROUTE_CAPABILITIES.measurementWorkspace
    ]
  },
  {
    label: 'Exams',
    path: '/exams',
    icon: 'E',
    capabilities: [
      ROUTE_CAPABILITIES.instructorTeaching,
      ROUTE_CAPABILITIES.measurementWorkspace
    ]
  },
  {
    label: 'Grading',
    path: '/grading',
    icon: 'G',
    capabilities: [ROUTE_CAPABILITIES.instructorTeaching]
  },
  {
    label: 'Outcomes',
    path: '/outcomes',
    icon: 'O',
    capabilities: [ROUTE_CAPABILITIES.programWorkspace]
  },
  {
    label: 'Cohort analytics',
    path: '/cohort-analytics',
    icon: 'A',
    capabilities: [
      ROUTE_CAPABILITIES.instructorTeaching,
      ROUTE_CAPABILITIES.measurementWorkspace,
      ROUTE_CAPABILITIES.programWorkspace,
      ROUTE_CAPABILITIES.observerReports
    ]
  },
  {
    label: 'Item analysis',
    path: '/item-analysis',
    icon: 'I',
    capabilities: [
      ROUTE_CAPABILITIES.instructorTeaching,
      ROUTE_CAPABILITIES.measurementWorkspace
    ]
  },
  {
    label: 'Audit log',
    path: '/audit-log',
    icon: 'L',
    capabilities: [
      ROUTE_CAPABILITIES.measurementWorkspace,
      ROUTE_CAPABILITIES.programWorkspace,
      ROUTE_CAPABILITIES.observerReports,
      ROUTE_CAPABILITIES.platformAdministration
    ]
  }
];


const routeTitle = (snapshot: ActivatedRouteSnapshot): string => {
  let activeSnapshot = snapshot;
  while (activeSnapshot.firstChild !== null) {
    activeSnapshot = activeSnapshot.firstChild;
  }

  const configuredTitle = activeSnapshot.data['title'];
  if (typeof configuredTitle === 'string' && configuredTitle.trim().length > 0) {
    return configuredTitle;
  }

  const configuredPath = activeSnapshot.routeConfig?.path;
  if (configuredPath === undefined || configuredPath.length === 0) {
    return 'Workspace';
  }

  const firstSegment = configuredPath.split('/')[0] ?? configuredPath;
  return firstSegment
    .replace(/[-_]+/gu, ' ')
    .replace(/\b\w/gu, (character) => character.toUpperCase());
};

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterLink, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="app-shell" [class.drawer-is-open]="isDrawerOpen()">
      <aside
        #drawer
        id="app-navigation"
        class="sidebar"
        tabindex="-1"
        aria-label="Primary navigation"
        (keydown)="onDrawerKeydown($event)"
      >
        <div class="brand" aria-label="Adaptive learning workspace">
          <span class="brand-mark" aria-hidden="true">AL</span>
          <span class="brand-name">Adaptive learning</span>
        </div>

        <nav class="primary-navigation" aria-label="Primary navigation links">
          @if (visibleNavigation().length === 0) {
            <p class="navigation-empty">Choose a demo account to view its navigation.</p>
          }
          @for (item of visibleNavigation(); track item.path) {
            <a
              class="navigation-link"
              [routerLink]="item.path"
              [class.is-active]="isCurrentNavigation(item.path)"
              [attr.aria-current]="isCurrentNavigation(item.path) ? 'page' : null"
            >
              <span class="navigation-icon" [attr.data-icon]="item.icon" aria-hidden="true"></span>
              <span>{{ item.label }}</span>
            </a>
          }
        </nav>

        <div class="sidebar-footer">
          <div class="account-context">
            <span class="context-label">Active scope</span>
            <strong>{{ activeAccount()?.displayLabel ?? 'Public access' }}</strong>
            <span>{{ activeRoleLabel() }}</span>
          </div>
          <div
            class="system-status"
            role="status"
            aria-live="polite"
            [attr.data-connectivity]="systemConnectivity()"
          >
            <span class="status-mark" aria-hidden="true"></span>
            <span>
              <strong>System status</strong>
              <span>{{ systemStatusLabel() }}</span>
            </span>
          </div>
        </div>
      </aside>

      <div class="shell-content">
        <header class="top-bar">
          <button
            #menuTrigger
            class="menu-trigger"
            type="button"
            aria-label="Open navigation menu"
            aria-controls="app-navigation"
            [attr.aria-expanded]="isDrawerOpen()"
            (click)="toggleDrawer()"
          >
            <span class="menu-trigger-icon" aria-hidden="true"><span></span><span></span><span></span></span>
          </button>

          <div class="route-heading">
            <span class="workspace-label">Adaptive learning workspace</span>
            <h1>{{ currentRouteTitle() }}</h1>
          </div>

          <div class="top-bar-actions">
            <div
              class="system-status compact-status"
              role="status"
              aria-live="polite"
              [attr.data-connectivity]="systemConnectivity()"
            >
              <span class="status-mark" aria-hidden="true"></span>
              <span>{{ systemStatusLabel() }}</span>
            </div>
            <div class="account-picker">
              <label for="demo-account">Demo account</label>
              <select
                id="demo-account"
                aria-label="Demo account"
                [value]="selectedAccountId()"
                (change)="onAccountChange($event)"
              >
                @if (activeAccount() === null) {
                  <option value="" [selected]="activeAccount() === null" disabled>
                    Select a demo account
                  </option>
                }
                @for (account of demoAccounts; track account.id) {
                  <option
                    [value]="account.id"
                    [selected]="activeAccount()?.id === account.id"
                  >
                    {{ account.displayLabel }} — {{ roleLabel(account.roleCode) }}
                  </option>
                }
              </select>
            </div>
            <div class="active-account" aria-live="polite">
              <span class="account-avatar" aria-hidden="true">{{ accountInitials() }}</span>
              <span>
                <strong>{{ activeAccount()?.displayLabel ?? 'No account selected' }}</strong>
                <span>{{ activeRoleLabel() }}</span>
              </span>
            </div>
          </div>
        </header>

        <main class="page-canvas" aria-label="Application content">
          <div class="page-frame">
            <router-outlet></router-outlet>
          </div>
        </main>
      </div>

      @if (isDrawerOpen()) {
        <button
          class="drawer-backdrop"
          type="button"
          tabindex="-1"
          aria-label="Close navigation drawer"
          (click)="closeDrawer()"
        ></button>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100vh;
      }

      .app-shell {
        display: grid;
        grid-template-columns: 240px minmax(0, 1fr);
        min-height: 100vh;
        background: var(--ui-canvas);
        color: var(--ui-text);
      }

      .sidebar {
        position: sticky;
        top: 0;
        z-index: 10;
        display: flex;
        flex-direction: column;
        width: 240px;
        height: 100vh;
        overflow-y: auto;
        background: var(--ui-surface);
        border-right: 1px solid var(--ui-border);
        padding: 20px 14px 16px;
      }

      .brand {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 42px;
        padding: 0 10px 18px;
        border-bottom: 1px solid var(--ui-border);
      }

      .brand-mark {
        display: grid;
        width: 30px;
        height: 30px;
        place-items: center;
        border-radius: var(--ui-radius-sm);
        background: var(--ui-primary);
        color: var(--ui-surface);
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.04em;
      }

      .brand-name {
        color: var(--ui-text);
        font-size: 14px;
        font-weight: 750;
        letter-spacing: -0.01em;
      }

      .primary-navigation {
        display: grid;
        gap: 4px;
        padding-top: 20px;
      }

      .navigation-link {
        display: flex;
        align-items: center;
        min-height: 44px;
        gap: 12px;
        padding: 9px 11px;
        border: 1px solid transparent;
        border-radius: var(--ui-radius-sm);
        color: var(--ui-text-muted);
        font-size: 13px;
        font-weight: 650;
        text-decoration: none;
      }

      .navigation-link:hover {
        background: var(--ui-surface-subtle);
        color: var(--ui-text);
      }

      .navigation-link.is-active {
        background: var(--ui-primary-soft);
        border-color: color-mix(in srgb, var(--ui-primary) 15%, transparent);
        color: var(--ui-primary);
      }

      .navigation-icon {
        display: grid;
        width: 24px;
        height: 24px;
        flex: 0 0 24px;
        place-items: center;
        border: 1px solid currentColor;
        border-radius: 7px;
        font-size: 10px;
        font-weight: 800;
        line-height: 1;
      }

      .navigation-icon::before {
        content: attr(data-icon);
      }

      .navigation-empty {
        margin: 0;
        padding: 10px 11px;
        color: var(--ui-text-muted);
        font-size: 12px;
      }

      .sidebar-footer {
        display: grid;
        gap: 14px;
        margin-top: auto;
        padding-top: 20px;
      }

      .account-context {
        display: grid;
        gap: 3px;
        padding: 0 10px;
        color: var(--ui-text-muted);
        font-size: 12px;
      }

      .account-context strong {
        overflow: hidden;
        color: var(--ui-text);
        font-size: 12px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .context-label,
      .workspace-label,
      .account-picker label {
        color: var(--ui-text-muted);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .account-picker label {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }

      .system-status {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 72px;
        padding: 13px 12px;
        border: 1px solid var(--ui-border);
        border-radius: var(--ui-radius-md);
        background: var(--ui-surface-subtle);
        color: var(--ui-text-muted);
        font-size: 12px;
      }

      .system-status > span:last-child {
        display: grid;
        gap: 2px;
      }

      .system-status strong {
        color: var(--ui-text);
        font-size: 12px;
      }

      .system-status span span {
        color: var(--ui-success);
        font-weight: 700;
      }
      .system-status[data-connectivity='reconnecting'] span span {
        color: var(--ui-warning);
      }

      .system-status[data-connectivity='offline'] span span {
        color: var(--ui-danger);
      }

      .system-status[data-connectivity='reconnecting'] .status-mark {
        border-color: var(--ui-warning);
      }

      .system-status[data-connectivity='offline'] .status-mark {
        border-color: var(--ui-danger);
      }

      .status-mark {
        width: 9px;
        height: 9px;
        flex: 0 0 9px;
        border: 2px solid var(--ui-success);
        border-radius: 50%;
      }

      .shell-content {
        min-width: 0;
      }

      .top-bar {
        display: flex;
        align-items: center;
        min-height: 64px;
        gap: 20px;
        padding: 10px 28px;
        border-bottom: 1px solid var(--ui-border);
        background: var(--ui-surface);
      }

      .route-heading {
        display: grid;
        min-width: 0;
        gap: 1px;
      }

      .route-heading h1 {
        margin: 0;
        overflow: hidden;
        font-size: 17px;
        font-weight: 750;
        line-height: 1.25;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .top-bar-actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        min-width: 0;
        flex: 1;
        gap: 18px;
      }

      .compact-status {
        min-height: 36px;
        padding: 0 8px;
        border: 0;
        background: transparent;
      }

      .account-picker {
        display: grid;
        min-width: min(310px, 32vw);
        gap: 2px;
      }

      .account-picker select {
        width: 100%;
        min-height: 38px;
        padding: 7px 32px 7px 10px;
        border: 1px solid var(--ui-border-strong);
        border-radius: var(--ui-radius-sm);
        background: var(--ui-surface);
        color: var(--ui-text);
        font-size: 12px;
      }

      .active-account {
        display: flex;
        align-items: center;
        min-width: 0;
        gap: 9px;
      }

      .active-account > span:last-child {
        display: grid;
        min-width: 0;
        gap: 1px;
      }

      .active-account strong,
      .active-account > span:last-child > span {
        overflow: hidden;
        max-width: 160px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .active-account strong {
        color: var(--ui-text);
        font-size: 12px;
      }

      .active-account > span:last-child > span {
        color: var(--ui-text-muted);
        font-size: 11px;
      }

      .account-avatar {
        display: grid;
        width: 34px;
        height: 34px;
        flex: 0 0 34px;
        place-items: center;
        border-radius: 50%;
        background: var(--ui-primary-soft);
        color: var(--ui-primary);
        font-size: 11px;
        font-weight: 800;
      }

      .page-canvas {
        min-width: 0;
        min-height: calc(100vh - 64px);
        padding: 28px;
      }

      .page-frame {
        width: min(100%, 1280px);
        min-height: calc(100vh - 120px);
        margin: 0 auto;
      }

      .menu-trigger,
      .drawer-backdrop {
        display: none;
      }

      @media (max-width: 1120px) {
        .top-bar {
          gap: 14px;
          padding-inline: 20px;
        }

        .top-bar-actions {
          gap: 10px;
        }

        .compact-status {
          display: none;
        }

        .account-picker {
          min-width: min(270px, 35vw);
        }
      }

      @media (max-width: 860px) {
        .app-shell {
          display: block;
        }

        .sidebar {
          display: none;
          position: fixed;
          inset: 0 auto 0 0;
          z-index: 40;
          width: min(320px, calc(100vw - 48px));
          box-shadow: var(--ui-shadow-md);
        }

        .app-shell.drawer-is-open .sidebar {
          display: flex;
        }

        .drawer-backdrop {
          display: block;
          position: fixed;
          inset: 0;
          z-index: 30;
          width: 100%;
          height: 100%;
          padding: 0;
          border: 0;
          background: rgb(15 23 42 / 0.42);
        }

        .top-bar {
          min-height: 60px;
          padding: 10px 16px;
        }

        .menu-trigger {
          display: grid;
          width: 40px;
          height: 40px;
          flex: 0 0 40px;
          place-items: center;
          padding: 0;
          border: 1px solid var(--ui-border-strong);
          border-radius: var(--ui-radius-sm);
          background: var(--ui-surface);
          color: var(--ui-text);
        }

        .menu-trigger-icon {
          display: grid;
          width: 18px;
          gap: 3px;
        }

        .menu-trigger-icon span {
          display: block;
          height: 2px;
          border-radius: 2px;
          background: currentColor;
        }

        .route-heading h1 {
          font-size: 15px;
        }

        .workspace-label {
          font-size: 10px;
        }

        .top-bar-actions {
          gap: 8px;
        }

        .account-picker {
          min-width: 0;
          flex: 1;
        }

        .account-picker select {
          min-height: 40px;
          padding-inline: 8px 26px;
          font-size: 11px;
        }

        .active-account {
          display: none;
        }

        .page-canvas {
          min-height: calc(100vh - 60px);
          padding: 20px 16px 28px;
        }

        .page-frame {
          min-height: calc(100vh - 108px);
        }
      }

      @media (max-width: 520px) {
        .top-bar {
          gap: 10px;
        }

        .workspace-label {
          display: none;
        }

        .route-heading {
          max-width: 38vw;
        }

        .account-picker label {
          display: none;
        }
      }
    `
  ]
})
export class AppShellComponent implements AfterViewChecked {
  private readonly router = inject(Router);
  private readonly sessionStore = inject(SessionStore);
  private readonly platformState = inject(PlatformState);
  private readonly drawerOpenState = signal(false);
  private drawerFocusPending = false;

  @ViewChild('menuTrigger') private menuTrigger?: ElementRef<HTMLButtonElement>;
  @ViewChild('drawer') private drawer?: ElementRef<HTMLElement>;

  readonly demoAccounts = DEMO_ACCOUNTS;
  readonly activeAccount = this.sessionStore.activeAccount;
  readonly selectedAccountId = computed(() => this.activeAccount()?.id ?? '');
  readonly visibleNavigation = computed(() => {
    const session = this.sessionStore.session();
    return NAVIGATION_ITEMS.filter((item) =>
      item.capabilities.some((capability) => decideRouteAccess(session, capability).allowed)
    );
  });
  readonly systemConnectivity = computed(() => this.platformState.state().connectivity);
  readonly systemStatusLabel = computed(() => {
    switch (this.systemConnectivity()) {
      case 'reconnecting':
        return 'Reconnecting';
      case 'offline':
        return 'Offline';
      default:
        return 'Online';
    }
  });
  readonly activeRoleLabel = computed(() => {
    const account = this.activeAccount();
    if (account === null) {
      return 'Choose a demo account';
    }

    return account.roleCode
      .toLowerCase()
      .split('_')
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(' ');
  });
  readonly currentRouteTitle = computed(() => {
    this.navigationEnd();
    return routeTitle(this.router.routerState.snapshot.root);
  });
  readonly isDrawerOpen = this.drawerOpenState.asReadonly();

  private readonly navigationEnd = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd)
    ),
    { initialValue: null }
  );

  constructor() {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed()
      )
      .subscribe(() => {
        if (this.drawerOpenState()) {
          this.closeDrawer();
        }
      });
  }

  ngAfterViewChecked(): void {
    if (!this.drawerFocusPending || !this.drawerOpenState() || this.drawer === undefined) {
      return;
    }

    this.drawerFocusPending = false;
    const firstFocusable = this.drawer.nativeElement.querySelector<HTMLElement>(
      'a, button, select, [tabindex]:not([tabindex="-1"])'
    );
    (firstFocusable ?? this.drawer.nativeElement).focus();
  }

  roleLabel(roleCode: RoleCode): string {
    return roleCode
      .toLowerCase()
      .split('_')
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(' ');
  }

  accountInitials(): string {
    const account = this.activeAccount();
    if (account === null) {
      return '—';
    }

    const initials = account.displayLabel
      .split(/\s+/u)
      .map((part) => part.charAt(0))
      .join('')
      .slice(0, 2)
      .toUpperCase();
    return initials || 'DA';
  }

  isCurrentNavigation(path: string): boolean {
    const url = this.navigationEnd()?.urlAfterRedirects ?? this.router.url;
    return (url.split(/[?#]/u, 1)[0] || '/') === path;
  }

  toggleDrawer(): void {
    if (this.drawerOpenState()) {
      this.closeDrawer();
      return;
    }

    this.drawerFocusPending = true;
    this.drawerOpenState.set(true);
  }

  closeDrawer(): void {
    if (!this.drawerOpenState()) {
      return;
    }

    this.drawerFocusPending = false;
    this.drawerOpenState.set(false);
    this.menuTrigger?.nativeElement.focus();
  }

  onDrawerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') {
      return;
    }

    event.preventDefault();
    this.closeDrawer();
  }

  onAccountChange(event: Event): void {
    const accountId = (event.target as HTMLSelectElement).value;
    if (accountId.length === 0) {
      return;
    }

    this.sessionStore.switchAccount(accountId);
    void this.router.navigateByUrl('/learning/dashboard').then((navigated) => {
      if (navigated || this.router.url === '/learning/dashboard') {
        this.closeDrawer();
      }
    });
  }
}
