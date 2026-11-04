import { actualMatches, commitments, importBatches, requests, type Tx } from '@bf/api/db';
import type { ActualLine, ImportBatch, OverBudgetRequest } from '@bf/contracts';
import { Injectable } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { ActualsReads, commitmentRef, type ActualRow } from './actuals-reads';

type BatchRow = typeof importBatches.$inferSelect;
type RequestRow = typeof requests.$inferSelect;
type MatchRow = typeof actualMatches.$inferSelect;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Maps rows to contract shapes, loading the names and codes they show in one pass. */
@Injectable()
export class ActualsDtos {
  constructor(private readonly reads: ActualsReads) {}

  overBudget(
    r: RequestRow,
    actualId: string,
    budgetName: string,
    commitmentId: string | null,
  ): OverBudgetRequest {
    return {
      id: r.id,
      status:
        r.status === 'approved'
          ? 'approved'
          : r.status === 'rejected'
            ? 'rejected'
            : 'pending_approval',
      actualId,
      budgetId: r.budgetId!,
      budgetName,
      commitmentId,
      amount: { amountMinor: r.amountMinor, currency: r.currency },
      approved:
        r.approvedMinor === null ? null : { amountMinor: r.approvedMinor, currency: r.currency },
      purpose: r.purpose,
      requesterPersonId: r.requesterPersonId,
      decidedByPersonId: null,
      decisionReason: null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async lines(tx: Tx, rows: ActualRow[], reportingCurrency: string): Promise<ActualLine[]> {
    if (rows.length === 0) return [];
    const lk = await this.reads.lookups(tx);
    const budgetNames = await this.reads.budgetNames(tx, [
      ...rows.map((r) => r.proposedBudgetId),
      ...rows.map((r) => r.matchedBudgetId),
    ]);
    const commitmentIds = rows
      .map((r) => r.proposedCommitmentId)
      .filter((x): x is string => Boolean(x));
    const cRows = commitmentIds.length
      ? await tx
          .select({ id: commitments.id, budgetId: commitments.budgetId })
          .from(commitments)
          .where(inArray(commitments.id, commitmentIds))
      : [];
    const cBudget = new Map(cRows.map((c) => [c.id, c.budgetId]));
    const reqIds = rows.map((r) => r.overBudgetRequestId).filter((x): x is string => Boolean(x));
    const reqRows = reqIds.length
      ? await tx.select().from(requests).where(inArray(requests.id, reqIds))
      : [];
    const reqBudgetNames = await this.reads.budgetNames(
      tx,
      reqRows.map((r) => r.budgetId),
    );
    const reqById = new Map(reqRows.map((r) => [r.id, r]));
    return rows.map((r): ActualLine => {
      const entity = lk.entities.get(r.legalEntityId);
      const req = r.overBudgetRequestId ? reqById.get(r.overBudgetRequestId) : undefined;
      const suggestionBudget =
        r.proposedBudgetId ?? (r.proposedCommitmentId ? cBudget.get(r.proposedCommitmentId) : null);
      return {
        id: r.id,
        batchId: r.importBatchId,
        lineNo: r.lineNo,
        source: r.source,
        sourceRef: r.sourceRef,
        kind: r.kind,
        status: r.matchStatus,
        transactionDate: r.transactionDate,
        accountingDate: r.accountingDate,
        legalEntityId: r.legalEntityId,
        legalEntityCode: entity?.code ?? '',
        costCenterId: r.costCenterId,
        costCenterCode: r.costCenterId ? (lk.costCenters.get(r.costCenterId)?.code ?? null) : null,
        glAccountId: r.glAccountId,
        glAccountCode: r.glAccountId ? (lk.glAccounts.get(r.glAccountId)?.code ?? null) : null,
        eventCode: r.eventCode,
        vendorId: r.vendorId,
        vendorName: r.vendorId ? (lk.vendors.get(r.vendorId) ?? null) : null,
        merchant: r.merchant,
        memo: r.memo,
        reference: r.reference,
        originalRef: r.originalRef,
        cardProgram: r.cardProgram,
        transaction: { amountMinor: r.transactionAmountMinor, currency: r.transactionCurrency },
        reporting: { amountMinor: r.reportingAmountMinor, currency: r.reportingCurrency },
        planRate: r.planRate,
        actualRate: r.actualRateType
          ? { type: r.actualRateType as 'spot', value: r.actualRate }
          : null,
        actualReporting:
          r.actualReportingMinor === null
            ? null
            : { amountMinor: r.actualReportingMinor, currency: reportingCurrency },
        fxEffect: { amountMinor: r.fxEffectMinor, currency: reportingCurrency },
        matched: { amountMinor: r.matchedMinor, currency: r.transactionCurrency },
        budget:
          r.budgetCurrency && r.budgetAmountMinor !== null
            ? { amountMinor: r.budgetAmountMinor, currency: r.budgetCurrency }
            : null,
        suggestion:
          r.matchRule && suggestionBudget
            ? {
                rule: r.matchRule as 'manual',
                confidence: r.matchConfidence ?? 0,
                commitmentId: r.proposedCommitmentId,
                commitmentReference: r.proposedCommitmentId
                  ? commitmentRef(r.proposedCommitmentId)
                  : null,
                budgetId: suggestionBudget,
                budgetName: budgetNames.get(suggestionBudget) ?? '',
                fit: null,
                differenceMinor: null,
              }
            : null,
        note: r.matchNote,
        duplicateOfActualId: r.duplicateOfActualId,
        excludedReason: r.excludedReason,
        overBudgetRequest: req
          ? this.overBudget(
              req,
              r.id,
              reqBudgetNames.get(req.budgetId!) ?? '',
              r.proposedCommitmentId,
            )
          : null,
        matchedAt: iso(r.matchedAt),
      };
    });
  }

  async matchParts(tx: Tx, rows: MatchRow[]) {
    const names = await this.reads.budgetNames(
      tx,
      rows.map((m) => m.budgetId),
    );
    return rows.map((m) => ({
      id: m.id,
      commitmentId: m.commitmentId,
      commitmentReference: m.commitmentId ? commitmentRef(m.commitmentId) : null,
      budgetId: m.budgetId,
      budgetName: names.get(m.budgetId) ?? '',
      transaction: { amountMinor: m.transactionAmountMinor, currency: m.transactionCurrency },
      budget: { amountMinor: m.budgetAmountMinor, currency: m.budgetCurrency },
      relief: { amountMinor: m.reliefMinor, currency: m.budgetCurrency },
      released: { amountMinor: m.releasedMinor, currency: m.budgetCurrency },
      excess: { amountMinor: m.excessMinor, currency: m.budgetCurrency },
      fit: (m.fit as 'exact' | null) ?? null,
      rule: (m.rule as 'manual' | null) ?? null,
      prepaid: m.prepaid,
      journalIds: m.journalIds,
      createdAt: m.createdAt.toISOString(),
      reversedAt: iso(m.reversedAt),
      reversalReason: m.reversalReason,
    }));
  }

  async batch(tx: Tx, b: BatchRow): Promise<ImportBatch> {
    const names = await this.reads.personNames(tx, [b.createdBy, b.postedBy]);
    return {
      id: b.id,
      source: b.source,
      fileName: b.fileName,
      status: b.status,
      lineCount: b.lineCount,
      importedCount: b.importedCount,
      rejectedCount: b.rejectedCount,
      duplicateCount: b.duplicateCount,
      columnMapping: b.columnMapping as Record<string, string | null>,
      summary: b.summary as ImportBatch['summary'],
      issues: (b.issues as ImportBatch['issues']).slice(0, 200),
      createdAt: b.createdAt.toISOString(),
      createdByName: b.createdBy ? (names.get(b.createdBy) ?? null) : null,
      postedAt: iso(b.postedAt),
      postedByName: b.postedBy ? (names.get(b.postedBy) ?? null) : null,
    };
  }
}
