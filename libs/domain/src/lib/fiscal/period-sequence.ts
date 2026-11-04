import { err, ok, type Result } from '../result';
import { periodMachine, type PeriodStatus } from './period';

export type PeriodEvent = 'soft_close' | 'close' | 'lock' | 'reopen' | 'unlock';

export interface SequencedPeriod {
  id: string;
  label: string;
  startDate: string;
  status: PeriodStatus;
}

const CLOSED: readonly PeriodStatus[] = ['closed', 'locked'];

/**
 * Period status changes within one calendar: the state machine plus sequencing. Periods close and
 * lock in date order; a period reopens or unlocks only while no later period is closed or locked.
 * Reopening and unlocking need a reason (audited).
 */
export function changePeriodStatus(
  periods: readonly SequencedPeriod[],
  periodId: string,
  event: PeriodEvent,
  reason?: string | null,
): Result<PeriodStatus> {
  const sorted = [...periods].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const idx = sorted.findIndex((p) => p.id === periodId);
  if (idx < 0) return err('PERIOD_NOT_FOUND', 'The accounting period does not exist.');
  const target = sorted[idx];
  const next = periodMachine.next(target.status, event);
  if (!next.ok) return next;
  if ((event === 'reopen' || event === 'unlock') && !reason?.trim()) {
    return err('REASON_REQUIRED', `Give a reason to ${event} ${target.label}.`, { event });
  }
  const earlier = sorted.slice(0, idx);
  const later = sorted.slice(idx + 1);
  if (event === 'close') {
    const open = earlier.find((p) => !CLOSED.includes(p.status));
    if (open)
      return err('INVALID_TRANSITION', `Close ${open.label} first: periods close in date order.`, {
        blockingPeriod: open.label,
      });
  }
  if (event === 'lock') {
    const unlocked = earlier.find((p) => p.status !== 'locked');
    if (unlocked)
      return err(
        'INVALID_TRANSITION',
        `Lock ${unlocked.label} first: periods lock in date order.`,
        {
          blockingPeriod: unlocked.label,
        },
      );
  }
  if (event === 'reopen') {
    const closedLater = later.find((p) => CLOSED.includes(p.status));
    if (closedLater)
      return err(
        'INVALID_TRANSITION',
        `${closedLater.label} is ${closedLater.status}; reopen later periods first.`,
        { blockingPeriod: closedLater.label },
      );
  }
  if (event === 'unlock') {
    const lockedLater = later.find((p) => p.status === 'locked');
    if (lockedLater)
      return err('INVALID_TRANSITION', `Unlock ${lockedLater.label} first.`, {
        blockingPeriod: lockedLater.label,
      });
  }
  return ok(next.value);
}

/** Events that would pass `changePeriodStatus` now (reason aside), for the UI. */
export function allowedPeriodEvents(
  periods: readonly SequencedPeriod[],
  periodId: string,
): PeriodEvent[] {
  const target = periods.find((p) => p.id === periodId);
  if (!target) return [];
  return (periodMachine.allowedEvents(target.status) as PeriodEvent[]).filter(
    (e) => changePeriodStatus(periods, periodId, e, 'check').ok,
  );
}
