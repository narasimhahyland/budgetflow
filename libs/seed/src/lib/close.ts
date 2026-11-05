import { BUDGETS, FISCAL_YEARS, seedId, TENANTS } from './ids';
import { P4_BUDGETS } from './budgets';

/**
 * Phase 11 fixtures (id prefix 80): the rollover policies the year-end run needs beyond the two
 * Phase 1 policies, the reason codes finance picks when acknowledging a close check or asking for a
 * break-glass reopen, the policy each demo budget uses, and a draft FY2026 year-end run. All
 * fictional.
 */
export const P11_IDS = {
  policyCarryFull: seedId('80000000', 1),
  policyCarryApproval: seedId('80000000', 2),
  policyLapseCorporate: seedId('80000000', 3),
  yearEndRunFy2026: seedId('80000000', 10),
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

export const CLOSE_YEAR_END_RUN = {
  id: P11_IDS.yearEndRunFy2026,
  tenantId: TENANTS.acme,
  fiscalYearId: FISCAL_YEARS.acmeFy2026,
  targetFiscalYearId: FISCAL_YEARS.acmeFy2027,
  rootBudgetId: BUDGETS.employeeExperience,
  commitmentFreezeDate: '2026-12-15',
};
