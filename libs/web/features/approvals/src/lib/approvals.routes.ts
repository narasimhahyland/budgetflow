import type { Routes } from '@angular/router';
import { requirePermission } from '@bf/web/data-access';

/** Approval screens under /approvals (lazy). The API decides authority on every decision. */
export const approvalRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Approval inbox',
    data: { pageTitle: 'Approval inbox', section: 'Requests' },
    canActivate: [requirePermission('tenant.read', 'Approval inbox')],
    loadComponent: () => import('./inbox.page').then((m) => m.InboxPage),
  },
  {
    path: 'history',
    title: 'Approval history',
    data: { pageTitle: 'Approval history', section: 'Insights' },
    canActivate: [requirePermission('tenant.read', 'Approval history')],
    loadComponent: () => import('./history.page').then((m) => m.ApprovalHistoryPage),
  },
  {
    path: 'delegations',
    title: 'Delegations',
    data: { pageTitle: 'Delegations', section: 'Requests' },
    canActivate: [requirePermission('tenant.read', 'Delegations')],
    loadComponent: () => import('./delegations.page').then((m) => m.DelegationsPage),
  },
];

/** Public landing page for actionable email links (outside the shell, no sign-in needed: the link is the credential). */
export const approvalEmailRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Approval from email',
    loadComponent: () => import('./email-action.page').then((m) => m.EmailActionPage),
  },
];
