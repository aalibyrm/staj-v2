import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';

import { ExamBuilderFacade } from '../data-access/exam-builder.facade';
import { BlueprintConstraintEditorComponent } from './blueprint-constraint-editor.component';
import { ExamBuilderComponent } from './exam-builder.component';

describe('ExamBuilderComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [ExamBuilderComponent] }));
  const create = () => {
    const fixture = TestBed.createComponent(ExamBuilderComponent);
    fixture.detectChanges();
    return fixture;
  };

  it('renders the four-step hierarchy and keeps the matrix before the keyboard-native editor', () => {
    const fixture = create();
    const element = fixture.nativeElement as HTMLElement;
    const steps = Array.from(element.querySelectorAll('.stepper > li'));
    const primary = element.querySelector('.primary-column') as HTMLElement;
    expect(element.querySelector('nav[aria-label="Exam creation steps"]')).not.toBeNull();
    expect(steps).toHaveLength(4);
    expect(steps.map((step) => step.querySelector('strong')?.textContent?.trim())).toEqual(['Blueprint', 'Question selection', 'Settings', 'Publish review']);
    expect(element.querySelector('li[aria-current="step"] strong')?.textContent?.trim()).toBe('Blueprint');
    expect(Array.from(primary.children).indexOf(primary.querySelector('app-blueprint-constraint-panel') as Element)).toBeLessThan(Array.from(primary.children).indexOf(primary.querySelector('details.editor-disclosure') as Element));
    expect(primary.querySelector('details summary')?.textContent?.trim()).toBe('Adjust blueprint constraints');
  });
  it('keeps semantic matrix values and validation before settings in the narrow-safe DOM order', () => {
    const fixture = create();
    const element = fixture.nativeElement as HTMLElement;
    const matrix = element.querySelector('.matrix-scroll') as HTMLElement;
    const summary = element.querySelector('.summary-card') as HTMLElement;
    const settings = element.querySelector('.settings-shell') as HTMLElement;
    expect(matrix.getAttribute('role')).toBe('region');
    expect(matrix.getAttribute('tabindex')).toBe('0');
    expect(matrix.getAttribute('aria-label')).toBe('Blueprint target and current coverage matrix');
    expect(matrix.querySelector('caption')?.textContent).toContain('Blueprint target and current coverage');
    expect(Array.from(matrix.querySelectorAll('thead th')).map((header) => header.textContent?.trim())).toEqual([
      'Dimension / bucket', 'Target count', 'Current count', 'Target points', 'Current points', 'Status and reason'
    ]);
    expect(matrix.textContent).toContain('Missing');
    expect(element.querySelector('.primary-column')?.firstElementChild?.tagName.toLowerCase()).toBe('app-blueprint-constraint-panel');
    expect(summary.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows truthful empty selection, settings labels, and disabled publish state', () => {
    const fixture = create();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('#exam-title')).not.toBeNull();
    expect(element.querySelector('#exam-duration')).not.toBeNull();
    expect(element.querySelector('#successor-note')).not.toBeNull();
    expect(element.textContent).toContain('No published question versions are selected.');
    expect((element.querySelector('button.secondary-action') as HTMLButtonElement).disabled).toBe(true);
    expect(fixture.componentInstance.form.valid).toBe(true);
    expect((element.querySelector('.settings-shell button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
    expect(element.querySelector('[role="status"][aria-live="polite"]')).not.toBeNull();
  });

  it('uses reactive validation and preserves the editor update announcement', () => {
    const fixture = create();
    const component = fixture.componentInstance;
    const title = component.form.controls.title;
    title.setValue('');
    component.form.markAllAsTouched();
    fixture.detectChanges();
    expect(component.form.invalid).toBe(true);
    const editor = fixture.debugElement.query(By.directive(BlueprintConstraintEditorComponent)).componentInstance as BlueprintConstraintEditorComponent;
    editor.submit();
    fixture.detectChanges();
    expect(component.facade.liveUpdateText()).toContain('Blueprint updated.');
    expect(fixture.nativeElement.querySelector('[role="status"][aria-live="polite"]')).not.toBeNull();
  });

  it('exposes workflow only through the facade and keeps visible keyboard labels', () => {
    const fixture = create();
    const component = fixture.componentInstance;
    const element = fixture.nativeElement as HTMLElement;
    expect(component.facade).toBeInstanceOf(ExamBuilderFacade);
    expect(component).not.toHaveProperty('seed');
    expect(component).not.toHaveProperty('createSeedData');
    expect(element.querySelector('label[for="exam-title"]')?.textContent).toContain('Title');
    expect(element.querySelector('label[for="exam-duration"]')?.textContent).toContain('Duration');
    expect(element.querySelector('.settings-shell button[type="submit"]')?.textContent).toContain('Save draft');
  });
});
