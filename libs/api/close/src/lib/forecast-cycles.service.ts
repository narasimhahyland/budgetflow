import { AuditService } from '@bf/api/audit';
import { ApiProblem, CommandRunner, DB, PolicyService, unwrap, type RequestActor } from '@bf/api/core';
import {
  budgets,
  forecastCycles,
  forecastSnapshots,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import { LedgerReads } from '@bf/api/ledger';
import type {
  CloseForecastCycleRequest,
  CreateForecastCycleRequest,
  ForecastCycle,
  ForecastCycleDetail,
  ForecastCycleTotals,
  ForecastDecisionRequest,
  ForecastSubmission,
  Money,
  ReportReconciliation,
  SubmitForecastRequest,
} from '@bf/contracts';
import {
  checkForecastDecision,
  checkForecastSubmission,
  commentaryRequired,
  forecastCloseConfirmationFor,
  forecastOptions,
  forecastVariance,
  requireConfirmation,
  runRateAmount,
  type ForecastFacts,
  type ForecastMethod,
  type ForecastStatus,
  type VarianceThreshold,
} from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { assertTenant, CloseReads, todayUtc, type CommandContext } from './close-reads';

/** A cycle line nobody has submitted yet has no stored snapshot; its id is the nil UUID. */
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

type CycleRow = typeof forecastCycles.$inferSelect;
type SnapshotRow = typeof forecastSnapshots.$inferSelect;
type BudgetRow = typeof budgets.$inferSelect;

/** Budgets a cycle covers: active money, never a cancelled or closed tree. */
const CYCLE_BUDGET_STATUSES = [
  'active',
  'partially_allocated',
  'fully_allocated',
  'approved',
  'frozen',
  'reduced',
  'set_to_zero',
  'exhausted',
] as const;

/** One line of a cycle: a budget, or an included open event, with the ledger facts behind it. */
interface CycleLine {
  key: string;
  label: string;
  budget: BudgetRow | null;
  eventId: string | null;
  eventName: string | null;
  eventCode: string | null;
  ownerPersonId: string | null;
  facts: ForecastFacts;
  snapshot: SnapshotRow | null;
}

const EVENT_LINE_STATUSES = ['approved', 'funded', 'in_progress'];

/**
 * Forecast cycles (87a): finance opens a round, owners pick a method per budget and explain the
 * variances above the cycle threshold, finance accepts or asks for more, and closing locks the set
 * that screen 087 and the board pack read.
 *
 * A forecast is never an actual. This service writes `forecast_snapshots` and nothing else: it posts
 * no journal, touches no ledger bucket and calls no ledger command, so a forecast can never consume
 * budget. The authorized, actual and committed figures it reports come from the ledger unchanged and
 * are reconciled against it on every read, which is how 087 proves the two sides agree.
 */
@Injectable()
export class ForecastCyclesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly reads: CloseReads,
    private readonly ledgerReads: LedgerReads,
  ) {}

  list(actor: RequestActor, query: { fiscalYearId?: string; status?: 'open' | 'closed' }) {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.assertCanRead(actor);
      const rows = await tx
        .select()
        .from(forecastCycles)
        .where(
          and(
            query.fiscalYearId ? eq(forecastCycles.fiscalYearId, query.fiscalYearId) : sql`true`,
            query.status ? eq(forecastCycles.status, query.status) : sql`true`,
          ),
        )
        // Newest first, then by name and id so two cycles opened in the same second never swap.
        .orderBy(desc(forecastCycles.asOfDate), desc(forecastCycles.createdAt), forecastCycles.name, forecastCycles.id);
      const items: ForecastCycle[] = [];
      for (const row of rows) items.push(await this.cycleDto(tx, row));
      return { items };
    });
  }

  get(actor: RequestActor, cycleId: string): Promise<ForecastCycleDetail> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.assertCanRead(actor);
      return this.detail(tx, actor, await this.cycleRow(tx, cycleId));
    });
  }

  create(actor: RequestActor, req: CreateForecastCycleRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'close.forecast_cycles.create',
        request: req,
        status: 201,
      },
      async (tx) => {
        assertTenant(this.policy, actor, 'forecast.manage');
        if (req.dueDate < req.asOfDate)
          throw new ApiProblem(
            422,
            'VALIDATION_FAILED',
            'The due date cannot be before the as-of date.',
          );
        const fy = req.fiscalYearId
          ? await this.reads.fiscalYear(tx, req.fiscalYearId)
          : await this.fiscalYearOn(tx, req.asOfDate);
        let scopeRoot: BudgetRow | null = null;
        if (req.rootBudgetId) {
          const [row] = await tx.select().from(budgets).where(eq(budgets.id, req.rootBudgetId));
          if (!row) throw ApiProblem.notFound('budget');
          scopeRoot = row;
        }
        const duplicate = await tx
          .select({ id: forecastCycles.id })
          .from(forecastCycles)
          .where(eq(forecastCycles.name, req.name));
        if (duplicate.length)
          throw new ApiProblem(
            409,
            'DUPLICATE_CODE',
            `A forecast cycle called "${req.name}" already exists.`,
          );
        const [row] = await tx
          .insert(forecastCycles)
          .values({
            tenantId: actor.tenantId,
            name: req.name,
            asOfDate: req.asOfDate,
            dueDate: req.dueDate,
            fiscalYearId: fy.id,
            scopeRootBudgetId: scopeRoot?.id ?? null,
            currency: actor.reportingCurrency,
            varianceThresholdBps: req.varianceThresholdBps ?? 1_000,
            varianceThresholdMinor: req.varianceThresholdMinor ?? 100_000,
            defaultMethodOperating: req.defaultMethodOperating ?? 'run_rate',
            defaultMethodEvent: req.defaultMethodEvent ?? 'committed_pipeline',
            includeOpenEvents: req.includeOpenEvents ?? true,
            reminderDaysBefore: req.reminderDaysBefore ?? [3, 1],
            createdBy: actor.personId,
          })
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'forecast.cycle_opened',
          resourceType: 'forecast_cycle',
          resourceId: row.id,
          requestId: ctx.requestId,
          changes: {
            name: { from: null, to: row.name },
            asOfDate: { from: null, to: row.asOfDate },
            dueDate: { from: null, to: row.dueDate },
            scopeRootBudgetId: { from: null, to: row.scopeRootBudgetId },
            varianceThresholdBps: { from: null, to: row.varianceThresholdBps },
            varianceThresholdMinor: { from: null, to: row.varianceThresholdMinor },
          },
        });
        return this.detail(tx, actor, row);
      },
    );
  }

  /** Saves a draft or submits one line. The owner picks the method; the API computes the amount. */
  submit(actor: RequestActor, cycleId: string, req: SubmitForecastRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `close.forecast_cycles.submit:${cycleId}`,
        request: req,
        status: 201,
      },
      async (tx) => {
        if ((req.budgetId ? 1 : 0) + (req.eventId ? 1 : 0) !== 1)
          throw new ApiProblem(
            422,
            'VALIDATION_FAILED',
            'Give exactly one of budgetId or eventId.',
          );
        const cycle = await this.cycleRow(tx, cycleId, true);
        const lines = await this.lines(tx, cycle);
        const line = lines.find((l) =>
          req.budgetId ? l.budget?.id === req.budgetId && !l.eventId : l.eventId === req.eventId,
        );
        if (!line)
          throw new ApiProblem(
            404,
            'FORECAST_NOT_IN_SCOPE',
            'That budget or event is not part of this forecast cycle.',
          );
        this.assertCanSubmit(actor, line);
        const outcome = unwrap(
          checkForecastSubmission({
            cycleStatus: cycle.status,
            currentStatus: (line.snapshot?.status ?? 'draft') as ForecastStatus,
            method: req.method,
            ownerAmountMinor: req.amountMinor ?? null,
            commentary: req.commentary ?? null,
            submit: req.submit ?? true,
            facts: line.facts,
            threshold: thresholdOf(cycle),
          }),
        );
        const now = new Date();
        const values = {
          tenantId: actor.tenantId,
          cycleId: cycle.id,
          budgetId: line.budget && !line.eventId ? line.budget.id : null,
          eventId: line.eventId,
          method: req.method,
          asOfDate: cycle.asOfDate,
          amountMinor: outcome.amountMinor,
          currency: cycle.currency,
          varianceBps: outcome.variance.varianceBps,
          varianceMinor: outcome.variance.varianceMinor,
          commentary: req.commentary?.trim() ?? line.snapshot?.commentary ?? null,
          commentaryRequired: outcome.commentaryRequired,
          status: outcome.nextStatus,
          authorizedMinor: line.facts.authorizedMinor,
          actualMinor: line.facts.actualMinor,
          committedMinor:
            line.facts.heldMinor + line.facts.preEncumberedMinor + line.facts.encumberedMinor,
          pendingMinor: line.facts.preEncumberedMinor,
          plannedEventsMinor: line.facts.plannedEventsMinor,
          systemGenerated: false,
          submittedAt: outcome.nextStatus === 'submitted' ? now : (line.snapshot?.submittedAt ?? null),
          updatedAt: now,
        };
        const [row] = line.snapshot
          ? await tx
              .update(forecastSnapshots)
              .set(values)
              .where(eq(forecastSnapshots.id, line.snapshot.id))
              .returning()
          : await tx
              .insert(forecastSnapshots)
              .values({ ...values, createdBy: actor.personId })
              .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: outcome.nextStatus === 'submitted' ? 'forecast.submitted' : 'forecast.draft_saved',
          resourceType: 'forecast_snapshot',
          resourceId: row.id,
          legalEntityId: line.budget?.legalEntityId ?? null,
          requestId: ctx.requestId,
          reason: row.commentary,
          changes: {
            cycleId: { from: null, to: cycle.id },
            budgetId: { from: null, to: row.budgetId },
            eventId: { from: null, to: row.eventId },
            method: { from: line.snapshot?.method ?? null, to: row.method },
            amountMinor: { from: line.snapshot?.amountMinor ?? null, to: row.amountMinor },
            status: { from: line.snapshot?.status ?? null, to: row.status },
            varianceMinor: { from: null, to: row.varianceMinor },
          },
        });
        return this.submissionDto(tx, cycle, { ...line, snapshot: row });
      },
    );
  }

  /** Finance accepts a submitted line, or sends it back with a note asking for commentary. */
  decide(
    actor: RequestActor,
    cycleId: string,
    submissionId: string,
    req: ForecastDecisionRequest,
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `close.forecast_cycles.decide:${submissionId}`,
        request: req,
        status: 201,
      },
      async (tx) => {
        assertTenant(this.policy, actor, 'forecast.manage');
        const cycle = await this.cycleRow(tx, cycleId, true);
        const [snapshot] = await tx
          .select()
          .from(forecastSnapshots)
          .where(and(eq(forecastSnapshots.id, submissionId), eq(forecastSnapshots.cycleId, cycle.id)))
          .for('update');
        if (!snapshot) throw ApiProblem.notFound('forecast submission');
        if (req.decision === 'request_commentary' && !req.note?.trim())
          throw new ApiProblem(
            422,
            'REASON_REQUIRED',
            'Say what the owner should explain when you ask for commentary.',
          );
        const next = unwrap(
          checkForecastDecision(cycle.status, snapshot.status as ForecastStatus, req.decision),
        );
        const now = new Date();
        const [row] = await tx
          .update(forecastSnapshots)
          .set({
            status: next,
            commentaryNote: req.decision === 'request_commentary' ? (req.note ?? null) : snapshot.commentaryNote,
            acceptedAt: next === 'accepted' ? now : null,
            acceptedBy: next === 'accepted' ? actor.personId : null,
            updatedAt: now,
          })
          .where(eq(forecastSnapshots.id, snapshot.id))
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: next === 'accepted' ? 'forecast.accepted' : 'forecast.commentary_requested',
          resourceType: 'forecast_snapshot',
          resourceId: row.id,
          requestId: ctx.requestId,
          reason: req.note ?? null,
          changes: {
            status: { from: snapshot.status, to: next },
            amountMinor: { from: null, to: row.amountMinor },
          },
        });
        const lines = await this.lines(tx, cycle);
        const line =
          lines.find((l) => l.snapshot?.id === row.id) ??
          lines.find((l) => (row.budgetId ? l.budget?.id === row.budgetId : l.eventId === row.eventId));
        if (!line) throw ApiProblem.notFound('forecast submission');
        return this.submissionDto(tx, cycle, { ...line, snapshot: row });
      },
    );
  }

  /**
   * Closes the cycle: submitted lines are accepted as they are, every budget nobody submitted gets
   * a system run-rate forecast marked System rather than leaving a gap in the report, and the
   * previous cycle's snapshots are superseded. Nothing posts.
   */
  close(actor: RequestActor, cycleId: string, req: CloseForecastCycleRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `close.forecast_cycles.close:${cycleId}`,
        request: req,
        status: 201,
      },
      async (tx) => {
        assertTenant(this.policy, actor, 'forecast.manage');
        const cycle = await this.cycleRow(tx, cycleId, true);
        if (cycle.status === 'closed')
          throw new ApiProblem(
            409,
            'FORECAST_CYCLE_CLOSED',
            'This forecast cycle is already closed.',
          );
        unwrap(requireConfirmation(req.confirmation, forecastCloseConfirmationFor(cycle.name)));
        const lines = await this.lines(tx, cycle);
        const now = new Date();
        const threshold = thresholdOf(cycle);
        let accepted = 0;
        let systemWritten = 0;
        for (const line of [...lines].sort((a, b) => a.key.localeCompare(b.key))) {
          if (line.snapshot) {
            if (line.snapshot.status === 'accepted') continue;
            await tx
              .update(forecastSnapshots)
              .set({ status: 'accepted', acceptedAt: now, acceptedBy: actor.personId, updatedAt: now })
              .where(eq(forecastSnapshots.id, line.snapshot.id));
            accepted += 1;
            continue;
          }
          // Nobody submitted: the system run-rate stands in, marked so the report can label it.
          const amountMinor = runRateAmount(line.facts);
          const variance = forecastVariance(line.facts.authorizedMinor, amountMinor);
          await tx.insert(forecastSnapshots).values({
            tenantId: actor.tenantId,
            cycleId: cycle.id,
            budgetId: line.budget && !line.eventId ? line.budget.id : null,
            eventId: line.eventId,
            method: 'run_rate',
            asOfDate: cycle.asOfDate,
            amountMinor,
            currency: cycle.currency,
            varianceBps: variance.varianceBps,
            varianceMinor: variance.varianceMinor,
            commentaryRequired: commentaryRequired(variance, threshold),
            status: 'accepted',
            authorizedMinor: line.facts.authorizedMinor,
            actualMinor: line.facts.actualMinor,
            committedMinor:
              line.facts.heldMinor + line.facts.preEncumberedMinor + line.facts.encumberedMinor,
            pendingMinor: line.facts.preEncumberedMinor,
            plannedEventsMinor: line.facts.plannedEventsMinor,
            systemGenerated: true,
            acceptedAt: now,
            acceptedBy: actor.personId,
            createdBy: null,
            updatedAt: now,
          });
          systemWritten += 1;
        }
        // Earlier cycles of the same fiscal year are history now, so 087's "latest accepted" is one set.
        const superseded = await tx
          .update(forecastSnapshots)
          .set({ status: 'superseded', updatedAt: now })
          .where(
            and(
              eq(forecastSnapshots.status, 'accepted'),
              sql`${forecastSnapshots.cycleId} is not null`,
              sql`${forecastSnapshots.cycleId} <> ${cycle.id}::uuid`,
              sql`${forecastSnapshots.cycleId} in (
                select id from forecast_cycles
                where fiscal_year_id = ${cycle.fiscalYearId}::uuid and as_of_date <= ${cycle.asOfDate}
              )`,
            ),
          )
          .returning({ id: forecastSnapshots.id });
        const [closed] = await tx
          .update(forecastCycles)
          .set({ status: 'closed', closedAt: now, closedBy: actor.personId })
          .where(eq(forecastCycles.id, cycle.id))
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'forecast.cycle_closed',
          resourceType: 'forecast_cycle',
          resourceId: cycle.id,
          requestId: ctx.requestId,
          changes: {
            status: { from: cycle.status, to: 'closed' },
            acceptedOnClose: { from: null, to: accepted },
            systemForecastsWritten: { from: null, to: systemWritten },
            supersededSnapshots: { from: null, to: superseded.length },
          },
        });
        return this.detail(tx, actor, closed);
      },
    );
  }

  // Reads -----------------------------------------------------------------------------------------

  private assertCanRead(actor: RequestActor): void {
    if (this.policy.can(actor, 'report.read', { kind: 'tenant', tenantId: actor.tenantId }).allowed)
      return;
    if (
      this.policy.can(actor, 'forecast.submit', { kind: 'tenant', tenantId: actor.tenantId }).allowed
    )
      return;
    throw ApiProblem.forbidden('Forecast cycles are for finance roles and budget owners.');
  }

  /**
   * Submitting is scoped to the budget the line belongs to, so an owner forecasts their own subtree
   * and nobody else's. An event funded only through contributions has no budget of its own; only
   * finance may forecast it.
   */
  private assertCanSubmit(actor: RequestActor, line: CycleLine): void {
    if (!line.budget) {
      this.policy.assert(
        actor,
        'forecast.manage',
        { kind: 'tenant', tenantId: actor.tenantId },
        'forecast cycle',
      );
      return;
    }
    this.policy.assert(
      actor,
      'forecast.submit',
      {
        kind: 'budget',
        tenantId: actor.tenantId,
        id: line.budget.id,
        path: line.budget.path,
      },
      'budget',
    );
  }

  private canSeeLine(actor: RequestActor, line: CycleLine): boolean {
    if (!line.budget) return this.tenantWide(actor);
    return this.policy.can(actor, 'budget.read', {
      kind: 'budget',
      tenantId: actor.tenantId,
      id: line.budget.id,
      path: line.budget.path,
    }).allowed;
  }

  private tenantWide(actor: RequestActor): boolean {
    return this.policy.can(actor, 'report.read', {
      kind: 'budget',
      tenantId: actor.tenantId,
      id: '',
      path: '/',
    }).allowed;
  }

  private async cycleRow(tx: Tx, id: string, lock = false): Promise<CycleRow> {
    const q = tx.select().from(forecastCycles).where(eq(forecastCycles.id, id));
    const [row] = lock ? await q.for('update') : await q;
    if (!row) throw ApiProblem.notFound('forecast cycle');
    return row;
  }

  private async fiscalYearOn(tx: Tx, date: string) {
    const rows = await tx.execute<{ id: string }>(
      sql`select id from fiscal_years where start_date <= ${date} and end_date >= ${date} order by start_date limit 1`,
    );
    const id = rows.rows[0]?.id;
    if (!id)
      throw new ApiProblem(
        422,
        'VALIDATION_FAILED',
        `No fiscal year contains ${date}; pick an as-of date inside a fiscal year.`,
      );
    return this.reads.fiscalYear(tx, id);
  }

  /**
   * Every line of the cycle with its ledger facts: the budgets in scope, and the open events when
   * the cycle includes them. Ordered by label then key, so tied rows never change places between
   * two runs.
   */
  private async lines(tx: Tx, cycle: CycleRow): Promise<CycleLine[]> {
    const scopeRoot = cycle.scopeRootBudgetId
      ? (await tx.select().from(budgets).where(eq(budgets.id, cycle.scopeRootBudgetId)))[0]
      : undefined;
    const rows = await tx
      .select()
      .from(budgets)
      .where(
        and(
          eq(budgets.fiscalYearId, cycle.fiscalYearId),
          inArray(budgets.status, [...CYCLE_BUDGET_STATUSES]),
          scopeRoot ? sql`left(${budgets.path}, ${scopeRoot.path.length}) = ${scopeRoot.path}` : sql`true`,
        ),
      );
    const balances = await this.ledgerReads.balances(
      tx,
      rows.map((r) => r.id),
    );
    const elapsedBps = await this.elapsedBps(tx, cycle);
    const planned = await this.plannedEventMoney(tx, rows.map((r) => r.id));
    const snapshots = await tx
      .select()
      .from(forecastSnapshots)
      .where(eq(forecastSnapshots.cycleId, cycle.id));
    const byBudget = new Map(
      snapshots.filter((s) => s.budgetId && !s.eventId).map((s) => [s.budgetId!, s]),
    );
    const byEvent = new Map(snapshots.filter((s) => s.eventId).map((s) => [s.eventId!, s]));

    const lines: CycleLine[] = rows.map((row) => {
      const bal = balances.get(row.id)!.reporting;
      return {
        key: `budget:${row.id}`,
        label: row.name,
        budget: row,
        eventId: null,
        eventName: null,
        eventCode: null,
        ownerPersonId: row.ownerPersonId,
        facts: {
          authorizedMinor: bal.authorized - bal.allocated_out,
          heldMinor: bal.held,
          preEncumberedMinor: bal.pre_encumbered,
          encumberedMinor: bal.encumbered,
          actualMinor: bal.actual,
          plannedEventsMinor: planned.get(row.id) ?? 0,
          elapsedBps,
        },
        snapshot: byBudget.get(row.id) ?? null,
      };
    });

    if (cycle.includeOpenEvents && rows.length) {
      const events = await this.openEvents(tx, rows.map((r) => r.id));
      const budgetById = new Map(rows.map((r) => [r.id, r]));
      for (const e of events) {
        lines.push({
          key: `event:${e.id}`,
          label: `${e.name} (${e.eventCode})`,
          budget: e.budgetId ? (budgetById.get(e.budgetId) ?? null) : null,
          eventId: e.id,
          eventName: e.name,
          eventCode: e.eventCode,
          ownerPersonId: e.organizerPersonId,
          facts: {
            // Forecast at completion: funded money is the ceiling, commitments and actuals the floor.
            authorizedMinor: e.fundedMinor,
            heldMinor: 0,
            preEncumberedMinor: e.preEncumberedMinor,
            encumberedMinor: e.encumberedMinor,
            actualMinor: e.actualMinor,
            plannedEventsMinor: 0,
            elapsedBps,
          },
          snapshot: byEvent.get(e.id) ?? null,
        });
      }
    }
    return lines.sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
  }

  /** How far through the fiscal year the cycle's as-of date is, in basis points. */
  private async elapsedBps(tx: Tx, cycle: CycleRow): Promise<number> {
    const fy = await this.reads.fiscalYear(tx, cycle.fiscalYearId);
    const day = 24 * 60 * 60 * 1000;
    const start = Date.parse(`${fy.startDate}T00:00:00Z`);
    const end = Date.parse(`${fy.endDate}T00:00:00Z`);
    const asOf = Date.parse(`${cycle.asOfDate}T00:00:00Z`);
    const span = Math.max(end - start, day);
    const elapsed = Math.min(Math.max(asOf - start, 0), span);
    return Math.round((elapsed * 10_000) / span);
  }

  /**
   * Money an approved event will still spend from a budget: what it was funded minus what it has
   * already committed or spent. Floored at zero, so a fully committed event adds nothing twice.
   */
  private async plannedEventMoney(
    tx: Tx,
    budgetIds: readonly string[],
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!budgetIds.length) return out;
    const res = await tx.execute<{ budget_id: string; planned: string }>(sql`
      select fs.budget_id,
             greatest(sum(fs.funded_minor - fs.returned_minor) - coalesce(sum(spent.amount), 0), 0)::text as planned
      from event_funding_sources fs
      join events e on e.id = fs.event_id
      left join lateral (
        select sum(l.reporting_amount_minor) as amount
        from ledger_lines l
        where l.event_code = e.event_code and l.budget_id = fs.budget_id
          and l.account in ('pre_encumbered', 'encumbered', 'actual')
      ) spent on true
      where fs.budget_id in (${sql.join(
        budgetIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
        and e.status in (${sql.join(
          EVENT_LINE_STATUSES.map((s) => sql`${s}`),
          sql`, `,
        )})
      group by fs.budget_id`);
    for (const r of res.rows) out.set(r.budget_id, Number(r.planned));
    return out;
  }

  /** Open events funded by budgets in scope, with their funding and ledger money. */
  private async openEvents(tx: Tx, budgetIds: readonly string[]) {
    const ids = sql.join(
      budgetIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const res = await tx.execute<{
      id: string;
      name: string;
      event_code: string;
      budget_id: string | null;
      organizer_person_id: string | null;
      funded: string;
      pre_encumbered: string;
      encumbered: string;
      actual: string;
    }>(sql`
      select e.id, e.name, e.event_code, e.budget_id, e.organizer_person_id,
             coalesce((select sum(fs.funded_minor - fs.returned_minor) from event_funding_sources fs
                        where fs.event_id = e.id), 0)::text as funded,
             coalesce((select sum(l.reporting_amount_minor) from ledger_lines l
                        where l.event_code = e.event_code and l.account = 'pre_encumbered'), 0)::text as pre_encumbered,
             coalesce((select sum(l.reporting_amount_minor) from ledger_lines l
                        where l.event_code = e.event_code and l.account = 'encumbered'), 0)::text as encumbered,
             coalesce((select sum(l.reporting_amount_minor) from ledger_lines l
                        where l.event_code = e.event_code and l.account = 'actual'), 0)::text as actual
      from events e
      where e.status in (${sql.join(
        EVENT_LINE_STATUSES.map((s) => sql`${s}`),
        sql`, `,
      )})
        and (e.budget_id in (${ids})
             or exists (select 1 from event_funding_sources fs
                        where fs.event_id = e.id and fs.budget_id in (${ids})))
      order by e.name, e.id`);
    return res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      eventCode: r.event_code,
      budgetId: r.budget_id,
      organizerPersonId: r.organizer_person_id,
      fundedMinor: Number(r.funded),
      preEncumberedMinor: Number(r.pre_encumbered),
      encumberedMinor: Number(r.encumbered),
      actualMinor: Number(r.actual),
    }));
  }

  private async detail(tx: Tx, actor: RequestActor, cycle: CycleRow): Promise<ForecastCycleDetail> {
    const all = await this.lines(tx, cycle);
    const visible = all.filter((l) => this.canSeeLine(actor, l));
    const submissions: ForecastSubmission[] = [];
    for (const line of visible) submissions.push(await this.submissionDto(tx, cycle, line));
    const tenantWide = this.tenantWide(actor);
    const money = (amountMinor: number): Money => ({ amountMinor, currency: cycle.currency });
    const budgetLines = visible.filter((l) => !l.eventId);
    const totals = sumTotals(submissions, cycle.currency);
    const allowedActions: ForecastCycleDetail['allowedActions'] = [];
    if (cycle.status === 'open') {
      if (
        this.policy.can(actor, 'forecast.submit', { kind: 'tenant', tenantId: actor.tenantId })
          .allowed
      )
        allowedActions.push('submit');
      if (
        this.policy.can(actor, 'forecast.manage', { kind: 'tenant', tenantId: actor.tenantId })
          .allowed
      )
        allowedActions.push('accept', 'request_commentary', 'close');
    }
    return {
      cycle: await this.cycleDto(tx, cycle, all),
      scope: {
        tenantWide,
        label: tenantWide ? actor.tenantName : scopeLabelOf(budgetLines),
        budgetIds: budgetLines.length,
        note: tenantWide ? null : 'Showing budgets you can see.',
      },
      submissions,
      totals,
      reconciliation: reconcile(budgetLines, submissions, money),
      allowedActions,
    };
  }

  private async cycleDto(tx: Tx, row: CycleRow, lines?: CycleLine[]): Promise<ForecastCycle> {
    const all = lines ?? (await this.lines(tx, row));
    const names = await this.reads.names(tx, [row.createdBy, row.closedBy]);
    const fy = await this.reads.fiscalYear(tx, row.fiscalYearId);
    const scopeRoot = row.scopeRootBudgetId
      ? (await tx.select().from(budgets).where(eq(budgets.id, row.scopeRootBudgetId)))[0]
      : undefined;
    const today = todayUtc();
    const count = (f: (l: CycleLine) => boolean) => all.filter(f).length;
    return {
      id: row.id,
      name: row.name,
      asOfDate: row.asOfDate,
      dueDate: row.dueDate,
      fiscalYearId: row.fiscalYearId,
      fiscalYearLabel: fy.label,
      scopeRootBudgetId: row.scopeRootBudgetId,
      scopeLabel: scopeRoot ? `${scopeRoot.name} and below` : 'All active budgets',
      status: row.status,
      currency: row.currency,
      varianceThresholdBps: row.varianceThresholdBps,
      varianceThreshold: { amountMinor: row.varianceThresholdMinor, currency: row.currency },
      defaultMethodOperating: row.defaultMethodOperating,
      defaultMethodEvent: row.defaultMethodEvent,
      includeOpenEvents: row.includeOpenEvents,
      reminderDaysBefore: row.reminderDaysBefore,
      progress: {
        budgets: all.length,
        notStarted: count((l) => !l.snapshot),
        draft: count((l) => l.snapshot?.status === 'draft'),
        submitted: count((l) => l.snapshot?.status === 'submitted'),
        commentaryRequired: count((l) => l.snapshot?.status === 'commentary_required'),
        accepted: count((l) => l.snapshot?.status === 'accepted'),
        overdue:
          row.status === 'open' && row.dueDate < today
            ? count((l) => !l.snapshot || l.snapshot.status === 'draft')
            : 0,
      },
      createdByName: row.createdBy ? (names.get(row.createdBy) ?? null) : null,
      createdAt: row.createdAt.toISOString(),
      closedAt: row.closedAt?.toISOString() ?? null,
      closedByName: row.closedBy ? (names.get(row.closedBy) ?? null) : null,
      closeConfirmation: forecastCloseConfirmationFor(row.name),
    };
  }

  private async submissionDto(
    tx: Tx,
    cycle: CycleRow,
    line: CycleLine,
  ): Promise<ForecastSubmission> {
    const names = await this.reads.names(tx, [line.ownerPersonId, line.snapshot?.acceptedBy ?? null]);
    const money = (amountMinor: number): Money => ({ amountMinor, currency: cycle.currency });
    const threshold = thresholdOf(cycle);
    const options = forecastOptions(line.facts);
    const defaultMethod: ForecastMethod = line.eventId
      ? cycle.defaultMethodEvent
      : cycle.defaultMethodOperating;
    const method = (line.snapshot?.method ?? defaultMethod) as ForecastMethod;
    // The forecast is whatever was submitted; an untouched line previews the cycle's default method
    // so an owner always opens a filled-in starting point.
    const amountMinor =
      line.snapshot?.amountMinor ??
      (options.find((o) => o.method === method)?.amountMinor ?? runRateAmount(line.facts));
    // The ledger columns are read live from the ledger, never from the snapshot, so the monitor
    // reconciles to the ledger on every read and the variance is the one finance has to act on now.
    // The snapshot keeps its own copy of what the owner saw; the audit entry is the record of that.
    const facts = line.facts;
    const variance = forecastVariance(facts.authorizedMinor, amountMinor);
    return {
      // A line nobody has touched has no snapshot row yet; the nil UUID says "nothing stored".
      id: line.snapshot?.id ?? NIL_UUID,
      cycleId: cycle.id,
      budgetId: line.eventId ? null : (line.budget?.id ?? null),
      budgetName: line.eventId ? null : (line.budget?.name ?? null),
      eventId: line.eventId,
      eventName: line.eventName,
      eventCode: line.eventCode,
      ownerPersonId: line.ownerPersonId,
      ownerName: line.ownerPersonId ? (names.get(line.ownerPersonId) ?? null) : null,
      authorized: money(facts.authorizedMinor),
      actualToDate: money(facts.actualMinor),
      committed: money(facts.heldMinor + facts.preEncumberedMinor + facts.encumberedMinor),
      pending: money(facts.preEncumberedMinor),
      plannedEvents: money(facts.plannedEventsMinor),
      forecast: money(amountMinor),
      method,
      methodOptions: options.map((o) => ({
        method: o.method,
        amount: money(o.amountMinor),
        explanation: o.explanation,
      })),
      variance: money(variance.varianceMinor),
      varianceBps: variance.varianceBps,
      varianceDirection: variance.direction,
      commentaryRequired: commentaryRequired(variance, threshold),
      commentary: line.snapshot?.commentary ?? null,
      commentaryNote: line.snapshot?.commentaryNote ?? null,
      status: (line.snapshot?.status ?? 'draft') as ForecastStatus,
      systemGenerated: line.snapshot?.systemGenerated ?? false,
      submittedAt: line.snapshot?.submittedAt?.toISOString() ?? null,
      acceptedAt: line.snapshot?.acceptedAt?.toISOString() ?? null,
      acceptedByName: line.snapshot?.acceptedBy
        ? (names.get(line.snapshot.acceptedBy) ?? null)
        : null,
      updatedAt: (line.snapshot?.updatedAt ?? line.snapshot?.createdAt ?? new Date()).toISOString(),
    };
  }
}

const thresholdOf = (cycle: CycleRow): VarianceThreshold => ({
  bps: cycle.varianceThresholdBps,
  minor: cycle.varianceThresholdMinor,
});

function scopeLabelOf(lines: readonly CycleLine[]): string {
  const tops = lines
    .filter(
      (l) =>
        l.budget &&
        !lines.some(
          (o) => o.budget && o.budget.id !== l.budget!.id && l.budget!.path.startsWith(o.budget.path),
        ),
    )
    .map((l) => l.budget!.name)
    .sort((a, b) => a.localeCompare(b));
  return tops.length ? `${tops.join(', ')} and below` : 'No budgets you can see';
}

function sumTotals(
  submissions: readonly ForecastSubmission[],
  currency: string,
): ForecastCycleTotals {
  const budgetRows = submissions.filter((s) => s.budgetId !== null && s.eventId === null);
  const sum = (pick: (s: ForecastSubmission) => number) =>
    budgetRows.reduce((acc, s) => acc + pick(s), 0);
  const authorized = sum((s) => s.authorized.amountMinor);
  const forecast = sum((s) => s.forecast.amountMinor);
  return {
    authorized: { amountMinor: authorized, currency },
    actualToDate: { amountMinor: sum((s) => s.actualToDate.amountMinor), currency },
    committed: { amountMinor: sum((s) => s.committed.amountMinor), currency },
    forecast: { amountMinor: forecast, currency },
    variance: { amountMinor: authorized - forecast, currency },
    varianceBps: authorized > 0 ? Math.round(((authorized - forecast) * 10_000) / authorized) : 0,
  };
}

/**
 * The ledger behind the authorized, committed and actual columns of the monitor. Forecast is
 * deliberately absent: a forecast posts nothing, so there is no bucket for it to tie to, and a
 * difference on the columns that do tie is reported rather than absorbed.
 */
function reconcile(
  lines: readonly CycleLine[],
  submissions: readonly ForecastSubmission[],
  money: (amountMinor: number) => Money,
): ReportReconciliation {
  const totals = lines.reduce(
    (t, l) => ({
      authorized: t.authorized + l.facts.authorizedMinor,
      held: t.held + l.facts.heldMinor,
      preEncumbered: t.preEncumbered + l.facts.preEncumberedMinor,
      encumbered: t.encumbered + l.facts.encumberedMinor,
      actual: t.actual + l.facts.actualMinor,
    }),
    { authorized: 0, held: 0, preEncumbered: 0, encumbered: 0, actual: 0 },
  );
  const available =
    totals.authorized - totals.held - totals.preEncumbered - totals.encumbered - totals.actual;
  const budgetRows = submissions.filter((s) => s.budgetId !== null && s.eventId === null);
  const reported = {
    authorized: budgetRows.reduce((s, r) => s + r.authorized.amountMinor, 0),
    actual: budgetRows.reduce((s, r) => s + r.actualToDate.amountMinor, 0),
    committed: budgetRows.reduce((s, r) => s + r.committed.amountMinor, 0),
  };
  const differences: { key: string; expected: Money; actual: Money }[] = [];
  const check = (key: string, expected: number, got: number) => {
    if (expected !== got) differences.push({ key, expected: money(expected), actual: money(got) });
  };
  check('authorized', totals.authorized, reported.authorized);
  check('actual', totals.actual, reported.actual);
  check('committed', totals.held + totals.preEncumbered + totals.encumbered, reported.committed);
  return {
    source: 'ledger_balances',
    budgetsCounted: lines.length,
    authorized: money(totals.authorized),
    held: money(totals.held),
    preEncumbered: money(totals.preEncumbered),
    encumbered: money(totals.encumbered),
    actual: money(totals.actual),
    accrued: money(0),
    available: money(available),
    ties: differences.length === 0,
    differences,
  };
}
