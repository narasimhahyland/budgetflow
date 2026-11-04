import { inject, Injectable, signal } from '@angular/core';
import type { BudgetDetail, ProblemDetails } from '@bf/contracts';
import { ApiService } from './api.service';

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

/** Budgets the signed-in user may see (GET /api/budgets), with ledger-derived balances from the API. */
@Injectable({ providedIn: 'root' })
export class VisibleBudgetsStore {
  private readonly api = inject(ApiService);

  readonly items = signal<BudgetDetail[]>([]);
  readonly state = signal<LoadState>('idle');
  readonly problem = signal<ProblemDetails | null>(null);

  async load(limit = 100): Promise<void> {
    this.state.set('loading');
    this.problem.set(null);
    try {
      const res = await this.api.client.listBudgets({ query: { limit } });
      if (res.ok) {
        this.items.set(res.data.items);
        this.state.set('ready');
      } else {
        this.problem.set(res.problem);
        this.state.set('error');
      }
    } catch {
      this.state.set('error');
    }
  }
}
