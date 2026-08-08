import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  Router,
  convertToParamMap,
  provideRouter,
  type Routes
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_LIST_QUERY_STATE,
  MAX_PAGE,
  MAX_TOKEN_LENGTH,
  parseListQueryState,
  serializeListQueryState
} from '../state/list-query-state';
import { RoutePlaceholderComponent } from './route-placeholder.component';
import { RequestStateComponent, type RequestStateKind } from './request-state.component';

const routes: Routes = [
  { path: 'courses', component: RoutePlaceholderComponent, data: { title: 'Courses' } },
  { path: 'dashboard', component: RoutePlaceholderComponent, data: { title: 'Learning dashboard' } }
];

@Component({
  selector: 'app-request-state-pair-host',
  standalone: true,
  imports: [RequestStateComponent],
  template: `
    <app-request-state
      state="empty"
      title="First state"
      message="First message"
    />
    <app-request-state
      state="error"
      title="Second state"
      message="Second message"
    />
  `
})
class RequestStatePairHostComponent {}

const settle = async (harness: RouterTestingHarness): Promise<void> => {
  await harness.fixture.whenStable();
  harness.fixture.detectChanges();
};

describe('RequestStateComponent', () => {
  it('renders every state with explicit status content, non-color cues, and only retryable actions', async () => {
    await TestBed.configureTestingModule({ imports: [RequestStateComponent] }).compileComponents();
    const fixture = TestBed.createComponent(RequestStateComponent);

    const expectations: Readonly<Record<RequestStateKind, Readonly<{
      readonly title: string;
      readonly message: string;
      readonly role: string;
      readonly retryable: boolean;
    }>>> = {
      loading: { title: 'Loading', message: 'Content is loading. Please wait.', role: 'status', retryable: false },
      empty: { title: 'No results', message: 'There is no content to display yet.', role: 'status', retryable: false },
      slow: { title: 'Taking longer than expected', message: 'The request is still in progress. You can wait or try again.', role: 'status', retryable: true },
      error: { title: 'Unable to load content', message: "We couldn't complete the request. Try again.", role: 'alert', retryable: true },
      unauthorized: { title: 'Access unavailable', message: 'You do not have permission to view this content.', role: 'alert', retryable: false }
    };

    for (const state of ['loading', 'empty', 'slow', 'error', 'unauthorized'] as const) {
      fixture.componentRef.setInput('state', state);
      fixture.detectChanges();

      const element = fixture.nativeElement as HTMLElement;
      const section = element.querySelector('section.request-state') as HTMLElement;
      const expected = expectations[state];
      expect(element.querySelector('.state-symbol')?.textContent?.trim()).not.toBe('');
      expect(element.querySelector('h2')?.textContent?.trim()).toBe(expected.title);
      expect(element.querySelector('p')?.textContent?.trim()).toBe(expected.message);
      expect(section.getAttribute('role')).toBe(expected.role);
      const retry = element.querySelector('button.retry-action') as HTMLButtonElement | null;
      expect(retry === null).toBe(!expected.retryable);
      if (retry !== null) expect(retry.textContent?.trim()).toBe('Try again');
    }
  });

  it('keeps labels unique and local across multiple request-state instances', async () => {
    await TestBed.configureTestingModule({ imports: [RequestStatePairHostComponent] }).compileComponents();
    const fixture = TestBed.createComponent(RequestStatePairHostComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const sections = Array.from(host.querySelectorAll('section.request-state')) as HTMLElement[];
    const ids = Array.from(host.querySelectorAll('[id]')).map((element) => element.id);

    expect(sections).toHaveLength(2);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(ids.length);

    for (const section of sections) {
      const title = section.querySelector('h2');
      const message = section.querySelector('p');
      expect(title?.id).toBe(section.getAttribute('aria-labelledby'));
      expect(message?.id).toBe(section.getAttribute('aria-describedby'));
    }
  });

  it('marks loading busy, preserves skeleton space, and uses polite status semantics', async () => {
    await TestBed.configureTestingModule({ imports: [RequestStateComponent] }).compileComponents();
    const fixture = TestBed.createComponent(RequestStateComponent);
    fixture.componentRef.setInput('state', 'loading');
    fixture.detectChanges();

    const section = fixture.nativeElement.querySelector('section') as HTMLElement;
    expect(section.getAttribute('aria-busy')).toBe('true');
    expect(section.getAttribute('role')).toBe('status');
    expect(section.getAttribute('aria-live')).toBe('polite');
    expect(section.querySelectorAll('.skeleton-line')).toHaveLength(3);
    expect(section.querySelector('button')).toBeNull();
  });

  it('emits retry only for slow and error states and uses assertive alerts', async () => {
    await TestBed.configureTestingModule({ imports: [RequestStateComponent] }).compileComponents();
    const fixture = TestBed.createComponent(RequestStateComponent);
    let retries = 0;
    fixture.componentInstance.retry.subscribe(() => retries++);

    for (const state of ['slow', 'error'] as const) {
      fixture.componentRef.setInput('state', state);
      fixture.detectChanges();
      (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    }

    expect(retries).toBe(2);
    const section = fixture.nativeElement.querySelector('section') as HTMLElement;
    expect(section.getAttribute('role')).toBe('alert');
    expect(section.getAttribute('aria-live')).toBe('assertive');

    for (const state of ['empty', 'unauthorized'] as const) {
      fixture.componentRef.setInput('state', state);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('button')).toBeNull();
    }
  });
});

describe('list query codec', () => {
  it('trims search, keeps repeated filters in stable order, and deduplicates them', () => {
    const state = parseListQueryState(convertToParamMap({
      search: '  algebra  ',
      filter: [' planned ', 'active', 'planned', 'active']
    }));

    expect(state.search).toBe('algebra');
    expect(state.filters).toEqual(['planned', 'active']);
    expect(state.sort).toBe('');
    expect(state.page).toBe(1);
  });

  it('drops malformed and oversized tokens and defaults hostile page values safely', () => {
    const state = parseListQueryState(convertToParamMap({
      filter: ['valid-token', 'not valid', 'a'.repeat(MAX_TOKEN_LENGTH + 1)],
      sort: 'not valid',
      page: ['0']
    }));
    const negative = parseListQueryState(convertToParamMap({ page: '-2' }));
    const decimal = parseListQueryState(convertToParamMap({ page: '2.5' }));
    const huge = parseListQueryState(convertToParamMap({ page: String(MAX_PAGE + 1) }));

    expect(state.filters).toEqual(['valid-token']);
    expect(state.sort).toBe('');
    expect(state.page).toBe(1);
    expect(negative.page).toBe(1);
    expect(decimal.page).toBe(1);
    expect(huge.page).toBe(1);
  });

  it('omits defaults and serializes filters as repeated query values', () => {
    expect(serializeListQueryState(DEFAULT_LIST_QUERY_STATE)).toEqual({});
    expect(serializeListQueryState({
      search: 'term',
      filters: ['active', 'planned', 'active'],
      sort: 'name-asc',
      page: 3
    })).toEqual({
      search: 'term',
      filter: ['active', 'planned'],
      sort: 'name-asc',
      page: 3
    });
  });
});

describe('list query controls and courses placeholder', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter(routes)] });
  });

  it('hydrates controls from the courses URL and leaves controls off the dashboard', async () => {
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);
    await harness.navigateByUrl(
      '/courses?context=term-1&search=%20algebra%20&filter=active&filter=planned&sort=name-desc&page=3'
    );
    await settle(harness);

    const courses = harness.routeNativeElement!;
    expect(courses.querySelector('h1')?.textContent?.trim()).toBe('Courses');
    expect((courses.querySelector('input[type="search"]') as HTMLInputElement).value).toBe('algebra');
    expect((courses.querySelector('select[multiple]') as HTMLSelectElement).selectedOptions).toHaveLength(2);
    expect((courses.querySelector('select[formControlName="sort"]') as HTMLSelectElement).value).toBe('name-desc');
    const element = harness.routeNativeElement!;
    const search = element.querySelector('input[type="search"]') as HTMLInputElement;
    vi.useFakeTimers();
    try {
      search.value = 'geometry';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(260);
    } finally {
      vi.useRealTimers();
    }
    await settle(harness);
    expect(router.url).toContain('context=term-1');
    expect(router.url).toContain('search=geometry');
    expect(router.url).not.toContain('page=');

    const filters = element.querySelector('select[multiple]') as HTMLSelectElement;
    for (const option of Array.from(filters.options)) {
      const queryValue = option.getAttribute('data-query-value');
      option.selected = queryValue === 'active' || queryValue === 'archived';
    }
    filters.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(harness);
    expect(router.url).toContain('filter=active');
    expect(router.url).toContain('filter=archived');
    expect(router.url).not.toContain('filter=planned');
    expect(router.url).not.toContain('page=');

    const sort = element.querySelector('select[formControlName="sort"]') as HTMLSelectElement;
    sort.value = 'updated-desc';
    sort.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(harness);
    expect(router.url).toContain('sort=updated-desc');
    expect(router.url).not.toContain('page=');

    (element.querySelector('button[aria-label="Next page"]') as HTMLButtonElement).click();
    await settle(harness);
    expect(router.url).toContain('page=2');
    expect(router.url).toContain('context=term-1');
    await harness.navigateByUrl('/dashboard');
    await settle(harness);
    const dashboard = harness.routeNativeElement!;
    expect(dashboard.querySelector('.courses-pattern')).toBeNull();
    expect(dashboard.querySelector('.list-query-controls')).toBeNull();
    expect(dashboard.querySelector('.request-state')).toBeNull();
    expect(dashboard.querySelector('[aria-label="Reserved feature area"]')).not.toBeNull();
  });

  it('resets owned parameters, restores controls from the URL, and fails safe on malformed input', async () => {
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);

    await harness.navigateByUrl('/courses?context=term-1&search=first&filter=active');
    await settle(harness);
    await harness.navigateByUrl('/courses?context=term-1&search=second&filter=planned&page=2');
    await settle(harness);
    await harness.navigateByUrl('/courses?context=term-1&search=first&filter=active');
    await settle(harness);
    expect((harness.routeNativeElement!.querySelector('input[type="search"]') as HTMLInputElement).value).toBe('first');
    expect((harness.routeNativeElement!.querySelector('select[multiple]') as HTMLSelectElement).selectedOptions[0]?.getAttribute('data-query-value')).toBe('active');

    (harness.routeNativeElement!.querySelector('button.control-action') as HTMLButtonElement).click();
    await settle(harness);
    expect(router.url).toContain('context=term-1');
    expect(router.url).not.toContain('search=');
    expect(router.url).not.toContain('filter=');
    expect(router.url).not.toContain('page=');

    await harness.navigateByUrl('/courses?context=term-1&search=%3Cscript%3E&filter=bad%20value&sort=%3Cbad%3E&page=-4');
    await settle(harness);
    const malformed = harness.routeNativeElement!;
    expect((malformed.querySelector('input[type="search"]') as HTMLInputElement).value).toBe('<script>');
    expect((malformed.querySelector('select[multiple]') as HTMLSelectElement).selectedOptions).toHaveLength(0);
    expect((malformed.querySelector('select[formControlName="sort"]') as HTMLSelectElement).value).toBe('');
    expect(malformed.querySelector('.query-summary')?.textContent).toContain('Page 1');
    expect(router.url).toContain('context=term-1');
  });
});
