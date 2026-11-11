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
import { MatTableModule } from '@angular/material/table';
import { API_KEY_SCOPES, type ApiKeyScope, type ApiKeyView } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, LoadState } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { IntegrationsNav } from './integrations-nav';
import { SCOPE_LABELS, type Tone } from './labels';
import { byRank, byText, ordered, rankIn } from './order';
import { OneTimeSecret } from './one-time-secret';
import { SatAvatar } from '@hylandsoftware/satori-ui/avatar';
import { initials } from './labels';

const KEY_STATUS_LABELS: Record<ApiKeyView['status'], string> = {
  active: 'Active',
  expiring_soon: 'Expiring soon',
  expired: 'Expired',
  revoked: 'Revoked',
};

const KEY_STATUS_TONES: Record<ApiKeyView['status'], Tone> = {
  active: 'success',
  expiring_soon: 'warning',
  expired: 'neutral',
  revoked: 'neutral',
};

/** Screen 101, API keys tab: scoped, expiring keys with a named owner, shown once at creation. */
@Component({
  selector: 'bf-api-keys-page',
  imports: [
    DateTimePipe,
    DecimalPipe,
    FormsModule,
    IntegrationsNav,
    LoadState,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    SatAvatar,
    OneTimeSecret,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_TAG_IMPORTS,
    SatImportantButton,
  ],
  templateUrl: './api-keys.page.html',
  styleUrls: ['./page.scss', './integrations.scss'],
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApiKeysPage {
  protected readonly initials = initials;
  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly timezone = computed(() => this.session.timezone());
  protected readonly canManage = computed(() => this.session.can('integration.manage'));
  protected readonly columns = ['name', 'scopes', 'owner', 'used', 'expires', 'status', 'actions'];
  protected readonly allScopes = API_KEY_SCOPES;
  protected readonly scopeLabel = (scope: ApiKeyScope): string => SCOPE_LABELS[scope];

  protected readonly keys = resource({ loader: () => data(this.api.listApiKeys({})) });
  /**
   * The directory is only asked for when the role may read it: an Integration Admin holds
   * `integration.manage` but not `org.read`, and a request that is certain to be refused has no
   * business being made. Without it, the key is owned by the person issuing it.
   */
  protected readonly people = resource({
    params: () => (this.session.can('org.read') ? {} : undefined),
    loader: () => data(this.api.listPeople({})),
  });
  protected readonly canPickOwner = computed(() => this.peopleOptions().length > 0);
  protected readonly myPersonId = computed(() => this.session.me()?.personId ?? null);
  protected readonly myName = computed(() => this.session.me()?.displayName ?? 'you');

  /** Keys needing attention first (revoked and expired last), then by name and id. */
  protected readonly items = computed(() =>
    ordered(
      valueOf(this.keys)?.items ?? [],
      byRank<ApiKeyView>((k) =>
        rankIn(['expiring_soon', 'active', 'expired', 'revoked'], k.status),
      ),
      byText<ApiKeyView>((k) => k.name),
    ),
  );

  protected readonly creating = signal(false);
  protected readonly name = signal('');
  protected readonly ownerPersonId = signal<string | null>(null);
  protected readonly scopes = signal<ReadonlySet<ApiKeyScope>>(new Set());
  protected readonly expiresInDays = signal(90);
  protected readonly rateLimit = signal(120);
  protected readonly created = signal<{ secret: string; name: string } | null>(null);

  protected readonly revoking = signal<ApiKeyView | null>(null);
  protected readonly confirmName = signal('');
  protected readonly usageFor = signal<string | null>(null);
  protected readonly usage = resource({
    params: () => {
      const keyId = this.usageFor();
      return keyId ? { keyId } : undefined;
    },
    loader: ({ params }) => data(this.api.getApiKeyUsage({ params })),
  });

  protected readonly busy = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);

  protected readonly peopleOptions = computed(() =>
    [...(valueOf(this.people)?.items ?? [])].sort(
      (a, b) => a.displayName.localeCompare(b.displayName, 'en') || a.id.localeCompare(b.id),
    ),
  );

  protected readonly usageDays = computed(() =>
    [...(valueOf(this.usage)?.perDay ?? [])].sort((a, b) => a.day.localeCompare(b.day)),
  );
  protected readonly usageRecent = computed(() =>
    [...(valueOf(this.usage)?.recent ?? [])].sort(
      (a, b) => b.at.localeCompare(a.at) || a.path.localeCompare(b.path) || a.status - b.status,
    ),
  );
  protected readonly usageKey = computed(
    () => this.items().find((k) => k.id === this.usageFor()) ?? null,
  );

  protected statusLabel(status: ApiKeyView['status']): string {
    return KEY_STATUS_LABELS[status];
  }
  protected statusTone(status: ApiKeyView['status']): Tone {
    return KEY_STATUS_TONES[status];
  }

  protected hasScope(scope: ApiKeyScope): boolean {
    return this.scopes().has(scope);
  }

  protected toggleScope(scope: ApiKeyScope, on: boolean): void {
    const next = new Set(this.scopes());
    if (on) next.add(scope);
    else next.delete(scope);
    this.scopes.set(next);
  }

  protected startCreate(): void {
    this.creating.set(true);
    this.created.set(null);
    this.name.set('');
    this.scopes.set(new Set());
    this.ownerPersonId.set(this.myPersonId() ?? this.peopleOptions()[0]?.id ?? null);
    this.notice.set(null);
    this.failure.set(null);
  }

  protected async create(): Promise<void> {
    const ownerPersonId = this.ownerPersonId();
    if (!ownerPersonId) return;
    await this.act(async () => {
      const result = await data(
        this.api.createApiKey({
          body: {
            name: this.name().trim(),
            ownerPersonId,
            scopes: [...this.scopes()],
            expiresInDays: this.expiresInDays(),
            rateLimitPerMinute: this.rateLimit(),
          },
        }),
      );
      this.created.set({ secret: result.secret, name: result.key.name });
      this.creating.set(false);
      this.keys.reload();
    });
  }

  protected async rotate(key: ApiKeyView): Promise<void> {
    await this.act(async () => {
      const result = await data(
        this.api.rotateApiKey({ params: { keyId: key.id }, body: { overlapDays: 7 } }),
      );
      this.created.set({ secret: result.secret, name: result.key.name });
      this.notice.set(
        `${key.name} was replaced. The old key keeps working for 7 days so the caller can switch without downtime, then stops.`,
      );
      this.keys.reload();
    });
  }

  protected startRevoke(key: ApiKeyView): void {
    this.revoking.set(key);
    this.confirmName.set('');
    this.notice.set(null);
    this.failure.set(null);
  }

  protected async revoke(): Promise<void> {
    const key = this.revoking();
    if (!key) return;
    await this.act(async () => {
      await data(
        this.api.revokeApiKey({
          params: { keyId: key.id },
          body: { confirmName: this.confirmName().trim() },
        }),
      );
      this.notice.set(
        `${key.name} is revoked. Any call still using it fails from now on with 401.`,
      );
      this.revoking.set(null);
      this.confirmName.set('');
      this.keys.reload();
    });
  }

  protected showUsage(key: ApiKeyView): void {
    this.usageFor.set(this.usageFor() === key.id ? null : key.id);
  }

  protected dismissSecret(): void {
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
