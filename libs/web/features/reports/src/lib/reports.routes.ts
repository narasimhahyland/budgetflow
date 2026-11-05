import type { ActivatedRouteSnapshot, Routes } from '@angular/router';
import { requirePermission } from '@bf/web/data-access';

/**
 * Breadcrumb and browser-tab names. The heading on the page itself is the name the API returns with
 * the report, so these only have to be recognisable before the run comes back.
 */
const REPORT_TITLES: Record<string, string> = {
  'budget-vs-actual': 'Budget versus actual',
  allocation: 'Allocation',
  utilization: 'Utilization',
  'location-comparison': 'Location comparison',
  'department-comparison': 'Department comparison',
  'event-spending': 'Event spending',
  'unused-expired': 'Unused and expired budget',
  'spend-per-head': 'Spend per head by location',
  'participation-reach': 'Participation and reach',
};

const reportTitle = (route: ActivatedRouteSnapshot): string =>
  REPORT_TITLES[route.paramMap.get('reportId') ?? ''] ?? 'Report';

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
    title: reportTitle,
    data: { section: 'Insights' },
    // Resolved values merge into the route data the shell reads for the breadcrumb.
    resolve: { pageTitle: reportTitle },
    canActivate: [requirePermission('report.read', 'Reports')],
    loadComponent: () => import('./report.page').then((m) => m.ReportPage),
  },
];
