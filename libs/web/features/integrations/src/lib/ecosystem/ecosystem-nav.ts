import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

/**
 * The connector frame of 092 for the five Phase 16 surfaces that face outside the app. They share
 * one strip so it is always visible that these are the surfaces an outside tool can reach.
 */
@Component({
  selector: 'bf-ecosystem-nav',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="bf-tabs" aria-label="Surfaces for outside tools">
      <a class="bf-tabs__tab" routerLink="/admin/integrations" data-testid="eco-nav-hub"
        >Connectors</a
      >
      <a
        class="bf-tabs__tab"
        routerLink="/admin/integrations/bi"
        routerLinkActive="bf-tabs__tab--active"
        data-testid="eco-nav-bi"
        >BI connector</a
      >
      <a
        class="bf-tabs__tab"
        routerLink="/admin/integrations/assistants"
        routerLinkActive="bf-tabs__tab--active"
        data-testid="eco-nav-assistants"
        >AI assistants</a
      >
      <a
        class="bf-tabs__tab"
        routerLink="/admin/integrations/automations"
        routerLinkActive="bf-tabs__tab--active"
        data-testid="eco-nav-automations"
        >No-code automations</a
      >
      <a
        class="bf-tabs__tab"
        routerLink="/admin/integrations/partners"
        routerLinkActive="bf-tabs__tab--active"
        data-testid="eco-nav-partners"
        >Partners</a
      >
      <a
        class="bf-tabs__tab"
        routerLink="/admin/widgets"
        routerLinkActive="bf-tabs__tab--active"
        data-testid="eco-nav-widgets"
        >Widgets</a
      >
    </nav>
  `,
  styleUrls: ['../integrations.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EcosystemNav {}
