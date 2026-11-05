import { personNames } from '@bf/api/approvals';
import { AuditService } from '@bf/api/audit';
import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  type CommandResult,
  type RequestActor,
} from '@bf/api/core';
import {
  approvalDelegations,
  approvalTasks,
  doaLimits,
  doaMatrixVersions,
  legalEntities,
  rules,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import type {
  ApproveDoaVersionRequest,
  DoaAdminRow,
  DoaMatrixAdminView,
  DoaMatrixVersionSummary,
  SaveDoaDraftRequest,
} from '@bf/contracts';
import type { RoleId } from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

interface Ctx {
  idempotencyKey: string;
  requestId: string | null;
}

const TENANT = (actor: RequestActor) => ({ kind: 'tenant' as const, tenantId: actor.tenantId });
const today = () => new Date().toISOString().slice(0, 10);

type VersionRow = typeof doaMatrixVersions.$inferSelect;

/**
 * Screen 070a: administration of the delegation-of-authority matrix. Finance drafts a version and
 * submits it; the CEO approves it (never the person who submitted it) and it becomes effective.
 */
@Injectable()
export class DoaAdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly commands: CommandRunner,
  ) {}

  private assertRead(actor: RequestActor): void {
    this.policy.assert(actor, 'doa.read', TENANT(actor), 'delegation-of-authority matrix');
  }

  /** The person who submitted a version for approval, from the audit trail. */
  private async submitterOf(tx: Tx, tenantId: string, versionId: string): Promise<string | null> {
    const submitted = await tx.execute(sql`
      select actor_person_id from audit_events
      where tenant_id = ${tenantId}
        and resource_type = 'doa_matrix_version'
        and resource_id = ${versionId}
        and action = 'doa.version_submitted'
      order by seq desc limit 1
    `);
    return (
      (submitted.rows[0] as { actor_person_id?: string | null } | undefined)?.actor_person_id ??
      null
    );
  }

  private toSummary(row: VersionRow, names: Map<string, string>): DoaMatrixVersionSummary {
    return {
      id: row.id,
      version: row.version,
      status: row.status as DoaMatrixVersionSummary['status'],
      validFrom: row.validFrom,
      validTo: row.validTo,
      approvedByName: row.approvedBy ? (names.get(row.approvedBy) ?? null) : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async view(actor: RequestActor, versionId?: string): Promise<DoaMatrixAdminView> {
    this.assertRead(actor);
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) =>
      this.viewTx(tx, actor, versionId),
    );
  }

  private async viewTx(
    tx: Tx,
    actor: RequestActor,
    versionId?: string,
  ): Promise<DoaMatrixAdminView> {
    const versionRows = await tx
      .select()
      .from(doaMatrixVersions)
      .where(eq(doaMatrixVersions.tenantId, actor.tenantId))
      .orderBy(desc(doaMatrixVersions.version));
    if (!versionRows.length) throw ApiProblem.notFound('delegation-of-authority matrix');

    const names = await personNames(
      tx,
      versionRows.map((v) => v.approvedBy),
    );
    const active = versionRows.find((v) => v.status === 'active') ?? null;
    const selected = versionId
      ? versionRows.find((v) => v.id === versionId)
      : (versionRows.find((v) => v.status === 'draft' || v.status === 'awaiting_approval') ??
        active ??
        versionRows[0]);
    if (!selected) throw ApiProblem.notFound('delegation-of-authority matrix version');

    const limitRows = await tx
      .select({ limit: doaLimits, entityCode: legalEntities.code })
      .from(doaLimits)
      .leftJoin(legalEntities, eq(legalEntities.id, doaLimits.legalEntityId))
      .where(
        and(eq(doaLimits.tenantId, actor.tenantId), eq(doaLimits.matrixVersionId, selected.id)),
      )
      .orderBy(doaLimits.spendType, desc(doaLimits.limitMinor));

    const activeLimits = active
      ? await tx
          .select()
          .from(doaLimits)
          .where(
            and(eq(doaLimits.tenantId, actor.tenantId), eq(doaLimits.matrixVersionId, active.id)),
          )
      : [];
    const personIds = limitRows.map((r) => r.limit.personId).filter((p): p is string => Boolean(p));
    const limitNames = await personNames(tx, personIds);

    // Compare the selected version with the active one so reviewers see exactly what moved.
    const key = (l: {
      role: string | null;
      personId: string | null;
      spendType: string;
      legalEntityId: string | null;
    }) => `${l.role ?? ''}|${l.personId ?? ''}|${l.spendType}|${l.legalEntityId ?? ''}`;
    const activeByKey = new Map(activeLimits.map((l) => [key(l), l]));
    const seen = new Set<string>();

    const rowsOut: DoaAdminRow[] = limitRows.map(({ limit, entityCode }) => {
      const k = key(limit);
      seen.add(k);
      const prior = activeByKey.get(k);
      const changeMarker: DoaAdminRow['changeMarker'] =
        selected.id === active?.id
          ? 'unchanged'
          : !prior
            ? 'added'
            : prior.limitMinor === limit.limitMinor
              ? 'unchanged'
              : 'changed';
      return {
        id: limit.id,
        role: (limit.role as RoleId | null) ?? null,
        personId: limit.personId,
        personName: limit.personId ? (limitNames.get(limit.personId) ?? null) : null,
        spendType: limit.spendType,
        legalEntityId: limit.legalEntityId,
        legalEntityCode: entityCode ?? null,
        limit: { amountMinor: limit.limitMinor, currency: limit.currency },
        validFrom: limit.validFrom,
        validTo: limit.validTo,
        changeMarker,
        previousLimitMinor: prior?.limitMinor ?? null,
      };
    });

    if (active && selected.id !== active.id) {
      for (const prior of activeLimits) {
        if (seen.has(key(prior))) continue;
        rowsOut.push({
          id: prior.id,
          role: (prior.role as RoleId | null) ?? null,
          personId: prior.personId,
          personName: null,
          spendType: prior.spendType,
          legalEntityId: prior.legalEntityId,
          legalEntityCode: null,
          limit: { amountMinor: prior.limitMinor, currency: prior.currency },
          validFrom: prior.validFrom,
          validTo: prior.validTo,
          changeMarker: 'removed',
          previousLimitMinor: prior.limitMinor,
        });
      }
    }

    const [openTasks] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(approvalTasks)
      .where(and(eq(approvalTasks.tenantId, actor.tenantId), eq(approvalTasks.status, 'pending')));
    const [delegations] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(approvalDelegations)
      .where(
        and(
          eq(approvalDelegations.tenantId, actor.tenantId),
          isNull(approvalDelegations.revokedAt),
        ),
      );
    const referencing = await tx
      .select({ code: rules.code })
      .from(rules)
      .where(and(eq(rules.tenantId, actor.tenantId), eq(rules.family, 'approval_thresholds')));

    const warnings: string[] = [];
    const lowered = rowsOut.filter(
      (r) =>
        r.changeMarker === 'changed' &&
        r.previousLimitMinor != null &&
        r.limit.amountMinor < r.previousLimitMinor,
    );
    if (lowered.length) {
      warnings.push(
        `${lowered.length} ${lowered.length === 1 ? 'limit is' : 'limits are'} lower than today. Approvals already in flight keep the limit they started with.`,
      );
    }
    if (rowsOut.some((r) => r.changeMarker === 'removed')) {
      warnings.push(
        'Removing a limit leaves that person or role with no authority for the spend type; their steps will escalate.',
      );
    }

    const allowedActions: string[] = ['view'];
    if (this.policy.can(actor, 'doa.manage', TENANT(actor)).allowed) {
      if (selected.status === 'draft') allowedActions.push('edit', 'submit');
      if (selected.status === 'awaiting_approval') {
        // Two people: the submitter sees the version but cannot approve their own submission.
        const submitter = await this.submitterOf(tx, actor.tenantId, selected.id);
        if (!submitter || submitter !== actor.personId) allowedActions.push('approve');
      }
      if (selected.status === 'active') allowedActions.push('new_draft');
    }

    return {
      versions: versionRows.map((v) => this.toSummary(v, names)),
      selectedVersion: this.toSummary(selected, names),
      activeVersion: active ? this.toSummary(active, names) : null,
      rows: rowsOut,
      impact: {
        openTasksAffected: openTasks?.count ?? 0,
        delegationsAffected: delegations?.count ?? 0,
        referencingRuleCodes: referencing.map((r) => r.code),
      },
      warnings,
      allowedActions,
    };
  }

  async saveDraft(
    actor: RequestActor,
    body: SaveDoaDraftRequest,
    ctx: Ctx,
  ): Promise<CommandResult<DoaMatrixAdminView>> {
    this.policy.assert(actor, 'doa.manage', TENANT(actor), 'delegation-of-authority matrix');
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'rules.save_doa_draft',
        request: body,
        status: 200,
      },
      async (tx) => {
        const existing = await tx
          .select()
          .from(doaMatrixVersions)
          .where(eq(doaMatrixVersions.tenantId, actor.tenantId))
          .orderBy(desc(doaMatrixVersions.version))
          .for('update');
        let draft = existing.find((v) => v.status === 'draft' || v.status === 'awaiting_approval');
        const status = body.submitForApproval ? 'awaiting_approval' : 'draft';

        if (draft) {
          await tx
            .update(doaMatrixVersions)
            .set({ validFrom: body.validFrom, status })
            .where(eq(doaMatrixVersions.id, draft.id));
          await tx
            .delete(doaLimits)
            .where(
              and(eq(doaLimits.tenantId, actor.tenantId), eq(doaLimits.matrixVersionId, draft.id)),
            );
        } else {
          const [created] = await tx
            .insert(doaMatrixVersions)
            .values({
              tenantId: actor.tenantId,
              version: (existing[0]?.version ?? 0) + 1,
              status,
              validFrom: body.validFrom,
            })
            .returning();
          draft = created;
        }

        for (const row of body.rows) {
          if (!row.role && !row.personId) {
            throw new ApiProblem(
              422,
              'VALIDATION_FAILED',
              'Each limit needs either a role or a named person.',
              { spendType: row.spendType },
            );
          }
          await tx.insert(doaLimits).values({
            tenantId: actor.tenantId,
            matrixVersionId: draft.id,
            personId: row.personId ?? null,
            role: (row.role as RoleId | null) ?? null,
            spendType: row.spendType,
            legalEntityId: row.legalEntityId ?? null,
            limitMinor: row.limitMinor,
            currency: row.currency ?? 'USD',
            validFrom: row.validFrom ?? body.validFrom,
            validTo: row.validTo ?? null,
          });
        }

        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: body.submitForApproval ? 'doa.version_submitted' : 'doa.version_drafted',
          resourceType: 'doa_matrix_version',
          resourceId: draft.id,
          requestId: ctx.requestId,
          reason: body.submitForApproval
            ? 'Delegation-of-authority version submitted for approval'
            : 'Delegation-of-authority draft saved',
          changes: {
            version: { from: null, to: draft.version },
            status: { from: null, to: status },
            rowCount: { from: null, to: body.rows.length },
            validFrom: { from: null, to: body.validFrom },
          },
        });

        return this.viewTx(tx, actor, draft.id);
      },
    );
  }

  async approve(
    actor: RequestActor,
    body: ApproveDoaVersionRequest,
    ctx: Ctx,
  ): Promise<CommandResult<DoaMatrixAdminView>> {
    this.policy.assert(actor, 'doa.manage', TENANT(actor), 'delegation-of-authority matrix');
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'rules.approve_doa_version',
        request: body,
        status: 200,
      },
      async (tx) => {
        const [version] = await tx
          .select()
          .from(doaMatrixVersions)
          .where(
            and(
              eq(doaMatrixVersions.tenantId, actor.tenantId),
              eq(doaMatrixVersions.id, body.versionId),
            ),
          )
          .for('update');
        if (!version) throw ApiProblem.notFound('delegation-of-authority matrix version');
        if (version.status !== 'awaiting_approval') {
          throw new ApiProblem(
            409,
            'DOA_VERSION_NOT_SUBMITTED',
            'Only a version submitted for approval can be approved.',
            { status: version.status },
          );
        }

        // Two people: whoever submitted the version cannot also approve it.
        const submitter = await this.submitterOf(tx, actor.tenantId, version.id);
        if (submitter && actor.personId && submitter === actor.personId) {
          throw new ApiProblem(
            409,
            'DOA_VERSION_SELF_APPROVAL',
            'The person who submitted a delegation-of-authority version cannot approve it.',
          );
        }

        const day = today();
        const [priorActive] = await tx
          .select()
          .from(doaMatrixVersions)
          .where(
            and(
              eq(doaMatrixVersions.tenantId, actor.tenantId),
              eq(doaMatrixVersions.status, 'active'),
            ),
          )
          .for('update');
        if (priorActive) {
          await tx
            .update(doaMatrixVersions)
            .set({ status: 'superseded', validTo: version.validFrom })
            .where(eq(doaMatrixVersions.id, priorActive.id));
        }
        const scheduled = version.validFrom > day;
        await tx
          .update(doaMatrixVersions)
          .set({ status: scheduled ? 'scheduled' : 'active', approvedBy: actor.personId })
          .where(eq(doaMatrixVersions.id, version.id));

        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'doa.version_approved',
          resourceType: 'doa_matrix_version',
          resourceId: version.id,
          requestId: ctx.requestId,
          reason: body.comment ?? `Delegation-of-authority version ${version.version} approved`,
          changes: {
            status: { from: 'awaiting_approval', to: scheduled ? 'scheduled' : 'active' },
            supersededVersion: { from: priorActive?.version ?? null, to: version.version },
          },
        });

        return this.viewTx(tx, actor, version.id);
      },
    );
  }
}
