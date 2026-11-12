import type { BudgetStatus } from '../budgets/budget-status';
import type { HealthOutcome } from './health';

/**
 * Budget alerts (screen 017): what the health checks, the owner thresholds (50/80/100%), the
 * controls and the approval SLA say about one budget, as alerts with a severity and the one action
 * that resolves each. Pure: alerts are derived on every read, so an alert resolves itself the moment
 * its condition clears. The key carries the band, so a worsening condition is a new alert and is
 * raised again even after the old one was acknowledged.
 */
export type AlertKind =
  | 'threshold'
  | 'hard_block'
  | 'pace'
  | 'forecast'
  | 'lapse'
  | 'frozen'
  | 'set_to_zero'
  | 'approvals_overdue'
  | 'stale_commitments';
export type AlertSeverity = 'hard_block' | 'warning' | 'information';
export type AlertTone = 'error' | 'warning' | 'info' | 'important';

export const ALERT_THRESHOLDS_BPS = [5_000, 8_000, 10_000] as const;

export interface AlertInput {
  budgetId: string;
  name: string;
  status: BudgetStatus;
  controlMode: 'hard' | 'soft' | 'track';
  /** Reporting currency, subtree roll-ups as health uses them. */
  authorizedMinor: number;
  committedMinor: number;
  actualMinor: number;
  monthsLeft: number;
  fiscalYearEnd: string | null;
  /** Approval tasks on this budget's requests that are past their SLA. */
  overdueApprovals: number;
  health: Pick<
    HealthOutcome,
    'reasons' | 'pacedToDateBps' | 'forecastMinor' | 'forecastUnusedMinor'
  >;
}

export interface DerivedAlert {
  key: string;
  kind: AlertKind;
  severity: AlertSeverity;
  tone: AlertTone;
  text: string;
  rule: string;
  action: { label: string; link: string };
  snoozable: boolean;
}

const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
const usedBps = (i: AlertInput) =>
  i.authorizedMinor > 0
    ? Math.floor(((i.committedMinor + i.actualMinor) * 10_000) / i.authorizedMinor)
    : 0;

export const SEVERITY_RANK: Record<AlertSeverity, number> = {
  hard_block: 0,
  warning: 1,
  information: 2,
};

export function deriveBudgetAlerts(
  i: AlertInput,
  money: (minor: number) => string,
): DerivedAlert[] {
  const out: DerivedAlert[] = [];
  const open = { label: 'Open budget', link: `/budgets/${i.budgetId}` };
  const add = (a: Omit<DerivedAlert, 'snoozable'>) =>
    out.push({ ...a, snoozable: a.severity !== 'hard_block' });

  const used = usedBps(i);
  const band = [...ALERT_THRESHOLDS_BPS].reverse().find((t) => used >= t);
  if (band !== undefined && i.authorizedMinor > 0) {
    const spent = `${money(i.committedMinor + i.actualMinor)} of ${money(i.authorizedMinor)} committed or spent`;
    if (band === 10_000 && i.controlMode === 'hard')
      add({
        key: `hard_block:${i.budgetId}:10000`,
        kind: 'hard_block',
        severity: 'hard_block',
        tone: 'error',
        text: `${i.name} reached ${pct(used)} (hard mode). New requests are blocked.`,
        rule: 'Owner threshold 100%, hard control mode',
        action: { label: 'Request an increase', link: `/budgets/${i.budgetId}` },
      });
    else
      add({
        key: `threshold:${i.budgetId}:${band}`,
        kind: 'threshold',
        severity: band >= 8_000 ? 'warning' : 'information',
        tone: band >= 8_000 ? 'warning' : 'info',
        text: `${i.name} passed ${pct(band)}: ${spent}.`,
        rule: `Owner threshold ${pct(band)}`,
        action: open,
      });
  }

  for (const r of i.health.reasons) {
    if (r.check === 'pace')
      add({
        key: `pace:${i.budgetId}:${r.level}`,
        kind: 'pace',
        severity: 'warning',
        tone: 'warning',
        text: `${i.name} is ${pct(i.health.pacedToDateBps)} of its phased plan with ${i.monthsLeft} month${i.monthsLeft === 1 ? '' : 's'} left.`,
        rule: `Health check: pace (${r.level === 'at_risk' ? 'at risk' : 'watch'})`,
        action: { label: 'Review phasing', link: `/budgets/${i.budgetId}` },
      });
    else if (r.check === 'forecast')
      add({
        key: `forecast:${i.budgetId}:${r.level}`,
        kind: 'forecast',
        severity: 'warning',
        tone: 'warning',
        text: `${i.name} forecast is ${money(Math.max(i.health.forecastMinor - i.authorizedMinor, 0))} over authorized.`,
        rule: `Health check: forecast (${r.level === 'at_risk' ? 'at risk' : 'watch'})`,
        action: { label: 'Open forecast', link: '/reports/forecast-variance' },
      });
    else if (r.check === 'unused')
      add({
        key: `lapse:${i.budgetId}`,
        kind: 'lapse',
        severity: 'warning',
        tone: 'warning',
        text: `${i.name}: ${money(i.health.forecastUnusedMinor)} is forecast to lapse${i.fiscalYearEnd ? ` on ${day(i.fiscalYearEnd)}` : ''}.`,
        rule: 'Health check: unused',
        action: { label: 'Plan spend or release', link: '/reports/unused-expired' },
      });
    else if (r.check === 'hygiene')
      add({
        key: `stale_commitments:${i.budgetId}:${r.level}`,
        kind: 'stale_commitments',
        severity: 'warning',
        tone: 'warning',
        text: `${i.name}: ${r.text}.`,
        rule: 'Health check: hygiene',
        action: { label: 'Release a commitment', link: '/finance/actuals/commitments' },
      });
  }

  if (i.status === 'frozen')
    add({
      key: `frozen:${i.budgetId}`,
      kind: 'frozen',
      severity: 'information',
      tone: 'info',
      text: `${i.name} is frozen. Existing commitments continue.`,
      rule: 'Budget control: freeze',
      action: open,
    });
  if (i.status === 'set_to_zero')
    add({
      key: `set_to_zero:${i.budgetId}`,
      kind: 'set_to_zero',
      severity: 'information',
      tone: 'important',
      text: `${i.name} was set to zero. New requests are refused; existing commitments complete.`,
      rule: 'Budget control: set to zero',
      action: open,
    });
  if (i.overdueApprovals > 0)
    add({
      key: `approvals_overdue:${i.budgetId}:${i.overdueApprovals}`,
      kind: 'approvals_overdue',
      severity: 'warning',
      tone: 'warning',
      text: `${i.overdueApprovals} approval${i.overdueApprovals === 1 ? '' : 's'} for ${i.name} ${i.overdueApprovals === 1 ? 'is' : 'are'} past the SLA.`,
      rule: 'Approval SLA',
      action: { label: 'Open pending approvals', link: '/approvals' },
    });
  return out;
}
