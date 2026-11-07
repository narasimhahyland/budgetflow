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
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import type { AssistantTool, EcosystemConnectionView } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from '../api';
import { LoadState } from '../load-state';
import { OneTimeSecret } from '../one-time-secret';
import { EcosystemConnections } from './connections-table';
import { EcosystemNav } from './ecosystem-nav';

/**
 * Screen 092c. The connector an AI assistant speaks to. It is read-only by design and there is no
 * tool behind it that writes, so the page says so in the API's own words and offers no action the
 * connector could not carry out: no approve, no submit, no control, no draft.
 */
@Component({
  selector: 'bf-assistant-connector-page',
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
    MatSlideToggleModule,
    OneTimeSecret,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_TAG_IMPORTS,
    SatImportantButton,
  ],
  templateUrl: './assistants.page.html',
  styleUrls: ['../page.scss', '../integrations.scss', './ecosystem.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssistantConnectorPage {
  /**
   * True on `/me/ai-assistants`, where a person manages the assistants they connected themselves.
   * Bound from route data by `withComponentInputBinding`.
   */
  readonly personal = input(false);

  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly timezone = computed(() => this.session.timezone());

  protected readonly connector = resource({
    loader: () => data(this.api.getAssistantConnector({})),
  });
  protected readonly connections = resource({
    loader: () => data(this.api.listAssistantConnections({})),
  });

  protected readonly canManage = computed(() => valueOf(this.connector)?.canManage ?? false);
  protected readonly canConnect = computed(() => valueOf(this.connector)?.canConnect ?? false);
  protected readonly enabledTools = computed(() =>
    (valueOf(this.connector)?.tools ?? []).filter((t) => t.enabled),
  );
  /**
   * Both switches have to be on. The connector switch is the Integration Admin's, the `ai.mcp`
   * feature switch of 113a is the Organization Admin's; either one off means assistants get nothing.
   */
  protected readonly usable = computed(() => {
    const c = valueOf(this.connector);
    return Boolean(c?.enabled && c.aiFeatureEnabled);
  });

  protected readonly connecting = signal(false);
  protected readonly appKey = signal('');
  protected readonly label = signal('');
  protected readonly tools = signal<ReadonlySet<AssistantTool>>(new Set());
  protected readonly consented = signal(false);
  protected readonly created = signal<{ token: string; notice: string } | null>(null);

  protected readonly revoking = signal<EcosystemConnectionView | null>(null);
  protected readonly revokeReason = signal('');

  protected readonly busy = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);

  protected readonly toolTitle = (tool: string): string =>
    valueOf(this.connector)?.tools.find((t) => t.tool === tool)?.title ?? tool;

  /** Named apps only, or any assistant that can sign in; the API models the second as null. */
  protected readonly allowedApps = computed(() => valueOf(this.connector)?.allowedApps ?? null);

  protected readonly appKeyHint = computed(() => {
    const apps = this.allowedApps();
    return apps === null
      ? 'Any assistant that can sign in may connect. Use the client registration your assistant shows you.'
      : `Only these assistants are allowed: ${apps.join(', ')}.`;
  });

  protected hasTool(tool: AssistantTool): boolean {
    return this.tools().has(tool);
  }

  protected pickTool(tool: AssistantTool, on: boolean): void {
    const next = new Set(this.tools());
    if (on) next.add(tool);
    else next.delete(tool);
    this.tools.set(next);
  }

  protected async setEnabled(enabled: boolean): Promise<void> {
    await this.act(async () => {
      await data(this.api.updateAssistantConnector({ body: { enabled } }));
      this.notice.set(
        enabled
          ? 'The connector is on. Assistants receive the read-only tools that are turned on below.'
          : 'The connector is off. Assistants now receive "BudgetFlow connector is turned off for this company".',
      );
      this.connector.reload();
    });
  }

  protected async setTool(tool: AssistantTool, enabled: boolean): Promise<void> {
    await this.act(async () => {
      await data(this.api.updateAssistantConnector({ body: { tools: [{ tool, enabled }] } }));
      this.notice.set(
        enabled
          ? `Assistants can now call ${this.toolTitle(tool)}.`
          : `${this.toolTitle(tool)} is off. Assistants that ask for it are refused.`,
      );
      this.connector.reload();
    });
  }

  protected startConnect(): void {
    this.connecting.set(true);
    this.created.set(null);
    this.appKey.set(this.allowedApps()?.[0] ?? '');
    this.label.set('');
    this.tools.set(new Set(this.enabledTools().map((t) => t.tool)));
    this.consented.set(false);
    this.notice.set(null);
    this.failure.set(null);
  }

  protected async connect(): Promise<void> {
    if (!this.consented()) return;
    await this.act(async () => {
      const result = await data(
        this.api.createAssistantConnection({
          body: {
            appKey: this.appKey().trim(),
            label: this.label().trim(),
            tools: [...this.tools()],
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
        this.api.revokeAssistantConnection({
          params: { connectionId: connection.id },
          body: reason ? { reason } : {},
        }),
      );
      this.notice.set(
        `${connection.label} is revoked. Its next tool call fails with "Access revoked".`,
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
