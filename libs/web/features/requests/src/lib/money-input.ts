import { getNumberOfCurrencyDigits } from '@angular/common';

/** Major units typed by a user ("1,200.50") to integer minor units by the ISO 4217 exponent; null when not a number. */
export function toMinor(text: string | number | null | undefined, currency: string): number | null {
  if (text === null || text === undefined || text === '') return null;
  const n = Number(String(text).replace(/[,\s]/g, ''));
  if (!Number.isFinite(n)) return null;
  const minor = Math.round(n * 10 ** getNumberOfCurrencyDigits(currency));
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Minor units to an editable major-unit string. */
export function toMajor(minor: number, currency: string): string {
  return (minor / 10 ** getNumberOfCurrencyDigits(currency)).toFixed(
    getNumberOfCurrencyDigits(currency),
  );
}
