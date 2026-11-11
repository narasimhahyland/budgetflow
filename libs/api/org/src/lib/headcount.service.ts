import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  unwrap,
  type CommandResult,
  type RequestActor,
} from '@bf/api/core';
import { AuditService } from '@bf/api/audit';
import {
  headcountSnapshotLines,
  headcountSnapshots,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import type {
  HeadcountImportRequest,
  HeadcountImportResult,
  HeadcountSummary,
} from '@bf/contracts';
import { parseCsv, validateHeadcountRows, type KnownUnit } from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lt, lte, or, sql } from 'drizzle-orm';
import { ancestorsOf, OrgReads, todayUtc, type UnitMap } from './org-reads';
import type { CommandContext } from './org-units.service';

type Snapshot = typeof headcountSnapshots.$inferSelect;
type Line = {
  orgUnitId: string;
  employmentType: 'employee' | 'contractor' | 'intern';
  headcount: number;
  proratedHeadcountMilli: number;
};

interface Tally {
  headcount: number;
  prorated: number;
  byType: { employee: number; contractor: number; intern: number };
}

const emptyTally = (): Tally => ({
  headcount: 0,
  prorated: 0,
  byType: { employee: 0, contractor: 0, intern: 0 },
});

function add(t: Tally, l: Line): void {
  t.headcount += l.headcount;
  t.prorated += l.proratedHeadcountMilli;
  t.byType[l.employmentType] += l.headcount;
}

/** HR headcount: CSV import (dry run, then apply) refreshing counts by location and team, and summaries. */
@Injectable()
export class HeadcountService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly reads: OrgReads,
    private readonly audit: AuditService,
  ) {}

  summary(actor: RequestActor, asOf = todayUtc()): Promise<HeadcountSummary> {
    // Every member reads headcount for what they can see; a platform operator without a
    // break-glass grant holds no tenant permission, so the tenant is not found.
    this.policy.assert(
      actor,
      'tenant.read',
      { kind: 'tenant', tenantId: actor.tenantId },
      'tenant',
    );
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const view = await this.reads.view(tx, actor, asOf);
      const snap = await this.latest(tx, asOf);
      if (!snap) return { scope: view.scope, snapshot: null, total: 0, locations: [] };
      const prev = await this.previous(tx, snap);
      const units = await this.structure(tx, view.units, snap.asOfDate);
      const snapLines = await this.lines(tx, snap.id);
      const current = this.byUnit(snapLines, units);
      const before = prev ? this.byUnit(await this.lines(tx, prev.id), units) : null;
      const summarize = (id: string, t: Tally) => {
        const u = units.get(id)!;
        return {
          orgUnitId: id,
          code: u.code,
          name: u.name,
          kind: u.kind,
          legalEntityId: u.legalEntityId,
          headcount: t.headcount,
          proratedHeadcountMilli: t.prorated,
          byType: t.byType,
          previousHeadcount: before ? (before.get(id)?.headcount ?? 0) : null,
        };
      };
      const locations = [...current.entries()]
        .filter(([id]) => units.get(id)?.kind === 'location' && view.canSee(id))
        .map(([id, t]) => ({
          ...summarize(id, t),
          teams: [...current.entries()]
            .filter(
              ([tid]) =>
                tid !== id &&
                units.get(tid)?.kind !== 'location' &&
                ancestorsOf(units, tid).includes(id) &&
                view.canSee(tid),
            )
            .map(([tid, tt]) => summarize(tid, tt))
            .sort((a, b) => a.name.localeCompare(b.name)),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const total = locations.reduce((s, l) => s + l.headcount, 0);
      const snapshot = await this.snapshotSummary(tx, snap);
      // The snapshot's company-wide totals are tenant-wide information (the snapshot list itself is
      // tenant-wide only), so a scoped reader gets the totals of what they can see.
      const tenantWide = this.reads.tenantWide(actor, 'org.read');
      return {
        scope: view.scope,
        snapshot: tenantWide
          ? snapshot
          : {
              ...snapshot,
              lineCount: snapLines.filter((l) => view.canSee(l.orgUnitId)).length,
              totalHeadcount: total,
            },
        total,
        locations,
      };
    });
  }

  snapshots(actor: RequestActor) {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      if (!this.reads.tenantWide(actor, 'org.read')) throw ApiProblem.forbidden();
      const rows = await tx
        .select()
        .from(headcountSnapshots)
        .orderBy(desc(headcountSnapshots.asOfDate), desc(headcountSnapshots.createdAt))
        .limit(100);
      const items = [];
      for (const r of rows) items.push(await this.snapshotSummary(tx, r));
      return { items };
    });
  }

  import(
    actor: RequestActor,
    req: HeadcountImportRequest,
    ctx: CommandContext,
  ): Promise<CommandResult<HeadcountImportResult>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'org.headcount.import',
        request: req,
        status: 201,
      },
      async (tx) => {
        this.policy.assert(actor, 'headcount.import', { kind: 'tenant', tenantId: actor.tenantId });
        const units = await this.reads.unitsAsOf(tx, req.asOfDate);
        const known = new Map<string, KnownUnit>();
        for (const u of units.values()) {
          known.set(u.code, {
            id: u.id,
            code: u.code,
            kind: u.kind,
            ancestorCodes: ancestorsOf(units, u.id).map((a) => units.get(a)!.code),
          });
        }
        const parsed = unwrap(parseCsv(req.csv));
        const { lines, issues } = unwrap(validateHeadcountRows(parsed, known));
        if (issues.length && !req.dryRun) {
          throw new ApiProblem(
            422,
            'IMPORT_INVALID',
            `The file has ${issues.length} problem(s); nothing was imported.`,
            { issues: issues.length },
            issues.map((i) => ({
              path: `line ${i.line}${i.field ? `.${i.field}` : ''}`,
              message: i.message,
            })),
          );
        }
        const prior = await this.latest(tx, req.asOfDate);
        const before = prior ? this.byUnit(await this.lines(tx, prior.id), units) : null;
        const tallies = new Map<string, Tally>();
        for (const l of lines) {
          const t = tallies.get(l.unitId) ?? emptyTally();
          add(t, { orgUnitId: l.unitId, ...l });
          tallies.set(l.unitId, t);
        }
        const summarize = (id: string, t: Tally) => {
          const u = units.get(id)!;
          return {
            orgUnitId: id,
            code: u.code,
            name: u.name,
            kind: u.kind,
            legalEntityId: u.legalEntityId,
            headcount: t.headcount,
            proratedHeadcountMilli: t.prorated,
            byType: t.byType,
            previousHeadcount: before ? (before.get(id)?.headcount ?? 0) : null,
          };
        };
        const unitSummaries = [...tallies.entries()]
          .map(([id, t]) => summarize(id, t))
          .sort((a, b) => a.code.localeCompare(b.code));
        const byLocation = new Map<string, Tally>();
        for (const l of lines) {
          const t = byLocation.get(l.locationId) ?? emptyTally();
          add(t, { orgUnitId: l.locationId, ...l });
          byLocation.set(l.locationId, t);
        }
        const locationSummaries = [...byLocation.entries()]
          .map(([id, t]) => summarize(id, t))
          .sort((a, b) => a.name.localeCompare(b.name));
        const totalHeadcount = lines.reduce((s, l) => s + l.headcount, 0);
        const previousTotal = prior
          ? (await this.lines(tx, prior.id)).reduce((s, l) => s + l.headcount, 0)
          : null;
        let snapshotId: string | null = null;
        if (!req.dryRun) {
          const [snap] = await tx
            .insert(headcountSnapshots)
            .values({
              tenantId: actor.tenantId,
              asOfDate: req.asOfDate,
              source: 'hr-csv',
              importedBy: actor.personId,
            })
            .returning();
          snapshotId = snap.id;
          await tx.insert(headcountSnapshotLines).values(
            lines.map((l) => ({
              tenantId: actor.tenantId,
              snapshotId: snap.id,
              orgUnitId: l.unitId,
              employmentType: l.employmentType,
              headcount: l.headcount,
              proratedHeadcountMilli: l.proratedHeadcountMilli,
            })),
          );
          await this.audit.append(tx, {
            tenantId: actor.tenantId,
            actorPersonId: actor.personId,
            actorSubject: actor.subject,
            action: 'headcount.imported',
            resourceType: 'headcount_snapshot',
            resourceId: snap.id,
            requestId: ctx.requestId,
            changes: {
              asOfDate: { from: prior?.asOfDate ?? null, to: req.asOfDate },
              totalHeadcount: { from: previousTotal, to: totalHeadcount },
              lineCount: { from: null, to: lines.length },
              fileName: { from: null, to: req.fileName ?? null },
            },
          });
        }
        return {
          dryRun: req.dryRun,
          accepted: issues.length === 0,
          snapshotId,
          asOfDate: req.asOfDate,
          rowsRead: parsed.rows.length,
          lineCount: lines.length,
          totalHeadcount,
          previousTotal,
          issues,
          units: unitSummaries,
          locations: locationSummaries,
        };
      },
    );
  }

  private async latest(tx: Tx, asOf: string): Promise<Snapshot | undefined> {
    const [snap] = await tx
      .select()
      .from(headcountSnapshots)
      .where(lte(headcountSnapshots.asOfDate, asOf))
      .orderBy(desc(headcountSnapshots.asOfDate), desc(headcountSnapshots.createdAt))
      .limit(1);
    return snap;
  }

  private async previous(tx: Tx, snap: Snapshot): Promise<Snapshot | undefined> {
    const [prev] = await tx
      .select()
      .from(headcountSnapshots)
      .where(
        or(
          lt(headcountSnapshots.asOfDate, snap.asOfDate),
          and(
            eq(headcountSnapshots.asOfDate, snap.asOfDate),
            lt(headcountSnapshots.createdAt, snap.createdAt),
          ),
        ),
      )
      .orderBy(desc(headcountSnapshots.asOfDate), desc(headcountSnapshots.createdAt))
      .limit(1);
    return prev;
  }

  private lines(tx: Tx, snapshotId: string): Promise<Line[]> {
    return tx
      .select({
        orgUnitId: headcountSnapshotLines.orgUnitId,
        employmentType: headcountSnapshotLines.employmentType,
        headcount: headcountSnapshotLines.headcount,
        proratedHeadcountMilli: headcountSnapshotLines.proratedHeadcountMilli,
      })
      .from(headcountSnapshotLines)
      .where(eq(headcountSnapshotLines.snapshotId, snapshotId));
  }

  /** The as-of structure, completed with units that existed on the snapshot date but not on the read date. */
  private async structure(tx: Tx, units: UnitMap, snapshotDate: string): Promise<UnitMap> {
    const atSnapshot = await this.reads.unitsAsOf(tx, snapshotDate);
    const merged: UnitMap = new Map(atSnapshot);
    for (const [id, u] of units) merged.set(id, u);
    return merged;
  }

  /** Tallies per unit: each line counts for its own unit and for its location. */
  private byUnit(lines: Line[], units: UnitMap): Map<string, Tally> {
    const out = new Map<string, Tally>();
    for (const l of lines) {
      const targets = new Set([l.orgUnitId]);
      const location = ancestorsOf(units, l.orgUnitId).find(
        (a) => units.get(a)?.kind === 'location',
      );
      if (location) targets.add(location);
      for (const id of targets) {
        const t = out.get(id) ?? emptyTally();
        add(t, l);
        out.set(id, t);
      }
    }
    return out;
  }

  private async snapshotSummary(tx: Tx, s: Snapshot) {
    const [agg] = await tx
      .select({
        lineCount: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(${headcountSnapshotLines.headcount}), 0)::int`,
      })
      .from(headcountSnapshotLines)
      .where(eq(headcountSnapshotLines.snapshotId, s.id));
    return {
      id: s.id,
      asOfDate: s.asOfDate,
      source: s.source,
      createdAt: s.createdAt.toISOString(),
      lineCount: agg.lineCount,
      totalHeadcount: agg.total,
    };
  }
}
