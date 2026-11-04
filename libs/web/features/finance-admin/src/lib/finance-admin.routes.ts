import type { Routes } from '@angular/router';
import { requirePermission } from '@bf/web/data-access';

/** Finance master-data screens as shell children (paths from the shell root). */
export const financeAdminRoutes: Routes = [
  {
    path: 'finance/legal-entities',
    title: 'Legal entities',
    data: { pageTitle: 'Legal entities', section: 'Finance' },
    canActivate: [requirePermission('tenant.read', 'Legal entities')],
    loadComponent: () => import('./legal-entities.page').then((m) => m.LegalEntitiesPage),
  },
  {
    path: 'finance/periods',
    title: 'Fiscal calendars and periods',
    data: { pageTitle: 'Fiscal calendars and periods', section: 'Finance' },
    canActivate: [requirePermission('tenant.read', 'Fiscal calendars')],
    loadComponent: () => import('./fiscal-calendars.page').then((m) => m.FiscalCalendarsPage),
  },
  {
    path: 'finance/rates',
    title: 'Exchange rates',
    data: { pageTitle: 'Exchange rates', section: 'Finance' },
    canActivate: [requirePermission('tenant.read', 'Exchange rates')],
    loadComponent: () => import('./rates.page').then((m) => m.RatesPage),
  },
  {
    path: 'finance/gl',
    title: 'GL accounts and mapping',
    data: { pageTitle: 'GL accounts and mapping', section: 'Finance' },
    canActivate: [requirePermission('tenant.read', 'GL accounts')],
    loadComponent: () => import('./gl.page').then((m) => m.GlPage),
  },
  {
    path: 'finance/reason-codes',
    title: 'Reason codes',
    data: { pageTitle: 'Reason codes', section: 'Finance' },
    canActivate: [requirePermission('tenant.read', 'Reason codes')],
    loadComponent: () => import('./reason-codes.page').then((m) => m.ReasonCodesPage),
  },
  {
    path: 'finance/vendors',
    title: 'Vendors',
    data: { pageTitle: 'Vendors', section: 'Finance' },
    canActivate: [requirePermission('tenant.read', 'Vendors')],
    loadComponent: () => import('./vendors.page').then((m) => m.VendorsPage),
  },
  {
    path: 'finance/doa',
    title: 'Delegation of authority',
    data: { pageTitle: 'Delegation of authority', section: 'Finance' },
    canActivate: [requirePermission('doa.read', 'Delegation of authority')],
    loadComponent: () => import('./doa.page').then((m) => m.DoaPage),
  },
];
