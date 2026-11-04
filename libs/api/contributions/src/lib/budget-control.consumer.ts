import { systemActor } from '@bf/api/approvals';
import { DB } from '@bf/api/core';
import { budgets, withTenant, type Db } from '@bf/api/db';
import { RequestsService } from '@bf/api/spend';
import { acceptsNewActivity } from '@bf/domain';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { ContributionsService } from './contributions.service';

/** Outbox topic Phase 4 publishes when a budget is frozen, unfrozen, reduced or set to zero. */
export const BUDGET_CONTROL_TOPIC = 'budget.control_changed';

export const SET_TO_ZERO_REASON = 'budget set to zero';
export const FROZEN_REASON = 'Budget frozen: decisions wait until it is unfrozen';

/**
 * Reacts to budget controls (worker job on `budget.control_changed`). It reads the budget's current
 * status rather than trusting the message, so replays and out-of-order messages are harmless:
 * set to zero cancels requests and contribution requests still waiting on the budget (releasing
 * pre-encumbrances, notifying requesters); frozen holds them; active again releases the holds.
 * Existing commitments are untouched and can complete.
 */
@Injectable()
export class BudgetControlConsumer {
  private readonly log = new Logger('BudgetControl');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly requests: RequestsService,
    private readonly contributions: ContributionsService,
  ) {}

  async handle(
    tenantId: string,
    budgetId: string,
  ): Promise<{ status: string; cancelled: number; held: number; released: number }> {
    return withTenant(this.db, { tenantId, subject: 'system:worker' }, async (tx) => {
      const [b] = await tx
        .select({ status: budgets.status })
        .from(budgets)
        .where(eq(budgets.id, budgetId));
      const out = { status: b?.status ?? 'missing', cancelled: 0, held: 0, released: 0 };
      if (!b) return out;
      const actor = systemActor(tenantId);
      if (b.status === 'set_to_zero') {
        out.cancelled += await this.requests.cancelWaitingForBudget(
          tx,
          actor,
          budgetId,
          SET_TO_ZERO_REASON,
        );
        out.cancelled += await this.contributions.cancelWaitingForBudget(
          tx,
          actor,
          budgetId,
          SET_TO_ZERO_REASON,
        );
      } else if (b.status === 'frozen') {
        out.held += await this.requests.holdWaitingForBudget(
          tx,
          actor,
          budgetId,
          true,
          FROZEN_REASON,
        );
        out.held += await this.contributions.holdWaitingForBudget(
          tx,
          actor,
          budgetId,
          true,
          FROZEN_REASON,
        );
      } else if (acceptsNewActivity(b.status).ok) {
        out.released += await this.requests.holdWaitingForBudget(
          tx,
          actor,
          budgetId,
          false,
          'Budget active again',
        );
        out.released += await this.contributions.holdWaitingForBudget(
          tx,
          actor,
          budgetId,
          false,
          'Budget active again',
        );
      }
      this.log.log(
        `budget ${budgetId} ${b.status}: ${out.cancelled} cancelled, ${out.held} held, ${out.released} released`,
      );
      return out;
    });
  }
}
