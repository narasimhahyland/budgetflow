import { ApiProblem, CommandRunner, DB, PolicyService, type RequestActor } from '@bf/api/core';
import { AuditService } from '@bf/api/audit';
import { reasonCodes, vendors, withTenant, type Db } from '@bf/api/db';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, ilike, or, sql, type SQL } from 'drizzle-orm';
import { assertTenant, duplicate, type CommandContext } from './finance-base';

type VendorRow = typeof vendors.$inferSelect;
type VendorStatus = VendorRow['status'];

const vendorDto = (v: VendorRow) => ({
  id: v.id,
  name: v.name,
  status: v.status,
  category: v.category,
  country: v.country,
  erpVendorId: v.erpVendorId,
  createdAt: v.createdAt.toISOString(),
});

const reasonDto = (r: typeof reasonCodes.$inferSelect) => ({
  id: r.id,
  category: r.category,
  code: r.code,
  label: r.label,
  active: r.active,
});

/** Reason-code taxonomy and vendor master: tenant reference data maintained by finance. */
@Injectable()
export class ReferenceDataService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  reasonCodes(actor: RequestActor, q: { category?: string; includeInactive?: 'true' | 'false' }) {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      assertTenant(this.policy, actor, 'tenant.read');
      const filters: SQL[] = [];
      if (q.category) filters.push(eq(reasonCodes.category, q.category));
      if (q.includeInactive !== 'true') filters.push(eq(reasonCodes.active, true));
      const rows = await tx
        .select()
        .from(reasonCodes)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(asc(reasonCodes.category), asc(reasonCodes.code));
      return { items: rows.map(reasonDto) };
    });
  }

  createReasonCode(
    actor: RequestActor,
    req: { category: string; code: string; label: string },
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'finance.reason_codes.create',
        request: req,
        status: 201,
      },
      async (tx) => {
        assertTenant(this.policy, actor, 'master_data.manage');
        const [dup] = await tx
          .select({ id: reasonCodes.id })
          .from(reasonCodes)
          .where(and(eq(reasonCodes.category, req.category), eq(reasonCodes.code, req.code)));
        if (dup) throw duplicate(`Reason code ${req.code} (${req.category})`);
        const [row] = await tx
          .insert(reasonCodes)
          .values({ tenantId: actor.tenantId, ...req })
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'reason_code.created',
          resourceType: 'reason_code',
          resourceId: row.id,
          requestId: ctx.requestId,
          changes: {
            category: { from: null, to: row.category },
            code: { from: null, to: row.code },
            label: { from: null, to: row.label },
          },
        });
        return reasonDto(row);
      },
    );
  }

  updateReasonCode(
    actor: RequestActor,
    id: string,
    req: { label?: string; active?: boolean },
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `finance.reason_codes.update:${id}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        const [row] = await tx
          .select()
          .from(reasonCodes)
          .where(eq(reasonCodes.id, id))
          .for('update');
        if (!row) throw ApiProblem.notFound('reason code');
        assertTenant(this.policy, actor, 'master_data.manage');
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        if (req.label !== undefined && req.label !== row.label)
          changes['label'] = { from: row.label, to: req.label };
        if (req.active !== undefined && req.active !== row.active)
          changes['active'] = { from: row.active, to: req.active };
        if (!Object.keys(changes).length)
          throw new ApiProblem(
            422,
            'VALIDATION_FAILED',
            'Nothing changes: the values are already in force.',
          );
        const [updated] = await tx
          .update(reasonCodes)
          .set({ label: req.label ?? row.label, active: req.active ?? row.active })
          .where(eq(reasonCodes.id, id))
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: req.active === false ? 'reason_code.retired' : 'reason_code.changed',
          resourceType: 'reason_code',
          resourceId: id,
          requestId: ctx.requestId,
          changes,
        });
        return reasonDto(updated);
      },
    );
  }

  vendors(
    actor: RequestActor,
    q: { q?: string; status?: VendorStatus; cursor?: string; limit?: number },
  ) {
    const limit = q.limit ?? 50;
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      assertTenant(this.policy, actor, 'tenant.read');
      const filters: SQL[] = [];
      if (q.status) filters.push(eq(vendors.status, q.status));
      if (q.q) {
        const like = `%${q.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
        filters.push(
          or(
            ilike(vendors.name, like),
            ilike(vendors.category, like),
            ilike(vendors.erpVendorId, like),
          )!,
        );
      }
      if (q.cursor) {
        const [name, id] = Buffer.from(q.cursor, 'base64url').toString('utf8').split('\u0000');
        filters.push(
          or(
            gt(vendors.name, name ?? ''),
            and(eq(vendors.name, name ?? ''), gt(vendors.id, id ?? '')),
          )!,
        );
      }
      const rows = await tx
        .select()
        .from(vendors)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(asc(vendors.name), asc(vendors.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map(vendorDto),
        nextCursor:
          rows.length > limit && last
            ? Buffer.from(`${last.name}\u0000${last.id}`, 'utf8').toString('base64url')
            : null,
      };
    });
  }

  createVendor(
    actor: RequestActor,
    req: {
      name: string;
      status: VendorStatus;
      category?: string;
      country?: string;
      erpVendorId?: string;
    },
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'finance.vendors.create',
        request: req,
        status: 201,
      },
      async (tx) => {
        assertTenant(this.policy, actor, 'master_data.manage');
        const [dup] = await tx
          .select({ id: vendors.id })
          .from(vendors)
          .where(sql`lower(${vendors.name}) = lower(${req.name})`);
        if (dup) throw duplicate(`Vendor ${req.name}`);
        const [row] = await tx
          .insert(vendors)
          .values({
            tenantId: actor.tenantId,
            name: req.name,
            status: req.status,
            category: req.category ?? null,
            country: req.country ?? null,
            erpVendorId: req.erpVendorId ?? null,
          })
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'vendor.created',
          resourceType: 'vendor',
          resourceId: row.id,
          requestId: ctx.requestId,
          changes: { name: { from: null, to: row.name }, status: { from: null, to: row.status } },
        });
        return vendorDto(row);
      },
    );
  }

  updateVendor(
    actor: RequestActor,
    id: string,
    req: {
      status?: VendorStatus;
      category?: string | null;
      country?: string | null;
      reason: string;
    },
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `finance.vendors.update:${id}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        const [row] = await tx.select().from(vendors).where(eq(vendors.id, id)).for('update');
        if (!row) throw ApiProblem.notFound('vendor');
        assertTenant(this.policy, actor, 'master_data.manage');
        const patch: Partial<VendorRow> = {};
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        for (const key of ['status', 'category', 'country'] as const) {
          if (req[key] !== undefined && req[key] !== row[key]) {
            (patch as Record<string, unknown>)[key] = req[key];
            changes[key] = { from: row[key], to: req[key] };
          }
        }
        if (!Object.keys(changes).length)
          throw new ApiProblem(
            422,
            'VALIDATION_FAILED',
            'Nothing changes: the values are already in force.',
          );
        const [updated] = await tx.update(vendors).set(patch).where(eq(vendors.id, id)).returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: req.status === 'blocked' ? 'vendor.blocked' : 'vendor.changed',
          resourceType: 'vendor',
          resourceId: id,
          requestId: ctx.requestId,
          reason: req.reason,
          changes,
        });
        return vendorDto(updated);
      },
    );
  }
}
