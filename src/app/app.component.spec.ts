import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { AppComponent } from './app.component';

describe('AppComponent', () => {
  it('composes exactly one application shell and router outlet without bootstrap status', async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter([])]
    }).compileComponents();

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelectorAll('app-shell')).toHaveLength(1);
    expect(element.querySelectorAll('router-outlet')).toHaveLength(1);
    expect(element.querySelectorAll('main')).toHaveLength(1);
    expect(element.querySelector('.bootstrap-status')).toBeNull();
    expect(element.textContent).not.toContain('Client workspace ready');
    expect(element.textContent).not.toContain('Loading application routes.');
  });
});
