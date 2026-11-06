import { BUDGETS, FISCAL_YEARS, seedId, TENANTS } from './ids';
import { P4_BUDGETS } from './budgets';

/**
 * Phase 11 fixtures (id prefix 80): the rollover policies the year-end run needs beyond the two
 * Phase 1 policies, the reason codes finance picks when acknowledging a close check or asking for a
 * break-glass reopen, the policy each demo budget uses, a draft FY2026 year-end run, and two
 * forecast cycles so the forecast report and the board pack have content. All fictional.
 */
export const P11_IDS = {
  policyCarryFull: seedId('80000000', 1),
  policyCarryApproval: seedId('80000000', 2),
  policyLapseCorporate: seedId('80000000', 3),
  yearEndRunFy2026: seedId('80000000', 10),
  forecastCycleSeptember: seedId('80000000', 40),
  forecastCycleOctober: seedId('80000000', 41),
} as const;

export const CLOSE_ROLLOVER_POLICIES = [
  {
    id: P11_IDS.policyCarryFull,
    tenantId: TENANTS.acme,
    code: 'CARRY-FULL',
    name: 'Carry everything left',
    mode: 'carry_full' as const,
    capBps: null,
    sweepTo: 'parent' as const,
  },
  {
    id: P11_IDS.policyCarryApproval,
    tenantId: TENANTS.acme,
    code: 'CARRY-APPROVAL',
    name: 'Carry with Finance Controller approval',
    mode: 'carry_with_approval' as const,
    capBps: null,
    sweepTo: 'parent' as const,
  },
  {
    id: P11_IDS.policyLapseCorporate,
    tenantId: TENANTS.acme,
    code: 'LAPSE-CORP',
    name: 'Lapse and sweep to corporate',
    mode: 'lapse' as const,
    capBps: null,
    sweepTo: 'corporate' as const,
  },
];

/** Reason codes for the close checklist and break-glass reopen (category `period_close`). */
export const CLOSE_REASON_CODES = [
  {
    id: seedId('80000000', 20),
    code: 'LATE-RECEIPTS',
    label: 'Receipts arrive after the close; the lines post to the next open period',
  },
  {
    id: seedId('80000000', 21),
    code: 'IMMATERIAL',
    label: 'Difference below the materiality threshold',
  },
  {
    id: seedId('80000000', 22),
    code: 'CARRIED-TO-NEXT',
    label: 'Carried to the next period with the finance team',
  },
  {
    id: seedId('80000000', 23),
    code: 'AUDIT-ADJUSTMENT',
    label: 'Auditor asked for an adjustment in the original period',
  },
  {
    id: seedId('80000000', 24),
    code: 'ERP-RESTATEMENT',
    label: 'The source system restated the period',
  },
];

/**
 * Rollover policy per demo budget, so a FY2026 dry run shows every outcome at once: a lapse that
 * sweeps to the parent, a capped carry, a full carry, a carry that needs approval and a lapse that
 * sweeps to corporate. Policy codes resolve at seed time.
 */
export const CLOSE_BUDGET_POLICIES: { budgetId: string; policyCode: string }[] = [
  { budgetId: BUDGETS.bengaluru, policyCode: 'CARRY-25' },
  { budgetId: BUDGETS.hyderabad, policyCode: 'CARRY-FULL' },
  { budgetId: BUDGETS.india, policyCode: 'LAPSE' },
  { budgetId: BUDGETS.unitedStates, policyCode: 'LAPSE' },
  { budgetId: BUDGETS.europe, policyCode: 'LAPSE' },
  { budgetId: BUDGETS.employeeExperience, policyCode: 'LAPSE-CORP' },
  { budgetId: P4_BUDGETS.newYork, policyCode: 'CARRY-APPROVAL' },
  { budgetId: P4_BUDGETS.berlin, policyCode: 'CARRY-25' },
  { budgetId: P4_BUDGETS.usRecognition, policyCode: 'LAPSE' },
  { budgetId: P4_BUDGETS.europeWellbeing, policyCode: 'LAPSE' },
];

/**
 * Two forecast cycles (87a), so 087 and the board pack have something real to report on: a closed
 * September reforecast whose snapshot is locked, and an open October reforecast part-way through.
 * Every forecast is a statement about the year end; none of them posts anything.
 */
export const FORECAST_CYCLES = {
  september: {
    id: P11_IDS.forecastCycleSeptember,
    tenantId: TENANTS.acme,
    name: 'September reforecast',
    asOfDate: '2026-09-30',
    dueDate: '2026-10-12',
    fiscalYearId: FISCAL_YEARS.acmeFy2026,
    status: 'closed' as const,
    closedAt: '2026-10-13T09:00:00.000Z',
  },
  october: {
    id: P11_IDS.forecastCycleOctober,
    tenantId: TENANTS.acme,
    name: 'October reforecast',
    asOfDate: '2026-10-31',
    dueDate: '2026-11-12',
    fiscalYearId: FISCAL_YEARS.acmeFy2026,
    status: 'open' as const,
    closedAt: null,
  },
} as const;

/**
 * What each budget forecasts, as a share of its net authorized amount in basis points, and the
 * owner's commentary. The shares are chosen so the cycle shows every state at once: variances
 * comfortably inside the threshold, one large under-spend that needs commentary and has it, and one
 * over-spend. Amounts are computed from the ledger at seed time, so they always agree with it.
 */
export const FORECAST_SHARES: {
  budgetId: string;
  cycle: 'september' | 'october';
  forecastBps: number;
  method: 'run_rate' | 'committed_pipeline' | 'owner_input';
  status: 'draft' | 'submitted' | 'commentary_required' | 'accepted';
  commentary: string | null;
  commentaryNote?: string;
}[] = [
  {
    budgetId: BUDGETS.india,
    cycle: 'september',
    forecastBps: 9_130,
    method: 'run_rate',
    status: 'accepted',
    commentary: null,
  },
  {
    budgetId: BUDGETS.unitedStates,
    cycle: 'september',
    forecastBps: 10_450,
    method: 'owner_input',
    status: 'accepted',
    commentary:
      'Two extra hiring events in Q4 that were not in the plan; the regional team has approved the overspend.',
  },
  {
    budgetId: BUDGETS.europe,
    cycle: 'september',
    forecastBps: 8_300,
    method: 'committed_pipeline',
    status: 'accepted',
    commentary:
      'Wellbeing paused after the set-to-zero in October; the Q4 London events moved to January.',
  },
  {
    budgetId: P4_BUDGETS.newYork,
    cycle: 'september',
    forecastBps: 9_600,
    method: 'run_rate',
    status: 'accepted',
    commentary: null,
  },
  {
    budgetId: BUDGETS.bengaluru,
    cycle: 'october',
    forecastBps: 9_400,
    method: 'committed_pipeline',
    status: 'submitted',
    commentary: null,
  },
  {
    budgetId: BUDGETS.hyderabad,
    cycle: 'october',
    forecastBps: 9_800,
    method: 'run_rate',
    status: 'draft',
    commentary: null,
  },
  {
    budgetId: P4_BUDGETS.europeWellbeing,
    cycle: 'october',
    forecastBps: 6_500,
    method: 'owner_input',
    status: 'commentary_required',
    commentary: null,
    commentaryNote:
      'Say which wellbeing activities are stopping and whether the money comes back to the region.',
  },
];

export const CLOSE_YEAR_END_RUN = {
  id: P11_IDS.yearEndRunFy2026,
  tenantId: TENANTS.acme,
  fiscalYearId: FISCAL_YEARS.acmeFy2026,
  targetFiscalYearId: FISCAL_YEARS.acmeFy2027,
  rootBudgetId: BUDGETS.employeeExperience,
  commitmentFreezeDate: '2026-12-15',
};
