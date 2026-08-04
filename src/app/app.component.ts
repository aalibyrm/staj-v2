import { ChangeDetectionStrategy, Component } from '@angular/core';

import { AppShellComponent } from './shared/components/app-shell.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [AppShellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<app-shell />'
})
export class AppComponent {}
