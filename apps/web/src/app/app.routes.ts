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
    // Feature libs are wired here as lazy children of the shell as their phases land.
    children: shellChildRoutes,
  },
];
