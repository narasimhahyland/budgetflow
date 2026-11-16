import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { SAT_NAVIGATION_TABS_IMPORTS } from '@hylandsoftware/satori-ui/navigation-tabs';

/** Sub-tabs of the Query log tab (113a): every AI call, and the answers people reported. */
@Component({
  selector: 'bf-query-log-tabs',
  imports: [RouterLink, RouterLinkActive, SAT_NAVIGATION_TABS_IMPORTS],
  template: `
    <sat-navigation-tabs aria-label="Query log">
      @for (t of tabs; track t.path) {
        <a
          satNavigationTab
          [routerLink]="t.path"
          routerLinkActive
          #rla="routerLinkActive"
          [routerLinkActiveOptions]="{ exact: true }"
          [active]="rla.isActive"
          >{{ t.label }}</a
        >
      }
    </sat-navigation-tabs>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QueryLogTabs {
  protected readonly tabs = [
    { path: '/admin/ai/log', label: 'All activity' },
    { path: '/admin/ai/log/reported', label: 'Reported answers' },
  ];
}
