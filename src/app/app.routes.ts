import type { Routes } from '@angular/router';

import { adaptiveLearningRootGuard } from './core/auth/auth.guard';
import { UnauthorizedPageComponent } from './shared/components/unauthorized-page.component';

export const routes: Routes = [
  {
    path: 'unauthorized',
    pathMatch: 'full',
    component: UnauthorizedPageComponent
  },
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'learning/dashboard'
  },
  {
    path: '',
    canMatch: [adaptiveLearningRootGuard],
    loadChildren: () =>
      import('./features/adaptive-learning/adaptive-learning.routes').then(
        ({ adaptiveLearningRoutes }) => adaptiveLearningRoutes
      )
  },
  {
    path: '**',
    redirectTo: 'learning/dashboard'
  }
];
