import type { AllocationWeights } from '@bf/contracts';
import type { Fact } from './provider/ai-provider';

/** Suggestions read like plans rather than calculator output: rounded to USD 50.00 (022d). */
export const ROUNDING_MINOR = 5_000;

/**
 * Deterministic split: a weighted score per child, normalized to the amount, rounded down to the
 * rounding step, with the remainder on the largest line so the lines always total the amount exactly.
 */
export function splitAmount(
  amountMinor: number,
  facts: readonly Fact[],
  weights: AllocationWeights,
): { budgetId: string; amountMinor: number }[] {
  const scores = facts.map((f) => {
    const headcount = Number(f.fields['eligibleHeadcount'] ?? 0);
    const priorUseBps = Number(f.fields['priorUseBps'] ?? 0);
    const participationBps = Number(f.fields['participationBps'] ?? 0);
    const score =
      weights.headcountPct * headcount +
      (weights.priorUsePct * priorUseBps) / 100 +
      (weights.participationPct * participationBps) / 100;
    return { budgetId: f.id, score: score > 0 ? score : 0 };
  });
  const total = scores.reduce((s, x) => s + x.score, 0);
  const even = total <= 0;
  const steps = Math.floor(amountMinor / ROUNDING_MINOR);
  const shares = scores.map((s) => ({
    budgetId: s.budgetId,
    steps: even ? Math.floor(steps / scores.length) : Math.floor((steps * s.score) / total),
    score: s.score,
  }));
  let used = shares.reduce((sum, s) => sum + s.steps, 0);
  const lines = shares
    .map((s) => ({ budgetId: s.budgetId, amountMinor: s.steps * ROUNDING_MINOR, score: s.score }))
    .sort((a, b) => b.amountMinor - a.amountMinor || a.budgetId.localeCompare(b.budgetId));
  const remainder = amountMinor - used * ROUNDING_MINOR;
  if (lines.length && remainder > 0) lines[0].amountMinor += remainder;
  used = 0;
  return lines
    .map(({ budgetId, amountMinor: m }) => ({ budgetId, amountMinor: m }))
    .sort((a, b) => a.budgetId.localeCompare(b.budgetId));
}
