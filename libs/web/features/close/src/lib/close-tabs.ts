import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { SAT_NAVIGATION_TABS_IMPORTS } from '@hylandsoftware/satori-ui/navigation-tabs';

/** Tabs of the close area: the monthly close, the rules that decide year-end, and the year-end run. */
@Component({
  selector: 'bf-close-tabs',
  imports: [RouterLink, RouterLinkActive, SAT_NAVIGATION_TABS_IMPORTS],
  template: `
    <sat-navigation-tabs aria-label="Close and year-end">
      @for (t of tabs; track t.path) {
        <a
          satNavigationTab
          [routerLink]="t.path"
          routerLinkActive
          #rla="routerLinkActive"
          [routerLinkActiveOptions]="subsetOptions"
          [active]="rla.isActive"
          >{{ t.label }}</a
        >
      }
    </sat-navigation-tabs>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CloseTabs {
  protected readonly subsetOptions = {
    paths: 'subset',
    queryParams: 'ignored',
    matrixParams: 'ignored',
    fragment: 'ignored',
  } as const;
  protected readonly tabs = [
    { path: '/finance/close', label: 'Period close' },
    { path: '/finance/rollover-policies', label: 'Rollover policies' },
    { path: '/finance/year-end', label: 'Year-end' },
  ];
}
