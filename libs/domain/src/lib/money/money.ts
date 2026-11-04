import { err, ok, type Result } from '../result';
import { isCurrencyCode, type CurrencyCode } from './currency';

/** An amount in integer minor units of an ISO 4217 currency. */
export interface Money {
  amountMinor: number;
  currency: CurrencyCode;
}

export function money(amountMinor: number, currency: CurrencyCode): Money {
  return { amountMinor, currency };
}

/** Validates an untrusted amount: safe integer minor units and a known ISO 4217 code. */
export function parseMoney(amountMinor: unknown, currency: unknown): Result<Money> {
  if (typeof currency !== 'string' || !isCurrencyCode(currency)) {
    return err(
      'UNKNOWN_CURRENCY',
      `Currency ${String(currency)} is not a supported ISO 4217 code.`,
      {
        currency: String(currency),
      },
    );
  }
  if (typeof amountMinor !== 'number' || !Number.isSafeInteger(amountMinor)) {
    return err('AMOUNT_NOT_SAFE_INTEGER', 'Amounts must be whole numbers of minor units.', {
      amountMinor: String(amountMinor),
    });
  }
  return ok({ amountMinor, currency });
}

export function requirePositive(m: Money): Result<Money> {
  return m.amountMinor > 0
    ? ok(m)
    : err('AMOUNT_NOT_POSITIVE', 'The amount must be greater than zero.', {
        amountMinor: m.amountMinor,
      });
}

function assertSafe(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`Minor-unit arithmetic overflowed: ${n}`);
  return n;
}

/** Minor units read from a database `bigint` (string, number or bigint); throws rather than lose precision. */
export function toSafeMinor(value: string | number | bigint | null | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isSafeInteger(n))
    throw new RangeError(`Minor-unit value is not a safe integer: ${value}`);
  return n;
}

export function addMinor(...values: number[]): number {
  return assertSafe(values.reduce((a, b) => a + b, 0));
}

export function subMinor(a: number, b: number): number {
  return assertSafe(a - b);
}

export function sameCurrency(a: Money, b: Money): boolean {
  return a.currency === b.currency;
}

export function negate(m: Money): Money {
  return { amountMinor: m.amountMinor === 0 ? 0 : -m.amountMinor, currency: m.currency };
}
