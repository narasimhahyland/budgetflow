/**
 * Data retention and legal holds (screen 111). Two rules sit above every setting here:
 *
 * 1. Accounting records and the audit trail are never deleted (`locked` categories, enforced by the
 *    append-only database triggers as well).
 * 2. A legal hold beats retention: a record covered by an active hold is never deleted or anonymised,
 *    whatever the policy says, and the run records which hold kept it.
 *
 * Every period in `RETENTION_CATALOG` is a **provisional default pending finance and legal sign-off**
 * (`signoffStatus`), not an approved legal position.
 */

export type RetentionAction = 'delete' | 'anonymise' | 'archive' | 'never';

/** Where the retention clock starts for a category. */
export type RetentionAnchor =
  | 'record_date'
  | 'fiscal_year_close'
  | 'event_close'
  | 'deactivation'
  | 'none';

/** `automatic`: the nightly run applies it. `manual`: no job acts; the period is a stated policy only. */
export type RetentionAutomation = 'automatic' | 'manual';

export interface RetentionCategoryDefinition {
  category: string;
  label: string;
  /** What the category covers, in plain English. */
  covers: string;
  action: RetentionAction;
  anchor: RetentionAnchor;
  /** Provisional default; null means kept permanently. */
  defaultPeriodDays: number | null;
  /** Shortest period the category accepts; null when there is no statutory floor. */
  minimumDays: number | null;
  /** Locked categories cannot be changed at all (accounting records, decided policies). */
  locked: boolean;
  /** Shortening this category needs a Finance Controller (`retention.confirm`). */
  financial: boolean;
  automation: RetentionAutomation;
  /** How the period reads on screen, so a number of days is never shown as "2920 days". */
  periodLabel: string;
}

const DAY = 1;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export const RETENTION_CATALOG: readonly RetentionCategoryDefinition[] = [
  {
    category: 'ledger_journals',
    label: 'Ledger journals and lines',
    covers: 'Every posting that moved money.',
    action: 'never',
    anchor: 'none',
    defaultPeriodDays: null,
    minimumDays: null,
    locked: true,
    financial: true,
    automation: 'manual',
    periodLabel: 'Permanently; accounting records are append-only and are never deleted.',
  },
  {
    category: 'audit_log',
    label: 'Audit log and hash chain',
    covers: 'Every audited action and its hash-chained entry.',
    action: 'never',
    anchor: 'none',
    defaultPeriodDays: null,
    minimumDays: null,
    locked: true,
    financial: true,
    automation: 'manual',
    periodLabel: 'Permanently; audit entries cannot be changed or removed.',
  },
  {
    category: 'financial_records',
    label: 'Requests, approvals, commitments and actuals',
    covers: 'The spending record behind each journal.',
    action: 'archive',
    anchor: 'fiscal_year_close',
    defaultPeriodDays: 8 * YEAR,
    minimumDays: 7 * YEAR,
    locked: false,
    financial: true,
    automation: 'manual',
    periodLabel: '8 years after the fiscal year closes, then archived read-only.',
  },
  {
    category: 'financial_evidence',
    label: 'Receipts, invoices and quotations',
    covers: 'Files attached as evidence for spending.',
    action: 'delete',
    anchor: 'fiscal_year_close',
    defaultPeriodDays: 8 * YEAR,
    minimumDays: 7 * YEAR,
    locked: false,
    financial: true,
    automation: 'manual',
    periodLabel: '8 years after the fiscal year closes, then deleted.',
  },
  {
    category: 'event_records',
    label: 'Event records',
    covers: 'Event budgets, costs and splits.',
    action: 'archive',
    anchor: 'event_close',
    defaultPeriodDays: 8 * YEAR,
    minimumDays: null,
    locked: false,
    financial: true,
    automation: 'manual',
    periodLabel: '8 years after the event closes, then archived read-only.',
  },
  {
    category: 'attendee_needs',
    label: 'Attendee needs',
    covers: 'Dietary, accessibility and travel needs given for an event.',
    action: 'delete',
    anchor: 'event_close',
    defaultPeriodDays: 30 * DAY,
    minimumDays: null,
    locked: true,
    financial: false,
    automation: 'manual',
    periodLabel: '30 days after the event closes, then deleted.',
  },
  {
    category: 'survey_responses',
    label: 'Survey responses',
    covers: 'Anonymous answers to post-event surveys.',
    action: 'delete',
    anchor: 'record_date',
    defaultPeriodDays: 24 * MONTH,
    minimumDays: null,
    locked: false,
    financial: false,
    automation: 'manual',
    periodLabel: '24 months, then deleted.',
  },
  {
    category: 'event_photos',
    label: 'Event photos',
    covers: 'Photos in an event gallery.',
    action: 'delete',
    anchor: 'event_close',
    defaultPeriodDays: 12 * MONTH,
    minimumDays: 1 * MONTH,
    locked: false,
    financial: false,
    automation: 'manual',
    periodLabel: '12 months after the event, then deleted.',
  },
  {
    category: 'notifications',
    label: 'Notifications',
    covers: 'In-app notifications people have received.',
    action: 'delete',
    anchor: 'record_date',
    defaultPeriodDays: 12 * MONTH,
    minimumDays: null,
    locked: false,
    financial: false,
    automation: 'automatic',
    periodLabel: '12 months, then deleted.',
  },
  {
    category: 'product_analytics',
    label: 'Product analytics events',
    covers: 'Counts and flags about how the product is used; no names or amounts.',
    action: 'delete',
    anchor: 'record_date',
    defaultPeriodDays: 25 * MONTH,
    minimumDays: null,
    locked: false,
    financial: false,
    automation: 'automatic',
    periodLabel: '25 months, then deleted.',
  },
  {
    category: 'integration_logs',
    label: 'Webhook delivery log',
    covers: 'Each attempt to deliver an event to a connected system.',
    action: 'delete',
    anchor: 'record_date',
    defaultPeriodDays: 90 * DAY,
    minimumDays: null,
    locked: false,
    financial: false,
    automation: 'automatic',
    periodLabel: '90 days, then deleted.',
  },
  {
    category: 'leaver_personal_data',
    label: 'People who left',
    covers:
      "A leaver's name, work email and job title. Financial records keep a pseudonymous reference.",
    action: 'anonymise',
    anchor: 'deactivation',
    defaultPeriodDays: 90 * DAY,
    minimumDays: null,
    locked: false,
    financial: false,
    automation: 'automatic',
    periodLabel: '90 days after the person left, then personal details are anonymised.',
  },
  {
    category: 'ai_conversations',
    label: 'AI conversation history',
    covers: 'The questions people ask the assistant and the answers it gave.',
    action: 'delete',
    anchor: 'record_date',
    defaultPeriodDays: 30 * DAY,
    minimumDays: 7 * DAY,
    locked: false,
    financial: false,
    automation: 'automatic',
    periodLabel: '30 days since the last question, then deleted.',
  },
];

export const retentionCategory = (category: string): RetentionCategoryDefinition | undefined =>
  RETENTION_CATALOG.find((c) => c.category === category);

/** Categories the nightly run can act on, in a fixed order so a run is deterministic. */
export const AUTOMATIC_RETENTION_CATEGORIES: readonly string[] = RETENTION_CATALOG.filter(
  (c) => c.automation === 'automatic',
).map((c) => c.category);

export type RetentionPolicyError =
  | 'RETENTION_CATEGORY_LOCKED'
  | 'RETENTION_BELOW_MINIMUM'
  | 'RETENTION_PERIOD_INVALID';

export interface RetentionPolicyChange {
  category: string;
  fromPeriodDays: number | null;
  toPeriodDays: number | null;
  /** A shorter period on a financial category waits for a Finance Controller. */
  needsConfirmation: boolean;
}

/** Validates a requested period change against the catalog floor and the locked flag. */
export function planRetentionChange(input: {
  definition: RetentionCategoryDefinition;
  currentPeriodDays: number | null;
  periodDays: number | null;
}):
  | { ok: true; change: RetentionPolicyChange }
  | { ok: false; code: RetentionPolicyError; message: string } {
  const { definition } = input;
  if (definition.locked)
    return {
      ok: false,
      code: 'RETENTION_CATEGORY_LOCKED',
      message: `${definition.label} cannot be changed: ${definition.periodLabel}`,
    };
  if (
    input.periodDays !== null &&
    (!Number.isSafeInteger(input.periodDays) || input.periodDays < 0)
  )
    return {
      ok: false,
      code: 'RETENTION_PERIOD_INVALID',
      message: 'A retention period is a whole number of days, or none for permanently.',
    };
  if (
    definition.minimumDays !== null &&
    (input.periodDays === null ? false : input.periodDays < definition.minimumDays)
  )
    return {
      ok: false,
      code: 'RETENTION_BELOW_MINIMUM',
      message: `${definition.label} must be kept at least ${describeDays(definition.minimumDays)}.`,
    };
  const shortens =
    input.currentPeriodDays === null
      ? input.periodDays !== null
      : input.periodDays !== null && input.periodDays < input.currentPeriodDays;
  return {
    ok: true,
    change: {
      category: definition.category,
      fromPeriodDays: input.currentPeriodDays,
      toPeriodDays: input.periodDays,
      needsConfirmation: definition.financial && shortens,
    },
  };
}

/** "90 days", "12 months", "8 years" — periods are written in words, never as a raw day count. */
export function describeDays(days: number): string {
  if (days % YEAR === 0 && days >= YEAR) {
    const y = days / YEAR;
    return `${y} year${y === 1 ? '' : 's'}`;
  }
  if (days % MONTH === 0 && days >= MONTH) {
    const m = days / MONTH;
    return `${m} month${m === 1 ? '' : 's'}`;
  }
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** The moment a record must be older than to be in scope. Null when nothing is ever removed. */
export function retentionCutoff(now: Date, periodDays: number | null): Date | null {
  if (periodDays === null) return null;
  return new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);
}

export type LegalHoldScopeKind = 'person' | 'event' | 'budget' | 'date_range';

export interface LegalHold {
  id: string;
  scopeKind: LegalHoldScopeKind;
  /** The person, event or budget the hold covers; null for a date range. */
  scopeRefId: string | null;
  /** Inclusive ISO dates for a date-range hold. */
  scopeFrom: string | null;
  scopeTo: string | null;
}

/** A record the retention run is considering, with the references a hold can match. */
export interface RetentionCandidate {
  id: string;
  /** When the retention clock started for this record (ISO 8601). */
  occurredAt: string;
  personId?: string | null;
  eventId?: string | null;
  budgetId?: string | null;
}

/**
 * Active holds covering this record. A non-empty result means the record stays, whatever the
 * retention policy says, and the run records these hold ids as the reason it was kept.
 */
export function holdsCovering(
  candidate: RetentionCandidate,
  holds: readonly LegalHold[],
): LegalHold[] {
  const day = candidate.occurredAt.slice(0, 10);
  return holds.filter((h) => {
    switch (h.scopeKind) {
      case 'person':
        return Boolean(candidate.personId) && h.scopeRefId === candidate.personId;
      case 'event':
        return Boolean(candidate.eventId) && h.scopeRefId === candidate.eventId;
      case 'budget':
        return Boolean(candidate.budgetId) && h.scopeRefId === candidate.budgetId;
      case 'date_range':
        return (!h.scopeFrom || day >= h.scopeFrom) && (!h.scopeTo || day <= h.scopeTo);
    }
  });
}

/**
 * Splits candidates into what the run removes and what a legal hold keeps. The only place that
 * decides whether a record is deleted, so the hold rule cannot be bypassed by a caller.
 */
export function applyLegalHolds<T extends RetentionCandidate>(
  candidates: readonly T[],
  holds: readonly LegalHold[],
): { affected: T[]; held: { candidate: T; holdIds: string[] }[] } {
  const affected: T[] = [];
  const held: { candidate: T; holdIds: string[] }[] = [];
  for (const candidate of candidates) {
    const covering = holdsCovering(candidate, holds);
    if (covering.length > 0) held.push({ candidate, holdIds: covering.map((h) => h.id) });
    else affected.push(candidate);
  }
  return { affected, held };
}

/**
 * Identifies the scope of a run so an apply run cannot widen what its dry run previewed: the same
 * categories under the same periods produce the same key. Timestamps are deliberately left out, so
 * the key is stable between the preview and the run that follows it.
 */
export function retentionScopeKey(
  categories: readonly { category: string; periodDays: number | null }[],
): string {
  return [...categories]
    .map((c) => `${c.category}=${c.periodDays ?? 'never'}`)
    .sort((a, b) => a.localeCompare(b))
    .join('|');
}
