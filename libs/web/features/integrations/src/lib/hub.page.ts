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
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Router, RouterLink } from '@angular/router';
import type {
  ConnectionSummary,
  IntegrationCategory,
  IntegrationMode,
  IntegrationProvider,
} from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { IntegrationsNav } from './integrations-nav';
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  CONNECTION_STATUS_LABELS,
  CONNECTION_STATUS_TONES,
  MODE_LABELS,
  sentence,
  type Tone,
} from './labels';
import { LoadState } from './load-state';
import { byText, ordered } from './order';

/** Screen 092: the connector hub — health, every connection by category, and the connect form. */
@Component({
  selector: 'bf-integrations-hub-page',
  imports: [
    DateTimePipe,
    DecimalPipe,
    FormsModule,
    IntegrationsNav,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_TAG_IMPORTS,
    SatImportantButton,
  ],
  templateUrl: './hub.page.html',
  styleUrls: ['./page.scss', './integrations.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HubPage {
  private readonly api = injectApi();
  private readonly router = inject(Router);
  private readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly sentence = sentence;
  protected readonly timezone = computed(() => this.session.timezone());

  protected readonly hub = resource({ loader: () => data(this.api.getIntegrationsHub({})) });
  protected readonly canManage = computed(() => valueOf(this.hub)?.canManage ?? false);
  protected readonly failing = computed(() => {
    const h = valueOf(this.hub)?.health;
    return h ? h.retrying + h.deadLetter : 0;
  });

  /** Connections the reader has to do something about, named in the banner at the top. */
  protected readonly attention = computed(() =>
    ordered(
      (valueOf(this.hub)?.connections ?? []).filter((c) => c.status === 'needs_attention'),
      byText<ConnectionSummary>((c) => c.displayName),
    ),
  );

  /**
   * Tiles by category, in the fixed category order; within a category the ones needing attention
   * come first, then by name and id so the grid never reshuffles between loads.
   */
  protected readonly groups = computed(() => {
    const connections = valueOf(this.hub)?.connections ?? [];
    return CATEGORY_ORDER.map((category) => ({
      category,
      items: ordered(
        connections.filter((c) => c.category === category),
        (a, b) => this.attentionRank(a) - this.attentionRank(b),
        byText<ConnectionSummary>((c) => c.displayName),
      ),
    })).filter((g) => g.items.length > 0);
  });

  protected readonly available = computed(() =>
    [...(valueOf(this.hub)?.available ?? [])].sort(
      (a, b) =>
        CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
        a.displayName.localeCompare(b.displayName, 'en') ||
        a.provider.localeCompare(b.provider),
    ),
  );

  protected readonly connecting = signal(false);
  protected readonly provider = signal<IntegrationProvider | null>(null);
  protected readonly mode = signal<IntegrationMode>('mock');
  protected readonly displayName = signal('');
  protected readonly baseUrl = signal('');
  protected readonly accountRef = signal('');
  protected readonly credential = signal('');
  protected readonly busy = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);

  protected readonly chosen = computed(() =>
    this.available().find((a) => a.provider === this.provider()),
  );

  protected categoryLabel(category: IntegrationCategory): string {
    return CATEGORY_LABELS[category];
  }

  protected statusLabel(status: ConnectionSummary['status']): string {
    return CONNECTION_STATUS_LABELS[status];
  }

  protected statusTone(status: ConnectionSummary['status']): Tone {
    return CONNECTION_STATUS_TONES[status];
  }

  protected modeLabel(mode: IntegrationMode): string {
    return MODE_LABELS[mode];
  }

  protected startConnect(): void {
    this.connecting.set(true);
    this.notice.set(null);
    this.failure.set(null);
    this.provider.set(this.available()[0]?.provider ?? null);
    this.credential.set('');
  }

  protected async connect(): Promise<void> {
    const provider = this.provider();
    if (!provider) return;
    this.busy.set(true);
    this.failure.set(null);
    this.notice.set(null);
    try {
      const detail = await data(
        this.api.connectIntegration({
          body: {
            provider,
            mode: this.mode(),
            credential: this.credential(),
            ...(this.displayName().trim() ? { displayName: this.displayName().trim() } : {}),
            ...(this.baseUrl().trim() ? { baseUrl: this.baseUrl().trim() } : {}),
            ...(this.accountRef().trim() ? { accountRef: this.accountRef().trim() } : {}),
          },
        }),
      );
      // The credential never comes back and is dropped from the form the moment it is accepted.
      this.credential.set('');
      this.connecting.set(false);
      await this.router.navigate(['/admin/integrations/connections', detail.summary.id]);
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  private attentionRank(c: ConnectionSummary): number {
    if (c.status === 'needs_attention') return 0;
    if (c.status === 'paused') return 1;
    return 2;
  }
}
