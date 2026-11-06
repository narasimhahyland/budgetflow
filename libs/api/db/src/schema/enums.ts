import {
  BOARD_PACK_STATUSES,
  BUDGET_STATUSES,
  BUDGET_TYPES,
  CALENDAR_TYPES,
  CLOSE_CHECK_CODES,
  COMMITMENT_STATUSES,
  CONTRIBUTION_STATUSES,
  CONTROL_MODES,
  EVENT_STATUSES,
  FORECAST_CYCLE_STATUSES,
  FORECAST_METHODS,
  FORECAST_STATUSES,
  INTERCOMPANY_MODES,
  JOURNAL_TYPES,
  LEDGER_ACCOUNTS,
  PERIOD_STATUSES,
  RATE_TYPES,
  RECHARGE_STATUSES,
  REQUEST_KINDS,
  REQUEST_STATUSES,
  ROLE_IDS,
  YEAR_END_LINE_STATUSES,
} from '@bf/domain';
import { pgEnum } from 'drizzle-orm/pg-core';

const tuple = <T extends string>(values: readonly T[]) => values as unknown as [T, ...T[]];

export const roleId = pgEnum('role_id', tuple(ROLE_IDS));
export const budgetStatus = pgEnum('budget_status', tuple(BUDGET_STATUSES));
export const budgetType = pgEnum('budget_type', tuple(BUDGET_TYPES));
export const controlMode = pgEnum('control_mode', tuple(CONTROL_MODES));
export const ledgerAccount = pgEnum('ledger_account', tuple(LEDGER_ACCOUNTS));
export const journalType = pgEnum('journal_type', tuple(JOURNAL_TYPES));
export const periodStatus = pgEnum('period_status', tuple(PERIOD_STATUSES));
export const calendarType = pgEnum('calendar_type', tuple(CALENDAR_TYPES));
export const rateType = pgEnum('rate_type', tuple(RATE_TYPES));
export const commitmentStatus = pgEnum('commitment_status', tuple(COMMITMENT_STATUSES));
export const eventStatus = pgEnum('event_status', tuple(EVENT_STATUSES));
export const requestKind = pgEnum('request_kind', tuple(REQUEST_KINDS));
export const requestStatus = pgEnum('request_status', tuple(REQUEST_STATUSES));
export const contributionStatus = pgEnum('contribution_status', tuple(CONTRIBUTION_STATUSES));
export const contributionMode = pgEnum('contribution_mode', ['earmark', 'transfer']);
export const intercompanyMode = pgEnum('intercompany_mode', tuple(INTERCOMPANY_MODES));
export const rechargeStatus = pgEnum('recharge_status', tuple(RECHARGE_STATUSES));
export const forecastMethod = pgEnum('forecast_method', tuple(FORECAST_METHODS));
export const forecastStatus = pgEnum('forecast_status', tuple(FORECAST_STATUSES));
export const orgUnitKind = pgEnum('org_unit_kind', [
  'company',
  'business_unit',
  'department',
  'team',
  'region',
  'location',
]);
export const employmentType = pgEnum('employment_type', ['employee', 'contractor', 'intern']);
export const reportingLineKind = pgEnum('reporting_line_kind', ['solid', 'matrix']);
export const planVersionKind = pgEnum('plan_version_kind', ['original', 'current', 'forecast']);
export const planVersionStatus = pgEnum('plan_version_status', ['draft', 'approved', 'superseded']);
export const rolloverMode = pgEnum('rollover_mode', [
  'lapse',
  'carry_full',
  'carry_capped',
  'carry_with_approval',
]);
export const sweepTarget = pgEnum('sweep_target', ['parent', 'corporate']);
export const allocationDriver = pgEnum('allocation_driver', ['fixed', 'per_head']);
export const vendorStatus = pgEnum('vendor_status', [
  'approved',
  'preferred',
  'blocked',
  'unknown',
]);
export const approvalStatus = pgEnum('approval_status', [
  'pending',
  'approved',
  'partially_approved',
  'rejected',
  'changes_requested',
  'escalated',
  'cancelled',
]);
export const approvalChannel = pgEnum('approval_channel', [
  'web',
  'email',
  'slack',
  'teams',
  'mobile',
  'api',
]);
export const actualSource = pgEnum('actual_source', [
  'file',
  'card',
  'expense',
  'travel',
  'erp',
  'ap',
  'manual',
]);
export const actualKind = pgEnum('actual_kind', ['charge', 'refund', 'credit_note', 'reversal']);
export const actualMatchStatus = pgEnum('actual_match_status', [
  'unmatched',
  'partially_matched',
  'matched',
  'excluded',
]);
export const accrualStatus = pgEnum('accrual_status', [
  'proposed',
  'approved',
  'posted',
  'reversed',
  'rejected',
]);
export const integrityFlagKind = pgEnum('integrity_flag_kind', [
  'split_request',
  'duplicate',
  'cross_source_duplicate',
  'receipt_reuse',
  'just_under_threshold',
  'ledger_drift',
  'journal_unbalanced',
  'hierarchy_mismatch',
  'plan_tie_mismatch',
  'audit_chain_broken',
  'negative_bucket',
  'over_allocated',
  'triplet_mismatch',
]);
export const integrityFlagStatus = pgEnum('integrity_flag_status', [
  'open',
  'acknowledged',
  'resolved',
]);
export const integrityCheckStatus = pgEnum('integrity_check_status', [
  'queued',
  'running',
  'clean',
  'drift_detected',
  'failed',
]);
export const yearEndRunStatus = pgEnum('year_end_run_status', [
  'draft',
  'dry_run',
  'running',
  'completed',
  'failed',
]);
export const importBatchStatus = pgEnum('import_batch_status', ['review', 'posted', 'discarded']);
export const tieoutStatus = pgEnum('tieout_status', [
  'draft',
  'reconciled',
  'exceptions',
  'signed_off',
]);

// Period close and year end (P11)
export const closeCheckCode = pgEnum('close_check_code', tuple(CLOSE_CHECK_CODES));
export const reopenAction = pgEnum('reopen_action', ['reopen', 'unlock']);
export const reopenRequestStatus = pgEnum('reopen_request_status', [
  'pending',
  'approved',
  'declined',
]);
export const yearEndLineStatus = pgEnum('year_end_line_status', tuple(YEAR_END_LINE_STATUSES));
export const forecastCycleStatus = pgEnum('forecast_cycle_status', tuple(FORECAST_CYCLE_STATUSES));
export const boardPackStatus = pgEnum('board_pack_status', tuple(BOARD_PACK_STATUSES));
