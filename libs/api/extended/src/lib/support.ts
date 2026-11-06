import { people, type Tx } from '@bf/api/db';
import { inArray } from 'drizzle-orm';

export interface CommandContext {
  idempotencyKey: string;
  requestId: string | null;
}

/** ISO 8601 in UTC without sub-second precision, the shape every contract timestamp uses. */
export const iso = (value: Date): string => value.toISOString().replace(/\.\d+Z$/, 'Z');

export const todayUtc = (): string => new Date().toISOString().slice(0, 10);

/** Display names for a set of people, by id. Ids that do not resolve are simply absent. */
export async function nameOfPeople(
  tx: Tx,
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const rows = await tx
    .select({ id: people.id, displayName: people.displayName })
    .from(people)
    .where(inArray(people.id, unique));
  return new Map(rows.map((r) => [r.id, r.displayName]));
}

/**
 * Privacy thresholds this phase shares with Phase 9 and screen 15b. Survey figures need five
 * responses and retention figures ten people; below that the figure is suppressed, never estimated
 * and never shown with a smaller group.
 */
export const MIN_SURVEY_RESPONSES = 5;
export const MIN_RETENTION_GROUP = 10;
export const MIN_RANKED_GROUP = 5;

export interface Suppressible {
  valueMilli: number | null;
  groupSize: number;
  suppressed: boolean;
  suppressionReason: string | null;
}

/**
 * Builds an aggregate that refuses to speak about a group too small to hide a person in. The value
 * is dropped, not rounded or blurred, so no caller can reconstruct it from the response.
 */
export function suppressible(
  valueMilli: number | null,
  groupSize: number,
  minimum: number,
  unit: 'responses' | 'people',
): Suppressible {
  if (groupSize < minimum || valueMilli === null)
    return {
      valueMilli: null,
      groupSize,
      suppressed: true,
      suppressionReason: `Fewer than ${minimum} ${unit}`,
    };
  return { valueMilli, groupSize, suppressed: false, suppressionReason: null };
}

/** Basis points of `part` in `whole`, or null when there is nothing to divide by. */
export const bps = (part: number, whole: number): number | null =>
  whole > 0 ? Math.round((part / whole) * 10_000) : null;
