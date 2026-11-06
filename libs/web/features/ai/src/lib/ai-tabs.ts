import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { SAT_NAVIGATION_TABS_IMPORTS } from '@hylandsoftware/satori-ui/navigation-tabs';

/** Tabs of screen 113a: which AI features are on, what people did with them, and how accurate they are. */
@Component({
  selector: 'bf-ai-tabs',
  imports: [RouterLink, RouterLinkActive, SAT_NAVIGATION_TABS_IMPORTS],
  template: `
    <sat-navigation-tabs aria-label="AI settings">
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
export class AiTabs {
  protected readonly subsetOptions = {
    paths: 'subset',
    queryParams: 'ignored',
    matrixParams: 'ignored',
    fragment: 'ignored',
  } as const;
  protected readonly tabs = [
    { path: '/admin/ai/features', label: 'Features' },
    { path: '/admin/ai/log', label: 'Query log' },
    { path: '/admin/ai/accuracy', label: 'Accuracy' },
  ];
}
