import type { Routes } from '@angular/router';
import { requirePermission } from '@bf/web/data-access';

/** Org screens as shell children (paths from the shell root). The API enforces scope on every call. */
export const orgRoutes: Routes = [
  {
    path: 'org',
    pathMatch: 'full',
    title: 'Organization',
    canActivate: [requirePermission('org.read', 'Organization')],
    loadComponent: () => import('./hierarchy.page').then((m) => m.OrgHierarchyPage),
  },
  {
    path: 'org/people',
    title: 'People',
    canActivate: [requirePermission('org.read', 'People')],
    loadComponent: () => import('./people.page').then((m) => m.PeoplePage),
  },
  {
    path: 'org/people/:personId',
    title: 'Person',
    canActivate: [requirePermission('org.read', 'People')],
    loadComponent: () => import('./person.page').then((m) => m.PersonPage),
  },
  {
    path: 'org/cost-centers',
    title: 'Cost centers',
    canActivate: [requirePermission('tenant.read', 'Cost centers')],
    loadComponent: () => import('./cost-centers.page').then((m) => m.CostCentersPage),
  },
  {
    path: 'org/headcount',
    title: 'Headcount',
    canActivate: [requirePermission('org.read', 'Headcount')],
    loadComponent: () => import('./headcount.page').then((m) => m.HeadcountPage),
  },
  {
    path: 'org/import',
    title: 'Import the org hierarchy',
    canActivate: [requirePermission('org.manage', 'Org import')],
    loadComponent: () => import('./org-import.page').then((m) => m.OrgImportPage),
  },
  { path: 'admin/org', pathMatch: 'full', redirectTo: 'org' },
];
