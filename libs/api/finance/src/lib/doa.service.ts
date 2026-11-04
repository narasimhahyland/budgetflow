import { ActorResolver, ApiProblem, DB, PolicyService, type RequestActor } from '@bf/api/core';
import {
  doaLimits,
  doaMatrixVersions,
  legalEntities,
  people,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import type { DoaLimit, DoaLookupResponse, DoaMatrix } from '@bf/contracts';
import {
  checkAuthority,
  resolveLimit,
  type DoaLimit as DomainLimit,
  type RoleId,
} from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { assertTenant, invalid, todayUtc } from './finance-base';
import { RatesService } from './rates.service';

type LimitRow = typeof doaLimits.$inferSelect;

/** Read view of the delegation-of-authority matrix (seeded in Phase 3, enforced in Phase 5, administered in Phase 7). */
@Injectable()
export class DoaService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
    private readonly actors: ActorResolver,
    private readonly rates: RatesService,
  ) {}

  matrix(actor: RequestActor, date = todayUtc()): Promise<DoaMatrix> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      assertTenant(this.policy, actor, 'doa.read');
      const version = await this.activeVersion(tx, date);
      if (!version) return { version: null, spendTypes: [], items: [] };
      const rows = await this.limits(tx, version.id, date);
      const items = await this.toDtos(tx, rows);
      const approver = version.approvedBy
        ? (await this.names(tx, [version.approvedBy])).get(version.approvedBy)
        : null;
      return {
        version: {
          id: version.id,
          version: version.version,
          status: version.status,
          validFrom: version.validFrom,
          validTo: version.validTo,
          approvedByName: approver ?? null,
        },
        spendTypes: [...new Set(rows.map((r) => r.spendType))].sort(),
        items,
      };
    });
  }

  lookup(
    actor: RequestActor,
    q: {
      personId?: string;
      role?: RoleId;
      spendType: string;
      legalEntityId: string;
      amountMinor: number;
      currency: string;
      date?: string;
    },
  ): Promise<DoaLookupResponse> {
    const date = q.date ?? todayUtc();
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      assertTenant(this.policy, actor, 'doa.read');
      if (!q.personId && !q.role) throw invalid('personId', 'Give a person or a role to look up.');
      let displayName: string | null = null;
      let roles: RoleId[] = q.role ? [q.role] : [];
      if (q.personId) {
        const [p] = await tx.select().from(people).where(eq(people.id, q.personId));
        if (!p) throw ApiProblem.notFound('person');
        displayName = p.displayName;
        roles = [...new Set([...roles, ...(await this.actors.rolesForPerson(tx, p.id, date))])];
      }
      const [le] = await tx
        .select()
        .from(legalEntities)
        .where(eq(legalEntities.id, q.legalEntityId));
      if (!le) throw invalid('legalEntityId', 'The legal entity does not exist.');
      const version = await this.activeVersion(tx, date);
      const rows = version ? await this.limits(tx, version.id, date) : [];
      const limitCurrency = rows[0]?.currency ?? actor.reportingCurrency;
      // Limits are held in one currency; other amounts convert at the locked plan rate (FX never changes authority).
      const converted =
        q.currency === limitCurrency
          ? q.amountMinor
          : (
              await this.rates.lookupTx(tx, actor, {
                from: q.currency,
                to: limitCurrency,
                date,
                type: 'plan',
                amountMinor: q.amountMinor,
              })
            ).converted!.amountMinor;
      const domainLimits: DomainLimit[] = rows.map((r) => ({
        id: r.id,
        personId: r.personId,
        role: r.role,
        spendType: r.spendType,
        legalEntityId: r.legalEntityId ?? '*',
        limitMinor: r.limitMinor,
        currency: r.currency,
        validFrom: r.validFrom,
        validTo: r.validTo,
      }));
      const approver = { personId: q.personId ?? '', roles };
      const query = { spendType: q.spendType, legalEntityId: le.id, currency: limitCurrency, date };
      const result = checkAuthority(domainLimits, approver, { ...query, amountMinor: converted });
      const resolved = resolveLimit(domainLimits, approver, query);
      const applied = resolved
        ? ((
            await this.toDtos(
              tx,
              rows.filter((r) => r.id === resolved.id),
            )
          )[0] ?? null)
        : null;
      return {
        withinLimit: result.ok,
        code: result.ok ? null : (result.error.code as 'DOA_LIMIT_EXCEEDED' | 'DOA_NO_AUTHORITY'),
        message: result.ok
          ? 'Within this approver’s delegation-of-authority limit.'
          : result.error.message,
        date,
        amount: { amountMinor: q.amountMinor, currency: q.currency },
        limit: applied,
        approver: { personId: q.personId ?? null, displayName, roles },
      };
    });
  }

  private async activeVersion(tx: Tx, date: string) {
    const [v] = await tx
      .select()
      .from(doaMatrixVersions)
      .where(
        and(
          eq(doaMatrixVersions.status, 'active'),
          lte(doaMatrixVersions.validFrom, date),
          or(isNull(doaMatrixVersions.validTo), gte(doaMatrixVersions.validTo, date)),
        ),
      )
      .orderBy(desc(doaMatrixVersions.version))
      .limit(1);
    return v;
  }

  private limits(tx: Tx, versionId: string, date: string): Promise<LimitRow[]> {
    return tx
      .select()
      .from(doaLimits)
      .where(
        and(
          eq(doaLimits.matrixVersionId, versionId),
          lte(doaLimits.validFrom, date),
          or(isNull(doaLimits.validTo), gte(doaLimits.validTo, date)),
        ),
      )
      .orderBy(desc(doaLimits.limitMinor), asc(doaLimits.spendType));
  }

  private async names(tx: Tx, ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await tx
      .select({ id: people.id, name: people.displayName })
      .from(people)
      .where(inArray(people.id, ids));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private async toDtos(tx: Tx, rows: LimitRow[]): Promise<DoaLimit[]> {
    const names = await this.names(tx, [
      ...new Set(rows.map((r) => r.personId).filter((p): p is string => Boolean(p))),
    ]);
    const les = new Map(
      (await tx.select({ id: legalEntities.id, code: legalEntities.code }).from(legalEntities)).map(
        (l) => [l.id, l.code],
      ),
    );
    return rows.map((r) => ({
      id: r.id,
      role: r.role,
      personId: r.personId,
      personName: r.personId ? (names.get(r.personId) ?? null) : null,
      spendType: r.spendType,
      legalEntityId: r.legalEntityId,
      legalEntityCode: r.legalEntityId ? (les.get(r.legalEntityId) ?? null) : null,
      limit: { amountMinor: r.limitMinor, currency: r.currency },
      validFrom: r.validFrom,
      validTo: r.validTo,
    }));
  }
}
