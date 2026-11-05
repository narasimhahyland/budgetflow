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
    path: 'event-funding',
    title: 'Request event funding',
    data: { pageTitle: 'Request event funding', section: 'Requests' },
    canActivate: [requirePermission('event.manage', 'Request event funding')],
    loadComponent: () => import('./event-funding.page').then((m) => m.EventFundingPage),
  },
  {
    path: 'approved',
    title: 'Approved for you',
    data: { pageTitle: 'Approved for you', section: 'Requests' },
    canActivate: [requirePermission('tenant.read', 'Approved for you')],
    loadComponent: () => import('./approved.page').then((m) => m.ApprovedPage),
  },
  {
    path: 'upload',
    title: 'Upload a receipt',
    data: { pageTitle: 'Upload a receipt', section: 'Requests' },
    canActivate: [requirePermission('request.create', 'Upload a receipt')],
    loadComponent: () => import('./upload-receipt.page').then((m) => m.UploadReceiptPage),
  },
  {
    path: ':requestId',
    title: 'Request',
    data: { pageTitle: 'Request', section: 'Requests' },
    canActivate: [requirePermission('tenant.read', 'Request')],
    loadComponent: () => import('./request-detail.page').then((m) => m.RequestDetailPage),
  },
];
