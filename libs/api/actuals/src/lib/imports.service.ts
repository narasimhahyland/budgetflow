import {
  actualMappingRules,
  actuals,
  budgets,
  commitments,
  costCenters,
  events,
  glAccounts,
  importBatches,
  integrityFlags,
  legalEntities,
  prepaids,
  vendors,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import { AuditService } from '@bf/api/audit';
import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  sha256Hex,
  unwrap,
  type CommandResult,
  type RequestActor,
} from '@bf/api/core';
import { LedgerReads } from '@bf/api/ledger';
import { AnalyticsService } from '@bf/api/tenancy';
import type { ImportBatch, ImportBatchList } from '@bf/contracts';
import {
  buildTriplet,
  classifyFit,
  DEFAULT_MATCH_TOLERANCE_BPS,
  duplicateKey,
  parseCsv,
  proposeMatch,
  resolveColumnMapping,
  validateActualRows,
  type ColumnMapping,
  type CurrencyCode,
  type FxRate,
  type ImportIssue,
  type MappingRule,
  type MatchCandidate,
  type ParsedActualLine,
} from '@bf/domain';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { ActualsReads, commitmentRef, tenantOf, type CommandContext } from './actuals-reads';
import { ActualsDtos } from './dto';
import { MatchEngine } from './match-engine';

type Source = ImportBatch['source'];
type Summary = ImportBatch['summary'];

interface Proposal {
  rule: NonNullable<ImportBatch['summary']['rules'][number]['rule']>;
  confidence: number;
  commitmentId: string | null;
  budgetId: string | null;
  fit: string | null;
  note: string | null;
}

/** Actuals file import: upload (validate, convert, de-duplicate, propose), then post matched lines. */
@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly reads: ActualsReads,
    private readonly ledgerReads: LedgerReads,
    private readonly engine: MatchEngine,
    private readonly dtos: ActualsDtos,
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsService,
  ) {}

  list(actor: RequestActor, q: { fileName?: string } = {}): Promise<ImportBatchList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(actor, 'actuals.read', tenantOf(actor));
      const rows = await tx
        .select()
        .from(importBatches)
        .where(q.fileName ? eq(importBatches.fileName, q.fileName) : undefined)
        .orderBy(desc(importBatches.createdAt))
        .limit(50);
      return { items: await Promise.all(rows.map((b) => this.dtos.batch(tx, b))) };
    });
  }

  get(actor: RequestActor, batchId: string): Promise<ImportBatch> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(actor, 'actuals.read', tenantOf(actor));
      const [b] = await tx.select().from(importBatches).where(eq(importBatches.id, batchId));
      if (!b) throw ApiProblem.notFound('import');
      return this.dtos.batch(tx, b);
    });
  }

  upload(
    actor: RequestActor,
    req: {
      source: Source;
      fileName: string;
      content: string;
      columnMapping?: Record<string, string>;
      toleranceBps?: number;
    },
    ctx: CommandContext,
  ): Promise<CommandResult<ImportBatch>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'actuals.import.upload',
        request: req,
        status: 201,
      },
      async (tx) => {
        this.policy.assert(actor, 'actuals.manage', tenantOf(actor));
        const fileHash = sha256Hex(req.content);
        const [prior] = await tx
          .select({ id: importBatches.id })
          .from(importBatches)
          .where(eq(importBatches.fileHash, fileHash));
        if (prior)
          throw new ApiProblem(409, 'IMPORT_ALREADY_UPLOADED', 'This file was already imported.', {
            batchId: prior.id,
          });
        const parsed = unwrap(parseCsv(req.content));
        const { mapping, missing } = resolveColumnMapping(
          parsed.headers,
          req.columnMapping as ColumnMapping | undefined,
        );
        if (missing.length > 0)
          throw new ApiProblem(422, 'IMPORT_INVALID', `Map a column for: ${missing.join(', ')}.`, {
            missing: missing.join(','),
          });
        const { lines, issues } = validateActualRows(parsed.rows, mapping, await this.refs(tx));
        const tolerance = req.toleranceBps ?? DEFAULT_MATCH_TOLERANCE_BPS;
        const prepared = await this.prepare(
          tx,
          actor,
          req.source,
          lines,
          issues,
          tolerance,
          parsed.rows.length,
        );
        const batchId = randomUUID();
        if (prepared.rows.length > 0) {
          await tx.insert(importBatches).values({
            id: batchId,
            tenantId: actor.tenantId,
            source: req.source,
            fileName: req.fileName,
            fileHash,
            lineCount: parsed.rows.length,
            importedCount: prepared.rows.length,
            rejectedCount: issues.length ? new Set(issues.map((i) => i.line)).size : 0,
            duplicateCount: prepared.duplicates,
            columnMapping: mapping,
            issues,
            summary: prepared.summary,
            createdBy: actor.personId,
          });
          for (let i = 0; i < prepared.rows.length; i += 200) {
            await tx
              .insert(actuals)
              .values(
                prepared.rows.slice(i, i + 200).map((r) => ({ ...r, importBatchId: batchId })),
              );
          }
          for (const f of prepared.flags) await tx.insert(integrityFlags).values(f);
        } else {
          throw new ApiProblem(422, 'IMPORT_INVALID', 'No line in the file can be imported.', {
            rejected: issues.length,
            duplicates: prepared.duplicates,
          });
        }
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'actuals.import.uploaded',
          resourceType: 'import_batch',
          resourceId: batchId,
          requestId: ctx.requestId,
          changes: {
            fileName: { from: null, to: req.fileName },
            source: { from: null, to: req.source },
            lines: { from: null, to: prepared.rows.length },
            rejected: { from: null, to: prepared.summary.rejected },
            duplicatesSkipped: { from: null, to: prepared.duplicates },
          },
        });
        await this.analytics.track(tx, actor, 'actual.imported', {
          lines: prepared.rows.length,
          rejected: prepared.summary.rejected,
          duplicates: prepared.duplicates,
          proposedMatches: prepared.summary.autoMatched + prepared.summary.partiallyMatched,
          currencies: prepared.summary.byCurrency.length,
        });
        const [b] = await tx.select().from(importBatches).where(eq(importBatches.id, batchId));
        return this.dtos.batch(tx, b);
      },
    );
  }

  /** Posts every line with a usable proposal; anything that fails or has none goes to the unmatched queue. */
  post(
    actor: RequestActor,
    batchId: string,
    ctx: CommandContext,
  ): Promise<CommandResult<ImportBatch>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `actuals.import.post:${batchId}`,
        request: {},
        status: 200,
      },
      async (tx) => {
        this.policy.assert(actor, 'actuals.manage', tenantOf(actor));
        const [b] = await tx
          .select()
          .from(importBatches)
          .where(eq(importBatches.id, batchId))
          .for('update');
        if (!b) throw ApiProblem.notFound('import');
        if (b.status !== 'review')
          throw new ApiProblem(409, 'IMPORT_ALREADY_POSTED', 'This import was already posted.', {
            batchId,
          });
        const rows = await tx
          .select()
          .from(actuals)
          .where(eq(actuals.importBatchId, batchId))
          .orderBy(asc(actuals.lineNo));
        let matched = 0;
        let journals = 0;
        const opts = {
          command: 'actuals.import.post',
          idempotencyKey: ctx.idempotencyKey,
          requestId: ctx.requestId,
        };
        for (const r of rows) {
          if (r.duplicateOfActualId) continue;
          try {
            if (r.kind === 'reversal') {
              if (await this.applyReversal(tx, actor, r, opts)) matched++;
              continue;
            }
            if (!r.proposedCommitmentId && !r.proposedBudgetId) continue;
            if (r.matchNote) continue;
            const parts = [
              r.proposedCommitmentId
                ? { commitmentId: r.proposedCommitmentId }
                : { budgetId: r.proposedBudgetId! },
            ];
            const matchOpts = { ...opts, rule: (r.matchRule ?? 'manual') as 'manual' };
            await this.engine.match(tx, actor, r.id, parts, { ...matchOpts, dryRun: true });
            const res = await this.engine.match(tx, actor, r.id, parts, matchOpts);
            matched++;
            journals += res.journalIds.length;
          } catch (e) {
            if (!(e instanceof ApiProblem))
              this.logger.error(
                `Posting actual ${r.id} failed`,
                e instanceof Error ? e.stack : String(e),
              );
            const detail = e instanceof ApiProblem ? e.detail : 'The match could not be posted.';
            await tx.update(actuals).set({ matchNote: detail }).where(eq(actuals.id, r.id));
          }
        }
        const firstPosted = rows.find((r) => r.accountingDate);
        const period = firstPosted
          ? await this.ledgerReads.postingPeriods(
              tx,
              [firstPosted.legalEntityId],
              firstPosted.accountingDate,
              false,
            )
          : null;
        const p = period?.get(firstPosted!.legalEntityId);
        const summary: Summary = {
          ...(b.summary as Summary),
          posted: {
            matched,
            toQueue: rows.length - matched - rows.filter((r) => r.duplicateOfActualId).length,
            journals,
            period: p ? { id: p.period.id, label: p.label } : null,
          },
        };
        await tx
          .update(importBatches)
          .set({ status: 'posted', postedAt: new Date(), postedBy: actor.personId, summary })
          .where(eq(importBatches.id, batchId));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'actuals.import.posted',
          resourceType: 'import_batch',
          resourceId: batchId,
          requestId: ctx.requestId,
          changes: {
            status: { from: 'review', to: 'posted' },
            matched: { from: null, to: matched },
            toQueue: { from: null, to: summary.posted!.toQueue },
            journals: { from: null, to: journals },
          },
        });
        await this.analytics.track(tx, actor, 'actual.matched', {
          count: matched,
          auto: true,
          lines: rows.length,
        });
        const [after] = await tx.select().from(importBatches).where(eq(importBatches.id, batchId));
        return this.dtos.batch(tx, after);
      },
    );
  }

  /** A source reversal undoes the line it names: its match is reversed and both lines leave the queue. */
  private async applyReversal(
    tx: Tx,
    actor: RequestActor,
    r: typeof actuals.$inferSelect,
    opts: { command: string; idempotencyKey: string; requestId: string | null },
  ): Promise<boolean> {
    const [orig] = await tx
      .select()
      .from(actuals)
      .where(and(eq(actuals.sourceRef, r.originalRef ?? ''), ne(actuals.id, r.id)));
    if (!orig) {
      await tx
        .update(actuals)
        .set({ matchNote: `The reversed line ${r.originalRef} is not in BudgetFlow.` })
        .where(eq(actuals.id, r.id));
      return false;
    }
    if (Math.abs(r.transactionAmountMinor) !== Math.abs(orig.transactionAmountMinor)) {
      await tx
        .update(actuals)
        .set({
          matchNote: `The reversal amount differs from ${orig.sourceRef}; post a credit note instead.`,
        })
        .where(eq(actuals.id, r.id));
      return false;
    }
    if (orig.matchStatus === 'matched' || orig.matchStatus === 'partially_matched') {
      const recognized = await tx
        .select({ id: prepaids.id })
        .from(prepaids)
        .where(and(eq(prepaids.actualId, orig.id), sql`${prepaids.consumedMinor} > 0`));
      if (recognized.length) {
        await tx
          .update(actuals)
          .set({
            matchNote: `${orig.sourceRef} is a deposit already partly consumed; post a credit note instead.`,
          })
          .where(eq(actuals.id, r.id));
        return false;
      }
      await this.engine.unmatch(tx, actor, orig.id, {
        ...opts,
        reasonCode: 'SOURCE-REVERSAL',
        reason: `Reversed in the source by ${r.sourceRef}`,
        accountingDate: r.accountingDate,
      });
    }
    await tx
      .update(actuals)
      .set({
        matchStatus: 'excluded',
        excludedReason: `Reversed by ${r.sourceRef}`,
        matchNote: null,
      })
      .where(eq(actuals.id, orig.id));
    await tx
      .update(actuals)
      .set({
        matchStatus: 'matched',
        matchedMinor: r.transactionAmountMinor,
        matchRule: 'original_reference',
        matchNote: null,
        excludedReason: null,
        matchedAt: new Date(),
        matchedBy: actor.personId,
      })
      .where(eq(actuals.id, r.id));
    return true;
  }

  private async refs(tx: Tx) {
    const [entities, ccs, gls, vs] = await Promise.all([
      tx.select({ id: legalEntities.id, code: legalEntities.code }).from(legalEntities),
      tx.select({ id: costCenters.id, code: costCenters.code }).from(costCenters),
      tx
        .select({ id: glAccounts.id, code: glAccounts.code, le: glAccounts.legalEntityId })
        .from(glAccounts),
      tx.select({ id: vendors.id, name: vendors.name }).from(vendors),
    ]);
    return {
      legalEntities: new Map(entities.map((e) => [e.code.toLowerCase(), e.id])),
      costCenters: new Map(ccs.map((c) => [c.code.toLowerCase(), c.id])),
      glAccounts: new Map(gls.map((g) => [`${g.le}|${g.code.toLowerCase()}`, g.id])),
      vendors: new Map(vs.map((v) => [v.name.toLowerCase(), v.id])),
    };
  }

  /** Converts, de-duplicates and proposes a match for every valid line. */
  private async prepare(
    tx: Tx,
    actor: RequestActor,
    source: Source,
    lines: ParsedActualLine[],
    issues: ImportIssue[],
    toleranceBps: number,
    rowCount: number,
  ) {
    const reporting = actor.reportingCurrency;
    const seen = new Set<string>();
    let duplicates = 0;
    const existingRefs = new Set(
      lines.length
        ? (
            await tx
              .select({ ref: actuals.sourceRef })
              .from(actuals)
              .where(
                and(
                  eq(actuals.source, source),
                  inArray(
                    actuals.sourceRef,
                    lines.map((l) => l.sourceRef),
                  ),
                ),
              )
          ).map((r) => r.ref)
        : [],
    );
    const fresh = lines.filter((l) => {
      if (seen.has(l.sourceRef) || existingRefs.has(l.sourceRef)) {
        duplicates++;
        return false;
      }
      seen.add(l.sourceRef);
      return true;
    });
    const keys = fresh.map((l) =>
      duplicateKey({
        transactionDate: l.transactionDate,
        amountMinor: l.amountMinor,
        currency: l.currency,
        merchant: l.merchant,
      }),
    );
    const crossRows = keys.length
      ? await tx
          .select({ id: actuals.id, key: actuals.duplicateKey, source: actuals.source })
          .from(actuals)
          .where(and(inArray(actuals.duplicateKey, keys), ne(actuals.source, source)))
      : [];
    const crossByKey = new Map(crossRows.map((r) => [r.key!, r.id]));

    const rateCache = new Map<string, { fiscalYearId: string; rates: FxRate[] } | null>();
    const planOn = async (date: string) => {
      const k = date.slice(0, 10);
      if (!rateCache.has(k)) rateCache.set(k, await this.reads.planRatesOn(tx, date));
      return rateCache.get(k)!;
    };
    const fxCache = new Map<string, Awaited<ReturnType<ActualsReads['actualRate']>>>();
    const fxOn = async (currency: CurrencyCode, date: string) => {
      const k = `${currency}|${date.slice(0, 7)}|${date}`;
      if (!fxCache.has(k))
        fxCache.set(k, await this.reads.actualRate(tx, currency, reporting, date));
      return fxCache.get(k)!;
    };

    // Open commitments in the file's entities, with what is still encumbered.
    const entityIds = [...new Set(fresh.map((l) => l.legalEntityId))];
    const cRows = entityIds.length
      ? await tx
          .select({
            c: commitments,
            budgetCurrency: budgets.currency,
            vendorName: vendors.name,
            eventCode: events.eventCode,
          })
          .from(commitments)
          .innerJoin(budgets, eq(budgets.id, commitments.budgetId))
          .leftJoin(vendors, eq(vendors.id, commitments.vendorId))
          .leftJoin(events, eq(events.id, commitments.eventId))
          .where(
            and(
              inArray(commitments.legalEntityId, entityIds),
              inArray(commitments.status, ['encumbered', 'partially_consumed']),
            ),
          )
      : [];
    const balances = await this.reads.commitmentBalances(
      tx,
      cRows.map((r) => r.c.id),
    );
    const prepaid = await this.engine.prepaidOutstanding(
      tx,
      cRows.map((r) => r.c.id),
    );
    const budgetCurrency = new Map<string, CurrencyCode>();
    const candidates: MatchCandidate[] = [];
    for (const r of cRows) {
      budgetCurrency.set(r.c.budgetId, r.budgetCurrency as CurrencyCode);
      const plan = await planOn(r.c.createdAt.toISOString().slice(0, 10));
      const total = plan
        ? buildTriplet(
            { amountMinor: r.c.amountMinor, currency: r.c.currency as CurrencyCode },
            {
              budgetCurrency: r.budgetCurrency as CurrencyCode,
              reportingCurrency: reporting,
              rates: plan.rates,
            },
          )
        : null;
      candidates.push({
        commitmentId: r.c.id,
        reference: commitmentRef(r.c.id),
        budgetId: r.c.budgetId,
        legalEntityId: r.c.legalEntityId,
        eventCode: r.eventCode,
        costCenterId: r.c.costCenterId,
        vendorId: r.c.vendorId,
        vendorName: r.vendorName,
        glAccountId: r.c.glAccountId,
        totalMinor: total?.ok ? total.value.budget.amountMinor : r.c.amountMinor,
        remainingMinor: (balances.get(r.c.id)?.encumberedMinor ?? 0) - (prepaid.get(r.c.id) ?? 0),
      });
    }
    const ruleRows = await tx
      .select({
        r: actualMappingRules,
        eventCode: events.eventCode,
        budgetCurrency: budgets.currency,
      })
      .from(actualMappingRules)
      .leftJoin(events, eq(events.id, actualMappingRules.targetEventId))
      .leftJoin(budgets, eq(budgets.id, actualMappingRules.targetBudgetId))
      .where(eq(actualMappingRules.active, true));
    for (const r of ruleRows)
      if (r.r.targetBudgetId && r.budgetCurrency)
        budgetCurrency.set(r.r.targetBudgetId, r.budgetCurrency as CurrencyCode);
    const rules: MappingRule[] = ruleRows.map((r) => ({
      id: r.r.id,
      priority: r.r.priority,
      match: r.r.match as MappingRule['match'],
      targetBudgetId: r.r.targetBudgetId,
      targetEventCode: r.eventCode,
    }));

    // Originals for refunds, credit notes and reversals (already in BudgetFlow, or earlier in this file).
    const origRefs = fresh.map((l) => l.originalRef).filter((x): x is string => Boolean(x));
    const origRows = origRefs.length
      ? await tx
          .select()
          .from(actuals)
          .where(
            and(
              inArray(actuals.sourceRef, origRefs),
              or(isNull(actuals.excludedReason), ne(actuals.matchStatus, 'excluded')),
            ),
          )
      : [];
    const origByRef = new Map(origRows.map((o) => [o.sourceRef, o]));
    const inFile = new Map<string, Proposal | null>();

    const rows: (typeof actuals.$inferInsert)[] = [];
    const flags: (typeof integrityFlags.$inferInsert)[] = [];
    const byCurrency = new Map<
      string,
      { lines: number; transactionMinor: number; planRate: string | null; reportingMinor: number }
    >();
    const ruleCounts = new Map<string, number>();
    let autoMatched = 0;
    let partiallyMatched = 0;
    let unmatched = 0;
    let cross = 0;
    let reportingTotal = 0;

    for (const [i, l] of fresh.entries()) {
      const plan = await planOn(l.accountingDate);
      if (!plan) {
        issues.push({
          line: l.line,
          field: 'accounting_date',
          message: 'No locked plan rate covers this date.',
        });
        continue;
      }
      const t = buildTriplet(
        { amountMinor: Math.abs(l.amountMinor), currency: l.currency },
        { budgetCurrency: reporting, reportingCurrency: reporting, rates: plan.rates },
      );
      if (!t.ok) {
        issues.push({ line: l.line, field: 'currency', message: t.error.message });
        continue;
      }
      const sign = l.amountMinor < 0 ? -1 : 1;
      const reportingMinor = sign * t.value.reporting.amountMinor;
      const fx = await fxOn(l.currency, l.transactionDate);
      const actualReporting = fx ? this.reads.convertWith(l.amountMinor, fx.rate) : null;
      const fxEffect = actualReporting === null ? 0 : actualReporting - reportingMinor;
      const id = randomUUID();
      const key = keys[i];
      const dupOf = crossByKey.get(key) ?? null;
      const budgetMinorOf = (budgetId: string) => {
        const ccy = budgetCurrency.get(budgetId);
        if (!ccy) return null;
        const bt = buildTriplet(
          { amountMinor: Math.abs(l.amountMinor), currency: l.currency },
          { budgetCurrency: ccy, reportingCurrency: reporting, rates: plan.rates },
        );
        return bt.ok ? bt.value.budget.amountMinor : null;
      };
      let proposal: Proposal | null = null;
      if (dupOf) {
        cross++;
        flags.push({
          tenantId: actor.tenantId,
          kind: 'cross_source_duplicate',
          severity: 'medium',
          resourceType: 'actual',
          resourceId: id,
          details: { duplicateOfActualId: dupOf, sourceRef: l.sourceRef, source },
        });
      } else if (
        l.kind === 'reversal' ||
        ((l.kind === 'refund' || l.kind === 'credit_note') && l.originalRef)
      ) {
        const o = l.originalRef ? origByRef.get(l.originalRef) : undefined;
        const fromFile = l.originalRef ? inFile.get(l.originalRef) : undefined;
        if (l.kind === 'reversal') {
          proposal =
            o || fromFile !== undefined
              ? {
                  rule: 'original_reference',
                  confidence: 99,
                  commitmentId: null,
                  budgetId: null,
                  fit: null,
                  note: null,
                }
              : null;
        } else if (o?.matchedBudgetId) {
          proposal = {
            rule: 'original_reference',
            confidence: 95,
            commitmentId: o.matchedCommitmentId,
            budgetId: o.matchedCommitmentId ? null : o.matchedBudgetId,
            fit: 'refund',
            note: null,
          };
        } else if (fromFile) {
          proposal = {
            ...fromFile,
            rule: 'original_reference',
            confidence: 95,
            fit: 'refund',
            note: null,
          };
        }
      }
      if (!dupOf && !proposal && l.kind !== 'reversal') {
        const p = proposeMatch(l, candidates, rules, { toleranceBps, budgetMinorOf });
        if (p) {
          proposal = {
            rule: p.rule,
            confidence: p.confidence,
            commitmentId: p.commitmentId,
            budgetId: p.commitmentId ? null : p.budgetId,
            fit: sign < 0 ? 'refund' : 'direct',
            note: null,
          };
          const c = p.commitmentId
            ? candidates.find((x) => x.commitmentId === p.commitmentId)
            : null;
          if (c && sign > 0) {
            const actualBudget = budgetMinorOf(c.budgetId) ?? 0;
            const f = classifyFit({
              actualMinor: actualBudget,
              remainingMinor: c.remainingMinor,
              commitmentTotalMinor: c.totalMinor,
              toleranceBps,
            });
            proposal.fit = f.fit;
            if (f.fit === 'over_tolerance')
              proposal.note =
                'Above the commitment plus its tolerance. Request over-budget approval for the difference.';
            else c.remainingMinor -= f.reliefMinor;
          }
        }
      }
      inFile.set(l.sourceRef, proposal);
      if (proposal && !proposal.note) {
        if (
          proposal.fit === 'exact' ||
          proposal.fit === 'direct' ||
          proposal.fit === 'refund' ||
          proposal.rule === 'original_reference'
        )
          autoMatched++;
        else partiallyMatched++;
        ruleCounts.set(proposal.rule, (ruleCounts.get(proposal.rule) ?? 0) + 1);
      } else unmatched++;
      const cur = byCurrency.get(l.currency) ?? {
        lines: 0,
        transactionMinor: 0,
        planRate:
          l.currency === reporting
            ? '1.000000000000'
            : (plan.rates.find((r) => r.quote === l.currency)?.value ?? null),
        reportingMinor: 0,
      };
      cur.lines++;
      cur.transactionMinor += l.amountMinor;
      cur.reportingMinor += reportingMinor;
      byCurrency.set(l.currency, cur);
      reportingTotal += reportingMinor;
      rows.push({
        id,
        tenantId: actor.tenantId,
        source,
        sourceRef: l.sourceRef,
        kind: l.kind,
        legalEntityId: l.legalEntityId,
        costCenterId: l.costCenterId,
        glAccountId: l.glAccountId,
        eventCode: l.eventCode,
        vendorId: l.vendorId,
        merchant: l.merchant,
        memo: l.memo,
        transactionDate: l.transactionDate,
        accountingDate: l.accountingDate,
        transactionCurrency: l.currency,
        transactionAmountMinor: l.amountMinor,
        reportingCurrency: reporting,
        reportingAmountMinor: reportingMinor,
        actualRate: fx?.rate.value ?? t.value.reportingRate.value,
        planRate: t.value.reportingRate.value,
        actualRateType: fx?.type ?? null,
        actualReportingMinor: actualReporting,
        fxEffectMinor: fxEffect,
        duplicateKey: key,
        lineNo: l.line,
        reference: l.reference,
        originalRef: l.originalRef,
        cardProgram: l.cardProgram,
        proposedCommitmentId: proposal?.commitmentId ?? null,
        proposedBudgetId: proposal?.budgetId ?? null,
        matchRule: proposal?.rule ?? null,
        matchConfidence: proposal?.confidence ?? null,
        matchNote: dupOf
          ? 'Possible duplicate of a line from another source; confirm before matching.'
          : (proposal?.note ?? (proposal ? null : 'No matching rule found.')),
        duplicateOfActualId: dupOf,
      });
    }
    const imported = rows.length;
    const summary: Summary = {
      linesRead: rowCount,
      imported,
      rejected: new Set(issues.map((x) => x.line)).size,
      duplicatesSkipped: duplicates,
      crossSourceDuplicates: cross,
      autoMatched,
      partiallyMatched,
      unmatched,
      matchRateBps: imported
        ? Math.floor(((autoMatched + partiallyMatched) * 10_000) / imported)
        : 0,
      reportingCurrency: reporting,
      reportingTotalMinor: reportingTotal,
      byCurrency: [...byCurrency.entries()]
        .map(([currency, v]) => ({ currency, ...v }))
        .sort((a, b) => b.lines - a.lines || a.currency.localeCompare(b.currency)),
      rules: [...ruleCounts.entries()]
        .map(([rule, n]) => ({ rule: rule as Proposal['rule'], lines: n }))
        .sort((a, b) => b.lines - a.lines),
      posted: null,
    };
    return { rows, flags, duplicates, summary };
  }
}
