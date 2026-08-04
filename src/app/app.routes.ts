import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'learning/dashboard'
  },
  {
    path: '',
    loadChildren: () =>
      import('./features/adaptive-learning/adaptive-learning.routes').then(
        ({ adaptiveLearningRoutes }) => adaptiveLearningRoutes
      )
  }
];
