import { inject } from '@angular/core';
import type { ActivatedRouteSnapshot, ResolveFn, Routes } from '@angular/router';
import { ApiService, requirePermission } from '@bf/web/data-access';

/** The event's name for the breadcrumb; an empty string (the page title) if it cannot load. */
const eventName = async (route: ActivatedRouteSnapshot): Promise<string> => {
  const eventId = route.paramMap.get('eventId');
  if (!eventId) return '';
  try {
    const r = await inject(ApiService).client.getEvent({ params: { eventId } });
    return r.ok ? r.data.name : '';
  } catch {
    return '';
  }
};

const EVENTS_CRUMB = { label: 'Events', routerLink: '/events' };

/** Home › Events › <event name> on the event page. */
const eventCrumbLabel: ResolveFn<string> = (route) => eventName(route);

/** Home › <event name> › <section> on the event's sub-pages, so Back returns to the event. */
const eventCrumbParent: ResolveFn<{ label: string; routerLink: string }> = async (route) => {
  const eventId = route.paramMap.get('eventId') ?? '';
  const name = await eventName(route);
  return name ? { label: name, routerLink: `/events/${eventId}` } : EVENTS_CRUMB;
};

/** Event screens under /events (lazy). Visibility of each event is decided by the API. */
export const eventRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Events',
    data: { pageTitle: 'Events', section: 'Events' },
    canActivate: [requirePermission('tenant.read', 'Events')],
    loadComponent: () => import('./events-dashboard.page').then((m) => m.EventsDashboardPage),
  },
  {
    path: 'all',
    title: 'All events',
    data: { pageTitle: 'All events', section: 'Events', crumbParent: EVENTS_CRUMB },
    canActivate: [requirePermission('tenant.read', 'All events')],
    loadComponent: () => import('./events-list.page').then((m) => m.EventsListPage),
  },
  {
    path: 'new',
    title: 'Create event budget',
    data: { pageTitle: 'Create event budget', section: 'Events', crumbParent: EVENTS_CRUMB },
    canActivate: [requirePermission('event.manage', 'Create event budget')],
    loadComponent: () => import('./create-event.page').then((m) => m.CreateEventPage),
  },
  {
    path: 'templates',
    title: 'Event templates',
    data: { pageTitle: 'Event templates', section: 'Events', crumbParent: EVENTS_CRUMB },
    canActivate: [requirePermission('tenant.read', 'Event templates')],
    loadComponent: () => import('./event-templates.page').then((m) => m.EventTemplatesPage),
  },
  {
    path: 'cofunding-board',
    title: 'Co-funding board',
    data: { pageTitle: 'Co-funding board', section: 'Events', crumbParent: EVENTS_CRUMB },
    canActivate: [requirePermission('tenant.read', 'Co-funding board')],
    loadComponent: () => import('./cofunding-board.page').then((m) => m.CofundingBoardPage),
  },
  {
    path: ':eventId',
    pathMatch: 'full',
    title: 'Event',
    data: { pageTitle: 'Event', section: 'Events', crumbParent: EVENTS_CRUMB },
    resolve: { crumbLabel: eventCrumbLabel },
    canActivate: [requirePermission('tenant.read', 'Event')],
    loadComponent: () => import('./event-detail.page').then((m) => m.EventDetailPage),
  },
  {
    path: ':eventId/plan',
    title: 'Event plan',
    data: { pageTitle: 'Event plan', section: 'Events', crumbLabel: 'Plan' },
    resolve: { crumbParent: eventCrumbParent },
    canActivate: [requirePermission('tenant.read', 'Event plan')],
    loadComponent: () => import('./event-plan.page').then((m) => m.EventPlanPage),
  },
  {
    path: ':eventId/people',
    title: 'Event people',
    data: { pageTitle: 'Event people', section: 'Events', crumbLabel: 'People' },
    resolve: { crumbParent: eventCrumbParent },
    canActivate: [requirePermission('tenant.read', 'Event people')],
    loadComponent: () => import('./event-people.page').then((m) => m.EventPeoplePage),
  },
  {
    path: ':eventId/people/:section',
    title: 'Event people',
    data: { pageTitle: 'Event people', section: 'Events', crumbLabel: 'People' },
    resolve: { crumbParent: eventCrumbParent },
    canActivate: [requirePermission('tenant.read', 'Event people')],
    loadComponent: () => import('./event-people.page').then((m) => m.EventPeoplePage),
  },
  {
    path: ':eventId/quotes',
    title: 'Event quotes',
    data: { pageTitle: 'Event quotes', section: 'Events', crumbLabel: 'Quotes' },
    resolve: { crumbParent: eventCrumbParent },
    canActivate: [requirePermission('tenant.read', 'Event quotes')],
    loadComponent: () => import('./event-quotes.page').then((m) => m.EventQuotesPage),
  },
  {
    path: ':eventId/feedback',
    title: 'Event feedback',
    data: { pageTitle: 'Event feedback', section: 'Events', crumbLabel: 'Feedback' },
    resolve: { crumbParent: eventCrumbParent },
    canActivate: [requirePermission('tenant.read', 'Event feedback')],
    loadComponent: () => import('./event-feedback.page').then((m) => m.EventFeedbackPage),
  },
  {
    path: ':eventId/scorecard',
    title: 'Event scorecard',
    data: { pageTitle: 'Event scorecard', section: 'Events', crumbLabel: 'Scorecard' },
    resolve: { crumbParent: eventCrumbParent },
    canActivate: [requirePermission('tenant.read', 'Event scorecard')],
    loadComponent: () => import('./event-scorecard.page').then((m) => m.EventScorecardPage),
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
