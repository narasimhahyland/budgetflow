import {
  CommandRunner,
  PolicyService,
  unwrap,
  ApiProblem,
  type CommandResult,
  type RequestActor,
  todayUtc,
} from '@bf/api/core';
import { AuditService } from '@bf/api/audit';
import type { Tx } from '@bf/api/db';
import type { Journal } from '@bf/contracts';
import {
  applyDelta,
  checkNotOverdrawn,
  isBudgetBucket,
  postManualJournal,
  reverseJournal,
  type CurrencyCode,
  type JournalLine,
  type LedgerAccount,
  type ManualLineInput,
} from '@bf/domain';
import { Injectable } from '@nestjs/common';
import { LedgerReads, toPostingBudget } from './ledger-reads.service';
import { LedgerService } from './ledger.service';
import { ThresholdAlerts } from './threshold-alerts.service';

/**
 * Re-exported so this module's callers keep their existing import, with one implementation
 * behind it: `@bf/api/core` owns the clock, which a test run can pin (`FIXED_NOW`).
 */
export { todayUtc };

export interface ManualJournalInput {
  transactionCurrency: string;
  accountingDate?: string;
  reasonCode: string;
  reason: string;
  lines: {
    budgetId: string | null;
    account: LedgerAccount;
    side: 'debit' | 'credit';
    amountMinor: number;
    legalEntityId?: string;
  }[];
}

/** Ledger commands: reversal (never edit) and manual journals for opening balances and adjustments. */
@Injectable()
export class LedgerCommands {
  constructor(
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly reads: LedgerReads,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly alerts: ThresholdAlerts,
  ) {}

  reverse(
    actor: RequestActor,
    journalId: string,
    req: { reasonCode: string; reason: string; accountingDate?: string },
    ctx: { idempotencyKey: string; requestId: string | null },
  ): Promise<CommandResult<Journal>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `ledger.reverse:${journalId}`,
        request: req,
        status: 201,
      },
      async (tx) => {
        this.policy.assert(
          actor,
          'ledger.reverse',
          { kind: 'tenant', tenantId: actor.tenantId },
          'journal',
        );
        const reversalId = await this.reverseInTx(tx, actor, journalId, req, ctx);
        return this.ledger.journalDto(tx, reversalId);
      },
    );
  }

  /**
   * Posts the reversal inside the caller's transaction and returns the new journal id, so commands
   * that correct something else (a post-spend reclassification, for example) stay atomic with it.
   * Callers authorize first; this method assumes the check already passed.
   */
  async reverseInTx(
    tx: Tx,
    actor: RequestActor,
    journalId: string,
    req: { reasonCode: string; reason: string; accountingDate?: string },
    ctx: { idempotencyKey: string; requestId: string | null },
  ): Promise<string> {
    const original = await this.ledger.journalRow(tx, journalId);
    if (!original) throw ApiProblem.notFound('journal');
    const lines = await this.ledger.linesOf(tx, journalId);
    const budgetIds = [
      ...new Set(lines.map((l) => l.budgetId).filter((b): b is string => Boolean(b))),
    ];
    await this.reads.lockBudgets(tx, budgetIds);
    const before = await this.alerts.utilizations(tx, budgetIds);
    const draft = unwrap(
      reverseJournal(
        {
          id: original.id,
          type: original.journalType,
          reversalOfJournalId: original.reversalOfJournalId,
          transactionCurrency: original.transactionCurrency as CurrencyCode,
          reportingCurrency: original.reportingCurrency as CurrencyCode,
          lines: lines.map((l) => ({ ...toDomainLine(l), id: l.id })),
        },
        {
          accountingDate: req.accountingDate ?? todayUtc(),
          reasonCode: req.reasonCode,
          reason: req.reason,
          alreadyReversed: (await this.ledger.reversedBy(tx, journalId)) !== null,
        },
      ),
    );
    const rows = await this.reads.budgetRows(tx, budgetIds);
    const balances = await this.reads.balances(tx, budgetIds);
    for (const id of budgetIds) {
      const budget = toPostingBudget(rows.get(id)!);
      const deltas = draft.lines
        .filter((l) => l.budgetId === id)
        .map((l) => ({ account: l.account, budgetAmountMinor: l.budget!.amountMinor }));
      unwrap(
        checkNotOverdrawn(
          applyDelta(balances.get(id)!.budget, deltas),
          budget.control,
          id,
          'REVERSAL_WOULD_OVERDRAW',
        ),
      );
    }
    const reversalId = await this.ledger.post(tx, draft, {
      actor,
      command: 'ledger.reverse',
      fiscalYearId: budgetIds.length ? rows.get(budgetIds[0])!.fiscalYearId : null,
      requestId: ctx.requestId,
      idempotencyKey: ctx.idempotencyKey,
      allowSoftClosed: true,
    });
    await this.alerts.emit(tx, actor.tenantId, before, budgetIds);
    await this.audit.append(tx, {
      tenantId: actor.tenantId,
      actorPersonId: actor.personId,
      actorSubject: actor.subject,
      action: 'ledger.journal.reversed',
      resourceType: 'journal',
      resourceId: journalId,
      legalEntityId: lines[0]?.legalEntityId ?? null,
      requestId: ctx.requestId,
      reason: `${req.reasonCode}: ${req.reason}`,
      changes: { reversedBy: { from: null, to: reversalId } },
    });
    return reversalId;
  }

  postManual(
    actor: RequestActor,
    req: ManualJournalInput,
    ctx: { idempotencyKey: string; requestId: string | null },
  ): Promise<CommandResult<Journal>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'ledger.manual_journal',
        request: req,
        status: 201,
      },
      async (tx) => {
        this.policy.assert(actor, 'ledger.manual_journal', {
          kind: 'tenant',
          tenantId: actor.tenantId,
        });
        const budgetIds = [
          ...new Set(req.lines.map((l) => l.budgetId).filter((b): b is string => Boolean(b))),
        ];
        await this.reads.lockBudgets(tx, budgetIds);
        const before = await this.alerts.utilizations(tx, budgetIds);
        const rows = await this.reads.budgetRows(tx, budgetIds);
        for (const id of budgetIds) if (!rows.has(id)) throw ApiProblem.notFound('budget');
        const fiscalYears = new Set([...rows.values()].map((r) => r.fiscalYearId));
        if (fiscalYears.size > 1)
          throw new ApiProblem(
            422,
            'VALIDATION_FAILED',
            'A manual journal posts within one fiscal year.',
          );
        const fiscalYearId = [...fiscalYears][0];
        if (!fiscalYearId) {
          throw new ApiProblem(
            422,
            'JOURNAL_LINE_INVALID',
            'A manual journal needs at least one budget line to determine the fiscal year and plan rates.',
          );
        }
        const balances = await this.reads.balances(tx, budgetIds);
        const lines: ManualLineInput[] = req.lines.map((l) => {
          const row = l.budgetId ? rows.get(l.budgetId)! : null;
          const budget = row
            ? { ...toPostingBudget(row), balances: balances.get(row.id)!.budget }
            : null;
          if (!row && !l.legalEntityId)
            throw new ApiProblem(
              422,
              'JOURNAL_LINE_INVALID',
              'Counter-account lines need a legal entity.',
            );
          if (row && !isBudgetBucket(l.account))
            throw new ApiProblem(
              422,
              'JOURNAL_LINE_INVALID',
              'Counter accounts are not posted against a budget.',
            );
          return {
            budget,
            account: l.account,
            side: l.side,
            amountMinor: l.amountMinor,
            legalEntityId: row?.legalEntityId ?? l.legalEntityId!,
          };
        });
        const draft = unwrap(
          postManualJournal(
            {
              transactionCurrency: req.transactionCurrency as CurrencyCode,
              lines,
              reasonCode: req.reasonCode,
              reason: req.reason,
            },
            {
              reportingCurrency: actor.reportingCurrency,
              rates: await this.reads.planRates(tx, fiscalYearId),
              accountingDate: req.accountingDate ?? todayUtc(),
            },
          ),
        );
        const journalId = await this.ledger.post(tx, draft, {
          actor,
          command: 'ledger.manual_journal',
          fiscalYearId,
          requestId: ctx.requestId,
          idempotencyKey: ctx.idempotencyKey,
          allowSoftClosed: true,
        });
        await this.alerts.emit(tx, actor.tenantId, before, budgetIds);
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'ledger.journal.posted',
          resourceType: 'journal',
          resourceId: journalId,
          legalEntityId: lines[0].legalEntityId,
          requestId: ctx.requestId,
          reason: `${req.reasonCode}: ${req.reason}`,
          changes: {
            transactionCurrency: { from: null, to: draft.transactionCurrency },
            accountingDate: { from: null, to: draft.accountingDate },
            lines: {
              from: null,
              to: draft.lines.map((l) => ({
                budgetId: l.budgetId,
                account: l.account,
                legalEntityId: l.legalEntityId,
                transactionMinor: l.transaction.amountMinor,
                budgetMinor: l.budget?.amountMinor ?? null,
                reportingMinor: l.reporting.amountMinor,
              })),
            },
          },
        });
        return this.ledger.journalDto(tx, journalId);
      },
    );
  }
}

function toDomainLine(l: Awaited<ReturnType<LedgerService['linesOf']>>[number]): JournalLine {
  return {
    budgetId: l.budgetId,
    account: l.account,
    legalEntityId: l.legalEntityId,
    costCenterId: l.costCenterId,
    glAccountId: l.glAccountId,
    eventCode: l.eventCode,
    transaction: {
      amountMinor: l.transactionAmountMinor,
      currency: l.transactionCurrency as CurrencyCode,
    },
    budget:
      l.budgetCurrency && l.budgetAmountMinor !== null
        ? { amountMinor: l.budgetAmountMinor, currency: l.budgetCurrency as CurrencyCode }
        : null,
    reporting: {
      amountMinor: l.reportingAmountMinor,
      currency: l.reportingCurrency as CurrencyCode,
    },
    budgetRate:
      l.budgetRateType && l.budgetRate && l.budgetCurrency
        ? {
            type: l.budgetRateType,
            from: l.transactionCurrency as CurrencyCode,
            to: l.budgetCurrency as CurrencyCode,
            value: l.budgetRate,
            rateIds: l.budgetRateIds ?? [],
          }
        : null,
    reportingRate: {
      type: l.reportingRateType,
      from: l.transactionCurrency as CurrencyCode,
      to: l.reportingCurrency as CurrencyCode,
      value: l.reportingRate,
      rateIds: l.reportingRateIds,
    },
    planVersionId: l.planVersionId,
    commitmentId: l.commitmentId,
    eventId: l.eventId,
    contributionId: l.contributionId,
    actualId: l.actualId,
    requestId: l.requestId,
    approvalId: l.approvalId,
    importLineId: l.importLineId,
  };
}
