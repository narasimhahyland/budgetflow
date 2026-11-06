import { formatNumber } from '@angular/common';
import type {
  CloseCheck,
  ClosePeriodSummary,
  RolloverPolicy,
  YearEndLineStatus,
  YearEndRun,
} from '@bf/contracts';
import type { SatTagStatus } from '@hylandsoftware/satori-ui/tag';

export interface Tag {
  tone: SatTagStatus;
  text: string;
}

/**
 * Period statuses. Locked and Closed are neutral with a lock in the text: the info tone stays
 * reserved for frozen budgets, as screen 108 established.
 */
export const PERIOD_STATUS: Record<ClosePeriodSummary['status'], Tag> = {
  open: { tone: 'success', text: 'Open' },
  soft_closed: { tone: 'warning', text: 'Soft-closed' },
  closed: { tone: 'neutral', text: 'Closed' },
  locked: { tone: 'neutral-quiet', text: 'Locked' },
};

/** A failing hard check is an error; a soft check that is not passing is a warning until accepted. */
export function checkTag(check: CloseCheck): Tag {
  if (check.status === 'pass') return { tone: 'success', text: 'Passed' };
  if (check.kind === 'hard') return { tone: 'important', text: 'Failed' };
  if (check.acknowledgement) return { tone: 'neutral', text: 'Accepted with a reason' };
  return { tone: 'warning', text: check.status === 'fail' ? 'Not done' : 'Needs attention' };
}

export const ROLLOVER_MODE: Record<RolloverPolicy['mode'], string> = {
  lapse: 'Lapse',
  carry_full: 'Carry everything',
  carry_capped: 'Carry up to a cap',
  carry_with_approval: 'Carry with approval',
};

export const SWEEP_TARGET: Record<RolloverPolicy['sweepTo'], string> = {
  parent: 'Parent budget',
  corporate: 'Corporate pool',
};

export const YEAR_END_LINE_STATUS: Record<YearEndLineStatus, Tag> = {
  planned: { tone: 'neutral', text: 'Planned' },
  awaiting_approval: { tone: 'warning', text: 'Waiting for approval' },
  approved: { tone: 'success', text: 'Approved' },
  declined: { tone: 'neutral-quiet', text: 'Declined' },
  blocked: { tone: 'important', text: 'Blocked' },
  executed: { tone: 'success', text: 'Executed' },
};

export const RUN_STATUS: Record<YearEndRun['status'], Tag> = {
  draft: { tone: 'neutral', text: 'Draft' },
  dry_run: { tone: 'info', text: 'Dry run' },
  running: { tone: 'warning', text: 'Running' },
  completed: { tone: 'success', text: 'Completed' },
  failed: { tone: 'important', text: 'Failed' },
};

/** Basis points as a percentage: 1,000 bps reads "10%". */
export const percentOfBps = (bps: number): string =>
  `${formatNumber(bps / 100, 'en-US', '1.0-2')}%`;

/**
 * Compares two strings for a stable order. Every list on these screens sorts through `ordered`
 * below so rows that tie on the sort value still come out in the same order on every render.
 */
const text = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Sorts a copy of `items` by the keys the caller names, always finishing on the row's own id, so a
 * tie never leaves the order to the server or the query plan.
 */
export function ordered<T extends { id: string }>(
  items: readonly T[],
  ...keys: ((item: T) => string | number)[]
): T[] {
  return [...items].sort((a, b) => {
    for (const key of keys) {
      const left = key(a);
      const right = key(b);
      if (typeof left === 'number' && typeof right === 'number') {
        if (left !== right) return left - right;
      } else if (text(String(left), String(right)) !== 0) {
        return text(String(left), String(right));
      }
    }
    return text(a.id, b.id);
  });
}
