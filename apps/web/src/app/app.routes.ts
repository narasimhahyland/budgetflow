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
    // Feature libs are wired here as lazy children of the shell as their phases land.
    children: [...orgRoutes, ...financeAdminRoutes, ...shellChildRoutes],
  },
];
