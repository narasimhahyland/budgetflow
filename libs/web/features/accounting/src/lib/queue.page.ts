import { DatePipe, DecimalPipe } from '@angular/common';
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
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { ActivatedRoute } from '@angular/router';
import type { ActualDetail, ActualLine, BudgetDetail } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { formatMoney, LoadState, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { ActualsTabs } from './actuals-tabs';
import { data, errorMessage, injectApi, todayIso, toMinor, valueOf } from './api';

type Target = { kind: 'commitment'; id: string } | { kind: 'budget'; id: string };
type Mode = 'match' | 'split' | 'exclude' | 'over-budget';

const FIT_TEXT: Record<string, string> = {
  exact: 'Exact match: the commitment is fully consumed.',
  under_within_tolerance: 'Within tolerance: consumes the commitment and releases the difference.',
  over_within_tolerance:
    'Within tolerance: the extra amount is charged to the budget as additional actual.',
  partial: 'Partial match: the commitment stays open for further invoices.',
  over_tolerance: 'Above the commitment plus its tolerance: needs over-budget approval first.',
  refund: 'Refund: reduces the actual on this budget.',
};

/** Screen 80b: unmatched actuals queue with the match drawer (match, split, not budget-relevant, over-budget). */
@Component({
  selector: 'bf-queue-page',
  imports: [
    ActualsTabs,
    DatePipe,
    DecimalPipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatRadioModule,
    MatSelectModule,
    MatTableModule,
    Money,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  templateUrl: './queue.page.html',
  styleUrls: ['./page.scss', './accounting.scss', './queue.page.scss'],
  styles: `
    .bf-queue {
      display: grid;
      grid-template-columns: minmax(0, 3fr) minmax(320px, 2fr);
      gap: 16px;
      align-items: start;
    }
    @media (max-width: 1100px) {
      .bf-queue {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .bf-split {
      display: grid;
      grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
      gap: 0 12px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QueuePage {
  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  private readonly route = inject(ActivatedRoute);
  protected readonly valueOf = valueOf;
  protected readonly columns = [
    'date',
    'vendor',
    'description',
    'transaction',
    'reporting',
    'suggestion',
  ];
  protected readonly canManage = computed(() => this.session.can('actuals.manage'));

  protected readonly entity = signal('all');
  protected readonly currency = signal('all');
  protected readonly search = signal('');
  protected readonly batchFile = signal<string | null>(
    this.route.snapshot.queryParamMap.get('file'),
  );

  protected readonly entities = resource({ loader: () => data(this.api.listLegalEntities({})) });
  protected readonly imports = resource({ loader: () => data(this.api.listActualsImports({})) });
  private readonly batchId = computed(() => {
    const f = this.batchFile();
    return f ? (valueOf(this.imports)?.items.find((b) => b.fileName === f)?.id ?? null) : null;
  });
  protected readonly list = resource({
    params: () => ({
      status: 'queue' as const,
      limit: 100,
      ...(this.entity() !== 'all' ? { legalEntityId: this.entity() } : {}),
      ...(this.currency() !== 'all' ? { currency: this.currency() } : {}),
      ...(this.search().trim() ? { q: this.search().trim() } : {}),
      ...(this.batchId() ? { batchId: this.batchId()! } : {}),
    }),
    loader: ({ params }) => data(this.api.listActuals({ query: params })),
  });
  protected readonly items = computed(() => valueOf(this.list)?.items ?? []);
  protected readonly queueCount = computed(() => valueOf(this.list)?.counts.queue ?? null);
  protected readonly currencies = computed(() =>
    [...new Set(this.items().map((i) => i.transaction.currency))].sort(),
  );

  // Drawer
  protected readonly selectedId = signal<string | null>(null);
  protected readonly detail = resource({
    params: () => (this.selectedId() ? { actualId: this.selectedId()! } : undefined),
    loader: ({ params }) => data(this.api.getActual({ params })),
  });
  protected readonly budgets = resource({
    loader: async () => {
      const items: BudgetDetail[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 5; page++) {
        const r = await data(
          this.api.listBudgets({ query: { limit: 200, ...(cursor ? { cursor } : {}) } }),
        );
        items.push(...r.items);
        if (!r.nextCursor) break;
        cursor = r.nextCursor;
      }
      return { items: items.sort((a, b) => a.name.localeCompare(b.name)) };
    },
  });
  protected readonly entityBudgets = computed(() => {
    const a = valueOf(this.detail)?.actual;
    return (valueOf(this.budgets)?.items ?? []).filter(
      (b) => !a || b.legalEntityId === a.legalEntityId,
    );
  });
  protected readonly mode = signal<Mode>('match');
  protected readonly target = signal<Target | null>(null);
  protected readonly directBudget = signal<string | null>(null);
  protected readonly amount = signal('');
  protected readonly final = signal(false);
  protected readonly prepaid = signal(false);
  protected readonly serviceStart = signal(todayIso());
  protected readonly serviceEnd = signal(todayIso());
  protected readonly confirmDuplicate = signal(false);
  protected readonly reason = signal('');
  protected readonly splits = signal<{ target: string; amount: string }[]>([]);
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  constructor() {
    effect(() => {
      const d = valueOf(this.detail);
      if (!d) return;
      const first = d.candidates[0];
      const proposed = d.actual.suggestion;
      this.mode.set('match');
      this.final.set(false);
      this.prepaid.set(false);
      this.confirmDuplicate.set(false);
      this.reason.set('');
      this.amount.set('');
      this.failure.set(null);
      this.splits.set([
        { target: first ? `c:${first.commitmentId}` : '', amount: '' },
        { target: '', amount: '' },
      ]);
      // Without a suggestion the drawer starts on a budget choice rather than guessing a commitment.
      if (proposed?.commitmentId)
        this.target.set({ kind: 'commitment', id: proposed.commitmentId });
      else this.target.set({ kind: 'budget', id: proposed?.budgetId ?? '' });
      this.directBudget.set(proposed && !proposed.commitmentId ? proposed.budgetId : null);
    });
  }

  protected readonly chosen = computed(() => {
    const t = this.target();
    const d = valueOf(this.detail);
    return t?.kind === 'commitment'
      ? (d?.candidates.find((c) => c.commitmentId === t.id) ?? null)
      : null;
  });

  protected status(a: ActualLine): {
    tone: 'warning' | 'info' | 'important' | 'neutral';
    text: string;
  } {
    if (a.duplicateOfActualId) return { tone: 'important', text: 'Possible duplicate' };
    if (a.overBudgetRequest?.status === 'pending_approval')
      return { tone: 'info', text: 'Over-budget request pending' };
    if (a.note?.includes('tolerance')) return { tone: 'warning', text: 'Over tolerance' };
    if (a.status === 'partially_matched') return { tone: 'info', text: 'Partially matched' };
    return { tone: 'neutral', text: 'Unmatched' };
  }

  protected fitText(fit: string): string {
    return FIT_TEXT[fit] ?? '';
  }

  protected money(minor: number, currency: string): string {
    return formatMoney(minor, currency);
  }

  protected left(a: ActualLine): number {
    return Math.abs(a.transaction.amountMinor) - Math.abs(a.matched.amountMinor);
  }

  protected select(a: ActualLine): void {
    this.notice.set(null);
    this.selectedId.set(a.id);
  }

  protected close(): void {
    this.selectedId.set(null);
  }

  protected async match(): Promise<void> {
    const d = valueOf(this.detail);
    const t = this.target();
    if (!d || !t) return;
    const budgetId = t.kind === 'budget' ? this.directBudget() : null;
    if (t.kind === 'budget' && !budgetId) {
      this.failure.set('Choose the budget to charge.');
      return;
    }
    await this.run(async () => {
      const amountMinor = toMinor(this.amount(), d.actual.transaction.currency);
      const part =
        t.kind === 'commitment'
          ? { commitmentId: t.id, final: this.final() || undefined }
          : { budgetId: budgetId! };
      const r = await data(
        this.api.matchActual({
          params: { actualId: d.actual.id },
          body: {
            parts: [{ ...part, ...(amountMinor ? { amountMinor } : {}) }],
            ...(this.prepaid() && t.kind === 'commitment'
              ? {
                  prepaid: {
                    serviceStart: this.serviceStart(),
                    serviceEnd: this.serviceEnd(),
                    nonRefundable: true,
                  },
                }
              : {}),
            ...(this.confirmDuplicate() ? { confirmNotDuplicate: true } : {}),
          },
        }),
      );
      this.done(
        r,
        `${d.actual.sourceRef} matched to ${r.matches.at(-1)?.commitmentReference ?? r.matches.at(-1)?.budgetName ?? 'the budget'}.`,
      );
    });
  }

  protected async split(): Promise<void> {
    const d = valueOf(this.detail);
    if (!d) return;
    await this.run(async () => {
      const parts = this.splits()
        .filter((s) => s.target)
        .map((s) => {
          const amountMinor = toMinor(s.amount, d.actual.transaction.currency);
          const ref = s.target.startsWith('c:')
            ? { commitmentId: s.target.slice(2) }
            : { budgetId: s.target.slice(2) };
          return { ...ref, ...(amountMinor ? { amountMinor } : {}) };
        });
      const r = await data(
        this.api.matchActual({
          params: { actualId: d.actual.id },
          body: { parts, ...(this.confirmDuplicate() ? { confirmNotDuplicate: true } : {}) },
        }),
      );
      this.done(r, `${d.actual.sourceRef} split across ${parts.length} targets.`);
    });
  }

  protected async exclude(): Promise<void> {
    const d = valueOf(this.detail);
    if (!d) return;
    await this.run(async () => {
      const r = await data(
        this.api.excludeActual({
          params: { actualId: d.actual.id },
          body: { reason: this.reason() },
        }),
      );
      this.done(r, `${d.actual.sourceRef} marked not budget-relevant.`);
    });
  }

  protected async requestOverBudget(): Promise<void> {
    const d = valueOf(this.detail);
    const c = this.chosen();
    if (!d) return;
    await this.run(async () => {
      const r = await data(
        this.api.requestOverBudget({
          params: { actualId: d.actual.id },
          body: {
            ...(c ? { commitmentId: c.commitmentId } : { budgetId: this.directBudget()! }),
            purpose: this.reason(),
          },
        }),
      );
      this.notice.set(
        `Over-budget request for ${this.money(r.amount.amountMinor, r.amount.currency)} sent for approval.`,
      );
      this.mode.set('match');
      this.detail.reload();
      this.list.reload();
    });
  }

  protected setSplit(i: number, key: 'target' | 'amount', value: string): void {
    this.splits.update((rows) => rows.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  }

  protected addSplit(): void {
    this.splits.update((rows) => [...rows, { target: '', amount: '' }]);
  }

  private done(r: ActualDetail, message: string): void {
    this.notice.set(message);
    this.selectedId.set(
      r.actual.status === 'matched' || r.actual.status === 'excluded' ? null : r.actual.id,
    );
    this.list.reload();
    if (this.selectedId()) this.detail.reload();
  }

  private async run(action: () => Promise<void>): Promise<void> {
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
