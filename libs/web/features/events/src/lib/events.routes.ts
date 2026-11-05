import type { Routes } from '@angular/router';
import { requirePermission } from '@bf/web/data-access';

/** Event screens under /events (lazy). Visibility of each event is decided by the API. */
export const eventRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Events',
    data: { pageTitle: 'Events', section: 'Events' },
    canActivate: [requirePermission('tenant.read', 'Events')],
    loadComponent: () => import('./events-list.page').then((m) => m.EventsListPage),
  },
  {
    path: 'new',
    title: 'Create event budget',
    data: { pageTitle: 'Create event budget', section: 'Events' },
    canActivate: [requirePermission('event.manage', 'Create event budget')],
    loadComponent: () => import('./create-event.page').then((m) => m.CreateEventPage),
  },
  {
    path: 'cofunding-board',
    title: 'Co-funding board',
    data: { pageTitle: 'Co-funding board', section: 'Events' },
    canActivate: [requirePermission('tenant.read', 'Co-funding board')],
    loadComponent: () => import('./cofunding-board.page').then((m) => m.CofundingBoardPage),
  },
  {
    path: ':eventId',
    title: 'Event',
    data: { pageTitle: 'Event', section: 'Events' },
    canActivate: [requirePermission('tenant.read', 'Event')],
    loadComponent: () => import('./event-detail.page').then((m) => m.EventDetailPage),
  },
];

/** /contributions/:contributionId (Inter-Director Budget Contribution Request, 56a). */
export const contributionRoutes: Routes = [
  {
    path: ':contributionId',
    title: 'Inter-Director Budget Contribution Request',
    data: { pageTitle: 'Inter-Director Budget Contribution Request', section: 'Requests' },
    canActivate: [requirePermission('tenant.read', 'Contribution request')],
    loadComponent: () => import('./contribution.page').then((m) => m.ContributionPage),
  },
];

/** /finance/recharges (53a). */
export const rechargeRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Intercompany recharges',
    data: { pageTitle: 'Intercompany recharges', section: 'Finance' },
    canActivate: [requirePermission('actuals.manage', 'Intercompany recharges')],
    loadComponent: () => import('./recharges.page').then((m) => m.RechargesPage),
  },
];
