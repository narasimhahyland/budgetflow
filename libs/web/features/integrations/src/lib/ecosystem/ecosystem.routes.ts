import type { Routes } from '@angular/router';
import { requirePermission } from '@bf/web/data-access';

const area = (pageTitle: string) => ({ pageTitle, section: 'Integrations' });
/** Reading the connector screens; Finance Admin, Finance Controller, CEO and Auditor hold it too. */
const read = requirePermission('integration.read', 'Integrations');

/**
 * Phase 16 (092a-092d, 102d): the surfaces that face outside the app. The four connector screens
 * sit in the Integrations area with the rest of 092; the marketplace and the widget embed route do
 * not, because their audiences are organizers and ordinary employees.
 */
export const ecosystemRoutes: Routes = [
  {
    path: 'admin/integrations/bi',
    title: 'BI connector',
    data: area('BI connector'),
    canActivate: [read],
    loadComponent: () => import('./bi.page').then((m) => m.BiConnectorPage),
  },
  {
    path: 'admin/integrations/assistants',
    title: 'Connector for AI assistants',
    data: area('Connector for AI assistants'),
    canActivate: [read],
    loadComponent: () => import('./assistants.page').then((m) => m.AssistantConnectorPage),
  },
  {
    path: 'admin/integrations/automations',
    title: 'No-code automations',
    data: area('No-code automations'),
    canActivate: [read],
    loadComponent: () => import('./automations.page').then((m) => m.AutomationConnectorPage),
  },
  {
    path: 'admin/integrations/partners',
    title: 'Marketplace partners',
    data: area('Marketplace partners'),
    canActivate: [read],
    loadComponent: () => import('./partners.page').then((m) => m.MarketplacePartnersPage),
  },
  {
    /**
     * Widgets are the Organization Admin's to configure and the Integration Admin's to co-manage,
     * so the guard is the tenant read the list endpoint asserts; the page itself hides the controls
     * from a reader who cannot change anything.
     */
    path: 'admin/widgets',
    title: 'Embeddable widgets',
    data: { pageTitle: 'Embeddable widgets', section: 'Admin' },
    canActivate: [requirePermission('tenant.read', 'Embeddable widgets')],
    loadComponent: () => import('./widgets.page').then((m) => m.WidgetsPage),
  },
];

/** 092d for organizers: browsing offers and asking a partner for a price. */
export const marketplaceRoutes: Routes = [
  {
    path: '',
    title: 'Marketplace',
    data: { pageTitle: 'Marketplace', section: 'Events' },
    canActivate: [requirePermission('event.read', 'Marketplace')],
    loadComponent: () => import('./marketplace.page').then((m) => m.MarketplacePage),
  },
  {
    path: 'offers/:offerId',
    title: 'Partner offer',
    data: { pageTitle: 'Partner offer', section: 'Events' },
    canActivate: [requirePermission('event.read', 'Marketplace')],
    loadComponent: () => import('./offer.page').then((m) => m.MarketplaceOfferPage),
  },
];

/**
 * The embed route (102d). It is mounted outside the shell so a host page frames one card and not
 * the whole application, and it keeps the ordinary sign-in guards: the viewer's identity comes from
 * their own BudgetFlow session and never from the page doing the embedding.
 */
export const widgetEmbedRoutes: Routes = [
  {
    path: ':widgetId',
    title: 'BudgetFlow',
    loadComponent: () => import('./embed.page').then((m) => m.WidgetEmbedPage),
  },
];
