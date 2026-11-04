import { Route } from '@angular/router';
import { authGuard, sessionGuard } from '@bf/web/data-access';
import { authRoutes } from '@bf/web/features/auth';
import { Shell, shellChildRoutes } from '@bf/web/shell';

export const appRoutes: Route[] = [
  ...authRoutes,
  {
    path: '',
    component: Shell,
    canActivate: [authGuard, sessionGuard],
    // Feature libs are lazy children of the shell (each lib is its own chunk), ahead of the placeholders.
    children: [
      {
        path: 'budgets',
        loadChildren: () => import('@bf/web/features/budgets').then((m) => m.budgetsRoutes),
      },
      { path: '', loadChildren: () => import('@bf/web/features/org').then((m) => m.orgRoutes) },
      {
        path: '',
        loadChildren: () =>
          import('@bf/web/features/finance-admin').then((m) => m.financeAdminRoutes),
      },
      ...shellChildRoutes,
    ],
  },
];
