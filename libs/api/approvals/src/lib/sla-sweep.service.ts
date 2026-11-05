import { DB, type RequestActor } from '@bf/api/core';
import { tenants, withTenant, type Db } from '@bf/api/db';
import type { CurrencyCode } from '@bf/domain';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';

export const SLA_SWEEP_TOPIC = 'approvals.sla-sweep';
const SYSTEM = 'system:worker';

/**
 * The scheduled half of the SLA escalation sweep. The HTTP endpoint runs the same sweep for one
 * tenant on demand; both are idempotent, because a task that already escalated is no longer pending.
 */
@Injectable()
export class SlaSweepService {
  private readonly log = new Logger('SlaSweep');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly approvals: ApprovalsService,
  ) {}

  /** Sweeps every tenant; returns how many approval tasks were escalated in total. */
  async runForAllTenants(asOf = new Date()): Promise<number> {
    const all = await this.db.transaction((tx) =>
      tx.select({ id: tenants.id, reportingCurrency: tenants.reportingCurrency }).from(tenants),
    );
    let escalated = 0;
    for (const t of all) {
      try {
        escalated += await this.runForTenant(t.id, t.reportingCurrency as CurrencyCode, asOf);
      } catch (e) {
        this.log.error(`SLA sweep failed for tenant ${t.id}: ${(e as Error).message}`);
      }
    }
    return escalated;
  }

  private async runForTenant(
    tenantId: string,
    reportingCurrency: CurrencyCode,
    asOf: Date,
  ): Promise<number> {
    const actor = systemActor(tenantId, reportingCurrency);
    const result = await withTenant(this.db, { tenantId, subject: SYSTEM }, (tx) =>
      this.approvals.runSlaSweepInTx(tx, actor, asOf, null),
    );
    if (result.escalatedCount > 0) {
      this.log.log(`escalated ${result.escalatedCount} overdue approval(s) for tenant ${tenantId}`);
    }
    return result.escalatedCount;
  }
}

/**
 * The sweep acts for the platform, not a person: it has no personId, so approval hygiene still
 * applies to the people it escalates to, and audit entries record the worker subject.
 */
function systemActor(tenantId: string, reportingCurrency: CurrencyCode): RequestActor {
  return {
    tenantId,
    personId: null,
    roles: [],
    ownedBudgetPaths: [],
    subject: SYSTEM,
    displayName: 'BudgetFlow worker',
    tenantName: '',
    reportingCurrency,
    memberships: [],
  };
}
