import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F\u2028\u2029]/u;
const ENCODED_PATH_PATTERN = /^(?:[^%]|%[0-9A-Fa-f]{2})*$/u;

const safeInternalReturnUrl = (value: string | null): string | null => {
  if (
    value === null ||
    value.length === 0 ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    value.includes('?') ||
    value.includes('#') ||
    CONTROL_CHARACTER_PATTERN.test(value) ||
    !ENCODED_PATH_PATTERN.test(value)
  ) {
    return null;
  }

  if (value === '/unauthorized' || value.startsWith('/unauthorized/')) {
    return null;
  }

  return value;
};

@Component({
  selector: 'app-unauthorized-page',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main aria-labelledby="access-denied-heading">
      <h1 id="access-denied-heading">Access denied</h1>
      <p role="alert">You do not have permission to access this page.</p>
      @if (requestedPath() !== null) {
        <p>Requested internal path: <code>{{ requestedPath() }}</code></p>
      }
      <a routerLink="/learning/dashboard">Return to dashboard</a>
    </main>
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100%;
      }

      main {
        display: grid;
        min-height: 100%;
        align-content: center;
        justify-items: center;
        gap: 0.75rem;
        padding: 2rem;
        text-align: center;
      }

      h1,
      p {
        margin: 0;
      }

      code {
        overflow-wrap: anywhere;
      }
    `
  ]
})
export class UnauthorizedPageComponent {
  private readonly route = inject(ActivatedRoute);

  readonly requestedPath = toSignal(
    this.route.queryParamMap.pipe(
      map((queryParamMap) => safeInternalReturnUrl(queryParamMap.get('returnUrl')))
    ),
    {
      initialValue: safeInternalReturnUrl(
        this.route.snapshot.queryParamMap.get('returnUrl')
      )
    }
  );
}
