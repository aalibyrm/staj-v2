import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';

import { AppComponent } from './app.component';

describe('AppComponent', () => {
  it('renders the bootstrap heading and status', async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter([])]
    }).compileComponents();

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('h1')?.textContent?.trim()).toBe('Client workspace ready');
    expect(element.querySelector('[role="status"]')?.textContent?.trim()).toBe(
      'No feature routes are configured yet.'
    );
    expect(element.querySelector('router-outlet')).not.toBeNull();
  });
});
