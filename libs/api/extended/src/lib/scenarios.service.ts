import { AuditService } from '@bf/api/audit';
import { BudgetViews, ControlsService, budgetResource, type BudgetRow } from '@bf/api/budgets';
import { ApiProblem, CommandRunner, DB, PolicyService, type RequestActor } from '@bf/api/core';
import {
  budgets,
  commitments,
  events,
  headcountSnapshotLines,
  headcountSnapshots,
  idempotencyKeys,
  ledgerJournals,
  requests,
  scenarioChanges,
  scenarioCollaborators,
  scenarios,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import { LedgerReads } from '@bf/api/ledger';
import type {
  AddScenarioChangeRequest,
  ArchiveScenarioRequest,
  CreateScenarioRequest,
  Money,
  PromoteScenarioRequest,
  Scenario,
  ScenarioAtRisk,
  ScenarioChange,
  ScenarioChangeImpact,
  ScenarioComparison,
  ScenarioFairnessRow,
  ScenarioImpact,
  ScenarioList,
  ScenarioStatus,
} from '@bf/contracts';
import {
  CONSUMING_BUCKETS,
  availableOf,
  previewReduction,
  reductionFloor,
  type BucketBalances,
} from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray, like, sql } from 'drizzle-orm';
import type { CommandContext } from './support';
import { iso, nameOfPeople } from './support';

type ScenarioRow = typeof scenarios.$inferSelect;
type ChangeRow = typeof scenarioChanges.$inferSelect;

/** Up to three scenarios can be compared with today (031a). */
const MAX_COMPARE = 3;

/**
 * What-if reallocation scenarios (031a).
 *
 * A scenario is a private projection and this service is where that is enforced: nothing in the
 * modelling path posts a journal, changes a balance, touches a budget status or cancels a request.
 * `impact` reads the live ledger and runs the *same* domain functions the real commands run
 * (`reductionFloor`, `previewReduction`, `availableOf`), so a scenario that passes will pass on
 * promotion — but it computes, it does not apply.
 *
 * Promotion has no privileged path either: it calls `ControlsService.reduce`, `.freeze`,
 * `.setToZero` and `.transfer`, each of which runs its own `PolicyService` check, reason code, floor
 * validation, idempotency key, journal and audit entry. A promoter who cannot freeze a budget by
 * hand cannot freeze it through a scenario.
 */
@Injectable()
export class ScenariosService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly reads: LedgerReads,
    private readonly views: BudgetViews,
    private readonly controls: ControlsService,
  ) {}

  // Reads -----------------------------------------------------------------------------------

  list(actor: RequestActor, query: { status?: ScenarioStatus }): Promise<ScenarioList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.assertScenarioAccess(actor);
      const rows = await tx
        .select()
        .from(scenarios)
        .where(
          and(
            eq(scenarios.tenantId, actor.tenantId),
            query.status ? eq(scenarios.status, query.status) : undefined,
          ),
        )
        .orderBy(asc(scenarios.name), asc(scenarios.id));
      const visible = [] as ScenarioRow[];
      for (const row of rows) if (await this.canRead(tx, actor, row)) visible.push(row);
      return { items: await this.views_(tx, actor, visible) };
    });
  }

  get(actor: RequestActor, id: string): Promise<Scenario> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) =>
      this.load(tx, actor, id).then((row) => this.view(tx, actor, row)),
    );
  }

  /**
   * Recomputes the scenario against the live ledger. Read-only by construction: it runs outside
   * `CommandRunner`, takes no row locks, writes no journal and leaves every budget exactly as it
   * found it. The figures come from the same domain functions as the real control actions.
   */
  impact(actor: RequestActor, id: string): Promise<ScenarioImpact> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const row = await this.load(tx, actor, id);
      const changes = await this.changeRows(tx, id);
      return this.computeImpact(tx, actor, row, changes);
    });
  }

  compare(actor: RequestActor, ids: readonly string[]): Promise<ScenarioComparison> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      if (ids.length === 0 || ids.length > MAX_COMPARE)
        throw new ApiProblem(
          422,
          'VALIDATION_FAILED',
          `Compare today with between one and ${MAX_COMPARE} scenarios.`,
          { field: 'ids' },
        );
      const loaded: { row: ScenarioRow; impact: ScenarioImpact }[] = [];
      for (const id of ids) {
        const row = await this.load(tx, actor, id);
        loaded.push({
          row,
          impact: await this.computeImpact(tx, actor, row, await this.changeRows(tx, id)),
        });
      }
      const budgetIds = [
        ...new Set(loaded.flatMap((l) => l.impact.changes.map((c) => c.budgetId))),
      ];
      const rows = await this.reads.budgetRows(tx, budgetIds);
      const balances = await this.reads.balances(tx, budgetIds);
      const fairness = new Map(
        loaded.flatMap((l) => l.impact.fairness.map((f) => [`${l.row.id}:${f.budgetId}`, f])),
      );
      const ordered = budgetIds
        .map((id) => rows.get(id))
        .filter((r): r is BudgetRow => Boolean(r))
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      return {
        computedAt: iso(new Date()),
        columns: [
          { scenarioId: null, label: 'Today', status: null },
          ...loaded.map((l) => ({
            scenarioId: l.row.id,
            label: l.row.name,
            status: l.row.status as ScenarioStatus,
          })),
        ],
        rows: ordered.map((b) => {
          const live = balances.get(b.id)!.budget;
          const money = (minor: number): Money => ({ amountMinor: minor, currency: b.currency });
          const cells = loaded.map(
            (l) => l.impact.changes.find((c) => c.budgetId === b.id) ?? null,
          );
          return {
            budgetId: b.id,
            budgetName: b.name,
            authorized: [
              money(live.authorized),
              ...cells.map((c) => c?.newAuthorized ?? money(live.authorized)),
            ],
            available: [
              money(availableOf(live, CONSUMING_BUCKETS)),
              ...cells.map((c) => c?.availableAfter ?? money(availableOf(live, CONSUMING_BUCKETS))),
            ],
            atRiskCommitted: [money(live.encumbered), ...cells.map(() => money(live.encumbered))],
            perHead: [
              fairness.get(`${loaded[0]?.row.id}:${b.id}`)?.perHeadBefore ?? null,
              ...loaded.map((l) => fairness.get(`${l.row.id}:${b.id}`)?.perHeadAfter ?? null),
            ],
          };
        }),
      };
    });
  }

  // Commands --------------------------------------------------------------------------------

  create(actor: RequestActor, req: CreateScenarioRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'scenarios.create',
        request: req,
        status: 201,
      },
      async (tx) => {
        this.assertScenarioAccess(actor);
        const baseline = await this.baseline(tx, actor.tenantId);
        const [row] = await tx
          .insert(scenarios)
          .values({
            tenantId: actor.tenantId,
            name: req.name,
            note: req.note ?? null,
            baselineAt: baseline.at,
            baselineJournalCount: baseline.journalCount,
            createdByPersonId: actor.personId,
          })
          .returning();
        for (const personId of [...new Set(req.collaboratorPersonIds ?? [])].sort())
          await tx
            .insert(scenarioCollaborators)
            .values({ tenantId: actor.tenantId, scenarioId: row.id, personId })
            .onConflictDoNothing();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'scenario.created',
          resourceType: 'scenario',
          resourceId: row.id,
          requestId: ctx.requestId,
          reason: req.note ?? 'What-if scenario created',
          changes: {
            name: { from: null, to: req.name },
            collaborators: { from: 0, to: (req.collaboratorPersonIds ?? []).length },
          },
        });
        return this.view(tx, actor, row);
      },
    );
  }

  addChange(actor: RequestActor, id: string, req: AddScenarioChangeRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `scenarios.addChange:${id}`,
        request: req,
        status: 201,
      },
      async (tx) => {
        const row = await this.load(tx, actor, id);
        this.assertEditable(row, actor);
        const target = await this.views.row(tx, req.budgetId);
        this.policy.assert(actor, 'budget.read', budgetResource(target), 'budget');
        this.validateChange(req);
        let destinationName: string | null = null;
        if (req.destinationBudgetId) {
          const dest = await this.views.row(tx, req.destinationBudgetId);
          this.policy.assert(actor, 'budget.read', budgetResource(dest), 'budget');
          destinationName = dest.name;
        }
        const [{ next }] = await tx
          .select({ next: sql<number>`coalesce(max(${scenarioChanges.position}), -1) + 1` })
          .from(scenarioChanges)
          .where(eq(scenarioChanges.scenarioId, id));
        await tx.insert(scenarioChanges).values({
          tenantId: actor.tenantId,
          scenarioId: id,
          kind: req.kind,
          budgetId: req.budgetId,
          amountMinor: req.amountMinor ?? null,
          percentBps: req.percentBps ?? null,
          currency: target.currency,
          destination: req.destination ?? null,
          destinationBudgetId: req.destinationBudgetId ?? null,
          cascade: Boolean(req.cascade),
          position: Number(next),
        });
        await tx.update(scenarios).set({ updatedAt: new Date() }).where(eq(scenarios.id, id));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'scenario.change_added',
          resourceType: 'scenario',
          resourceId: id,
          legalEntityId: target.legalEntityId,
          requestId: ctx.requestId,
          reason: `Modelled ${req.kind} on ${target.name}${destinationName ? ` to ${destinationName}` : ''}`,
          changes: {
            kind: { from: null, to: req.kind },
            budgetId: { from: null, to: req.budgetId },
            amountMinor: { from: null, to: req.amountMinor ?? null },
            posted: { from: false, to: false },
          },
        });
        return this.view(tx, actor, await this.load(tx, actor, id));
      },
    );
  }

  removeChange(actor: RequestActor, id: string, changeId: string, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `scenarios.removeChange:${id}:${changeId}`,
        request: null,
        status: 200,
      },
      async (tx) => {
        const row = await this.load(tx, actor, id);
        this.assertEditable(row, actor);
        const deleted = await tx
          .delete(scenarioChanges)
          .where(and(eq(scenarioChanges.scenarioId, id), eq(scenarioChanges.id, changeId)))
          .returning({ id: scenarioChanges.id, kind: scenarioChanges.kind });
        if (deleted.length === 0) throw ApiProblem.notFound('scenario change');
        await tx.update(scenarios).set({ updatedAt: new Date() }).where(eq(scenarios.id, id));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'scenario.change_removed',
          resourceType: 'scenario',
          resourceId: id,
          requestId: ctx.requestId,
          reason: 'Modelled change removed',
          changes: { changeId: { from: changeId, to: null } },
        });
        return this.view(tx, actor, await this.load(tx, actor, id));
      },
    );
  }

  archive(actor: RequestActor, id: string, req: ArchiveScenarioRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `scenarios.archive:${id}`,
        request: req,
        status: 201,
      },
      async (tx) => {
        const row = await this.load(tx, actor, id);
        if (row.status === 'archived')
          throw new ApiProblem(409, 'SCENARIO_NOT_EDITABLE', 'This scenario is already archived.');
        this.assertAuthor(row, actor);
        await tx
          .update(scenarios)
          .set({ status: 'archived', archivedAt: new Date(), updatedAt: new Date() })
          .where(eq(scenarios.id, id));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'scenario.archived',
          resourceType: 'scenario',
          resourceId: id,
          requestId: ctx.requestId,
          reason: req.reason,
          changes: { status: { from: row.status, to: 'archived' } },
        });
        return this.view(tx, actor, await this.load(tx, actor, id));
      },
    );
  }

  /**
   * Turns the modelled changes into the real control actions, one authorized command each.
   *
   * The order matters for safety, not for speed: every change is authorized and validated *before*
   * anything is applied, so a promoter who lacks `budget.control` on one budget never gets a partial
   * batch. Each control command then runs on its own, with its own derived idempotency key, reason
   * code, typed reason, floor check, approval route and audit entry. This service adds exactly one
   * audit entry of its own, for the promotion itself.
   */
  async promote(
    actor: RequestActor,
    id: string,
    req: PromoteScenarioRequest,
    ctx: CommandContext,
  ): Promise<{ status: number; body: Scenario; replayed: boolean }> {
    const replay = await this.replayOf(actor, ctx.idempotencyKey, `scenarios.promote:${id}`);
    if (replay) return replay;

    const prepared = await withTenant(
      this.db,
      { tenantId: actor.tenantId, subject: actor.subject },
      async (tx) => {
        const row = await this.load(tx, actor, id);
        this.assertEditable(row, actor);
        const changes = await this.changeRows(tx, id);
        if (changes.length === 0)
          throw new ApiProblem(
            422,
            'SCENARIO_CHANGE_INVALID',
            'Add at least one change before promoting this scenario.',
          );
        if (iso(row.baselineAt) !== req.baselineAt)
          throw new ApiProblem(
            409,
            'SCENARIO_BASELINE_STALE',
            'Recalculate the scenario: the figures you reviewed are not the ones stored on it.',
          );
        const impact = await this.computeImpact(tx, actor, row, changes);
        if (impact.stale)
          throw new ApiProblem(
            409,
            'SCENARIO_BASELINE_STALE',
            'The ledger changed since this scenario was last recalculated. Recalculate before promoting.',
          );
        if (impact.blocked)
          throw new ApiProblem(
            422,
            'SCENARIO_IMPACT_BLOCKED',
            `This scenario cannot be promoted as it stands: ${impact.blockingReasons[0]}`,
          );
        // Authorize every change up front against the same rule the real command applies, so a
        // forbidden change refuses the whole promotion instead of applying the ones before it.
        for (const change of changes) {
          const target = await this.views.row(tx, change.budgetId);
          const parent = target.parentId ? await this.views.row(tx, target.parentId) : undefined;
          if (change.kind === 'transfer') {
            this.policy.assert(actor, 'budget.allocate', budgetResource(target), 'budget');
            if (change.destinationBudgetId) {
              const dest = await this.views.row(tx, change.destinationBudgetId);
              this.policy.assert(actor, 'budget.allocate', budgetResource(dest), 'budget');
            }
          } else {
            this.views.assertControl(actor, target, parent);
          }
        }
        const targets = await this.reads.budgetRows(
          tx,
          changes.map((c) => c.budgetId),
        );
        return { changes, impact, targets };
      },
    );

    // Each change runs as the ordinary command, outside this service's transaction, with its own
    // idempotency key so a retry of the promotion never posts twice.
    const results: { changeId: string; journalId: string | null }[] = [];
    for (const change of prepared.changes) {
      const impact = prepared.impact.changes.find((c) => c.changeId === change.id);
      const target = prepared.targets.get(change.budgetId);
      if (!impact || !target) throw ApiProblem.notFound('scenario change');
      try {
        const journalId = await this.applyChange(actor, change, impact, target, req, {
          ...ctx,
          idempotencyKey: `${ctx.idempotencyKey}:${change.id}`,
        });
        results.push({ changeId: change.id, journalId });
      } catch (error) {
        if (error instanceof ApiProblem) await this.recordFailure(actor, change.id, error);
        throw error;
      }
    }

    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `scenarios.promote:${id}`,
        request: req,
        status: 201,
      },
      async (tx) => {
        const now = new Date();
        for (const r of results)
          await tx
            .update(scenarioChanges)
            .set({
              promotionStatus: 'applied',
              appliedAt: now,
              journalId: r.journalId,
              problemCode: null,
              problemDetail: null,
            })
            .where(eq(scenarioChanges.id, r.changeId));
        await tx
          .update(scenarios)
          .set({
            status: 'promoted',
            promotedAt: now,
            promotionReasonCode: req.reasonCode,
            promotionReason: req.reason,
            updatedAt: now,
          })
          .where(eq(scenarios.id, id));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'scenario.promoted',
          resourceType: 'scenario',
          resourceId: id,
          requestId: ctx.requestId,
          reason: `${req.reasonCode}: ${req.reason}`,
          changes: {
            status: { from: 'draft', to: 'promoted' },
            appliedChanges: { from: 0, to: results.length },
            journalIds: {
              from: null,
              to: results.map((r) => r.journalId).filter(Boolean),
            },
          },
        });
        return this.view(tx, actor, await this.load(tx, actor, id));
      },
    );
  }

  // Internals -------------------------------------------------------------------------------

  /**
   * One modelled change, applied as the real command. The confirmed floor and the typed confirmation
   * come from the impact the promoter reviewed, so the command's own `IMPACT_PREVIEW_REQUIRED` and
   * `REDUCTION_BELOW_FLOOR` checks still run against the live ledger rather than being skipped.
   */
  private async applyChange(
    actor: RequestActor,
    change: ChangeRow,
    impact: ScenarioChangeImpact,
    budget: { code: string | null; name: string },
    req: PromoteScenarioRequest,
    ctx: CommandContext,
  ): Promise<string | null> {
    const common = { reasonCode: req.reasonCode, reason: req.reason };
    const destination = (change.destination ?? 'parent') as 'parent' | 'savings' | 'reallocation';
    if (change.kind === 'freeze') {
      const r = await this.controls.freeze(
        actor,
        change.budgetId,
        { ...common, cascade: change.cascade },
        ctx,
      );
      return r.body.journalId;
    }
    if (change.kind === 'set_to_zero') {
      const r = await this.controls.setToZero(
        actor,
        change.budgetId,
        {
          ...common,
          cascade: change.cascade,
          destination,
          destinationBudgetId: change.destinationBudgetId ?? undefined,
          confirmedFloorMinor: impact.floor.amountMinor,
          confirmText: budget.code ?? budget.name,
        },
        ctx,
      );
      return r.body.journalId;
    }
    if (change.kind === 'transfer') {
      const r = await this.controls.transfer(
        actor,
        change.budgetId,
        {
          ...common,
          toBudgetId: change.destinationBudgetId!,
          amountMinor: Number(change.amountMinor),
        },
        ctx,
      );
      return r.body.journal?.id ?? null;
    }
    const r = await this.controls.reduce(
      actor,
      change.budgetId,
      {
        ...common,
        amountMinor: impact.reduction.amountMinor,
        destination,
        destinationBudgetId: change.destinationBudgetId ?? undefined,
        confirmedFloorMinor: impact.floor.amountMinor,
      },
      ctx,
    );
    return r.body.journalId;
  }

  private recordFailure(actor: RequestActor, changeId: string, problem: ApiProblem): Promise<void> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      await tx
        .update(scenarioChanges)
        .set({
          promotionStatus: 'failed',
          problemCode: problem.code,
          problemDetail: problem.detail,
        })
        .where(eq(scenarioChanges.id, changeId));
    });
  }

  /** Returns the stored response when this idempotency key already completed this operation. */
  private async replayOf(
    actor: RequestActor,
    key: string,
    operation: string,
  ): Promise<{ status: number; body: Scenario; replayed: boolean } | null> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const [prior] = await tx
        .select()
        .from(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.tenantId, actor.tenantId),
            eq(idempotencyKeys.key, key),
            eq(idempotencyKeys.operation, operation),
          ),
        );
      if (!prior || prior.responseStatus === null) return null;
      return {
        status: prior.responseStatus,
        body: prior.responseBody as Scenario,
        replayed: true,
      };
    });
  }

  private validateChange(req: AddScenarioChangeRequest): void {
    const needsAmount = req.kind === 'reduce' || req.kind === 'transfer';
    if (needsAmount && !req.amountMinor && !(req.kind === 'reduce' && req.percentBps))
      throw new ApiProblem(
        422,
        'SCENARIO_CHANGE_INVALID',
        'Give an amount (or, for a reduction, a percentage) for this change.',
        { field: 'amountMinor' },
      );
    if (req.kind === 'transfer' && !req.destinationBudgetId)
      throw new ApiProblem(
        422,
        'SCENARIO_CHANGE_INVALID',
        'Choose the budget the transfer goes to.',
        { field: 'destinationBudgetId' },
      );
    if (req.destination === 'reallocation' && !req.destinationBudgetId)
      throw new ApiProblem(
        422,
        'SCENARIO_CHANGE_INVALID',
        'Choose the budget that receives the reallocated money.',
        { field: 'destinationBudgetId' },
      );
    if (req.kind === 'freeze' && (req.amountMinor || req.destination))
      throw new ApiProblem(
        422,
        'SCENARIO_CHANGE_INVALID',
        'A freeze moves no money, so it takes no amount or destination.',
      );
  }

  /**
   * Creating and promoting scenarios is company-level work: the whole point is to see across the
   * tree, so an owner-scoped role is refused rather than shown a slice of the company.
   */
  private assertScenarioAccess(actor: RequestActor): void {
    const tenant = { kind: 'tenant' as const, tenantId: actor.tenantId };
    if (!this.policy.can(actor, 'budget.read', tenant).allowed)
      throw ApiProblem.notFound('scenario');
    const control = this.policy.can(actor, 'budget.control', tenant).allowed;
    const allocate = this.policy.can(actor, 'budget.allocate', tenant).allowed;
    if (!control && !allocate)
      throw ApiProblem.forbidden(
        'Scenarios are for people who can change budgets company-wide; you can read budgets but not change them.',
      );
  }

  private assertEditable(row: ScenarioRow, actor: RequestActor): void {
    if (row.status !== 'draft')
      throw new ApiProblem(
        409,
        'SCENARIO_NOT_EDITABLE',
        `A ${row.status} scenario is read-only. Duplicate it to try something else.`,
      );
    this.assertAuthor(row, actor);
  }

  private assertAuthor(row: ScenarioRow, actor: RequestActor): void {
    this.assertScenarioAccess(actor);
    if (row.createdByPersonId && row.createdByPersonId !== actor.personId)
      throw ApiProblem.forbidden('Only the author of a scenario can change or promote it.');
  }

  private async canRead(tx: Tx, actor: RequestActor, row: ScenarioRow): Promise<boolean> {
    if (row.createdByPersonId === actor.personId) return true;
    const collaborators = await tx
      .select({ personId: scenarioCollaborators.personId })
      .from(scenarioCollaborators)
      .where(eq(scenarioCollaborators.scenarioId, row.id));
    return collaborators.some((c) => c.personId === actor.personId);
  }

  private async load(tx: Tx, actor: RequestActor, id: string): Promise<ScenarioRow> {
    this.assertScenarioAccess(actor);
    const [row] = await tx
      .select()
      .from(scenarios)
      .where(and(eq(scenarios.tenantId, actor.tenantId), eq(scenarios.id, id)));
    if (!row) throw ApiProblem.notFound('scenario');
    // An owner of an affected budget sees nothing until promotion (031a): a scenario is private to
    // its author and the collaborators they named.
    if (!(await this.canRead(tx, actor, row))) throw ApiProblem.notFound('scenario');
    return row;
  }

  private changeRows(tx: Tx, scenarioId: string): Promise<ChangeRow[]> {
    return tx
      .select()
      .from(scenarioChanges)
      .where(eq(scenarioChanges.scenarioId, scenarioId))
      .orderBy(asc(scenarioChanges.position), asc(scenarioChanges.id));
  }

  /** The ledger moment a scenario is measured against: journal count is the cheap change detector. */
  private async baseline(tx: Tx, tenantId: string): Promise<{ at: Date; journalCount: number }> {
    const [row] = await tx
      .select({ n: count() })
      .from(ledgerJournals)
      .where(eq(ledgerJournals.tenantId, tenantId));
    return { at: new Date(), journalCount: Number(row?.n ?? 0) };
  }

  private async views_(
    tx: Tx,
    actor: RequestActor,
    rows: readonly ScenarioRow[],
  ): Promise<Scenario[]> {
    const out: Scenario[] = [];
    for (const row of rows) out.push(await this.view(tx, actor, row));
    return out;
  }

  private async view(tx: Tx, actor: RequestActor, row: ScenarioRow): Promise<Scenario> {
    const changes = await this.changeRows(tx, row.id);
    const budgetIds = [
      ...new Set(
        changes.flatMap((c) => [c.budgetId, c.destinationBudgetId].filter((v): v is string => !!v)),
      ),
    ];
    const budgetRows = await this.reads.budgetRows(tx, budgetIds);
    const collaborators = await tx
      .select({ personId: scenarioCollaborators.personId })
      .from(scenarioCollaborators)
      .where(eq(scenarioCollaborators.scenarioId, row.id));
    const names = await nameOfPeople(tx, [
      ...collaborators.map((c) => c.personId),
      row.createdByPersonId,
    ]);
    return {
      id: row.id,
      name: row.name,
      note: row.note,
      status: row.status as ScenarioStatus,
      baselineAt: iso(row.baselineAt),
      createdByName: names.get(row.createdByPersonId ?? '') ?? null,
      collaboratorNames: collaborators
        .map((c) => names.get(c.personId) ?? c.personId)
        .sort((a, b) => a.localeCompare(b)),
      changes: changes.map((c) => this.changeView(c, budgetRows)),
      promotedAt: row.promotedAt ? iso(row.promotedAt) : null,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  private changeView(c: ChangeRow, budgetRows: Map<string, BudgetRow>): ScenarioChange {
    const currency = c.currency ?? budgetRows.get(c.budgetId)?.currency ?? 'USD';
    return {
      id: c.id,
      kind: c.kind as ScenarioChange['kind'],
      budgetId: c.budgetId,
      budgetName: budgetRows.get(c.budgetId)?.name ?? '',
      amount: c.amountMinor === null ? null : { amountMinor: Number(c.amountMinor), currency },
      percentBps: c.percentBps,
      destination: (c.destination as ScenarioChange['destination']) ?? null,
      destinationBudgetId: c.destinationBudgetId,
      destinationBudgetName: c.destinationBudgetId
        ? (budgetRows.get(c.destinationBudgetId)?.name ?? null)
        : null,
      cascade: c.cascade,
      position: c.position,
      promotion: c.promotionStatus
        ? {
            status: c.promotionStatus as 'pending' | 'applied' | 'failed',
            appliedAt: c.appliedAt ? iso(c.appliedAt) : null,
            journalId: c.journalId,
            auditEventId: c.auditEventId,
            problemCode: c.problemCode,
            problemDetail: c.problemDetail,
          }
        : null,
    };
  }

  /**
   * The projection itself. Each change is measured against the live balances with the real domain
   * functions; a reduction below the floor comes back blocked with the same code and message the
   * real command would answer with, so the editor can say "reduce by 14.4% instead".
   */
  private async computeImpact(
    tx: Tx,
    actor: RequestActor,
    row: ScenarioRow,
    changes: readonly ChangeRow[],
  ): Promise<ScenarioImpact> {
    const baseline = await this.baseline(tx, actor.tenantId);
    const budgetIds = [...new Set(changes.map((c) => c.budgetId))];
    const budgetRows = await this.reads.budgetRows(tx, budgetIds);
    const balances = await this.reads.balances(tx, budgetIds);
    const impacts: ScenarioChangeImpact[] = [];
    const blockingReasons: string[] = [];
    for (const change of changes) {
      const target = budgetRows.get(change.budgetId);
      if (!target) continue;
      const live = balances.get(change.budgetId)!.budget;
      const currency = target.currency;
      const money = (minor: number): Money => ({ amountMinor: minor, currency });
      const control = {
        basis: target.controlBasis.filter((b): b is (typeof CONSUMING_BUCKETS)[number] =>
          (CONSUMING_BUCKETS as readonly string[]).includes(b),
        ),
        mode: target.controlMode,
        toleranceBps: target.toleranceBps,
      };
      const requested = this.requestedReduction(change, live);
      const preview =
        change.kind === 'freeze'
          ? null
          : previewReduction(live, control, {
              kind: change.kind === 'set_to_zero' ? 'set_to_zero' : 'reduce',
              amountMinor: requested,
              cascade: change.cascade,
              childrenRetainedMinor: 0,
            });
      const floorMinor = reductionFloor(live, change.kind === 'set_to_zero' && change.cascade);
      const availableBefore = availableOf(live, CONSUMING_BUCKETS);
      const blocked = preview !== null && !preview.ok;
      if (blocked)
        blockingReasons.push(`${target.name}: ${preview.ok ? '' : preview.error.message}`);
      const availableAfter = preview?.ok ? preview.value.availableAfterMinor : availableBefore;
      impacts.push({
        changeId: change.id,
        budgetId: target.id,
        budgetName: target.name,
        kind: change.kind as ScenarioChangeImpact['kind'],
        currentAuthorized: money(live.authorized),
        floor: money(preview?.ok ? preview.value.floorMinor : floorMinor),
        reduction: money(preview?.ok ? preview.value.reductionMinor : 0),
        newAuthorized: money(preview?.ok ? preview.value.newAuthorizedMinor : live.authorized),
        availableBefore: money(availableBefore),
        availableAfter: money(availableAfter),
        maxReduction: money(Math.max(live.authorized - reductionFloor(live, false), 0)),
        unfitRequestIds: await this.unfitRequestIds(tx, target.id, availableAfter),
        blocked,
        problemCode: preview && !preview.ok ? preview.error.code : null,
        problemDetail: preview && !preview.ok ? preview.error.message : null,
      });
    }
    const company = await this.companyAvailable(tx, actor.tenantId);
    const reallocated = impacts
      .filter((i) => i.kind !== 'freeze')
      .reduce(
        (sum, i) =>
          // Money sent to savings leaves the company; a reallocation or a move to the parent stays.
          sum +
          (changes.find((c) => c.id === i.changeId)?.destination === 'savings'
            ? i.reduction.amountMinor
            : 0),
        0,
      );
    return {
      scenarioId: row.id,
      computedAt: iso(new Date()),
      baselineAt: iso(row.baselineAt),
      stale: baseline.journalCount !== row.baselineJournalCount,
      ledgerWritesSinceBaseline: Math.max(baseline.journalCount - row.baselineJournalCount, 0),
      companyAvailableBefore: { amountMinor: company, currency: actor.reportingCurrency },
      companyAvailableAfter: {
        amountMinor: company - reallocated,
        currency: actor.reportingCurrency,
      },
      changes: impacts.sort(
        (a, b) => a.budgetName.localeCompare(b.budgetName) || a.changeId.localeCompare(b.changeId),
      ),
      atRisk: await this.atRisk(tx, budgetIds, budgetRows),
      fairness: await this.fairness(tx, actor.tenantId, impacts, budgetRows),
      blocked: impacts.some((i) => i.blocked),
      blockingReasons,
    };
  }

  private requestedReduction(change: ChangeRow, live: BucketBalances): number {
    if (change.kind === 'set_to_zero') return 0;
    if (change.percentBps) return Math.round((live.authorized * change.percentBps) / 10_000);
    return Number(change.amountMinor ?? 0);
  }

  private async unfitRequestIds(
    tx: Tx,
    budgetId: string,
    availableAfterMinor: number,
  ): Promise<string[]> {
    if (availableAfterMinor >= 0) return [];
    const rows = await tx
      .select({ id: requests.id })
      .from(requests)
      .where(and(eq(requests.budgetId, budgetId), eq(requests.status, 'pending_approval')))
      .orderBy(asc(requests.id));
    return rows.map((r) => r.id);
  }

  private async atRisk(
    tx: Tx,
    budgetIds: readonly string[],
    budgetRows: Map<string, BudgetRow>,
  ): Promise<ScenarioAtRisk[]> {
    if (budgetIds.length === 0) return [];
    const open = await tx
      .select({
        budgetId: commitments.budgetId,
        amountMinor: commitments.amountMinor,
        status: commitments.status,
        eventName: events.name,
      })
      .from(commitments)
      .leftJoin(events, eq(events.id, commitments.eventId))
      .where(
        and(
          inArray(commitments.budgetId, [...budgetIds]),
          inArray(commitments.status, ['pre_encumbered', 'encumbered', 'partially_consumed']),
        ),
      );
    const pending = await tx
      .select({ budgetId: requests.budgetId, id: requests.id })
      .from(requests)
      .where(
        and(inArray(requests.budgetId, [...budgetIds]), eq(requests.status, 'pending_approval')),
      );
    return [...budgetIds]
      .map((id) => {
        const row = budgetRows.get(id);
        const mine = open.filter((c) => c.budgetId === id);
        return {
          budgetId: id,
          budgetName: row?.name ?? '',
          committed: {
            amountMinor: mine
              .filter((c) => c.status !== 'pre_encumbered')
              .reduce((s, c) => s + Number(c.amountMinor), 0),
            currency: row?.currency ?? 'USD',
          },
          openCommitmentCount: mine.length,
          pendingRequestCount: pending.filter((p) => p.budgetId === id).length,
          eventNames: [
            ...new Set(mine.map((c) => c.eventName).filter((n): n is string => Boolean(n))),
          ].sort((a, b) => a.localeCompare(b)),
        };
      })
      .filter((r) => r.openCommitmentCount > 0 || r.pendingRequestCount > 0)
      .sort(
        (a, b) => a.budgetName.localeCompare(b.budgetName) || a.budgetId.localeCompare(b.budgetId),
      );
  }

  /** Spend per eligible head before and after, from the latest headcount snapshot (15a). */
  private async fairness(
    tx: Tx,
    tenantId: string,
    impacts: readonly ScenarioChangeImpact[],
    budgetRows: Map<string, BudgetRow>,
  ): Promise<ScenarioFairnessRow[]> {
    const unitIds = [
      ...new Set(
        impacts
          .map((i) => budgetRows.get(i.budgetId)?.orgUnitId)
          .filter((v): v is string => Boolean(v)),
      ),
    ];
    if (unitIds.length === 0) return [];
    const [snapshot] = await tx
      .select({ id: headcountSnapshots.id })
      .from(headcountSnapshots)
      .where(eq(headcountSnapshots.tenantId, tenantId))
      .orderBy(sql`${headcountSnapshots.asOfDate} desc`)
      .limit(1);
    if (!snapshot) return [];
    const lines = await tx
      .select({
        orgUnitId: headcountSnapshotLines.orgUnitId,
        headcount: headcountSnapshotLines.headcount,
      })
      .from(headcountSnapshotLines)
      .where(
        and(
          eq(headcountSnapshotLines.snapshotId, snapshot.id),
          eq(headcountSnapshotLines.employmentType, 'employee'),
          inArray(headcountSnapshotLines.orgUnitId, unitIds),
        ),
      );
    const heads = new Map<string, number>();
    for (const line of lines)
      heads.set(line.orgUnitId, (heads.get(line.orgUnitId) ?? 0) + line.headcount);
    return impacts
      .map((i) => {
        const row = budgetRows.get(i.budgetId);
        const headcount = heads.get(row?.orgUnitId ?? '') ?? 0;
        const perHead = (minor: number): Money | null =>
          headcount > 0
            ? { amountMinor: Math.round(minor / headcount), currency: i.currentAuthorized.currency }
            : null;
        return {
          budgetId: i.budgetId,
          budgetName: i.budgetName,
          eligibleHeadcount: headcount,
          perHeadBefore: perHead(i.currentAuthorized.amountMinor),
          perHeadAfter: perHead(i.newAuthorized.amountMinor),
        };
      })
      .filter((r) => r.eligibleHeadcount > 0)
      .sort(
        (a, b) => a.budgetName.localeCompare(b.budgetName) || a.budgetId.localeCompare(b.budgetId),
      );
  }

  /** Company-wide Available: authorized minus every consuming bucket over the root subtrees. */
  private async companyAvailable(tx: Tx, tenantId: string): Promise<number> {
    const roots = await tx
      .select({ id: budgets.id, path: budgets.path })
      .from(budgets)
      .where(and(eq(budgets.tenantId, tenantId), eq(budgets.depth, 0)));
    if (roots.length === 0) return 0;
    const ids: string[] = [];
    for (const root of roots) {
      const subtree = await tx
        .select({ id: budgets.id })
        .from(budgets)
        .where(and(eq(budgets.tenantId, tenantId), like(budgets.path, `${root.path}%`)));
      ids.push(...subtree.map((s) => s.id));
    }
    const balances = await this.reads.balances(tx, [...new Set(ids)]);
    let total = 0;
    for (const pair of balances.values()) total += availableOf(pair.reporting, CONSUMING_BUCKETS);
    return total;
  }
}
