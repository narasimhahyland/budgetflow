import { Route } from '@angular/router';
import { authGuard, sessionGuard } from '@bf/web/data-access';
import { accountingRoutes } from '@bf/web/features/accounting';
import { authRoutes } from '@bf/web/features/auth';
import { financeAdminRoutes } from '@bf/web/features/finance-admin';
import { orgRoutes } from '@bf/web/features/org';
import { Shell, shellChildRoutes } from '@bf/web/shell';

export const appRoutes: Route[] = [
  ...authRoutes,
  {
    path: 'email-action',
    loadChildren: () => import('@bf/web/features/approvals').then((m) => m.approvalEmailRoutes),
  },
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
      {
        path: 'events',
        loadChildren: () => import('@bf/web/features/events').then((m) => m.eventRoutes),
      },
      {
        path: 'contributions',
        loadChildren: () => import('@bf/web/features/events').then((m) => m.contributionRoutes),
      },
      {
        path: 'finance/recharges',
        loadChildren: () => import('@bf/web/features/events').then((m) => m.rechargeRoutes),
      },
      {
        path: 'requests',
        loadChildren: () => import('@bf/web/features/requests').then((m) => m.requestRoutes),
      },
      {
        path: 'approvals',
        loadChildren: () => import('@bf/web/features/approvals').then((m) => m.approvalRoutes),
      },
      {
        path: 'admin/rules',
        loadChildren: () => import('@bf/web/features/rules').then((m) => m.rulesRoutes),
      },
      {
        path: 'my',
        loadChildren: () => import('@bf/web/features/employee').then((m) => m.employeeRoutes),
      },
      {
        path: 'audit-log',
        loadChildren: () => import('@bf/web/features/insights').then((m) => m.auditLogRoutes),
      },
      {
        path: 'reports/utilization',
        loadChildren: () => import('@bf/web/features/insights').then((m) => m.utilizationRoutes),
      },
      ...accountingRoutes,
      ...shellChildRoutes,
    ],
  },
];
