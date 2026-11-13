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

export const pendingApprovalsDashboardRoutes: Routes = [
  {
    path: '',
    title: 'Pending approvals',
    data: { pageTitle: 'Pending approvals', section: 'Insights' },
    canActivate: [requirePermission('report.read', 'Pending approvals')],
    loadComponent: () => import('./pending-approvals.page').then((m) => m.PendingApprovalsPage),
  },
];

export const approvalPerformanceRoutes: Routes = [
  {
    path: '',
    title: 'Approval performance',
    data: { pageTitle: 'Approval performance', section: 'Insights' },
    canActivate: [requirePermission('report.read', 'Approval performance')],
    loadComponent: () =>
      import('./approval-performance.page').then((m) => m.ApprovalPerformancePage),
  },
];

/**
 * 018b sits under Admin. The API admits `tenant.settings.manage` or `report.read` at tenant scope,
 * two actions the guard cannot combine, so the guard only asks for tenant membership and a refused
 * role sees the API's 403 as `sat-403-error-state`.
 */
export const productAnalyticsRoutes: Routes = [
  {
    path: '',
    title: 'Product analytics',
    data: { pageTitle: 'Product analytics', section: 'Administration' },
    canActivate: [requirePermission('tenant.read', 'Product analytics')],
    loadComponent: () => import('./product-analytics.page').then((m) => m.ProductAnalyticsPage),
  },
];

export const evidencePackRoutes: Routes = [
  {
    path: '',
    title: 'Evidence packs',
    data: { pageTitle: 'Evidence packs', section: 'Insights' },
    canActivate: [requirePermission('audit.read', 'Evidence packs')],
    loadComponent: () => import('./evidence-packs.page').then((m) => m.EvidencePacksPage),
  },
];
