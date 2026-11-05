import type { Routes } from '@angular/router';
import { requirePermission } from '@bf/web/data-access';

const area = (pageTitle: string) => ({ pageTitle, section: 'Finance' });
const read = requirePermission('actuals.read', 'Actuals and matching');

/** Actuals and accounting screens (80a-80d, 85a, 53, 54) and the GL tie-out (80c), as shell children. */
export const accountingRoutes: Routes = [
  {
    path: 'finance/actuals',
    title: 'Actuals import',
    data: area('Actuals and matching'),
    canActivate: [read],
    loadComponent: () => import('./import.page').then((m) => m.ImportPage),
  },
  {
    path: 'finance/actuals/queue',
    title: 'Unmatched actuals',
    data: area('Unmatched queue'),
    canActivate: [read],
    loadComponent: () => import('./queue.page').then((m) => m.QueuePage),
  },
  {
    path: 'finance/actuals/matched',
    title: 'Matched actuals',
    data: area('Matched actuals'),
    canActivate: [read],
    loadComponent: () => import('./matched.page').then((m) => m.MatchedPage),
  },
  {
    path: 'finance/actuals/rules',
    title: 'Mapping rules',
    data: area('Mapping rules'),
    canActivate: [read],
    loadComponent: () => import('./rules.page').then((m) => m.RulesPage),
  },
  {
    path: 'finance/actuals/accruals',
    title: 'Accruals and prepaids',
    data: area('Accruals and prepaids'),
    canActivate: [read],
    loadComponent: () => import('./accruals.page').then((m) => m.AccrualsPage),
  },
  {
    path: 'finance/actuals/commitments',
    title: 'Commitment hygiene',
    data: area('Commitment hygiene'),
    canActivate: [read],
    loadComponent: () => import('./commitments.page').then((m) => m.CommitmentsPage),
  },
  {
    path: 'finance/actuals/events',
    title: 'Event reconciliation',
    data: area('Event reconciliation'),
    canActivate: [read],
    loadComponent: () => import('./events.page').then((m) => m.EventsPage),
  },
  {
    path: 'finance/actuals/events/:eventId',
    title: 'Event reconciliation',
    data: area('Event reconciliation'),
    canActivate: [read],
    loadComponent: () => import('./event.page').then((m) => m.EventPage),
  },
  {
    path: 'finance/gl-tie-out',
    title: 'GL tie-out',
    data: area('GL tie-out'),
    canActivate: [requirePermission('actuals.read', 'GL tie-out')],
    loadComponent: () => import('./tieout.page').then((m) => m.TieOutPage),
  },
];
