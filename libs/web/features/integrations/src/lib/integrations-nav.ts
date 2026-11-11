import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { SAT_NAVIGATION_TABS_IMPORTS } from '@hylandsoftware/satori-ui/navigation-tabs';

/** The header links shared by the integration screens (092 header bar, 099, 100, 101). */
@Component({
  selector: 'bf-integrations-nav',
  imports: [RouterLink, RouterLinkActive, SAT_NAVIGATION_TABS_IMPORTS],
  template: `
    <sat-navigation-tabs aria-label="Integrations">
      <a
        satNavigationTab
        routerLink="/admin/integrations"
        routerLinkActive
        #tab1="routerLinkActive"
        [active]="tab1.isActive"
        [routerLinkActiveOptions]="{ exact: true }"
        >Connectors</a
      >
      <a
        satNavigationTab
        routerLink="/admin/integrations/sync"
        routerLinkActive
        #tab2="routerLinkActive"
        [active]="tab2.isActive"
        >Sync status</a
      >
      <a
        satNavigationTab
        routerLink="/admin/integrations/errors"
        routerLinkActive
        #tab3="routerLinkActive"
        [active]="tab3.isActive"
        data-testid="nav-errors"
        >Errors and retries{{ failing() ? ' (' + failing() + ')' : '' }}</a
      >
      <a
        satNavigationTab
        routerLink="/admin/integrations/pushes"
        routerLinkActive
        #tab4="routerLinkActive"
        [active]="tab4.isActive"
        >Pushes</a
      >
      <a
        satNavigationTab
        routerLink="/admin/integrations/api-keys"
        routerLinkActive
        #tab5="routerLinkActive"
        [active]="tab5.isActive"
        >API keys</a
      >
      <a
        satNavigationTab
        routerLink="/admin/integrations/webhooks"
        routerLinkActive
        #tab6="routerLinkActive"
        [active]="tab6.isActive"
        >Webhooks</a
      >
      <a
        satNavigationTab
        routerLink="/admin/integrations/identity"
        routerLinkActive
        #tab7="routerLinkActive"
        [active]="tab7.isActive"
        >Identity and SCIM</a
      >
    </sat-navigation-tabs>
  `,
  styleUrls: ['./integrations.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntegrationsNav {
  /** Messages waiting for retry plus the dead letter, shown as a count on the errors link. */
  readonly failing = input(0);
}
