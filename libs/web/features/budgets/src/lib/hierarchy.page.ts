import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { BudgetDetail } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { BudgetStatus, Money, LoadState } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { balancesOf, can, data, downloadCsv, injectApi, valueOf } from './api';
import { BudgetActions } from './budget-actions';
import { AvailableTip, Spectrum, UsageBar } from './widgets';

interface Row {
  b: BudgetDetail;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

/** Screen 23 (and 14): the budget tree of one program with a detail panel and the control actions. */
@Component({
  selector: 'bf-budget-hierarchy-page',
  imports: [
    AvailableTip,
    BudgetStatus,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    Spectrum,
    UsageBar,
  ],
  templateUrl: './hierarchy.page.html',
  styleUrls: ['./page.scss', './hierarchy.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BudgetHierarchyPage {
  private readonly api = injectApi();
  protected readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly actions = inject(BudgetActions);
  protected readonly can = can;
  protected readonly balancesOf = balancesOf;
  protected readonly valueOf = valueOf;
  private readonly session = inject(SessionStore);
  protected readonly canAllocate = computed(() => this.session.can('budget.allocate'));

  protected readonly tops = resource({
    loader: async () =>
      (await data(this.api.listBudgets({ query: { topLevel: 'true', limit: 500 } }))).items,
  });
  protected readonly programs = computed(() =>
    [...(valueOf(this.tops) ?? [])].sort(
      (a, b) => Number(!a.code) - Number(!b.code) || a.name.localeCompare(b.name),
    ),
  );
  protected readonly rootId = signal<string | null>(this.route.snapshot.queryParamMap.get('root'));
  protected readonly selectedId = signal<string | null>(
    this.route.snapshot.queryParamMap.get('budget'),
  );
  protected readonly filter = signal('');
  protected readonly status = signal<string>('all');
  protected readonly expanded = signal<Set<string>>(new Set());

  protected readonly tree = resource({
    params: () => (this.rootId() ? { rootId: this.rootId()! } : undefined),
    loader: async ({ params }) =>
      (await data(this.api.listBudgets({ query: { rootId: params.rootId, limit: 500 } }))).items,
  });
  protected readonly summary = resource({
    params: () => (this.rootId() ? { rootId: this.rootId()! } : undefined),
    loader: ({ params }) => data(this.api.budgetSummary({ query: params })),
  });

  constructor() {
    effect(() => {
      const list = this.programs();
      if (!this.rootId() && list.length) this.rootId.set(list[0].id);
    });
    effect(() => {
      const items = valueOf(this.tree);
      if (!items?.length) return;
      if (this.expanded().size === 0)
        this.expanded.set(
          new Set(items.filter((b) => b.depth - items[0].depth < 1).map((b) => b.id)),
        );
      if (!this.selectedId() || !items.some((b) => b.id === this.selectedId()))
        this.selectedId.set(items[0].id);
    });
  }

  protected readonly items = computed(() => valueOf(this.tree) ?? []);
  protected readonly root = computed(() => this.items().find((b) => b.id === this.rootId()));
  protected readonly selected = computed(() =>
    this.items().find((b) => b.id === this.selectedId()),
  );

  protected readonly rows = computed((): Row[] => {
    const items = this.items();
    if (!items.length) return [];
    const kids = new Map<string, BudgetDetail[]>();
    for (const b of items)
      if (b.parentId) kids.set(b.parentId, [...(kids.get(b.parentId) ?? []), b]);
    const term = this.filter().trim().toLowerCase();
    const status = this.status();
    const matches = (b: BudgetDetail) =>
      (!term ||
        b.name.toLowerCase().includes(term) ||
        (b.code ?? '').toLowerCase().includes(term)) &&
      (status === 'all' || b.status === status);
    const keep = new Set<string>();
    for (const b of items)
      if (matches(b)) for (const id of b.path.split('/').filter(Boolean)) keep.add(id);
    const filtering = !!term || status !== 'all';
    const out: Row[] = [];
    const base = items[0].depth;
    const walk = (b: BudgetDetail) => {
      if (!keep.has(b.id)) return;
      const children = kids.get(b.id) ?? [];
      const expanded = filtering || this.expanded().has(b.id);
      out.push({ b, depth: b.depth - base, hasChildren: children.length > 0, expanded });
      if (expanded) for (const c of children) walk(c);
    };
    walk(items[0]);
    return out;
  });

  protected toggle(id: string, ev: Event): void {
    ev.stopPropagation();
    this.expanded.update((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  protected selectProgram(id: string): void {
    this.rootId.set(id);
    this.expanded.set(new Set());
    this.selectedId.set(null);
  }

  protected select(id: string): void {
    this.selectedId.set(id);
    void this.router.navigate([], {
      queryParams: { root: this.rootId(), budget: id },
      replaceUrl: true,
    });
  }

  protected reload(): void {
    this.tree.reload();
    this.summary.reload();
  }

  protected async run(
    kind: 'allocate' | 'transfer' | 'freeze' | 'zero' | 'restore' | 'reduce' | 'rollForward',
  ) {
    const b = this.selected();
    if (!b) return;
    const changed =
      kind === 'allocate' ? await this.actions.allocate(b) : await this.actions[kind](b);
    if (changed) this.reload();
  }

  protected export(): void {
    const rows = this.items().map((b) => {
      const x = balancesOf(b);
      return [
        b.code ?? '',
        b.name,
        b.display.ownerName ?? '',
        b.status,
        x.authorized / 100,
        x.allocatedOut / 100,
        x.available / 100,
        b.utilizationBps / 100,
      ];
    });
    downloadCsv(`budget-hierarchy-${this.root()?.code ?? 'program'}.csv`, [
      [
        'Code',
        'Budget',
        'Owner',
        'Status',
        'Authorized (USD)',
        'Allocated (USD)',
        'Available (USD)',
        'Used %',
      ],
      ...rows,
    ]);
  }
}
