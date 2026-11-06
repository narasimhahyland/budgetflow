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
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import type { SyncDirection, SyncRunView, SyncStatus } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { data, injectApi, valueOf } from './api';
import { IntegrationsNav } from './integrations-nav';
import {
  DIRECTION_LABELS,
  MODE_LABELS,
  SYNC_OBJECT_LABELS,
  SYNC_STATUS_LABELS,
  SYNC_STATUS_TONES,
  type Tone,
} from './labels';
import { LoadState } from './load-state';
import { byNewest, ordered } from './order';

/** Screen 099: every sync run in and out of BudgetFlow, with the run detail beside the table. */
@Component({
  selector: 'bf-sync-page',
  imports: [
    DateTimePipe,
    DecimalPipe,
    FormsModule,
    IntegrationsNav,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
    MatTableModule,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  templateUrl: './sync.page.html',
  styleUrls: ['./page.scss', './integrations.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SyncPage {
  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly timezone = computed(() => this.session.timezone());
  protected readonly columns = ['started', 'connector', 'object', 'records', 'status'];

  protected readonly direction = signal<SyncDirection | 'all'>('all');
  protected readonly status = signal<SyncStatus | 'all'>('all');

  protected readonly runs = resource({
    params: () => ({
      ...(this.direction() === 'all' ? {} : { direction: this.direction() as SyncDirection }),
      ...(this.status() === 'all' ? {} : { status: this.status() as SyncStatus }),
    }),
    loader: ({ params }) => data(this.api.listSyncRuns({ query: params })),
  });
  protected readonly hub = resource({ loader: () => data(this.api.getIntegrationsHub({})) });

  protected readonly failing = computed(() => {
    const h = valueOf(this.hub)?.health;
    return h ? h.retrying + h.deadLetter : 0;
  });

  protected readonly summary = computed(() => valueOf(this.runs)?.summary ?? null);

  /** Newest first; runs that started in the same second fall back to their id, never to luck. */
  protected readonly items = computed(() =>
    ordered(
      valueOf(this.runs)?.items ?? [],
      byNewest<SyncRunView>((r) => r.startedAt),
    ),
  );

  protected readonly selected = signal<string | null>(null);
  protected readonly run = computed(
    () => this.items().find((r) => r.id === this.selected()) ?? null,
  );

  protected readonly connectorNames = computed(() => {
    const names = new Map<string, string>();
    for (const c of valueOf(this.hub)?.connections ?? []) names.set(c.provider, c.displayName);
    return names;
  });

  protected readonly connectionIds = computed(() => {
    const ids = new Map<string, string>();
    for (const c of valueOf(this.hub)?.connections ?? []) ids.set(c.provider, c.id);
    return ids;
  });

  protected connectorName(run: SyncRunView): string {
    return this.connectorNames().get(run.provider) ?? run.provider;
  }

  protected connectionLink(run: SyncRunView): string[] {
    const id = this.connectionIds().get(run.provider) ?? run.connectionId;
    return ['/admin/integrations/connections', id];
  }

  protected objectLabel(object: SyncRunView['object']): string {
    return SYNC_OBJECT_LABELS[object];
  }
  protected directionLabel(direction: SyncDirection): string {
    return DIRECTION_LABELS[direction];
  }
  protected modeLabel(mode: SyncRunView['mode']): string {
    return MODE_LABELS[mode];
  }
  protected statusLabel(status: SyncStatus): string {
    return SYNC_STATUS_LABELS[status];
  }
  protected statusTone(status: SyncStatus): Tone {
    return SYNC_STATUS_TONES[status];
  }

  protected duration(run: SyncRunView): string {
    if (run.durationMs === null) return 'still running';
    return run.durationMs < 1000
      ? `${run.durationMs} ms`
      : `${(run.durationMs / 1000).toFixed(1)} s`;
  }

  protected select(run: SyncRunView): void {
    this.selected.set(this.selected() === run.id ? null : run.id);
  }

  protected reload(): void {
    this.runs.reload();
    this.hub.reload();
  }
}
