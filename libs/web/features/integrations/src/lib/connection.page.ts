import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTableModule } from '@angular/material/table';
import { Router, RouterLink } from '@angular/router';
import type {
  ConnectionStatus,
  IntegrationCategory,
  IntegrationMode,
  MappingEntry,
  MappingKind,
  PushItemView,
  SyncDirection,
  SyncObject,
  SyncRunView,
  SyncSchedule,
  SyncStatus,
  TestConnectionResult,
} from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import {
  CATEGORY_LABELS,
  CONNECTION_STATUS_LABELS,
  CONNECTION_STATUS_TONES,
  DIRECTION_LABELS,
  MAPPING_KIND_LABELS,
  MODE_LABELS,
  SYNC_OBJECT_LABELS,
  SYNC_STATUS_LABELS,
  SYNC_STATUS_TONES,
  type Tone,
} from './labels';
import { LoadState } from './load-state';
import { byNewest, byRank, byText, ordered, rankIn } from './order';
import { PlanImport } from './plan-import';

type TabId = 'overview' | 'connection' | 'mappings' | 'sync' | 'push' | 'plan' | 'logs';

/** A setting the connector exposes as a switch, with the words a person needs before flipping it. */
interface ToggleSetting {
  key: string;
  label: string;
  hint: string;
  value: boolean;
  /** Shown before the change is sent when turning it on has consequences outside BudgetFlow. */
  consequenceOn?: string;
  confirmLabel?: string;
}

const SETTING_COPY: Record<string, Omit<ToggleSetting, 'key' | 'value'>> = {
  cardLimitPush: {
    label: 'Push card limits for approved commitments',
    hint: 'Off by default: it changes spending power on real cards, outside BudgetFlow.',
    consequenceOn:
      'From now on, approving a commitment paid by card creates a limit on the cardholder’s card for the approved amount at the locked plan rate. Existing approved commitments are not touched until they are pushed. Releasing or cancelling a commitment closes its limit.',
    confirmLabel: 'Turn card-limit push on',
  },
  webhooksEnabled: {
    label: 'Accept callbacks from the provider',
    hint: 'Signed callbacks arrive as they happen instead of waiting for the next scheduled run.',
  },
  expenseHandoff: {
    label: 'Take expense lines from this provider',
    hint: 'Lines go to the actuals review queue, where a person matches them.',
  },
  snapshotAfterSync: {
    label: 'Create a headcount snapshot after each sync',
    hint: 'Per-head allocations then work from the headcount of that run.',
  },
  organizerAsSender: {
    label: 'Send invitations as the event organizer',
    hint: 'Off sends them from the shared calendar account instead.',
  },
  holdOwnerDeactivations: {
    label: 'Hold deactivation of budget owners for review',
    hint: 'On delays a leaver losing access until an Organization Admin has looked at their budgets.',
  },
};

const PUSH_STATUS_LABELS: Record<PushItemView['status'], string> = {
  pending: 'Waiting to be sent',
  pushed: 'Sent',
  failed: 'Failed',
  closed: 'Closed',
};

const PUSH_STATUS_TONES: Record<PushItemView['status'], Tone> = {
  pending: 'info',
  pushed: 'success',
  failed: 'important',
  closed: 'neutral',
};

/**
 * Screen 092's connector detail frame, used by every connector (093 HR, 094 ERP, 094a planning,
 * 095 expense, 096 cards, 097 calendar). Tabs come from what the connector can actually do, so a
 * calendar connection never shows an empty Push tab.
 */
@Component({
  selector: 'bf-connection-page',
  imports: [
    DateTimePipe,
    DecimalPipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTableModule,
    Money,
    PlanImport,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_TAG_IMPORTS,
    SatImportantButton,
  ],
  templateUrl: './connection.page.html',
  styleUrls: ['./page.scss', './integrations.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConnectionPage {
  /** From the route: `admin/integrations/connections/:connectionId`. */
  readonly connectionId = input.required<string>();

  private readonly api = injectApi();
  private readonly router = inject(Router);
  private readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly timezone = computed(() => this.session.timezone());
  protected readonly canManage = computed(() => this.session.can('integration.manage'));
  protected readonly mappingColumns = ['kind', 'external', 'internal', 'status'];
  protected readonly scheduleColumns = ['object', 'every', 'next', 'actions'];
  protected readonly pushColumns = ['reference', 'amount', 'status'];
  protected readonly runColumns = ['started', 'records', 'status'];

  protected readonly detail = resource({
    params: () => ({ connectionId: this.connectionId() }),
    loader: ({ params }) => data(this.api.getIntegrationConnection({ params })),
  });
  protected readonly runs = resource({
    params: () => ({ connectionId: this.connectionId() }),
    loader: ({ params }) => data(this.api.listSyncRuns({ query: params })),
  });
  protected readonly pushes = resource({
    params: () => ({ connectionId: this.connectionId() }),
    loader: ({ params }) => data(this.api.listIntegrationPushes({ query: params })),
  });

  protected readonly tab = signal<TabId>('overview');
  protected readonly busy = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);
  protected readonly disconnecting = signal(false);
  protected readonly confirmText = signal('');
  protected readonly newCredential = signal('');
  protected readonly testResult = signal<TestConnectionResult | null>(null);
  protected readonly runObject = signal<string | null>(null);
  protected readonly lastRun = signal<SyncRunView | null>(null);
  protected readonly pendingToggle = signal<{
    key: string;
    value: boolean;
    consequence: string;
    confirmLabel: string;
  } | null>(null);
  private readonly mappingDrafts = signal<Record<string, string>>({});

  constructor() {
    // A different connector is a different screen: nothing half-typed should survive the switch.
    effect(() => {
      this.connectionId();
      this.tab.set('overview');
      this.mappingDrafts.set({});
      this.newCredential.set('');
      this.testResult.set(null);
      this.lastRun.set(null);
      this.disconnecting.set(false);
      this.confirmText.set('');
    });
  }

  protected readonly tabs = computed(() => {
    const d = valueOf(this.detail);
    const tabs: { id: TabId; label: string }[] = [
      { id: 'overview', label: 'Overview' },
      { id: 'connection', label: 'Connection' },
      { id: 'mappings', label: 'Mappings' },
      { id: 'sync', label: 'Sync' },
    ];
    if (d?.summary.category === 'planning') tabs.push({ id: 'plan', label: 'Plan import' });
    tabs.push({ id: 'push', label: 'Push' }, { id: 'logs', label: 'Logs' });
    return tabs;
  });

  protected readonly objects = computed(() =>
    [...(valueOf(this.detail)?.objects ?? [])]
      .map((o) => ({ ...o, key: `${o.object}:${o.direction}` }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  );

  /** Objects a person can start by hand, which is every object the connector declares. */
  protected readonly syncableObjects = computed(() => this.objects());

  protected readonly schedules = computed(() =>
    [...(valueOf(this.detail)?.schedules ?? [])].sort(
      (a, b) =>
        a.object.localeCompare(b.object) ||
        a.direction.localeCompare(b.direction) ||
        a.everyMinutes - b.everyMinutes,
    ),
  );

  protected readonly nextRun = computed(() => {
    const next = this.schedules()
      .filter((s) => !s.paused && s.nextRunAt)
      .map((s) => s.nextRunAt as string)
      .sort();
    return next[0] ?? null;
  });

  /** Unmapped values first so the gap is the first thing read, then by kind, value and id. */
  protected readonly mappings = computed(() =>
    ordered(
      valueOf(this.detail)?.mappings ?? [],
      byRank<MappingEntry>((m) => (m.internalId || m.internalValue ? 1 : 0)),
      byText<MappingEntry>((m) => MAPPING_KIND_LABELS[m.kind]),
      byText<MappingEntry>((m) => m.externalValue),
    ),
  );

  protected readonly unmapped = computed(() =>
    this.mappings().filter((m) => !m.internalId && !m.internalValue),
  );

  protected readonly mappingChanged = computed(() => {
    const drafts = this.mappingDrafts();
    return this.mappings().some(
      (m) => (drafts[m.id] ?? m.internalValue ?? '') !== (m.internalValue ?? ''),
    );
  });

  protected readonly toggles = computed<ToggleSetting[]>(() => {
    const settings = valueOf(this.detail)?.settings ?? {};
    return Object.entries(settings)
      .filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')
      .map(([key, value]) => ({
        key,
        value,
        label: SETTING_COPY[key]?.label ?? key,
        hint: SETTING_COPY[key]?.hint ?? '',
        consequenceOn: SETTING_COPY[key]?.consequenceOn,
        confirmLabel: SETTING_COPY[key]?.confirmLabel,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'en') || a.key.localeCompare(b.key));
  });

  protected readonly runItems = computed(() =>
    ordered(
      valueOf(this.runs)?.items ?? [],
      byNewest<SyncRunView>((r) => r.startedAt),
    ),
  );

  protected readonly pushItems = computed(() =>
    ordered(
      valueOf(this.pushes)?.items ?? [],
      byRank<PushItemView>((p) => rankIn(['failed', 'pending', 'pushed', 'closed'], p.status)),
      byNewest<PushItemView>((p) => p.pushedAt),
      byText<PushItemView>((p) => p.reference),
    ),
  );

  protected categoryLabel(category: IntegrationCategory): string {
    return CATEGORY_LABELS[category];
  }
  protected statusLabel(status: ConnectionStatus): string {
    return CONNECTION_STATUS_LABELS[status];
  }
  protected statusTone(status: ConnectionStatus): Tone {
    return CONNECTION_STATUS_TONES[status];
  }
  protected modeLabel(mode: IntegrationMode): string {
    return MODE_LABELS[mode];
  }
  protected objectLabel(object: SyncObject): string {
    return SYNC_OBJECT_LABELS[object];
  }
  protected directionLabel(direction: SyncDirection): string {
    return DIRECTION_LABELS[direction];
  }
  protected kindLabel(kind: MappingKind): string {
    return MAPPING_KIND_LABELS[kind];
  }
  protected syncStatusLabel(status: SyncStatus): string {
    return SYNC_STATUS_LABELS[status];
  }
  protected runTag(status: SyncStatus): Tone {
    return SYNC_STATUS_TONES[status];
  }
  protected runTone(status: SyncStatus): 'success' | 'warning' | 'important' | 'info' {
    const tone = SYNC_STATUS_TONES[status];
    return tone === 'neutral' ? 'info' : tone;
  }
  protected pushStatusLabel(status: PushItemView['status']): string {
    return PUSH_STATUS_LABELS[status];
  }
  protected pushTone(status: PushItemView['status']): Tone {
    return PUSH_STATUS_TONES[status];
  }

  protected everyLabel(minutes: number): string {
    if (minutes % 1440 === 0) {
      const days = minutes / 1440;
      return days === 1 ? 'Daily' : `Every ${days} days`;
    }
    if (minutes % 60 === 0) {
      const hours = minutes / 60;
      return hours === 1 ? 'Hourly' : `Every ${hours} hours`;
    }
    return `Every ${minutes} minutes`;
  }

  protected confirmed(name: string): boolean {
    return this.confirmText().trim().toLowerCase() === name.trim().toLowerCase();
  }

  protected draftFor(m: MappingEntry): string {
    return this.mappingDrafts()[m.id] ?? m.internalValue ?? '';
  }

  protected setDraft(m: MappingEntry, value: string): void {
    this.mappingDrafts.update((drafts) => ({ ...drafts, [m.id]: value }));
  }

  protected onToggle(key: string, value: boolean): void {
    const setting = this.toggles().find((t) => t.key === key);
    if (value && setting?.consequenceOn) {
      this.pendingToggle.set({
        key,
        value,
        consequence: setting.consequenceOn,
        confirmLabel: setting.confirmLabel ?? 'Turn it on',
      });
      return;
    }
    void this.saveSettings({ [key]: value });
  }

  protected async applyToggle(): Promise<void> {
    const pending = this.pendingToggle();
    if (!pending) return;
    this.pendingToggle.set(null);
    await this.saveSettings({ [pending.key]: pending.value });
  }

  protected async togglePause(paused: boolean): Promise<void> {
    await this.act(async () => {
      await data(
        this.api.updateIntegrationConnection({
          params: { connectionId: this.connectionId() },
          body: { paused },
        }),
      );
      this.notice.set(
        paused
          ? 'Paused. No schedule runs and nothing is pushed until it is resumed.'
          : 'Resumed. Schedules run again from their next slot.',
      );
      this.detail.reload();
    });
  }

  protected async toggleSchedule(s: SyncSchedule): Promise<void> {
    await this.act(async () => {
      await data(
        this.api.updateIntegrationConnection({
          params: { connectionId: this.connectionId() },
          body: {
            schedules: [
              {
                object: s.object,
                direction: s.direction,
                everyMinutes: s.everyMinutes,
                paused: !s.paused,
              },
            ],
          },
        }),
      );
      this.notice.set(
        s.paused
          ? `${SYNC_OBJECT_LABELS[s.object]} is scheduled again.`
          : `${SYNC_OBJECT_LABELS[s.object]} is paused. Nothing arrives on that schedule.`,
      );
      this.detail.reload();
    });
  }

  protected async replaceCredential(): Promise<void> {
    await this.act(async () => {
      await data(
        this.api.replaceIntegrationCredential({
          params: { connectionId: this.connectionId() },
          body: { credential: this.newCredential() },
        }),
      );
      // Clear it the moment the server has it: it must not sit in the page.
      this.newCredential.set('');
      this.testResult.set(null);
      this.notice.set(
        'Credential replaced. It is encrypted at rest and will never be shown again. Test the connection to confirm the provider accepts it.',
      );
      this.detail.reload();
    });
  }

  protected async testConnection(): Promise<void> {
    await this.act(async () => {
      const result = await data(
        this.api.testIntegrationConnection({ params: { connectionId: this.connectionId() } }),
      );
      this.testResult.set(result);
      this.detail.reload();
    });
  }

  protected async saveMappings(): Promise<void> {
    await this.act(async () => {
      const drafts = this.mappingDrafts();
      await data(
        this.api.putIntegrationMappings({
          params: { connectionId: this.connectionId() },
          body: {
            entries: this.mappings().map((m) => {
              const value = (drafts[m.id] ?? m.internalValue ?? '').trim();
              return {
                kind: m.kind,
                externalValue: m.externalValue,
                internalValue: value === '' ? null : value,
              };
            }),
          },
        }),
      );
      this.mappingDrafts.set({});
      this.notice.set('Mappings saved. Records held for a missing mapping can be retried now.');
      this.detail.reload();
    });
  }

  protected async runSync(): Promise<void> {
    const key = this.runObject();
    const chosen = this.syncableObjects().find((o) => o.key === key);
    if (!chosen) return;
    await this.act(async () => {
      const run = await data(
        this.api.runIntegrationSync({
          params: { connectionId: this.connectionId() },
          body: { object: chosen.object, direction: chosen.direction },
        }),
      );
      this.lastRun.set(run);
      this.detail.reload();
      this.runs.reload();
    });
  }

  protected async disconnect(): Promise<void> {
    await this.act(async () => {
      await data(this.api.disconnectIntegration({ params: { connectionId: this.connectionId() } }));
      await this.router.navigate(['/admin/integrations']);
    });
  }

  private async saveSettings(patch: Record<string, unknown>): Promise<void> {
    const current = valueOf(this.detail)?.settings ?? {};
    await this.act(async () => {
      await data(
        this.api.updateIntegrationConnection({
          params: { connectionId: this.connectionId() },
          body: { settings: { ...current, ...patch } },
        }),
      );
      this.notice.set('Setting saved.');
      this.detail.reload();
    });
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
