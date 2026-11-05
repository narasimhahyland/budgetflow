import type { Routes } from '@angular/router';
import { authGuard, requirePermission, sessionGuard } from '@bf/web/data-access';

/** Screen 123: Notifications and tasks (`/notifications`). */
export const notificationsRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Notifications and tasks',
    data: { pageTitle: 'Notifications and tasks', section: 'Requests' },
    canActivate: [requirePermission('tenant.read', 'Notifications and tasks')],
    loadComponent: () => import('./notifications.page').then((m) => m.NotificationsPage),
  },
];

/** Screens 059c & 060a under `/me/*`. */
export const meChannelsRoutes: Routes = [
  {
    path: 'notifications',
    title: 'Notification settings',
    data: { pageTitle: 'Notification settings', section: 'Profile' },
    canActivate: [requirePermission('tenant.read', 'Notification settings')],
    loadComponent: () =>
      import('./notification-settings.page').then((m) => m.NotificationSettingsPage),
  },
  {
    path: 'following',
    title: 'Following',
    data: { pageTitle: 'Following', section: 'Profile' },
    canActivate: [requirePermission('tenant.read', 'Following')],
    loadComponent: () => import('./following.page').then((m) => m.FollowingPage),
  },
];

/** Screens 061e, 061b, 061c, 061d under `/admin/channels`. */
export const adminChannelsRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Channels',
    data: { pageTitle: 'Channels', section: 'Admin' },
    canActivate: [requirePermission('tenant.read', 'Channels')],
    loadComponent: () => import('./admin-channels.page').then((m) => m.AdminChannelsPage),
  },
  {
    path: 'cards',
    title: 'Slack and Teams cards',
    data: { pageTitle: 'Slack and Teams cards', section: 'Admin' },
    canActivate: [requirePermission('tenant.read', 'Slack and Teams cards')],
    loadComponent: () => import('./chat-cards.page').then((m) => m.ChatCardsPage),
  },
];

/** Screen 064a under `/admin/digests`. */
export const digestsRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Digest templates',
    data: { pageTitle: 'Digest templates', section: 'Admin' },
    canActivate: [requirePermission('tenant.read', 'Digest templates')],
    loadComponent: () => import('./digests.page').then((m) => m.DigestsPage),
  },
  {
    path: ':templateId',
    title: 'Digest template editor',
    data: { pageTitle: 'Digest template editor', section: 'Admin' },
    canActivate: [requirePermission('tenant.read', 'Digest template editor')],
    loadComponent: () => import('./digests.page').then((m) => m.DigestsPage),
  },
];

/** Screens 059a, 059b, 059c, 123 mobile under `/m/*`. */
export const mobileAppRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'approvals',
  },
  {
    path: 'approvals',
    title: 'Mobile approvals',
    data: { pageTitle: 'Mobile approvals', section: 'Mobile' },
    canActivate: [requirePermission('tenant.read', 'Mobile approvals')],
    loadComponent: () => import('./mobile-approvals.page').then((m) => m.MobileApprovalsPage),
  },
  {
    path: 'approvals/:taskId',
    title: 'Mobile approval detail',
    data: { pageTitle: 'Mobile approval detail', section: 'Mobile' },
    canActivate: [requirePermission('tenant.read', 'Mobile approval detail')],
    loadComponent: () => import('./mobile-approvals.page').then((m) => m.MobileApprovalsPage),
  },
  {
    path: 'balance',
    title: 'Mobile balance check',
    data: { pageTitle: 'Mobile balance check', section: 'Mobile' },
    canActivate: [requirePermission('tenant.read', 'Mobile balance check')],
    loadComponent: () => import('./mobile-balance.page').then((m) => m.MobileBalancePage),
  },
  {
    path: 'receipt',
    title: 'Mobile receipt capture',
    data: { pageTitle: 'Mobile receipt capture', section: 'Mobile' },
    canActivate: [requirePermission('tenant.read', 'Mobile receipt capture')],
    loadComponent: () => import('./mobile-balance.page').then((m) => m.MobileBalancePage),
  },
  {
    path: 'alerts',
    title: 'Mobile alerts',
    data: { pageTitle: 'Mobile alerts', section: 'Mobile' },
    canActivate: [requirePermission('tenant.read', 'Mobile alerts')],
    loadComponent: () => import('./notifications.page').then((m) => m.NotificationsPage),
  },
  {
    path: 'settings/notifications',
    title: 'Mobile notification settings',
    data: { pageTitle: 'Mobile notification settings', section: 'Mobile' },
    canActivate: [requirePermission('tenant.read', 'Mobile notification settings')],
    loadComponent: () =>
      import('./notification-settings.page').then((m) => m.NotificationSettingsPage),
  },
];

/** Screen 061e account-linking page outside the shell (`/link/chat`). */
export const chatLinkRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Connect chat account',
    canActivate: [authGuard, sessionGuard],
    loadComponent: () => import('./chat-link.page').then((m) => m.ChatLinkPage),
  },
];
