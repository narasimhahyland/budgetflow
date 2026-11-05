import type { Routes } from '@angular/router';
import { requirePermission } from '@bf/web/data-access';

/**
 * /reports — the Phase 10 catalog (79), budget health (13), scheduled delivery (91) and the shared
 * report frame (80-86, 15a, 15b). The static paths come before `:reportId` so they win the match.
 */
export const reportsRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Reports',
    data: { pageTitle: 'Reports', section: 'Insights' },
    canActivate: [requirePermission('report.read', 'Reports')],
    loadComponent: () => import('./catalog.page').then((m) => m.ReportCatalogPage),
  },
  {
    path: 'health',
    title: 'Budget health',
    data: { pageTitle: 'Budget health', section: 'Insights' },
    canActivate: [requirePermission('report.read', 'Budget health')],
    loadComponent: () => import('./health.page').then((m) => m.BudgetHealthPage),
  },
  {
    path: 'schedules',
    title: 'Scheduled reports',
    data: { pageTitle: 'Scheduled reports', section: 'Insights' },
    canActivate: [requirePermission('report.read', 'Scheduled reports')],
    loadComponent: () => import('./schedules.page').then((m) => m.ReportSchedulesPage),
  },
  {
    path: ':reportId',
    title: 'Report',
    data: { pageTitle: 'Report', section: 'Insights' },
    canActivate: [requirePermission('report.read', 'Reports')],
    loadComponent: () => import('./report.page').then((m) => m.ReportPage),
  },
];
