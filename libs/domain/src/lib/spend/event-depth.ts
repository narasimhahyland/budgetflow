import { splitByWeights } from '../money/split';
import { err, ok, type Result } from '../result';

/**
 * Generates occurrence dates (ISO YYYY-MM-DD) for a recurring event series (45a), capped at 12
 * months from `firstDate` and at most 12 occurrences.
 */
export function generateSeriesOccurrences(input: {
  frequency: 'monthly' | 'quarterly' | 'yearly' | 'custom';
  firstDate: string;
  endCount?: number | null;
  endDate?: string | null;
  customDates?: readonly string[];
}): Result<string[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.firstDate)) {
    return err('VALIDATION_FAILED', 'Enter a valid first date (YYYY-MM-DD).');
  }
  const start = new Date(`${input.firstDate}T00:00:00Z`);
  const maxHorizon = new Date(start);
  maxHorizon.setUTCFullYear(maxHorizon.getUTCFullYear() + 1);
  const maxDateIso = maxHorizon.toISOString().slice(0, 10);

  if (input.endDate && input.endDate > maxDateIso) {
    return err(
      'VALIDATION_FAILED',
      'Recurring series are created as drafts up to 12 months ahead, no further.',
      { maxDate: maxDateIso },
    );
  }

  if (input.frequency === 'custom') {
    const custom = [...new Set([input.firstDate, ...(input.customDates ?? [])])].sort();
    if (custom.some((d) => d > maxDateIso)) {
      return err(
        'VALIDATION_FAILED',
        'Recurring series are created as drafts up to 12 months ahead, no further.',
        { maxDate: maxDateIso },
      );
    }
    return ok(custom.slice(0, 12));
  }

  const countLimit = Math.min(Math.max(input.endCount ?? 4, 1), 12);
  const stepMonths = input.frequency === 'monthly' ? 1 : input.frequency === 'quarterly' ? 3 : 12;
  const dates: string[] = [];
  for (let i = 0; i < countLimit; i++) {
    const d = new Date(start);
    d.setUTCMonth(d.getUTCMonth() + i * stepMonths);
    const iso = d.toISOString().slice(0, 10);
    if (iso > maxDateIso) break;
    if (input.endDate && iso > input.endDate) break;
    dates.push(iso);
  }
  if (dates.length === 0) {
    return err('VALIDATION_FAILED', 'Add at least one occurrence date.');
  }
  return ok(dates);
}

/**
 * Evaluates an employee RSVP response against capacity and waitlist rules (47a).
 * A 'going' response when `currentGoing >= capacity` becomes 'waitlisted' at `maxWaitlistPosition + 1`
 * when the waitlist is enabled.
 */
export function evaluateRsvpTransition(input: {
  response: 'going' | 'cant_go';
  currentStatus: string;
  currentGoing: number;
  capacity: number | null;
  waitlistEnabled: boolean;
  maxWaitlistPosition: number;
  rsvpClosed: boolean;
}): Result<{ nextStatus: 'going' | 'cant_go' | 'waitlisted'; waitlistPosition: number | null }> {
  if (input.rsvpClosed) {
    return err('RSVP_CLOSED', 'RSVPs for this event are closed.');
  }
  if (input.response === 'cant_go') {
    return ok({ nextStatus: 'cant_go', waitlistPosition: null });
  }
  if (input.currentStatus === 'going') {
    return ok({ nextStatus: 'going', waitlistPosition: null });
  }
  if (input.capacity !== null && input.currentGoing >= input.capacity) {
    if (!input.waitlistEnabled) {
      return err('VALIDATION_FAILED', 'All places for this event are taken.');
    }
    return ok({
      nextStatus: 'waitlisted',
      waitlistPosition: input.maxWaitlistPosition + 1,
    });
  }
  return ok({ nextStatus: 'going', waitlistPosition: null });
}

export interface AttendanceSourceInput {
  sourceId: string;
  budgetId: string;
  budgetName: string;
  locationOrgUnitId: string | null;
  locationName: string;
  contributionRef: string | null;
  approvedMinor: number;
  plannedHeadcount: number;
  actualHeadcount: number;
}

export interface AttendanceRecalculationResult {
  plannedTotalHeadcount: number;
  actualTotalHeadcount: number;
  perHeadPlannedMinor: number;
  perHeadActualMinor: number;
  noShowCostMinor: number;
  limitCheck: {
    limitMinor: number;
    mode: 'hard' | 'soft';
    exceeded: boolean;
    excessMinor: number;
    message: string | null;
  } | null;
  shares: {
    sourceId: string;
    budgetId: string;
    budgetName: string;
    locationName: string;
    contributionRef: string | null;
    approvedMinor: number;
    plannedHeadcount: number;
    plannedAmountMinor: number;
    actualHeadcount: number;
    actualAmountMinor: number;
    deltaMinor: number;
    exceedsApprovedByMinor: number;
  }[];
  exceedingSource: {
    sourceId: string;
    budgetName: string;
    actualAmountMinor: number;
    approvedMinor: number;
    excessMinor: number;
  } | null;
}

/**
 * Recalculates per-head cost, no-show waste, per-head limit check, and each funding source's cost
 * share from actual attendance (or RSVP preview) using largest-remainder splitting (47e).
 * A contributor's share may only grow up to their approved contribution; beyond that `exceedingSource`
 * is returned so `apply` rejects with `SHARE_EXCEEDS_CONTRIBUTION`.
 */
export function recalculateAttendanceSplit(input: {
  capMinor: number;
  costSoFarMinor: number;
  variablePerHeadMinor: number;
  plannedHeadcount: number;
  actualHeadcount: number;
  noShowCount: number;
  perHeadLimitMinor: number | null;
  perHeadLimitMode: 'hard' | 'soft';
  sources: readonly AttendanceSourceInput[];
}): AttendanceRecalculationResult {
  const plannedHeads = Math.max(input.plannedHeadcount, 1);
  const actualHeads = Math.max(input.actualHeadcount, 1);
  const perHeadPlannedMinor = Math.round(input.capMinor / plannedHeads);
  const perHeadActualMinor =
    input.actualHeadcount > 0 ? Math.round(input.costSoFarMinor / actualHeads) : 0;
  const noShowCostMinor = Math.max(0, input.noShowCount) * Math.max(0, input.variablePerHeadMinor);

  let limitCheck: AttendanceRecalculationResult['limitCheck'] = null;
  if (input.perHeadLimitMinor !== null && input.perHeadLimitMinor > 0) {
    const excessMinor = Math.max(0, perHeadActualMinor - input.perHeadLimitMinor);
    const exceeded = excessMinor > 0;
    limitCheck = {
      limitMinor: input.perHeadLimitMinor,
      mode: input.perHeadLimitMode,
      exceeded,
      excessMinor,
      message: exceeded
        ? input.perHeadLimitMode === 'hard'
          ? 'Actual cost per attendee exceeds the hard per-head limit; new commitments are blocked until over-budget approval.'
          : 'Actual cost per attendee is above the per-head limit. Finance will see an exception at reconciliation.'
        : null,
    };
  }

  const n = input.sources.length;
  if (n === 0 || input.costSoFarMinor <= 0) {
    return {
      plannedTotalHeadcount: input.plannedHeadcount,
      actualTotalHeadcount: input.actualHeadcount,
      perHeadPlannedMinor,
      perHeadActualMinor,
      noShowCostMinor,
      limitCheck,
      shares: input.sources.map((s) => ({
        sourceId: s.sourceId,
        budgetId: s.budgetId,
        budgetName: s.budgetName,
        locationName: s.locationName,
        contributionRef: s.contributionRef,
        approvedMinor: s.approvedMinor,
        plannedHeadcount: s.plannedHeadcount,
        plannedAmountMinor: 0,
        actualHeadcount: s.actualHeadcount,
        actualAmountMinor: 0,
        deltaMinor: 0,
        exceedsApprovedByMinor: 0,
      })),
      exceedingSource: null,
    };
  }

  const plannedWeights = input.sources.map((s) => Math.max(s.plannedHeadcount, 0));
  const plannedWeightSum = plannedWeights.reduce((a, b) => a + b, 0);
  const plannedSplit =
    plannedWeightSum > 0
      ? splitByWeights(input.costSoFarMinor, plannedWeights)
      : splitByWeights(
          input.costSoFarMinor,
          input.sources.map((s) => Math.max(s.approvedMinor, 1)),
        );
  const plannedAmounts = plannedSplit.ok ? plannedSplit.value : input.sources.map(() => 0);

  const actualWeights = input.sources.map((s) => Math.max(s.actualHeadcount, 0));
  const actualWeightSum = actualWeights.reduce((a, b) => a + b, 0);
  const actualSplit =
    actualWeightSum > 0
      ? splitByWeights(input.costSoFarMinor, actualWeights)
      : splitByWeights(
          input.costSoFarMinor,
          input.sources.map((s) => Math.max(s.approvedMinor, 1)),
        );
  const actualAmounts = actualSplit.ok ? actualSplit.value : plannedAmounts;

  const shares = input.sources.map((s, i) => {
    const plannedAmountMinor = plannedAmounts[i] ?? 0;
    const actualAmountMinor = actualAmounts[i] ?? 0;
    const deltaMinor = actualAmountMinor - plannedAmountMinor;
    const exceedsApprovedByMinor = Math.max(0, actualAmountMinor - s.approvedMinor);
    return {
      sourceId: s.sourceId,
      budgetId: s.budgetId,
      budgetName: s.budgetName,
      locationName: s.locationName,
      contributionRef: s.contributionRef,
      approvedMinor: s.approvedMinor,
      plannedHeadcount: s.plannedHeadcount,
      plannedAmountMinor,
      actualHeadcount: s.actualHeadcount,
      actualAmountMinor,
      deltaMinor,
      exceedsApprovedByMinor,
    };
  });

  const over = shares.find((s) => s.exceedsApprovedByMinor > 0);
  return {
    plannedTotalHeadcount: input.plannedHeadcount,
    actualTotalHeadcount: input.actualHeadcount,
    perHeadPlannedMinor,
    perHeadActualMinor,
    noShowCostMinor,
    limitCheck,
    shares,
    exceedingSource: over
      ? {
          sourceId: over.sourceId,
          budgetName: over.budgetName,
          actualAmountMinor: over.actualAmountMinor,
          approvedMinor: over.approvedMinor,
          excessMinor: over.exceedsApprovedByMinor,
        }
      : null,
  };
}

/**
 * Validates selecting a vendor quote (51a): vendor must be Approved or Preferred, quote must not be
 * expired, budget amount must fit within the event's available amount, and selecting a quote that is
 * not the lowest requires a written reason.
 */
export function validateQuoteSelection(input: {
  vendorStatus: 'approved' | 'preferred' | 'blocked' | 'unknown';
  quoteStatus: string;
  validUntil: string | null;
  asOfDate: string;
  budgetAmountMinor: number;
  availableMinor: number;
  isLowest: boolean;
  reason?: string | null;
}): Result<true> {
  if (input.vendorStatus === 'blocked') {
    return err(
      'VENDOR_BLOCKED',
      'This vendor is blocked by vendor controls and cannot be selected.',
    );
  }
  if (input.vendorStatus !== 'approved' && input.vendorStatus !== 'preferred') {
    return err(
      'VENDOR_NOT_APPROVED',
      'Only Approved or Preferred vendors in the vendor master can be selected.',
    );
  }
  if (input.quoteStatus === 'expired' || (input.validUntil && input.validUntil < input.asOfDate)) {
    return err(
      'QUOTE_EXPIRED',
      `This quote expired on ${input.validUntil ?? input.asOfDate}. Ask the vendor to confirm the price.`,
    );
  }
  if (input.budgetAmountMinor > input.availableMinor) {
    return err(
      'EXCEEDS_EVENT_AVAILABLE',
      "This quote exceeds the amount available under this event's rules.",
      {
        budgetAmountMinor: input.budgetAmountMinor,
        availableMinor: input.availableMinor,
        excessMinor: input.budgetAmountMinor - input.availableMinor,
      },
    );
  }
  if (!input.isLowest && (!input.reason || input.reason.trim().length < 5)) {
    return err(
      'REASON_REQUIRED',
      'Give a written reason when selecting a quote that is not the lowest.',
    );
  }
  return ok(true);
}

/**
 * Aggregates post-event survey responses (54a): enforces the 5-response minimum privacy threshold
 * before returning ratings or location breakdowns.
 */
export function aggregateSurveyResults(
  responses: readonly {
    rating: number;
    wouldAttendAgain: boolean;
    locationName: string | null;
  }[],
  audienceCount: number,
): {
  responseCount: number;
  responseRatePct: number;
  minimumResponsesMet: boolean;
  averageRating: number | null;
  wouldAttendAgainPct: number | null;
  ratingDistribution: { rating: number; count: number }[];
  byLocation: { locationName: string; responses: number; averageRating: number }[];
} {
  const responseCount = responses.length;
  const denom = Math.max(audienceCount, responseCount, 1);
  const responseRatePct = Math.min(100, Math.round((responseCount * 100) / denom));
  const minimumResponsesMet = responseCount >= 5;
  const dist = [5, 4, 3, 2, 1].map((rating) => ({
    rating,
    count: minimumResponsesMet ? responses.filter((r) => r.rating === rating).length : 0,
  }));
  if (!minimumResponsesMet) {
    return {
      responseCount,
      responseRatePct,
      minimumResponsesMet: false,
      averageRating: null,
      wouldAttendAgainPct: null,
      ratingDistribution: dist,
      byLocation: [],
    };
  }
  const sum = responses.reduce((a, r) => a + r.rating, 0);
  const averageRating = Math.round((sum / responseCount) * 10) / 10;
  const againCount = responses.filter((r) => r.wouldAttendAgain).length;
  const wouldAttendAgainPct = Math.round((againCount * 100) / responseCount);

  const locGroups = new Map<string, number[]>();
  for (const r of responses) {
    const loc = r.locationName ?? 'Other';
    locGroups.set(loc, [...(locGroups.get(loc) ?? []), r.rating]);
  }
  const byLocation = [...locGroups.entries()]
    .filter(([, ratings]) => ratings.length >= 5)
    .map(([locationName, ratings]) => ({
      locationName,
      responses: ratings.length,
      averageRating: Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10,
    }));

  return {
    responseCount,
    responseRatePct,
    minimumResponsesMet: true,
    averageRating,
    wouldAttendAgainPct,
    ratingDistribution: dist,
    byLocation,
  };
}
