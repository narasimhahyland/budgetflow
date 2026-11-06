import type { Routes } from '@angular/router';
import { requirePermission } from '@bf/web/data-access';

const area = (pageTitle: string) => ({ pageTitle, section: 'Finance' });
/**
 * Reading the close work needs `ledger.read`; the API then decides at tenant scope, so a budget
 * owner with owned-scope ledger access lands on the page's forbidden state rather than a blank one.
 */
const read = requirePermission('ledger.read', 'Period close and year-end');

/** Period close and lock (80e), rollover policies (87c) and the year-end run (87b), as shell children. */
export const closeRoutes: Routes = [
  {
    path: 'finance/close',
    title: 'Period close',
    data: area('Period close'),
    canActivate: [read],
    loadComponent: () => import('./periods.page').then((m) => m.ClosePeriodsPage),
  },
  {
    path: 'finance/close/:periodId',
    title: 'Period close',
    data: area('Period close'),
    canActivate: [read],
    loadComponent: () => import('./period.page').then((m) => m.ClosePeriodPage),
  },
  {
    path: 'finance/rollover-policies',
    title: 'Rollover policies',
    data: area('Rollover policies'),
    canActivate: [read],
    loadComponent: () => import('./rollover-policies.page').then((m) => m.RolloverPoliciesPage),
  },
  {
    path: 'finance/year-end',
    title: 'Year-end',
    data: area('Year-end'),
    canActivate: [read],
    loadComponent: () => import('./year-end.page').then((m) => m.YearEndPage),
  },
  {
    path: 'finance/year-end/:runId',
    title: 'Year-end run',
    data: area('Year-end'),
    canActivate: [read],
    loadComponent: () => import('./year-end-run.page').then((m) => m.YearEndRunPage),
  },
];
