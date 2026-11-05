import type { Routes } from '@angular/router';
import { requirePermission } from '@bf/web/data-access';

const section = 'Admin';
const guard = (title: string) => [requirePermission('rules.read', title)];

/**
 * Rules and policies under /admin/rules (lazy). Reading needs `rules.read`; every change is
 * authorized again by the API, which also decides what `allowedActions` each screen may offer.
 */
export const rulesRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Rules and policies',
    data: { pageTitle: 'Rules and policies', section },
    canActivate: guard('Rules and policies'),
    loadComponent: () => import('./overview.page').then((m) => m.RulesOverviewPage),
  },
  {
    path: 'list',
    title: 'All rules',
    data: { pageTitle: 'All rules', section },
    canActivate: guard('All rules'),
    loadComponent: () => import('./rules-list.page').then((m) => m.RulesListPage),
  },
  {
    path: 'simulate',
    title: 'Test a request',
    data: { pageTitle: 'Test a request', section },
    canActivate: guard('Test a request'),
    loadComponent: () => import('./simulate.page').then((m) => m.SimulatePage),
  },
  {
    path: 'backtest',
    title: 'Check against past requests',
    data: { pageTitle: 'Check against past requests', section },
    canActivate: guard('Check against past requests'),
    loadComponent: () => import('./backtest.page').then((m) => m.BacktestPage),
  },
  {
    path: 'routing',
    title: 'Approval routing',
    data: { pageTitle: 'Approval routing', section },
    canActivate: guard('Approval routing'),
    loadComponent: () => import('./routing.page').then((m) => m.RoutingPage),
  },
  {
    path: 'doa',
    title: 'Approval limits',
    data: { pageTitle: 'Approval limits', section },
    canActivate: [requirePermission('doa.read', 'Approval limits')],
    loadComponent: () => import('./doa-admin.page').then((m) => m.DoaAdminPage),
  },
  {
    path: 'thresholds',
    title: 'Approval thresholds and templates',
    data: { pageTitle: 'Approval thresholds and templates', section },
    canActivate: guard('Approval thresholds and templates'),
    loadComponent: () => import('./thresholds.page').then((m) => m.ThresholdsPage),
  },
  {
    path: 'exceptions',
    title: 'Post-spend exceptions',
    data: { pageTitle: 'Post-spend exceptions', section },
    canActivate: guard('Post-spend exceptions'),
    loadComponent: () => import('./exceptions.page').then((m) => m.ExceptionsPage),
  },
  {
    path: 'policies/:section',
    title: 'Policy settings',
    data: { pageTitle: 'Policy settings', section },
    canActivate: guard('Policy settings'),
    loadComponent: () => import('./policies.page').then((m) => m.PoliciesPage),
  },
  {
    path: ':ruleId',
    title: 'Rule',
    data: { pageTitle: 'Rule', section },
    canActivate: guard('Rule'),
    loadComponent: () => import('./rule-detail.page').then((m) => m.RuleDetailPage),
  },
  {
    path: ':ruleId/history',
    title: 'Rule history',
    data: { pageTitle: 'Rule history', section },
    canActivate: guard('Rule history'),
    loadComponent: () => import('./rule-history.page').then((m) => m.RuleHistoryPage),
  },
];
