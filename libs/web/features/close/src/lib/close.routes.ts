import type { Routes } from '@angular/router';
import { requirePermission } from '@bf/web/data-access';

const area = (pageTitle: string) => ({ pageTitle, section: 'Finance' });
/**
 * Reading the close work needs `ledger.read`; the API then decides at tenant scope, so a budget
 * owner with owned-scope ledger access lands on the page's forbidden state rather than a blank one.
 */
const read = requirePermission('ledger.read', 'Period close and year-end');

/**
 * Period close and lock (80e), rollover policies (87c), the year-end run (87b) and the forecast
 * cycle (87a), as shell children.
 */
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
    path: 'finance/forecast-cycles',
    title: 'Forecast cycles',
    data: area('Forecast cycles'),
    canActivate: [requirePermission('report.read', 'Forecast cycles')],
    loadComponent: () => import('./forecast-cycles.page').then((m) => m.ForecastCyclesPage),
  },
  {
    path: 'finance/forecast-cycles/:cycleId',
    title: 'Forecast cycle',
    data: area('Forecast cycles'),
    canActivate: [requirePermission('report.read', 'Forecast cycles')],
    loadComponent: () => import('./forecast-cycle.page').then((m) => m.ForecastCyclePage),
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
  {
    path: 'finance/reclaim',
    title: 'Reclaim campaigns',
    data: area('Reclaim campaigns'),
    canActivate: [requirePermission('reclaim.read', 'Reclaim campaigns')],
    loadComponent: () => import('./reclaim-campaigns.page').then((m) => m.ReclaimCampaignsPage),
  },
  {
    path: 'finance/reclaim/:campaignId',
    title: 'Reclaim campaign',
    data: area('Reclaim campaigns'),
    canActivate: [requirePermission('reclaim.read', 'Reclaim campaigns')],
    loadComponent: () => import('./reclaim-campaign.page').then((m) => m.ReclaimCampaignPage),
  },
  // Owners answer their notice here (email, task and notification links); the API decides who may.
  {
    path: 'reclaim/:noticeId',
    title: 'Reclaim notice',
    data: { pageTitle: 'Reclaim notice', section: 'Budgets' },
    loadComponent: () => import('./reclaim-notice.page').then((m) => m.ReclaimNoticePage),
  },
];
