import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';

import { ExamBuilderFacade } from '../data-access/exam-builder.facade';
import { BlueprintConstraintEditorComponent } from './blueprint-constraint-editor.component';
import { ExamBuilderComponent } from './exam-builder.component';

describe('ExamBuilderComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ExamBuilderComponent] });
  });

  const create = () => {
    const fixture = TestBed.createComponent(ExamBuilderComponent);
    fixture.detectChanges();
    return fixture;
  };

  it('renders a four-step semantic stepper with Blueprint as the current step', () => {
    const fixture = create();
    const element = fixture.nativeElement as HTMLElement;
    const steps = Array.from(element.querySelectorAll('.stepper > li'));

    expect(element.querySelector('nav[aria-label="Exam creation steps"]')).not.toBeNull();
    expect(steps).toHaveLength(4);
    expect(steps.map((step) => step.querySelector('strong')?.textContent?.trim())).toEqual([
      'Blueprint',
      'Question selection',
      'Settings',
      'Publish review'
    ]);
    expect(element.querySelector('li[aria-current="step"] strong')?.textContent?.trim()).toBe('Blueprint');
  });

  it('places the comparison matrix before the subordinate keyboard-native editor', () => {
    const fixture = create();
    const primary = fixture.nativeElement.querySelector('.primary-column') as HTMLElement;
    const children = Array.from(primary.children);
    const panel = primary.querySelector('app-blueprint-constraint-panel');
    const disclosure = primary.querySelector('details.editor-disclosure');

    expect(panel).not.toBeNull();
    expect(disclosure).not.toBeNull();
    expect(children.indexOf(panel as Element)).toBeLessThan(children.indexOf(disclosure as Element));
    expect(disclosure?.querySelector('summary')?.textContent?.trim()).toBe('Adjust blueprint constraints');
    expect(disclosure?.hasAttribute('open')).toBe(false);
    expect(disclosure?.querySelector('app-blueprint-constraint-editor')).not.toBeNull();
  });

  it('shows validation and settings regions with the initial missing state', () => {
    const fixture = create();
    const element = fixture.nativeElement as HTMLElement;
    const facade = fixture.componentInstance.facade;

    expect(facade.comparison().status).toBe('missing');
    expect(element.querySelector('section[aria-labelledby="validation-summary-heading"]')).not.toBeNull();
    expect(element.querySelector('section[aria-labelledby="settings-shell-heading"]')).not.toBeNull();
    expect(element.querySelector('.summary-card')?.getAttribute('data-status')).toBe('missing');
    expect(element.querySelector('#validation-summary-heading')?.textContent?.trim()).toBe(
      'No current coverage is selected; all target buckets are missing.'
    );
    expect(element.querySelector('.aggregate-status')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('! Missing coverage');
    expect(element.querySelector('.settings-shell input, .settings-shell select, .settings-shell button')).toBeNull();
  });

  it('updates the target and live announcement after a valid editor emission', () => {
    const fixture = create();
    const editor = fixture.debugElement.query(By.directive(BlueprintConstraintEditorComponent))
      .componentInstance as BlueprintConstraintEditorComponent;
    const before = fixture.componentInstance.facade.target();

    expect(editor.form.valid).toBe(true);
    editor.submit();
    fixture.detectChanges();

    expect(fixture.componentInstance.facade.target()).not.toBe(before);
    expect(fixture.componentInstance.facade.liveUpdateText()).toBe(
      'Blueprint updated. No current coverage is selected; all target buckets are missing.'
    );
    const announcements = Array.from(
      fixture.nativeElement.querySelectorAll('[role="status"][aria-live="polite"]') as NodeListOf<HTMLElement>
    ).map((node) => node.textContent?.replace(/\s+/g, ' ').trim());
    expect(announcements).toContain('Blueprint updated. No current coverage is selected; all target buckets are missing.');
  });

  it('exposes data through the facade and has no forbidden future actions', () => {
    const fixture = create();
    const component = fixture.componentInstance;
    const element = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(element.querySelectorAll('button')).map((button) => button.textContent?.trim() ?? '');

    expect(component.facade).toBeInstanceOf(ExamBuilderFacade);
    expect(component).not.toHaveProperty('seed');
    expect(component).not.toHaveProperty('createSeedData');
    expect(component).not.toHaveProperty('targetState');
    expect(component).not.toHaveProperty('currentCoverageState');
    expect(buttons.some((label) => /save|next|publish|automatic/i.test(label))).toBe(false);
    expect(element.textContent).not.toMatch(/selected pool/i);
  });
});
