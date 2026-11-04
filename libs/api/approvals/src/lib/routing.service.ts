import { ActorResolver, unwrap } from '@bf/api/core';
import { budgets, memberships, people, roleGrants, type Tx } from '@bf/api/db';
import { DoaService } from '@bf/api/finance';
import { LedgerReads } from '@bf/api/ledger';
import {
  buildApprovalRoute,
  convert,
  crossRate,
  FINANCE_REVIEW_REMAINING_PCT,
  FINANCE_REVIEW_THRESHOLD_MINOR,
  ROLE_GRANTS,
  type Action,
  type ApprovalRoute,
  type CurrencyCode,
  type DoaLimit,
  type RoleId,
  type RouteParty,
} from '@bf/domain';
import { Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import type { BudgetRow, Money } from './approval-handlers';

export const todayUtc = () => new Date().toISOString().slice(0, 10);

export interface RouteRequest {
  subject: 'request' | 'contribution';
  requesterId: string;
  beneficiaryIds: readonly string[];
  attendeeIds: readonly string[];
  budget: BudgetRow;
  /** Amount in the budget currency. */
  budgetAmount: Money;
  spendType: string;
  reportingCurrency: CurrencyCode;
  remainingPctAfter: number | null;
  /** Escalation: only owners above this person in the chain are considered. */
  above?: string | null;
  forceFinanceReview?: boolean;
  /** The decision permission approvers need (request.approve, contribution.decide). */
  action: Action;
  date?: string;
}

/** Whether any of the roles grants the action at some scope (ROLE_GRANTS, not role names). */
const grants = (roles: readonly string[], action: Action) =>
  roles.some((r) => Boolean(ROLE_GRANTS[r as RoleId]?.[action]));

/** Builds approval routes from the budget hierarchy, the role holders and the DoA matrix (Phase 3 seed). */
@Injectable()
export class RoutingService {
  constructor(
    private readonly doa: DoaService,
    private readonly reads: LedgerReads,
    private readonly actors: ActorResolver,
  ) {}

  limits(tx: Tx, date = todayUtc()): Promise<DoaLimit[]> {
    return this.doa.limitsAsOf(tx, date);
  }

  /** Owners of the budget and its ancestors, nearest first, with their roles. */
  async ownerChain(tx: Tx, budget: BudgetRow, date = todayUtc()): Promise<RouteParty[]> {
    const ids = budget.path.split('/').filter(Boolean).reverse();
    const rows = await tx
      .select({ id: budgets.id, owner: budgets.ownerPersonId })
      .from(budgets)
      .where(inArray(budgets.id, ids));
    const byId = new Map(rows.map((r) => [r.id, r.owner]));
    const out: RouteParty[] = [];
    for (const id of ids) {
      const owner = byId.get(id);
      if (!owner) continue;
      out.push({
        personId: owner,
        roles: await this.actors.rolesForPerson(tx, owner, date),
        budgetId: id,
      });
    }
    return out;
  }

  /** People holding a role in the tenant on a date (finance reviewers, executives), ordered by name. */
  async roleHolders(tx: Tx, role: RoleId, date = todayUtc()): Promise<RouteParty[]> {
    const rows = await tx
      .selectDistinct({ personId: memberships.personId, name: people.displayName })
      .from(roleGrants)
      .innerJoin(memberships, eq(memberships.id, roleGrants.membershipId))
      .innerJoin(people, eq(people.id, memberships.personId))
      .where(
        and(
          eq(roleGrants.role, role),
          eq(memberships.status, 'active'),
          lte(roleGrants.validFrom, date),
          or(isNull(roleGrants.validTo), gte(roleGrants.validTo, date)),
        ),
      )
      .orderBy(people.displayName);
    const out: RouteParty[] = [];
    for (const r of rows) {
      if (!r.personId) continue;
      out.push({
        personId: r.personId,
        roles: await this.actors.rolesForPerson(tx, r.personId, date),
      });
    }
    return out;
  }

  /** Converts a budget-currency amount to the DoA limits' currency at the budget's locked plan rate. */
  async toLimitCurrency(
    tx: Tx,
    budget: BudgetRow,
    amount: Money,
    limits: readonly DoaLimit[],
    reportingCurrency: CurrencyCode,
  ): Promise<Money> {
    const currency = (limits[0]?.currency ?? reportingCurrency) as CurrencyCode;
    if (amount.currency === currency) return amount;
    const rates = await this.reads.planRates(tx, budget.fiscalYearId);
    const rate = unwrap(
      crossRate(amount.currency as CurrencyCode, currency, reportingCurrency, rates, 'plan'),
    );
    return unwrap(
      convert({ amountMinor: amount.amountMinor, currency: amount.currency as CurrencyCode }, rate),
    );
  }

  async plan(tx: Tx, r: RouteRequest): Promise<{ route: ApprovalRoute; limitAmount: Money }> {
    const date = r.date ?? todayUtc();
    const limits = await this.limits(tx, date);
    const limitAmount = await this.toLimitCurrency(
      tx,
      r.budget,
      r.budgetAmount,
      limits,
      r.reportingCurrency,
    );
    let chain = (await this.ownerChain(tx, r.budget, date)).filter((p) =>
      grants(p.roles, r.action),
    );
    if (r.above) {
      const at = chain.findIndex((p) => p.personId === r.above);
      chain = at >= 0 ? chain.slice(at + 1) : chain;
    }
    const exclude = r.above ? [r.above] : [];
    const executives = (await this.roleHolders(tx, 'ceo', date)).filter(
      (p) => !exclude.includes(p.personId) && grants(p.roles, r.action),
    );
    const finance = (await this.roleHolders(tx, 'finance-controller', date)).filter(
      (p) => !exclude.includes(p.personId) && grants(p.roles, r.action),
    );
    const route = unwrap(
      buildApprovalRoute({
        subject: r.subject,
        requesterId: r.requesterId,
        beneficiaryIds: r.beneficiaryIds,
        attendeeIds: r.attendeeIds,
        amountMinor: limitAmount.amountMinor,
        currency: limitAmount.currency,
        spendType: r.spendType,
        legalEntityId: r.budget.legalEntityId,
        date,
        ownerChain: chain,
        financeReviewers: finance,
        executives,
        limits,
        financeReview: r.above
          ? undefined
          : {
              thresholdMinor: r.forceFinanceReview ? 0 : FINANCE_REVIEW_THRESHOLD_MINOR,
              remainingPctBelow: FINANCE_REVIEW_REMAINING_PCT,
              remainingPctAfter: r.remainingPctAfter,
            },
      }),
    );
    return { route, limitAmount };
  }
}
