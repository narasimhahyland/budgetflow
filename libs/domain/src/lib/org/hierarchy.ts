import { parseIsoDate, toIsoDate } from '../fiscal/calendar';
import { err, ok, type Result } from '../result';

/**
 * Org hierarchy rules. Units are effective-dated: every change (create, rename, move, manager,
 * deactivate) takes effect on a date and never rewrites history. Dates are ISO `YYYY-MM-DD`.
 */
export const ORG_UNIT_KINDS = [
  'company',
  'business_unit',
  'region',
  'location',
  'department',
  'team',
] as const;
export type OrgUnitKind = (typeof ORG_UNIT_KINDS)[number];

/** Which kinds a unit may sit under. A company is the only root. */
export const ALLOWED_PARENT_KINDS: Record<OrgUnitKind, readonly OrgUnitKind[]> = {
  company: [],
  business_unit: ['company', 'business_unit'],
  region: ['company', 'business_unit'],
  location: ['company', 'business_unit', 'region'],
  department: ['company', 'business_unit', 'region', 'location', 'department'],
  team: ['location', 'department', 'team'],
};

const KIND_LABEL: Record<OrgUnitKind, string> = {
  company: 'company',
  business_unit: 'business unit',
  region: 'region',
  location: 'location',
  department: 'department',
  team: 'team',
};

export function orgKindLabel(kind: OrgUnitKind): string {
  return KIND_LABEL[kind];
}

/** Checks that a unit of `kind` may sit under a parent of `parentKind` (null for a root). */
export function validateParentKind(
  kind: OrgUnitKind,
  parentKind: OrgUnitKind | null,
): Result<true> {
  if (parentKind === null) {
    return kind === 'company'
      ? ok(true)
      : err('ORG_HIERARCHY_INVALID', `A ${KIND_LABEL[kind]} needs a parent unit.`, { kind });
  }
  if (!ALLOWED_PARENT_KINDS[kind].includes(parentKind)) {
    return err(
      'ORG_HIERARCHY_INVALID',
      `A ${KIND_LABEL[kind]} cannot sit under a ${KIND_LABEL[parentKind]}.`,
      { kind, parentKind },
    );
  }
  return ok(true);
}

/** A move must not place a unit under itself or one of its descendants. */
export function validateNoCycle(
  unitId: string,
  newParentId: string,
  descendantIds: readonly string[],
): Result<true> {
  if (unitId === newParentId || descendantIds.includes(newParentId)) {
    return err(
      'ORG_HIERARCHY_INVALID',
      'A unit cannot move under itself or one of its own units.',
      {
        unitId,
        newParentId,
      },
    );
  }
  return ok(true);
}

/**
 * Effective-dated changes append to history: a change must take effect after the unit's latest
 * recorded change, so earlier history is never rewritten (backdating before it is refused).
 */
export function validateEffectiveDate(
  effectiveFrom: string,
  latestChangeFrom: string | null,
  activeTo: string | null = null,
): Result<true> {
  try {
    parseIsoDate(effectiveFrom);
  } catch {
    return err('VALIDATION_FAILED', 'The effective date must be a date (YYYY-MM-DD).', {
      field: 'effectiveFrom',
    });
  }
  if (latestChangeFrom !== null && effectiveFrom <= latestChangeFrom) {
    return err(
      'EFFECTIVE_DATE_CONFLICT',
      `This unit already has a change effective ${latestChangeFrom}; date the new change after it.`,
      { effectiveFrom, latestChangeFrom },
    );
  }
  if (activeTo !== null && effectiveFrom > activeTo) {
    return err('EFFECTIVE_DATE_CONFLICT', `This unit is inactive after ${activeTo}.`, {
      effectiveFrom,
      activeTo,
    });
  }
  return ok(true);
}

/** The day before an ISO date (the closing `valid_to` of the version a change replaces). */
export function dayBefore(date: string): string {
  return toIsoDate(parseIsoDate(date) - 86_400_000);
}

/** Whether an effective-dated row is active on `date` (inclusive bounds; open-ended when `to` is null). */
export function activeOn(
  row: { validFrom: string; validTo: string | null },
  date: string,
): boolean {
  return row.validFrom <= date && (row.validTo === null || date <= row.validTo);
}

export interface VersionedRow {
  validFrom: string;
  validTo: string | null;
}

/** The version of an effective-dated record that applies on `date`, if any. */
export function versionOn<T extends VersionedRow>(rows: readonly T[], date: string): T | null {
  return rows.find((r) => activeOn(r, date)) ?? null;
}
