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
  budgetChangeRequests,
  budgets,
  reasonCodes,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import { LedgerReads, LedgerService, toPostingBudget } from '@bf/api/ledger';
import { AnalyticsService } from '@bf/api/tenancy';
import type {
  ControlImpact,
  ControlPreviewRequest,
  ControlResult,
  FreezeRequest,
  ReduceRequest,
  RestoreRequest,
  SetToZeroRequest,
  TransferRequest,
  TransferResult,
  UnfreezeRequest,
} from '@bf/contracts';
import {
  acceptsNewActivity,
  availableOf,
  budgetMachine,
  CONSUMING_BUCKETS,
  pendingRequestPolicy,
  postHierarchyMove,
  previewReduction,
  reductionFloor,
  unfitPendingRequests,
  validateReduction,
  type BucketBalances,
  type PendingRequestAmount,
  type BudgetStatus,
  type CurrencyCode,
  type HierarchyDestination,
  type ReductionDestination,
} from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { budgetResource, BudgetViews, type BudgetRow, type CommandContext } from './budget-views';

type ControlEventAction = 'frozen' | 'unfrozen' | 'reduced' | 'set_to_zero' | 'restored';

interface ZeroPlanItem {
  row: BudgetRow;
  balances: BucketBalances;
  retainedMinor: number;
  reductionMinor: number;
}

/** Freeze, reduce, set to zero, restore and transfer: floors, destinations, cascade, impact, outbox events. */
@Injectable()
export class ControlsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly reads: LedgerReads,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly views: BudgetViews,
    private readonly analytics: AnalyticsService,
  ) {}

  private async loadForControl(tx: Tx, actor: RequestActor, id: string) {
    const row = await this.views.row(tx, id);
    const parent = row.parentId ? await this.views.row(tx, row.parentId) : undefined;
    this.views.assertControl(actor, row, parent);
    return { row, parent };
  }

  private async subtree(tx: Tx, row: BudgetRow): Promise<BudgetRow[]> {
    return tx
      .select()
      .from(budgets)
      .where(like(budgets.path, `${row.path}%`));
  }

  /** Locks the budget (and its subtree when cascading) and re-reads it, so status checks see committed changes. */
  private async lockedRows(
    tx: Tx,
    row: BudgetRow,
    cascade: boolean,
  ): Promise<{ row: BudgetRow; rows: BudgetRow[] }> {
    const before = cascade ? await this.subtree(tx, row) : [row];
    await this.reads.lockBudgets(
      tx,
      before.map((r) => r.id),
    );
    const fresh = await this.reads.budgetRows(
      tx,
      before.map((r) => r.id),
    );
    const rows = before.map((r) => fresh.get(r.id)!);
    return { row: fresh.get(row.id)!, rows };
  }

  /**
   * Set to zero with cascade, bottom-up: each budget below keeps its own floor (held + encumbered +
   * actual + what its children keep) and returns the rest to its parent.
   */
  private async zeroPlan(tx: Tx, row: BudgetRow, cascade: boolean): Promise<ZeroPlanItem[]> {
    const rows = cascade ? await this.subtree(tx, row) : [row];
    const balances = await this.reads.balances(
      tx,
      rows.map((r) => r.id),
    );
    const items = new Map<string, ZeroPlanItem>();
    for (const r of [...rows].sort((a, b) => b.depth - a.depth)) {
      const b = balances.get(r.id)!.budget;
      const kids = [...items.values()].filter((i) => i.row.parentId === r.id);
      const retainedByKids = kids.reduce((s, k) => s + k.retainedMinor, 0);
      const floor = reductionFloor(b, cascade, retainedByKids);
      items.set(r.id, {
        row: r,
        balances: b,
        retainedMinor: Math.min(floor, b.authorized),
        reductionMinor: Math.max(b.authorized - floor, 0),
      });
    }
    return [...items.values()].sort((a, b) => b.row.depth - a.row.depth);
  }

  async preview(
    actor: RequestActor,
    id: string,
    req: ControlPreviewRequest,
  ): Promise<ControlImpact> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const { row } = await this.loadForControl(tx, actor, id);
      return this.impact(tx, row, req);
    });
  }

  private async impact(tx: Tx, row: BudgetRow, req: ControlPreviewRequest): Promise<ControlImpact> {
    const posting = toPostingBudget(row);
    const balances = (await this.reads.balances(tx, [row.id])).get(row.id)!.budget;
    const cascade = Boolean(req.cascade);
    let affectedRows: { row: BudgetRow; b: BucketBalances; reduction: number; floor: number }[] =
      [];
    let problem: ControlImpact['problem'] = null;
    let impact = {
      floorMinor: reductionFloor(balances, false),
      reductionMinor: 0,
      newAuthorizedMinor: balances.authorized,
      childrenAllocatedMinor: balances.allocated_out,
      availableAfterMinor: availableOf(balances, CONSUMING_BUCKETS),
    };
    const nextStatus = (r: BudgetRow): BudgetStatus => {
      if (req.action === 'reduce') return r.status === 'frozen' ? 'frozen' : 'reduced';
      const n = budgetMachine.next(r.status, req.action === 'freeze' ? 'freeze' : 'set_to_zero');
      return n.ok ? n.value : r.status;
    };
    if (req.action === 'freeze') {
      const rows = cascade ? await this.subtree(tx, row) : [row];
      const bal = await this.reads.balances(
        tx,
        rows.map((r) => r.id),
      );
      affectedRows = rows.map((r) => ({
        row: r,
        b: bal.get(r.id)!.budget,
        reduction: 0,
        floor: reductionFloor(bal.get(r.id)!.budget, false),
      }));
    } else if (req.action === 'set_to_zero') {
      const plan = await this.zeroPlan(tx, row, cascade);
      const own = plan.find((p) => p.row.id === row.id)!;
      const kidsRetained = plan
        .filter((p) => p.row.parentId === row.id)
        .reduce((s, p) => s + p.retainedMinor, 0);
      const r = previewReduction(balances, posting.control, {
        kind: 'set_to_zero',
        cascade,
        childrenRetainedMinor: kidsRetained,
      });
      if (r.ok) {
        impact = {
          floorMinor: r.value.floorMinor,
          reductionMinor: r.value.reductionMinor,
          newAuthorizedMinor: r.value.newAuthorizedMinor,
          childrenAllocatedMinor: r.value.childrenAllocatedMinor,
          availableAfterMinor: r.value.availableAfterMinor,
        };
      }
      affectedRows = plan
        .sort((a, b) => a.row.depth - b.row.depth || a.row.name.localeCompare(b.row.name))
        .map((p) => ({
          row: p.row,
          b: p.balances,
          reduction: p.row.id === row.id ? own.reductionMinor : p.reductionMinor,
          floor: p.retainedMinor,
        }));
    } else {
      const r = previewReduction(balances, posting.control, {
        kind: 'reduce',
        amountMinor: req.amountMinor ?? 0,
      });
      if (r.ok) {
        impact = {
          floorMinor: r.value.floorMinor,
          reductionMinor: r.value.reductionMinor,
          newAuthorizedMinor: r.value.newAuthorizedMinor,
          childrenAllocatedMinor: r.value.childrenAllocatedMinor,
          availableAfterMinor: r.value.availableAfterMinor,
        };
      } else problem = { code: r.error.code, message: r.error.message };
      affectedRows = [
        {
          row,
          b: balances,
          reduction: r.ok ? r.value.reductionMinor : 0,
          floor: impact.floorMinor,
        },
      ];
    }
    let destinationName: string | null = null;
    if (req.action !== 'freeze' && req.destination) {
      const dest = await this.destinationRow(tx, row, req.destination, req.destinationBudgetId);
      if (dest.ok) destinationName = dest.row?.name ?? 'Company savings';
      else problem ??= { code: dest.code, message: dest.message };
    }
    const policy = pendingRequestPolicy(
      req.action === 'freeze' ? 'frozen' : req.action === 'reduce' ? 'reduced' : 'set_to_zero',
    );
    const unfitRequestIds =
      req.action === 'reduce' && !problem
        ? unfitPendingRequests(await this.pendingRequests(tx, row.id), impact.availableAfterMinor)
        : [];
    return {
      action: req.action,
      budgetId: row.id,
      currency: row.currency,
      currentAuthorizedMinor: balances.authorized,
      floorMinor: impact.floorMinor,
      reductionMinor: impact.reductionMinor,
      newAuthorizedMinor: impact.newAuthorizedMinor,
      heldMinor: balances.held,
      encumberedMinor: balances.encumbered,
      actualMinor: balances.actual,
      childrenAllocatedMinor: impact.childrenAllocatedMinor,
      pendingMinor: balances.pre_encumbered,
      availableBeforeMinor: availableOf(balances, CONSUMING_BUCKETS),
      availableAfterMinor: impact.availableAfterMinor,
      cascade: req.action === 'reduce' ? false : cascade,
      blocksNewRequests: req.action !== 'reduce',
      pendingRequestPolicy: policy,
      unfitRequestIds,
      destination: req.action === 'freeze' ? null : (req.destination ?? null),
      destinationBudgetId: req.destinationBudgetId ?? null,
      destinationName,
      affected: affectedRows.map((a) => ({
        budgetId: a.row.id,
        name: a.row.name,
        depth: a.row.depth,
        status: a.row.status,
        newStatus: nextStatus(a.row),
        authorizedMinor: a.b.authorized,
        reductionMinor: a.reduction,
        floorMinor: a.floor,
        encumberedMinor: a.b.encumbered,
        pendingMinor: a.b.pre_encumbered,
      })),
      maxReductionMinor: Math.max(balances.authorized - reductionFloor(balances, false), 0),
      problem,
    };
  }

  private async destinationRow(
    tx: Tx,
    row: BudgetRow,
    destination: ReductionDestination,
    destinationBudgetId: string | undefined | null,
  ): Promise<{ ok: true; row: BudgetRow | null } | { ok: false; code: string; message: string }> {
    if (destination === 'savings') return { ok: true, row: null };
    if (destination === 'parent') {
      if (!row.parentId)
        return {
          ok: false,
          code: 'REDUCTION_DESTINATION_REQUIRED',
          message: 'A root budget has no parent; choose savings.',
        };
      return { ok: true, row: await this.views.row(tx, row.parentId) };
    }
    if (!destinationBudgetId)
      return {
        ok: false,
        code: 'REDUCTION_DESTINATION_REQUIRED',
        message: 'Choose the budget that receives the reallocated money.',
      };
    const dest = (await this.reads.budgetRows(tx, [destinationBudgetId])).get(destinationBudgetId);
    if (!dest)
      return { ok: false, code: 'NOT_FOUND', message: 'The destination budget does not exist.' };
    if (dest.path.startsWith(row.path))
      return {
        ok: false,
        code: 'TRANSFER_INVALID',
        message: 'Reallocate to a budget outside the one being cut.',
      };
    if (dest.path.split('/')[1] !== row.path.split('/')[1])
      return {
        ok: false,
        code: 'TRANSFER_INVALID',
        message: 'Money can only move between budgets of the same tree.',
      };
    const accepts = acceptsNewActivity(dest.status);
    if (!accepts.ok) return { ok: false, code: accepts.error.code, message: accepts.error.message };
    return { ok: true, row: dest };
  }

  private async assertReasonCode(tx: Tx, code: string, categories: string[]): Promise<void> {
    const [rc] = await tx
      .select()
      .from(reasonCodes)
      .where(and(eq(reasonCodes.code, code), inArray(reasonCodes.category, categories)));
    if (!rc)
      throw new ApiProblem(
        422,
        'VALIDATION_FAILED',
        'Choose one of the reason codes for this change.',
        {
          field: 'reasonCode',
        },
      );
  }

  /** Open pending requests on a budget: pre-encumbered commitments linked to a request, in budget currency. */
  private async pendingRequests(tx: Tx, budgetId: string): Promise<PendingRequestAmount[]> {
    const res = await tx.execute<{ request_id: string; open: string; submitted: string }>(sql`
      select c.request_id, sum(l.budget_amount_minor)::text as open,
             to_char(min(c.created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') as submitted
      from ledger_lines l
      join commitments c on c.id = l.commitment_id
      where l.budget_id = ${budgetId}::uuid and l.account = 'pre_encumbered'
        and c.status = 'pre_encumbered' and c.request_id is not null
      group by c.request_id
      having sum(l.budget_amount_minor) > 0`);
    return res.rows.map((r) => ({
      requestId: r.request_id,
      openMinor: Number(r.open),
      submittedAt: r.submitted,
    }));
  }

  private async event(
    tx: Tx,
    actor: RequestActor,
    row: BudgetRow,
    action: ControlEventAction,
    fields: {
      previousStatus: BudgetStatus;
      status: BudgetStatus;
      reasonCode: string | null;
      reason: string;
      cascadeFromBudgetId: string | null;
      journalId: string | null;
      authorizedBeforeMinor: number;
      authorizedAfterMinor: number;
      unfitRequestIds?: string[];
    },
  ): Promise<void> {
    await this.views.outbox(tx, actor.tenantId, 'budget.control_changed', {
      eventId: randomUUID(),
      tenantId: actor.tenantId,
      budgetId: row.id,
      budgetName: row.name,
      action,
      pendingRequestPolicy: pendingRequestPolicy(action),
      currency: row.currency,
      actorPersonId: actor.personId,
      occurredAt: new Date().toISOString(),
      ...fields,
      unfitRequestIds: fields.unfitRequestIds ?? [],
    });
  }

  private async setStatus(
    tx: Tx,
    actor: RequestActor,
    row: BudgetRow,
    next: BudgetStatus,
    auditAction: string,
    reason: string,
    reasonCode: string | null,
    requestId: string | null,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    if (next !== row.status)
      await tx.update(budgets).set({ status: next }).where(eq(budgets.id, row.id));
    await this.audit.append(tx, {
      tenantId: actor.tenantId,
      actorPersonId: actor.personId,
      actorSubject: actor.subject,
      action: auditAction,
      resourceType: 'budget',
      resourceId: row.id,
      legalEntityId: row.legalEntityId,
      requestId,
      reason: reasonCode ? `${reasonCode}: ${reason}` : reason,
      changes: { status: { from: row.status, to: next }, ...extra },
    });
  }

  private result(
    tx: Tx,
    actor: RequestActor,
    id: string,
    action: ControlEventAction,
    journalId: string | null,
    affected: string[],
    unfitRequestIds: string[] = [],
  ): Promise<ControlResult> {
    return this.views.detailById(tx, actor, id).then((budget) => ({
      budget,
      journalId,
      affectedBudgetIds: affected,
      event: {
        topic: 'budget.control_changed' as const,
        action,
        pendingRequestPolicy: pendingRequestPolicy(action),
        unfitRequestIds,
      },
    }));
  }

  freeze(actor: RequestActor, id: string, req: FreezeRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `budgets.freeze:${id}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        const { row: unlocked } = await this.loadForControl(tx, actor, id);
        await this.assertReasonCode(tx, req.reasonCode, ['freeze', 'reduction', 'exception']);
        const { row, rows } = await this.lockedRows(tx, unlocked, Boolean(req.cascade));
        unwrap(budgetMachine.next(row.status, 'freeze'));
        const affected: string[] = [];
        for (const r of rows) {
          const next = budgetMachine.next(r.status, 'freeze');
          if (!next.ok) continue;
          await this.setStatus(
            tx,
            actor,
            r,
            next.value,
            'budget.frozen',
            req.reason,
            req.reasonCode,
            ctx.requestId,
            {
              cascadeFrom: r.id === row.id ? null : row.id,
            },
          );
          const auth = (await this.reads.balances(tx, [r.id])).get(r.id)!.budget.authorized;
          await this.event(tx, actor, r, 'frozen', {
            previousStatus: r.status,
            status: next.value,
            reasonCode: req.reasonCode,
            reason: req.reason,
            cascadeFromBudgetId: r.id === row.id ? null : row.id,
            journalId: null,
            authorizedBeforeMinor: auth,
            authorizedAfterMinor: auth,
          });
          await this.views.snapshot(tx, actor, r.id, `Frozen: ${req.reason}`);
          affected.push(r.id);
        }
        await this.analytics.track(tx, actor, 'budget.control_changed', {
          action: 'frozen',
          cascade: Boolean(req.cascade),
          affected: affected.length,
        });
        return this.result(tx, actor, id, 'frozen', null, affected);
      },
    );
  }

  unfreeze(actor: RequestActor, id: string, req: UnfreezeRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `budgets.unfreeze:${id}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        const { row: unlocked } = await this.loadForControl(tx, actor, id);
        const { row, rows } = await this.lockedRows(tx, unlocked, Boolean(req.cascade));
        unwrap(budgetMachine.next(row.status, 'unfreeze'));
        const affected: string[] = [];
        for (const r of rows) {
          if (r.status !== 'frozen') continue;
          await this.setStatus(
            tx,
            actor,
            r,
            'active',
            'budget.unfrozen',
            req.reason,
            null,
            ctx.requestId,
          );
          const auth = (await this.reads.balances(tx, [r.id])).get(r.id)!.budget.authorized;
          await this.event(tx, actor, r, 'unfrozen', {
            previousStatus: r.status,
            status: 'active',
            reasonCode: null,
            reason: req.reason,
            cascadeFromBudgetId: r.id === row.id ? null : row.id,
            journalId: null,
            authorizedBeforeMinor: auth,
            authorizedAfterMinor: auth,
          });
          await this.views.snapshot(tx, actor, r.id, `Unfrozen: ${req.reason}`);
          affected.push(r.id);
        }
        await this.analytics.track(tx, actor, 'budget.control_changed', {
          action: 'unfrozen',
          cascade: Boolean(req.cascade),
          affected: affected.length,
        });
        return this.result(tx, actor, id, 'unfrozen', null, affected);
      },
    );
  }

  restore(actor: RequestActor, id: string, req: RestoreRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `budgets.restore:${id}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        const { row: unlocked } = await this.loadForControl(tx, actor, id);
        const { row } = await this.lockedRows(tx, unlocked, false);
        const next = unwrap(budgetMachine.next(row.status, 'restore'));
        await this.setStatus(
          tx,
          actor,
          row,
          next,
          'budget.restored',
          req.reason,
          null,
          ctx.requestId,
        );
        const auth = (await this.reads.balances(tx, [id])).get(id)!.budget.authorized;
        await this.event(tx, actor, row, 'restored', {
          previousStatus: row.status,
          status: next,
          reasonCode: null,
          reason: req.reason,
          cascadeFromBudgetId: null,
          journalId: null,
          authorizedBeforeMinor: auth,
          authorizedAfterMinor: auth,
        });
        await this.views.snapshot(tx, actor, id, `Restored: ${req.reason}`);
        await this.analytics.track(tx, actor, 'budget.control_changed', {
          action: 'restored',
          cascade: false,
          affected: 1,
        });
        return this.result(tx, actor, id, 'restored', null, [id]);
      },
    );
  }

  /** Posts one hierarchy move (reduction or transfer) and returns the journal id. */
  private async move(
    tx: Tx,
    actor: RequestActor,
    source: BudgetRow,
    destination: { kind: 'budget'; row: BudgetRow } | { kind: 'savings' },
    amountMinor: number,
    type: 'reduction' | 'transfer',
    reason: { reasonCode: string | null; reason: string; accountingDate?: string },
    ctx: CommandContext,
    allowCrossRoot = false,
  ): Promise<string> {
    const chain = await this.views.chain(tx, source);
    const root = chain[chain.length - 1];
    let dest: HierarchyDestination;
    if (destination.kind === 'savings')
      dest = { kind: 'savings', planVersionId: root.planVersionId };
    else {
      const destChain = await this.views.chain(tx, destination.row);
      dest = { kind: 'budget', chain: destChain.map(toPostingBudget) };
    }
    const draft = unwrap(
      postHierarchyMove(
        {
          type,
          sourceChain: chain.map(toPostingBudget),
          destination: dest,
          amount: { amountMinor, currency: source.currency as CurrencyCode },
          reasonCode: reason.reasonCode,
          reason: reason.reason,
          allowCrossRoot,
        },
        {
          reportingCurrency: actor.reportingCurrency,
          rates: await this.reads.planRates(tx, source.fiscalYearId),
          accountingDate: await this.views.accountingDate(
            tx,
            source.fiscalYearId,
            reason.accountingDate,
          ),
        },
      ),
    );
    return this.ledger.post(tx, draft, {
      actor,
      command: type === 'transfer' ? 'budgets.transfer' : 'budgets.reduce',
      fiscalYearId: source.fiscalYearId,
      requestId: ctx.requestId,
      idempotencyKey: ctx.idempotencyKey,
    });
  }

  private async lockMoveChains(tx: Tx, source: BudgetRow, dest: BudgetRow | null): Promise<void> {
    const ids = new Set(source.path.split('/').filter(Boolean));
    if (dest) for (const i of dest.path.split('/').filter(Boolean)) ids.add(i);
    await this.reads.lockBudgets(tx, [...ids]);
  }

  reduce(actor: RequestActor, id: string, req: ReduceRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `budgets.reduce:${id}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        const { row } = await this.loadForControl(tx, actor, id);
        await this.assertReasonCode(tx, req.reasonCode, ['reduction']);
        const destination = await this.destinationRow(
          tx,
          row,
          req.destination,
          req.destinationBudgetId,
        );
        if (!destination.ok)
          throw new ApiProblem(
            destination.code === 'NOT_FOUND' ? 404 : 422,
            destination.code as 'TRANSFER_INVALID',
            destination.message,
          );
        await this.assertReallocationScope(actor, row, destination.row, req.destination);
        await this.lockMoveChains(tx, row, destination.row);
        const locked = await this.views.row(tx, id);
        const before = await this.views.utilizations(tx, [id]);
        const balances = (await this.reads.balances(tx, [id])).get(id)!.budget;
        const impact = unwrap(
          validateReduction(balances, toPostingBudget(locked).control, {
            kind: 'reduce',
            amountMinor: req.amountMinor,
            destination: req.destination,
            destinationBudgetId: req.destinationBudgetId ?? null,
            reasonCode: req.reasonCode,
            reason: req.reason,
            confirmedPreview: { floorMinor: req.confirmedFloorMinor },
          }),
        );
        const unfitRequestIds = unfitPendingRequests(
          await this.pendingRequests(tx, id),
          impact.availableAfterMinor,
        );
        const next: BudgetStatus =
          locked.status === 'frozen'
            ? 'frozen'
            : unwrap(budgetMachine.next(locked.status, 'reduce'));
        const journalId = await this.move(
          tx,
          actor,
          locked,
          destination.row ? { kind: 'budget', row: destination.row } : { kind: 'savings' },
          impact.reductionMinor,
          'reduction',
          req,
          ctx,
        );
        await this.setStatus(
          tx,
          actor,
          locked,
          next,
          'budget.reduced',
          req.reason,
          req.reasonCode,
          ctx.requestId,
          {
            authorized: { from: impact.currentAuthorizedMinor, to: impact.newAuthorizedMinor },
            destination: { from: null, to: req.destination },
            destinationBudgetId: { from: null, to: destination.row?.id ?? null },
            floorMinor: { from: null, to: impact.floorMinor },
            journalId: { from: null, to: journalId },
            ...(unfitRequestIds.length
              ? { unfitRequestIds: { from: null, to: unfitRequestIds } }
              : {}),
          },
        );
        await this.event(tx, actor, locked, 'reduced', {
          previousStatus: locked.status,
          status: next,
          reasonCode: req.reasonCode,
          reason: req.reason,
          cascadeFromBudgetId: null,
          journalId,
          authorizedBeforeMinor: impact.currentAuthorizedMinor,
          authorizedAfterMinor: impact.newAuthorizedMinor,
          unfitRequestIds,
        });
        await this.views.snapshot(tx, actor, id, `Reduced: ${req.reason}`);
        if (destination.row)
          await this.views.snapshot(
            tx,
            actor,
            destination.row.id,
            `Received a reduction from ${locked.name}`,
          );
        await this.views.emitThresholds(tx, actor, before, [id]);
        await this.analytics.track(tx, actor, 'budget.control_changed', {
          action: 'reduced',
          cascade: false,
          affected: 1,
          destination: req.destination,
        });
        return this.result(tx, actor, id, 'reduced', journalId, [id], unfitRequestIds);
      },
    );
  }

  /** Reallocating cut money into another subtree needs allocation rights over both (their common ancestor). */
  private async assertReallocationScope(
    actor: RequestActor,
    source: BudgetRow,
    dest: BudgetRow | null,
    destination: ReductionDestination,
  ): Promise<void> {
    if (destination !== 'reallocation' || !dest) return;
    const a = source.path.split('/').filter(Boolean);
    const b = dest.path.split('/').filter(Boolean);
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    const lcaPath = `/${a.slice(0, i).join('/')}/`;
    this.policy.assert(actor, 'budget.allocate', {
      kind: 'budget',
      tenantId: actor.tenantId,
      id: a[i - 1],
      path: lcaPath,
    });
  }

  setToZero(actor: RequestActor, id: string, req: SetToZeroRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `budgets.zero:${id}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        const { row } = await this.loadForControl(tx, actor, id);
        await this.assertReasonCode(tx, req.reasonCode, ['reduction']);
        const expected = (row.code ?? row.name).trim().toLowerCase();
        if (req.confirmText.trim().toLowerCase() !== expected)
          throw new ApiProblem(
            422,
            'VALIDATION_FAILED',
            `Type ${row.code ?? row.name} to confirm the set to zero.`,
            { field: 'confirmText' },
          );
        const destination = await this.destinationRow(
          tx,
          row,
          req.destination,
          req.destinationBudgetId,
        );
        if (!destination.ok)
          throw new ApiProblem(
            destination.code === 'NOT_FOUND' ? 404 : 422,
            destination.code as 'TRANSFER_INVALID',
            destination.message,
          );
        await this.assertReallocationScope(actor, row, destination.row, req.destination);
        const cascade = Boolean(req.cascade);
        const tree = cascade ? await this.subtree(tx, row) : [row];
        const lockIds = new Set(tree.map((t) => t.id));
        for (const i of row.path.split('/').filter(Boolean)) lockIds.add(i);
        if (destination.row)
          for (const i of destination.row.path.split('/').filter(Boolean)) lockIds.add(i);
        await this.reads.lockBudgets(tx, [...lockIds]);
        const locked = await this.views.row(tx, id);
        unwrap(budgetMachine.next(locked.status, 'set_to_zero'));
        const plan = await this.zeroPlan(tx, locked, cascade);
        const own = plan.find((p) => p.row.id === id)!;
        const kidsRetained = plan
          .filter((p) => p.row.parentId === id)
          .reduce((s, p) => s + p.retainedMinor, 0);
        const impact = unwrap(
          validateReduction(own.balances, toPostingBudget(locked).control, {
            kind: 'set_to_zero',
            cascade,
            childrenRetainedMinor: kidsRetained,
            destination: req.destination,
            destinationBudgetId: req.destinationBudgetId ?? null,
            reasonCode: req.reasonCode,
            reason: req.reason,
            confirmedPreview: { floorMinor: req.confirmedFloorMinor },
          }),
        );
        const before = await this.views.utilizations(tx, [...tree.map((t) => t.id)]);
        const affected: string[] = [];
        let rootJournal: string | null = null;
        // Children first (deepest first), each returning what it does not keep to its parent.
        for (const item of plan) {
          if (item.row.id === id) continue;
          const next = budgetMachine.next(item.row.status, 'set_to_zero');
          const statusChanges = next.ok && next.value !== item.row.status;
          if (!statusChanges && item.reductionMinor === 0) continue;
          let journalId: string | null = null;
          if (item.reductionMinor > 0) {
            const parentRow = await this.views.row(tx, item.row.parentId!);
            journalId = await this.move(
              tx,
              actor,
              item.row,
              { kind: 'budget', row: parentRow },
              item.reductionMinor,
              'reduction',
              { reasonCode: req.reasonCode, reason: `Cascade from ${locked.name}: ${req.reason}` },
              ctx,
            );
          }
          const status = next.ok ? next.value : item.row.status;
          await this.setStatus(
            tx,
            actor,
            item.row,
            status,
            'budget.set_to_zero',
            req.reason,
            req.reasonCode,
            ctx.requestId,
            {
              cascadeFrom: id,
              authorized: {
                from: item.balances.authorized,
                to: item.balances.authorized - item.reductionMinor,
              },
              journalId: { from: null, to: journalId },
            },
          );
          await this.event(tx, actor, item.row, 'set_to_zero', {
            previousStatus: item.row.status,
            status,
            reasonCode: req.reasonCode,
            reason: req.reason,
            cascadeFromBudgetId: id,
            journalId,
            authorizedBeforeMinor: item.balances.authorized,
            authorizedAfterMinor: item.balances.authorized - item.reductionMinor,
          });
          await this.views.snapshot(tx, actor, item.row.id, `Set to zero (cascade): ${req.reason}`);
          affected.push(item.row.id);
        }
        if (impact.reductionMinor > 0) {
          rootJournal = await this.move(
            tx,
            actor,
            locked,
            destination.row ? { kind: 'budget', row: destination.row } : { kind: 'savings' },
            impact.reductionMinor,
            'reduction',
            req,
            ctx,
          );
        }
        const next = unwrap(budgetMachine.next(locked.status, 'set_to_zero'));
        await this.setStatus(
          tx,
          actor,
          locked,
          next,
          'budget.set_to_zero',
          req.reason,
          req.reasonCode,
          ctx.requestId,
          {
            authorized: { from: impact.currentAuthorizedMinor, to: impact.newAuthorizedMinor },
            destination: { from: null, to: req.destination },
            destinationBudgetId: { from: null, to: destination.row?.id ?? null },
            floorMinor: { from: null, to: impact.floorMinor },
            cascade: { from: null, to: cascade },
            journalId: { from: null, to: rootJournal },
          },
        );
        await this.event(tx, actor, locked, 'set_to_zero', {
          previousStatus: locked.status,
          status: next,
          reasonCode: req.reasonCode,
          reason: req.reason,
          cascadeFromBudgetId: null,
          journalId: rootJournal,
          authorizedBeforeMinor: impact.currentAuthorizedMinor,
          authorizedAfterMinor: impact.newAuthorizedMinor,
        });
        await this.views.snapshot(tx, actor, id, `Set to zero: ${req.reason}`);
        if (destination.row)
          await this.views.snapshot(
            tx,
            actor,
            destination.row.id,
            `Received money cut from ${locked.name}`,
          );
        affected.unshift(id);
        await this.views.emitThresholds(tx, actor, before, affected);
        await this.analytics.track(tx, actor, 'budget.control_changed', {
          action: 'set_to_zero',
          cascade,
          affected: affected.length,
          destination: req.destination,
        });
        return this.result(tx, actor, id, 'set_to_zero', rootJournal, affected);
      },
    );
  }

  transfer(actor: RequestActor, id: string, req: TransferRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `budgets.transfer:${id}`,
        request: req,
        status: 201,
      },
      (tx) => this.transferInTx(tx, actor, id, req, ctx, { skipPolicy: false }),
    );
  }

  /** Transfer along the hierarchy; also used to release contingency reserve once approved. */
  async transferInTx(
    tx: Tx,
    actor: RequestActor,
    id: string,
    req: TransferRequest,
    ctx: CommandContext,
    /** `audit: false` when the calling command writes the one audit entry itself. */
    options: { skipPolicy: boolean; audit?: boolean },
  ): Promise<TransferResult> {
    const source = await this.views.row(tx, id);
    const dest = (await this.reads.budgetRows(tx, [req.toBudgetId])).get(req.toBudgetId);
    this.policy.assert(actor, 'budget.read', budgetResource(source), 'budget');
    if (!dest) throw ApiProblem.notFound('destination budget');
    if (source.id === dest.id)
      throw new ApiProblem(
        422,
        'TRANSFER_INVALID',
        'Choose a different budget to receive the money.',
      );
    const crossRootContingencyRelease =
      source.budgetType === 'contingency' && !source.parentId && options.skipPolicy;
    if (
      !crossRootContingencyRelease &&
      (source.path.split('/')[1] !== dest.path.split('/')[1] ||
        source.fiscalYearId !== dest.fiscalYearId)
    )
      throw new ApiProblem(
        422,
        'TRANSFER_INVALID',
        'Money can only move between budgets of the same tree.',
      );
    const a = source.path.split('/').filter(Boolean);
    const b = dest.path.split('/').filter(Boolean);
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    const lca = {
      kind: 'budget' as const,
      tenantId: actor.tenantId,
      id: a[i - 1],
      path: `/${a.slice(0, i).join('/')}/`,
    };
    if (!options.skipPolicy) {
      this.policy.assert(actor, 'budget.read', budgetResource(dest), 'destination budget');
      const ownsBothSiblings =
        source.parentId !== null &&
        source.parentId === dest.parentId &&
        this.policy.can(actor, 'budget.allocate', budgetResource(source)).allowed &&
        this.policy.can(actor, 'budget.allocate', budgetResource(dest)).allowed;
      if (!ownsBothSiblings && !this.policy.can(actor, 'budget.allocate', lca).allowed) {
        // Phase 7: a sibling transfer where the caller owns the source (or can request on the target)
        // but does not own both siblings routes to the parent owner as a sibling_transfer request.
        const sameParent = source.parentId !== null && source.parentId === dest.parentId;
        const canRequestTransfer =
          sameParent &&
          (this.policy.can(actor, 'budget.allocate', budgetResource(source)).allowed ||
            this.policy.can(actor, 'request.create', budgetResource(dest)).allowed);
        if (!canRequestTransfer) {
          throw ApiProblem.forbidden(
            'Only the owner of both budgets, the owner of their common parent or finance can move money between them.',
          );
        }
        await this.assertReasonCode(tx, req.reasonCode, ['transfer', 'reduction']);
        await this.lockMoveChains(tx, source, dest);
        const [lockedSource, lockedDest] = [
          await this.views.row(tx, source.id),
          await this.views.row(tx, dest.id),
        ];
        unwrap(acceptsNewActivity(lockedSource.status));
        unwrap(acceptsNewActivity(lockedDest.status));
        const balances = (await this.reads.balances(tx, [source.id])).get(source.id)!.budget;
        const available = availableOf(
          Object.fromEntries(
            Object.entries(balances).map(([k, v]) => [k, Math.max(v, 0)]),
          ) as BucketBalances,
          CONSUMING_BUCKETS,
        );
        if (req.amountMinor > available) {
          throw new ApiProblem(
            409,
            'INSUFFICIENT_AVAILABLE',
            `Only ${available} ${source.currency} minor units can be transferred from ${source.name}.`,
            {
              availableMinor: available,
              requestedMinor: req.amountMinor,
              currency: source.currency,
            },
          );
        }
        const [inserted] = await tx
          .insert(budgetChangeRequests)
          .values({
            tenantId: actor.tenantId,
            kind: 'sibling_transfer',
            budgetId: dest.id,
            sourceBudgetId: source.id,
            amountMinor: req.amountMinor,
            currency: source.currency,
            reason: `${req.reasonCode}: ${req.reason}`,
            requestedBy: actor.personId,
          })
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'budget.sibling_transfer_requested',
          resourceType: 'budget_change_request',
          resourceId: inserted.id,
          legalEntityId: source.legalEntityId,
          requestId: ctx.requestId,
          reason: `${req.reasonCode}: ${req.reason}`,
          changes: {
            budgetId: { from: null, to: dest.id },
            sourceBudgetId: { from: null, to: source.id },
            amount: { from: null, to: { amountMinor: req.amountMinor, currency: source.currency } },
          },
        });
        await this.views.outbox(tx, actor.tenantId, 'budget.change_requested', {
          tenantId: actor.tenantId,
          requestId: inserted.id,
          kind: 'sibling_transfer',
          budgetId: dest.id,
          sourceBudgetId: source.id,
          amountMinor: req.amountMinor,
          currency: source.currency,
          requestedBy: actor.personId,
        });
        return {
          journal: null,
          from: await this.views.detailById(tx, actor, source.id),
          to: await this.views.detailById(tx, actor, dest.id),
          changeRequest: {
            id: inserted.id,
            kind: 'sibling_transfer',
            budgetId: dest.id,
            budgetName: dest.name,
            sourceBudgetId: source.id,
            sourceBudgetName: source.name,
            amount: { amountMinor: req.amountMinor, currency: source.currency },
            approvedAmount: null,
            reason: inserted.reason,
            status: 'pending',
            requestedByName: actor.displayName,
            createdAt: inserted.createdAt.toISOString(),
            decidedAt: null,
            decidedByName: null,
            decisionNote: null,
            journalId: null,
            canDecide: false,
            sourceAvailableMinor: available,
          },
        };
      }
      await this.assertReasonCode(tx, req.reasonCode, ['transfer', 'reduction']);
    }
    await this.lockMoveChains(tx, source, dest);
    const [lockedSource, lockedDest] = [
      await this.views.row(tx, source.id),
      await this.views.row(tx, dest.id),
    ];
    unwrap(acceptsNewActivity(lockedSource.status));
    unwrap(acceptsNewActivity(lockedDest.status));
    const balances = (await this.reads.balances(tx, [source.id])).get(source.id)!.budget;
    const available = availableOf(
      Object.fromEntries(
        Object.entries(balances).map(([k, v]) => [k, Math.max(v, 0)]),
      ) as BucketBalances,
      CONSUMING_BUCKETS,
    );
    if (req.amountMinor > available)
      throw new ApiProblem(
        409,
        'INSUFFICIENT_AVAILABLE',
        `Only ${available} ${source.currency} minor units can be transferred from ${source.name}.`,
        { availableMinor: available, requestedMinor: req.amountMinor, currency: source.currency },
      );
    const before = await this.views.utilizations(tx, [source.id]);
    const journalId = await this.move(
      tx,
      actor,
      lockedSource,
      { kind: 'budget', row: lockedDest },
      req.amountMinor,
      'transfer',
      req,
      ctx,
      crossRootContingencyRelease,
    );
    if (options.audit !== false)
      await this.audit.append(tx, {
        tenantId: actor.tenantId,
        actorPersonId: actor.personId,
        actorSubject: actor.subject,
        action: 'budget.transferred',
        resourceType: 'budget',
        resourceId: source.id,
        legalEntityId: source.legalEntityId,
        requestId: ctx.requestId,
        reason: `${req.reasonCode}: ${req.reason}`,
        changes: {
          toBudgetId: { from: null, to: dest.id },
          amount: { from: null, to: { amountMinor: req.amountMinor, currency: source.currency } },
          journalId: { from: null, to: journalId },
        },
      });
    await this.views.snapshot(tx, actor, source.id, `Transferred out: ${req.reason}`);
    await this.views.snapshot(tx, actor, dest.id, `Transferred in from ${source.name}`);
    await this.views.emitThresholds(tx, actor, before, [source.id]);
    return {
      journal: await this.ledger.journalDto(tx, journalId),
      from: await this.views.detailById(tx, actor, source.id),
      to: await this.views.detailById(tx, actor, dest.id),
    };
  }

  /** Returns money from a child to its parent (per-head true-up down); the child must have it available. */
  async returnToParentInTx(
    tx: Tx,
    actor: RequestActor,
    child: BudgetRow,
    amountMinor: number,
    reason: string,
    ctx: CommandContext,
  ): Promise<string> {
    const parent = await this.views.row(tx, child.parentId!);
    await this.reads.lockBudgets(tx, [parent.id, child.id]);
    const b = (await this.reads.balances(tx, [child.id])).get(child.id)!.budget;
    const available = availableOf(b, CONSUMING_BUCKETS);
    if (amountMinor > available)
      throw new ApiProblem(
        409,
        'INSUFFICIENT_AVAILABLE',
        `${child.name} has only ${available} ${child.currency} minor units left to return.`,
        { availableMinor: available, requestedMinor: amountMinor, currency: child.currency },
      );
    return this.move(
      tx,
      actor,
      child,
      { kind: 'budget', row: parent },
      amountMinor,
      'reduction',
      { reasonCode: null, reason },
      ctx,
    );
  }

  /**
   * Reclaim (086a): one budget's released money leaves as reductions with a destination, each leg
   * either a reallocation to a target or a return to the budget's parent, under the same floor and
   * confirmed-preview rules as a reduce. The caller holds the row locks on every chain involved and
   * writes the command's one audit entry; this posts the journals, moves the status to reduced,
   * snapshots the budgets and publishes `budget.control_changed` so pending requests that no longer
   * fit go back to their requesters.
   */
  async reclaimInTx(
    tx: Tx,
    actor: RequestActor,
    sourceId: string,
    legs: readonly {
      destination: BudgetRow;
      kind: 'reallocation' | 'parent';
      amountMinor: number;
    }[],
    reason: { reasonCode: string; reason: string; confirmedFloorMinor: number | undefined },
    ctx: CommandContext,
  ): Promise<{
    journalIds: string[];
    authorizedBeforeMinor: number;
    authorizedAfterMinor: number;
    floorMinor: number;
    status: { from: BudgetStatus; to: BudgetStatus };
    unfitRequestIds: string[];
  }> {
    const source = await this.views.row(tx, sourceId);
    const total = legs.reduce((s, l) => s + l.amountMinor, 0);
    const balances = (await this.reads.balances(tx, [sourceId])).get(sourceId)!.budget;
    const impact = unwrap(
      validateReduction(balances, toPostingBudget(source).control, {
        kind: 'reduce',
        amountMinor: total,
        destination: legs.some((l) => l.kind === 'reallocation') ? 'reallocation' : 'parent',
        destinationBudgetId: legs[0]?.destination.id ?? null,
        reasonCode: reason.reasonCode,
        reason: reason.reason,
        confirmedPreview:
          reason.confirmedFloorMinor === undefined
            ? null
            : { floorMinor: reason.confirmedFloorMinor },
      }),
    );
    const before = await this.views.utilizations(tx, [
      sourceId,
      ...legs.map((l) => l.destination.id),
    ]);
    const unfitRequestIds = unfitPendingRequests(
      await this.pendingRequests(tx, sourceId),
      impact.availableAfterMinor,
    );
    const journalIds: string[] = [];
    for (const leg of legs) {
      if (leg.kind === 'reallocation') {
        const accepts = acceptsNewActivity(leg.destination.status);
        if (!accepts.ok)
          throw new ApiProblem(
            422,
            accepts.error.code as 'TRANSFER_INVALID',
            accepts.error.message,
          );
      }
      journalIds.push(
        await this.move(
          tx,
          actor,
          source,
          { kind: 'budget', row: leg.destination },
          leg.amountMinor,
          'reduction',
          { reasonCode: reason.reasonCode, reason: reason.reason },
          ctx,
        ),
      );
    }
    const next: BudgetStatus =
      source.status === 'frozen' ? 'frozen' : unwrap(budgetMachine.next(source.status, 'reduce'));
    if (next !== source.status)
      await tx.update(budgets).set({ status: next }).where(eq(budgets.id, source.id));
    await this.event(tx, actor, source, 'reduced', {
      previousStatus: source.status,
      status: next,
      reasonCode: reason.reasonCode,
      reason: reason.reason,
      cascadeFromBudgetId: null,
      journalId: journalIds[0] ?? null,
      authorizedBeforeMinor: impact.currentAuthorizedMinor,
      authorizedAfterMinor: impact.newAuthorizedMinor,
      unfitRequestIds,
    });
    await this.views.snapshot(tx, actor, source.id, `Reclaimed: ${reason.reason}`);
    for (const id of new Set(legs.map((l) => l.destination.id)))
      await this.views.snapshot(tx, actor, id, `Received money reclaimed from ${source.name}`);
    await this.views.emitThresholds(tx, actor, before, [
      source.id,
      ...legs.map((l) => l.destination.id),
    ]);
    return {
      journalIds,
      authorizedBeforeMinor: impact.currentAuthorizedMinor,
      authorizedAfterMinor: impact.newAuthorizedMinor,
      floorMinor: impact.floorMinor,
      status: { from: source.status, to: next },
      unfitRequestIds,
    };
  }

  /** Pending (pre-encumbered) request money on a budget, for impact previews that list it. */
  async pendingMinor(tx: Tx, budgetId: string): Promise<number> {
    return (await this.pendingRequests(tx, budgetId)).reduce((s, p) => s + p.openMinor, 0);
  }

  /** Whether a budget accepts new requests (used by spend checks and Phase 5 requests). */
  async statusOf(tx: Tx, budgetId: string): Promise<BudgetStatus | null> {
    const [r] = await tx
      .select({ status: budgets.status })
      .from(budgets)
      .where(and(eq(budgets.id, budgetId)));
    return r?.status ?? null;
  }
}
