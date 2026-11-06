/**
 * Company-wide administration settings (screens 109 notifications, 110 documents, 112 security,
 * 102b branding). Defaults and limits live here so the API only stores what these rules accept.
 */

export type NotificationChannel = 'in_app' | 'email' | 'push' | 'slack' | 'teams';
export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = [
  'in_app',
  'email',
  'push',
  'slack',
  'teams',
];

export type NotificationAudience =
  | 'approvers'
  | 'requesters'
  | 'owners'
  | 'organizers_employees'
  | 'finance';

export interface NotificationDefaultDefinition {
  type: string;
  audience: NotificationAudience;
  name: string;
  /** Required types always reach In-app and Email and can never be switched off. */
  required: boolean;
  /** Channels on by default (In-app and Email are forced on for required types). */
  defaultChannels: readonly NotificationChannel[];
  /** Whether a person may turn this row off for themselves (screen 59c). */
  allowOptOut: boolean;
}

const req = (
  type: string,
  audience: NotificationAudience,
  name: string,
  extra: readonly NotificationChannel[] = [],
): NotificationDefaultDefinition => ({
  type,
  audience,
  name,
  required: true,
  defaultChannels: ['in_app', 'email', ...extra],
  allowOptOut: false,
});

const opt = (
  type: string,
  audience: NotificationAudience,
  name: string,
  defaultChannels: readonly NotificationChannel[],
): NotificationDefaultDefinition => ({
  type,
  audience,
  name,
  required: false,
  defaultChannels,
  allowOptOut: true,
});

export const NOTIFICATION_DEFAULTS: readonly NotificationDefaultDefinition[] = [
  req('approval.needed', 'approvers', 'Approval needed'),
  req('approval.escalated', 'approvers', 'Escalated to you'),
  req('delegation.changed', 'approvers', 'Delegation started or ended'),
  opt('approval.due_soon', 'approvers', 'Approval due soon', ['in_app', 'push']),
  req('request.decided', 'requesters', 'Request decided'),
  req('request.changes_requested', 'requesters', 'Changes requested'),
  opt('request.receipt_needed', 'requesters', 'Receipt needed', ['in_app', 'email', 'push']),
  opt('budget.threshold_reached', 'owners', 'Threshold reached (50, 80, 100%)', [
    'in_app',
    'email',
  ]),
  req('budget.control_changed', 'owners', 'Budget frozen, reduced or set to zero'),
  req('contribution.received', 'owners', 'Co-funding request received'),
  opt('budget.outlook_nudge', 'owners', 'Spending outlook nudge', ['in_app']),
  opt('event.invitation', 'organizers_employees', 'Event invitation', ['in_app', 'email']),
  opt('event.rsvp_reminder', 'organizers_employees', 'RSVP reminder', ['email', 'push']),
  opt('event.survey_invitation', 'organizers_employees', 'Survey invitation', ['email']),
  opt('actuals.unmatched_ageing', 'finance', 'Unmatched actuals older than 30 days', ['in_app']),
  req('gl.tieout_difference', 'finance', 'Tie-out difference'),
  opt('integration.failure', 'finance', 'Integration failure', ['in_app', 'email']),
];

export interface QuietHoursSettings {
  enabled: boolean;
  /** Local times in each person's office timezone, 24-hour `HH:MM`. */
  startTime: string;
  endTime: string;
  includeWeekends: boolean;
  /** Email is never held; escalations ignore quiet hours. */
  heldChannels: readonly NotificationChannel[];
  escalationsIgnoreQuietHours: boolean;
  senderName: string;
  replyToLocalPart: string;
}

export const QUIET_HOURS_DEFAULTS: QuietHoursSettings = {
  enabled: true,
  startTime: '20:00',
  endTime: '08:00',
  includeWeekends: true,
  heldChannels: ['push', 'slack', 'teams'],
  escalationsIgnoreQuietHours: true,
  senderName: 'BudgetFlow at Hyland',
  replyToLocalPart: 'budgetflow-noreply',
};

/** Uploads come from a fixed safe list; there is no free-form file type (screen 110). */
export const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;
export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export interface DocumentKindSettings {
  kind: string;
  name: string;
  usedOn: string;
  allowedContentTypes: readonly string[];
  maxBytes: number;
  downloadAllowed: boolean;
  inlinePreview: boolean;
}

const MB = 1024 * 1024;

export const DOCUMENT_KIND_DEFAULTS: readonly DocumentKindSettings[] = [
  {
    kind: 'receipt',
    name: 'Receipt',
    usedOn: 'Requests and commitments',
    allowedContentTypes: ['application/pdf', 'image/png', 'image/jpeg'],
    maxBytes: 10 * MB,
    downloadAllowed: true,
    inlinePreview: true,
  },
  {
    kind: 'invoice',
    name: 'Invoice',
    usedOn: 'Commitments and actuals',
    allowedContentTypes: ['application/pdf'],
    maxBytes: 10 * MB,
    downloadAllowed: true,
    inlinePreview: true,
  },
  {
    kind: 'quotation',
    name: 'Quotation',
    usedOn: 'Events and commitments',
    allowedContentTypes: ['application/pdf', 'image/png', 'image/jpeg'],
    maxBytes: 10 * MB,
    downloadAllowed: true,
    inlinePreview: true,
  },
  {
    kind: 'supporting',
    name: 'Supporting document',
    usedOn: 'Requests, events and budgets',
    allowedContentTypes: [...ALLOWED_CONTENT_TYPES],
    maxBytes: 10 * MB,
    downloadAllowed: true,
    inlinePreview: true,
  },
  {
    kind: 'event_photo',
    name: 'Event photo',
    usedOn: 'Event gallery',
    allowedContentTypes: ['image/png', 'image/jpeg'],
    maxBytes: 15 * MB,
    downloadAllowed: false,
    inlinePreview: true,
  },
  {
    kind: 'import_file',
    name: 'Import file',
    usedOn: 'Plan, actuals and headcount imports',
    allowedContentTypes: [
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    maxBytes: 25 * MB,
    downloadAllowed: true,
    inlinePreview: false,
  },
];

export interface SessionSettings {
  idleTimeoutMinutes: number;
  maxSessionHours: number;
  localAccountsForServiceUsersOnly: boolean;
  biometricUnlockAllowed: boolean;
}

export const SESSION_DEFAULTS: SessionSettings = {
  idleTimeoutMinutes: 30,
  maxSessionHours: 12,
  localAccountsForServiceUsersOnly: true,
  biometricUnlockAllowed: true,
};

export const IDLE_TIMEOUT_RANGE = { min: 5, max: 240 } as const;
export const MAX_SESSION_RANGE = { min: 1, max: 24 } as const;

export interface BrandingSettings {
  programName: string;
  tagline: string;
  emailFooter: string;
  /** Accent colour as a hex triplet; the Satori theme stays in charge of everything else. */
  accentColor: string;
}

export const BRANDING_DEFAULTS: BrandingSettings = {
  programName: 'BudgetFlow at Hyland',
  tagline: 'Budgets, approvals and events in one place.',
  emailFooter: 'Replies to this address are not read. Sign in to BudgetFlow to answer.',
  accentColor: '#1F4FD8',
};

export type SettingsError =
  | 'SESSION_LIMITS_INVALID'
  | 'DOCUMENT_RULES_INVALID'
  | 'QUIET_HOURS_INVALID'
  | 'NOTIFICATION_REQUIRED'
  | 'BRANDING_INVALID';

export function validateSessionSettings(
  s: SessionSettings,
): { ok: true } | { ok: false; code: SettingsError; message: string } {
  if (
    s.idleTimeoutMinutes < IDLE_TIMEOUT_RANGE.min ||
    s.idleTimeoutMinutes > IDLE_TIMEOUT_RANGE.max
  )
    return {
      ok: false,
      code: 'SESSION_LIMITS_INVALID',
      message: `Idle timeout must be ${IDLE_TIMEOUT_RANGE.min}-${IDLE_TIMEOUT_RANGE.max} minutes.`,
    };
  if (s.maxSessionHours < MAX_SESSION_RANGE.min || s.maxSessionHours > MAX_SESSION_RANGE.max)
    return {
      ok: false,
      code: 'SESSION_LIMITS_INVALID',
      message: `Maximum session must be ${MAX_SESSION_RANGE.min}-${MAX_SESSION_RANGE.max} hours.`,
    };
  return { ok: true };
}

export function validateDocumentKind(
  k: DocumentKindSettings,
): { ok: true } | { ok: false; code: SettingsError; message: string } {
  if (k.allowedContentTypes.length === 0)
    return { ok: false, code: 'DOCUMENT_RULES_INVALID', message: 'Choose at least one file type.' };
  const unsafe = k.allowedContentTypes.filter(
    (t) => !(ALLOWED_CONTENT_TYPES as readonly string[]).includes(t),
  );
  if (unsafe.length > 0)
    return {
      ok: false,
      code: 'DOCUMENT_RULES_INVALID',
      message: `File types come from the safe list; ${unsafe[0]} is not on it.`,
    };
  if (k.maxBytes < 1 * MB || k.maxBytes > MAX_DOCUMENT_BYTES)
    return {
      ok: false,
      code: 'DOCUMENT_RULES_INVALID',
      message: 'Maximum size is 1-25 MB.',
    };
  return { ok: true };
}

export function validateQuietHours(
  q: QuietHoursSettings,
): { ok: true } | { ok: false; code: SettingsError; message: string } {
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!time.test(q.startTime) || !time.test(q.endTime))
    return {
      ok: false,
      code: 'QUIET_HOURS_INVALID',
      message: 'Quiet hours need a start and an end time (HH:MM).',
    };
  if (q.heldChannels.includes('email'))
    return {
      ok: false,
      code: 'QUIET_HOURS_INVALID',
      message: 'Email is never held during quiet hours.',
    };
  if (q.senderName.trim().length === 0)
    return { ok: false, code: 'QUIET_HOURS_INVALID', message: 'Enter a sender name.' };
  return { ok: true };
}

/** A required notification type can never lose In-app or Email, whoever asks. */
export function validateNotificationDefault(
  definition: NotificationDefaultDefinition,
  channels: readonly NotificationChannel[],
): { ok: true } | { ok: false; code: SettingsError; message: string } {
  if (!definition.required) return { ok: true };
  const missing = (['in_app', 'email'] as const).filter((c) => !channels.includes(c));
  if (missing.length > 0)
    return {
      ok: false,
      code: 'NOTIFICATION_REQUIRED',
      message: `${definition.name} always reaches In-app and Email and cannot be turned off.`,
    };
  return { ok: true };
}

export function validateBranding(
  b: BrandingSettings,
): { ok: true } | { ok: false; code: SettingsError; message: string } {
  if (b.programName.trim().length === 0)
    return { ok: false, code: 'BRANDING_INVALID', message: 'Enter a program name.' };
  if (!/^#[0-9A-Fa-f]{6}$/.test(b.accentColor))
    return {
      ok: false,
      code: 'BRANDING_INVALID',
      message: 'The accent colour is a hex value such as #1F4FD8.',
    };
  return { ok: true };
}
