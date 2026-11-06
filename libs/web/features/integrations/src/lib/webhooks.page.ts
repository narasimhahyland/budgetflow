import { DecimalPipe, JsonPipe } from '@angular/common';
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
import { MatTableModule } from '@angular/material/table';
import {
  WEBHOOK_EVENT_TYPES,
  type SendTestPingResult,
  type WebhookDeliveryView,
  type WebhookEndpointView,
  type WebhookEventType,
} from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { IntegrationsNav } from './integrations-nav';
import { WEBHOOK_EVENT_LABELS, type Tone } from './labels';
import { LoadState } from './load-state';
import { byNewest, byRank, byText, ordered, rankIn } from './order';
import { OneTimeSecret } from './one-time-secret';

const ENDPOINT_STATUS_LABELS: Record<WebhookEndpointView['status'], string> = {
  active: 'Active',
  failing: 'Failing',
  disabled: 'Disabled',
};

const ENDPOINT_STATUS_TONES: Record<WebhookEndpointView['status'], Tone> = {
  active: 'success',
  failing: 'warning',
  disabled: 'important',
};

const DELIVERY_STATUS_LABELS: Record<WebhookDeliveryView['status'], string> = {
  pending: 'Waiting',
  succeeded: 'Delivered',
  failed: 'Failed, will retry',
  exhausted: 'Gave up',
};

const DELIVERY_STATUS_TONES: Record<WebhookDeliveryView['status'], Tone> = {
  pending: 'info',
  succeeded: 'success',
  failed: 'warning',
  exhausted: 'important',
};

/** Screen 101, webhooks tab: subscribed endpoints, their signing secret, and every delivery. */
@Component({
  selector: 'bf-webhooks-page',
  imports: [
    DateTimePipe,
    DecimalPipe,
    FormsModule,
    IntegrationsNav,
    JsonPipe,
    LoadState,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatTableModule,
    OneTimeSecret,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_TAG_IMPORTS,
    SatImportantButton,
  ],
  templateUrl: './webhooks.page.html',
  styleUrls: ['./page.scss', './integrations.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WebhooksPage {
  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly timezone = computed(() => this.session.timezone());
  protected readonly canManage = computed(() => this.session.can('integration.manage'));
  protected readonly endpointColumns = ['url', 'events', 'last', 'rate', 'status', 'actions'];
  protected readonly deliveryColumns = ['event', 'attempt', 'result', 'next'];
  protected readonly allEvents = WEBHOOK_EVENT_TYPES;
  protected readonly eventLabel = (e: WebhookEventType): string => WEBHOOK_EVENT_LABELS[e];

  protected readonly endpoints = resource({
    loader: () => data(this.api.listWebhookEndpoints({})),
  });
  protected readonly deliveries = resource({
    params: () => {
      const endpointId = this.openEndpoint();
      return endpointId ? { endpointId } : {};
    },
    loader: ({ params }) => data(this.api.listWebhookDeliveries({ query: params })),
  });

  protected readonly verification = computed(() => valueOf(this.endpoints)?.verification ?? '');

  /** Broken endpoints first — a disabled endpoint is silently losing events — then by URL. */
  protected readonly items = computed(() =>
    ordered(
      valueOf(this.endpoints)?.items ?? [],
      byRank<WebhookEndpointView>((e) => rankIn(['disabled', 'failing', 'active'], e.status)),
      byText<WebhookEndpointView>((e) => e.url),
    ),
  );

  protected readonly deliveryItems = computed(() =>
    ordered(
      valueOf(this.deliveries)?.items ?? [],
      byNewest<WebhookDeliveryView>((d) => d.createdAt),
      byRank<WebhookDeliveryView>((d) => -d.attempt),
    ),
  );

  protected readonly openEndpoint = signal<string | null>(null);
  protected readonly openDelivery = signal<string | null>(null);
  protected readonly delivery = computed(
    () => this.deliveryItems().find((d) => d.id === this.openDelivery()) ?? null,
  );
  protected readonly endpoint = computed(
    () => this.items().find((e) => e.id === this.openEndpoint()) ?? null,
  );

  protected readonly creating = signal(false);
  protected readonly url = signal('');
  protected readonly description = signal('');
  protected readonly events = signal<ReadonlySet<WebhookEventType>>(new Set());
  protected readonly created = signal<{ secret: string; url: string } | null>(null);
  protected readonly removing = signal<WebhookEndpointView | null>(null);
  protected readonly ping = signal<SendTestPingResult | null>(null);
  protected readonly busy = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);

  protected readonly urlInvalid = computed(() => {
    const value = this.url().trim();
    return value.length > 0 && !value.toLowerCase().startsWith('https://');
  });

  protected statusLabel(status: WebhookEndpointView['status']): string {
    return ENDPOINT_STATUS_LABELS[status];
  }
  protected statusTone(status: WebhookEndpointView['status']): Tone {
    return ENDPOINT_STATUS_TONES[status];
  }
  protected deliveryLabel(status: WebhookDeliveryView['status']): string {
    return DELIVERY_STATUS_LABELS[status];
  }
  protected deliveryTone(status: WebhookDeliveryView['status']): Tone {
    return DELIVERY_STATUS_TONES[status];
  }

  /** Success rate arrives in basis points, the way every percentage does. */
  protected successPercent(bps: number): number {
    return bps / 100;
  }

  protected hasEvent(e: WebhookEventType): boolean {
    return this.events().has(e);
  }

  protected toggleEvent(e: WebhookEventType, on: boolean): void {
    const next = new Set(this.events());
    if (on) next.add(e);
    else next.delete(e);
    this.events.set(next);
  }

  protected startCreate(): void {
    this.creating.set(true);
    this.created.set(null);
    this.url.set('');
    this.description.set('');
    this.events.set(new Set());
    this.notice.set(null);
    this.failure.set(null);
  }

  protected select(e: WebhookEndpointView): void {
    this.openEndpoint.set(this.openEndpoint() === e.id ? null : e.id);
    this.openDelivery.set(null);
    this.ping.set(null);
  }

  protected openPayload(d: WebhookDeliveryView): void {
    this.openDelivery.set(this.openDelivery() === d.id ? null : d.id);
  }

  protected async create(): Promise<void> {
    await this.act(async () => {
      const result = await data(
        this.api.createWebhookEndpoint({
          body: {
            url: this.url().trim(),
            events: [...this.events()],
            ...(this.description().trim() ? { description: this.description().trim() } : {}),
          },
        }),
      );
      this.created.set({ secret: result.signingSecret, url: result.endpoint.url });
      this.creating.set(false);
      this.endpoints.reload();
    });
  }

  protected async rotateSecret(e: WebhookEndpointView): Promise<void> {
    await this.act(async () => {
      const result = await data(this.api.rotateWebhookSecret({ params: { endpointId: e.id } }));
      this.created.set({ secret: result.signingSecret, url: result.endpoint.url });
      this.notice.set(
        'Both the old and the new secret sign deliveries for the next 24 hours, so the receiver can switch over without dropping events.',
      );
      this.endpoints.reload();
    });
  }

  protected async testPing(e: WebhookEndpointView): Promise<void> {
    await this.act(async () => {
      this.ping.set(await data(this.api.sendWebhookTestPing({ params: { endpointId: e.id } })));
      this.deliveries.reload();
    });
  }

  protected async reEnable(e: WebhookEndpointView): Promise<void> {
    await this.act(async () => {
      await data(
        this.api.updateWebhookEndpoint({
          params: { endpointId: e.id },
          body: { enabled: true },
        }),
      );
      this.notice.set(
        'Enabled again. Events that happened while it was disabled are not replayed: redeliver the ones you need from the log below.',
      );
      this.endpoints.reload();
    });
  }

  protected async redeliver(d: WebhookDeliveryView): Promise<void> {
    await this.act(async () => {
      const result = await data(this.api.redeliverWebhook({ params: { deliveryId: d.id } }));
      this.notice.set(
        result.ok
          ? `Sent again: ${result.message}.`
          : `It failed again: ${result.message}. The receiver is still not accepting it.`,
      );
      this.deliveries.reload();
      this.endpoints.reload();
    });
  }

  protected async remove(): Promise<void> {
    const e = this.removing();
    if (!e) return;
    await this.act(async () => {
      await data(this.api.deleteWebhookEndpoint({ params: { endpointId: e.id } }));
      this.notice.set(
        'Endpoint removed. It receives nothing from now on; its delivery log stays for audit.',
      );
      this.removing.set(null);
      this.openEndpoint.set(null);
      this.endpoints.reload();
      this.deliveries.reload();
    });
  }

  protected dismissSecret(): void {
    this.created.set(null);
  }

  protected reload(): void {
    this.endpoints.reload();
    this.deliveries.reload();
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
