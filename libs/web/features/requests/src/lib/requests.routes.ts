import type { Routes } from '@angular/router';
import { requirePermission } from '@bf/web/data-access';

/** Request screens under /requests (lazy). */
export const requestRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'My requests',
    data: { pageTitle: 'My requests', section: 'Requests' },
    canActivate: [requirePermission('tenant.read', 'My requests')],
    loadComponent: () => import('./my-requests.page').then((m) => m.MyRequestsPage),
  },
  {
    path: 'new',
    title: 'Request funds',
    data: { pageTitle: 'Request funds', section: 'Requests' },
    canActivate: [requirePermission('request.create', 'Request funds')],
    loadComponent: () => import('./new-request.page').then((m) => m.NewRequestPage),
  },
  {
    path: ':requestId',
    title: 'Request',
    data: { pageTitle: 'Request', section: 'Requests' },
    canActivate: [requirePermission('tenant.read', 'Request')],
    loadComponent: () => import('./request-detail.page').then((m) => m.RequestDetailPage),
  },
];
