import { computed, inject, Injectable, signal } from '@angular/core';
import type {
  ApiResult,
  ApprovalInbox,
  BudgetHealthOverview,
  BudgetSummary,
  ProblemDetails,
} from '@bf/contracts';
import { ApiService } from './api.service';

/**
 * Per-section load state. `absent` is the section the API will not serve this user (403) or has no
 * figures for in their scope (404): Home leaves it out rather than showing them a broken card.
 */
export type SectionState = 'idle' | 'loading' | 'ready' | 'error' | 'absent';

/**
 * One independently loaded endpoint behind a Home section, so a section that fails or is refused
 * does not take the rest of the page with it.
 */
export class ApiSection<T> {
  readonly value = signal<T | null>(null);
  readonly state = signal<SectionState>('idle');
  readonly problem = signal<ProblemDetails | null>(null);
  readonly loading = computed(() => this.state() === 'idle' || this.state() === 'loading');
  readonly absent = computed(() => this.state() === 'absent');

  constructor(private readonly request: () => Promise<ApiResult<T>>) {}

  async load(): Promise<void> {
    this.state.set('loading');
    this.problem.set(null);
    try {
      const res = await this.request();
      if (res.ok) {
        this.value.set(res.data);
        this.state.set('ready');
        return;
      }
      this.problem.set(res.problem);
      this.state.set(res.problem.status === 403 || res.problem.status === 404 ? 'absent' : 'error');
    } catch {
      this.state.set('error');
    }
  }
}

/**
 * The three roll-up endpoints behind the executive overview on Home. Each is loaded on its own and
 * only when the API says this user may read it; the API enforces scope on every call.
 */
@Injectable({ providedIn: 'root' })
export class OverviewStore {
  private readonly api = inject(ApiService);

  /** GET /api/dashboards/health: the five written checks per budget, worst first (report.read). */
  readonly health = new ApiSection<BudgetHealthOverview>(() =>
    this.api.client.getBudgetHealth({ query: { limit: 50 } }),
  );
  /** GET /api/budgets/summary: the bucket roll-up over the budgets in scope (budget.read). */
  readonly summary = new ApiSection<BudgetSummary>(() =>
    this.api.client.budgetSummary({ query: {} }),
  );
  /** GET /api/approvals/inbox: what waits on this user's decision (tenant membership). */
  readonly inbox = new ApiSection<ApprovalInbox>(() =>
    this.api.client.getApprovalInbox({ query: { tab: 'assigned', limit: 100 } }),
  );
}
