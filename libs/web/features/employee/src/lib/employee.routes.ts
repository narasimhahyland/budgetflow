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

/** /invitations/:invitationId: the employee's own event invitation (47a, 47b). */
export const invitationRoutes: Routes = [
  {
    path: ':invitationId',
    title: 'Event invitation',
    data: { pageTitle: 'Event invitation', section: 'Requests' },
    canActivate: [requirePermission('tenant.read', 'Event invitation')],
    loadComponent: () => import('./invitation.page').then((m) => m.InvitationPage),
  },
];

/** /surveys/:surveyId: the anonymous post-event survey (54a). */
export const surveyRoutes: Routes = [
  {
    path: ':surveyId',
    title: 'Event survey',
    data: { pageTitle: 'Event survey', section: 'Requests' },
    canActivate: [requirePermission('tenant.read', 'Event survey')],
    loadComponent: () => import('./survey.page').then((m) => m.SurveyPage),
  },
];
