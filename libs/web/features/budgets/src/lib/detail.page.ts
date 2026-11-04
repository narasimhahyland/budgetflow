import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  resource,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { PerHeadResult } from '@bf/contracts';
import { BudgetStatus, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { balancesOf, can, data, errorMessage, injectApi, pct, valueOf } from './api';
import { BudgetActions } from './budget-actions';
import { ChangeRequests } from './change-requests';
import {
  ChildrenTab,
  HistoryTab,
  LedgerTab,
  LimitsTab,
  PhasingTab,
  VersionsTab,
} from './detail-tabs';
import { LoadState } from './load-state';
import { AvailableTip, Spectrum } from './widgets';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'children', label: 'Children' },
  { key: 'phasing', label: 'Phasing' },
  { key: 'limits', label: 'Limits' },
  { key: 'requests', label: 'Requests' },
  { key: 'versions', label: 'Versions' },
  { key: 'history', label: 'Allocation history' },
  { key: 'ledger', label: 'Ledger' },
] as const;

/** Screen 21: one budget with its numbers, controls and tabs (29a for a contingency reserve). */
@Component({
  selector: 'bf-budget-detail-page',
  imports: [
    AvailableTip,
    BudgetStatus,
    ChangeRequests,
    ChildrenTab,
    HistoryTab,
    LedgerTab,
    LimitsTab,
    LoadState,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    Money,
    PhasingTab,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_TAG_IMPORTS,
    Spectrum,
    VersionsTab,
  ],
  templateUrl: './detail.page.html',
  styleUrls: ['./page.scss', './detail.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BudgetDetailPage {
  private readonly api = injectApi();
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly actions = inject(BudgetActions);
  readonly budgetId = input.required<string>();
  protected readonly tabs = TABS;
  protected readonly can = can;
  protected readonly pct = pct;
  protected readonly tab = signal<string>(
    this.route.snapshot.queryParamMap.get('tab') ?? 'overview',
  );
  protected readonly res = resource({
    params: () => ({ id: this.budgetId() }),
    loader: ({ params }) => data(this.api.getBudget({ params: { budgetId: params.id } })),
  });
  protected readonly b = computed(() => valueOf(this.res));
  protected readonly bal = computed(() => {
    const b = this.b();
    return b ? balancesOf(b) : null;
  });
  protected readonly trueUp = signal<PerHeadResult | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);
  protected readonly threshold = computed(() => this.b()?.thresholdsReachedPct.at(-1) ?? null);
  protected readonly committedPct = computed(() => {
    const x = this.bal();
    return x && x.authorized > 0
      ? Math.floor(((x.encumbered + x.preEncumbered) * 10_000) / x.authorized)
      : 0;
  });
  protected readonly actualPct = computed(() => {
    const x = this.bal();
    return x && x.authorized > 0 ? Math.floor((x.actual * 10_000) / x.authorized) : 0;
  });
  protected readonly availablePct = computed(() => {
    const x = this.bal();
    return x && x.authorized > 0
      ? Math.floor((Math.max(x.available, 0) * 10_000) / x.authorized)
      : 0;
  });

  protected setTab(key: string): void {
    this.tab.set(key);
    void this.router.navigate([], { queryParams: { tab: key }, replaceUrl: true });
  }

  protected reload(): void {
    this.res.reload();
  }

  protected async run(
    kind:
      | 'increase'
      | 'transfer'
      | 'reduce'
      | 'zero'
      | 'freeze'
      | 'restore'
      | 'settings'
      | 'rollForward'
      | 'release',
  ): Promise<void> {
    const b = this.b();
    if (!b) return;
    if (await this.actions[kind](b)) {
      this.notice.set(
        kind === 'increase'
          ? 'Increase request sent to the owner of the parent budget.'
          : kind === 'release'
            ? 'Release request sent for approval.'
            : 'Saved. The change is recorded in the audit trail.',
      );
      this.reload();
    }
  }

  protected async allocate(): Promise<void> {
    const b = this.b();
    if (b && (await this.actions.allocate(b))) this.reload();
  }

  protected async activate(): Promise<void> {
    const b = this.b();
    if (!b) return;
    try {
      await data(this.api.activateBudget({ params: { budgetId: b.id } }));
      this.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    }
  }

  protected async checkTrueUp(): Promise<void> {
    const b = this.b();
    if (!b) return;
    try {
      this.trueUp.set(
        await data(this.api.perHeadTrueUp({ params: { budgetId: b.id }, body: { dryRun: true } })),
      );
    } catch (e) {
      this.failure.set(errorMessage(e));
    }
  }
}
