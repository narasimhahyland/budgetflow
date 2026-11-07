import { Route } from '@angular/router';
import { authGuard, sessionGuard } from '@bf/web/data-access';
import { accountingRoutes } from '@bf/web/features/accounting';
import { aiRoutes } from '@bf/web/features/ai';
import { authRoutes } from '@bf/web/features/auth';
import { closeRoutes } from '@bf/web/features/close';
import { narrativeRoutes, outcomeRoutes, participationRoutes } from '@bf/web/features/extended';
import { financeAdminRoutes } from '@bf/web/features/finance-admin';
import { duplicateRoutes, integrationsRoutes } from '@bf/web/features/integrations';
import { orgRoutes } from '@bf/web/features/org';
import { Shell, shellChildRoutes } from '@bf/web/shell';

export const appRoutes: Route[] = [
  ...authRoutes,
  {
    path: 'email-action',
    loadChildren: () => import('@bf/web/features/approvals').then((m) => m.approvalEmailRoutes),
  },
  {
    path: 'link/chat',
    loadChildren: () => import('@bf/web/features/mobile').then((m) => m.chatLinkRoutes),
  },
  {
    path: '',
    component: Shell,
    canActivate: [authGuard, sessionGuard],
    // Feature libs are wired here as children of the shell as their phases land; a lib mounted under its
    // own path loads lazily as one chunk.
    children: [
      // Before `budgets`: /budgets/:budgetId/suggest-split is more specific than the lazy budgets lib.
      ...aiRoutes,
      // Likewise /budgets/scenarios, which the budgets lib would otherwise read as a budget id.
      {
        path: 'budgets/scenarios',
        loadChildren: () => import('@bf/web/features/extended').then((m) => m.scenarioRoutes),
      },
      {
        path: 'budgets',
        loadChildren: () => import('@bf/web/features/budgets').then((m) => m.budgetsRoutes),
      },
      ...orgRoutes,
      ...financeAdminRoutes,
      {
        path: 'events',
        loadChildren: () => import('@bf/web/features/events').then((m) => m.eventRoutes),
      },
      {
        path: 'contributions',
        loadChildren: () => import('@bf/web/features/events').then((m) => m.contributionRoutes),
      },
      {
        path: 'finance/recharges',
        loadChildren: () => import('@bf/web/features/events').then((m) => m.rechargeRoutes),
      },
      {
        path: 'requests',
        loadChildren: () => import('@bf/web/features/requests').then((m) => m.requestRoutes),
      },
      {
        path: 'approvals',
        loadChildren: () => import('@bf/web/features/approvals').then((m) => m.approvalRoutes),
      },
      {
        path: 'admin/rules',
        loadChildren: () => import('@bf/web/features/rules').then((m) => m.rulesRoutes),
      },
      {
        path: 'my',
        loadChildren: () => import('@bf/web/features/employee').then((m) => m.employeeRoutes),
      },
      {
        path: 'notifications',
        loadChildren: () => import('@bf/web/features/mobile').then((m) => m.notificationsRoutes),
      },
      {
        path: 'me',
        loadChildren: () => import('@bf/web/features/mobile').then((m) => m.meChannelsRoutes),
      },
      {
        path: 'admin/channels',
        loadChildren: () => import('@bf/web/features/mobile').then((m) => m.adminChannelsRoutes),
      },
      {
        path: 'admin/digests',
        loadChildren: () => import('@bf/web/features/mobile').then((m) => m.digestsRoutes),
      },
      {
        path: 'm',
        loadChildren: () => import('@bf/web/features/mobile').then((m) => m.mobileAppRoutes),
      },
      {
        path: 'invitations',
        loadChildren: () => import('@bf/web/features/employee').then((m) => m.invitationRoutes),
      },
      {
        path: 'surveys',
        loadChildren: () => import('@bf/web/features/employee').then((m) => m.surveyRoutes),
      },
      {
        path: 'audit-log',
        loadChildren: () => import('@bf/web/features/insights').then((m) => m.auditLogRoutes),
      },
      {
        path: 'reports',
        loadChildren: () => import('@bf/web/features/reports').then((m) => m.reportsRoutes),
      },
      {
        path: 'wallets',
        loadChildren: () => import('@bf/web/features/extended').then((m) => m.walletRoutes),
      },
      {
        path: 'recognition',
        loadChildren: () => import('@bf/web/features/extended').then((m) => m.recognitionRoutes),
      },
      ...narrativeRoutes,
      ...outcomeRoutes,
      ...participationRoutes,
      ...accountingRoutes,
      ...closeRoutes,
      ...integrationsRoutes,
      ...duplicateRoutes,
      ...shellChildRoutes,
    ],
  },
];
