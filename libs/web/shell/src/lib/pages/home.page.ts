import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  type OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, type PageEvent } from '@angular/material/paginator';
import { MatSortModule, type Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import type { BudgetDetail, HealthLevel } from '@bf/contracts';
import { OverviewStore, SessionStore, VisibleBudgetsStore } from '@bf/web/data-access';
import {
  BudgetStatus,
  DateOnlyPipe,
  DateTimePipe,
  KpiTile,
  Money,
  type KpiDelta,
} from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatGhost } from '@hylandsoftware/satori-ui/ghost';
import { SAT_TABLE_WITH_ROW_STATES_IMPORTS } from '@hylandsoftware/satori-ui/table-with-row-states';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import {
  answerLine,
  buckets,
  currentFiscalYear,
  levelLabel,
  levelTone,
  pct,
  shareBps,
  waitingOnYou,
  waitingSummary,
  yearProgress,
} from './home-overview';

/** Status filters over the budgets table, as buttons: ADR 0006 keeps Home free of any combobox. */
const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'frozen', label: 'Frozen' },
  { key: 'set_to_zero', label: 'Set to zero' },
] as const;

const HEALTH_FILTERS = [
  { key: 'all', label: 'Any health' },
  { key: 'at_risk', label: 'At risk' },
  { key: 'watch', label: 'Watch' },
  { key: 'healthy', label: 'Healthy' },
] as const;

const ACTIVE_STATUSES = ['active', 'reduced', 'partially_allocated', 'fully_allocated'];

/** How many flagged budgets Home shows before it points at Budget health (013) for the rest. */
const ATTENTION_SHOWN = 5;

type SortKey = 'name' | 'owner' | 'committed' | 'available' | 'utilization' | 'status';

/**
 * Home: the executive overview of the budget position the signed-in user can see — where the year
 * stands, the four buckets with their denominators, what needs attention, what waits on their
 * decision, and the full budget list below as a tool.
 *
 * Stage 1 of screen 011 (`docs/ux/screens/011-executive-dashboard.md`) on the endpoints that exist
 * today; 011 replaces this page with its chart, forecast and region drill-down. Every section is
 * gated on the API's own permissions for this user and loads on its own, so a section the API will
 * not serve is simply absent.
 */
@Component({
  selector: 'bf-home-page',
  imports: [
    BudgetStatus,
    DateOnlyPipe,
    DateTimePipe,
    DecimalPipe,
    FormsModule,
    KpiTile,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatPaginatorModule,
    MatSortModule,
    MatTableModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_TABLE_WITH_ROW_STATES_IMPORTS,
    SAT_TAG_IMPORTS,
    SatGhost,
  ],
  templateUrl: './home.page.html',
  styleUrls: ['./page.scss', './home.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage implements OnInit {
  protected readonly session = inject(SessionStore);
  protected readonly budgets = inject(VisibleBudgetsStore);
  protected readonly overview = inject(OverviewStore);

  protected readonly me = this.session.me;
  protected readonly statusFilters = STATUS_FILTERS;
  protected readonly healthFilters = HEALTH_FILTERS;
  protected readonly levelLabel = levelLabel;
  protected readonly levelTone = levelTone;

  /** Display-only gates; the API enforces scope on every call it serves. */
  protected readonly canSeeBudgets = computed(() => this.session.can('budget.read'));
  protected readonly canSeeHealth = computed(() => this.session.can('report.read'));

  protected readonly subtitle = computed(() =>
    [this.me()?.jobTitle, this.me()?.locationName, this.me()?.tenantName]
      .filter(Boolean)
      .join(' · '),
  );

  // --- The year, the answer line and the context line ------------------------------------------

  /**
   * The accounting date the figures are as of: the API's own when the health section served it,
   * else the browser's today. It is a calendar date, so it is rendered unshifted (`bfDate: 'UTC'`);
   * converting it into the viewer's timezone would move it a day for anyone west of UTC.
   */
  protected readonly asOf = computed(
    () => this.overview.health.value()?.asOf ?? new Date().toISOString().slice(0, 10),
  );
  /** When the server computed the figures: an instant, so this one is shown in the viewer's zone. */
  protected readonly generatedAt = computed(
    () => this.overview.health.value()?.generatedAt ?? null,
  );
  protected readonly fiscalYear = computed(() =>
    currentFiscalYear(this.me()?.fiscalYears ?? [], this.asOf()),
  );
  protected readonly year = computed(() => {
    const fy = this.fiscalYear();
    return fy ? yearProgress(fy, this.asOf()) : null;
  });
  protected readonly buckets = computed(() => {
    const s = this.overview.summary.value();
    return s ? buckets(s) : null;
  });
  protected readonly answer = computed(() =>
    answerLine({
      year: this.year(),
      buckets: this.buckets(),
      health: this.overview.health.value(),
    }),
  );
  /** True while any section the user may read is still loading, so the answer line ghosts first. */
  protected readonly overviewLoading = computed(
    () =>
      (this.canSeeBudgets() && this.overview.summary.loading()) ||
      (this.canSeeHealth() && this.overview.health.loading()),
  );
  /**
   * What the figures cover, in the API's own words where it says so. Without the health section the
   * roll-up's own scope decides: calling an owner's subtree by the company name would overstate it.
   */
  protected readonly scopeLabel = computed(() => {
    const fromHealth = this.overview.health.value()?.scope.label;
    if (fromHealth) return fromHealth;
    const scope = this.overview.summary.value()?.scope;
    if (scope && scope !== 'tenant') return 'Budgets you can see';
    return this.me()?.tenantName ?? '';
  });
  protected readonly scopeNote = computed(() => this.overview.health.value()?.scope.note ?? null);
  /**
   * FX is stated on its own line and never folded into consumption. No endpoint Home may read
   * carries a scope-level FX effect, so the line states the rule and, when the budget and reporting
   * currencies are the same, that there is no effect to separate.
   */
  protected readonly fxNote = computed(() => {
    const reporting = this.me()?.reportingCurrency;
    const budgetCurrency = this.buckets()?.currency;
    if (!reporting) return null;
    return budgetCurrency && budgetCurrency !== reporting
      ? `Budgets are held in ${budgetCurrency} and reported in ${reporting} at the locked plan rate. FX never consumes budget and is reported separately.`
      : `Budgets and reporting are both ${reporting}, so there is no FX effect to separate. FX never consumes budget.`;
  });

  // --- KPI tiles -------------------------------------------------------------------------------

  protected readonly committedBps = computed(() => {
    const b = this.buckets();
    return b ? shareBps(b.committed, b.authorized) : 0;
  });
  protected readonly actualBps = computed(() => {
    const b = this.buckets();
    return b ? shareBps(b.actual, b.authorized) : 0;
  });
  protected readonly availableBps = computed(() => {
    const b = this.buckets();
    return b ? shareBps(b.available, b.authorized) : 0;
  });
  /**
   * Pacing of spend against the share of the year elapsed, as a delta pill on the Actual tile. A
   * soft warning either way — well ahead of an even spread risks an overrun, well behind it risks
   * the money lapsing — and the words say which. Nothing here is a hard block; the page acts on
   * nothing. The only phased-plan figure the API exposes is per budget, so the scope-wide pill
   * compares against an even spread of the year and says so, rather than claiming the phased plan.
   */
  protected readonly pacingDelta = computed((): KpiDelta | null => {
    const b = this.buckets();
    const y = this.year();
    if (!b || !y || b.authorized === 0) return null;
    const gap = b.usedBps - y.elapsedBps;
    if (gap > 500) {
      return { text: `${pct(gap)} ahead of an even spread`, tone: 'warning', icon: 'trending_up' };
    }
    if (gap < -2000) {
      return {
        text: `${pct(-gap)} behind an even spread`,
        tone: 'warning',
        icon: 'trending_down',
      };
    }
    return { text: 'In step with an even spread', tone: 'neutral' };
  });
  /** Frozen / set-to-zero / over-threshold counts as a pill on the Authorized tile. */
  protected readonly controlsDelta = computed((): KpiDelta | null => {
    const s = this.overview.summary.value();
    if (!s) return null;
    const flags: string[] = [];
    if (s.frozenCount) flags.push(`${s.frozenCount} frozen`);
    if (s.setToZeroCount) flags.push(`${s.setToZeroCount} set to zero`);
    if (s.overThresholdCount) flags.push(`${s.overThresholdCount} over threshold`);
    const budgets = `${s.budgetCount} ${s.budgetCount === 1 ? 'budget' : 'budgets'}`;
    return flags.length
      ? { text: `${budgets} · ${flags.join(' · ')}`, tone: 'warning', icon: 'lock' }
      : { text: `${budgets} in scope`, tone: 'neutral' };
  });

  // --- Needs attention -------------------------------------------------------------------------

  /** Everything the API flagged, worst first (its order), before Home's own cut-off. */
  private readonly allAttentionRows = computed(
    () => this.overview.health.value()?.rows.filter((r) => r.level !== 'healthy') ?? [],
  );
  /**
   * Home shows the worst few and sends the reader to Budget health (013) for the rest: a list of
   * every flagged budget is the inventory this page exists to replace.
   */
  protected readonly attentionRows = computed(() =>
    this.allAttentionRows().slice(0, ATTENTION_SHOWN),
  );
  protected readonly attentionHidden = computed(() =>
    Math.max(0, this.allAttentionRows().length - ATTENTION_SHOWN),
  );
  protected readonly attentionCount = computed(() => {
    const s = this.overview.health.value()?.summary;
    return s ? s.watch + s.atRisk : 0;
  });

  // --- Waiting on your decision ----------------------------------------------------------------

  protected readonly waiting = computed(() => {
    const inbox = this.overview.inbox.value();
    return inbox ? waitingOnYou(inbox.items, inbox.counts.escalated) : null;
  });
  protected readonly waitingText = computed(() => {
    const w = this.waiting();
    return w ? waitingSummary(w) : null;
  });

  // --- The budgets table as a tool -------------------------------------------------------------

  protected readonly q = signal('');
  protected readonly statusFilter = signal<string>('all');
  protected readonly healthFilter = signal<string>('all');
  // The design keeps numeric headers as plain right-aligned labels (no sort arrow); sorting lives on
  // the text columns, where a left-aligned sort header lines up. Default: budget name, A–Z.
  protected readonly sort = signal<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'name',
    dir: 'asc',
  });
  protected readonly columns = ['name', 'owner', 'committed', 'available', 'utilization', 'status'];

  /** Health level per budget, so the table can filter on what the API decided. */
  protected readonly levelById = computed(() => {
    const map = new Map<string, HealthLevel>();
    for (const r of this.overview.health.value()?.rows ?? []) map.set(r.budgetId, r.level);
    return map;
  });
  protected readonly healthFilterAvailable = computed(
    () => this.overview.health.state() === 'ready',
  );

  /** The whole filtered, sorted list; the paginator shows a page of it at a time. */
  protected readonly rows = computed(() => {
    const needle = this.q().trim().toLowerCase();
    const status = this.statusFilter();
    const health = this.healthFilter();
    const levels = this.levelById();
    const filtered = this.budgets.items().filter((b) => {
      if (needle) {
        const haystack = [b.name, b.code ?? '', b.display.ownerName ?? ''].join(' ').toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      if (status === 'active' && !ACTIVE_STATUSES.includes(b.status)) return false;
      if (status !== 'all' && status !== 'active' && b.status !== status) return false;
      if (health !== 'all' && (levels.get(b.id) ?? 'healthy') !== health) return false;
      return true;
    });
    const { key, dir } = this.sort();
    const sign = dir === 'asc' ? 1 : -1;
    // Name then id keeps the order total, so two budgets that tie never swap between renders.
    return [...filtered].sort(
      (a, b) =>
        sign * compare(key, a, b) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    );
  });

  // --- Paging over the loaded budgets (client-side; the page shows one slice at a time) ---------
  protected readonly pageSize = 10;
  protected readonly pageIndex = signal(0);
  /** The rows on the current page. Clamped so a filter that shrinks the list never shows a blank page. */
  protected readonly pageRows = computed(() => {
    const all = this.rows();
    const start = Math.min(this.pageIndex() * this.pageSize, Math.max(0, all.length - 1));
    return all.slice(start, start + this.pageSize);
  });
  /** Any change to the search, filters or sort returns to the first page. */
  private readonly _resetPage = effect(() => {
    this.q();
    this.statusFilter();
    this.healthFilter();
    this.sort();
    this.pageIndex.set(0);
  });

  protected readonly filtersApplied = computed(
    () => !!this.q().trim() || this.statusFilter() !== 'all' || this.healthFilter() !== 'all',
  );

  ngOnInit(): void {
    if (this.me()?.platformOperator) return;
    if (this.canSeeBudgets()) {
      void this.budgets.load();
      void this.overview.summary.load();
    }
    if (this.canSeeHealth()) void this.overview.health.load();
    void this.overview.inbox.load();
  }

  protected committedOf(b: BudgetDetail): number {
    const c = b.balances.budgetCurrency;
    return c.held.amountMinor + c.preEncumbered.amountMinor + c.encumbered.amountMinor;
  }

  protected levelOf(b: BudgetDetail): HealthLevel | null {
    return this.healthFilterAvailable() ? (this.levelById().get(b.id) ?? 'healthy') : null;
  }

  /** Up to two initials for the owner avatar, e.g. "Rahul Menon" -> "RM"; "—" when none. */
  protected initials(b: BudgetDetail): string {
    const name = b.display.ownerName?.trim();
    if (!name) return '—';
    const parts = name.split(/\s+/);
    return (
      (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')
    ).toUpperCase();
  }

  protected onSort(change: Sort): void {
    if (!change.direction) {
      this.sort.set({ key: 'name', dir: 'asc' });
      return;
    }
    this.sort.set({ key: change.active as SortKey, dir: change.direction });
  }

  protected onPage(e: PageEvent): void {
    this.pageIndex.set(e.pageIndex);
  }

  protected clearFilters(): void {
    this.q.set('');
    this.statusFilter.set('all');
    this.healthFilter.set('all');
  }

  protected retryBudgets(): void {
    void this.budgets.load();
  }

  protected retrySummary(): void {
    void this.overview.summary.load();
  }

  protected retryHealth(): void {
    void this.overview.health.load();
  }

  protected retryInbox(): void {
    void this.overview.inbox.load();
  }
}

function compare(key: SortKey, a: BudgetDetail, b: BudgetDetail): number {
  switch (key) {
    case 'name':
      return a.name.localeCompare(b.name);
    case 'owner':
      return (a.display.ownerName ?? '').localeCompare(b.display.ownerName ?? '');
    case 'committed':
      return committedMinor(a) - committedMinor(b);
    case 'available':
      return a.balances.available.amountMinor - b.balances.available.amountMinor;
    case 'utilization':
      return a.utilizationBps - b.utilizationBps;
    case 'status':
      return a.status.localeCompare(b.status);
  }
}

function committedMinor(b: BudgetDetail): number {
  const c = b.balances.budgetCurrency;
  return c.held.amountMinor + c.preEncumbered.amountMinor + c.encumbered.amountMinor;
}
