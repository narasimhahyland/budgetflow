import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { SAT_NAVIGATION_TABS_IMPORTS } from '@hylandsoftware/satori-ui/navigation-tabs';

/** Tabs of the actuals and accounting area (the designed four, then accruals, commitments and event close). */
@Component({
  selector: 'bf-actuals-tabs',
  imports: [RouterLink, RouterLinkActive, SAT_NAVIGATION_TABS_IMPORTS],
  template: `
    <sat-navigation-tabs aria-label="Actuals and accounting">
      @for (t of tabs; track t.path) {
        <a
          satNavigationTab
          [routerLink]="t.path"
          routerLinkActive
          #rla="routerLinkActive"
          [routerLinkActiveOptions]="t.exact ? exactOptions : subsetOptions"
          [active]="rla.isActive"
        >
          {{ t.label }}
          @if (t.path === '/finance/actuals/queue' && queueCount() !== null) {
            <span class="bf-tab-count" data-testid="queue-count">{{ queueCount() }}</span>
          }
        </a>
      }
    </sat-navigation-tabs>
  `,
  styles: `
    .bf-tab-count {
      margin-inline-start: 6px;
      padding: 0 8px;
      border-radius: var(--mat-sys-corner-full);
      background: var(--sat-sys-warning-container);
      color: var(--sat-sys-on-warning-container);
      font: var(--mat-sys-label-small);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActualsTabs {
  readonly queueCount = input<number | null>(null);
  protected readonly exactOptions = {
    paths: 'exact',
    queryParams: 'ignored',
    matrixParams: 'ignored',
    fragment: 'ignored',
  } as const;
  protected readonly subsetOptions = { ...this.exactOptions, paths: 'subset' } as const;
  protected readonly tabs = [
    { path: '/finance/actuals', label: 'Import', exact: true },
    { path: '/finance/actuals/queue', label: 'Unmatched queue', exact: true },
    { path: '/finance/actuals/matched', label: 'Matched', exact: true },
    { path: '/finance/actuals/rules', label: 'Mapping rules', exact: true },
    { path: '/finance/actuals/accruals', label: 'Accruals and prepaids', exact: true },
    { path: '/finance/actuals/commitments', label: 'Commitment hygiene', exact: true },
    { path: '/finance/actuals/events', label: 'Event close', exact: false },
  ];
}
