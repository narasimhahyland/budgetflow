import {
  accruals,
  actuals,
  glTieoutRuns,
  importBatches,
  integrityCheckRuns,
  integrityFlags,
  ledgerLines,
  prepaids,
  type Tx,
} from '@bf/api/db';
import { closeCheckKind, type CloseCheckCode } from '@bf/domain';
import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { PeriodRow } from './close-reads';

export interface CheckContext {
  tenantId: string;
  period: PeriodRow;
  legalEntityId: string;
  legalEntityCode: string;
}

export interface CheckResult {
  code: CloseCheckCode;
  status: 'pass' | 'warn' | 'fail';
  title: string;
  detail: string;
  count: number;
  amountMinor: number | null;
  currency: string | null;
}

export type PeriodCheck = (tx: Tx, ctx: CheckContext) => Promise<CheckResult>;

/**
 * Conditions a period must meet before it closes, registered the same way Phase 6 registers extra
 * event-close conditions on `EventCloseChecks`: a phase that adds a source of unreconciled state
 * registers one function instead of editing the close command. Hard checks block the close and
 * cannot be acknowledged; soft checks can be acknowledged with a reason.
 */
@Injectable()
export class PeriodCloseChecks {
  private readonly checks: PeriodCheck[] = [];

  register(check: PeriodCheck): void {
    this.checks.push(check);
  }

  registerAll(checks: readonly PeriodCheck[]): void {
    for (const c of checks) this.register(c);
  }

  async run(tx: Tx, ctx: CheckContext): Promise<CheckResult[]> {
    const out: CheckResult[] = [];
    for (const check of this.checks) out.push(await check(tx, ctx));
    return out;
  }
}

const money = (minor: number, currency: string | null) =>
  currency ? `${(minor / 100).toFixed(2)} ${currency}` : `${minor}`;

const pass = (code: CloseCheckCode, title: string, detail: string, count = 0): CheckResult => ({
  code,
  status: 'pass',
  title,
  detail,
  count,
  amountMinor: null,
  currency: null,
});

const fail = (
  code: CloseCheckCode,
  title: string,
  detail: string,
  count: number,
  amountMinor: number | null = null,
  currency: string | null = null,
): CheckResult => ({ code, status: 'fail', title, detail, count, amountMinor, currency });

const warn = (
  code: CloseCheckCode,
  title: string,
  detail: string,
  count: number,
  amountMinor: number | null = null,
  currency: string | null = null,
): CheckResult => ({ code, status: 'warn', title, detail, count, amountMinor, currency });

/** The GL tie-out for this entity and period is signed off (hard). */
const glTieOutSignedOff: PeriodCheck = async (tx, ctx) => {
  const [run] = await tx
    .select()
    .from(glTieoutRuns)
    .where(
      and(
        eq(glTieoutRuns.fiscalPeriodId, ctx.period.id),
        eq(glTieoutRuns.legalEntityId, ctx.legalEntityId),
      ),
    )
    .orderBy(desc(glTieoutRuns.createdAt))
    .limit(1);
  const code: CloseCheckCode = 'gl_tieout_signed_off';
  const title = 'GL tie-out signed off';
  if (!run) return fail(code, title, `${ctx.legalEntityCode} has no tie-out for this period.`, 1);
  if (run.status === 'signed_off')
    return pass(code, title, `Signed off on ${run.signedOffAt?.toISOString().slice(0, 10)}.`);
  return fail(
    code,
    title,
    `${ctx.legalEntityCode}'s tie-out is ${run.status.replace(/_/g, ' ')}; sign it off before the close.`,
    1,
  );
};

/** Every journal of the period balances in both views (hard). */
const journalsBalanced: PeriodCheck = async (tx, ctx) => {
  const rows = await tx
    .select({
      journalId: ledgerLines.journalId,
      t: sql<string>`sum(${ledgerLines.transactionAmountMinor})`,
      r: sql<string>`sum(${ledgerLines.reportingAmountMinor})`,
    })
    .from(ledgerLines)
    .where(
      and(
        eq(ledgerLines.fiscalPeriodId, ctx.period.id),
        eq(ledgerLines.legalEntityId, ctx.legalEntityId),
      ),
    )
    .groupBy(ledgerLines.journalId);
  const code: CloseCheckCode = 'journals_balanced';
  const title = 'No unbalanced journals';
  // A journal that spans entities balances across them, so only whole-journal sums decide.
  const suspect = rows
    .filter((r) => Number(r.t) !== 0 || Number(r.r) !== 0)
    .map((r) => r.journalId);
  if (!suspect.length)
    return pass(code, title, `${rows.length} journal(s) in the period balance.`, rows.length);
  const totals = await tx
    .select({
      journalId: ledgerLines.journalId,
      t: sql<string>`sum(${ledgerLines.transactionAmountMinor})`,
      r: sql<string>`sum(${ledgerLines.reportingAmountMinor})`,
    })
    .from(ledgerLines)
    .where(inArray(ledgerLines.journalId, suspect))
    .groupBy(ledgerLines.journalId);
  const unbalanced = totals.filter((r) => Number(r.t) !== 0 || Number(r.r) !== 0);
  return unbalanced.length
    ? fail(code, title, `${unbalanced.length} journal(s) do not balance.`, unbalanced.length)
    : pass(code, title, `${rows.length} journal(s) in the period balance.`, rows.length);
};

/** The latest nightly ledger rebuild check is clean and no integrity flag is open (hard). */
const ledgerCheckClean: PeriodCheck = async (tx) => {
  const code: CloseCheckCode = 'ledger_check_clean';
  const title = 'Nightly ledger check clean';
  const [run] = await tx
    .select()
    .from(integrityCheckRuns)
    .where(eq(integrityCheckRuns.kind, 'ledger_rebuild'))
    .orderBy(desc(integrityCheckRuns.requestedAt))
    .limit(1);
  if (!run)
    return fail(code, title, 'No ledger rebuild check has run yet; run one before the close.', 1);
  if (run.status !== 'clean')
    return fail(
      code,
      title,
      `The last ledger check is ${run.status.replace(/_/g, ' ')}; it must be clean before the close.`,
      1,
    );
  const [open] = await tx
    .select({ n: sql<string>`count(*)` })
    .from(integrityFlags)
    .where(eq(integrityFlags.status, 'open'));
  const n = Number(open.n);
  return n
    ? fail(code, title, `${n} integrity flag(s) are open.`, n)
    : pass(code, title, 'Cached balances equal a rebuild from the ledger.', run.flagsRaised);
};

/** The audit hash chain verified in the latest rebuild check (hard). */
const auditChainVerified: PeriodCheck = async (tx) => {
  const code: CloseCheckCode = 'audit_chain_verified';
  const title = 'Audit chain verified';
  const [run] = await tx
    .select()
    .from(integrityCheckRuns)
    .where(eq(integrityCheckRuns.kind, 'ledger_rebuild'))
    .orderBy(desc(integrityCheckRuns.requestedAt))
    .limit(1);
  const chain = (run?.summary as { auditChain?: { valid: boolean; checked: number } } | null)
    ?.auditChain;
  if (!run || !chain) return fail(code, title, 'No check has verified the audit chain yet.', 1);
  return chain.valid
    ? pass(code, title, `${chain.checked} audit entries verified.`, chain.checked)
    : fail(code, title, 'The audit hash chain is broken; investigate before the close.', 1);
};

/** Every import batch touching the period is posted or discarded (soft). */
const actualsImported: PeriodCheck = async (tx) => {
  const code: CloseCheckCode = 'actuals_imported';
  const rows = await tx
    .select({ n: sql<string>`count(*)` })
    .from(importBatches)
    .where(eq(importBatches.status, 'review'));
  const n = Number(rows[0].n);
  return n
    ? warn(
        code,
        'Actuals imported for every source',
        `${n} import batch(es) are still in review.`,
        n,
      )
    : pass(code, 'Actuals imported for every source', 'No import batch is waiting in review.');
};

/** Actuals of the period with no match (soft: they carry to the next open period, flagged late). */
const unmatchedActualsCleared: PeriodCheck = async (tx, ctx) => {
  const code: CloseCheckCode = 'unmatched_actuals_cleared';
  const rows = await tx
    .select({
      n: sql<string>`count(*)`,
      amount: sql<string>`coalesce(sum(${actuals.reportingAmountMinor}), 0)`,
      currency: sql<string | null>`min(${actuals.reportingCurrency})`,
    })
    .from(actuals)
    .where(
      and(
        eq(actuals.legalEntityId, ctx.legalEntityId),
        gte(actuals.accountingDate, ctx.period.startDate),
        lte(actuals.accountingDate, ctx.period.endDate),
        eq(actuals.matchStatus, 'unmatched'),
      ),
    );
  const n = Number(rows[0].n);
  const title = 'Unmatched actuals cleared or carried';
  return n
    ? warn(
        code,
        title,
        `${n} actual(s) worth ${money(Number(rows[0].amount), rows[0].currency)} are unmatched; they post to the next open period flagged late.`,
        n,
        Number(rows[0].amount),
        rows[0].currency,
      )
    : pass(code, title, 'Every actual of the period is matched or excluded.');
};

/** Accrual proposals for the period are approved or rejected (soft). */
const accrualsReviewed: PeriodCheck = async (tx, ctx) => {
  const code: CloseCheckCode = 'accruals_reviewed';
  const rows = await tx
    .select({
      n: sql<string>`count(*)`,
      amount: sql<string>`coalesce(sum(${accruals.amountMinor}), 0)`,
      currency: sql<string | null>`min(${accruals.currency})`,
    })
    .from(accruals)
    .where(and(eq(accruals.accountingPeriodId, ctx.period.id), eq(accruals.status, 'proposed')));
  const n = Number(rows[0].n);
  const title = 'Accrual proposals reviewed';
  return n
    ? warn(
        code,
        title,
        `${n} accrual proposal(s) worth ${money(Number(rows[0].amount), rows[0].currency)} are still waiting for a decision.`,
        n,
        Number(rows[0].amount),
        rows[0].currency,
      )
    : pass(code, title, 'No accrual proposal is waiting for a decision.');
};

/** Prepaids whose service period ends inside this period are recognized through its end (soft). */
const prepaidsRecognized: PeriodCheck = async (tx, ctx) => {
  const code: CloseCheckCode = 'prepaids_recognized';
  const rows = await tx
    .select({
      n: sql<string>`count(*)`,
      amount: sql<string>`coalesce(sum(${prepaids.amountMinor} - ${prepaids.consumedMinor}), 0)`,
      currency: sql<string | null>`min(${prepaids.currency})`,
    })
    .from(prepaids)
    .where(
      and(
        lte(prepaids.serviceStart, ctx.period.endDate),
        or(
          isNull(prepaids.recognizedThrough),
          lte(prepaids.recognizedThrough, ctx.period.startDate),
        ),
        sql`${prepaids.amountMinor} > ${prepaids.consumedMinor}`,
      ),
    );
  const n = Number(rows[0].n);
  const title = 'Prepaids recognized through the period end';
  return n
    ? warn(
        code,
        title,
        `${n} prepaid(s) worth ${money(Number(rows[0].amount), rows[0].currency)} are not recognized through ${ctx.period.endDate}.`,
        n,
        Number(rows[0].amount),
        rows[0].currency,
      )
    : pass(code, title, 'Every prepaid in service is recognized through the period end.');
};

/** Commitments past their service date with no accrual and no actual (soft). */
const commitmentsAccrued: PeriodCheck = async (tx, ctx) => {
  const code: CloseCheckCode = 'commitments_accrued';
  const rows = await tx.execute<{ n: string; amount: string; currency: string | null }>(sql`
    select count(*)::text as n,
           coalesce(sum(c.amount_minor - c.consumed_minor - c.released_minor), 0)::text as amount,
           min(c.currency) as currency
    from commitments c
    where c.legal_entity_id = ${ctx.legalEntityId}
      and c.status in ('encumbered', 'partially_consumed')
      and c.service_end is not null
      and c.service_end <= ${ctx.period.endDate}
      and c.amount_minor > c.consumed_minor + c.released_minor
      and not exists (
        select 1 from accruals a
        where a.commitment_id = c.id and a.status in ('proposed', 'approved', 'posted')
      )`);
  const row = rows.rows[0];
  const n = Number(row?.n ?? 0);
  const title = 'Commitments past their service date accrued';
  return n
    ? warn(
        code,
        title,
        `${n} commitment(s) worth ${money(Number(row.amount), row.currency)} ended in the period without an accrual.`,
        n,
        Number(row.amount),
        row.currency,
      )
    : pass(code, title, 'Every commitment that ended in the period is accrued or invoiced.');
};

/**
 * The standard checklist, in display order: hard checks first. A later phase registers more through
 * `PeriodCloseChecks.register` rather than editing the close command.
 */
export const STANDARD_PERIOD_CHECKS: readonly PeriodCheck[] = [
  glTieOutSignedOff,
  journalsBalanced,
  ledgerCheckClean,
  auditChainVerified,
  actualsImported,
  unmatchedActualsCleared,
  accrualsReviewed,
  prepaidsRecognized,
  commitmentsAccrued,
];

export const isHard = (code: CloseCheckCode) => closeCheckKind(code) === 'hard';
