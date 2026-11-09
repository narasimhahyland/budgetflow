import { AuditService } from '@bf/api/audit';
import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  type CommandResult,
  type RequestActor,
  todayUtc,
} from '@bf/api/core';
import {
  boardPackGenerations,
  outboxMessages,
  people,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import { S3DocumentStore } from '@bf/api/documents';
import type {
  BoardPack,
  BoardPackDownload,
  BoardPackGeneration,
  BoardPackPage,
  BoardPackPageId,
  BoardPackSource,
  CreateBoardPackRequest,
  FxBridge,
  Money,
  ReportReconciliation,
} from '@bf/contracts';
import { BOARD_PACK_PAGES } from '@bf/contracts';
import { FX_BRIDGE_NOTE, fxBridge, type FxRate } from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { buildBoardPackPage, type BoardPackData } from './board-pack-pages';
import { ReportExtrasReads } from './report-extras.service';
import { ReportReads, sumBuckets } from './report-reads.service';

export const BOARD_PACK_TOPIC = 'report.board_pack';
const DOWNLOAD_TTL = 300;
const PACK_DAYS = 7;

export interface BoardPackJob {
  tenantId: string;
  generationId: string;
}

type GenerationRow = typeof boardPackGenerations.$inferSelect;

interface PackFile {
  format: 'pdf' | 'xlsx';
  fileName: string;
  storageKey: string;
  sizeBytes: number;
  sha256: string;
}

export interface BoardPackOptions {
  fiscalPeriodId?: string;
  draft?: boolean;
  pages?: BoardPackPageId[];
  constantCurrency?: boolean;
  rootBudgetId?: string;
  forecastCycleId?: string;
}

/**
 * The board and FP&A pack (16a). A closed period's pack reads the immutable `period_close_snapshots`
 * for its entity and summary pages and the as-of ledger for the rest, so a pack regenerated next
 * month matches the one that was sent. An open period is allowed but every page is marked Draft.
 *
 * The FX bridge values the same actual spend twice — at the locked plan rate and at the rate the
 * ledger reported it at — and reports only the gap. It posts nothing, consumes nothing and is never
 * added into spend or variance, which is how the pack explains a currency effect without implying
 * that any budget moved.
 */
@Injectable()
export class BoardPackService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly reads: ReportReads,
    private readonly extras: ReportExtrasReads,
    private readonly store: S3DocumentStore,
  ) {}

  private assertCanBuild(actor: RequestActor): void {
    // Building the pack is tenant-wide finance work; owner-scoped roles get a 403, never a subset.
    // `report.board_pack` is held only at tenant scope, so it admits exactly the roles the pack is
    // for and the navigation can be gated on the same permission (016a).
    const decision = this.policy.can(actor, 'report.board_pack', {
      kind: 'tenant',
      tenantId: actor.tenantId,
    });
    if (!decision.allowed) {
      if (!decision.visible) throw ApiProblem.notFound('board pack');
      throw ApiProblem.forbidden('The board pack is open to finance roles, the CEO and auditors.');
    }
  }

  preview(actor: RequestActor, opts: BoardPackOptions): Promise<BoardPack> {
    this.assertCanBuild(actor);
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) =>
      this.build(tx, actor, opts),
    );
  }

  /** Records the request and lets the worker render it; the API never blocks on file rendering. */
  create(
    actor: RequestActor,
    req: CreateBoardPackRequest,
    ctx: { idempotencyKey: string; requestId: string | null },
  ): Promise<CommandResult<BoardPackGeneration>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'reports.board_pack.generate',
        request: req,
        status: 202,
      },
      async (tx) => {
        this.assertCanBuild(actor);
        const source = await this.source(tx, { ...req });
        const pages = req.pages ?? [...BOARD_PACK_PAGES];
        const formats = req.formats ?? ['pdf', 'xlsx'];
        const [row] = await tx
          .insert(boardPackGenerations)
          .values({
            tenantId: actor.tenantId,
            fiscalPeriodId: source.fiscalPeriodId,
            sourceKind: source.kind,
            snapshotVersion: source.snapshotVersion,
            snapshotTakenAt: source.takenAt ? new Date(source.takenAt) : null,
            draft: source.draft,
            pages,
            formats,
            constantCurrency: req.constantCurrency ?? true,
            rootBudgetId: req.rootBudgetId ?? null,
            forecastCycleId: req.forecastCycleId ?? null,
            currency: actor.reportingCurrency,
            status: 'queued',
            requestedByPersonId: actor.personId,
            expiresAt: new Date(Date.now() + PACK_DAYS * 24 * 60 * 60 * 1000),
          })
          .returning();
        await tx.insert(outboxMessages).values({
          tenantId: actor.tenantId,
          topic: BOARD_PACK_TOPIC,
          payload: { generationId: row.id },
        });
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'report.board_pack_requested',
          resourceType: 'board_pack_generation',
          resourceId: row.id,
          requestId: ctx.requestId,
          changes: {
            fiscalPeriodId: { from: null, to: source.fiscalPeriodId },
            sourceKind: { from: null, to: source.kind },
            draft: { from: null, to: source.draft },
            pages: { from: null, to: pages },
            formats: { from: null, to: formats },
          },
        });
        return this.generationDto(tx, row);
      },
    );
  }

  list(actor: RequestActor): Promise<{ items: BoardPackGeneration[] }> {
    this.assertCanBuild(actor);
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const rows = await tx
        .select()
        .from(boardPackGenerations)
        // Newest first, then by id, so two generations requested in the same second keep an order.
        .orderBy(desc(boardPackGenerations.requestedAt), desc(boardPackGenerations.id))
        .limit(50);
      const items: BoardPackGeneration[] = [];
      for (const row of rows) items.push(await this.generationDto(tx, row));
      return { items };
    });
  }

  generation(actor: RequestActor, generationId: string): Promise<BoardPackGeneration> {
    this.assertCanBuild(actor);
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) =>
      this.generationDto(tx, await this.generationRow(tx, generationId)),
    );
  }

  /** A short-lived signed URL for one rendered file under the tenant's own key prefix. */
  download(
    actor: RequestActor,
    generationId: string,
    format: 'pdf' | 'xlsx',
  ): Promise<BoardPackDownload> {
    this.assertCanBuild(actor);
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const row = await this.generationRow(tx, generationId);
      if (row.status !== 'ready')
        throw new ApiProblem(
          409,
          'BOARD_PACK_NOT_READY',
          `This pack is ${row.status}; it has no file to download yet.`,
        );
      if (row.expiresAt.getTime() < Date.now())
        throw new ApiProblem(
          409,
          'BOARD_PACK_NOT_READY',
          'The links for this pack have expired; generate it again.',
        );
      const file = (row.files as PackFile[]).find((f) => f.format === format);
      if (!file) throw ApiProblem.notFound(`${format} file`);
      return {
        url: this.store.downloadUrl(file.storageKey, file.fileName, DOWNLOAD_TTL),
        fileName: file.fileName,
        expiresAt: new Date(Date.now() + DOWNLOAD_TTL * 1000).toISOString(),
      };
    });
  }

  // Worker side -----------------------------------------------------------------------------------

  /**
   * Renders the pack and writes the files into the DocumentStore under `tenants/<id>/board-packs/`.
   * Idempotent: a generation already `ready` is left alone, so a repeated job is a no-op.
   */
  async render(job: BoardPackJob): Promise<void> {
    const prepared = await withTenant(
      this.db,
      { tenantId: job.tenantId, subject: 'system:worker' },
      async (tx) => {
        const [row] = await tx
          .select()
          .from(boardPackGenerations)
          .where(eq(boardPackGenerations.id, job.generationId))
          .for('update');
        if (!row || row.status === 'ready') return null;
        await tx
          .update(boardPackGenerations)
          .set({ status: 'running' })
          .where(eq(boardPackGenerations.id, row.id));
        const actor = await this.workerActor(tx, row);
        const pack = await this.build(tx, actor, {
          fiscalPeriodId: row.fiscalPeriodId,
          draft: row.draft,
          pages: row.pages as BoardPackPageId[],
          constantCurrency: row.constantCurrency,
          rootBudgetId: row.rootBudgetId ?? undefined,
          forecastCycleId: row.forecastCycleId ?? undefined,
        });
        return { row, pack };
      },
    );
    if (!prepared) return;
    const { row, pack } = prepared;
    try {
      const files: PackFile[] = [];
      for (const format of row.formats as ('pdf' | 'xlsx')[])
        files.push(await this.writeFile(row, pack, format));
      await withTenant(this.db, { tenantId: job.tenantId, subject: 'system:worker' }, (tx) =>
        this.finish(tx, row, {
          status: 'ready',
          files,
          pageCount: pack.pages.length,
          rowCount: pack.pages.reduce((s, p) => s + p.rows.length, 0),
          failedPage: null,
          error: null,
        }),
      );
    } catch (e) {
      await withTenant(this.db, { tenantId: job.tenantId, subject: 'system:worker' }, (tx) =>
        this.finish(tx, row, {
          status: 'failed',
          files: [],
          pageCount: pack.pages.length,
          rowCount: 0,
          failedPage: null,
          error: (e as Error).message.slice(0, 500),
        }),
      );
    }
  }

  private async writeFile(
    row: GenerationRow,
    pack: BoardPack,
    format: 'pdf' | 'xlsx',
  ): Promise<PackFile> {
    const { body, contentType, fileName } = renderPack(pack, format, row.fiscalPeriodId);
    // Tenant-scoped key: a pack of one tenant can never be addressed from another.
    const storageKey = `tenants/${row.tenantId}/board-packs/${row.id}.${format}`;
    await this.store.put(storageKey, contentType, body);
    return {
      format,
      fileName,
      storageKey,
      sizeBytes: body.length,
      sha256: createHash('sha256').update(body).digest('hex'),
    };
  }

  private async finish(
    tx: Tx,
    row: GenerationRow,
    outcome: {
      status: 'ready' | 'failed';
      files: PackFile[];
      pageCount: number;
      rowCount: number;
      failedPage: string | null;
      error: string | null;
    },
  ): Promise<void> {
    await tx
      .update(boardPackGenerations)
      .set({
        status: outcome.status,
        files: outcome.files,
        pageCount: outcome.pageCount,
        rowCount: outcome.rowCount,
        failedPage: outcome.failedPage,
        error: outcome.error,
        completedAt: new Date(),
      })
      .where(eq(boardPackGenerations.id, row.id));
    await this.audit.append(tx, {
      tenantId: row.tenantId,
      actorPersonId: row.requestedByPersonId,
      actorSubject: 'system:worker',
      action:
        outcome.status === 'ready' ? 'report.board_pack_generated' : 'report.board_pack_failed',
      resourceType: 'board_pack_generation',
      resourceId: row.id,
      changes: {
        status: { from: 'running', to: outcome.status },
        pageCount: { from: null, to: outcome.pageCount },
        formats: { from: null, to: outcome.files.map((f) => f.format) },
        error: { from: null, to: outcome.error },
      },
    });
  }

  /**
   * The worker renders with the requester's reporting currency at tenant scope. The request was
   * already authorized against `report.read` when it was queued, and the pack is tenant-wide, so
   * there is nothing narrower to re-scope it to.
   */
  private async workerActor(tx: Tx, row: GenerationRow): Promise<RequestActor> {
    const name = row.requestedByPersonId
      ? (await tx.select().from(people).where(eq(people.id, row.requestedByPersonId)))[0]
          ?.displayName
      : null;
    return {
      tenantId: row.tenantId,
      personId: row.requestedByPersonId,
      roles: ['finance-admin'],
      ownedBudgetPaths: [],
      subject: 'system:worker',
      displayName: name ?? 'BudgetFlow',
      tenantName: 'Hyland',
      reportingCurrency: row.currency as RequestActor['reportingCurrency'],
      memberships: [],
    };
  }

  // Building --------------------------------------------------------------------------------------

  /**
   * The period the pack reads, and whether it is the immutable snapshot or a live draft. A tenant
   * runs several fiscal calendars, so a date can fall in several periods: the pack prefers a period
   * on a calendar that actually carries budgets, and tie-breaks on the period id, so the same month
   * always produces the same pack.
   */
  private async source(
    tx: Tx,
    opts: { fiscalPeriodId?: string; draft?: boolean },
  ): Promise<BoardPackSource> {
    const columns = sql`p.id, p.label, p.start_date::text as start_date, p.end_date::text as end_date,
                        p.status::text as status, p.fiscal_year_id`;
    const hasBudgets = sql`exists (
      select 1 from budgets b
      where b.fiscal_year_id = p.fiscal_year_id and b.status <> 'cancelled')`;
    const res = opts.fiscalPeriodId
      ? await tx.execute<PeriodPick>(
          sql`select ${columns} from fiscal_periods p where p.id = ${opts.fiscalPeriodId}::uuid`,
        )
      : opts.draft
        ? await tx.execute<PeriodPick>(sql`
            select ${columns} from fiscal_periods p
            where p.status = 'open'
            order by ${hasBudgets} desc, p.start_date, p.id
            limit 1`)
        : await tx.execute<PeriodPick>(sql`
            select ${columns} from fiscal_periods p
            where p.status in ('closed', 'locked')
            order by ${hasBudgets} desc, p.end_date desc, p.id
            limit 1`);
    const period = res.rows[0];
    if (!period)
      throw new ApiProblem(
        409,
        'BOARD_PACK_NO_SNAPSHOT',
        'No closed accounting period to build a pack from yet. Close a period, or ask for the open-period draft.',
      );
    const draft = period.status === 'open' || period.status === 'soft_closed';
    const snapshots = await tx.execute<{ version: string; taken_at: string }>(sql`
      select version::text, taken_at::text
      from period_close_snapshots
      where fiscal_period_id = ${period.id}::uuid
      order by version desc, taken_at desc
      limit 1`);
    const snapshot = snapshots.rows[0];
    return {
      kind: draft ? 'open_period_draft' : 'close_snapshot',
      fiscalPeriodId: period.id,
      periodLabel: period.label,
      snapshotVersion: draft || !snapshot ? null : Number(snapshot.version),
      takenAt: draft || !snapshot ? null : new Date(snapshot.taken_at).toISOString(),
      draft,
      statement: draft
        ? `Draft: ${period.label} is still open and these figures can still change.`
        : snapshot
          ? `Figures from the ${period.label} close snapshot taken ${new Date(snapshot.taken_at).toISOString()}. Items posted late are in the next open period.`
          : `Figures as of the end of ${period.label}, which is closed. Items posted late are in the next open period.`,
    };
  }

  private async build(tx: Tx, actor: RequestActor, opts: BoardPackOptions): Promise<BoardPack> {
    const source = await this.source(tx, opts);
    const [period] = (
      await tx.execute<PeriodPick>(sql`
        select p.id, p.label, p.start_date::text as start_date, p.end_date::text as end_date,
               p.status::text as status, p.fiscal_year_id
        from fiscal_periods p where p.id = ${source.fiscalPeriodId}::uuid`)
    ).rows;
    const filters = {
      ...(opts.rootBudgetId ? { rootBudgetId: opts.rootBudgetId } : {}),
      fiscalYearId: period.fiscal_year_id,
      // As-of the period end: the ledger before this period closed, which a closed period freezes.
      periodTo: period.end_date,
    };
    const today = todayUtc();
    const dataset = await this.reads.dataset(tx, actor, filters, today);
    const budgetIds = dataset.budgets.map((b) => b.row.id);
    const [snapshots, fxLines, planRates, forecasts] = await Promise.all([
      this.snapshotRows(tx, source.fiscalPeriodId),
      this.extras.fxBridgeLines(tx, { budgetIds, periodTo: period.end_date }),
      this.extras.planRates(tx, period.fiscal_year_id),
      this.extras.forecasts(tx, {
        budgetIds,
        cycleId: opts.forecastCycleId,
        fiscalYearId: period.fiscal_year_id,
      }),
    ]);
    const data: BoardPackData = {
      dataset,
      period: { id: period.id, label: period.label, endDate: period.end_date },
      snapshots,
      forecasts: forecasts.forecasts,
      commitments: await this.topCommitments(tx, budgetIds, period.end_date),
      controls: await this.controlsApplied(tx, period.start_date, period.end_date),
      exceptions: await this.exceptions(tx),
      cofunding: await this.cofunding(tx, budgetIds),
      monthly: await this.monthly(tx, budgetIds, period.fiscal_year_id, period.end_date),
      draft: source.draft,
    };
    const wanted = opts.pages ?? [...BOARD_PACK_PAGES];
    const pages: BoardPackPage[] = wanted.map((page) => buildBoardPackPage(page, data));
    const bridge = fxBridge(fxLines, dataset.currency as FxRate['base'], planRates);
    const fx: FxBridge = {
      reportingRateType: 'monthly_average',
      rows: bridge.rows,
      totalEffect: bridge.totalEffect,
      note: FX_BRIDGE_NOTE,
    };
    const notes = [source.statement, FX_BRIDGE_NOTE];
    if (source.draft) notes.push('Every page of this pack is marked Draft.');
    return {
      generatedAt: new Date().toISOString(),
      currency: dataset.currency,
      title: `${actor.tenantName} \u2014 budget pack \u2014 ${period.label}`,
      source,
      constantCurrency: opts.constantCurrency ?? true,
      scope: {
        tenantWide: dataset.tenantWide,
        label: dataset.scopeLabel,
        budgetIds: dataset.budgets.length,
        note: null,
      },
      pages,
      fxBridge: fx,
      reconciliation: this.reconcile(dataset, snapshots),
      notes,
    };
  }

  /**
   * The pack against the ledger. The bucket totals come from the as-of ledger balances; when the
   * period has close snapshots their stored totals are compared with those balances, and any
   * difference is reported with `ties: false` rather than quietly preferring one side.
   */
  private reconcile(
    dataset: Awaited<ReturnType<ReportReads['dataset']>>,
    snapshots: readonly SnapshotTotals[],
  ): ReportReconciliation {
    const totals = sumBuckets(dataset.budgets);
    const money = (amountMinor: number): Money => ({
      amountMinor,
      currency: dataset.currency,
    });
    const differences: { key: string; expected: Money; actual: Money }[] = [];
    if (snapshots.length) {
      const snapshot = snapshots.reduce(
        (t, s) => ({
          authorized: t.authorized + (s.authorizedMinor - s.allocatedOutMinor),
          held: t.held + s.heldMinor,
          preEncumbered: t.preEncumbered + s.preEncumberedMinor,
          encumbered: t.encumbered + s.encumberedMinor,
          actual: t.actual + s.actualMinor,
        }),
        { authorized: 0, held: 0, preEncumbered: 0, encumbered: 0, actual: 0 },
      );
      const check = (key: string, expected: number, got: number) => {
        if (expected !== got)
          differences.push({ key, expected: money(expected), actual: money(got) });
      };
      check('snapshot.authorized', totals.authorized, snapshot.authorized);
      check('snapshot.held', totals.held, snapshot.held);
      check('snapshot.preEncumbered', totals.preEncumbered, snapshot.preEncumbered);
      check('snapshot.encumbered', totals.encumbered, snapshot.encumbered);
      check('snapshot.actual', totals.actual, snapshot.actual);
    }
    return {
      source: 'ledger_balances',
      budgetsCounted: dataset.budgets.length,
      authorized: money(totals.authorized),
      held: money(totals.held),
      preEncumbered: money(totals.preEncumbered),
      encumbered: money(totals.encumbered),
      actual: money(totals.actual),
      accrued: money(totals.accrued),
      available: money(totals.available),
      ties: differences.length === 0,
      differences,
    };
  }

  private async snapshotRows(tx: Tx, periodId: string): Promise<SnapshotTotals[]> {
    const res = await tx.execute<{
      legal_entity_id: string | null;
      code: string | null;
      name: string | null;
      version: string;
      budget_count: string;
      balances: Record<string, number>;
      taken_at: string;
    }>(sql`
      select distinct on (s.legal_entity_id)
             s.legal_entity_id, le.code, le.name, s.version::text, s.budget_count::text,
             s.balances, s.taken_at::text
      from period_close_snapshots s
      left join legal_entities le on le.id = s.legal_entity_id
      where s.fiscal_period_id = ${periodId}::uuid
      order by s.legal_entity_id, s.version desc, s.taken_at desc`);
    const num = (b: Record<string, number>, k: string) => Number(b[k] ?? 0);
    return (
      res.rows
        .map((r) => ({
          legalEntityId: r.legal_entity_id,
          code: r.code ?? 'Not set',
          name: r.name ?? 'Not set',
          version: Number(r.version),
          budgetCount: Number(r.budget_count),
          authorizedMinor: num(r.balances, 'authorizedMinor'),
          allocatedOutMinor: num(r.balances, 'allocatedOutMinor'),
          heldMinor: num(r.balances, 'heldMinor'),
          preEncumberedMinor: num(r.balances, 'preEncumberedMinor'),
          encumberedMinor: num(r.balances, 'encumberedMinor'),
          actualMinor: num(r.balances, 'actualMinor'),
          accruedMinor: num(r.balances, 'accruedMinor'),
          takenAt: r.taken_at,
        }))
        // Code then id: a total order, so two entities with the same code never swap in the pack.
        .sort(
          (a, b) =>
            a.code.localeCompare(b.code) ||
            (a.legalEntityId ?? '').localeCompare(b.legalEntityId ?? ''),
        )
    );
  }

  /** Open commitments above the pack threshold, largest first. */
  private async topCommitments(tx: Tx, budgetIds: readonly string[], endDate: string) {
    if (!budgetIds.length) return [];
    const res = await tx.execute<{
      id: string;
      description: string;
      budget_name: string;
      vendor_name: string | null;
      status: string;
      amount_minor: string;
      currency: string;
      service_end: string | null;
    }>(sql`
      select c.id, c.description, b.name as budget_name, v.name as vendor_name,
             c.status::text as status, c.amount_minor::text, c.currency, c.service_end::text
      from commitments c
      join budgets b on b.id = c.budget_id
      left join vendors v on v.id = c.vendor_id
      where c.budget_id in (${uuidList(budgetIds)})
        and c.status in ('encumbered', 'partially_consumed')
        and c.created_at::date <= ${endDate}::date
        and c.amount_minor >= 250000
      order by c.amount_minor desc, c.description, c.id
      limit 50`);
    return res.rows.map((r) => ({
      id: r.id,
      description: r.description,
      budgetName: r.budget_name,
      vendorName: r.vendor_name,
      status: r.status,
      amountMinor: Number(r.amount_minor),
      currency: r.currency,
      serviceEnd: r.service_end,
    }));
  }

  /** Freeze, reduce and set-to-zero decisions taken in the period, with their reasons, from audit. */
  private async controlsApplied(tx: Tx, startDate: string, endDate: string) {
    const res = await tx.execute<{
      id: string;
      action: string;
      resource_id: string;
      budget_name: string | null;
      reason: string | null;
      actor_name: string | null;
      occurred_at: string;
    }>(sql`
      select a.id, a.action, a.resource_id, b.name as budget_name, a.reason,
             p.display_name as actor_name, a.occurred_at::text
      from audit_events a
      left join budgets b on b.id::text = a.resource_id
      left join people p on p.id = a.actor_person_id
      where a.resource_type = 'budget'
        and a.action in ('budget.frozen', 'budget.unfrozen', 'budget.reduced', 'budget.set_to_zero', 'budget.restored')
        and a.occurred_at::date between ${startDate}::date and ${endDate}::date
      order by a.occurred_at desc, a.id desc
      limit 100`);
    return res.rows.map((r) => ({
      id: r.id,
      action: r.action,
      budgetId: r.resource_id,
      budgetName: r.budget_name,
      reason: r.reason,
      actorName: r.actor_name,
      occurredAt: r.occurred_at,
    }));
  }

  /** Open integrity flags: the exceptions summary page. */
  private async exceptions(tx: Tx) {
    const res = await tx.execute<{ kind: string; status: string; n: string }>(sql`
      select kind::text as kind, status::text as status, count(*)::text as n
      from integrity_flags
      where status <> 'resolved'
      group by kind, status
      order by kind, status`);
    return res.rows.map((r) => ({ kind: r.kind, status: r.status, count: Number(r.n) }));
  }

  /** Approved Inter-Director Budget Contribution Requests into budgets in scope. */
  private async cofunding(tx: Tx, budgetIds: readonly string[]) {
    if (!budgetIds.length) return [];
    const res = await tx.execute<{
      giving_budget_name: string;
      receiving: string | null;
      status: string;
      approved_minor: string;
      currency: string;
      mode: string | null;
      n: string;
    }>(sql`
      select gb.name as giving_budget_name, e.name as receiving, c.status::text as status,
             sum(coalesce(c.approved_minor, c.requested_minor))::text as approved_minor,
             min(c.currency) as currency, min(c.mode::text) as mode, count(*)::text as n
      from contribution_requests c
      join budgets gb on gb.id = c.giver_budget_id
      left join events e on e.id = c.event_id
      where c.status in ('approved_full', 'approved_partial', 'earmarked', 'transferred', 'settled')
        and (c.giver_budget_id in (${uuidList(budgetIds)}) or c.receiver_budget_id in (${uuidList(budgetIds)}))
      group by gb.name, e.name, c.status
      order by gb.name, e.name nulls last, c.status`);
    return res.rows.map((r) => ({
      givingBudgetName: r.giving_budget_name,
      receiving: r.receiving,
      status: r.status,
      approvedMinor: Number(r.approved_minor),
      currency: r.currency ?? 'USD',
      mode: r.mode,
      count: Number(r.n),
    }));
  }

  /** Actual and committed money per accounting period up to the pack's period: the By period page. */
  private async monthly(
    tx: Tx,
    budgetIds: readonly string[],
    fiscalYearId: string,
    endDate: string,
  ) {
    if (!budgetIds.length) return [];
    const res = await tx.execute<{
      period_id: string;
      label: string;
      start_date: string;
      actual: string;
      committed: string;
    }>(sql`
      select fp.id as period_id, fp.label, fp.start_date::text as start_date,
             coalesce(sum(case when lb.bucket = 'actual' then lb.reporting_amount_minor end), 0)::text as actual,
             coalesce(sum(case when lb.bucket in ('held', 'pre_encumbered', 'encumbered')
                               then lb.reporting_amount_minor end), 0)::text as committed
      from fiscal_periods fp
      left join ledger_balances lb on lb.fiscal_period_id = fp.id and lb.budget_id in (${uuidList(budgetIds)})
      where fp.fiscal_year_id = ${fiscalYearId}::uuid and fp.end_date <= ${endDate}::date
      group by fp.id, fp.label, fp.start_date
      order by fp.start_date, fp.id`);
    return res.rows.map((r) => ({
      periodId: r.period_id,
      label: r.label,
      startDate: r.start_date,
      actualMinor: Number(r.actual),
      committedMinor: Number(r.committed),
    }));
  }

  private async generationRow(tx: Tx, id: string): Promise<GenerationRow> {
    const [row] = await tx
      .select()
      .from(boardPackGenerations)
      .where(eq(boardPackGenerations.id, id));
    if (!row) throw ApiProblem.notFound('board pack generation');
    return row;
  }

  private async generationDto(tx: Tx, row: GenerationRow): Promise<BoardPackGeneration> {
    const name = row.requestedByPersonId
      ? (await tx.select().from(people).where(eq(people.id, row.requestedByPersonId)))[0]
          ?.displayName
      : null;
    const expired = row.status === 'ready' && row.expiresAt.getTime() < Date.now();
    return {
      id: row.id,
      status: expired ? 'expired' : row.status,
      source: {
        kind: row.sourceKind as 'close_snapshot' | 'open_period_draft',
        fiscalPeriodId: row.fiscalPeriodId,
        periodLabel: await this.periodLabel(tx, row.fiscalPeriodId),
        snapshotVersion: row.snapshotVersion,
        takenAt: row.snapshotTakenAt?.toISOString() ?? null,
        draft: row.draft,
        statement: row.draft
          ? 'Draft: the period is open and these figures can still change.'
          : 'Figures from the close snapshot of this period.',
      },
      pages: row.pages as BoardPackPageId[],
      formats: row.formats as ('pdf' | 'xlsx')[],
      constantCurrency: row.constantCurrency,
      currency: row.currency,
      pageCount: row.pageCount,
      rowCount: row.rowCount,
      files: (row.files as PackFile[]).map((f) => ({
        format: f.format,
        fileName: f.fileName,
        sizeBytes: f.sizeBytes,
        sha256: f.sha256,
      })),
      failedPage: (row.failedPage as BoardPackPageId | null) ?? null,
      error: row.error,
      requestedByName: name ?? null,
      requestedAt: row.requestedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  private async periodLabel(tx: Tx, periodId: string): Promise<string> {
    const res = await tx.execute<{ label: string }>(
      sql`select label from fiscal_periods where id = ${periodId}::uuid`,
    );
    return res.rows[0]?.label ?? '';
  }
}

interface PeriodPick extends Record<string, unknown> {
  id: string;
  label: string;
  start_date: string;
  end_date: string;
  status: string;
  fiscal_year_id: string;
}

export interface SnapshotTotals {
  legalEntityId: string | null;
  code: string;
  name: string;
  version: number;
  budgetCount: number;
  authorizedMinor: number;
  allocatedOutMinor: number;
  heldMinor: number;
  preEncumberedMinor: number;
  encumberedMinor: number;
  actualMinor: number;
  accruedMinor: number;
  takenAt: string;
}

const uuidList = (ids: readonly string[]) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

/**
 * Renders the pack. The PDF is a tagged-text document and the XLSX a workbook with one sheet per
 * page, both built from the same `BoardPack`, so what the preview shows is what the file carries.
 */
function renderPack(
  pack: BoardPack,
  format: 'pdf' | 'xlsx',
  periodId: string,
): { body: Buffer; contentType: string; fileName: string } {
  const safeLabel = pack.source.periodLabel.replace(/[^\w.-]+/g, '-').toLowerCase();
  if (format === 'pdf')
    return {
      body: renderPdf(pack),
      contentType: 'application/pdf',
      fileName: `board-pack-${safeLabel}.pdf`,
    };
  return {
    body: renderXlsx(pack, periodId),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileName: `board-pack-${safeLabel}.xlsx`,
  };
}

const pdfEscape = (s: string) => s.replace(/([\\()])/g, '\\$1');

/**
 * A minimal, valid single-stream PDF: the cover statement, then every page's title, columns and
 * rows as text lines. No dependency is added for it; the pack's numbers, not its typography, are
 * what finance sends to the board.
 */
function renderPdf(pack: BoardPack): Buffer {
  const lines: string[] = [
    pack.title,
    pack.source.statement,
    ...(pack.source.draft ? ['DRAFT'] : []),
    '',
  ];
  for (const page of pack.pages) {
    lines.push(`== ${page.title}${pack.source.draft ? ' (Draft)' : ''}`);
    if (page.statement) lines.push(page.statement);
    else {
      lines.push(page.columns.map((c) => c.label).join(' | '));
      for (const row of page.rows)
        lines.push(
          page.columns
            .map((c) => (c.key === 'label' ? row.label : cellText(row.cells[c.key])))
            .join(' | '),
        );
    }
    lines.push('');
  }
  lines.push(`FX bridge (${pack.fxBridge.reportingRateType}) \u2014 ${pack.fxBridge.note}`);
  for (const r of pack.fxBridge.rows)
    lines.push(
      `${r.transactionCurrency}: plan ${r.atPlanRate.amountMinor}, reported ${r.atReportingRate.amountMinor}, FX effect ${r.fxEffect.amountMinor}`,
    );
  lines.push(
    `Reconciles to the ledger: ${pack.reconciliation.ties ? 'yes' : `no, ${pack.reconciliation.differences.length} difference(s)`}`,
  );

  const content = lines
    .map((l, i) => `BT /F1 9 Tf 36 ${756 - i * 11} Td (${pdfEscape(l)}) Tj ET`)
    .join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

const cellText = (cell: BoardPackPage['rows'][number]['cells'][string] | undefined): string => {
  if (!cell) return '';
  if (cell.money) return String(cell.money.amountMinor);
  if (cell.bps !== null && cell.bps !== undefined) return `${(cell.bps / 100).toFixed(1)}%`;
  if (cell.number !== null && cell.number !== undefined) return String(cell.number);
  return cell.text ?? '';
};

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A stored (uncompressed) zip: an XLSX workbook with one sheet per page and the underlying rows. */
function renderXlsx(pack: BoardPack, periodId: string): Buffer {
  const sheets = pack.pages.map((page, i) => ({
    name: `${i + 1}-${page.page}`.slice(0, 31),
    rows: [
      [page.title],
      ...(page.statement
        ? [[page.statement]]
        : [
            page.columns.map((c) => c.label),
            ...page.rows.map((row) =>
              page.columns.map((c) => (c.key === 'label' ? row.label : cellText(row.cells[c.key]))),
            ),
          ]),
    ],
  }));
  sheets.push({
    name: 'fx-bridge',
    rows: [
      ['FX bridge', pack.fxBridge.reportingRateType, pack.fxBridge.note],
      ['Currency', 'Transaction', 'At plan rate', 'At reporting rate', 'FX effect', 'Plan rate'],
      ...pack.fxBridge.rows.map((r) => [
        r.transactionCurrency,
        String(r.transaction.amountMinor),
        String(r.atPlanRate.amountMinor),
        String(r.atReportingRate.amountMinor),
        String(r.fxEffect.amountMinor),
        r.planRate ?? '',
      ]),
    ],
  });
  const sheetXml = (rows: string[][]) =>
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
      .map(
        (cells, r) =>
          `<row r="${r + 1}">${cells
            .map(
              (v, c) =>
                `<c r="${colName(c)}${r + 1}" t="inlineStr"><is><t>${xmlEscape(v)}</t></is></c>`,
            )
            .join('')}</row>`,
      )
      .join('')}</sheetData></worksheet>`;
  const files: { name: string; body: Buffer }[] = [
    {
      name: '[Content_Types].xml',
      body: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
          .map(
            (_s, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join('')}</Types>`,
      ),
    },
    {
      name: '_rels/.rels',
      body: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
    },
    {
      name: 'xl/workbook.xml',
      body: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
          .map(
            (s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
          )
          .join('')}</sheets></workbook>`,
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      body: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
          .map(
            (_s, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
          )
          .join('')}</Relationships>`,
      ),
    },
    ...sheets.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      body: Buffer.from(sheetXml(s.rows)),
    })),
  ];
  // A fixed timestamp keyed to the period, so regenerating the same pack produces the same bytes.
  return zipStore(files, periodId);
}

const colName = (i: number): string => {
  let n = i;
  let name = '';
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return name;
};

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

const crc32 = (buf: Buffer): number => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** Zip with stored entries: enough for XLSX and it adds no dependency. */
function zipStore(files: readonly { name: string; body: Buffer }[], seed: string): Buffer {
  // A deterministic DOS timestamp derived from the seed: the same pack regenerates byte for byte.
  const stamp = [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 0xffff, 7);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name);
    const crc = crc32(f.body);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(stamp, 10);
    local.writeUInt16LE(stamp, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(f.body.length, 18);
    local.writeUInt32LE(f.body.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    locals.push(local, f.body);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(stamp, 12);
    central.writeUInt16LE(stamp, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(f.body.length, 20);
    central.writeUInt32LE(f.body.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length + f.body.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDirectory, end]);
}
