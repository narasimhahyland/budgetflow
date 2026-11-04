import { fiscalPeriods, ledgerBalances, ledgerJournals, ledgerLines, type Tx } from '@bf/api/db';
import { unwrap, type RequestActor } from '@bf/api/core';
import type { Journal } from '@bf/contracts';
import { buildJournal, journalTotals, type JournalDraft } from '@bf/domain';
import { Injectable } from '@nestjs/common';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { LedgerReads } from './ledger-reads.service';

export interface PostOptions {
  actor: Pick<RequestActor, 'tenantId' | 'personId' | 'subject'>;
  command: string;
  requestId?: string | null;
  idempotencyKey?: string | null;
  /** Finance adjustments (reversals, manual journals) may land in a soft-closed period. */
  allowSoftClosed?: boolean;
}

type LineRow = typeof ledgerLines.$inferSelect;
type JournalRow = typeof ledgerJournals.$inferSelect;

/**
 * Posts balanced journals: resolves the accounting period per legal entity (closed periods never
 * receive postings; late items go to the next open period, flagged), inserts the append-only journal
 * and lines, and updates cached balances in the same transaction. Callers hold the budget row locks.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly reads: LedgerReads) {}

  async post(tx: Tx, draft: JournalDraft, opts: PostOptions): Promise<string> {
    const journal = unwrap(buildJournal(draft));
    const periods = await this.reads.postingPeriods(
      tx,
      journal.lines.map((l) => l.legalEntityId),
      journal.accountingDate,
      Boolean(opts.allowSoftClosed),
    );
    const head = periods.get(journal.lines[0].legalEntityId)!;
    const journalId = randomUUID();
    await tx.insert(ledgerJournals).values({
      id: journalId,
      tenantId: opts.actor.tenantId,
      journalType: journal.type,
      transactionCurrency: journal.transactionCurrency,
      reportingCurrency: journal.reportingCurrency,
      accountingDate: journal.accountingDate,
      fiscalPeriodId: head.period.id,
      late: head.late,
      originalPeriodId: head.originalPeriodId,
      reversalOfJournalId: journal.reversalOfJournalId ?? null,
      reasonCode: journal.reasonCode ?? null,
      reason: journal.reason ?? null,
      command: opts.command,
      requestId: opts.requestId ?? null,
      idempotencyKey: opts.idempotencyKey ?? null,
      actorPersonId: opts.actor.personId,
      actorSubject: opts.actor.subject,
    });
    const rows = journal.lines.map((l, i) => {
      const p = periods.get(l.legalEntityId)!;
      return {
        tenantId: opts.actor.tenantId,
        journalId,
        lineNo: i + 1,
        budgetId: l.budgetId,
        account: l.account,
        legalEntityId: l.legalEntityId,
        costCenterId: l.costCenterId ?? null,
        glAccountId: l.glAccountId ?? null,
        eventCode: l.eventCode ?? null,
        fiscalPeriodId: p.period.id,
        accountingDate: journal.accountingDate,
        late: p.late,
        transactionCurrency: l.transaction.currency,
        transactionAmountMinor: l.transaction.amountMinor,
        budgetCurrency: l.budget?.currency ?? null,
        budgetAmountMinor: l.budget?.amountMinor ?? null,
        reportingCurrency: l.reporting.currency,
        reportingAmountMinor: l.reporting.amountMinor,
        budgetRateType: l.budgetRate?.type ?? null,
        budgetRate: l.budgetRate?.value ?? null,
        budgetRateIds: l.budgetRate?.rateIds ?? null,
        reportingRateType: l.reportingRate.type,
        reportingRate: l.reportingRate.value,
        reportingRateIds: l.reportingRate.rateIds,
        planVersionId: l.planVersionId ?? null,
        commitmentId: l.commitmentId ?? null,
        eventId: l.eventId ?? null,
        contributionId: l.contributionId ?? null,
        actualId: l.actualId ?? null,
        requestId: l.requestId ?? null,
        approvalId: l.approvalId ?? null,
        importLineId: l.importLineId ?? null,
        reversalOfLineId: l.reversalOfLineId ?? null,
      };
    });
    await tx.insert(ledgerLines).values(rows);
    for (const r of rows) {
      if (!r.budgetId || r.budgetAmountMinor === null) continue;
      await tx
        .insert(ledgerBalances)
        .values({
          tenantId: r.tenantId,
          budgetId: r.budgetId,
          fiscalPeriodId: r.fiscalPeriodId,
          bucket: r.account,
          budgetAmountMinor: r.budgetAmountMinor,
          reportingAmountMinor: r.reportingAmountMinor,
          lineCount: 1,
        })
        .onConflictDoUpdate({
          target: [ledgerBalances.budgetId, ledgerBalances.fiscalPeriodId, ledgerBalances.bucket],
          set: {
            budgetAmountMinor: sql`${ledgerBalances.budgetAmountMinor} + excluded.budget_amount_minor`,
            reportingAmountMinor: sql`${ledgerBalances.reportingAmountMinor} + excluded.reporting_amount_minor`,
            lineCount: sql`${ledgerBalances.lineCount} + 1`,
            updatedAt: sql`now()`,
          },
        });
    }
    return journalId;
  }

  async journalRow(tx: Tx, journalId: string): Promise<JournalRow | undefined> {
    return (await tx.select().from(ledgerJournals).where(eq(ledgerJournals.id, journalId)))[0];
  }

  async linesOf(tx: Tx, journalId: string): Promise<LineRow[]> {
    return tx
      .select()
      .from(ledgerLines)
      .where(eq(ledgerLines.journalId, journalId))
      .orderBy(asc(ledgerLines.lineNo));
  }

  async reversedBy(tx: Tx, journalId: string): Promise<string | null> {
    const [r] = await tx
      .select({ id: ledgerJournals.id })
      .from(ledgerJournals)
      .where(eq(ledgerJournals.reversalOfJournalId, journalId));
    return r?.id ?? null;
  }

  async journalDto(tx: Tx, journalId: string): Promise<Journal> {
    const j = (await this.journalRow(tx, journalId))!;
    const lines = await this.linesOf(tx, journalId);
    const [period] = await tx
      .select({ label: fiscalPeriods.label })
      .from(fiscalPeriods)
      .where(eq(fiscalPeriods.id, j.fiscalPeriodId));
    const dtoLines = lines.map(lineDto);
    const totals = journalTotals(dtoLines);
    return {
      id: j.id,
      type: j.journalType,
      transactionCurrency: j.transactionCurrency,
      reportingCurrency: j.reportingCurrency,
      accountingDate: j.accountingDate,
      periodId: j.fiscalPeriodId,
      periodLabel: period?.label ?? '',
      late: j.late,
      originalPeriodId: j.originalPeriodId,
      reversalOfJournalId: j.reversalOfJournalId,
      reversedByJournalId: await this.reversedBy(tx, j.id),
      reasonCode: j.reasonCode,
      reason: j.reason,
      actorPersonId: j.actorPersonId,
      createdAt: j.createdAt.toISOString(),
      totals,
      balanced:
        totals.debitTransactionMinor === totals.creditTransactionMinor &&
        totals.debitReportingMinor === totals.creditReportingMinor,
      lines: dtoLines,
    };
  }

  async budgetLines(tx: Tx, budgetId: string): Promise<Journal['lines']> {
    const rows = await tx
      .select()
      .from(ledgerLines)
      .where(inArray(ledgerLines.budgetId, [budgetId]))
      .orderBy(asc(ledgerLines.createdAt), asc(ledgerLines.lineNo));
    return rows.map(lineDto);
  }
}

export function lineDto(l: LineRow): Journal['lines'][number] {
  return {
    id: l.id,
    journalId: l.journalId,
    lineNo: l.lineNo,
    budgetId: l.budgetId,
    account: l.account,
    legalEntityId: l.legalEntityId,
    costCenterId: l.costCenterId,
    glAccountId: l.glAccountId,
    eventCode: l.eventCode,
    periodId: l.fiscalPeriodId,
    accountingDate: l.accountingDate,
    transaction: { amountMinor: l.transactionAmountMinor, currency: l.transactionCurrency },
    budget:
      l.budgetCurrency && l.budgetAmountMinor !== null
        ? { amountMinor: l.budgetAmountMinor, currency: l.budgetCurrency }
        : null,
    reporting: { amountMinor: l.reportingAmountMinor, currency: l.reportingCurrency },
    budgetRate:
      l.budgetRateType && l.budgetRate && l.budgetCurrency
        ? {
            type: l.budgetRateType,
            from: l.transactionCurrency,
            to: l.budgetCurrency,
            value: l.budgetRate,
            rateIds: l.budgetRateIds ?? [],
          }
        : null,
    reportingRate: {
      type: l.reportingRateType,
      from: l.transactionCurrency,
      to: l.reportingCurrency,
      value: l.reportingRate,
      rateIds: l.reportingRateIds,
    },
    planVersionId: l.planVersionId,
    reversalOfLineId: l.reversalOfLineId,
  };
}
