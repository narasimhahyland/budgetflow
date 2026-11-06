import { ApiProblem, DB, PolicyService, type RequestActor } from '@bf/api/core';
import { budgets, withTenant, type Db } from '@bf/api/db';
import { LedgerReads } from '@bf/api/ledger';
import type { AdaptivePlanPreview, IntegrationProvider } from '@bf/contracts';
import type { CurrencyCode } from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { isNull } from 'drizzle-orm';
import { objectSpec, recordsFrom } from './connectors';
import { ConnectionsService, tenantOf } from './connections.service';
import { OutboundHttp, providerMessage } from './http';

/**
 * Planning import preview (094a). The plan feeds root budgets only, as differences a Finance Admin
 * submits for approval. Nothing is posted here: increases to the company total need Finance Admin
 * and CEO sign-off, and a decrease below what a root already gave out or used is blocked row by row
 * at the same floor as any reduction (allocated out + held + encumbered + actual).
 */
@Injectable()
export class PlanImportService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
    private readonly connections: ConnectionsService,
    private readonly http: OutboundHttp,
    private readonly ledgerReads: LedgerReads,
  ) {}

  async preview(
    actor: RequestActor,
    connectionId: string,
    req: { externalVersion: string; fiscalYearLabel: string },
  ): Promise<AdaptivePlanPreview> {
    const context = await withTenant(
      this.db,
      { tenantId: actor.tenantId, subject: actor.subject },
      async (tx) => {
        // 094a: a Finance Admin runs the import; seeing the connector is enough on the integration side.
        this.policy.assert(actor, 'integration.read', tenantOf(actor));
        this.policy.assert(actor, 'budget.create_root', tenantOf(actor));
        const row = await this.connections.rowOrFail(tx, connectionId);
        if (row.category !== 'planning') {
          throw new ApiProblem(
            422,
            'CONNECTOR_OBJECT_UNSUPPORTED',
            `${row.displayName} is not a planning system.`,
          );
        }
        return this.connections.contextFor(tx, row);
      },
    );

    const spec = objectSpec(context.connection.provider as IntegrationProvider, 'plan', 'inbound');
    if (!spec) throw new ApiProblem(422, 'CONNECTOR_OBJECT_UNSUPPORTED', 'No plan to read.');
    const res = await this.http.send({
      url: `${context.baseUrl}${spec.path}`,
      headers: { authorization: `Bearer ${context.credential}` },
    });
    if (!res.ok) {
      throw new ApiProblem(
        422,
        'INTEGRATION_TEST_FAILED',
        providerMessage(res.statusCode || null, res.body),
      );
    }
    const body = JSON.parse(res.body) as { currency?: string; levels?: unknown };
    const rows = recordsFrom(body, spec.envelope);
    const currency = (body.currency ?? actor.reportingCurrency) as CurrencyCode;

    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const roots = await tx.select().from(budgets).where(isNull(budgets.parentId));
      const balances = await this.ledgerReads.balances(
        tx,
        roots.map((r) => r.id),
      );
      const unmapped: string[] = [];
      const lines: AdaptivePlanPreview['lines'] = [];
      let total = 0;
      let blocked = false;

      for (const raw of rows) {
        const level = String(raw['level'] ?? '');
        const proposedMinor = this.toMinor(String(raw['amount'] ?? '0'));
        const mappedId = context.mappings.get(`plan_level:${level.toLowerCase()}`);
        const root = mappedId ? roots.find((r) => r.id === mappedId) : undefined;
        if (!root) {
          unmapped.push(level);
          continue;
        }
        const b = balances.get(root.id)!.budget;
        const currentMinor = b.authorized;
        const floorMinor = b.allocated_out + b.held + b.encumbered + b.actual;
        const difference = proposedMinor - currentMinor;
        const blockedReason =
          proposedMinor < floorMinor
            ? `${root.name} cannot drop below what it has already allocated or used.`
            : null;
        if (blockedReason) blocked = true;
        total += difference;
        lines.push({
          level,
          rootBudgetId: root.id,
          rootBudgetName: root.name,
          currentAmount: { amountMinor: currentMinor, currency: root.currency as CurrencyCode },
          proposedAmount: { amountMinor: proposedMinor, currency },
          differenceMinor: difference,
          newMoney: difference > 0,
          blockedReason,
          floorAmount: { amountMinor: floorMinor, currency: root.currency as CurrencyCode },
        });
      }

      return {
        connectionId,
        externalVersion: req.externalVersion,
        fiscalYearLabel: req.fiscalYearLabel,
        currency,
        lines,
        unmappedLevels: unmapped,
        totalDifferenceMinor: total,
        requiresCeoApproval: total > 0,
        blocked: blocked || unmapped.length > 0,
      };
    });
  }

  /** The planning system reports major units with two decimals; budgets hold integer minor units. */
  private toMinor(amount: string): number {
    const [whole, frac = ''] = amount.replace(/[\s,]/g, '').split('.');
    const minor = Number(`${whole}${frac.padEnd(2, '0').slice(0, 2)}`);
    if (!Number.isSafeInteger(minor))
      throw new ApiProblem(422, 'AMOUNT_NOT_SAFE_INTEGER', 'A plan amount is too large.');
    return minor;
  }
}
