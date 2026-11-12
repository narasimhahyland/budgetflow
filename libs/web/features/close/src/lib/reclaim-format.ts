import type { ReclaimCampaign, ReclaimNotice } from '@bf/contracts';
import { formatMoney } from '@bf/web/ui';
import type { Tag } from './close-format';

/** Campaign statuses (086a). */
export const CAMPAIGN_STATUS: Record<ReclaimCampaign['status'], Tag> = {
  collecting: { tone: 'warning', text: 'Collecting responses', icon: 'clock' },
  redistributing: { tone: 'neutral', text: 'Redistributing', icon: 'sync' },
  completed: { tone: 'success', text: 'Completed', icon: 'check_double' },
};

/**
 * A notice's response as a tag. Waiting is a warning (someone still has to act), kept is quiet
 * (nothing moves), released and reclaimed are success, and a notice with the parent owner is a
 * warning with its own icon so it reads differently from an ordinary wait.
 */
export function noticeTag(n: ReclaimNotice): Tag {
  switch (n.status) {
    case 'sent':
      return n.overdue
        ? { tone: 'important', text: 'No response', icon: 'clock' }
        : { tone: 'warning', text: 'Waiting for the owner', icon: 'clock' };
    case 'parent_review':
      return { tone: 'warning', text: 'With the parent owner', icon: 'arrow_up' };
    case 'kept':
      return { tone: 'neutral-quiet', text: 'Kept', icon: 'shield' };
    case 'released':
      return n.choice === 'release_part'
        ? { tone: 'success', text: 'Released part', icon: 'circle_check' }
        : { tone: 'success', text: 'Released all', icon: 'circle_check' };
    case 'reclaimed':
      return { tone: 'success', text: 'Redistributed', icon: 'check_double' };
  }
}

/** The response in words for the campaign table, with the owner's reason and plan when they kept money. */
export function responseText(n: ReclaimNotice): string {
  const m = (x: { amountMinor: number; currency: string }) =>
    formatMoney(x.amountMinor, x.currency);
  const by =
    n.respondedAs === 'parent_owner'
      ? ` (decided by ${n.respondedByName ?? 'the parent owner'})`
      : '';
  if (n.status === 'sent')
    return n.overdue
      ? `No response (was due ${n.respondBy})`
      : `No response yet (due ${n.respondBy})`;
  if (n.status === 'parent_review')
    return `Sent to ${n.parentOwnerName ?? 'the parent owner'} for a decision`;
  if (n.choice === 'keep') return `Keep it: ${n.reason ?? ''}${n.plan ? ` (${n.plan})` : ''}${by}`;
  if (n.choice === 'release_part')
    return `Release part: keep ${m(n.kept)}${n.reason ? ` for ${n.reason}` : ''}${by}`;
  return `Release all${by}`;
}

export const moneyText = (x: { amountMinor: number; currency: string }) =>
  formatMoney(x.amountMinor, x.currency);
