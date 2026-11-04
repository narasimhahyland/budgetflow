import type { Routes } from '@angular/router';
import { requirePermission } from '@bf/web/data-access';

const page = (title: string) => ({ pageTitle: title, section: 'Budgets' });

/** Budget screens, lazy-loaded under /budgets by apps/web. The API enforces scope on every call. */
export const budgetsRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Budget hierarchy',
    data: page('Budget hierarchy'),
    canActivate: [requirePermission('budget.read', 'Budget hierarchy')],
    loadComponent: () => import('./hierarchy.page').then((m) => m.BudgetHierarchyPage),
  },
  {
    path: 'list',
    title: 'Budget list',
    data: page('Budget list'),
    canActivate: [requirePermission('budget.read', 'Budget list')],
    loadComponent: () => import('./list.page').then((m) => m.BudgetListPage),
  },
  {
    path: 'new',
    title: 'Create budget',
    data: page('Create budget'),
    canActivate: [requirePermission('budget.create_child', 'Create budget')],
    loadComponent: () => import('./create.page').then((m) => m.CreateBudgetPage),
  },
  {
    path: 'allocate',
    title: 'Allocation workspace',
    data: page('Allocation workspace'),
    canActivate: [requirePermission('budget.allocate', 'Allocation workspace')],
    loadComponent: () => import('./allocate.page').then((m) => m.AllocationWorkspacePage),
  },
  {
    path: 'requests',
    title: 'Budget requests',
    data: page('Budget requests'),
    canActivate: [requirePermission('budget.read', 'Budget requests')],
    loadComponent: () => import('./requests.page').then((m) => m.BudgetRequestsPage),
  },
  {
    path: 'plans',
    title: 'Plans and versions',
    data: page('Plans and versions'),
    canActivate: [requirePermission('budget.create_root', 'Plans and versions')],
    loadComponent: () => import('./plans.page').then((m) => m.PlansPage),
  },
  {
    path: 'templates',
    title: 'Program templates',
    data: page('Program templates'),
    canActivate: [requirePermission('tenant.read', 'Program templates')],
    loadComponent: () => import('./templates.page').then((m) => m.TemplatesPage),
  },
  {
    path: ':budgetId',
    title: 'Budget details',
    data: page('Budget details'),
    canActivate: [requirePermission('budget.read', 'Budget details')],
    loadComponent: () => import('./detail.page').then((m) => m.BudgetDetailPage),
  },
  {
    path: ':budgetId/per-head',
    title: 'Per-head allocation',
    data: page('Per-head allocation'),
    canActivate: [requirePermission('budget.allocate', 'Per-head allocation')],
    loadComponent: () => import('./per-head.page').then((m) => m.PerHeadPage),
  },
];
