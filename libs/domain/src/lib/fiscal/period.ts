import { err, ok, type Result } from '../result';
import { defineMachine } from '../state-machine';

export const PERIOD_STATUSES = ['open', 'soft_closed', 'closed', 'locked'] as const;
export type PeriodStatus = (typeof PERIOD_STATUSES)[number];

/** Accounting period lifecycle. Reopening is privileged, reasoned and audited (enforced by the caller's policy). */
export const periodMachine = defineMachine<
  PeriodStatus,
  'soft_close' | 'close' | 'lock' | 'reopen' | 'unlock'
>({
  name: 'accounting period',
  transitions: [
    { from: 'open', event: 'soft_close', to: 'soft_closed' },
    { from: 'open', event: 'close', to: 'closed' },
    { from: 'soft_closed', event: 'close', to: 'closed' },
    { from: 'soft_closed', event: 'reopen', to: 'open' },
    { from: 'closed', event: 'reopen', to: 'open' },
    { from: 'closed', event: 'lock', to: 'locked' },
    { from: 'locked', event: 'unlock', to: 'closed' },
  ],
});

export interface PeriodRef {
  id: string;
  startDate: string;
  endDate: string;
  status: PeriodStatus;
}

export interface PostingPeriod {
  period: PeriodRef;
  late: boolean;
  originalPeriodId: string | null;
}

/** Whether a posting may land in a period. Soft-closed periods accept finance adjustments only. */
export function acceptsPostings(status: PeriodStatus, allowSoftClosed = false): boolean {
  return status === 'open' || (allowSoftClosed && status === 'soft_closed');
}

/**
 * Resolves where a posting with this accounting date lands. Nothing posts to a Closed or Locked
 * period: late items go to the next open period, flagged, with the original period referenced.
 */
export function resolvePostingPeriod(
  periods: readonly PeriodRef[],
  accountingDate: string,
  options: { allowSoftClosed?: boolean } = {},
): Result<PostingPeriod> {
  const sorted = [...periods].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const idx = sorted.findIndex((p) => p.startDate <= accountingDate && accountingDate <= p.endDate);
  if (idx < 0) {
    return err('PERIOD_NOT_FOUND', `No accounting period covers ${accountingDate}.`, {
      accountingDate,
    });
  }
  const own = sorted[idx];
  if (acceptsPostings(own.status, options.allowSoftClosed))
    return ok({ period: own, late: false, originalPeriodId: null });
  const next = sorted.slice(idx + 1).find((p) => p.status === 'open');
  if (!next) {
    return err(
      'NO_OPEN_PERIOD',
      `Period ${own.startDate} to ${own.endDate} is ${own.status} and no later period is open.`,
      {
        accountingDate,
        status: own.status,
      },
    );
  }
  return ok({ period: next, late: true, originalPeriodId: own.id });
}
