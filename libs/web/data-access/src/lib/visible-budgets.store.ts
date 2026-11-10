import { inject, Injectable, signal } from '@angular/core';
import type { BudgetDetail, ProblemDetails } from '@bf/contracts';
import { ApiService } from './api.service';

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

/** Stop following the cursor after this many budgets; the table paginates what is loaded. */
const MAX_BUDGETS = 500;
const PAGE = 100;

/**
 * Budgets the signed-in user may see (GET /api/budgets), with ledger-derived balances from the API.
 * The endpoint is cursor-paginated; this follows the cursor so the table's search, sort and filters
 * cover every budget in scope, not only the first page, and the table paginates the result in the
 * browser. The API enforces scope on every page.
 */
@Injectable({ providedIn: 'root' })
export class VisibleBudgetsStore {
  private readonly api = inject(ApiService);

  readonly items = signal<BudgetDetail[]>([]);
  readonly state = signal<LoadState>('idle');
  readonly problem = signal<ProblemDetails | null>(null);
  /** True when the cap was reached before the API ran out of pages (rare; the table says so). */
  readonly truncated = signal(false);

  async load(): Promise<void> {
    this.state.set('loading');
    this.problem.set(null);
    this.truncated.set(false);
    const all: BudgetDetail[] = [];
    let cursor: string | undefined;
    try {
      do {
        const res = await this.api.client.listBudgets({
          query: { limit: PAGE, ...(cursor ? { cursor } : {}) },
        });
        if (!res.ok) {
          this.problem.set(res.problem);
          this.state.set('error');
          return;
        }
        all.push(...res.data.items);
        cursor = res.data.nextCursor ?? undefined;
        if (all.length >= MAX_BUDGETS && cursor) {
          this.truncated.set(true);
          cursor = undefined;
        }
      } while (cursor);
      this.items.set(all);
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }
}
