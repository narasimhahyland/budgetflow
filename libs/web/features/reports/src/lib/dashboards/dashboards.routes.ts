import type { Routes } from '@angular/router';
import { requirePermission } from '@bf/web/data-access';

/**
 * Gap package B2 dashboards. Mounted from `apps/web` at their spec paths (`/dashboards/*`, and
 * `/home/finance` for 012). The guard checks the action the API asks first; an owner who reaches a
 * finance-only page sees the API's 403 as `sat-403-error-state`.
 */
export const financeDashboardRoutes: Routes = [
  {
    path: '',
    title: 'Finance overview',
    data: { pageTitle: 'Finance overview', section: 'Insights' },
    canActivate: [requirePermission('report.read', 'Finance overview')],
    loadComponent: () => import('./finance-overview.page').then((m) => m.FinanceOverviewPage),
  },
];

export const alertsDashboardRoutes: Routes = [
  {
    path: '',
    title: 'Alerts',
    data: { pageTitle: 'Alerts', section: 'Insights' },
    canActivate: [requirePermission('report.read', 'Alerts')],
    loadComponent: () => import('./alerts.page').then((m) => m.AlertsPage),
  },
];

export const exceptionsDashboardRoutes: Routes = [
  {
    path: '',
    title: 'Exceptions',
    data: { pageTitle: 'Exceptions', section: 'Insights' },
    canActivate: [requirePermission('report.read', 'Exceptions')],
    loadComponent: () => import('./exceptions.page').then((m) => m.ExceptionsDashboardPage),
  },
];
