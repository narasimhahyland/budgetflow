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
  glAccounts,
  glMappings,
  legalEntities,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import { activeOn, dayBefore, validateEffectiveDate } from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, type SQL } from 'drizzle-orm';
import { assertTenant, duplicate, invalid, todayUtc, type CommandContext } from './finance-base';

type AccountType = 'expense' | 'liability' | 'asset' | 'revenue' | 'equity';
type AttendeeType = 'employee' | 'client';

/** GL accounts per entity and the effective-dated category-to-GL mapping (employee vs client attendees). */
@Injectable()
export class GlService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  categories(actor: RequestActor) {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      assertTenant(this.policy, actor, 'tenant.read');
      const items = await tx
        .select({
          id: budgetCategories.id,
          code: budgetCategories.code,
          name: budgetCategories.name,
        })
        .from(budgetCategories)
        .orderBy(asc(budgetCategories.name));
      return { items };
    });
  }

  accounts(actor: RequestActor, legalEntityId?: string) {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      assertTenant(this.policy, actor, 'tenant.read');
      const items = await tx
        .select({
          id: glAccounts.id,
          legalEntityId: glAccounts.legalEntityId,
          code: glAccounts.code,
          name: glAccounts.name,
          accountType: glAccounts.accountType,
        })
        .from(glAccounts)
        .where(legalEntityId ? eq(glAccounts.legalEntityId, legalEntityId) : undefined)
        .orderBy(asc(glAccounts.code));
      return { items: items.map((i) => ({ ...i, accountType: i.accountType as AccountType })) };
    });
  }

  createAccount(
    actor: RequestActor,
    req: { legalEntityId: string; code: string; name: string; accountType: AccountType },
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'finance.gl_accounts.create',
        request: req,
        status: 201,
      },
      async (tx) => {
        assertTenant(this.policy, actor, 'master_data.manage');
        const [le] = await tx
          .select()
          .from(legalEntities)
          .where(eq(legalEntities.id, req.legalEntityId));
        if (!le) throw invalid('legalEntityId', 'The legal entity does not exist.');
        const [dup] = await tx
          .select({ id: glAccounts.id })
          .from(glAccounts)
          .where(and(eq(glAccounts.legalEntityId, le.id), eq(glAccounts.code, req.code)));
        if (dup) throw duplicate(`GL account ${req.code} in ${le.code}`);
        const [row] = await tx
          .insert(glAccounts)
          .values({ tenantId: actor.tenantId, ...req })
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'gl_account.created',
          resourceType: 'gl_account',
          resourceId: row.id,
          legalEntityId: le.id,
          requestId: ctx.requestId,
          changes: { code: { from: null, to: row.code }, name: { from: null, to: row.name } },
        });
        return {
          id: row.id,
          legalEntityId: row.legalEntityId,
          code: row.code,
          name: row.name,
          accountType: row.accountType as AccountType,
        };
      },
    );
  }

  mappings(actor: RequestActor, q: { legalEntityId?: string; asOf?: string }) {
    const asOf = q.asOf ?? todayUtc();
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      assertTenant(this.policy, actor, 'tenant.read');
      const filters: SQL[] = [];
      if (q.legalEntityId) filters.push(eq(glMappings.legalEntityId, q.legalEntityId));
      const rows = await this.mappingRows(tx, filters);
      return { asOf, items: rows.filter((r) => activeOn(r, asOf)) };
    });
  }

  createMapping(
    actor: RequestActor,
    req: {
      legalEntityId: string;
      categoryCode: string;
      attendeeType: AttendeeType;
      glAccountId: string;
      effectiveFrom: string;
    },
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'finance.gl_mappings.create',
        request: req,
        status: 201,
      },
      async (tx) => {
        assertTenant(this.policy, actor, 'master_data.manage');
        const [cat] = await tx
          .select()
          .from(budgetCategories)
          .where(eq(budgetCategories.code, req.categoryCode));
        if (!cat) throw invalid('categoryCode', `Unknown category ${req.categoryCode}.`);
        const [account] = await tx
          .select()
          .from(glAccounts)
          .where(eq(glAccounts.id, req.glAccountId));
        if (!account || account.legalEntityId !== req.legalEntityId)
          throw invalid('glAccountId', 'Pick a GL account of the same legal entity.');
        const [current] = await tx
          .select()
          .from(glMappings)
          .where(
            and(
              eq(glMappings.legalEntityId, req.legalEntityId),
              eq(glMappings.categoryId, cat.id),
              eq(glMappings.attendeeType, req.attendeeType),
            ),
          )
          .orderBy(desc(glMappings.validFrom))
          .limit(1)
          .for('update');
        if (current) {
          unwrap(validateEffectiveDate(req.effectiveFrom, current.validFrom));
          if (current.validTo === null || current.validTo >= req.effectiveFrom)
            await tx
              .update(glMappings)
              .set({ validTo: dayBefore(req.effectiveFrom) })
              .where(eq(glMappings.id, current.id));
        }
        const [row] = await tx
          .insert(glMappings)
          .values({
            tenantId: actor.tenantId,
            legalEntityId: req.legalEntityId,
            categoryId: cat.id,
            attendeeType: req.attendeeType,
            glAccountId: account.id,
            validFrom: req.effectiveFrom,
          })
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'gl_mapping.changed',
          resourceType: 'gl_mapping',
          resourceId: row.id,
          legalEntityId: req.legalEntityId,
          requestId: ctx.requestId,
          changes: {
            category: { from: null, to: cat.code },
            attendeeType: { from: null, to: req.attendeeType },
            glAccountId: { from: current?.glAccountId ?? null, to: account.id },
            effectiveFrom: { from: null, to: req.effectiveFrom },
          },
        });
        const [dto] = (await this.mappingRows(tx, [eq(glMappings.id, row.id)])) ?? [];
        if (!dto) throw ApiProblem.notFound('GL mapping');
        return dto;
      },
    );
  }

  private async mappingRows(tx: Tx, filters: SQL[]) {
    const rows = await tx
      .select({
        id: glMappings.id,
        legalEntityId: glMappings.legalEntityId,
        categoryId: glMappings.categoryId,
        categoryCode: budgetCategories.code,
        categoryName: budgetCategories.name,
        attendeeType: glMappings.attendeeType,
        glAccountId: glMappings.glAccountId,
        glAccountCode: glAccounts.code,
        glAccountName: glAccounts.name,
        validFrom: glMappings.validFrom,
        validTo: glMappings.validTo,
      })
      .from(glMappings)
      .innerJoin(budgetCategories, eq(budgetCategories.id, glMappings.categoryId))
      .innerJoin(glAccounts, eq(glAccounts.id, glMappings.glAccountId))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(
        asc(budgetCategories.name),
        asc(glMappings.attendeeType),
        desc(glMappings.validFrom),
      );
    return rows.map((r) => ({ ...r, attendeeType: r.attendeeType as AttendeeType }));
  }
}
