import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { RubricGradingFacade, type RubricGradingRequestState } from '../data-access/rubric-grading.facade';
import { RubricGradingRepository } from '../data-access/rubric-grading.repository';
import type { RubricGrading } from '../models/rubric.models';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { RubricGraderComponent } from './rubric-grader.component';

describe('RubricGraderComponent', () => {
  it('loads the route attempt, renders native level radios, and validates required selections', async () => {
    TestBed.configureTestingModule({
      imports: [RubricGraderComponent],
      providers: [provideRouter([{ path: 'grading/:attemptId', component: RubricGraderComponent }])]
    });
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/grading/attempt-ui', RubricGraderComponent);
    await harness.fixture.whenStable();
    await vi.waitFor(() => {
      expect(component.facade.context()?.attemptId).toBe('attempt-ui');
    });
    harness.detectChanges();
    const element = harness.routeNativeElement as HTMLElement;
    expect(element.querySelectorAll('input[type="radio"]').length).toBeGreaterThan(0);
    expect(element.querySelectorAll('textarea').length).toBeGreaterThan(0);
    component.reviewRubric();
    harness.detectChanges();
    await harness.fixture.whenRenderingDone();
    const summary = element.querySelector<HTMLElement>('.validation-summary');
    expect(summary).not.toBeNull();
    expect(summary?.getAttribute('role')).toBe('alert');
    expect(summary?.querySelectorAll('li')).toHaveLength(3);
    expect(document.activeElement).toBe(summary);
  });

  it('recalculates a live total after every criterion selection without a save action', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RubricGraderComponent],
      providers: [provideRouter([{ path: 'grading/:attemptId', component: RubricGraderComponent }])]
    });
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/grading/attempt-live', RubricGraderComponent);
    await harness.fixture.whenStable();
    await vi.waitFor(() => {
      expect(component.scoringState()?.total).toBe(0);
    });
    harness.detectChanges();
    component.facade.rubric()?.criteria.forEach((criterion, index) => {
      component.criterionForm(index).controls.levelId.setValue(criterion.levels.at(-1)?.id ?? null);
    });
    harness.detectChanges();

    expect(component.scoringState()?.total).toBe(100);
    expect(harness.routeNativeElement?.textContent).toContain('No changes are saved');
    expect(harness.routeNativeElement?.querySelector('button[type="submit"]')?.textContent).toContain('Review rubric');
  });
  it('retries through the facade and applies recovered grading when context was cleared', async () => {
    TestBed.resetTestingModule();
    const recovered = new RubricGradingRepository().fixtureForAttempt('attempt-retry');
    const requestState = signal<RubricGradingRequestState>({
      status: 'error',
      message: 'Service unavailable',
      retryable: true
    });
    const grading = signal<RubricGrading | null>(null);
    const rubric = signal<RubricGrading['rubric'] | null>(null);
    const load = vi.fn(() => {
      requestState.set({ status: 'error', message: 'Service unavailable', retryable: true });
      grading.set(null);
      rubric.set(null);
      return throwError(() => new Error('service'));
    });
    const retry = vi.fn(() => {
      grading.set(recovered);
      rubric.set(recovered.rubric);
      requestState.set({ status: 'ready' });
      return of(recovered);
    });
    const facade = {
      requestState,
      errorMessage: signal('Service unavailable'),
      grading,
      context: signal<RubricGrading['context'] | null>(null),
      rubric,
      load,
      retry
    } as unknown as RubricGradingFacade;

    TestBed.configureTestingModule({
      imports: [RubricGraderComponent],
      providers: [provideRouter([{ path: 'grading/:attemptId', component: RubricGraderComponent }])]
    });
    TestBed.overrideComponent(RubricGraderComponent, {
      set: { providers: [{ provide: RubricGradingFacade, useValue: facade }] }
    });
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/grading/attempt-retry', RubricGraderComponent);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(facade.context()).toBeNull();
    const retryButton = harness.routeNativeElement?.querySelector<HTMLButtonElement>('.retry-action');
    expect(retryButton).not.toBeNull();
    retryButton?.click();
    harness.detectChanges();

    expect(retry).toHaveBeenCalledTimes(1);
    expect(component.rubricForm.controls.criteria.length).toBe(recovered.rubric.criteria.length);
    expect(component.scoringState()).not.toBeNull();
    expect(harness.routeNativeElement?.querySelector('form.grading-form')).not.toBeNull();
    expect(harness.routeNativeElement?.textContent).toContain(recovered.context.attemptId);
  });
});
