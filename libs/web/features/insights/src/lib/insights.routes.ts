import type { Routes } from '@angular/router';
import { requirePermission } from '@bf/web/data-access';

/** /audit-log (88). */
export const auditLogRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Audit log',
    data: { pageTitle: 'Audit log', section: 'Insights' },
    canActivate: [requirePermission('audit.read', 'Audit log')],
    loadComponent: () => import('./audit-log.page').then((m) => m.AuditLogPage),
  },
];
