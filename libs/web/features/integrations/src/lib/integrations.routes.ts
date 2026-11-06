import type { Routes } from '@angular/router';
import { requirePermission } from '@bf/web/data-access';

const area = (pageTitle: string) => ({ pageTitle, section: 'Integrations' });
/** Reading the connector screens; Finance Admin, Finance Controller, CEO and Auditor hold it too. */
const read = requirePermission('integration.read', 'Integrations');

/**
 * Phase 12 integration screens (092, 093-098, 094a, 099, 99b, 100, 101), mounted under the Admin >
 * Integrations navigation entry. Every connector uses the one detail frame of 092.
 */
export const integrationsRoutes: Routes = [
  {
    path: 'admin/integrations',
    title: 'Integrations',
    data: area('Integrations'),
    canActivate: [read],
    loadComponent: () => import('./hub.page').then((m) => m.HubPage),
  },
  {
    path: 'admin/integrations/sync',
    title: 'Sync status',
    data: area('Sync status'),
    canActivate: [read],
    loadComponent: () => import('./sync.page').then((m) => m.SyncPage),
  },
  {
    path: 'admin/integrations/errors',
    title: 'Errors and retries',
    data: area('Errors and retries'),
    canActivate: [read],
    loadComponent: () => import('./errors.page').then((m) => m.ErrorsPage),
  },
  {
    path: 'admin/integrations/pushes',
    title: 'Event codes and card limits',
    data: area('Pushes'),
    canActivate: [read],
    loadComponent: () => import('./pushes.page').then((m) => m.PushesPage),
  },
  {
    path: 'admin/integrations/api-keys',
    title: 'API keys',
    data: area('API keys'),
    canActivate: [read],
    loadComponent: () => import('./api-keys.page').then((m) => m.ApiKeysPage),
  },
  {
    path: 'admin/integrations/webhooks',
    title: 'Webhooks',
    data: area('Webhooks'),
    canActivate: [read],
    loadComponent: () => import('./webhooks.page').then((m) => m.WebhooksPage),
  },
  {
    path: 'admin/integrations/identity',
    title: 'Identity and SCIM',
    data: area('Identity and SCIM'),
    canActivate: [read],
    loadComponent: () => import('./identity.page').then((m) => m.IdentityPage),
  },
  {
    path: 'admin/integrations/connections/:connectionId',
    title: 'Connector',
    data: area('Connector'),
    canActivate: [read],
    loadComponent: () => import('./connection.page').then((m) => m.ConnectionPage),
  },
];

/** 099a sits with the actuals queue it protects, and is linked from the connector screens. */
export const duplicateRoutes: Routes = [
  {
    path: 'finance/actuals/duplicates',
    title: 'Cross-source duplicates',
    data: { pageTitle: 'Cross-source duplicates', section: 'Finance' },
    canActivate: [requirePermission('actuals.read', 'Cross-source duplicates')],
    loadComponent: () => import('./duplicates.page').then((m) => m.DuplicatesPage),
  },
];
