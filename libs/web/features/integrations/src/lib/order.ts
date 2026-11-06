/**
 * Deterministic row order for every list these screens render.
 *
 * The API returns rows in query order, which leaves ties (two connectors in the same category, two
 * runs started in the same second, two keys created in the same batch) to whatever the database
 * happened to return. Two admins looking at the same screen then see different orders, and a visual
 * baseline reshuffles when unrelated rows are inserted. Every sort below ends on the row id, which
 * is unique, so the order is total.
 */

/** Compares strings the way a reader expects, with a stable result for equal text. */
const text = (a: string | null, b: string | null): number => (a ?? '').localeCompare(b ?? '', 'en');

/** Later first. Nulls (never ran, never delivered) sort after everything that has a timestamp. */
const newestFirst = (a: string | null, b: string | null): number => {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return b.localeCompare(a);
};

/** Earlier first, nulls last. */
const oldestFirst = (a: string | null, b: string | null): number => {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b);
};

/**
 * Sorts a copy of `rows` by the comparators in turn, always ending on the id so no two rows can
 * compare equal.
 */
export function ordered<T extends { id: string }>(
  rows: readonly T[],
  ...by: ((a: T, b: T) => number)[]
): T[] {
  return [...rows].sort((a, b) => {
    for (const compare of by) {
      const result = compare(a, b);
      if (result !== 0) return result;
    }
    return a.id.localeCompare(b.id);
  });
}

export const byText =
  <T>(pick: (row: T) => string | null) =>
  (a: T, b: T): number =>
    text(pick(a), pick(b));

export const byNewest =
  <T>(pick: (row: T) => string | null) =>
  (a: T, b: T): number =>
    newestFirst(pick(a), pick(b));

export const byOldest =
  <T>(pick: (row: T) => string | null) =>
  (a: T, b: T): number =>
    oldestFirst(pick(a), pick(b));

/** Lower rank first: used to float the rows that need a person's attention to the top. */
export const byRank =
  <T>(pick: (row: T) => number) =>
  (a: T, b: T): number =>
    pick(a) - pick(b);

/** Position of a value in a fixed list; values outside it sort last, in their own stable order. */
export const rankIn = <T>(order: readonly T[], value: T): number => {
  const at = order.indexOf(value);
  return at === -1 ? order.length : at;
};
