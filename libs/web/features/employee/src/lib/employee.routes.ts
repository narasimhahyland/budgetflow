import type { Routes } from '@angular/router';
import { requirePermission } from '@bf/web/data-access';

/** /my: the employee view (everyone is also an employee). */
export const employeeRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'My view',
    data: { pageTitle: 'My view', section: 'Requests' },
    canActivate: [requirePermission('tenant.read', 'My view')],
    loadComponent: () => import('./employee-dashboard.page').then((m) => m.EmployeeDashboardPage),
  },
  {
    path: 'budgets',
    title: 'My budgets',
    data: { pageTitle: 'My budgets', section: 'Requests' },
    canActivate: [requirePermission('tenant.read', 'My budgets')],
    loadComponent: () => import('./my-budgets.page').then((m) => m.MyBudgetsPage),
  },
];
