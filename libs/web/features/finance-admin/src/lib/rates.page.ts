import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import type { ExchangeRate } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, todayIso, valueOf } from './api';
import { LoadState } from './load-state';

type RateType = ExchangeRate['rateType'];

const TYPE_LABEL: Record<RateType, string> = {
  plan: 'Plan (locked per fiscal year)',
  spot: 'Spot',
  month_end: 'Month-end',
  monthly_average: 'Monthly average',
};

/** Screens 107 and 107a: currencies, exchange-rate types, plan-rate lock and rate lookup. */
@Component({
  selector: 'bf-rates-page',
  imports: [
    DatePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    Money,
    SAT_BANNER_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  templateUrl: './rates.page.html',
  styleUrl: './page.scss',
  styles: `
    .bf-compare {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 12px;
      padding: 0 20px 20px;
    }
    .bf-compare .bf-kpi__value {
      font: var(--mat-sys-title-large);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RatesPage {
  protected readonly valueOf = valueOf;
  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly typeLabel = TYPE_LABEL;
  protected readonly types = Object.keys(TYPE_LABEL) as RateType[];
  protected readonly columns = ['type', 'pair', 'rate', 'date', 'year', 'source', 'locked'];

  protected readonly typeFilter = signal<RateType | null>(null);
  protected readonly currencyFilter = signal<string | null>(null);
  protected readonly limit = signal(100);
  protected readonly notice = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly currencies = resource({ loader: () => data(this.api.listCurrencies({})) });
  protected readonly rates = resource({
    params: () => ({
      ...(this.typeFilter() ? { rateType: this.typeFilter()! } : {}),
      ...(this.currencyFilter() ? { quoteCurrency: this.currencyFilter()! } : {}),
      limit: this.limit(),
    }),
    loader: ({ params }) => data(this.api.listExchangeRates({ query: params })),
  });
  protected readonly calendars = resource({ loader: () => data(this.api.listFiscalCalendars({})) });
  protected readonly groupCalendar = resource({
    params: () => {
      const id = this.calendars
        .value()
        ?.items.find((c) => c.legalEntities.some((l) => l.code === 'HYL-US'))?.id;
      return id ? { id } : undefined;
    },
    loader: ({ params }) => data(this.api.getFiscalCalendar({ params: { calendarId: params.id } })),
  });

  protected readonly canManage = computed(() => this.session.can('fx.manage'));
  protected readonly reporting = computed(
    () => valueOf(this.currencies)?.reportingCurrency ?? 'USD',
  );
  protected readonly quotes = computed(() =>
    (valueOf(this.currencies)?.items ?? []).filter((c) => c.code !== this.reporting()),
  );

  // Lookup
  protected readonly from = signal('INR');
  protected readonly date = signal(todayIso());
  protected readonly amount = signal('100000');
  protected readonly compareType = signal<RateType>('spot');
  protected readonly amountMinor = computed(() => {
    const exp = valueOf(this.currencies)?.items.find((c) => c.code === this.from())?.exponent ?? 2;
    const n = Number(this.amount());
    return Number.isFinite(n) ? Math.round(n * 10 ** exp) : 0;
  });
  protected readonly planLookup = resource({
    params: () => ({
      from: this.from(),
      to: this.reporting(),
      date: this.date(),
      type: 'plan' as const,
      amountMinor: this.amountMinor(),
    }),
    loader: ({ params }) => data(this.api.lookupExchangeRate({ query: params })),
  });
  protected readonly otherLookup = resource({
    params: () => ({
      from: this.from(),
      to: this.reporting(),
      date: this.date(),
      type: this.compareType(),
      amountMinor: this.amountMinor(),
    }),
    loader: ({ params }) => data(this.api.lookupExchangeRate({ query: params })),
  });
  protected readonly fxEffect = computed(() => {
    const a = valueOf(this.planLookup)?.converted;
    const b = valueOf(this.otherLookup)?.converted;
    return a && b ? b.amountMinor - a.amountMinor : null;
  });

  // Add rate
  protected readonly adding = signal(false);
  protected readonly newType = signal<RateType>('spot');
  protected readonly newQuote = signal('INR');
  protected readonly newRate = signal('');
  protected readonly newDate = signal(todayIso());
  protected readonly newYearId = signal<string | null>(null);
  protected readonly newSource = signal('Treasury');

  // Lock
  protected readonly lockYearId = signal<string | null>(null);
  protected readonly lockReason = signal('');

  protected typeName(type: RateType): string {
    return TYPE_LABEL[type];
  }

  protected async addRate(): Promise<void> {
    await this.run(async () => {
      const r = await data(
        this.api.createExchangeRate({
          body: {
            rateType: this.newType(),
            quoteCurrency: this.newQuote(),
            rate: this.newRate(),
            effectiveDate: this.newDate(),
            source: this.newSource(),
            ...(this.newType() === 'plan' && this.newYearId()
              ? { fiscalYearId: this.newYearId()! }
              : {}),
          },
        }),
      );
      this.notice.set(
        `${TYPE_LABEL[r.rateType]} rate ${r.baseCurrency}/${r.quoteCurrency} ${r.rate} from ${r.effectiveDate} added.`,
      );
      this.adding.set(false);
      this.rates.reload();
    });
  }

  protected async lock(): Promise<void> {
    await this.run(async () => {
      const r = await data(
        this.api.lockPlanRates({
          params: { fiscalYearId: this.lockYearId()! },
          body: { reason: this.lockReason() },
        }),
      );
      this.notice.set(
        `${r.fiscalYearLabel} plan rates are locked (${r.lockedRates} rate(s)). They can no longer change.`,
      );
      this.lockYearId.set(null);
      this.groupCalendar.reload();
      this.rates.reload();
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    this.notice.set(null);
    try {
      await action();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
