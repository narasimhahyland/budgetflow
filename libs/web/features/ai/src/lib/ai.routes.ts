import type { Routes } from '@angular/router';
import { requirePermission } from '@bf/web/data-access';

const area = (pageTitle: string, section: string) => ({ pageTitle, section });

/**
 * Phase 13, the AI layer: 011a Ask BudgetFlow, 061f the same questions from Slack and Teams, 016b
 * spending outlook and nudges, 017c anomaly flags, 022d suggested allocations, 069a policy
 * assistant, 080f matching suggestions, 113a AI settings and query log, 121a receipt and quote
 * extraction.
 *
 * `/budgets/:budgetId/suggest-split` is more specific than the lazily loaded `budgets` route, so
 * these routes are spread before it in `apps/web`.
 */
export const aiRoutes: Routes = [
  {
    path: 'ask',
    title: 'Ask BudgetFlow',
    data: area('Ask BudgetFlow', 'Assistant'),
    canActivate: [requirePermission('tenant.read', 'Ask BudgetFlow')],
    loadComponent: () => import('./ask.page').then((m) => m.AskPage),
  },
  {
    path: 'ask/chat',
    title: 'Ask BudgetFlow in Slack and Teams',
    data: area('Questions in Slack and Teams', 'Assistant'),
    canActivate: [requirePermission('tenant.read', 'Questions in Slack and Teams')],
    loadComponent: () => import('./ask-chat.page').then((m) => m.AskChatPage),
  },
  {
    path: 'policy-assistant',
    title: 'Policy assistant',
    data: area('Policy assistant', 'Requests'),
    canActivate: [requirePermission('tenant.read', 'Policy assistant')],
    loadComponent: () => import('./policy-assistant.page').then((m) => m.PolicyAssistantPage),
  },
  {
    path: 'insights/outlook',
    title: 'Spending outlook',
    data: area('Spending outlook and nudges', 'Insights'),
    canActivate: [requirePermission('budget.read', 'Spending outlook')],
    loadComponent: () => import('./outlook.page').then((m) => m.OutlookPage),
  },
  {
    path: 'finance/anomalies',
    title: 'Anomaly flags',
    data: area('Anomaly flags', 'Finance'),
    canActivate: [requirePermission('integrity.read', 'Anomaly flags')],
    loadComponent: () => import('./anomalies.page').then((m) => m.AnomaliesPage),
  },
  {
    path: 'finance/actuals/suggestions',
    title: 'Matching suggestions',
    data: area('AI matching suggestions', 'Finance'),
    canActivate: [requirePermission('actuals.read', 'Matching suggestions')],
    loadComponent: () => import('./matching.page').then((m) => m.MatchingPage),
  },
  {
    path: 'documents/extraction',
    title: 'Receipt and quote details',
    data: area('Receipt and quote details', 'Requests'),
    canActivate: [requirePermission('tenant.read', 'Receipt and quote details')],
    loadComponent: () => import('./extraction.page').then((m) => m.ExtractionPage),
  },
  {
    path: 'budgets/:budgetId/suggest-split',
    title: 'Suggested allocations',
    data: area('Suggested allocations', 'Budgets'),
    canActivate: [requirePermission('budget.allocate', 'Suggested allocations')],
    loadComponent: () => import('./suggest-split.page').then((m) => m.SuggestSplitPage),
  },
  {
    path: 'admin/ai',
    pathMatch: 'full',
    redirectTo: 'admin/ai/features',
  },
  {
    path: 'admin/ai/features',
    title: 'AI features',
    data: area('AI settings', 'Admin'),
    canActivate: [requirePermission('tenant.read', 'AI settings')],
    loadComponent: () => import('./ai-settings.page').then((m) => m.AiSettingsPage),
  },
  {
    path: 'admin/ai/log',
    title: 'AI query log',
    data: area('AI query log', 'Admin'),
    canActivate: [requirePermission('tenant.read', 'AI query log')],
    loadComponent: () => import('./query-log.page').then((m) => m.QueryLogPage),
  },
  {
    path: 'admin/ai/accuracy',
    title: 'AI accuracy',
    data: area('AI accuracy', 'Admin'),
    canActivate: [requirePermission('tenant.read', 'AI accuracy')],
    loadComponent: () => import('./accuracy.page').then((m) => m.AccuracyPage),
  },
];
