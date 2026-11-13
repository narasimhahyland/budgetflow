import { BUDGETS, FISCAL_YEARS, seedId, TENANTS } from './ids';
import { P4_BUDGETS } from './budgets';

/**
 * Gap B4 fixtures: the "Year-end reclaim" reduction reason code and one reclaim campaign (086a)
 * started on 6 Nov with responses due 13 Nov, so the pinned clock (16 Nov) shows every response
 * state: a part release, a full release, a kept budget with its reason and plan, and a notice past
 * its deadline that finance can send to the parent owner. Proposed amounts are computed from the
 * ledger at seed time with the same rule the API uses; nothing here posts money.
 */
export const RECLAIM_IDS = {
  reasonCode: seedId('87000000', 1),
  campaign: seedId('87000000', 10),
  noticeBengaluru: seedId('87000000', 11),
  noticeHyderabad: seedId('87000000', 12),
  noticeNewYork: seedId('87000000', 13),
  noticeBerlin: seedId('87000000', 14),
} as const;

export const RECLAIM_REASON_CODE = {
  id: RECLAIM_IDS.reasonCode,
  tenantId: TENANTS.acme,
  category: 'reduction',
  code: 'RED-YEAR-END-RECLAIM',
  label: 'Year-end reclaim',
} as const;

export const RECLAIM_CAMPAIGN = {
  id: RECLAIM_IDS.campaign,
  name: 'Q4 FY2026 reclaim',
  fiscalYearId: FISCAL_YEARS.acmeFy2026,
  startedOn: '2026-11-06',
  respondBy: '2026-11-13',
  criteria: { minUnusedBps: 2_000, minUnusedReportingMinor: 100_000, maxDaysLeft: 90 },
} as const;

/** One notice per seeded budget, with the owner's answer (null: no answer yet). */
export const RECLAIM_NOTICES = [
  {
    id: RECLAIM_IDS.noticeBengaluru,
    budgetId: BUDGETS.bengaluru,
    answer: {
      choice: 'release_part',
      releasedMinor: 200_000,
      reason: 'the Wellbeing week (1-5 Dec, quote selected)',
      plan: null,
      respondedAt: '2026-11-10T09:30:00Z',
    },
  },
  {
    id: RECLAIM_IDS.noticeHyderabad,
    budgetId: BUDGETS.hyderabad,
    answer: {
      choice: 'release_all',
      releasedMinor: null,
      reason: null,
      plan: null,
      respondedAt: '2026-11-11T11:00:00Z',
    },
  },
  { id: RECLAIM_IDS.noticeNewYork, budgetId: P4_BUDGETS.newYork, answer: null },
  {
    id: RECLAIM_IDS.noticeBerlin,
    budgetId: P4_BUDGETS.berlin,
    answer: {
      choice: 'keep',
      releasedMinor: 0,
      reason: 'Committed winter party',
      plan: 'Berlin winter party on 12 Dec; venue quote selected',
      respondedAt: '2026-11-12T14:15:00Z',
    },
  },
] as const;
