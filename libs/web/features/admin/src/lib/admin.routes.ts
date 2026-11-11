import type { Routes } from '@angular/router';
import { requirePermission } from '@bf/web/data-access';

/**
 * Administration and experience screens as shell children (paths from the shell root).
 *
 * Reads are authorized with `tenant.read`, which is what every administration endpoint in this
 * phase checks, except user administration and owner invites, which the API gates on
 * `users.manage`. What a person may *change* is not a route concern: each page asks the API
 * (`allowedActions` on settings, `GET /api/me` permissions elsewhere) and hides only what the API
 * would refuse.
 */
export const adminRoutes: Routes = [
  {
    path: 'admin/features',
    title: 'Feature flags',
    data: { pageTitle: 'Feature flags', section: 'Admin' },
    canActivate: [requirePermission('tenant.read', 'Feature flags')],
    loadComponent: () => import('./feature-flags.page').then((m) => m.FeatureFlagsPage),
  },
  {
    path: 'admin/retention',
    title: 'Data retention',
    data: { pageTitle: 'Data retention and legal holds', section: 'Admin' },
    canActivate: [requirePermission('tenant.read', 'Data retention')],
    loadComponent: () => import('./retention.page').then((m) => m.RetentionPage),
  },
  {
    path: 'admin/users',
    pathMatch: 'full',
    title: 'Users and roles',
    data: { pageTitle: 'Users and roles', section: 'Admin' },
    canActivate: [requirePermission('users.manage', 'Users and roles')],
    loadComponent: () => import('./users.page').then((m) => m.UsersPage),
  },
  {
    path: 'admin/users/invitations',
    title: 'Invite budget owners',
    data: { pageTitle: 'Invite budget owners', section: 'Admin' },
    canActivate: [requirePermission('users.manage', 'Invite budget owners')],
    loadComponent: () => import('./owner-invites.page').then((m) => m.OwnerInvitesPage),
  },
  {
    path: 'admin/settings',
    title: 'Company settings',
    data: { pageTitle: 'Company settings', section: 'Admin' },
    canActivate: [requirePermission('tenant.read', 'Company settings')],
    loadComponent: () => import('./settings.page').then((m) => m.AdminSettingsPage),
  },
  {
    // No route guard: the platform operator holds no tenant permission besides asking for access, so
    // the page relies on the API, which answers 403 to anyone who may neither read nor request.
    path: 'admin/security/break-glass',
    title: 'Break-glass access',
    data: { pageTitle: 'Break-glass access', section: 'Admin' },
    loadComponent: () => import('./break-glass.page').then((m) => m.BreakGlassPage),
  },
  {
    path: 'admin/health',
    title: 'System health',
    data: { pageTitle: 'System health', section: 'Admin' },
    canActivate: [requirePermission('tenant.read', 'System health')],
    loadComponent: () => import('./health.page').then((m) => m.SystemHealthPage),
  },
  {
    path: 'admin/setup',
    title: 'Set up BudgetFlow',
    data: { pageTitle: 'Set up BudgetFlow', section: 'Admin' },
    canActivate: [requirePermission('tenant.read', 'Set up BudgetFlow')],
    loadComponent: () => import('./setup-checklist.page').then((m) => m.SetupChecklistPage),
  },
  {
    path: 'my/activity',
    title: 'My activity',
    data: { pageTitle: 'My activity', section: 'My BudgetFlow' },
    loadComponent: () => import('./my-activity.page').then((m) => m.MyActivityPage),
  },
];
