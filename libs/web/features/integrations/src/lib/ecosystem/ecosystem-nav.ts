import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { SAT_NAVIGATION_TABS_IMPORTS } from '@hylandsoftware/satori-ui/navigation-tabs';

/**
 * The connector frame of 092 for the five Phase 16 surfaces that face outside the app. They share
 * one strip so it is always visible that these are the surfaces an outside tool can reach.
 */
@Component({
  selector: 'bf-ecosystem-nav',
  imports: [RouterLink, RouterLinkActive, SAT_NAVIGATION_TABS_IMPORTS],
  template: `
    <sat-navigation-tabs aria-label="Surfaces for outside tools">
      <a
        satNavigationTab
        [active]="false"
        routerLink="/admin/integrations"
        data-testid="eco-nav-hub"
        >Connectors</a
      >
      <a
        satNavigationTab
        routerLink="/admin/integrations/bi"
        routerLinkActive
        #tab1="routerLinkActive"
        [active]="tab1.isActive"
        data-testid="eco-nav-bi"
        >BI connector</a
      >
      <a
        satNavigationTab
        routerLink="/admin/integrations/assistants"
        routerLinkActive
        #tab2="routerLinkActive"
        [active]="tab2.isActive"
        data-testid="eco-nav-assistants"
        >AI assistants</a
      >
      <a
        satNavigationTab
        routerLink="/admin/integrations/automations"
        routerLinkActive
        #tab3="routerLinkActive"
        [active]="tab3.isActive"
        data-testid="eco-nav-automations"
        >No-code automations</a
      >
      <a
        satNavigationTab
        routerLink="/admin/integrations/partners"
        routerLinkActive
        #tab4="routerLinkActive"
        [active]="tab4.isActive"
        data-testid="eco-nav-partners"
        >Partners</a
      >
      <a
        satNavigationTab
        routerLink="/admin/widgets"
        routerLinkActive
        #tab5="routerLinkActive"
        [active]="tab5.isActive"
        data-testid="eco-nav-widgets"
        >Widgets</a
      >
    </sat-navigation-tabs>
  `,
  styleUrls: ['../integrations.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EcosystemNav {}
