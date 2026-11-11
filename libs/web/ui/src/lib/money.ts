import { formatNumber, getNumberOfCurrencyDigits, registerLocaleData } from '@angular/common';
import localeEnIn from '@angular/common/locales/en-IN';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

registerLocaleData(localeEnIn, 'en-IN');

/** Indian lakh/crore grouping for INR; Western grouping for every other currency. */
export const moneyLocale = (currency: string): string => (currency === 'INR' ? 'en-IN' : 'en-US');

/**
 * Formats integer minor units by the ISO 4217 exponent with the Angular number formatter:
 * `formatMoney(249750000, 'INR')` is `INR 24,97,500.00`, `formatMoney(-123, 'USD')` is `-USD 1.23`
 * (code and figure joined by a no-break space).
 */
export function formatMoney(amountMinor: number, currency: string): string {
  const digits = getNumberOfCurrencyDigits(currency);
  const major = Math.abs(amountMinor) / 10 ** digits;
  const value = formatNumber(major, moneyLocale(currency), `1.${digits}-${digits}`);
  // A no-break space keeps the code and the figure together when the amount sits in a sentence.
  return `${amountMinor < 0 ? '-' : ''}${currency}\u00a0${value}`;
}

/** Money with its currency code and tabular numerals. Inputs are integer minor units from the API. */
@Component({
  selector: 'bf-money',
  template: `<span class="bf-money" [class.bf-money--negative]="amountMinor() < 0">{{
    text()
  }}</span>`,
  styles: `
    .bf-money {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Money {
  readonly amountMinor = input.required<number>();
  readonly currency = input.required<string>();
  protected readonly text = computed(() => formatMoney(this.amountMinor(), this.currency()));
}
