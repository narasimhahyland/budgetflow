import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { BatchAllocationResult, BudgetDetail } from '@bf/contracts';
import { Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, pct, toMajor, toMinor, valueOf } from './api';
import { LoadState } from './load-state';

interface GridRow {
  key: string;
  childId: string | null;
  name: string;
  owner: string;
  driver: 'fixed' | 'per_head';
  currentMinor: number;
  next: string;
  locked: boolean;
}

/** Screens 22 and 22b: allocation workspace with a keyboard-first grid, paste from Excel and one-change submit. */
@Component({
  selector: 'bf-allocation-workspace-page',
  imports: [
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  templateUrl: './allocate.page.html',
  styleUrls: ['./page.scss', './allocate.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AllocationWorkspacePage {
  private readonly api = injectApi();
  private readonly router = inject(Router);
  protected readonly pct = pct;
  protected readonly toMinor = toMinor;
  private readonly grid = viewChild<ElementRef<HTMLElement>>('grid');
  protected readonly parentId = signal<string | null>(
    inject(ActivatedRoute).snapshot.queryParamMap.get('parent'),
  );
  private readonly allowedRes = resource({
    loader: async () => (await data(this.api.listBudgets({ query: { limit: 500 } }))).items,
  });
  protected readonly parents = computed(() =>
    (valueOf(this.allowedRes) ?? []).filter(
      (b) => b.allowedActions.includes('budget.allocate') && b.childCount >= 0,
    ),
  );
  protected readonly parentRes = resource({
    params: () => (this.parentId() ? { id: this.parentId()! } : undefined),
    loader: ({ params }) => data(this.api.getBudget({ params: { budgetId: params.id } })),
  });
  protected readonly parent = computed(() => valueOf(this.parentRes));
  private readonly childrenRes = resource({
    params: () =>
      this.parentId() ? { id: this.parentId()!, v: this.parent()?.version ?? 0 } : undefined,
    loader: async ({ params }) =>
      (await data(this.api.listBudgets({ query: { parentId: params.id, limit: 500 } }))).items,
  });
  protected readonly rows = signal<GridRow[]>([]);
  protected readonly pasted = signal<number | null>(null);
  protected readonly preview = signal<BatchAllocationResult | null>(null);
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly done = signal<string | null>(null);
  protected pasteText = '';

  constructor() {
    effect(() => {
      if (this.parentId()) return;
      const list = this.parents();
      const preferred = list.find((p) => p.childCount > 0) ?? list[0];
      if (preferred) this.parentId.set(preferred.id);
    });
    effect(() => {
      const kids = valueOf(this.childrenRes);
      if (!kids) return;
      this.rows.set(kids.map((c) => this.rowOf(c)));
      this.preview.set(null);
    });
    effect((onCleanup) => {
      const lines = this.changes();
      const p = this.parent();
      if (!p || !lines.length || this.rowErrors().size) {
        this.preview.set(null);
        return;
      }
      const t = setTimeout(async () => {
        try {
          this.preview.set(
            await data(
              this.api.allocateBatch({ params: { budgetId: p.id }, body: { dryRun: true, lines } }),
            ),
          );
        } catch (e) {
          this.failure.set(errorMessage(e));
        }
      }, 300);
      onCleanup(() => clearTimeout(t));
    });
  }

  private rowOf(c: BudgetDetail): GridRow {
    const current = c.balances.budgetCurrency.authorized.amountMinor;
    return {
      key: c.id,
      childId: c.id,
      name: c.name,
      owner: c.display.ownerName ?? '—',
      driver: c.allocationDriver,
      currentMinor: current,
      next: toMajor(current),
      locked:
        c.allocationDriver === 'per_head' ||
        ['frozen', 'set_to_zero', 'closed', 'draft'].includes(c.status),
    };
  }

  protected selectParent(id: string): void {
    this.parentId.set(id);
    this.done.set(null);
    this.pasted.set(null);
    void this.router.navigate([], { queryParams: { parent: id }, replaceUrl: true });
  }

  protected deltaOf(r: GridRow): number | null {
    const n = toMinor(r.next);
    return n === null ? null : n - r.currentMinor;
  }

  protected readonly rowErrors = computed(() => {
    const m = new Map<string, string>();
    for (const r of this.rows()) {
      const n = toMinor(r.next);
      if (n === null || n < 0) m.set(r.key, 'Enter an amount in USD.');
      else if (n < r.currentMinor) m.set(r.key, 'Lowering a budget needs Reduce with a reason.');
      else if (!r.childId && r.name.trim().length < 2) m.set(r.key, 'Name the new budget.');
    }
    return m;
  });

  protected readonly changes = computed(() =>
    this.rows()
      .map((r) => ({ r, d: this.deltaOf(r) ?? 0 }))
      .filter(({ d }) => d > 0)
      .map(({ r, d }) =>
        r.childId
          ? { childBudgetId: r.childId, amountMinor: d }
          : { newChild: { name: r.name.trim() }, amountMinor: d },
      ),
  );
  /** New rows have no owner yet, so they are saved as Drafts and allocate nothing. */
  protected readonly totalChange = computed(() =>
    this.changes().reduce((s, l) => s + ('childBudgetId' in l ? l.amountMinor : 0), 0),
  );
  protected readonly available = computed(
    () => this.parent()?.balances.allocationAvailable.amountMinor ?? 0,
  );
  protected readonly over = computed(() => this.totalChange() > this.available());
  protected readonly allocatedPct = computed(() => {
    const p = this.parent();
    const a = p?.balances.budgetCurrency.authorized.amountMinor ?? 0;
    return a > 0
      ? Math.floor(
          ((p!.balances.budgetCurrency.allocatedOut.amountMinor + this.totalChange()) * 10_000) / a,
        )
      : 0;
  });

  protected update(key: string, patch: Partial<GridRow>): void {
    this.rows.update((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    this.done.set(null);
  }

  protected addRow(name = '', amountMinor = 0): void {
    this.rows.update((rows) => [
      ...rows,
      {
        key: `new-${rows.length}-${Date.now()}`,
        childId: null,
        name,
        owner: 'No owner yet (Draft)',
        driver: 'fixed',
        currentMinor: 0,
        next: toMajor(amountMinor),
        locked: false,
      },
    ]);
  }

  protected removeRow(key: string): void {
    this.rows.update((rows) => rows.filter((r) => r.key !== key));
  }

  /** Rows pasted from Excel: first column a child name or code, last numeric column the new amount. */
  protected applyPaste(text: string): void {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.split('\t'))
      .filter((cells) => cells.some((c) => c.trim()));
    let count = 0;
    const kids = valueOf(this.childrenRes) ?? [];
    for (const cells of lines) {
      const label = cells[0]?.trim() ?? '';
      const amountCell = [...cells].reverse().find((c) => toMinor(c) !== null);
      const amount = amountCell !== undefined ? toMinor(amountCell) : null;
      if (!label || amount === null) continue;
      count++;
      const match = kids.find(
        (k) =>
          k.name.toLowerCase() === label.toLowerCase() ||
          (k.code ?? '').toLowerCase() === label.toLowerCase(),
      );
      if (match) this.update(match.id, { next: toMajor(amount) });
      else {
        const existing = this.rows().find(
          (r) => !r.childId && r.name.toLowerCase() === label.toLowerCase(),
        );
        if (existing) this.update(existing.key, { next: toMajor(amount) });
        else this.addRow(label, amount);
      }
    }
    this.pasted.set(count);
    this.pasteText = '';
  }

  protected onPaste(ev: ClipboardEvent): void {
    const text = ev.clipboardData?.getData('text/plain') ?? '';
    if (!text.includes('\t') && !text.includes('\n')) return;
    ev.preventDefault();
    this.applyPaste(text);
  }

  protected move(ev: Event, index: number, step: number): void {
    ev.preventDefault();
    const inputs =
      this.grid()?.nativeElement.querySelectorAll<HTMLInputElement>('input[data-col="next"]');
    inputs?.[Math.max(0, Math.min((inputs?.length ?? 1) - 1, index + step))]?.focus();
  }

  protected discard(): void {
    this.rows.set((valueOf(this.childrenRes) ?? []).map((c) => this.rowOf(c)));
    this.pasted.set(null);
  }

  protected async submit(): Promise<void> {
    const p = this.parent();
    if (!p) return;
    this.busy.set(true);
    this.failure.set(null);
    try {
      const r = await data(
        this.api.allocateBatch({
          params: { budgetId: p.id },
          body: { dryRun: false, lines: this.changes(), memo: 'Allocation workspace' },
        }),
      );
      const drafts = r.lines.filter((l) => l.outcome === 'draft').length;
      this.done.set(
        `Posted ${r.journalIds.length} allocation(s) as one change.` +
          (drafts
            ? ` ${drafts} new budget(s) saved as Draft with nothing allocated; set an owner to activate them.`
            : ''),
      );
      this.pasted.set(null);
      this.parentRes.reload();
      this.childrenRes.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
