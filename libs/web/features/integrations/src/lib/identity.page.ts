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
import { MatTableModule } from '@angular/material/table';
import type { ProvisioningLogEntry, ScimTokenView } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, LoadState } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { IntegrationsNav } from './integrations-nav';
import { byNewest, byRank, ordered } from './order';
import { OneTimeSecret } from './one-time-secret';

const OPERATION_LABELS: Record<ProvisioningLogEntry['operation'], string> = {
  create: 'Created',
  update: 'Updated',
  deactivate: 'Deactivated',
  group_change: 'Group changed',
};

/** Screen 098: how people sign in, the SCIM tokens the provider uses, and what it has done. */
@Component({
  selector: 'bf-identity-page',
  imports: [
    DateTimePipe,
    FormsModule,
    IntegrationsNav,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatTableModule,
    OneTimeSecret,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_TAG_IMPORTS,
    SatImportantButton,
  ],
  templateUrl: './identity.page.html',
  styleUrls: ['./page.scss', './integrations.scss'],
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IdentityPage {
  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly timezone = computed(() => this.session.timezone());
  protected readonly canManage = computed(() => this.session.can('integration.manage'));
  protected readonly tokenColumns = ['prefix', 'created', 'used', 'expires', 'status', 'actions'];
  protected readonly logColumns = ['at', 'operation', 'person', 'result'];

  protected readonly overview = resource({
    loader: () => data(this.api.getIdentityIntegration({})),
  });

  /** Live tokens first, then by newest; revoked ones stay visible but out of the way. */
  protected readonly tokens = computed(() =>
    ordered(
      valueOf(this.overview)?.tokens ?? [],
      byRank<ScimTokenView>((t) => (t.revokedAt ? 1 : 0)),
      byNewest<ScimTokenView>((t) => t.createdAt),
    ),
  );

  protected readonly activeTokens = computed(() => this.tokens().filter((t) => !t.revokedAt));

  protected readonly log = computed(() =>
    ordered(
      valueOf(this.overview)?.log ?? [],
      byNewest<ProvisioningLogEntry>((e) => e.at),
    ),
  );

  protected readonly rejected = computed(() => this.log().filter((e) => e.result === 'rejected'));

  protected readonly created = signal<string | null>(null);
  protected readonly expiresInDays = signal(90);
  protected readonly revoking = signal<ScimTokenView | null>(null);
  protected readonly busy = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);
  protected readonly copiedEndpoint = signal(false);

  protected operationLabel(operation: ProvisioningLogEntry['operation']): string {
    return OPERATION_LABELS[operation];
  }

  protected async copyEndpoint(): Promise<void> {
    const endpoint = valueOf(this.overview)?.scimEndpoint;
    if (!endpoint) return;
    try {
      await navigator.clipboard.writeText(endpoint);
      this.copiedEndpoint.set(true);
    } catch {
      this.copiedEndpoint.set(false);
    }
  }

  protected async generate(): Promise<void> {
    await this.act(async () => {
      const result = await data(
        this.api.createScimToken({ body: { expiresInDays: this.expiresInDays() } }),
      );
      this.created.set(result.secret);
      this.overview.reload();
    });
  }

  protected async revoke(): Promise<void> {
    const token = this.revoking();
    if (!token) return;
    await this.act(async () => {
      await data(this.api.revokeScimToken({ params: { tokenId: token.id } }));
      this.notice.set(
        `Token ${token.prefix}… is revoked. The identity provider's next call is refused, and joiners and leavers stop being provisioned until it has a new token.`,
      );
      this.revoking.set(null);
      this.overview.reload();
    });
  }

  protected dismissSecret(): void {
    this.created.set(null);
  }

  private async act(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    this.notice.set(null);
    try {
      await action();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
