import { DB } from '@bf/api/core';
import { budgets, withTenant, type Db } from '@bf/api/db';
import { noticeEmail, NotificationsService } from '@bf/api/notifications';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

/** Outbox topic Phase 4 publishes when a budget's utilization reaches an owner alert threshold. */
export const BUDGET_THRESHOLD_TOPIC = 'budget.threshold_crossed';

export interface ThresholdCrossed {
  tenantId: string;
  budgetId: string;
  ownerPersonId: string | null;
  thresholdPct: number;
  utilizationBps: number;
}

/** Emails the budget owner when a spend posting pushes the budget past an alert threshold. */
@Injectable()
export class BudgetAlertsConsumer {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly notifications: NotificationsService,
  ) {}

  async handle(m: ThresholdCrossed): Promise<boolean> {
    if (!m.ownerPersonId) return false;
    const ownerId = m.ownerPersonId;
    return withTenant(this.db, { tenantId: m.tenantId, subject: 'system:worker' }, async (tx) => {
      const [b] = await tx
        .select({ name: budgets.name })
        .from(budgets)
        .where(eq(budgets.id, m.budgetId));
      const owner = await this.notifications.personEmail(tx, ownerId);
      if (!b || !owner) return false;
      const used = `${(Math.floor(m.utilizationBps / 10) / 10).toFixed(1)}%`;
      await this.notifications.queueEmail(
        tx,
        m.tenantId,
        owner,
        noticeEmail({
          firstName: owner.firstName,
          subject: `${b.name} has reached ${m.thresholdPct}% of its budget`,
          headline: `${b.name} is now ${used} used, past your ${m.thresholdPct}% alert.`,
          lines: [
            ['Budget', b.name],
            ['Used', used],
            ['Alert threshold', `${m.thresholdPct}%`],
          ],
          detailsUrl: `${this.notifications.webBaseUrl}/budgets/${m.budgetId}`,
        }),
        'budget.threshold_crossed',
      );
      return true;
    });
  }
}
