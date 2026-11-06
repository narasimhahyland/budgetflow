import { AuditService } from '@bf/api/audit';
import { ApiProblem, CommandRunner, DB, PolicyService, type RequestActor } from '@bf/api/core';
import {
  adminChangeRequests,
  legalHolds,
  retentionPolicies,
  retentionRunItems,
  retentionRuns,
  tenants,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import type {
  AdminChangeRequest,
  AdminDecisionRequest,
  LegalHold as LegalHoldContract,
  LegalHoldDecisionRequest,
  LegalHoldList,
  PlaceLegalHoldRequest,
  RetentionPolicy,
  RetentionPolicyList,
  RetentionRun,
  RetentionRunList,
  StartRetentionRunRequest,
  UpdateRetentionPolicyRequest,
  UpdateRetentionPolicyResult,
} from '@bf/contracts';
import {
  applyLegalHolds,
  AUTOMATIC_RETENTION_CATEGORIES,
  describeDays,
  planRetentionChange,
  RETENTION_CATALOG,
  retentionCategory,
  retentionCutoff,
  retentionScopeKey,
  type LegalHold,
  type RetentionCategoryDefinition,
} from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { assertAnyTenant, assertTenant, personNames, type CommandContext } from './admin-reads';
import { handlerFor } from './retention-engine';

type PolicyRow = typeof retentionPolicies.$inferSelect;
type HoldRow = typeof legalHolds.$inferSelect;
type ChangeRow = typeof adminChangeRequests.$inferSelect;
type RunRow = typeof retentionRuns.$inferSelect;
type RunItemRow = typeof retentionRunItems.$inferSelect;

const STANDING_NOTE =
  'Accounting records and the audit trail are never deleted, whatever these settings say. Every period below is a provisional default pending finance and legal sign-off.';

/** How long a preview stays good enough to act on. */
const DRY_RUN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Data retention and legal holds (111).
 *
 * Deletion is irreversible, so it is fenced in three ways: a dry run has to precede an apply run and
 * the apply run repeats its scope exactly; the person applying needs `retention.confirm` and types
 * the confirmation word; and `applyLegalHolds` in `libs/domain` removes every held record from the
 * list before anything is touched, with the holds recorded in the run report.
 */
@Injectable()
export class RetentionService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  private assertMayEdit(actor: RequestActor): void {
    assertAnyTenant(this.policy, actor, ['tenant.settings.manage', 'master_data.manage']);
  }

  /** The stored policy for a category, falling back to the provisional catalog default. */
  private policyView(
    definition: RetentionCategoryDefinition,
    row: PolicyRow | undefined,
    pending: ChangeRow | undefined,
    names: Map<string, string>,
  ): RetentionPolicy {
    const periodDays = row ? row.periodDays : definition.defaultPeriodDays;
    return {
      category: definition.category,
      label: definition.label,
      covers: definition.covers,
      action: definition.action,
      periodDays,
      periodLabel:
        periodDays === null
          ? definition.periodLabel
          : periodDays === definition.defaultPeriodDays
            ? definition.periodLabel
            : `${describeDays(periodDays)}, then ${definition.action === 'anonymise' ? 'anonymised' : definition.action === 'archive' ? 'archived read-only' : 'deleted'}.`,
      minimumDays: definition.minimumDays,
      minimumLabel: definition.minimumDays === null ? null : describeDays(definition.minimumDays),
      locked: definition.locked,
      lockedReason: definition.locked ? definition.periodLabel : null,
      financial: definition.financial,
      automation: definition.automation,
      signoffStatus: (row?.signoffStatus ?? 'provisional') as 'provisional' | 'approved',
      signoffNote: row?.signoffNote ?? null,
      pendingChange: pending ? this.changeView(pending, names) : null,
      updatedAt: (row?.updatedAt ?? new Date(0)).toISOString(),
    };
  }

  private changeView(row: ChangeRow, names: Map<string, string>): AdminChangeRequest {
    const payload = row.payload as { periodDays: number | null; fromPeriodDays: number | null };
    const definition = retentionCategory(row.subjectKey);
    const to = payload?.periodDays;
    return {
      id: row.id,
      kind: 'retention_policy',
      subjectKey: row.subjectKey,
      status: row.status as AdminChangeRequest['status'],
      needsConfirmation: row.needsConfirmation,
      reason: row.reason,
      requestedByName: row.requestedByPersonId
        ? (names.get(row.requestedByPersonId) ?? null)
        : null,
      requestedAt: row.createdAt.toISOString(),
      confirmedByName: row.confirmedByPersonId
        ? (names.get(row.confirmedByPersonId) ?? null)
        : null,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      decisionReason: row.decisionReason,
      summary: `Keep ${definition?.label ?? row.subjectKey} for ${
        to === null || to === undefined ? 'ever' : describeDays(to)
      }`,
    };
  }

  listPolicies(actor: RequestActor): Promise<RetentionPolicyList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      assertTenant(this.policy, actor, 'tenant.read');
      const rows = await tx.select().from(retentionPolicies);
      const byCategory = new Map(rows.map((r) => [r.category, r]));
      const pending = await tx
        .select()
        .from(adminChangeRequests)
        .where(
          and(
            eq(adminChangeRequests.kind, 'retention_policy'),
            eq(adminChangeRequests.status, 'pending'),
          ),
        );
      const names = await personNames(tx, [
        ...pending.map((p) => p.requestedByPersonId),
        ...pending.map((p) => p.confirmedByPersonId),
      ]);
      const items = RETENTION_CATALOG.map((definition) =>
        this.policyView(
          definition,
          byCategory.get(definition.category),
          pending.find((p) => p.subjectKey === definition.category),
          names,
        ),
      ).sort((a, b) => a.label.localeCompare(b.label) || a.category.localeCompare(b.category));
      return { items, note: STANDING_NOTE };
    });
  }

  updatePolicy(
    actor: RequestActor,
    category: string,
    req: UpdateRetentionPolicyRequest,
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `admin.retention.policy:${category}`,
        request: req,
        status: 200,
      },
      async (tx): Promise<UpdateRetentionPolicyResult> => {
        this.assertMayEdit(actor);
        const definition = retentionCategory(category);
        if (!definition) throw ApiProblem.notFound('retention category');
        const [row] = await tx
          .select()
          .from(retentionPolicies)
          .where(eq(retentionPolicies.category, category))
          .for('update');
        const current = row ? row.periodDays : definition.defaultPeriodDays;
        const planned = planRetentionChange({
          definition,
          currentPeriodDays: current,
          periodDays: req.periodDays,
        });
        if (!planned.ok) {
          const status = planned.code === 'RETENTION_CATEGORY_LOCKED' ? 409 : 422;
          throw new ApiProblem(status, planned.code, planned.message);
        }
        const open = await tx
          .select({ id: adminChangeRequests.id })
          .from(adminChangeRequests)
          .where(
            and(
              eq(adminChangeRequests.kind, 'retention_policy'),
              eq(adminChangeRequests.subjectKey, category),
              eq(adminChangeRequests.status, 'pending'),
            ),
          );
        if (open.length > 0)
          throw new ApiProblem(
            409,
            'CHANGE_NOT_PENDING',
            'A change to this category is already waiting for confirmation.',
          );

        const needsConfirmation = planned.change.needsConfirmation;
        const [change] = await tx
          .insert(adminChangeRequests)
          .values({
            tenantId: actor.tenantId,
            kind: 'retention_policy',
            subjectKey: category,
            payload: { periodDays: req.periodDays, fromPeriodDays: current },
            reason: req.reason,
            requestedByPersonId: actor.personId,
            requestedBySubject: actor.subject,
            status: needsConfirmation ? 'pending' : 'applied',
            needsConfirmation,
            decidedAt: needsConfirmation ? null : new Date(),
          })
          .returning();
        if (!needsConfirmation) await this.persistPolicy(tx, actor, definition, req.periodDays);
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: needsConfirmation
            ? 'admin.retention_policy.change_requested'
            : 'admin.retention_policy.changed',
          resourceType: 'retention_policy',
          resourceId: category,
          requestId: ctx.requestId,
          reason: req.reason,
          changes: { periodDays: { from: current, to: req.periodDays } },
        });
        const names = await personNames(tx, [actor.personId]);
        return {
          category,
          applied: !needsConfirmation,
          periodDays: needsConfirmation ? current : req.periodDays,
          pendingChange: needsConfirmation ? this.changeView(change, names) : null,
        };
      },
    );
  }

  private async persistPolicy(
    tx: Tx,
    actor: RequestActor,
    definition: RetentionCategoryDefinition,
    periodDays: number | null,
  ): Promise<void> {
    await tx
      .insert(retentionPolicies)
      .values({
        tenantId: actor.tenantId,
        category: definition.category,
        periodDays,
        action: definition.action,
        minimumDays: definition.minimumDays,
        locked: definition.locked,
        updatedByPersonId: actor.personId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [retentionPolicies.tenantId, retentionPolicies.category],
        set: { periodDays, updatedByPersonId: actor.personId, updatedAt: new Date() },
      });
  }

  decidePolicyChange(
    actor: RequestActor,
    changeId: string,
    req: AdminDecisionRequest,
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `admin.retention.decision:${changeId}`,
        request: req,
        status: 201,
      },
      async (tx): Promise<UpdateRetentionPolicyResult> => {
        const [change] = await tx
          .select()
          .from(adminChangeRequests)
          .where(
            and(
              eq(adminChangeRequests.id, changeId),
              eq(adminChangeRequests.kind, 'retention_policy'),
            ),
          )
          .for('update');
        if (!change) throw ApiProblem.notFound('retention change');
        if (change.status !== 'pending')
          throw new ApiProblem(
            409,
            'CHANGE_NOT_PENDING',
            'This retention change has already been decided.',
          );
        const definition = retentionCategory(change.subjectKey);
        if (!definition) throw ApiProblem.notFound('retention category');

        if (req.decision === 'cancel') {
          if (!actor.personId || actor.personId !== change.requestedByPersonId)
            throw ApiProblem.forbidden(
              'Only the person who asked for this change can withdraw it.',
            );
        } else {
          assertTenant(this.policy, actor, 'retention.confirm', 'retention confirmation');
          if (actor.personId && actor.personId === change.requestedByPersonId)
            throw new ApiProblem(
              409,
              'SAME_PERSON_APPROVAL',
              'The person who asked for this change cannot confirm it.',
            );
        }

        const payload = change.payload as {
          periodDays: number | null;
          fromPeriodDays: number | null;
        };
        const status =
          req.decision === 'confirm'
            ? 'applied'
            : req.decision === 'decline'
              ? 'declined'
              : 'cancelled';
        await tx
          .update(adminChangeRequests)
          .set({
            status,
            confirmedByPersonId: req.decision === 'cancel' ? null : actor.personId,
            decidedAt: new Date(),
            decisionReason: req.reason,
          })
          .where(eq(adminChangeRequests.id, change.id));
        if (req.decision === 'confirm')
          await this.persistPolicy(tx, actor, definition, payload.periodDays);
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: `admin.retention_policy.${status}`,
          resourceType: 'retention_policy',
          resourceId: change.subjectKey,
          requestId: ctx.requestId,
          reason: req.reason,
          changes: { changeId: change.id, decision: req.decision, periodDays: payload.periodDays },
        });
        const names = await personNames(tx, [change.requestedByPersonId, actor.personId]);
        const [after] = await tx
          .select()
          .from(adminChangeRequests)
          .where(eq(adminChangeRequests.id, change.id));
        const [row] = await tx
          .select()
          .from(retentionPolicies)
          .where(eq(retentionPolicies.category, change.subjectKey));
        return {
          category: change.subjectKey,
          applied: req.decision === 'confirm',
          periodDays: row ? row.periodDays : definition.defaultPeriodDays,
          pendingChange: this.changeView(after, names),
        };
      },
    );
  }

  // Legal holds ---------------------------------------------------------------------------------

  private holdView(row: HoldRow, names: Map<string, string>): LegalHoldContract {
    const scopeLabel =
      row.scopeKind === 'date_range'
        ? `Records dated ${row.scopeFrom ?? 'any time'} to ${row.scopeTo ?? 'any time'}`
        : `${row.scopeKind.charAt(0).toUpperCase()}${row.scopeKind.slice(1)} ${row.scopeRefId ?? ''}`.trim();
    return {
      id: row.id,
      scopeKind: row.scopeKind as LegalHoldContract['scopeKind'],
      scopeRefId: row.scopeRefId,
      scopeLabel,
      scopeFrom: row.scopeFrom,
      scopeTo: row.scopeTo,
      reason: row.reason,
      status: row.status as LegalHoldContract['status'],
      placedByName: row.placedByPersonId ? (names.get(row.placedByPersonId) ?? null) : null,
      confirmedByName: row.confirmedByPersonId
        ? (names.get(row.confirmedByPersonId) ?? null)
        : null,
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      releasedByName: row.releasedByPersonId ? (names.get(row.releasedByPersonId) ?? null) : null,
      releasedAt: row.releasedAt?.toISOString() ?? null,
      releaseReason: row.releaseReason,
      createdAt: row.createdAt.toISOString(),
    };
  }

  listHolds(actor: RequestActor, query: { status?: string }): Promise<LegalHoldList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      assertTenant(this.policy, actor, 'tenant.read');
      const rows = await tx
        .select()
        .from(legalHolds)
        .where(query.status ? eq(legalHolds.status, query.status) : undefined)
        .orderBy(desc(legalHolds.createdAt), asc(legalHolds.id));
      const names = await personNames(tx, [
        ...rows.map((r) => r.placedByPersonId),
        ...rows.map((r) => r.confirmedByPersonId),
        ...rows.map((r) => r.releasedByPersonId),
      ]);
      return { items: rows.map((r) => this.holdView(r, names)) };
    });
  }

  placeHold(actor: RequestActor, req: PlaceLegalHoldRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'admin.retention.hold',
        request: req,
        status: 201,
      },
      async (tx): Promise<LegalHoldContract> => {
        assertTenant(this.policy, actor, 'legal_hold.manage', 'legal hold');
        if (req.scopeKind === 'date_range') {
          if (!req.scopeFrom && !req.scopeTo)
            throw new ApiProblem(
              422,
              'LEGAL_HOLD_SCOPE_INVALID',
              'A date-range hold needs a start date, an end date, or both.',
            );
          if (req.scopeRefId)
            throw new ApiProblem(
              422,
              'LEGAL_HOLD_SCOPE_INVALID',
              'A date-range hold does not take a record id.',
            );
        } else if (!req.scopeRefId) {
          throw new ApiProblem(
            422,
            'LEGAL_HOLD_SCOPE_INVALID',
            `A ${req.scopeKind} hold needs the ${req.scopeKind} it covers.`,
          );
        }
        const [row] = await tx
          .insert(legalHolds)
          .values({
            tenantId: actor.tenantId,
            scopeKind: req.scopeKind,
            scopeRefId: req.scopeRefId,
            scopeFrom: req.scopeFrom,
            scopeTo: req.scopeTo,
            reason: req.reason,
            placedByPersonId: actor.personId,
            status: 'pending_confirmation',
          })
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'admin.legal_hold.placed',
          resourceType: 'legal_hold',
          resourceId: row.id,
          requestId: ctx.requestId,
          reason: req.reason,
          changes: {
            scopeKind: req.scopeKind,
            scopeRefId: req.scopeRefId,
            scopeFrom: req.scopeFrom,
            scopeTo: req.scopeTo,
            status: { from: null, to: 'pending_confirmation' },
          },
        });
        const names = await personNames(tx, [actor.personId]);
        return this.holdView(row, names);
      },
    );
  }

  decideHold(
    actor: RequestActor,
    holdId: string,
    req: LegalHoldDecisionRequest,
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `admin.retention.hold_decision:${holdId}`,
        request: req,
        status: 201,
      },
      async (tx): Promise<LegalHoldContract> => {
        assertTenant(this.policy, actor, 'legal_hold.manage', 'legal hold');
        const [hold] = await tx
          .select()
          .from(legalHolds)
          .where(eq(legalHolds.id, holdId))
          .for('update');
        if (!hold) throw ApiProblem.notFound('legal hold');

        if (req.decision === 'release') {
          if (hold.status !== 'active')
            throw new ApiProblem(
              409,
              'LEGAL_HOLD_NOT_ACTIVE',
              'Only an active hold can be released.',
            );
          await tx
            .update(legalHolds)
            .set({
              status: 'released',
              releasedByPersonId: actor.personId,
              releasedAt: new Date(),
              releaseReason: req.reason,
            })
            .where(eq(legalHolds.id, hold.id));
        } else {
          if (hold.status !== 'pending_confirmation')
            throw new ApiProblem(
              409,
              'LEGAL_HOLD_NOT_PENDING',
              'This hold has already been confirmed or declined.',
            );
          // Two people: the person who placed the hold cannot confirm it.
          if (actor.personId && actor.personId === hold.placedByPersonId)
            throw new ApiProblem(
              409,
              'SAME_PERSON_APPROVAL',
              'The person who placed this hold cannot confirm it.',
            );
          await tx
            .update(legalHolds)
            .set({
              status: req.decision === 'confirm' ? 'active' : 'declined',
              confirmedByPersonId: actor.personId,
              confirmedAt: new Date(),
              releaseReason: req.decision === 'decline' ? req.reason : null,
            })
            .where(eq(legalHolds.id, hold.id));
        }

        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: `admin.legal_hold.${req.decision === 'release' ? 'released' : req.decision === 'confirm' ? 'confirmed' : 'declined'}`,
          resourceType: 'legal_hold',
          resourceId: hold.id,
          requestId: ctx.requestId,
          reason: req.reason,
          changes: { status: { from: hold.status, to: req.decision } },
        });
        const [after] = await tx.select().from(legalHolds).where(eq(legalHolds.id, hold.id));
        const names = await personNames(tx, [
          after.placedByPersonId,
          after.confirmedByPersonId,
          after.releasedByPersonId,
        ]);
        return this.holdView(after, names);
      },
    );
  }

  // Runs ------------------------------------------------------------------------------------------

  private runView(row: RunRow, items: RunItemRow[], names: Map<string, string>): RetentionRun {
    const ordered = [...items].sort(
      (a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id),
    );
    const applied = ordered.reduce((n, i) => n + i.appliedCount, 0);
    const held = ordered.reduce((n, i) => n + i.skippedHoldCount, 0);
    const candidates = ordered.reduce((n, i) => n + i.candidateCount, 0);
    const summary =
      row.mode === 'dry_run'
        ? `${candidates} record(s) would be removed or anonymised; ${held} kept by a legal hold.`
        : `${applied} record(s) removed or anonymised; ${held} kept by a legal hold.`;
    return {
      id: row.id,
      mode: row.mode as RetentionRun['mode'],
      trigger: row.trigger as RetentionRun['trigger'],
      status: row.status as RetentionRun['status'],
      categories: [...row.categories],
      dryRunId: row.dryRunId,
      requestedByName: row.requestedByPersonId
        ? (names.get(row.requestedByPersonId) ?? null)
        : null,
      confirmedByName: row.confirmedByPersonId
        ? (names.get(row.confirmedByPersonId) ?? null)
        : null,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
      error: row.error,
      items: ordered.map((i) => ({
        category: i.category,
        label: retentionCategory(i.category)?.label ?? i.category,
        action: i.action as RetentionRun['items'][number]['action'],
        cutoffAt: i.cutoffAt?.toISOString() ?? null,
        candidateCount: i.candidateCount,
        appliedCount: i.appliedCount,
        skippedHoldCount: i.skippedHoldCount,
        holdIds: [...i.holdIds],
        note: i.note,
      })),
      summary,
    };
  }

  listRuns(actor: RequestActor): Promise<RetentionRunList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      assertTenant(this.policy, actor, 'tenant.read');
      const rows = await tx
        .select()
        .from(retentionRuns)
        .orderBy(desc(retentionRuns.startedAt), asc(retentionRuns.id))
        .limit(50);
      if (!rows.length) return { items: [] };
      const items = await tx
        .select()
        .from(retentionRunItems)
        .where(
          inArray(
            retentionRunItems.runId,
            rows.map((r) => r.id),
          ),
        );
      const names = await personNames(tx, [
        ...rows.map((r) => r.requestedByPersonId),
        ...rows.map((r) => r.confirmedByPersonId),
      ]);
      return {
        items: rows.map((r) =>
          this.runView(
            r,
            items.filter((i) => i.runId === r.id),
            names,
          ),
        ),
      };
    });
  }

  getRun(actor: RequestActor, runId: string): Promise<RetentionRun> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      assertTenant(this.policy, actor, 'tenant.read');
      const [row] = await tx.select().from(retentionRuns).where(eq(retentionRuns.id, runId));
      if (!row) throw ApiProblem.notFound('retention run');
      const items = await tx
        .select()
        .from(retentionRunItems)
        .where(eq(retentionRunItems.runId, runId));
      const names = await personNames(tx, [row.requestedByPersonId, row.confirmedByPersonId]);
      return this.runView(row, items, names);
    });
  }

  /** The periods in force now, for the categories asked for. */
  private async effectivePeriods(
    tx: Tx,
    categories: readonly string[],
  ): Promise<{ definition: RetentionCategoryDefinition; periodDays: number | null }[]> {
    const rows = await tx.select().from(retentionPolicies);
    const byCategory = new Map(rows.map((r) => [r.category, r]));
    return categories
      .map((category) => retentionCategory(category))
      .filter((d): d is RetentionCategoryDefinition => Boolean(d))
      .map((definition) => {
        const row = byCategory.get(definition.category);
        return { definition, periodDays: row ? row.periodDays : definition.defaultPeriodDays };
      });
  }

  private async activeHolds(tx: Tx): Promise<LegalHold[]> {
    const rows = await tx.select().from(legalHolds).where(eq(legalHolds.status, 'active'));
    return rows.map((r) => ({
      id: r.id,
      scopeKind: r.scopeKind as LegalHold['scopeKind'],
      scopeRefId: r.scopeRefId,
      scopeFrom: r.scopeFrom,
      scopeTo: r.scopeTo,
    }));
  }

  /**
   * Does the work and writes the append-only report. Legal holds are applied here, between finding
   * the records and touching them, so no caller can skip them.
   */
  private async execute(
    tx: Tx,
    input: {
      tenantId: string;
      mode: 'dry_run' | 'apply';
      trigger: 'manual' | 'scheduled';
      categories: readonly string[];
      dryRunId: string | null;
      requestedByPersonId: string | null;
      confirmedByPersonId: string | null;
    },
  ): Promise<{ run: RunRow; items: RunItemRow[] }> {
    const startedAt = new Date();
    const periods = await this.effectivePeriods(tx, input.categories);
    const holds = await this.activeHolds(tx);
    const scopeKey = retentionScopeKey(
      periods.map((p) => ({ category: p.definition.category, periodDays: p.periodDays })),
    );

    const [run] = await tx
      .insert(retentionRuns)
      .values({
        tenantId: input.tenantId,
        mode: input.mode,
        trigger: input.trigger,
        status: 'completed',
        categories: periods.map((p) => p.definition.category),
        dryRunId: input.dryRunId,
        scopeKey,
        requestedByPersonId: input.requestedByPersonId,
        confirmedByPersonId: input.confirmedByPersonId,
        startedAt,
        finishedAt: new Date(),
      })
      .returning();

    const itemValues: (typeof retentionRunItems.$inferInsert)[] = [];
    for (const { definition, periodDays } of periods) {
      const handler = handlerFor(definition.category);
      const cutoff = retentionCutoff(startedAt, periodDays);
      if (!handler || cutoff === null || definition.action === 'never') {
        itemValues.push({
          tenantId: input.tenantId,
          runId: run.id,
          category: definition.category,
          action: definition.action,
          cutoffAt: cutoff,
          note:
            definition.action === 'never'
              ? 'Never removed: accounting records and the audit trail are kept permanently.'
              : !handler
                ? 'No automatic step for this category yet; the period is a stated policy only.'
                : 'Kept permanently by the period in force.',
        });
        continue;
      }
      const candidates = await handler.collect(tx, cutoff);
      const { affected, held } = applyLegalHolds(candidates, holds);
      const appliedCount =
        input.mode === 'apply'
          ? await handler.apply(
              tx,
              affected.map((c) => c.id),
            )
          : 0;
      const holdIds = [...new Set(held.flatMap((h) => h.holdIds))].sort();
      itemValues.push({
        tenantId: input.tenantId,
        runId: run.id,
        category: definition.category,
        action: definition.action,
        cutoffAt: cutoff,
        candidateCount: affected.length,
        appliedCount,
        skippedHoldCount: held.length,
        holdIds,
        note:
          held.length > 0
            ? `${held.length} record(s) kept by ${holdIds.length} legal hold(s); a hold always beats retention.`
            : null,
      });
    }
    const items = itemValues.length
      ? await tx.insert(retentionRunItems).values(itemValues).returning()
      : [];
    return { run, items };
  }

  startRun(actor: RequestActor, req: StartRetentionRunRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'admin.retention.run',
        request: req,
        status: 201,
      },
      async (tx): Promise<RetentionRun> => {
        this.assertMayEdit(actor);
        const requested = req.categories.length
          ? [...req.categories]
          : [...AUTOMATIC_RETENTION_CATEGORIES];
        const unknown = requested.filter((c) => !retentionCategory(c));
        if (unknown.length) throw ApiProblem.notFound(`retention category ${unknown[0]}`);
        const categories = [...requested].sort();

        let dryRunId: string | null = null;
        let confirmedBy: string | null = null;
        if (req.mode === 'apply') {
          // Irreversible: a named preview, a typed confirmation and `retention.confirm`.
          assertTenant(this.policy, actor, 'retention.confirm', 'retention run');
          if (req.confirmation !== 'DELETE')
            throw new ApiProblem(
              422,
              'CONFIRMATION_MISMATCH',
              'Deleting data is irreversible. Type DELETE to confirm.',
            );
          if (!req.dryRunId)
            throw new ApiProblem(
              409,
              'RETENTION_DRY_RUN_REQUIRED',
              'Preview the run first, then apply that preview.',
            );
          const [dry] = await tx
            .select()
            .from(retentionRuns)
            .where(eq(retentionRuns.id, req.dryRunId));
          if (!dry || dry.mode !== 'dry_run') throw ApiProblem.notFound('retention preview');
          if (Date.now() - dry.startedAt.getTime() > DRY_RUN_MAX_AGE_MS)
            throw new ApiProblem(
              409,
              'RETENTION_DRY_RUN_REQUIRED',
              'That preview is more than a day old. Preview the run again.',
            );
          const widened = categories.filter((c) => !dry.categories.includes(c));
          if (widened.length)
            throw new ApiProblem(
              409,
              'RETENTION_SCOPE_WIDENED',
              `The preview did not cover ${widened.join(', ')}. A run can only apply what was previewed.`,
            );
          // The periods must still be the ones the preview was taken under, or the run could remove
          // more than the preview showed.
          const periods = await this.effectivePeriods(tx, categories);
          const previewedParts = new Set(dry.scopeKey.split('|'));
          const changed = periods
            .map((p) =>
              retentionScopeKey([{ category: p.definition.category, periodDays: p.periodDays }]),
            )
            .filter((part) => !previewedParts.has(part));
          if (changed.length)
            throw new ApiProblem(
              409,
              'RETENTION_SCOPE_WIDENED',
              'A retention period changed since the preview. Preview the run again.',
            );
          dryRunId = dry.id;
          confirmedBy = actor.personId;
        }

        const { run, items } = await this.execute(tx, {
          tenantId: actor.tenantId,
          mode: req.mode,
          trigger: 'manual',
          categories,
          dryRunId,
          requestedByPersonId: actor.personId,
          confirmedByPersonId: confirmedBy,
        });
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action:
            req.mode === 'apply' ? 'admin.retention_run.applied' : 'admin.retention_run.previewed',
          resourceType: 'retention_run',
          resourceId: run.id,
          requestId: ctx.requestId,
          reason: req.reason,
          changes: {
            mode: req.mode,
            categories,
            dryRunId,
            removed: items.reduce((n, i) => n + i.appliedCount, 0),
            keptByLegalHold: items.reduce((n, i) => n + i.skippedHoldCount, 0),
          },
        });
        const names = await personNames(tx, [actor.personId]);
        return this.runView(run, items, names);
      },
    );
  }

  /**
   * The nightly run (worker). Its scope is fixed to the categories the engine can act on and the
   * periods in force: it can never be asked to cover anything else.
   */
  async runScheduled(tenantId: string): Promise<{ runId: string; removed: number; held: number }> {
    return withTenant(this.db, { tenantId, subject: 'system:worker' }, async (tx) => {
      const { run, items } = await this.execute(tx, {
        tenantId,
        mode: 'apply',
        trigger: 'scheduled',
        categories: [...AUTOMATIC_RETENTION_CATEGORIES].sort(),
        dryRunId: null,
        requestedByPersonId: null,
        confirmedByPersonId: null,
      });
      const removed = items.reduce((n, i) => n + i.appliedCount, 0);
      const held = items.reduce((n, i) => n + i.skippedHoldCount, 0);
      await this.audit.append(tx, {
        tenantId,
        actorPersonId: null,
        actorSubject: 'system:worker',
        action: 'admin.retention_run.applied',
        resourceType: 'retention_run',
        resourceId: run.id,
        reason: 'Nightly retention run.',
        changes: {
          mode: 'apply',
          trigger: 'scheduled',
          categories: run.categories,
          removed,
          keptByLegalHold: held,
        },
      });
      return { runId: run.id, removed, held };
    });
  }

  /** The nightly sweep across every tenant. Returns how many tenants it ran for. */
  async runNightly(): Promise<number> {
    const all = await this.db.transaction(async (tx) =>
      tx.select({ id: tenants.id }).from(tenants),
    );
    for (const t of all) await this.runScheduled(t.id);
    return all.length;
  }
}
