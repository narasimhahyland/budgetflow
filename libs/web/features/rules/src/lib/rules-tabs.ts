import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { SAT_NAVIGATION_TABS_IMPORTS } from '@hylandsoftware/satori-ui/navigation-tabs';

const TABS = [
  { id: 'overview', label: 'Overview', path: '/admin/rules' },
  { id: 'list', label: 'All rules', path: '/admin/rules/list' },
  { id: 'policies', label: 'Policy settings', path: '/admin/rules/policies/limits' },
  { id: 'routing', label: 'Approval routing', path: '/admin/rules/routing' },
  { id: 'doa', label: 'Approval limits', path: '/admin/rules/doa' },
  { id: 'exceptions', label: 'Exceptions', path: '/admin/rules/exceptions' },
  { id: 'simulate', label: 'Test a request', path: '/admin/rules/simulate' },
] as const;

export type RulesTabId = (typeof TABS)[number]['id'];

/** Section navigation shown under the title on every rules and policies screen. */
@Component({
  selector: 'bf-rules-tabs',
  imports: [SAT_NAVIGATION_TABS_IMPORTS],
  template: `
    <sat-navigation-tabs class="bf-tabs" aria-label="Rules and policies sections">
      @for (t of tabs; track t.id) {
        <a
          satNavigationTab
          [active]="t.id === current()"
          (click)="go(t.path)"
          (keydown.enter)="go(t.path)"
          tabindex="0"
          >{{ t.label }}</a
        >
      }
    </sat-navigation-tabs>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RulesTabs {
  /** Pages below a tab name it, so a rule detail still highlights All rules. */
  readonly current = input<RulesTabId>('overview');
  private readonly router = inject(Router);
  protected readonly tabs = TABS;

  protected go(path: string): void {
    void this.router.navigateByUrl(path);
  }
}
