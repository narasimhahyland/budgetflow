import { PlanningService } from '@bf/api/budgets';
import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  todayUtc,
  type RequestActor,
} from '@bf/api/core';
import {
  budgetCategories,
  budgets,
  costCenters,
  fiscalPeriods,
  fiscalYears,
  legalEntities,
  people,
  planVersions,
  syncRuns,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import { LedgerReads } from '@bf/api/ledger';
import type {
  AdaptivePlanImportResult,
  AdaptivePlanPreview,
  IntegrationProvider,
} from '@bf/contracts';
import { exponentOf, type CurrencyCode } from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, lte, gte } from 'drizzle-orm';
import { objectSpec, recordsFrom } from './connectors';
import {
  ConnectionsService,
  tenantOf,
  type CommandContext,
  type ConnectorContext,
} from './connections.service';
import { OutboundHttp, providerMessage } from './http';
import { storedResponse } from './stored-response';

type BudgetRow = typeof budgets.$inferSelect;

interface FetchedPlan {
  context: ConnectorContext;
  version: string | null;
  fiscalYear: string | null;
  currency: CurrencyCode;
  effectiveDate: string | null;
  rows: Record<string, unknown>[];
}

interface PlannedRoot {
  level: string;
  /** The root the level is mapped to; for a new year it is the template the new root copies. */
  root: BudgetRow;
  proposedMinor: number;
  /** True when the mapped root belongs to the year being imported (a revision), false for a new year. */
  sameYear: boolean;
}

const PERIOD_STATUS_OPEN = new Set(['open', 'soft_closed']);

/**
 * Planning import (094a). The plan feeds root budgets only, through a plan version: the import
 * creates a Draft version with the same validation and audit as a spreadsheet upload, and nothing
 * is posted until a Finance Admin (and the CEO, for new money) approves it and the version is
 * applied by the P4 command. A decrease below what a root already gave out or used is refused row
 * by row at the same floor as any reduction (allocated out + held + encumbered + actual), as is a
 * level with no mapping, a bad amount or a plan in another currency. Nothing posts to a closed
 * period: a plan whose effective date falls in one is flagged late and posts in the next open one.
 */
@Injectable()
export class PlanImportService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
    private readonly commands: CommandRunner,
    private readonly connections: ConnectionsService,
    private readonly http: OutboundHttp,
    private readonly ledgerReads: LedgerReads,
    private readonly planning: PlanningService,
  ) {}

  async preview(
    actor: RequestActor,
    connectionId: string,
    req: { externalVersion: string; fiscalYearLabel: string },
  ): Promise<AdaptivePlanPreview> {
    const plan = await this.fetch(actor, connectionId);
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) =>
      this.describe(tx, actor, connectionId, req, plan).then((r) => r.preview),
    );
  }

  /**
   * Applies the plan as a Draft plan version. Idempotent on the key (a replay returns the first
   * result and records no second run); the same planning version imported twice under another key
   * is refused, so a plan is never doubled.
   */
  async importPlan(
    actor: RequestActor,
    connectionId: string,
    req: { externalVersion: string; fiscalYearLabel: string },
    ctx: CommandContext,
  ): Promise<{ body: AdaptivePlanImportResult; replayed: boolean }> {
    const operation = `integrations.plan_import:${connectionId}`;
    // A replay returns the first result without asking the planning system again.
    const stored = await storedResponse(this.db, actor, ctx.idempotencyKey, operation, req);
    if (stored) return { body: stored as AdaptivePlanImportResult, replayed: true };
    const plan = await this.fetch(actor, connectionId);
    const label = `${req.externalVersion} (Adaptive Planning)`.slice(0, 100);
    try {
      const res = await this.commands.run(
        actor,
        {
          idempotencyKey: ctx.idempotencyKey,
          operation,
          request: req,
          status: 201,
        },
        async (tx) => {
          const { preview, planned, fiscalYear } = await this.describe(
            tx,
            actor,
            connectionId,
            req,
            plan,
          );
          if (preview.blocked) throw this.blockedProblem(preview);
          const [already] = await tx
            .select({ id: planVersions.id, status: planVersions.status })
            .from(planVersions)
            .where(
              and(eq(planVersions.fiscalYearId, fiscalYear!.id), eq(planVersions.label, label)),
            );
          if (already)
            throw new ApiProblem(
              409,
              'IMPORT_ALREADY_UPLOADED',
              `${req.externalVersion} was already imported as a plan version (${already.status}); nothing was imported again.`,
              { planVersionId: already.id },
            );
          const carried = await this.carriedLines(
            tx,
            fiscalYear!.id,
            planned,
            actor.reportingCurrency,
          );
          const csvRows = [
            ...(await this.csvRows(tx, planned, fiscalYear!, actor.reportingCurrency)),
            ...carried,
          ];
          const [run] = await tx
            .insert(syncRuns)
            .values({
              tenantId: actor.tenantId,
              connectionId,
              object: 'plan',
              direction: 'inbound',
              mode: plan.context.connection.mode,
              status: 'succeeded',
              finishedAt: new Date(),
              recordsRead: plan.rows.length,
              recordsApplied: planned.length,
              recordsFailed: 0,
              cursor: req.externalVersion,
              idempotencyKey: `plan-import:${connectionId}:${ctx.idempotencyKey}`,
              triggeredBy: actor.personId,
              errorSummary: preview.period?.late
                ? `Effective in ${preview.period.periodLabel}, which is ${preview.period.periodStatus}; the plan posts in ${preview.period.postsInPeriodLabel} once approved and applied.`
                : null,
            })
            .returning();
          const imported = await this.planning.importPlanInTx(
            tx,
            actor,
            {
              fiscalYearId: fiscalYear!.id,
              kind: (await this.planning.controllingVersion(tx, fiscalYear!.id))
                ? 'current'
                : 'original',
              label,
              csv: toCsv(csvRows),
              mapping: {
                code: 'code',
                name: 'name',
                amount: 'amount',
                legalEntity: 'legal_entity',
                costCenter: 'cost_center',
                ownerEmail: 'owner_email',
                category: 'category',
              },
              dryRun: false,
            },
            {
              requestId: ctx.requestId,
              source: {
                reason: `Imported from ${plan.context.connection.displayName}: ${req.externalVersion}`,
                changes: {
                  externalVersion: { from: null, to: req.externalVersion },
                  syncRunId: { from: null, to: run.id },
                  carriedOver: { from: null, to: carried.length },
                  totalDifferenceMinor: { from: null, to: preview.totalDifferenceMinor },
                  ...(preview.period
                    ? {
                        effectivePeriod: {
                          from: null,
                          to: `${preview.period.periodLabel} (${preview.period.periodStatus})`,
                        },
                        postsInPeriod: { from: null, to: preview.period.postsInPeriodLabel },
                      }
                    : {}),
                },
              },
            },
          );
          const pv = imported.planVersion!;
          return {
            preview,
            planVersionId: pv.id,
            planVersionLabel: pv.label,
            planVersionStatus: pv.status,
            syncRunId: run.id,
          } satisfies AdaptivePlanImportResult;
        },
      );
      return { body: res.body, replayed: res.replayed };
    } catch (e) {
      // A refused import still leaves a run with its counts and reason (099), outside the rolled-back
      // transaction, so the sync history shows why nothing was imported.
      if (e instanceof ApiProblem && e.code === 'PLAN_IMPORT_BLOCKED') {
        await withTenant(
          this.db,
          { tenantId: actor.tenantId, subject: actor.subject },
          async (tx) => {
            await tx.insert(syncRuns).values({
              tenantId: actor.tenantId,
              connectionId,
              object: 'plan',
              direction: 'inbound',
              mode: plan.context.connection.mode,
              status: 'failed',
              finishedAt: new Date(),
              recordsRead: plan.rows.length,
              recordsApplied: 0,
              recordsFailed: Number(e.params?.refused ?? 0),
              cursor: req.externalVersion,
              idempotencyKey: `plan-import-refused:${connectionId}:${randomUUID()}`,
              triggeredBy: actor.personId,
              errorSummary: e.detail,
            });
          },
        );
      }
      throw e;
    }
  }

  // Reading the plan --------------------------------------------------------------------------

  private async fetch(actor: RequestActor, connectionId: string): Promise<FetchedPlan> {
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
    const body = JSON.parse(res.body) as {
      version?: string;
      fiscalYear?: string;
      currency?: string;
      effectiveDate?: string;
    };
    return {
      context,
      version: body.version ?? null,
      fiscalYear: body.fiscalYear ?? null,
      currency: (body.currency ?? actor.reportingCurrency) as CurrencyCode,
      effectiveDate: body.effectiveDate ?? null,
      rows: recordsFrom(body, spec.envelope),
    };
  }

  /** The preview, plus what the import needs: the mapped roots and the resolved fiscal year. */
  private async describe(
    tx: Tx,
    actor: RequestActor,
    connectionId: string,
    req: { externalVersion: string; fiscalYearLabel: string },
    plan: FetchedPlan,
  ): Promise<{
    preview: AdaptivePlanPreview;
    planned: PlannedRoot[];
    fiscalYear: typeof fiscalYears.$inferSelect | null;
  }> {
    const refused: AdaptivePlanPreview['refusedRows'] = [];
    const unmapped: string[] = [];
    const lines: AdaptivePlanPreview['lines'] = [];
    const planned: PlannedRoot[] = [];
    let total = 0;

    if (plan.version && plan.version !== req.externalVersion)
      refused.push({
        level: '(plan)',
        reason: `Adaptive Planning returned "${plan.version}", not "${req.externalVersion}".`,
      });
    if (plan.currency !== actor.reportingCurrency)
      refused.push({
        level: '(plan)',
        reason: `The plan is in ${plan.currency}; plan versions are kept in ${actor.reportingCurrency}.`,
      });

    const mappedIds = [...plan.context.mappings.entries()]
      .filter(([k]) => k.startsWith('plan_level:'))
      .map(([, v]) => v);
    const roots = mappedIds.length
      ? await tx
          .select()
          .from(budgets)
          .where(and(isNull(budgets.parentId), inArray(budgets.id, mappedIds)))
      : [];
    const fiscalYear = await this.fiscalYearFor(tx, roots, req.fiscalYearLabel);
    if (!fiscalYear)
      refused.push({
        level: '(plan)',
        reason: `${req.fiscalYearLabel} is not a fiscal year in BudgetFlow (108); add it before importing.`,
      });
    const balances = await this.ledgerReads.balances(
      tx,
      roots.map((r) => r.id),
    );

    const seen = new Set<string>();
    for (const raw of plan.rows) {
      const level = String(raw['level'] ?? '').trim();
      const proposedMinor = toMinor(String(raw['amount'] ?? ''), plan.currency);
      if (!level) {
        refused.push({ level: '(blank)', reason: 'A row has no level name.' });
        continue;
      }
      if (seen.has(level.toLowerCase())) {
        refused.push({ level, reason: 'The level appears twice in the plan.' });
        continue;
      }
      seen.add(level.toLowerCase());
      const mappedId = plan.context.mappings.get(`plan_level:${level.toLowerCase()}`);
      const root = mappedId ? roots.find((r) => r.id === mappedId) : undefined;
      if (!root) {
        unmapped.push(level);
        refused.push({
          level,
          reason: `${level} is not mapped to a root budget; map it on the Mappings tab.`,
        });
        continue;
      }
      if (proposedMinor === null) {
        refused.push({
          level,
          reason: `"${String(raw['amount'] ?? '')}" is not an amount of zero or more with at most two decimals.`,
        });
        continue;
      }
      const sameYear = !!fiscalYear && root.fiscalYearId === fiscalYear.id;
      // Plan versions are kept in the reporting currency (locked plan rate), so compare in it.
      const b = balances.get(root.id)!.reporting;
      const currentMinor = b.authorized;
      const floorMinor = b.allocated_out + b.held + b.encumbered + b.actual;
      const difference = proposedMinor - currentMinor;
      const blockedReason =
        sameYear && proposedMinor < floorMinor
          ? `${root.name} cannot drop below ${actor.reportingCurrency} ${majorIn(actor.reportingCurrency)(floorMinor)}: that much is already allocated or used.`
          : null;
      if (blockedReason) refused.push({ level, reason: blockedReason });
      total += difference;
      lines.push({
        level,
        rootBudgetId: root.id,
        rootBudgetName: root.name,
        currentAmount: {
          amountMinor: currentMinor,
          currency: actor.reportingCurrency as CurrencyCode,
        },
        proposedAmount: { amountMinor: proposedMinor, currency: plan.currency },
        differenceMinor: difference,
        newMoney: difference > 0,
        blockedReason,
        floorAmount: sameYear
          ? { amountMinor: floorMinor, currency: actor.reportingCurrency as CurrencyCode }
          : null,
      });
      planned.push({ level, root, proposedMinor, sameYear });
    }

    const period = fiscalYear
      ? await this.periodFor(tx, fiscalYear, plan.effectiveDate, refused)
      : null;

    return {
      preview: {
        connectionId,
        externalVersion: req.externalVersion,
        fiscalYearLabel: req.fiscalYearLabel,
        currency: plan.currency,
        lines,
        unmappedLevels: unmapped,
        refusedRows: refused,
        fiscalYearId: fiscalYear?.id ?? null,
        period,
        totalDifferenceMinor: total,
        requiresCeoApproval: total > 0,
        blocked: refused.length > 0 || lines.length === 0,
      },
      planned,
      fiscalYear,
    };
  }

  /** The year with that label on the mapped roots' fiscal calendar (each legal entity has one). */
  private async fiscalYearFor(tx: Tx, roots: BudgetRow[], label: string) {
    const anyRoot = roots[0];
    if (!anyRoot) return null;
    const [own] = await tx
      .select()
      .from(fiscalYears)
      .where(eq(fiscalYears.id, anyRoot.fiscalYearId));
    if (!own) return null;
    const [fy] = await tx
      .select()
      .from(fiscalYears)
      .where(
        and(eq(fiscalYears.fiscalCalendarId, own.fiscalCalendarId), eq(fiscalYears.label, label)),
      );
    return fy ?? null;
  }

  /**
   * Where the plan lands in the calendar. The version posts on the date the P4 apply command uses
   * (today, kept inside the year); if the planning system's effective date falls in a closed or
   * locked period, the plan is late and still posts in the open period, never in the closed one.
   * When even that period is closed, nothing can post and the import is refused.
   */
  private async periodFor(
    tx: Tx,
    fy: typeof fiscalYears.$inferSelect,
    effectiveDate: string | null,
    refused: AdaptivePlanPreview['refusedRows'],
  ): Promise<AdaptivePlanPreview['period']> {
    const today = todayUtc();
    const postingDate =
      today < fy.startDate ? fy.startDate : today > fy.endDate ? fy.endDate : today;
    const at = async (date: string) =>
      (
        await tx
          .select()
          .from(fiscalPeriods)
          .where(
            and(
              eq(fiscalPeriods.fiscalYearId, fy.id),
              lte(fiscalPeriods.startDate, date),
              gte(fiscalPeriods.endDate, date),
            ),
          )
          .orderBy(asc(fiscalPeriods.periodNumber))
      )[0];
    const posting = await at(postingDate);
    if (!posting || !PERIOD_STATUS_OPEN.has(posting.status)) {
      refused.push({
        level: '(plan)',
        reason: `${fy.label} has no open period to post the plan in${posting ? ` (${posting.label} is ${posting.status.replace('_', '-')})` : ''}.`,
      });
      return null;
    }
    const effective = effectiveDate ?? postingDate;
    if (effective < fy.startDate || effective > fy.endDate) {
      refused.push({
        level: '(plan)',
        reason: `The plan takes effect on ${effective}, outside ${fy.label}.`,
      });
      return null;
    }
    const eff = (await at(effective)) ?? posting;
    const late = !PERIOD_STATUS_OPEN.has(eff.status);
    return {
      effectiveDate: effective,
      periodLabel: eff.label,
      periodStatus: eff.status as 'open' | 'soft_closed' | 'closed' | 'locked',
      postsInPeriodLabel: late ? posting.label : eff.label,
      late,
    };
  }

  // Building the plan version ----------------------------------------------------------------

  /** One spreadsheet row per planned root, with the dimensions the P4 import validates. */
  private async csvRows(
    tx: Tx,
    planned: PlannedRoot[],
    fy: typeof fiscalYears.$inferSelect,
    currency: string,
  ): Promise<Record<string, string>[]> {
    if (!planned.length) return [];
    const ids = (pick: (r: BudgetRow) => string | null) => [
      ...new Set(planned.map((p) => pick(p.root)).filter((x): x is string => !!x)),
    ];
    const [entities, centers, owners, cats, sourceYears] = await Promise.all([
      lookup(
        tx,
        legalEntities,
        legalEntities.id,
        legalEntities.code,
        ids((r) => r.legalEntityId),
      ),
      lookup(
        tx,
        costCenters,
        costCenters.id,
        costCenters.code,
        ids((r) => r.costCenterId),
      ),
      lookup(
        tx,
        people,
        people.id,
        people.email,
        ids((r) => r.ownerPersonId),
      ),
      lookup(
        tx,
        budgetCategories,
        budgetCategories.id,
        budgetCategories.code,
        ids((r) => r.categoryId),
      ),
      lookup(
        tx,
        fiscalYears,
        fiscalYears.id,
        fiscalYears.label,
        ids((r) => r.fiscalYearId),
      ),
    ]);
    return planned.map((p) => {
      const from = sourceYears.get(p.root.fiscalYearId) ?? '';
      return {
        code: p.sameYear
          ? (p.root.code ?? p.root.name)
          : nextYear(p.root.code ?? p.root.name, from, fy.label),
        name: p.sameYear ? p.root.name : nextYear(p.root.name, from, fy.label, false),
        amount: majorIn(currency)(p.proposedMinor),
        legal_entity: entities.get(p.root.legalEntityId) ?? '',
        cost_center: p.root.costCenterId ? (centers.get(p.root.costCenterId) ?? '') : '',
        owner_email: p.root.ownerPersonId ? (owners.get(p.root.ownerPersonId) ?? '') : '',
        category: p.root.categoryId ? (cats.get(p.root.categoryId) ?? '') : '',
      };
    });
  }

  /**
   * Roots of the year the plan does not mention keep their controlling amounts, so the new version
   * still covers every root and applying it changes only what the planning system changed.
   */
  private async carriedLines(
    tx: Tx,
    fiscalYearId: string,
    planned: PlannedRoot[],
    currency: string,
  ): Promise<Record<string, string>[]> {
    const controlling = await this.planning.controllingVersion(tx, fiscalYearId);
    if (!controlling) return [];
    const plannedIds = new Set(planned.filter((p) => p.sameYear).map((p) => p.root.id));
    const plannedCodes = new Set(planned.map((p) => (p.root.code ?? '').toLowerCase()));
    const rest = controlling.lines.filter(
      (l) => !(l.budgetId && plannedIds.has(l.budgetId)) && !plannedCodes.has(l.code.toLowerCase()),
    );
    const [entities, centers, owners] = await Promise.all([
      lookup(
        tx,
        legalEntities,
        legalEntities.id,
        legalEntities.code,
        rest.map((l) => l.legalEntityId).filter((x): x is string => !!x),
      ),
      lookup(
        tx,
        costCenters,
        costCenters.id,
        costCenters.code,
        rest.map((l) => l.costCenterId).filter((x): x is string => !!x),
      ),
      lookup(
        tx,
        people,
        people.id,
        people.email,
        rest.map((l) => l.ownerPersonId).filter((x): x is string => !!x),
      ),
    ]);
    return rest.map((l) => ({
      code: l.code,
      name: l.name,
      amount: majorIn(currency)(l.amountMinor),
      legal_entity: l.legalEntityId ? (entities.get(l.legalEntityId) ?? '') : '',
      cost_center: l.costCenterId ? (centers.get(l.costCenterId) ?? '') : '',
      owner_email: l.ownerPersonId ? (owners.get(l.ownerPersonId) ?? '') : '',
      category: l.categoryCode ?? '',
    }));
  }

  private blockedProblem(preview: AdaptivePlanPreview): ApiProblem {
    const n = preview.refusedRows.length;
    return new ApiProblem(
      422,
      'PLAN_IMPORT_BLOCKED',
      n === 0
        ? 'The plan has no rows to import.'
        : `${n} row(s) of the plan were refused, so nothing was imported: ${preview.refusedRows
            .slice(0, 3)
            .map((r) => r.reason)
            .join(' ')}`,
      { refused: n },
      preview.refusedRows.map((r) => ({ path: `level ${r.level}`, message: r.reason })),
    );
  }
}

// Helpers ------------------------------------------------------------------------------------

/** The planning system reports major units; budgets hold minor units by the ISO 4217 exponent. */
function toMinor(amount: string, currency: string): number | null {
  const exp = exponentOf(currency as CurrencyCode);
  const clean = amount.replace(/[\s,]/g, '');
  const pattern = exp === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${exp}})?$`);
  if (!pattern.test(clean)) return null;
  const [whole, frac = ''] = clean.split('.');
  const minor = Number(`${whole}${frac.padEnd(exp, '0')}`);
  if (!Number.isSafeInteger(minor))
    throw new ApiProblem(422, 'AMOUNT_NOT_SAFE_INTEGER', 'A plan amount is too large.');
  return minor;
}

/** Minor units back to the major-unit text the P4 import parses, in the plan (reporting) currency. */
function majorIn(currency: string) {
  const exp = exponentOf(currency as CurrencyCode);
  return (minor: number): string =>
    exp === 0
      ? String(minor)
      : `${Math.trunc(minor / 10 ** exp)}.${String(Math.abs(minor % 10 ** exp)).padStart(exp, '0')}`;
}

/** EX-2026 in FY2026 becomes EX-2027 in FY2027; a code without the year gets the new year appended. */
function nextYear(value: string, fromLabel: string, toLabel: string, append = true): string {
  const from = fromLabel.replace(/\D/g, '');
  const to = toLabel.replace(/\D/g, '');
  if (from && to && value.includes(from)) return value.split(from).join(to);
  return append ? `${value}-${to || toLabel}` : `${value} ${toLabel}`;
}

function toCsv(rows: Record<string, string>[]): string {
  const cols = ['code', 'name', 'amount', 'legal_entity', 'cost_center', 'owner_email', 'category'];
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c] ?? '')).join(','))].join(
    '\n',
  );
}

async function lookup(
  tx: Tx,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  idCol: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  valueCol: any,
  ids: string[],
): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = (await tx
    .select({ id: idCol, value: valueCol })
    .from(table)
    .where(inArray(idCol, ids))) as { id: string; value: string }[];
  return new Map(rows.map((r) => [r.id, r.value]));
}
