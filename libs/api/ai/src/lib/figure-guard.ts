import type { Fact } from './provider/ai-provider';

/**
 * AI never invents or recomputes a figure it presents as fact. Numbers people see come from the
 * reconciled read models; the model only writes sentences around them. This guard checks that every
 * number in model-written text was in the retrieved facts, and the gateway discards the output otherwise.
 */

const NUMBER = /-?\d[\d,\u00a0 ]*(?:\.\d+)?/g;

/** Canonical form of a number token: no separators, no leading zeros, no trailing decimal zeros. */
export function canon(token: string): string {
  const cleaned = token.replace(/[,\u00a0 ]/g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return cleaned;
  return String(n);
}

function addNumber(into: Set<string>, value: number): void {
  if (!Number.isFinite(value)) return;
  into.add(canon(String(value)));
  into.add(canon(Math.abs(value).toString()));
}

function addFromText(into: Set<string>, text: string): void {
  for (const match of text.match(NUMBER) ?? []) into.add(canon(match));
}

/**
 * Every number the model is allowed to write: the fact values themselves, their major-unit and
 * percentage forms, and any number inside a fact's label or string value (dates, references).
 */
export function allowedNumbers(facts: readonly Fact[]): Set<string> {
  const allowed = new Set<string>();
  for (const fact of facts) {
    addFromText(allowed, fact.label);
    addFromText(allowed, fact.id);
    for (const [key, value] of Object.entries(fact.fields)) {
      if (typeof value === 'number') {
        addNumber(allowed, value);
        if (key.endsWith('Minor')) {
          addNumber(allowed, value / 100);
          allowed.add(canon((value / 100).toFixed(2)));
        }
        if (key.endsWith('Bps')) {
          addNumber(allowed, value / 100);
          allowed.add(canon((value / 100).toFixed(1)));
        }
      } else if (typeof value === 'string') {
        addFromText(allowed, value);
      }
    }
  }
  return allowed;
}

/** Numbers in `text` that are not traceable to a retrieved fact, in the order they appear. */
export function untraceableNumbers(text: string, allowed: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const match of text.match(NUMBER) ?? []) {
    const value = canon(match);
    if (!allowed.has(value)) out.push(match.trim());
  }
  return out;
}

/** True when every number in every sentence came from the facts. */
export function figuresTraceable(
  sentences: readonly string[],
  allowed: ReadonlySet<string>,
): { ok: boolean; untraceable: string[] } {
  const untraceable = sentences.flatMap((s) => untraceableNumbers(s, allowed));
  return { ok: untraceable.length === 0, untraceable };
}
