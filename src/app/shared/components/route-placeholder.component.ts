import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-route-placeholder',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main>
      <h1>{{ title }}</h1>
      <p>This route is reserved for a later packet.</p>
    </main>
  `,
  styles: [`
    :host {
      display: block;
      min-height: 100%;
    }

    main {
      display: grid;
      min-height: 100%;
      align-content: center;
      gap: 0.75rem;
      padding: 2rem;
      text-align: center;
    }

    h1,
    p {
      margin: 0;
    }
  `]
})
export class RoutePlaceholderComponent {
  private readonly route = inject(ActivatedRoute);
  readonly title = String(this.route.snapshot.data['title'] ?? 'Reserved route');
}
