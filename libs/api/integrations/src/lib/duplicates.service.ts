import { MatchEngine } from '@bf/api/actuals';
import { AuditService } from '@bf/api/audit';
import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  type CommandResult,
  type RequestActor,
} from '@bf/api/core';
import { actuals, integrityFlags, people, withTenant, type Db, type Tx } from '@bf/api/db';
import type {
  DuplicateGroupList,
  DuplicateGroupView,
  DuplicateLine,
  ResolveDuplicateRequest,
} from '@bf/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { tenantOf, type CommandContext } from './connections.service';

type ActualRow = typeof actuals.$inferSelect;

/** Closest to the general ledger wins by default: ERP or AP, then card, then expense or travel. */
const PRECEDENCE: Record<string, number> = {
  erp: 0,
  ap: 1,
  card: 2,
  expense: 3,
  travel: 4,
  file: 5,
  manual: 6,
};

const dayDiff = (a: string, b: string) =>
  Math.round(
    Math.abs(new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) /
      86_400_000,
  );

/**
 * Cross-source duplicate review (99a). Held lines do not consume budget until someone decides which
 * one is the record; excluding a line that was already matched posts a reversal, never an edit.
 */
@Injectable()
export class DuplicatesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly engine: MatchEngine,
  ) {}

  list(actor: RequestActor, q: { status?: 'open' | 'resolved' }): Promise<DuplicateGroupList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(actor, 'actuals.read', tenantOf(actor));
      const filters = [eq(integrityFlags.kind, 'cross_source_duplicate')];
      if (q.status === 'open') filters.push(eq(integrityFlags.status, 'open'));
      if (q.status === 'resolved') filters.push(eq(integrityFlags.status, 'resolved'));
      const flags = await tx
        .select()
        .from(integrityFlags)
        .where(and(...filters))
        .orderBy(desc(integrityFlags.raisedAt))
        .limit(200);
      const items: DuplicateGroupView[] = [];
      for (const f of flags) items.push(await this.group(tx, f));
      const open = flags.filter((f) => f.status === 'open').length;
      return { items, open };
    });
  }

  private async group(
    tx: Tx,
    flag: typeof integrityFlags.$inferSelect,
  ): Promise<DuplicateGroupView> {
    const details = (flag.details ?? {}) as {
      duplicateOfActualId?: string;
      keptActualId?: string;
      resolution?: 'kept_one' | 'kept_both';
      resolvedBy?: string;
      pattern?: string;
    };
    const ids = [flag.resourceId, details.duplicateOfActualId].filter((x): x is string =>
      Boolean(x),
    );
    const rows = ids.length ? await tx.select().from(actuals).where(inArray(actuals.id, ids)) : [];
    rows.sort((a, b) => (PRECEDENCE[a.source] ?? 9) - (PRECEDENCE[b.source] ?? 9));
    const [a, b] = rows;
    const facts: string[] = [];
    if (a && b) {
      facts.push(
        a.transactionAmountMinor === b.transactionAmountMinor &&
          a.transactionCurrency === b.transactionCurrency
          ? 'Same amount in the same currency'
          : 'Amounts differ',
      );
      facts.push(`${dayDiff(a.accountingDate, b.accountingDate)} day(s) apart`);
      if (a.merchant && b.merchant)
        facts.push(
          a.merchant.toLowerCase() === b.merchant.toLowerCase()
            ? 'Same merchant'
            : `Merchants "${a.merchant}" and "${b.merchant}"`,
        );
      if (b.reference && b.reference === a.sourceRef)
        facts.push('The expense line carries the card transaction id');
    }
    const high =
      Boolean(a && b) &&
      a.transactionAmountMinor === b.transactionAmountMinor &&
      dayDiff(a.accountingDate, b.accountingDate) === 0;
    return {
      flagId: flag.id,
      confidence: high ? 'high' : 'medium',
      pattern: details.pattern ?? this.patternOf(a, b),
      detectedAt: flag.raisedAt.toISOString(),
      status: flag.status as DuplicateGroupView['status'],
      facts,
      keptActualId: details.keptActualId ?? null,
      resolution: details.resolution ?? null,
      resolvedByName: details.resolvedBy
        ? ((
            await tx
              .select({ n: people.displayName })
              .from(people)
              .where(eq(people.id, details.resolvedBy))
          )[0]?.n ?? null)
        : null,
      lines: rows.map((r) => this.line(r)),
    };
  }

  private patternOf(a?: ActualRow, b?: ActualRow): string {
    if (!a || !b) return 'Possible duplicate';
    const sources = new Set([a.source, b.source]);
    if (sources.has('card') && sources.has('expense')) return 'Card-paid expense itemization';
    if ((sources.has('erp') || sources.has('ap')) && sources.has('card'))
      return 'Deposit paid by card and invoiced';
    if (sources.has('travel') && sources.has('expense')) return 'Booked and claimed';
    return 'Same spend from two sources';
  }

  private line(r: ActualRow): DuplicateLine {
    return {
      actualId: r.id,
      source: r.source,
      sourceRef: r.sourceRef,
      accountingDate: r.accountingDate,
      transactionAmount: {
        amountMinor: r.transactionAmountMinor,
        currency: r.transactionCurrency,
      },
      reportingAmount: { amountMinor: r.reportingAmountMinor, currency: r.reportingCurrency },
      merchant: r.merchant,
      personName: null,
      eventCode: r.eventCode,
      matchStatus: r.matchStatus,
    };
  }

  resolve(
    actor: RequestActor,
    flagId: string,
    req: ResolveDuplicateRequest,
    ctx: CommandContext,
  ): Promise<CommandResult<DuplicateGroupView>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `integrations.duplicates.resolve:${flagId}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        this.policy.assert(actor, 'actuals.manage', tenantOf(actor));
        const [flag] = await tx
          .select()
          .from(integrityFlags)
          .where(
            and(eq(integrityFlags.id, flagId), eq(integrityFlags.kind, 'cross_source_duplicate')),
          )
          .for('update');
        if (!flag) throw ApiProblem.notFound('duplicate group');
        if (flag.status === 'resolved') {
          throw new ApiProblem(
            409,
            'DUPLICATE_ALREADY_RESOLVED',
            'This group was already resolved.',
          );
        }
        const details = (flag.details ?? {}) as { duplicateOfActualId?: string };
        const heldId = flag.resourceId;
        const otherId = details.duplicateOfActualId ?? null;
        const ids = [heldId, otherId].filter((x): x is string => Boolean(x));
        const rows = await tx.select().from(actuals).where(inArray(actuals.id, ids));
        const held = rows.find((r) => r.id === heldId);
        if (!held) throw ApiProblem.notFound('actual');

        let keptId = held.id;
        if (req.resolution === 'kept_one') {
          if (!req.keepActualId || !ids.includes(req.keepActualId)) {
            throw new ApiProblem(
              422,
              'VALIDATION_FAILED',
              'Choose which of the two lines stays as the record.',
            );
          }
          keptId = req.keepActualId;
          const excluded = rows.find((r) => r.id !== keptId);
          if (excluded) {
            if (
              excluded.matchStatus === 'matched' ||
              excluded.matchStatus === 'partially_matched'
            ) {
              // Already consuming budget: reverse it rather than editing anything.
              await this.engine.unmatch(tx, actor, excluded.id, {
                command: 'integrations.duplicates.resolve',
                idempotencyKey: ctx.idempotencyKey,
                requestId: ctx.requestId,
                reasonCode: req.reasonCode,
                reason: req.reason,
                accountingDate: excluded.accountingDate,
              });
            }
            await tx
              .update(actuals)
              .set({
                matchStatus: 'excluded',
                excludedReason: `Duplicate of ${rows.find((r) => r.id === keptId)?.sourceRef ?? keptId}: ${req.reason}`,
                duplicateOfActualId: keptId,
                matchNote: null,
              })
              .where(eq(actuals.id, excluded.id));
          }
          // The kept line is released from the hold and can be matched normally.
          await tx
            .update(actuals)
            .set({ duplicateOfActualId: null, matchNote: null })
            .where(eq(actuals.id, keptId));
        } else {
          // Not duplicates: both lines are released, and the reason feeds detection tuning.
          await tx
            .update(actuals)
            .set({ duplicateOfActualId: null, matchNote: null })
            .where(inArray(actuals.id, ids));
        }

        await tx
          .update(integrityFlags)
          .set({
            status: 'resolved',
            details: {
              ...(flag.details as object),
              resolution: req.resolution,
              keptActualId: req.resolution === 'kept_one' ? keptId : null,
              resolvedBy: actor.personId,
              reasonCode: req.reasonCode,
              reason: req.reason,
            },
          })
          .where(eq(integrityFlags.id, flagId));

        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'integration.duplicate_resolved',
          resourceType: 'integrity_flag',
          resourceId: flagId,
          requestId: ctx.requestId,
          reason: req.reason,
          changes: {
            resolution: { from: 'open', to: req.resolution },
            keptActualId: { from: null, to: req.resolution === 'kept_one' ? keptId : null },
            lines: { from: null, to: ids.join(',') },
          },
        });
        const [after] = await tx.select().from(integrityFlags).where(eq(integrityFlags.id, flagId));
        return this.group(tx, after);
      },
    );
  }
}
