import { JsonPipe } from '@angular/common';
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
import { RouterLink } from '@angular/router';
import type {
  IntegrationErrorClass,
  IntegrationMessageStatus,
  IntegrationMessageView,
} from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, LoadState } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { IntegrationsNav } from './integrations-nav';
import { DIRECTION_LABELS, ERROR_CLASS_LABELS, type Tone } from './labels';
import { byOldest, byRank, ordered, rankIn } from './order';
import { SAT_NAVIGATION_TABS_IMPORTS } from '@hylandsoftware/satori-ui/navigation-tabs';

const ERROR_CLASS_TONES: Record<IntegrationErrorClass, Tone> = {
  authentication: 'important',
  validation: 'warning',
  mapping: 'warning',
  rate_limit: 'info',
  provider_unavailable: 'info',
  signature: 'important',
};

/** Screen 100: the retry queue and the dead letter, with redacted payloads and a reasoned discard. */
@Component({
  selector: 'bf-integration-errors-page',
  imports: [
    DateTimePipe,
    FormsModule,
    IntegrationsNav,
    JsonPipe,
    LoadState,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_TAG_IMPORTS,
    SAT_NAVIGATION_TABS_IMPORTS,
  ],
  templateUrl: './errors.page.html',
  styleUrls: ['./page.scss', './integrations.scss'],
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ErrorsPage {
  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly timezone = computed(() => this.session.timezone());
  protected readonly canManage = computed(() => this.session.can('integration.manage'));
  protected readonly columns = ['select', 'item', 'error', 'attempts', 'next'];

  protected readonly tab = signal<IntegrationMessageStatus>('retrying');
  protected readonly errorClass = signal<IntegrationErrorClass | 'all'>('all');

  protected readonly messages = resource({
    params: () => ({
      status: this.tab(),
      ...(this.errorClass() === 'all'
        ? {}
        : { errorClass: this.errorClass() as IntegrationErrorClass }),
    }),
    loader: ({ params }) => data(this.api.listIntegrationMessages({ query: params })),
  });
  protected readonly hub = resource({ loader: () => data(this.api.getIntegrationsHub({})) });

  protected readonly retrying = computed(() => valueOf(this.messages)?.retrying ?? 0);
  protected readonly deadLetter = computed(() => valueOf(this.messages)?.deadLetter ?? 0);
  protected readonly failing = computed(() => this.retrying() + this.deadLetter());

  /**
   * Oldest failure first — the one that has been stuck longest is the one to look at — with the
   * error class and then the id behind it so a batch that failed together keeps one order.
   */
  protected readonly items = computed(() =>
    ordered(
      valueOf(this.messages)?.items ?? [],
      byOldest<IntegrationMessageView>((m) => m.firstFailedAt),
      byRank<IntegrationMessageView>((m) =>
        rankIn(
          ['signature', 'authentication', 'mapping', 'validation', 'rate_limit'],
          m.errorClass,
        ),
      ),
    ),
  );

  protected readonly connectorNames = computed(() => {
    const names = new Map<string, string>();
    for (const c of valueOf(this.hub)?.connections ?? []) names.set(c.provider, c.displayName);
    return names;
  });

  protected readonly chosen = signal<ReadonlySet<string>>(new Set());
  protected readonly opened = signal<string | null>(null);
  protected readonly discarding = signal(false);
  protected readonly reasonCode = signal('');
  protected readonly reason = signal('');
  protected readonly busy = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);

  protected readonly message = computed(
    () => this.items().find((m) => m.id === this.opened()) ?? null,
  );
  protected readonly chosenCount = computed(() => this.chosen().size);

  protected connectorName(m: IntegrationMessageView): string {
    return this.connectorNames().get(m.provider) ?? m.provider;
  }
  protected errorClassLabel(c: IntegrationErrorClass): string {
    return ERROR_CLASS_LABELS[c];
  }
  protected errorClassTone(c: IntegrationErrorClass): Tone {
    return ERROR_CLASS_TONES[c];
  }
  protected directionLabel(d: IntegrationMessageView['direction']): string {
    return DIRECTION_LABELS[d];
  }

  protected isChosen(id: string): boolean {
    return this.chosen().has(id);
  }

  protected toggle(id: string, on: boolean): void {
    const next = new Set(this.chosen());
    if (on) next.add(id);
    else next.delete(id);
    this.chosen.set(next);
  }

  protected open(m: IntegrationMessageView): void {
    this.opened.set(this.opened() === m.id ? null : m.id);
  }

  protected switchTab(status: IntegrationMessageStatus): void {
    this.tab.set(status);
    this.chosen.set(new Set());
    this.opened.set(null);
    this.discarding.set(false);
  }

  protected async retry(): Promise<void> {
    const ids = [...this.chosen()];
    if (!ids.length) return;
    await this.act(async () => {
      const result = await data(this.api.retryIntegrationMessages({ body: { ids } }));
      this.notice.set(
        `${result.succeeded} of ${ids.length} went through. ${result.stillFailing} still failing. Retries reuse the original key, so nothing was applied twice.`,
      );
      this.chosen.set(new Set());
      this.reloadAll();
    });
  }

  protected async discard(): Promise<void> {
    const ids = [...this.chosen()];
    if (!ids.length) return;
    await this.act(async () => {
      const result = await data(
        this.api.discardIntegrationMessages({
          body: { ids, reasonCode: this.reasonCode().trim(), reason: this.reason().trim() },
        }),
      );
      this.notice.set(
        `${result.discarded} discarded. They will not be retried and stay in the audit log with your reason.`,
      );
      this.discarding.set(false);
      this.reasonCode.set('');
      this.reason.set('');
      this.chosen.set(new Set());
      this.reloadAll();
    });
  }

  protected reloadAll(): void {
    this.messages.reload();
    this.hub.reload();
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
