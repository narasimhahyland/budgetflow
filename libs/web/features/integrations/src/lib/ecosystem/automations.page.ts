import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import type { AutomationAction, EcosystemConnectionView, NoCodePlatform } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from '../api';
import { OneTimeSecret } from '../one-time-secret';
import { EcosystemConnections } from './connections-table';
import { EcosystemNav } from './ecosystem-nav';
import { AUTOMATION_ACTION_LABELS } from './labels';
import { LoadState } from '@bf/web/ui';

/**
 * Screen 092b. A no-code platform acts as the person who connected it and can do exactly two
 * things: read a balance, and leave a Draft for that person to submit themselves. Every platform
 * starts Not allowed, and the page shows that as the default rather than as a fault.
 */
@Component({
  selector: 'bf-automation-connector-page',
  imports: [
    DecimalPipe,
    EcosystemConnections,
    EcosystemNav,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    OneTimeSecret,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  templateUrl: './automations.page.html',
  styleUrls: ['../page.scss', '../integrations.scss', './ecosystem.scss'],
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AutomationConnectorPage {
  /**
   * True on `/me/automations`, where a person manages the automations they connected themselves.
   * Bound from route data by `withComponentInputBinding`.
   */
  readonly personal = input(false);

  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly timezone = computed(() => this.session.timezone());

  protected readonly connector = resource({
    loader: () => data(this.api.getAutomationConnector({})),
  });
  protected readonly connections = resource({
    loader: () => data(this.api.listAutomations({})),
  });

  protected readonly canManage = computed(() => valueOf(this.connector)?.canManage ?? false);
  protected readonly canConnect = computed(() => valueOf(this.connector)?.canConnect ?? false);
  protected readonly allowedPlatforms = computed(() =>
    (valueOf(this.connector)?.platforms ?? []).filter((p) => p.allowed),
  );
  /** Triggers are catalogued but nothing delivers them yet; the page must not promise otherwise. */
  protected readonly triggersDeliver = computed(() =>
    (valueOf(this.connector)?.triggers ?? []).some((t) => t.deliveryAvailable),
  );

  protected readonly connecting = signal(false);
  protected readonly platform = signal<NoCodePlatform | null>(null);
  protected readonly label = signal('');
  protected readonly actions = signal<ReadonlySet<AutomationAction>>(new Set());
  protected readonly consented = signal(false);
  protected readonly created = signal<{ token: string; notice: string } | null>(null);

  protected readonly revoking = signal<EcosystemConnectionView | null>(null);
  protected readonly revokeReason = signal('');

  protected readonly busy = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);

  protected readonly actionLabel = (action: string): string =>
    AUTOMATION_ACTION_LABELS[action as AutomationAction] ?? action;

  protected hasAction(action: AutomationAction): boolean {
    return this.actions().has(action);
  }

  protected pickAction(action: AutomationAction, on: boolean): void {
    const next = new Set(this.actions());
    if (on) next.add(action);
    else next.delete(action);
    this.actions.set(next);
  }

  protected async setPlatform(platform: NoCodePlatform, allowed: boolean): Promise<void> {
    await this.act(async () => {
      const title =
        valueOf(this.connector)?.platforms.find((p) => p.platform === platform)?.title ?? platform;
      await data(this.api.updateNoCodePlatform({ params: { platform }, body: { allowed } }));
      this.notice.set(
        allowed
          ? `${title} is allowed. People can now connect it to their own account.`
          : `${title} is no longer allowed. Calls from existing ${title} automations are refused with "Access revoked".`,
      );
      this.connector.reload();
    });
  }

  protected startConnect(): void {
    this.connecting.set(true);
    this.created.set(null);
    this.platform.set(this.allowedPlatforms()[0]?.platform ?? null);
    this.label.set('');
    this.actions.set(new Set((valueOf(this.connector)?.actions ?? []).map((a) => a.action)));
    this.consented.set(false);
    this.notice.set(null);
    this.failure.set(null);
  }

  protected async connect(): Promise<void> {
    const platform = this.platform();
    if (!platform || !this.consented()) return;
    await this.act(async () => {
      const result = await data(
        this.api.createAutomation({
          body: {
            platform,
            label: this.label().trim(),
            actions: [...this.actions()],
            consentAcknowledged: true,
          },
        }),
      );
      this.created.set({ token: result.token, notice: result.notice });
      this.connecting.set(false);
      this.connector.reload();
      this.connections.reload();
    });
  }

  protected startRevoke(connection: EcosystemConnectionView): void {
    this.revoking.set(connection);
    this.revokeReason.set('');
    this.notice.set(null);
    this.failure.set(null);
  }

  protected async revoke(): Promise<void> {
    const connection = this.revoking();
    if (!connection) return;
    await this.act(async () => {
      const reason = this.revokeReason().trim();
      await data(
        this.api.revokeAutomation({
          params: { connectionId: connection.id },
          body: reason ? { reason } : {},
        }),
      );
      this.notice.set(
        `${connection.label} is revoked. The platform's next call fails with "Access revoked".`,
      );
      this.revoking.set(null);
      this.connector.reload();
      this.connections.reload();
    });
  }

  protected dismissToken(): void {
    this.created.set(null);
  }

  private async act(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      await action();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
