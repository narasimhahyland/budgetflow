import { inject, Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { TitleStrategy, type Routes, type RouterStateSnapshot } from '@angular/router';
import { requirePermission } from '@bf/web/data-access';
import { NAV } from './nav';
import { HomePage } from './pages/home.page';
import { ForbiddenPage, NotFoundPage, PlaceholderPage } from './pages/status.pages';

/** Placeholder routes for navigation areas that later phases replace with their feature Routes. */
const placeholderRoutes: Routes = NAV.flatMap((group) =>
  group.items
    .filter((item) => item.permission)
    .map((item) => ({
      path: item.path.slice(1),
      pathMatch: 'full' as const,
      component: PlaceholderPage,
      title: item.label,
      canActivate: [requirePermission(item.permission as string, item.label)],
      data: { pageTitle: item.label },
    })),
);

/** Children of the shell route in apps/web. */
export const shellChildRoutes: Routes = [
  { path: '', pathMatch: 'full', component: HomePage, title: 'Home' },
  ...placeholderRoutes,
  { path: 'forbidden', component: ForbiddenPage, title: 'Access denied' },
  {
    path: '**',
    component: NotFoundPage,
    title: 'Page not found',
    data: { pageTitle: 'Page not found' },
  },
];

/** Document titles as "<page> | BudgetFlow". */
@Injectable({ providedIn: 'root' })
export class BudgetFlowTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const page = this.buildTitle(snapshot);
    this.title.setTitle(page ? `${page} | BudgetFlow` : 'BudgetFlow');
  }
}
