import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

/** The header links shared by the integration screens (092 header bar, 099, 100, 101). */
@Component({
  selector: 'bf-integrations-nav',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="bf-tabs" aria-label="Integrations">
      <a
        class="bf-tabs__tab"
        routerLink="/admin/integrations"
        routerLinkActive="bf-tabs__tab--active"
        [routerLinkActiveOptions]="{ exact: true }"
        >Connectors</a
      >
      <a
        class="bf-tabs__tab"
        routerLink="/admin/integrations/sync"
        routerLinkActive="bf-tabs__tab--active"
        >Sync status</a
      >
      <a
        class="bf-tabs__tab"
        routerLink="/admin/integrations/errors"
        routerLinkActive="bf-tabs__tab--active"
        data-testid="nav-errors"
        >Errors and retries{{ failing() ? ' (' + failing() + ')' : '' }}</a
      >
      <a
        class="bf-tabs__tab"
        routerLink="/admin/integrations/pushes"
        routerLinkActive="bf-tabs__tab--active"
        >Pushes</a
      >
      <a
        class="bf-tabs__tab"
        routerLink="/admin/integrations/api-keys"
        routerLinkActive="bf-tabs__tab--active"
        >API keys</a
      >
      <a
        class="bf-tabs__tab"
        routerLink="/admin/integrations/webhooks"
        routerLinkActive="bf-tabs__tab--active"
        >Webhooks</a
      >
      <a
        class="bf-tabs__tab"
        routerLink="/admin/integrations/identity"
        routerLinkActive="bf-tabs__tab--active"
        >Identity and SCIM</a
      >
    </nav>
  `,
  styleUrls: ['./integrations.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntegrationsNav {
  /** Messages waiting for retry plus the dead letter, shown as a count on the errors link. */
  readonly failing = input(0);
}
