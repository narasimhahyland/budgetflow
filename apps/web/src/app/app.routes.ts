import { Route } from '@angular/router';
import { authGuard, sessionGuard } from '@bf/web/data-access';
import { authRoutes } from '@bf/web/features/auth';
import { financeAdminRoutes } from '@bf/web/features/finance-admin';
import { orgRoutes } from '@bf/web/features/org';
import { Shell, shellChildRoutes } from '@bf/web/shell';

export const appRoutes: Route[] = [
  ...authRoutes,
  {
    path: '',
    component: Shell,
    canActivate: [authGuard, sessionGuard],
    // Feature libs are wired here as children of the shell as their phases land; a lib mounted under its
    // own path loads lazily as one chunk.
    children: [
      {
        path: 'budgets',
        loadChildren: () => import('@bf/web/features/budgets').then((m) => m.budgetsRoutes),
      },
      ...orgRoutes,
      ...financeAdminRoutes,
      ...shellChildRoutes,
    ],
  },
];
