import { err, ok, type Result } from '../result';

/**
 * Splits a total into parts proportional to integer weights with the largest-remainder method,
 * so the parts always sum exactly to the total. Ties go to the earlier weight (deterministic).
 */
export function splitByWeights(totalMinor: number, weights: readonly number[]): Result<number[]> {
  if (!Number.isSafeInteger(totalMinor))
    return err('AMOUNT_NOT_SAFE_INTEGER', 'Total must be whole minor units.');
  if (weights.length === 0) return err('VALIDATION_FAILED', 'At least one share is required.');
  if (weights.some((w) => !Number.isSafeInteger(w) || w < 0)) {
    return err('VALIDATION_FAILED', 'Shares must be non-negative whole numbers.');
  }
  const sumWeights = weights.reduce((a, b) => a + b, 0);
  if (sumWeights === 0)
    return err('VALIDATION_FAILED', 'At least one share must be greater than zero.');
  const sign = totalMinor < 0 ? -1n : 1n;
  const total = BigInt(Math.abs(totalMinor));
  const sw = BigInt(sumWeights);
  const base = weights.map((w) => (total * BigInt(w)) / sw);
  const remainders = weights.map((w, i) => ({ i, r: (total * BigInt(w)) % sw }));
  let leftover = total - base.reduce((a, b) => a + b, 0n);
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of remainders) {
    if (leftover === 0n) break;
    base[i] += 1n;
    leftover -= 1n;
  }
  return ok(base.map((b) => Number(sign * b)));
}

/** Even split into n parts that sum to the total. */
export function splitEvenly(totalMinor: number, parts: number): Result<number[]> {
  if (!Number.isSafeInteger(parts) || parts <= 0)
    return err('VALIDATION_FAILED', 'Parts must be a positive integer.');
  return splitByWeights(
    totalMinor,
    Array.from({ length: parts }, () => 1),
  );
}
