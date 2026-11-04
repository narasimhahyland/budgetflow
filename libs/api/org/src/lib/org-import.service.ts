import {
  ApiProblem,
  CommandRunner,
  PolicyService,
  unwrap,
  type CommandResult,
  type RequestActor,
} from '@bf/api/core';
import { AuditService } from '@bf/api/audit';
import { legalEntities, orgUnits } from '@bf/api/db';
import type { OrgImportRequest, OrgImportResult } from '@bf/contracts';
import { parseCsv, planOrgImport, type ExistingUnit, type ImportIssue } from '@bf/domain';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { OrgReads } from './org-reads';
import { OrgUnitsService, type CommandContext } from './org-units.service';

/** Org hierarchy CSV import: dry run shows the plan; apply creates, renames and moves units from one date. */
@Injectable()
export class OrgImportService {
  constructor(
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly reads: OrgReads,
    private readonly units: OrgUnitsService,
    private readonly audit: AuditService,
  ) {}

  run(
    actor: RequestActor,
    req: OrgImportRequest,
    ctx: CommandContext,
  ): Promise<CommandResult<OrgImportResult>> {
    return this.commands.run(
      actor,
      { idempotencyKey: ctx.idempotencyKey, operation: 'org.import', request: req, status: 201 },
      async (tx) => {
        if (!this.reads.tenantWide(actor, 'org.manage')) {
          this.policy.assert(actor, 'org.manage', { kind: 'tenant', tenantId: actor.tenantId });
          throw ApiProblem.forbidden(
            'Org imports change the whole hierarchy; you need tenant-wide org rights.',
          );
        }
        const D = req.effectiveFrom;
        const asOf = await this.reads.unitsAsOf(tx, D);
        const existing = new Map<string, ExistingUnit>();
        for (const u of asOf.values()) {
          existing.set(u.code, {
            id: u.id,
            code: u.code,
            name: u.name,
            kind: u.kind,
            parentCode: u.parentId ? (asOf.get(u.parentId)?.code ?? null) : null,
          });
        }
        const allCodes = new Set(
          (await tx.select({ code: orgUnits.code }).from(orgUnits)).map((r) => r.code),
        );
        const entities = new Map(
          (
            await tx.select({ id: legalEntities.id, code: legalEntities.code }).from(legalEntities)
          ).map((e) => [e.code, e.id]),
        );
        const parsed = unwrap(parseCsv(req.csv));
        const plan = unwrap(planOrgImport(parsed, existing, new Set(entities.keys())));
        const issues: ImportIssue[] = [...plan.issues];
        for (const op of plan.ops) {
          if (op.op === 'create' && allCodes.has(op.code)) {
            issues.push({
              line: op.line,
              field: 'code',
              message: `Code ${op.code} belongs to a unit that is not active on ${D}.`,
            });
          }
        }
        const fail = (list: ImportIssue[]) =>
          new ApiProblem(
            422,
            'IMPORT_INVALID',
            `The file has ${list.length} problem(s); nothing was imported.`,
            { issues: list.length },
            list.map((i) => ({
              path: `line ${i.line}${i.field ? `.${i.field}` : ''}`,
              message: i.message,
            })),
          );
        if (issues.length && !req.dryRun) throw fail(issues);
        const ops = plan.ops.filter((o) => !issues.some((i) => i.line === o.line));
        const counts = {
          created: ops.filter((o) => o.op === 'create').length,
          changed: ops.filter((o) => o.op === 'change').length,
          unchanged: ops.filter((o) => o.op === 'unchanged').length,
        };
        if (!req.dryRun) {
          const createdIds = new Map<string, string>();
          const idOf = (code: string) => existing.get(code)?.id ?? createdIds.get(code);
          for (const op of ops) {
            try {
              if (op.op === 'create') {
                const id = await this.units.createUnitTx(tx, actor, asOf, {
                  code: op.code,
                  name: op.name,
                  kind: op.kind,
                  parentId: op.parentCode ? (idOf(op.parentCode) ?? null) : null,
                  legalEntityId: op.legalEntityCode
                    ? (entities.get(op.legalEntityCode) ?? null)
                    : null,
                  timezone: op.timezone,
                  managerPersonId: null,
                  effectiveFrom: D,
                  reason: req.reason ?? 'Org import',
                  changeKind: 'imported',
                });
                createdIds.set(op.code, id);
              } else if (op.op === 'change') {
                await this.units.changeUnitTx(tx, actor, asOf, op.unitId, {
                  effectiveFrom: D,
                  ...(op.name !== null ? { name: op.name } : {}),
                  ...(op.parentCode !== null ? { parentId: idOf(op.parentCode) } : {}),
                  reason: req.reason ?? 'Org import',
                });
              }
            } catch (e) {
              if (e instanceof ApiProblem)
                throw fail([{ line: op.line, field: null, message: e.detail }]);
              throw e;
            }
          }
          await this.audit.append(tx, {
            tenantId: actor.tenantId,
            actorPersonId: actor.personId,
            actorSubject: actor.subject,
            action: 'org.imported',
            resourceType: 'org_import',
            resourceId: randomUUID(),
            requestId: ctx.requestId,
            reason: req.reason ?? null,
            changes: {
              effectiveFrom: { from: null, to: D },
              created: { from: null, to: ops.filter((o) => o.op === 'create').map((o) => o.code) },
              changed: { from: null, to: ops.filter((o) => o.op === 'change').map((o) => o.code) },
            },
          });
        }
        return {
          dryRun: req.dryRun,
          accepted: issues.length === 0,
          effectiveFrom: D,
          ...counts,
          issues,
          operations: plan.ops.map((o) => ({
            line: o.line,
            op: o.op,
            code: o.code,
            name: o.op === 'unchanged' ? null : o.name,
            kind: o.op === 'create' ? o.kind : null,
            parentCode: o.op === 'unchanged' ? null : o.parentCode,
          })),
        };
      },
    );
  }
}
