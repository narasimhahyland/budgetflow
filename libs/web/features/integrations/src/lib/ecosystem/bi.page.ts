import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
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
import { BI_TOOLS, type BiDataset, type BiTool, type EcosystemConnectionView } from '@bf/contracts';
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
import { BI_TOOL_LABELS, READ_ONLY_NOTE } from './labels';

/**
 * Screen 092a. A BI tool reads curated datasets through a token the person creates for themselves,
 * so a report can never show more than its author could see in BudgetFlow. The token appears once,
 * in the create response, and the page has no way to show it again.
 */
@Component({
  selector: 'bf-bi-connector-page',
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
    SatImportantButton,
  ],
  templateUrl: './bi.page.html',
  styleUrls: ['../page.scss', '../integrations.scss', './ecosystem.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BiConnectorPage {
  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly readOnlyNote = READ_ONLY_NOTE;
  protected readonly timezone = computed(() => this.session.timezone());
  protected readonly tools = BI_TOOLS;
  protected readonly toolLabel = (tool: BiTool): string => BI_TOOL_LABELS[tool];

  protected readonly connector = resource({ loader: () => data(this.api.getBiConnector({})) });
  protected readonly connections = resource({
    loader: () => data(this.api.listBiConnections({})),
  });

  protected readonly canManage = computed(() => valueOf(this.connector)?.canManage ?? false);
  protected readonly canConnect = computed(() => valueOf(this.connector)?.canConnect ?? false);
  protected readonly enabled = computed(() => valueOf(this.connector)?.enabled ?? false);
  protected readonly enabledDatasets = computed(() =>
    (valueOf(this.connector)?.datasets ?? []).filter((d) => d.enabled),
  );

  protected readonly expanded = signal<BiDataset | null>(null);
  protected readonly connecting = signal(false);
  protected readonly tool = signal<BiTool>('power_bi');
  protected readonly label = signal('');
  protected readonly datasets = signal<ReadonlySet<BiDataset>>(new Set());
  protected readonly created = signal<{ token: string; notice: string } | null>(null);

  protected readonly revoking = signal<EcosystemConnectionView | null>(null);
  protected readonly revokeReason = signal('');

  protected readonly busy = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);

  /** A connection can only ask for a dataset the company has turned on. */
  protected readonly selectableDatasets = computed(() => this.enabledDatasets());

  protected readonly datasetTitle = (dataset: string): string =>
    valueOf(this.connector)?.datasets.find((d) => d.dataset === dataset)?.title ?? dataset;

  protected toggleExpanded(dataset: BiDataset): void {
    this.expanded.set(this.expanded() === dataset ? null : dataset);
  }

  protected hasDataset(dataset: BiDataset): boolean {
    return this.datasets().has(dataset);
  }

  protected pickDataset(dataset: BiDataset, on: boolean): void {
    const next = new Set(this.datasets());
    if (on) next.add(dataset);
    else next.delete(dataset);
    this.datasets.set(next);
  }

  protected async setEnabled(enabled: boolean): Promise<void> {
    await this.act(async () => {
      await data(this.api.updateBiConnector({ body: { enabled } }));
      this.notice.set(
        enabled
          ? 'The BI connector is on. People with report access can now connect their own tool.'
          : 'The BI connector is off. Existing connections stop reading until it is turned on again.',
      );
      this.connector.reload();
    });
  }

  protected async setDataset(dataset: BiDataset, enabled: boolean): Promise<void> {
    await this.act(async () => {
      await data(this.api.updateBiConnector({ body: { datasets: [{ dataset, enabled }] } }));
      this.notice.set(
        enabled
          ? `${this.datasetTitle(dataset)} is now offered to BI tools.`
          : `${this.datasetTitle(dataset)} is no longer offered. Connections that used it stop getting its rows.`,
      );
      this.connector.reload();
    });
  }

  protected startConnect(): void {
    this.connecting.set(true);
    this.created.set(null);
    this.label.set('');
    this.tool.set('power_bi');
    this.datasets.set(new Set(this.enabledDatasets().map((d) => d.dataset)));
    this.notice.set(null);
    this.failure.set(null);
  }

  protected async connect(): Promise<void> {
    await this.act(async () => {
      const result = await data(
        this.api.createBiConnection({
          body: {
            tool: this.tool(),
            label: this.label().trim(),
            datasets: [...this.datasets()],
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
        this.api.revokeBiConnection({
          params: { connectionId: connection.id },
          body: reason ? { reason } : {},
        }),
      );
      this.notice.set(
        `${connection.label} is revoked. Its next refresh fails with "Access revoked", and the token can never be used again.`,
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
