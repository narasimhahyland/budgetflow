/**
 * ISO 4217 currencies with their minor-unit exponents. Amounts are always integer minor units.
 * Tenants can only use currencies listed here; the database `currencies` table is seeded from this list.
 */
export const CURRENCY_EXPONENTS = {
  AED: 2,
  ARS: 2,
  AUD: 2,
  BHD: 3,
  BRL: 2,
  CAD: 2,
  CHF: 2,
  CLP: 0,
  CNY: 2,
  COP: 2,
  CZK: 2,
  DKK: 2,
  EGP: 2,
  EUR: 2,
  GBP: 2,
  HKD: 2,
  HUF: 2,
  IDR: 2,
  ILS: 2,
  INR: 2,
  ISK: 0,
  JOD: 3,
  JPY: 0,
  KES: 2,
  KRW: 0,
  KWD: 3,
  MXN: 2,
  MYR: 2,
  NGN: 2,
  NOK: 2,
  NZD: 2,
  OMR: 3,
  PHP: 2,
  PKR: 2,
  PLN: 2,
  QAR: 2,
  RON: 2,
  SAR: 2,
  SEK: 2,
  SGD: 2,
  THB: 2,
  TND: 3,
  TRY: 2,
  TWD: 2,
  UAH: 2,
  UGX: 0,
  USD: 2,
  VND: 0,
  XAF: 0,
  XOF: 0,
  ZAR: 2,
} as const satisfies Record<string, 0 | 2 | 3>;

export type CurrencyCode = keyof typeof CURRENCY_EXPONENTS;

export const CURRENCY_CODES = Object.keys(CURRENCY_EXPONENTS) as CurrencyCode[];

export function isCurrencyCode(value: string): value is CurrencyCode {
  return Object.prototype.hasOwnProperty.call(CURRENCY_EXPONENTS, value);
}

export function exponentOf(currency: CurrencyCode): number {
  return CURRENCY_EXPONENTS[currency];
}
