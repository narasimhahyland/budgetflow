import { ExternalBudgetChecks, type ExternalCheckResult } from '@bf/api/approvals';
import { ApiProblem, DB, nowUtc, PolicyService, todayUtc, type RequestActor } from '@bf/api/core';
import {
  approvalDelegations,
  approvalInstances,
  approvalTasks,
  budgets,
  costCenters,
  integrationConnections,
  legalEntities,
  requests,
  withTenant,
  type Db,
} from '@bf/api/db';
import type {
  ExternalBudgetCheck,
  ExternalBudgetCheckList,
  IntegrationProvider,
} from '@bf/contracts';
import { exponentOf, type CurrencyCode } from '@bf/domain';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { budgetCheckSetting } from './budget-check-setting';
import { connectorFor } from './connectors';
import { ConnectionsService, tenantOf } from './connections.service';
import { OutboundHttp, providerMessage } from './http';

const minorToMajor = (minor: number, currency: string): string => {
  const exponent = exponentOf(currency as CurrencyCode);
  return (minor / 10 ** exponent).toFixed(exponent);
};

/**
 * runBudgetCheck (094, Workday Financials). Before a spending request is approved, the ERP that
 * controls the ledger is asked whether its own budget still covers the amount. The call runs with a
 * timeout outside any transaction. Warn mode shows the answer on the approval card and records it
 * with the decision; Block mode also refuses the approval when the ERP says no or cannot be reached.
 * The check never posts, approves or changes anything in either system.
 */
@Injectable()
export class BudgetCheckService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
    private readonly connections: ConnectionsService,
    private readonly http: OutboundHttp,
    private readonly registry: ExternalBudgetChecks,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      checkTask: async (actor, taskId, amountMinor) =>
        (await this.run(actor, taskId, false, amountMinor)).map(
          (c): ExternalCheckResult => ({
            providerName: c.providerName,
            status: c.status,
            blocksApproval: c.blocksApproval,
            message: c.message,
          }),
        ),
    });
  }

  /** The approval card's check line: the assignee, or anyone who reads the integrations area. */
  async list(actor: RequestActor, taskId: string): Promise<ExternalBudgetCheckList> {
    return { items: await this.run(actor, taskId, true, null) };
  }

  private async run(
    actor: RequestActor,
    taskId: string,
    strict: boolean,
    amountMinor: number | null,
  ): Promise<ExternalBudgetCheck[]> {
    const prepared = await withTenant(
      this.db,
      { tenantId: actor.tenantId, subject: actor.subject },
      async (tx) => {
        const [task] = await tx.select().from(approvalTasks).where(eq(approvalTasks.id, taskId));
        if (!task) {
          if (strict) throw ApiProblem.notFound('approval');
          return null;
        }
        const mine = actor.personId === task.assigneePersonId;
        const delegate =
          !mine && actor.personId
            ? (
                await tx
                  .select({ id: approvalDelegations.id })
                  .from(approvalDelegations)
                  .where(
                    and(
                      eq(approvalDelegations.delegatorPersonId, task.assigneePersonId),
                      eq(approvalDelegations.delegatePersonId, actor.personId),
                      isNull(approvalDelegations.revokedAt),
                      lte(approvalDelegations.validFrom, todayUtc()),
                      or(
                        isNull(approvalDelegations.validTo),
                        gte(approvalDelegations.validTo, todayUtc()),
                      ),
                    ),
                  )
                  .limit(1)
              ).length > 0
            : false;
        // Nobody but the assignee or an active delegate reaches the ERP from a decision; the card's
        // read is also open to whoever reads the integrations area.
        const reader = this.policy.can(actor, 'integration.read', tenantOf(actor)).allowed;
        if (!mine && !delegate && !(strict && reader)) {
          if (strict) throw ApiProblem.notFound('approval');
          return null;
        }
        if (task.status !== 'pending') return null;
        const [instance] = await tx
          .select()
          .from(approvalInstances)
          .where(eq(approvalInstances.id, task.instanceId));
        if (!instance || instance.subjectType !== 'request') return null;
        const [req] = await tx.select().from(requests).where(eq(requests.id, instance.subjectId));
        if (!req?.budgetId) return null;
        const [budget] = await tx.select().from(budgets).where(eq(budgets.id, req.budgetId));
        const [entity] = await tx
          .select()
          .from(legalEntities)
          .where(eq(legalEntities.id, budget.legalEntityId));
        const [center] = budget.costCenterId
          ? await tx.select().from(costCenters).where(eq(costCenters.id, budget.costCenterId))
          : [];
        const conns = await tx
          .select()
          .from(integrationConnections)
          .where(isNull(integrationConnections.disconnectedAt));
        const checking = [];
        for (const row of conns) {
          const def = connectorFor(row.provider as IntegrationProvider);
          if (!def?.budgetCheck || row.pausedAt) continue;
          const setting = budgetCheckSetting(row.settings);
          if (!setting.enabled) continue;
          checking.push({ context: await this.connections.contextFor(tx, row), setting });
        }
        return {
          checking,
          body: {
            company: entity?.erpCompanyCode ?? entity?.code ?? '',
            costCenter: center?.code ?? '',
            amount: minorToMajor(amountMinor ?? req.approvedMinor ?? req.amountMinor, req.currency),
            currency: req.currency,
            reference: req.ref,
          },
        };
      },
    );
    if (!prepared) return [];

    const out: ExternalBudgetCheck[] = [];
    for (const { context, setting } of prepared.checking) {
      const def = context.definition;
      const checkedAt = nowUtc().toISOString();
      let status: ExternalBudgetCheck['status'] = 'unavailable';
      let message: string;
      let remaining: ExternalBudgetCheck['remaining'] = null;
      try {
        const res = await this.http.send({
          url: `${context.baseUrl}${def.budgetCheck!.path}`,
          method: 'POST',
          headers: {
            authorization: `Bearer ${context.credential}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(prepared.body),
          timeoutMs: 5_000,
        });
        if (!res.ok) {
          message = `${def.displayName} budget check could not run: ${providerMessage(res.statusCode || null, res.body)}`;
        } else {
          const body = JSON.parse(res.body) as {
            result?: string;
            reason?: string;
            remaining?: { amount?: string; currency?: string };
          };
          status =
            body.result === 'passed' ? 'passed' : body.result === 'failed' ? 'failed' : status;
          if (body.remaining?.amount && body.remaining.currency) {
            const minor = Math.round(
              Number(body.remaining.amount) *
                10 ** exponentOf(body.remaining.currency as CurrencyCode),
            );
            if (Number.isSafeInteger(minor))
              remaining = { amountMinor: minor, currency: body.remaining.currency as CurrencyCode };
          }
          message =
            status === 'passed'
              ? `${def.displayName} budget check: passed`
              : status === 'failed'
                ? `${def.displayName} budget check failed: ${body.reason ?? 'the ERP budget does not cover this amount.'}`
                : `${def.displayName} budget check gave no answer.`;
        }
      } catch {
        message = `${def.displayName} budget check could not reach the ERP.`;
      }
      out.push({
        provider: def.provider,
        providerName: def.displayName,
        status,
        mode: setting.mode,
        blocksApproval: setting.mode === 'block' && status !== 'passed',
        message:
          setting.mode === 'block' && status !== 'passed'
            ? `${message} Approval is blocked until it passes.`
            : message,
        remaining,
        checkedAt,
      });
    }
    return out;
  }
}
