import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  unwrap,
  type RequestActor,
} from '@bf/api/core';
import { AuditService } from '@bf/api/audit';
import {
  budgetCategories,
  budgetLimits,
  budgetPeriodAllotments,
  budgets,
  budgetVersions,
  costCenters,
  fiscalYears,
  legalEntities,
  people,
  planVersionLines,
  planVersions,
  programTemplates,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import { LedgerReads, LedgerService, toPostingBudget } from '@bf/api/ledger';
import type {
  ApplyPlanVersionResult,
  BudgetLimits,
  BudgetPhasing,
  BudgetVersion,
  CreatePlanVersionRequest,
  PerHeadDriverConfig,
  PlanImportRequest,
  PlanImportResult,
  PlanTieOut,
  PlanVersion,
  PlanVersionDetail,
  ProgramTemplate,
  ProgramTemplateDefaults,
  RollForwardRequest,
  RollForwardResult,
  SetBudgetLimitsRequest,
  SetPhasingRequest,
  SpendCheckRequest,
  SpendCheckResult,
  UpsertProgramTemplateRequest,
} from '@bf/contracts';
import {
  acceptsNewActivity,
  allocationAvailable,
  checkLimits,
  checkSpend,
  parseCsv,
  phaseAmounts,
  planTieOut,
  postPlanAdjustment,
  rollForwardAmount,
  type BudgetLimit,
} from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, like, sql } from 'drizzle-orm';
import {
  budgetResource,
  BudgetViews,
  tenantBudgetResource,
  type BudgetRow,
  type CommandContext,
} from './budget-views';
import { BudgetsService } from './budgets.service';

type PvRow = typeof planVersions.$inferSelect;
type LineRow = typeof planVersionLines.$inferSelect;

/** Splits pasted spreadsheet text: tab-separated (from Excel) or CSV. */
function parseSheet(text: string): {
  headers: string[];
  rows: { line: number; values: Record<string, string> }[];
} {
  const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/)[0] ?? '';
  if (firstLine.includes('\t')) {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
    const headers = lines[0].split('\t').map((h) => h.trim());
    const rows = lines
      .slice(1)
      .map((l, i) => ({ line: i + 2, cells: l.split('\t') }))
      .filter((r) => r.cells.some((c) => c.trim()))
      .map((r) => ({
        line: r.line,
        values: Object.fromEntries(headers.map((h, j) => [h, (r.cells[j] ?? '').trim()])),
      }));
    return { headers, rows };
  }
  return unwrap(parseCsv(text));
}

/** "30,000.00" or "$30000" in major units to minor units (2-decimal currency). */
function parseAmount(raw: string): number | null {
  const s = raw.replace(/[$,\s]/g, '').replace(/^USD/i, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const minor = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

/** Plan versions, plan import and tie-out, roll forward, program templates, phasing, versions, limits, spend checks. */
@Injectable()
export class PlanningService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly reads: LedgerReads,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly views: BudgetViews,
    private readonly budgetsService: BudgetsService,
  ) {}

  private tx<T>(actor: RequestActor, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, fn);
  }

  private assertPlanRead(actor: RequestActor): void {
    if (!this.policy.can(actor, 'budget.read', tenantBudgetResource(actor.tenantId)).allowed)
      throw ApiProblem.forbidden('Plan versions are visible to leadership, finance and auditors.');
  }

  private assertPlanManage(actor: RequestActor): void {
    this.policy.assert(actor, 'budget.create_root', { kind: 'tenant', tenantId: actor.tenantId });
  }

  // Plan versions -----------------------------------------------------------------------------

  /** Controlling plan version of a year: the latest applied, else the latest approved original. */
  private async controlling(tx: Tx, fiscalYearId: string): Promise<PvRow | undefined> {
    const rows = await tx
      .select()
      .from(planVersions)
      .where(and(eq(planVersions.fiscalYearId, fiscalYearId), eq(planVersions.status, 'approved')))
      .orderBy(desc(planVersions.appliedAt), desc(planVersions.approvedAt));
    return (
      rows.filter((r) => r.appliedAt).sort((a, b) => +b.appliedAt! - +a.appliedAt!)[0] ??
      rows.find((r) => r.kind === 'original')
    );
  }

  /** Root authorized and savings returned out of each root (savings lines share a journal with the root's debit). */
  private async rootFigures(
    tx: Tx,
    rootIds: string[],
  ): Promise<Map<string, { authorizedMinor: number; savingsMinor: number }>> {
    const out = new Map(rootIds.map((id) => [id, { authorizedMinor: 0, savingsMinor: 0 }]));
    if (!rootIds.length) return out;
    const balances = await this.reads.balances(tx, rootIds);
    for (const id of rootIds) out.get(id)!.authorizedMinor = balances.get(id)!.reporting.authorized;
    const res = await tx.execute<{ budget_id: string; savings: string }>(sql`
      select r.budget_id, (-sum(s.reporting_amount_minor))::text as savings
      from ledger_lines s
      join ledger_lines r on r.journal_id = s.journal_id and r.account = 'authorized'
        and r.budget_id in (${sql.join(
          rootIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
      where s.account = 'savings'
      group by r.budget_id`);
    for (const r of res.rows) out.get(r.budget_id)!.savingsMinor = Number(r.savings);
    return out;
  }

  private async versionDtos(tx: Tx, rows: PvRow[]): Promise<PlanVersion[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const totals = await tx
      .select({
        id: planVersionLines.planVersionId,
        total: sql<string>`coalesce(sum(${planVersionLines.amountMinor}), 0)::text`,
        count: sql<string>`count(*)::text`,
      })
      .from(planVersionLines)
      .where(inArray(planVersionLines.planVersionId, ids))
      .groupBy(planVersionLines.planVersionId);
    const fys = await tx
      .select()
      .from(fiscalYears)
      .where(inArray(fiscalYears.id, [...new Set(rows.map((r) => r.fiscalYearId))]));
    const approvers = rows.map((r) => r.approvedBy).filter((p): p is string => !!p);
    const names = approvers.length
      ? new Map(
          (
            await tx
              .select({ id: people.id, name: people.displayName })
              .from(people)
              .where(inArray(people.id, approvers))
          ).map((p) => [p.id, p.name]),
        )
      : new Map<string, string>();
    const controllingIds = new Set<string>();
    for (const fy of new Set(rows.map((r) => r.fiscalYearId))) {
      const c = await this.controlling(tx, fy);
      if (c) controllingIds.add(c.id);
    }
    const [tenantCurrency] = (
      await tx.execute<{ c: string }>(sql`select reporting_currency as c from tenants limit 1`)
    ).rows;
    return rows.map((r) => {
      const t = totals.find((x) => x.id === r.id);
      return {
        id: r.id,
        fiscalYearId: r.fiscalYearId,
        fiscalYearLabel: fys.find((f) => f.id === r.fiscalYearId)?.label ?? '',
        kind: r.kind,
        label: r.label,
        status: r.status,
        source: r.source,
        controlling: controllingIds.has(r.id),
        approvedAt: r.approvedAt?.toISOString() ?? null,
        approvedByName: r.approvedBy ? (names.get(r.approvedBy) ?? null) : null,
        appliedAt: r.appliedAt?.toISOString() ?? null,
        currency: tenantCurrency?.c ?? 'USD',
        totalMinor: Number(t?.total ?? 0),
        lineCount: Number(t?.count ?? 0),
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  private async detail(tx: Tx, actor: RequestActor, pv: PvRow): Promise<PlanVersionDetail> {
    const [dto] = await this.versionDtos(tx, [pv]);
    const lines = await tx
      .select()
      .from(planVersionLines)
      .where(eq(planVersionLines.planVersionId, pv.id))
      .orderBy(asc(planVersionLines.lineNo));
    const linked = await this.linkLines(tx, pv, lines);
    const figures = await this.rootFigures(tx, [
      ...new Set(linked.map((l) => l.rootId).filter((x): x is string => !!x)),
    ]);
    return {
      ...dto,
      lines: linked.map(({ line, rootId }) => {
        const f = rootId ? figures.get(rootId) : undefined;
        return {
          lineNo: line.lineNo,
          budgetId: rootId,
          code: line.code,
          name: line.name,
          legalEntityId: line.legalEntityId,
          costCenterId: line.costCenterId,
          ownerPersonId: line.ownerPersonId,
          categoryCode: line.categoryCode,
          amountMinor: line.amountMinor,
          rootAuthorizedMinor: f?.authorizedMinor ?? null,
          savingsMinor: f?.savingsMinor ?? null,
          differenceMinor: f
            ? line.amountMinor - f.authorizedMinor - f.savingsMinor
            : line.amountMinor,
        };
      }),
      tieOut: await this.tieOutFor(tx, actor, pv.fiscalYearId),
    };
  }

  /** Lines matched to root budgets of the year: by linked id, else by code. */
  private async linkLines(
    tx: Tx,
    pv: PvRow,
    lines: LineRow[],
  ): Promise<{ line: LineRow; rootId: string | null }[]> {
    const roots = await tx
      .select({ id: budgets.id, code: budgets.code })
      .from(budgets)
      .where(and(isNull(budgets.parentId), eq(budgets.fiscalYearId, pv.fiscalYearId)));
    return lines.map((line) => ({
      line,
      rootId:
        line.budgetId ??
        roots.find((r) => r.code && r.code.toLowerCase() === line.code.toLowerCase())?.id ??
        null,
    }));
  }

  private async tieOutFor(tx: Tx, actor: RequestActor, fiscalYearId: string): Promise<PlanTieOut> {
    const pv = await this.controlling(tx, fiscalYearId);
    if (!pv)
      return {
        fiscalYearId,
        planVersionId: null,
        planVersionLabel: null,
        currency: actor.reportingCurrency,
        planTotalMinor: 0,
        rootAuthorizedMinor: 0,
        savingsMinor: 0,
        differenceMinor: 0,
        tiedOut: true,
        rootCount: 0,
      };
    const lines = await tx
      .select()
      .from(planVersionLines)
      .where(eq(planVersionLines.planVersionId, pv.id));
    const roots = await tx
      .select({ id: budgets.id })
      .from(budgets)
      .where(and(isNull(budgets.parentId), eq(budgets.planVersionId, pv.id)));
    const figures = await this.rootFigures(
      tx,
      roots.map((r) => r.id),
    );
    const linked = await this.linkLines(tx, pv, lines);
    const rows = linked.map(({ line, rootId }) => ({
      key: line.code,
      planMinor: line.amountMinor,
      rootAuthorizedMinor: rootId ? (figures.get(rootId)?.authorizedMinor ?? 0) : 0,
      savingsMinor: rootId ? (figures.get(rootId)?.savingsMinor ?? 0) : 0,
    }));
    const linkedIds = new Set(linked.map((l) => l.rootId));
    for (const r of roots)
      if (!linkedIds.has(r.id))
        rows.push({
          key: r.id,
          planMinor: 0,
          rootAuthorizedMinor: figures.get(r.id)!.authorizedMinor,
          savingsMinor: figures.get(r.id)!.savingsMinor,
        });
    const t = planTieOut(rows);
    return {
      fiscalYearId,
      planVersionId: pv.id,
      planVersionLabel: pv.label,
      currency: actor.reportingCurrency,
      planTotalMinor: t.planTotalMinor,
      rootAuthorizedMinor: t.rootAuthorizedMinor,
      savingsMinor: t.savingsMinor,
      differenceMinor: t.differenceMinor,
      tiedOut: t.tiedOut,
      rootCount: roots.length,
    };
  }

  listVersions(actor: RequestActor, fiscalYearId?: string) {
    return this.tx(actor, async (tx) => {
      this.assertPlanRead(actor);
      const rows = await tx
        .select()
        .from(planVersions)
        .where(fiscalYearId ? eq(planVersions.fiscalYearId, fiscalYearId) : undefined)
        .orderBy(desc(planVersions.createdAt));
      return { items: await this.versionDtos(tx, rows) };
    });
  }

  getVersion(actor: RequestActor, id: string) {
    return this.tx(actor, async (tx) => {
      this.assertPlanRead(actor);
      const [pv] = await tx.select().from(planVersions).where(eq(planVersions.id, id));
      if (!pv) throw ApiProblem.notFound('plan version');
      return this.detail(tx, actor, pv);
    });
  }

  tieOut(actor: RequestActor, fiscalYearId: string) {
    return this.tx(actor, async (tx) => {
      this.assertPlanRead(actor);
      return this.tieOutFor(tx, actor, fiscalYearId);
    });
  }

  createVersion(actor: RequestActor, req: CreatePlanVersionRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      { idempotencyKey: ctx.idempotencyKey, operation: 'plan.create', request: req, status: 201 },
      async (tx) => {
        this.assertPlanManage(actor);
        const [fy] = await tx
          .select()
          .from(fiscalYears)
          .where(eq(fiscalYears.id, req.fiscalYearId));
        if (!fy)
          throw new ApiProblem(422, 'VALIDATION_FAILED', 'The fiscal year does not exist.', {
            field: 'fiscalYearId',
          });
        let lines = (req.lines ?? []).map((l) => ({ ...l }));
        if (req.copyFromId) {
          const src = await tx
            .select()
            .from(planVersionLines)
            .where(eq(planVersionLines.planVersionId, req.copyFromId));
          if (
            !src.length &&
            !(await tx.select().from(planVersions).where(eq(planVersions.id, req.copyFromId)))
              .length
          )
            throw ApiProblem.notFound('plan version');
          lines = [
            ...src.map((s) => ({
              code: s.code,
              name: s.name,
              amountMinor: s.amountMinor,
              budgetId: s.budgetId ?? undefined,
              legalEntityId: s.legalEntityId ?? undefined,
              costCenterId: s.costCenterId ?? undefined,
              ownerPersonId: s.ownerPersonId ?? undefined,
              categoryCode: s.categoryCode ?? undefined,
            })),
            ...lines,
          ];
        }
        const pv = await this.insertVersion(
          tx,
          actor,
          { ...req, source: req.copyFromId ? 'copy' : 'manual' },
          lines,
        );
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'plan_version.created',
          resourceType: 'plan_version',
          resourceId: pv.id,
          requestId: ctx.requestId,
          changes: {
            label: { from: null, to: req.label },
            kind: { from: null, to: req.kind },
            lines: { from: null, to: lines.length },
          },
        });
        return this.detail(tx, actor, pv);
      },
    );
  }

  private async insertVersion(
    tx: Tx,
    actor: RequestActor,
    req: {
      fiscalYearId: string;
      kind: 'original' | 'current' | 'forecast';
      label: string;
      source: string;
    },
    lines: CreatePlanVersionRequest['lines'] & object,
  ): Promise<PvRow> {
    const codes = new Set<string>();
    for (const l of lines) {
      const k = l.code.toLowerCase();
      if (codes.has(k))
        throw new ApiProblem(
          409,
          'DUPLICATE_CODE',
          `The code ${l.code} appears twice in the plan.`,
        );
      codes.add(k);
    }
    const [pv] = await tx
      .insert(planVersions)
      .values({
        tenantId: actor.tenantId,
        fiscalYearId: req.fiscalYearId,
        kind: req.kind,
        label: req.label,
        status: 'draft',
        source: req.source,
        createdBy: actor.personId,
      })
      .returning();
    if (lines.length)
      await tx.insert(planVersionLines).values(
        lines.map((l, i) => ({
          tenantId: actor.tenantId,
          planVersionId: pv.id,
          lineNo: i + 1,
          budgetId: l.budgetId ?? null,
          code: l.code,
          name: l.name,
          legalEntityId: l.legalEntityId ?? null,
          costCenterId: l.costCenterId ?? null,
          ownerPersonId: l.ownerPersonId ?? null,
          categoryCode: l.categoryCode ?? null,
          amountMinor: l.amountMinor,
          currency: actor.reportingCurrency,
        })),
      );
    return pv;
  }

  async importPlan(
    actor: RequestActor,
    req: PlanImportRequest,
    ctx: CommandContext,
  ): Promise<PlanImportResult> {
    const run = async (tx: Tx): Promise<PlanImportResult> => {
      this.assertPlanManage(actor);
      const sheet = parseSheet(req.csv);
      const header = (name: string | undefined) =>
        name
          ? sheet.headers.find((h) => h.trim().toLowerCase() === name.trim().toLowerCase())
          : undefined;
      const cols = {
        code: header(req.mapping.code),
        name: header(req.mapping.name),
        amount: header(req.mapping.amount),
        legalEntity: header(req.mapping.legalEntity),
        costCenter: header(req.mapping.costCenter),
        ownerEmail: header(req.mapping.ownerEmail),
        category: header(req.mapping.category),
      };
      const missing = (['code', 'name', 'amount'] as const).filter((k) => !cols[k]);
      if (missing.length)
        throw new ApiProblem(422, 'IMPORT_INVALID', `Map a column for: ${missing.join(', ')}.`, {
          columns: sheet.headers.join(', '),
        });
      const [entities, centers, owners, cats, roots] = await Promise.all([
        tx.select({ id: legalEntities.id, code: legalEntities.code }).from(legalEntities),
        tx.select({ id: costCenters.id, code: costCenters.code }).from(costCenters),
        tx.select({ id: people.id, email: people.email }).from(people),
        tx.select({ code: budgetCategories.code }).from(budgetCategories),
        tx
          .select({ id: budgets.id, code: budgets.code })
          .from(budgets)
          .where(and(isNull(budgets.parentId), eq(budgets.fiscalYearId, req.fiscalYearId))),
      ]);
      const ci = (a: string | null | undefined, b: string) =>
        (a ?? '').toLowerCase() === b.toLowerCase();
      const seen = new Set<string>();
      const rows = sheet.rows.map((r) => {
        const v = (k: keyof typeof cols) => (cols[k] ? (r.values[cols[k]!] ?? '').trim() : '');
        const errors: string[] = [];
        const code = v('code');
        const name = v('name');
        const amountMinor = parseAmount(v('amount'));
        if (!code) errors.push('Code is empty.');
        else if (seen.has(code.toLowerCase())) errors.push('Code appears twice.');
        seen.add(code.toLowerCase());
        if (name.length < 2) errors.push('Name is missing.');
        if (amountMinor === null) errors.push(`Amount "${v('amount')}" is not a positive amount.`);
        const le = v('legalEntity')
          ? entities.find((e) => ci(e.code, v('legalEntity')))
          : undefined;
        if (v('legalEntity') && !le) errors.push(`Unknown legal entity ${v('legalEntity')}.`);
        const cc = v('costCenter') ? centers.find((c) => ci(c.code, v('costCenter'))) : undefined;
        if (v('costCenter') && !cc) errors.push(`Unknown cost center ${v('costCenter')}.`);
        const owner = v('ownerEmail')
          ? owners.find((o) => ci(o.email, v('ownerEmail')))
          : undefined;
        if (v('ownerEmail') && !owner) errors.push(`No person with email ${v('ownerEmail')}.`);
        const cat = v('category') ? cats.find((c) => ci(c.code, v('category'))) : undefined;
        if (v('category') && !cat) errors.push(`Unknown category ${v('category')}.`);
        return {
          line: r.line,
          code,
          name,
          amountMinor,
          legalEntityId: le?.id ?? null,
          costCenterId: cc?.id ?? null,
          ownerPersonId: owner?.id ?? null,
          categoryCode: cat?.code ?? null,
          existingBudgetId: roots.find((x) => code && ci(x.code, code))?.id ?? null,
          errors,
        };
      });
      const valid = rows.length > 0 && rows.every((r) => r.errors.length === 0);
      const result: PlanImportResult = {
        dryRun: req.dryRun,
        valid,
        columns: sheet.headers,
        currency: actor.reportingCurrency,
        totalMinor: rows.reduce((s, r) => s + (r.amountMinor ?? 0), 0),
        rows,
        planVersion: null,
      };
      if (req.dryRun) return result;
      if (!valid)
        throw new ApiProblem(
          422,
          'IMPORT_INVALID',
          'Some rows have errors; fix them and import again.',
          undefined,
          rows
            .flatMap((r) => r.errors.map((e) => ({ path: `line ${r.line}`, message: e })))
            .slice(0, 50),
        );
      const pv = await this.insertVersion(
        tx,
        actor,
        { fiscalYearId: req.fiscalYearId, kind: req.kind, label: req.label, source: 'import' },
        rows.map((r) => ({
          code: r.code,
          name: r.name,
          amountMinor: r.amountMinor!,
          budgetId: r.existingBudgetId ?? undefined,
          legalEntityId: r.legalEntityId ?? undefined,
          costCenterId: r.costCenterId ?? undefined,
          ownerPersonId: r.ownerPersonId ?? undefined,
          categoryCode: r.categoryCode ?? undefined,
        })),
      );
      await this.audit.append(tx, {
        tenantId: actor.tenantId,
        actorPersonId: actor.personId,
        actorSubject: actor.subject,
        action: 'plan_version.imported',
        resourceType: 'plan_version',
        resourceId: pv.id,
        requestId: ctx.requestId,
        changes: {
          label: { from: null, to: req.label },
          rows: { from: null, to: rows.length },
          totalMinor: { from: null, to: result.totalMinor },
        },
      });
      return { ...result, planVersion: await this.detail(tx, actor, pv) };
    };
    if (req.dryRun) return this.tx(actor, run);
    return (
      await this.commands.run(
        actor,
        { idempotencyKey: ctx.idempotencyKey, operation: 'plan.import', request: req, status: 200 },
        run,
      )
    ).body;
  }

  approveVersion(actor: RequestActor, id: string, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `plan.approve:${id}`,
        request: {},
        status: 200,
      },
      async (tx) => {
        this.assertPlanManage(actor);
        const [pv] = await tx
          .select()
          .from(planVersions)
          .where(eq(planVersions.id, id))
          .for('update');
        if (!pv) throw ApiProblem.notFound('plan version');
        if (pv.status !== 'draft')
          throw new ApiProblem(
            409,
            'PLAN_VERSION_NOT_EDITABLE',
            `This plan version is already ${pv.status}.`,
          );
        const [{ n }] = await tx
          .select({ n: sql<string>`count(*)::text` })
          .from(planVersionLines)
          .where(eq(planVersionLines.planVersionId, id));
        if (Number(n) === 0)
          throw new ApiProblem(422, 'VALIDATION_FAILED', 'Add at least one line before approving.');
        const [updated] = await tx
          .update(planVersions)
          .set({ status: 'approved', approvedAt: new Date(), approvedBy: actor.personId })
          .where(eq(planVersions.id, id))
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'plan_version.approved',
          resourceType: 'plan_version',
          resourceId: id,
          requestId: ctx.requestId,
          changes: { status: { from: 'draft', to: 'approved' } },
        });
        return this.detail(tx, actor, updated);
      },
    );
  }

  /**
   * Makes an approved version controlling: each line's root is created (original funding) or adjusted
   * by the difference (plan funding in or out), so roots tie to the version.
   */
  applyVersion(actor: RequestActor, id: string, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `plan.apply:${id}`,
        request: {},
        status: 200,
      },
      async (tx): Promise<ApplyPlanVersionResult> => {
        this.assertPlanManage(actor);
        const [pv] = await tx
          .select()
          .from(planVersions)
          .where(eq(planVersions.id, id))
          .for('update');
        if (!pv) throw ApiProblem.notFound('plan version');
        if (pv.status !== 'approved')
          throw new ApiProblem(
            409,
            'PLAN_VERSION_NOT_EDITABLE',
            'Approve the plan version before applying it.',
          );
        if (pv.kind === 'forecast')
          throw new ApiProblem(
            422,
            'VALIDATION_FAILED',
            'A forecast version is for comparison and never funds budgets.',
          );
        const previous = await this.controlling(tx, pv.fiscalYearId);
        const lines = await tx
          .select()
          .from(planVersionLines)
          .where(eq(planVersionLines.planVersionId, id))
          .orderBy(asc(planVersionLines.lineNo));
        const linked = await this.linkLines(tx, pv, lines);
        if (previous && previous.id !== pv.id) {
          const tied = await tx
            .select({ id: budgets.id, code: budgets.code, name: budgets.name })
            .from(budgets)
            .where(and(isNull(budgets.parentId), eq(budgets.planVersionId, previous.id)));
          const covered = new Set(linked.map((l) => l.rootId));
          const uncovered = tied.filter((t) => !covered.has(t.id));
          if (uncovered.length)
            throw new ApiProblem(
              422,
              'VALIDATION_FAILED',
              `The version has no line for ${uncovered.length} root budget(s) of the year (for example ${uncovered[0].code ?? uncovered[0].name}). Copy the current version and edit it.`,
              { missing: uncovered.length },
            );
        }
        const rootIds = linked.map((l) => l.rootId).filter((x): x is string => !!x);
        await this.reads.lockBudgets(tx, rootIds);
        const figures = await this.rootFigures(tx, rootIds);
        const rates = await this.reads.planRates(tx, pv.fiscalYearId);
        const accountingDate = await this.views.accountingDate(tx, pv.fiscalYearId);
        const journalIds: string[] = [];
        const created: string[] = [];
        const adjusted: string[] = [];
        for (const { line, rootId } of linked) {
          if (!rootId) {
            if (!line.legalEntityId)
              throw new ApiProblem(
                422,
                'VALIDATION_FAILED',
                `Line ${line.code} needs a legal entity to create its root budget.`,
              );
            const newId = await this.budgetsService.createInTx(
              tx,
              actor,
              {
                name: line.name,
                code: line.code,
                legalEntityId: line.legalEntityId,
                costCenterId: line.costCenterId,
                ownerPersonId: line.ownerPersonId,
                categoryCode: line.categoryCode ?? undefined,
                currency: actor.reportingCurrency,
                fiscalYearId: pv.fiscalYearId,
                planVersionId: pv.id,
                originalAmount: {
                  amountMinor: line.amountMinor,
                  currency: actor.reportingCurrency,
                },
                accountingDate,
              },
              { ...ctx, fixedId: undefined },
              {
                recordPlanLine: false,
                skipPolicy: true,
                reason: `Created from ${pv.label}`,
                audit: false,
              },
            );
            await tx
              .update(planVersionLines)
              .set({ budgetId: newId })
              .where(eq(planVersionLines.id, line.id));
            created.push(newId);
            continue;
          }
          const root = await this.views.row(tx, rootId);
          const f = figures.get(rootId)!;
          const delta = line.amountMinor - f.authorizedMinor - f.savingsMinor;
          if (delta !== 0) {
            if (delta < 0) {
              const b = (await this.reads.balances(tx, [rootId])).get(rootId)!.budget;
              const headroom = allocationAvailable(b, toPostingBudget(root).control);
              if (-delta > headroom)
                throw new ApiProblem(
                  409,
                  'REDUCTION_BELOW_FLOOR',
                  `${root.name} has only ${headroom} minor units unallocated and uncommitted; the plan cuts ${-delta}.`,
                  { budgetId: rootId, maxReductionMinor: headroom },
                );
            }
            const draft = unwrap(
              postPlanAdjustment(
                {
                  root: toPostingBudget(root),
                  planVersionId: pv.id,
                  deltaMinor: delta,
                  reason: `Plan version ${pv.label} applied`,
                },
                { reportingCurrency: actor.reportingCurrency, rates, accountingDate },
              ),
            );
            journalIds.push(
              await this.ledger.post(tx, draft, {
                actor,
                command: 'plan.apply',
                fiscalYearId: pv.fiscalYearId,
                requestId: ctx.requestId,
                idempotencyKey: ctx.idempotencyKey,
              }),
            );
            adjusted.push(rootId);
          }
          await tx.update(budgets).set({ planVersionId: pv.id }).where(eq(budgets.id, rootId));
          if (!line.budgetId)
            await tx
              .update(planVersionLines)
              .set({ budgetId: rootId })
              .where(eq(planVersionLines.id, line.id));
          await this.views.snapshot(tx, actor, rootId, `Tied to ${pv.label}`);
        }
        if (previous && previous.id !== pv.id)
          await tx
            .update(planVersions)
            .set({ status: 'superseded' })
            .where(eq(planVersions.id, previous.id));
        const [updated] = await tx
          .update(planVersions)
          .set({ appliedAt: new Date() })
          .where(eq(planVersions.id, id))
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'plan_version.applied',
          resourceType: 'plan_version',
          resourceId: id,
          requestId: ctx.requestId,
          changes: {
            supersedes: { from: null, to: previous && previous.id !== pv.id ? previous.id : null },
            created: { from: null, to: created.length },
            adjusted: { from: null, to: adjusted.length },
            createdBudgetIds: { from: null, to: created },
            adjustedBudgetIds: { from: null, to: adjusted },
            journalIds: { from: null, to: journalIds },
          },
        });
        return {
          planVersion: await this.detail(tx, actor, updated),
          journalIds,
          createdBudgetIds: created,
          adjustedBudgetIds: adjusted,
        };
      },
    );
  }

  // Roll forward ------------------------------------------------------------------------------

  async rollForward(
    actor: RequestActor,
    rootId: string,
    req: RollForwardRequest,
    ctx: CommandContext,
  ) {
    const run = async (tx: Tx): Promise<RollForwardResult> => {
      this.assertPlanManage(actor);
      const root = await this.views.row(tx, rootId);
      this.policy.assert(actor, 'budget.read', budgetResource(root), 'budget');
      if (root.parentId)
        throw new ApiProblem(422, 'VALIDATION_FAILED', 'Roll forward starts from a root budget.');
      const [srcFy] = await tx
        .select()
        .from(fiscalYears)
        .where(eq(fiscalYears.id, root.fiscalYearId));
      const [fy] = await tx
        .select()
        .from(fiscalYears)
        .where(eq(fiscalYears.id, req.targetFiscalYearId));
      if (!fy || fy.id === root.fiscalYearId)
        throw new ApiProblem(
          422,
          'VALIDATION_FAILED',
          'Choose a different fiscal year to roll into.',
          {
            field: 'targetFiscalYearId',
          },
        );
      const [pv] = await tx
        .select()
        .from(planVersions)
        .where(eq(planVersions.id, req.planVersionId));
      if (!pv || pv.status !== 'approved' || pv.fiscalYearId !== fy.id)
        throw new ApiProblem(
          422,
          'ROOT_REQUIRES_PLAN_VERSION',
          'Choose an approved plan version of the target year.',
        );
      const tree = (
        await tx
          .select()
          .from(budgets)
          .where(like(budgets.path, `${root.path}%`))
      )
        .filter((b) => b.status !== 'cancelled' && b.status !== 'closed')
        .sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));
      const balances = await this.reads.balances(
        tx,
        tree.map((t) => t.id),
      );
      const swap = (s: string | null) =>
        s && srcFy && s.includes(srcFy.label.replace(/^FY/, ''))
          ? s.replaceAll(srcFy.label.replace(/^FY/, ''), fy.label.replace(/^FY/, ''))
          : s;
      const plan = tree.map((b) => ({
        source: b,
        amountMinor: rollForwardAmount(balances.get(b.id)!.budget.authorized, req.scalePct),
      }));
      if (plan[0].amountMinor <= 0)
        throw new ApiProblem(
          422,
          'AMOUNT_NOT_POSITIVE',
          'The new root budget needs an amount above zero.',
        );
      const result: RollForwardResult = {
        dryRun: req.dryRun,
        rootId: null,
        currency: root.currency,
        totalMinor: plan[0].amountMinor,
        budgets: plan.map((p, i) => ({
          sourceId: p.source.id,
          newId: null,
          name: i === 0 ? (req.name ?? swap(p.source.name) ?? p.source.name) : p.source.name,
          depth: p.source.depth,
          amountMinor: p.amountMinor,
        })),
      };
      if (req.dryRun) return result;
      const idMap = new Map<string, string>();
      const accountingDate = await this.views.accountingDate(tx, fy.id);
      for (const [i, p] of plan.entries()) {
        const s = p.source;
        const newParent = s.parentId ? idMap.get(s.parentId) : undefined;
        if (s.parentId && !newParent) continue;
        const cat = s.categoryId
          ? (
              await tx
                .select({ code: budgetCategories.code })
                .from(budgetCategories)
                .where(eq(budgetCategories.id, s.categoryId))
            )[0]?.code
          : undefined;
        const newId = await this.budgetsService.createInTx(
          tx,
          actor,
          {
            name: result.budgets[i].name,
            code: i === 0 ? (req.code ?? swap(s.code) ?? undefined) : (s.code ?? undefined),
            parentId: newParent ?? null,
            legalEntityId: s.legalEntityId,
            costCenterId: s.costCenterId,
            orgUnitId: s.orgUnitId,
            ownerPersonId: s.ownerPersonId,
            categoryCode: cat,
            budgetType: s.budgetType,
            currency: s.currency,
            fiscalYearId: fy.id,
            accountingDate,
            control: toPostingBudget(s).control as never,
            alertThresholdsPct: s.alertThresholdsPct,
            ...(i === 0
              ? {
                  planVersionId: pv.id,
                  originalAmount: { amountMinor: p.amountMinor, currency: s.currency },
                }
              : {}),
          },
          { ...ctx, fixedId: undefined },
          {
            skipPolicy: true,
            reason: `Rolled forward from ${srcFy?.label ?? 'last year'}`,
            audit: false,
          },
        );
        idMap.set(s.id, newId);
        result.budgets[i].newId = newId;
        if (i > 0 && p.amountMinor > 0) {
          await this.budgetsService.allocateInTx(
            tx,
            actor,
            newParent!,
            {
              childBudgetId: newId,
              amount: { amountMinor: p.amountMinor, currency: s.currency },
              memo: 'Roll forward',
              accountingDate,
            },
            ctx,
            'budget.allocated',
            { skipPolicy: true, audit: false },
          );
        }
        if (s.allocationDriver === 'per_head' && s.driverConfig) {
          const cfg = s.driverConfig as PerHeadDriverConfig;
          await tx
            .update(budgets)
            .set({
              allocationDriver: 'per_head',
              driverConfig: { ...cfg, amountMinor: p.amountMinor },
            })
            .where(eq(budgets.id, newId));
        }
      }
      result.rootId = idMap.get(root.id) ?? null;
      await this.audit.append(tx, {
        tenantId: actor.tenantId,
        actorPersonId: actor.personId,
        actorSubject: actor.subject,
        action: 'budget.rolled_forward',
        resourceType: 'budget',
        resourceId: root.id,
        legalEntityId: root.legalEntityId,
        requestId: ctx.requestId,
        changes: {
          targetFiscalYearId: { from: null, to: fy.id },
          newRootId: { from: null, to: result.rootId },
          budgets: { from: null, to: idMap.size },
          budgetIds: { from: null, to: [...idMap.values()] },
          scalePct: { from: null, to: req.scalePct },
        },
      });
      return result;
    };
    if (req.dryRun) return this.tx(actor, run);
    return (
      await this.commands.run(
        actor,
        {
          idempotencyKey: ctx.idempotencyKey,
          operation: `budgets.roll_forward:${rootId}`,
          request: req,
          status: 200,
        },
        run,
      )
    ).body;
  }

  // Program templates -------------------------------------------------------------------------

  private async templateDtos(
    tx: Tx,
    rows: (typeof programTemplates.$inferSelect)[],
  ): Promise<ProgramTemplate[]> {
    const counts = rows.length
      ? await tx
          .select({ id: budgets.programTemplateId, n: sql<string>`count(*)::text` })
          .from(budgets)
          .where(
            inArray(
              budgets.programTemplateId,
              rows.map((r) => r.id),
            ),
          )
          .groupBy(budgets.programTemplateId)
      : [];
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      kind: r.kind,
      driver: r.driver,
      defaults: r.defaults as ProgramTemplateDefaults,
      budgetCount: Number(counts.find((c) => c.id === r.id)?.n ?? 0),
    }));
  }

  listTemplates(actor: RequestActor) {
    return this.tx(actor, async (tx) => {
      this.policy.assert(actor, 'tenant.read', { kind: 'tenant', tenantId: actor.tenantId });
      const rows = await tx.select().from(programTemplates).orderBy(asc(programTemplates.name));
      return { items: await this.templateDtos(tx, rows) };
    });
  }

  upsertTemplate(
    actor: RequestActor,
    id: string | null,
    req: UpsertProgramTemplateRequest,
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `templates.upsert:${id ?? 'new'}`,
        request: req,
        status: id ? 200 : 201,
      },
      async (tx) => {
        this.policy.assert(actor, 'master_data.manage', {
          kind: 'tenant',
          tenantId: actor.tenantId,
        });
        const clash = await tx
          .select({ id: programTemplates.id })
          .from(programTemplates)
          .where(eq(programTemplates.code, req.code));
        if (clash.some((c) => c.id !== id))
          throw new ApiProblem(
            409,
            'DUPLICATE_CODE',
            `A template with code ${req.code} already exists.`,
          );
        let row: typeof programTemplates.$inferSelect;
        let before: unknown = null;
        if (id) {
          const [cur] = await tx.select().from(programTemplates).where(eq(programTemplates.id, id));
          if (!cur) throw ApiProblem.notFound('program template');
          before = { name: cur.name, driver: cur.driver, defaults: cur.defaults };
          [row] = await tx
            .update(programTemplates)
            .set({ code: req.code, name: req.name, driver: req.driver, defaults: req.defaults })
            .where(eq(programTemplates.id, id))
            .returning();
        } else {
          [row] = await tx
            .insert(programTemplates)
            .values({
              tenantId: actor.tenantId,
              code: req.code,
              name: req.name,
              kind: req.code.toLowerCase(),
              driver: req.driver,
              defaults: req.defaults,
            })
            .returning();
        }
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: id ? 'program_template.changed' : 'program_template.created',
          resourceType: 'program_template',
          resourceId: row.id,
          requestId: ctx.requestId,
          changes: {
            template: {
              from: before,
              to: { name: req.name, driver: req.driver, defaults: req.defaults },
            },
          },
        });
        return (await this.templateDtos(tx, [row]))[0];
      },
    );
  }

  // Phasing -----------------------------------------------------------------------------------

  private async periodsFor(tx: Tx, row: BudgetRow) {
    const res = await tx.execute<{
      id: string;
      period_number: number;
      label: string;
      start_date: string;
      end_date: string;
      status: string;
    }>(sql`
      select p.id, p.period_number, p.label, p.start_date::text, p.end_date::text, p.status::text
      from fiscal_periods p
      join fiscal_years y on y.id = p.fiscal_year_id
      join legal_entities le on le.fiscal_calendar_id = p.fiscal_calendar_id
      where le.id = ${row.legalEntityId}::uuid
        and (y.id = ${row.fiscalYearId}::uuid or y.group_fiscal_year_id = ${row.fiscalYearId}::uuid)
      order by p.period_number`);
    return res.rows;
  }

  private async phasingDto(tx: Tx, row: BudgetRow): Promise<BudgetPhasing> {
    const periods = await this.periodsFor(tx, row);
    const allot = await tx
      .select()
      .from(budgetPeriodAllotments)
      .where(eq(budgetPeriodAllotments.budgetId, row.id));
    const usage = await tx.execute<{ fiscal_period_id: string; bucket: string; amt: string }>(sql`
      select fiscal_period_id, bucket, sum(budget_amount_minor)::text as amt from ledger_balances
      where budget_id = ${row.id}::uuid and bucket in ('encumbered', 'actual')
      group by fiscal_period_id, bucket`);
    const authorized = (await this.reads.balances(tx, [row.id])).get(row.id)!.budget.authorized;
    const items = periods.map((p) => ({
      periodId: p.id,
      periodNumber: p.period_number,
      label: p.label,
      startDate: p.start_date,
      endDate: p.end_date,
      status: p.status,
      allotmentMinor: allot.find((a) => a.fiscalPeriodId === p.id)?.amountMinor ?? 0,
      committedMinor: Number(
        usage.rows.find((u) => u.fiscal_period_id === p.id && u.bucket === 'encumbered')?.amt ?? 0,
      ),
      actualMinor: Number(
        usage.rows.find((u) => u.fiscal_period_id === p.id && u.bucket === 'actual')?.amt ?? 0,
      ),
    }));
    const phased = items.reduce((s, i) => s + i.allotmentMinor, 0);
    return {
      budgetId: row.id,
      method: (row.phasingMethod as BudgetPhasing['method']) ?? null,
      currency: row.currency,
      authorizedMinor: authorized,
      phasedMinor: phased,
      outOfDate: row.phasingMethod !== null && phased !== authorized,
      periods: items,
    };
  }

  getPhasing(actor: RequestActor, id: string) {
    return this.tx(actor, async (tx) => {
      const row = await this.views.row(tx, id);
      this.policy.assert(actor, 'budget.read', budgetResource(row), 'budget');
      return this.phasingDto(tx, row);
    });
  }

  setPhasing(actor: RequestActor, id: string, req: SetPhasingRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `budgets.phasing:${id}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        const row = await this.views.row(tx, id);
        this.policy.assert(actor, 'budget.read', budgetResource(row), 'budget');
        this.policy.assert(actor, 'budget.control', budgetResource(row), 'budget');
        await this.reads.lockBudgets(tx, [id]);
        const periods = await this.periodsFor(tx, row);
        const authorized = (await this.reads.balances(tx, [id])).get(id)!.budget.authorized;
        const amounts = unwrap(
          phaseAmounts(authorized, periods.length, req.method, {
            weights: req.weights,
            amountsMinor: req.amountsMinor,
          }),
        );
        for (const [i, p] of periods.entries()) {
          await tx
            .insert(budgetPeriodAllotments)
            .values({
              tenantId: actor.tenantId,
              budgetId: id,
              fiscalPeriodId: p.id,
              amountMinor: amounts[i],
            })
            .onConflictDoUpdate({
              target: [
                budgetPeriodAllotments.tenantId,
                budgetPeriodAllotments.budgetId,
                budgetPeriodAllotments.fiscalPeriodId,
              ],
              set: { amountMinor: amounts[i] },
            });
        }
        await tx.update(budgets).set({ phasingMethod: req.method }).where(eq(budgets.id, id));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'budget.phased',
          resourceType: 'budget',
          resourceId: id,
          legalEntityId: row.legalEntityId,
          requestId: ctx.requestId,
          changes: {
            method: { from: row.phasingMethod, to: req.method },
            periods: { from: null, to: amounts },
          },
        });
        await this.views.snapshot(tx, actor, id, `Phased (${req.method})`);
        return this.phasingDto(tx, await this.views.row(tx, id));
      },
    );
  }

  // Versions ----------------------------------------------------------------------------------

  versions(actor: RequestActor, id: string): Promise<{ items: BudgetVersion[] }> {
    return this.tx(actor, async (tx) => {
      const row = await this.views.row(tx, id);
      this.policy.assert(actor, 'budget.read', budgetResource(row), 'budget');
      const rows = await tx
        .select({
          version: budgetVersions.version,
          reason: budgetVersions.reason,
          createdAt: budgetVersions.createdAt,
          snapshot: budgetVersions.snapshot,
          actorName: people.displayName,
        })
        .from(budgetVersions)
        .leftJoin(people, eq(people.id, budgetVersions.createdBy))
        .where(eq(budgetVersions.budgetId, id))
        .orderBy(desc(budgetVersions.version))
        .limit(200);
      return {
        items: rows.map((r) => ({
          version: r.version,
          reason: r.reason,
          createdAt: r.createdAt.toISOString(),
          actorName: r.actorName,
          snapshot: r.snapshot as Record<string, unknown>,
        })),
      };
    });
  }

  // Limits and spend check --------------------------------------------------------------------

  private async limitsDto(tx: Tx, row: BudgetRow): Promise<BudgetLimits> {
    const rows = await tx
      .select()
      .from(budgetLimits)
      .where(eq(budgetLimits.budgetId, row.id))
      .orderBy(asc(budgetLimits.createdAt));
    const units = rows.map((r) => r.orgUnitId).filter((u): u is string => !!u);
    const names = units.length
      ? new Map(
          (
            await tx.execute<{ id: string; name: string }>(
              sql`select id, name from org_units where id in (${sql.join(
                units.map((u) => sql`${u}::uuid`),
                sql`, `,
              )})`,
            )
          ).rows.map((u) => [u.id, u.name]),
        )
      : new Map<string, string>();
    return {
      currency: row.currency,
      items: rows.map((r) => ({
        id: r.id,
        kind: r.kind as BudgetLimit['kind'],
        categoryCode: r.categoryCode,
        orgUnitId: r.orgUnitId,
        orgUnitName: r.orgUnitId ? (names.get(r.orgUnitId) ?? null) : null,
        amountMinor: r.amountMinor,
        mode: r.mode as 'hard' | 'soft',
      })),
    };
  }

  getLimits(actor: RequestActor, id: string) {
    return this.tx(actor, async (tx) => {
      const row = await this.views.row(tx, id);
      this.policy.assert(actor, 'budget.read', budgetResource(row), 'budget');
      return this.limitsDto(tx, row);
    });
  }

  setLimits(actor: RequestActor, id: string, req: SetBudgetLimitsRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `budgets.limits:${id}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        const row = await this.views.row(tx, id);
        const parent = row.parentId ? await this.views.row(tx, row.parentId) : undefined;
        this.views.assertControl(actor, row, parent);
        for (const l of req.items) {
          if (l.kind === 'category' && !l.categoryCode)
            throw new ApiProblem(422, 'VALIDATION_FAILED', 'A category limit names its category.', {
              field: 'categoryCode',
            });
        }
        const before = await this.limitsDto(tx, row);
        await tx.delete(budgetLimits).where(eq(budgetLimits.budgetId, id));
        if (req.items.length)
          await tx.insert(budgetLimits).values(
            req.items.map((l) => ({
              tenantId: actor.tenantId,
              budgetId: id,
              kind: l.kind,
              categoryCode: l.categoryCode,
              orgUnitId: l.orgUnitId,
              amountMinor: l.amountMinor,
              currency: row.currency,
              mode: l.mode,
            })),
          );
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'budget.limits_changed',
          resourceType: 'budget',
          resourceId: id,
          legalEntityId: row.legalEntityId,
          requestId: ctx.requestId,
          reason: req.reason ?? null,
          changes: {
            limits: {
              from: before.items.map(({ kind, categoryCode, orgUnitId, amountMinor, mode }) => ({
                kind,
                categoryCode,
                orgUnitId,
                amountMinor,
                mode,
              })),
              to: req.items.map(({ kind, categoryCode, orgUnitId, amountMinor, mode }) => ({
                kind,
                categoryCode,
                orgUnitId,
                amountMinor,
                mode,
              })),
            },
          },
        });
        await this.views.snapshot(tx, actor, id, req.reason?.trim() || 'Limits changed');
        return this.limitsDto(tx, row);
      },
    );
  }

  /** Would a new request be accepted? Status (frozen, zero, ...), control mode and tolerance, then limits. */
  async spendCheckInTx(tx: Tx, row: BudgetRow, req: SpendCheckRequest): Promise<SpendCheckResult> {
    const reasons: SpendCheckResult['reasons'] = [];
    let outcome: SpendCheckResult['outcome'] = 'ok';
    const status = acceptsNewActivity(row.status);
    if (!status.ok) {
      reasons.push({ code: status.error.code, message: status.error.message });
      outcome = 'blocked';
    }
    const b = (await this.reads.balances(tx, [row.id])).get(row.id)!.budget;
    const spend = checkSpend(b, toPostingBudget(row).control, req.amountMinor);
    if (spend.outcome === 'blocked') {
      reasons.push({
        code: 'INSUFFICIENT_AVAILABLE',
        message: 'The amount is more than this budget has available.',
      });
      outcome = 'blocked';
    } else if (spend.outcome === 'warning') {
      reasons.push({
        code: 'INSUFFICIENT_AVAILABLE',
        message:
          row.controlMode === 'soft'
            ? 'The amount is more than available; this budget warns but allows it.'
            : 'The amount uses the spending tolerance above available.',
      });
      if (outcome === 'ok') outcome = 'warning';
    }
    const limits = await tx.select().from(budgetLimits).where(eq(budgetLimits.budgetId, row.id));
    const findings = checkLimits(
      limits.map((l) => ({
        id: l.id,
        kind: l.kind as BudgetLimit['kind'],
        categoryCode: l.categoryCode,
        orgUnitId: l.orgUnitId,
        amountMinor: l.amountMinor,
        mode: l.mode as 'hard' | 'soft',
      })),
      req,
    );
    for (const f of findings) {
      reasons.push({ code: 'LIMIT_EXCEEDED', message: f.message });
      if (f.outcome === 'blocked') outcome = 'blocked';
      else if (outcome === 'ok') outcome = 'warning';
    }
    return {
      outcome,
      availableMinor: spend.availableMinor,
      availableAfterMinor: spend.availableMinor - req.amountMinor,
      toleranceMinor: spend.toleranceMinor,
      currency: row.currency,
      reasons,
      limits: findings,
    };
  }

  spendCheck(actor: RequestActor, id: string, req: SpendCheckRequest) {
    return this.tx(actor, async (tx) => {
      const row = await this.views.row(tx, id);
      this.policy.assert(actor, 'budget.read', budgetResource(row), 'budget');
      return this.spendCheckInTx(tx, row, req);
    });
  }
}
