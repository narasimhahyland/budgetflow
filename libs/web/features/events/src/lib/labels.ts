/**
 * Plain-English labels for the codes the events API returns (event types, cost categories,
 * contribution and intercompany modes, needs, vendor status). Anything not listed reads as the
 * code in sentence case, so a new code never shows an underscore.
 */
const LABELS: Record<string, string> = {
  team_event: 'Team event',
  townhall: 'Town hall',
  earmark: 'Earmark',
  transfer: 'Transfer',
  block: 'Blocked',
  recharge_at_cost: 'Recharge at cost',
  recharge_with_markup: 'Recharge with markup',
  cant_go: "Can't go",
  no_show: 'No-show',
  walk_in: 'Walk-in',
  no_preference: 'No preference',
  step_free_access: 'Step-free access',
  seating_near_an_exit: 'Seating near an exit',
  legal_entity: 'Legal entity',
  cost_center: 'Cost center',
  on_the_day: 'On the day',
  above_limit: 'Above the per-head limit',
  above_available: 'Above what is available',
  within_limit: 'Within the limit',
};

export function label(code: string | null | undefined): string {
  if (!code) return '';
  return LABELS[code] ?? code.charAt(0).toUpperCase() + code.slice(1).replace(/_/g, ' ');
}

/** Two initials for `sat-avatar` ("Priya Raman" → "PR"). */
export function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = words[0][0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1][0] ?? '') : (words[0][1] ?? '');
  return (first + last).toUpperCase();
}
