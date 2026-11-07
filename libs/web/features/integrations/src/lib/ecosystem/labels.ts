import type {
  AutomationAction,
  BiTool,
  BookingStatus,
  EcosystemConnectionStatus,
  MarketplaceCategory,
  NoCodePlatform,
  PartnerStatus,
  WidgetKind,
  WidgetStatus,
} from '@bf/contracts';
import type { Tone } from '../labels';

/**
 * Phase 16 labels and tones. A revoked or expired connection, a paused partner and a paused widget
 * never carry a success tone: a surface that has stopped working must not look like one that works.
 */
export const CONNECTION_STATUS_LABELS: Record<EcosystemConnectionStatus, string> = {
  active: 'Active',
  expiring_soon: 'Expiring soon',
  expired: 'Expired',
  revoked: 'Revoked',
};

export const CONNECTION_STATUS_TONES: Record<EcosystemConnectionStatus, Tone> = {
  active: 'success',
  expiring_soon: 'warning',
  expired: 'important',
  revoked: 'important',
};

/** What the person reading the row should understand has happened to the token behind it. */
export const CONNECTION_STATUS_NOTES: Record<EcosystemConnectionStatus, string> = {
  active: 'The tool can read what its owner can read, and nothing else.',
  expiring_soon: 'The owner has to connect again before it expires, or calls start failing.',
  expired: 'Calls from this tool now fail. Connect again to get a new token.',
  revoked: 'Calls from this tool fail with "Access revoked". The token can never be used again.',
};

/** The order the lists use: what needs attention first, then what is already dead. */
export const CONNECTION_STATUS_ORDER: EcosystemConnectionStatus[] = [
  'expiring_soon',
  'active',
  'expired',
  'revoked',
];

export const BI_TOOL_LABELS: Record<BiTool, string> = {
  power_bi: 'Power BI',
  tableau: 'Tableau',
};

export const NO_CODE_PLATFORM_LABELS: Record<NoCodePlatform, string> = {
  zapier: 'Zapier',
  make: 'Make',
  power_automate: 'Microsoft Power Automate',
  workato: 'Workato',
};

export const AUTOMATION_ACTION_LABELS: Record<AutomationAction, string> = {
  'budget.balance.read': 'Look up a budget balance',
  'request.draft.create': 'Create a draft request',
};

export const MARKETPLACE_CATEGORY_LABELS: Record<MarketplaceCategory, string> = {
  experiences: 'Experiences',
  catering: 'Catering',
  gifts_and_kits: 'Gifts and kits',
};

export const PARTNER_STATUS_LABELS: Record<PartnerStatus, string> = {
  enabled: 'Enabled',
  paused: 'Paused',
};

export const PARTNER_STATUS_TONES: Record<PartnerStatus, Tone> = {
  enabled: 'success',
  paused: 'neutral',
};

export const PARTNER_MODE_LABELS: Record<'mock' | 'sandbox' | 'live', string> = {
  mock: 'Mock',
  sandbox: 'Sandbox',
  live: 'Live',
};

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  waiting_for_partner: 'Waiting for partner',
  quoted: 'Quoted',
  declined: 'Declined',
  cancelled: 'Cancelled',
};

export const BOOKING_STATUS_TONES: Record<BookingStatus, Tone> = {
  waiting_for_partner: 'info',
  quoted: 'success',
  declined: 'warning',
  cancelled: 'neutral',
};

export const WIDGET_KIND_LABELS: Record<WidgetKind, string> = {
  team_budget: 'Team budget',
  upcoming_events: 'Upcoming events',
};

export const WIDGET_STATUS_LABELS: Record<WidgetStatus, string> = {
  active: 'Active',
  paused: 'Paused',
};

export const WIDGET_STATUS_TONES: Record<WidgetStatus, Tone> = {
  active: 'success',
  paused: 'neutral',
};

/**
 * The sentence every connection list carries. BudgetFlow keeps a hash of the token and nothing
 * else, so there is no screen, endpoint or support process that can show one again.
 */
export const TOKEN_SECRECY_NOTE =
  'A connection token is shown once, when the connection is made. BudgetFlow stores only a hash of it, so it can never be shown again here or anywhere else. If a token is lost, revoke the connection and make a new one.';

/** Said on every surface that reaches outside the app, in the same words the API returns. */
export const READ_ONLY_NOTE =
  'It cannot approve, reject, submit, apply a control or move money, and it never shows more than the person who connected it can see in BudgetFlow.';
