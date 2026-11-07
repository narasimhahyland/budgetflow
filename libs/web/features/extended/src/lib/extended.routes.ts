import type { Routes } from '@angular/router';
import { requirePermission } from '@bf/web/data-access';

/**
 * /budgets/scenarios: what-if reallocation scenarios (031a).
 *
 * Mounted ahead of the lazy budgets lib in `apps/web`, because `/budgets/scenarios` is more
 * specific than the budget routes behind it. Reading needs `budget.read`; the API decides
 * separately whether the reader may author or promote, and the editor reflects that.
 */
export const scenarioRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'What-if scenarios',
    data: { pageTitle: 'What-if scenarios', section: 'Budgets' },
    canActivate: [requirePermission('budget.read', 'What-if scenarios')],
    loadComponent: () => import('./scenario-list.page').then((m) => m.ScenarioListPage),
  },
  {
    path: 'compare',
    title: 'Compare scenarios',
    data: { pageTitle: 'Compare scenarios', section: 'Budgets' },
    canActivate: [requirePermission('budget.read', 'Compare scenarios')],
    loadComponent: () => import('./scenario-compare.page').then((m) => m.ScenarioComparePage),
  },
  {
    path: ':scenarioId',
    title: 'Scenario',
    data: { pageTitle: 'Scenario', section: 'Budgets' },
    canActivate: [requirePermission('budget.read', 'Scenario')],
    loadComponent: () => import('./scenario-editor.page').then((m) => m.ScenarioEditorPage),
  },
];

/** /insights/summaries and /insights/commentary: drafted leadership narratives (011b). */
export const narrativeRoutes: Routes = [
  {
    path: 'insights/summaries',
    title: 'Leadership summaries',
    data: { pageTitle: 'Leadership summaries', section: 'Insights' },
    canActivate: [requirePermission('report.read', 'Leadership summaries')],
    loadComponent: () => import('./summary-list.page').then((m) => m.SummaryListPage),
  },
  {
    path: 'insights/summaries/:summaryId',
    title: 'Leadership summary',
    data: { pageTitle: 'Leadership summary', section: 'Insights' },
    canActivate: [requirePermission('report.read', 'Leadership summary')],
    loadComponent: () => import('./summary-detail.page').then((m) => m.SummaryDetailPage),
  },
  {
    path: 'insights/commentary',
    title: 'Variance commentary',
    data: { pageTitle: 'Variance commentary', section: 'Insights' },
    canActivate: [requirePermission('budget.read', 'Variance commentary')],
    loadComponent: () => import('./commentary.page').then((m) => m.CommentaryPage),
  },
];

/** /dashboards/outcomes: outcome linkage (015c). */
export const outcomeRoutes: Routes = [
  {
    path: 'dashboards/outcomes',
    title: 'Outcomes',
    data: { pageTitle: 'Outcomes', section: 'Insights' },
    canActivate: [requirePermission('report.read', 'Outcomes')],
    loadComponent: () => import('./outcomes.page').then((m) => m.OutcomesPage),
  },
];

/** /participation: the turnout leaderboard every employee may see (122a). */
export const participationRoutes: Routes = [
  {
    path: 'participation',
    title: 'Participation',
    data: { pageTitle: 'Participation', section: 'Events' },
    canActivate: [requirePermission('tenant.read', 'Participation')],
    loadComponent: () => import('./participation.page').then((m) => m.ParticipationPage),
  },
];

/** /wallets: the employee's own wallets (120b) and the programme reviewer's queue. */
export const walletRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'My wallets',
    data: { pageTitle: 'My wallets', section: 'Requests' },
    canActivate: [requirePermission('tenant.read', 'My wallets')],
    loadComponent: () => import('./wallets.page').then((m) => m.WalletsPage),
  },
  {
    path: 'review',
    title: 'Wallet claims to review',
    data: { pageTitle: 'Wallet claims to review', section: 'Requests' },
    canActivate: [requirePermission('tenant.read', 'Wallet claims to review')],
    loadComponent: () => import('./wallet-review.page').then((m) => m.WalletReviewPage),
  },
];

/** /recognition: the recognition feed (120a) and an organizer's profile (122b). */
export const recognitionRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Recognition',
    data: { pageTitle: 'Recognition', section: 'Requests' },
    canActivate: [requirePermission('tenant.read', 'Recognition')],
    loadComponent: () => import('./recognition.page').then((m) => m.RecognitionPage),
  },
  {
    path: 'organizers/:personId',
    title: 'Organizer',
    data: { pageTitle: 'Organizer', section: 'Requests' },
    canActivate: [requirePermission('tenant.read', 'Organizer')],
    loadComponent: () => import('./organizer.page').then((m) => m.OrganizerPage),
  },
];
