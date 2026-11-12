import { ApiProblem, todayUtc, unwrap, type RequestActor } from '@bf/api/core';
import { commitmentTaxLines, requests, type Tx } from '@bf/api/db';
import { BenefitsService, TaxService, type TaxSplitResult } from '@bf/api/finance';
import type { TaxBreakdown } from '@bf/contracts';
import {
  attendeeTypeOf,
  consumptionForNet,
  divRoundHalfEven,
  scaleSplit,
  splitByWeights,
  type Attendance,
  type TaxSplit,
} from '@bf/domain';
import { Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';

type RequestRow = typeof requests.$inferSelect;

/**
 * Tax on spending requests (gap B3, 080g). A request's amount is net of tax; on submission the tax
 * splits into recoverable and non-recoverable parts by the rule in force that day, and only the net
 * plus the non-recoverable tax is pre-encumbered. The split is written once as commitment tax lines
 * (append-only) and every later step (approval, partial approval, counter-offer) reads it back
 * instead of re-evaluating rules, so a later rule version never changes what was committed.
 *
 * Also writes the benefit entries of an approved request that names benefit recipients (080h).
 */
@Injectable()
export class RequestTaxService {
  constructor(
    private readonly tax: TaxService,
    private readonly benefits: BenefitsService,
  ) {}

  attendanceOf(r: RequestRow): Attendance | null {
    const employees = r.benefitRecipientIds?.length ?? 0;
    const others = r.nonEmployeeCount ?? 0;
    return employees + others > 0 ? { employees, others } : null;
  }

  /** Validates the tax part of a new request. */
  assertTaxInput(body: {
    kind: string;
    amount: { currency: string };
    tax?: { amount: { amountMinor: number; currency: string } };
  }): void {
    if (!body.tax) return;
    if (body.kind === 'additional_fund' || body.kind === 'budget')
      throw new ApiProblem(
        422,
        'VALIDATION_FAILED',
        'Tax is recorded on spending, not on event funding; add it to the event’s commitments.',
        { field: 'tax' },
      );
    if (body.tax.amount.currency !== body.amount.currency)
      throw new ApiProblem(422, 'CURRENCY_MISMATCH', 'Give the tax in the request currency.', {
        field: 'tax.amount.currency',
      });
    if (body.tax.amount.amountMinor < 0)
      throw new ApiProblem(422, 'VALIDATION_FAILED', 'Tax cannot be negative.', {
        field: 'tax.amount.amountMinor',
      });
  }

  /**
   * The tax after a resubmission: the new tax when given; otherwise a changed net scales the old tax
   * with it (half-even), so the tax is never split on a stale amount.
   */
  taxOnResubmit(
    r: RequestRow,
    body: { amount?: { amountMinor: number }; tax?: { amount: { amountMinor: number } } },
  ): number | null {
    if (body.tax) return body.tax.amount.amountMinor || null;
    if (!r.taxAmountMinor || !body.amount || body.amount.amountMinor === r.amountMinor)
      return r.taxAmountMinor;
    if (r.amountMinor === 0) return null;
    return (
      Number(
        divRoundHalfEven(
          BigInt(r.taxAmountMinor) * BigInt(body.amount.amountMinor),
          BigInt(r.amountMinor),
        ),
      ) || null
    );
  }

  /** The split a submission takes from the rules in force today; null for an untaxed request. */
  async splitOnSubmit(
    tx: Tx,
    r: RequestRow,
    legalEntityId: string,
    date = todayUtc(),
  ): Promise<TaxSplitResult | null> {
    if (!r.taxAmountMinor) return null;
    return this.tax.splitNet(tx, {
      legalEntityId,
      categoryCode: r.spendType,
      attendance: this.attendanceOf(r),
      netMinor: r.amountMinor,
      taxMinor: r.taxAmountMinor,
      date,
    });
  }

  /** The split a route preview prices (no side effects), from the rules in force today. */
  splitPreview(
    tx: Tx,
    q: {
      legalEntityId: string;
      categoryCode: string;
      netMinor: number;
      taxMinor: number;
      employees: number;
      others: number;
    },
  ): Promise<TaxSplitResult> {
    return this.tax.splitNet(tx, {
      legalEntityId: q.legalEntityId,
      categoryCode: q.categoryCode,
      attendance: { employees: q.employees, others: q.others },
      netMinor: q.netMinor,
      taxMinor: q.taxMinor,
      date: todayUtc(),
    });
  }

  /** Records the split on the commitment: one recoverable and one non-recoverable line. */
  async record(
    tx: Tx,
    tenantId: string,
    commitmentId: string,
    s: TaxSplitResult,
    currency: string,
  ): Promise<void> {
    const base = {
      tenantId,
      commitmentId,
      taxCode: s.split.taxCode,
      rateBps: s.split.rateBps,
      ruleId: s.split.ruleId,
      shareBps: s.split.shareBps,
      currency,
      netMinor: s.split.netMinor,
      withholding: false,
    };
    await tx.insert(commitmentTaxLines).values([
      { ...base, amountMinor: s.split.recoverableMinor, recoverable: true },
      { ...base, amountMinor: s.split.nonRecoverableMinor, recoverable: false },
    ]);
  }

  /** The split recorded on a commitment, rebuilt from its tax lines; null when it has none. */
  async recorded(
    tx: Tx,
    r: RequestRow,
    commitmentId: string | null,
  ): Promise<TaxSplitResult | null> {
    if (!commitmentId || !r.taxAmountMinor) return null;
    const lines = await tx
      .select()
      .from(commitmentTaxLines)
      .where(eq(commitmentTaxLines.commitmentId, commitmentId))
      .orderBy(asc(commitmentTaxLines.id));
    if (!lines.length) return null;
    const recoverable = lines.filter((l) => l.recoverable).reduce((a, l) => a + l.amountMinor, 0);
    const nonRecoverable = lines
      .filter((l) => !l.recoverable)
      .reduce((a, l) => a + l.amountMinor, 0);
    // The net the split was made on: the request's net, or a counter-offer's scaled net.
    const netMinor = lines[0].netMinor ?? r.amountMinor;
    const split: TaxSplit = {
      taxCode: lines[0].taxCode,
      ruleId: lines[0].ruleId,
      shareBps: lines[0].shareBps ?? 0,
      netMinor,
      taxMinor: recoverable + nonRecoverable,
      recoverableMinor: recoverable,
      nonRecoverableMinor: nonRecoverable,
      consumptionMinor: netMinor + nonRecoverable,
      rateBps: lines[0].rateBps,
    };
    return { split, attendeeType: attendeeTypeOf(this.attendanceOf(r)), ruleVersion: null };
  }

  /**
   * What the budget uses for a net amount the approver decided (all, part, or a counter-offer): the
   * recorded consumption for the whole request, otherwise the net part plus the same share of the
   * non-recoverable tax. Untaxed requests use the amount as it is.
   */
  async consumptionFor(tx: Tx, r: RequestRow, netPartMinor: number): Promise<number> {
    const s = await this.recorded(tx, r, r.commitmentId);
    return s ? consumptionForNet(s.split, netPartMinor) : netPartMinor;
  }

  /** The recorded split scaled to a net part (a counter-offer raised on a new commitment). */
  async scaled(tx: Tx, r: RequestRow, netPartMinor: number): Promise<TaxSplitResult | null> {
    const s = await this.recorded(tx, r, r.commitmentId);
    return s ? { ...s, split: scaleSplit(s.split, netPartMinor) } : null;
  }

  /** The breakdown the request detail shows: recorded once submitted, a preview before. */
  async detail(
    tx: Tx,
    actor: RequestActor,
    r: RequestRow,
    legalEntityId: string,
  ): Promise<TaxBreakdown | null> {
    if (!r.taxAmountMinor) return null;
    const recorded = await this.recorded(tx, r, r.commitmentId);
    const date = r.submittedAt ? r.submittedAt.toISOString().slice(0, 10) : todayUtc();
    if (recorded) {
      // A partial approval commits part of the net: show the share of the tax that goes with it.
      const part =
        r.approvedMinor !== null && r.approvedMinor < recorded.split.netMinor
          ? { ...recorded, split: scaleSplit(recorded.split, r.approvedMinor) }
          : recorded;
      const b = await this.tax.breakdown(tx, actor, part, r.currency, date, true);
      return { ...b, attendeeType: attendeeTypeOf(this.attendanceOf(r)) };
    }
    const preview = await this.splitOnSubmit(tx, r, legalEntityId, date);
    return preview ? this.tax.breakdown(tx, actor, preview, r.currency, date, false) : null;
  }

  /**
   * An approved request that names benefit recipients gives each employee an even share of what the
   * budget uses (non-employees take their shares too but have no entry). Returns the entry ids for
   * the approval's audit event.
   */
  async recordBenefits(
    tx: Tx,
    actor: RequestActor,
    r: RequestRow,
    consumedMinor: number,
  ): Promise<string[]> {
    const recipients = r.benefitRecipientIds ?? [];
    if (!recipients.length || consumedMinor <= 0) return [];
    const parts = unwrap(
      splitByWeights(
        consumedMinor,
        Array.from({ length: recipients.length + (r.nonEmployeeCount ?? 0) }, () => 1),
      ),
    );
    const ids: string[] = [];
    for (const [i, personId] of recipients.entries()) {
      if (parts[i] <= 0) continue;
      const row = await this.benefits.record(
        tx,
        actor,
        {
          personId,
          legalEntityId: null,
          entryDate: todayUtc(),
          benefitType: r.spendType,
          amount: { amountMinor: parts[i], currency: r.currency },
          sourceType: 'request',
          sourceId: r.id,
          description: r.title,
        },
        { audit: false, lenient: true },
      );
      if (row) ids.push(row.id);
    }
    return ids;
  }

  reverseBenefits(tx: Tx, actor: RequestActor, requestId: string, reason: string) {
    return this.benefits.reverseSource(tx, actor, 'request', requestId, reason);
  }
}
