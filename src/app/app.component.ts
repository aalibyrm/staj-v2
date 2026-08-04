import { NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [NgIf, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main *ngIf="showBootstrapStatus" class="bootstrap-status" aria-labelledby="bootstrap-title">
      <h1 id="bootstrap-title">Client workspace ready</h1>
      <p role="status" aria-live="polite">No feature routes are configured yet.</p>
    </main>
    <router-outlet (activate)="onRouteActivated()"></router-outlet>
  `,
  styles: [`
    :host {
      display: block;
      min-height: 100vh;
    }

    .bootstrap-status {
      display: grid;
      min-height: 100vh;
      align-content: center;
      justify-items: center;
      gap: 0.5rem;
      padding: 2rem;
      text-align: center;
    }

    h1,
    p {
      margin: 0;
    }

    h1 {
      color: var(--ui-text);
      font-size: clamp(1.5rem, 3vw, 2rem);
      line-height: 1.2;
    }

    p {
      color: var(--ui-text-muted);
    }
  `]
})
export class AppComponent {
  showBootstrapStatus = true;

  onRouteActivated(): void {
    this.showBootstrapStatus = false;
  }
}
