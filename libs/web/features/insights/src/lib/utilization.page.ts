import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { ActivatedRoute, Router } from '@angular/router';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, Money } from '@bf/web/ui';
import { SAT_NAVIGATION_TABS_IMPORTS } from '@hylandsoftware/satori-ui/navigation-tabs';
import { data, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

type GroupBy = 'location' | 'team' | 'budget';

/** Screen 82: budget utilization by location or team in USD (child allocations counted once), with Export only. */
@Component({
  selector: 'bf-utilization-page',
  imports: [
    DateTimePipe,
    LoadState,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    Money,
    SAT_NAVIGATION_TABS_IMPORTS,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Budget utilization</h1>
        <p class="bf-page__subtitle">
          Earmarked, pending, approved and actual against authorized, in
          {{ report.value()?.currency ?? 'USD' }} ·
          <span data-testid="relative-time">{{
            report.value()?.generatedAt | bfDateTime: session.timezone()
          }}</span>
        </p>
      </div>
      <div class="bf-page__actions">
        <button mat-stroked-button type="button" [matMenuTriggerFor]="exportMenu">
          <mat-icon svgIcon="download" />Export
        </button>
        <mat-menu #exportMenu="matMenu">
          <button mat-menu-item type="button" (click)="exportCsv()">CSV</button>
          <button mat-menu-item type="button" (click)="print()">PDF (print)</button>
        </mat-menu>
      </div>
    </header>
    <sat-navigation-tabs class="bf-tabs" aria-label="Group by">
      <a
        satNavigationTab
        [active]="groupBy() === 'location'"
        (click)="set('location')"
        (keydown.enter)="set('location')"
        tabindex="0"
        >By location</a
      >
      <a
        satNavigationTab
        [active]="groupBy() === 'team'"
        (click)="set('team')"
        (keydown.enter)="set('team')"
        tabindex="0"
        >By team</a
      >
      <a
        satNavigationTab
        [active]="groupBy() === 'budget'"
        (click)="set('budget')"
        (keydown.enter)="set('budget')"
        tabindex="0"
        >By budget</a
      >
    </sat-navigation-tabs>
    <section class="bf-card" aria-labelledby="util-title">
      <div class="bf-card__header">
        <h2 class="bf-card__title" id="util-title">Utilization</h2>
        <p class="bf-card__hint">
          Authorized is net of what each budget allocated to its children, so allocations count
          once.
        </p>
      </div>
      <bf-load-state
        [loading]="report.isLoading() && !report.hasValue()"
        [error]="report.error()"
        what="utilization"
        (retry)="report.reload()"
      />
      @if (valueOf(report); as r) {
        <div class="bf-table-scroll">
          <table class="bf-split-table" aria-label="Utilization">
            <thead>
              <tr>
                <th>{{ label() }}</th>
                <th class="bf-num">Budgets</th>
                <th class="bf-num">Authorized</th>
                <th class="bf-num">Earmarked</th>
                <th class="bf-num">Pending</th>
                <th class="bf-num">Approved</th>
                <th class="bf-num">Actual</th>
                <th class="bf-num">Available</th>
                <th>Used</th>
              </tr>
            </thead>
            <tbody>
              @for (row of r.rows; track row.name) {
                <tr>
                  <td>{{ row.name }}</td>
                  <td class="bf-num">{{ row.budgets }}</td>
                  <td class="bf-num">
                    <bf-money
                      [amountMinor]="row.authorized.amountMinor"
                      [currency]="row.authorized.currency"
                    />
                  </td>
                  <td class="bf-num">
                    <bf-money [amountMinor]="row.held.amountMinor" [currency]="row.held.currency" />
                  </td>
                  <td class="bf-num">
                    <bf-money
                      class="bf-amount--pending"
                      [amountMinor]="row.pending.amountMinor"
                      [currency]="row.pending.currency"
                    />
                  </td>
                  <td class="bf-num">
                    <bf-money
                      [amountMinor]="row.committed.amountMinor"
                      [currency]="row.committed.currency"
                    />
                  </td>
                  <td class="bf-num">
                    <bf-money
                      [amountMinor]="row.actual.amountMinor"
                      [currency]="row.actual.currency"
                    />
                  </td>
                  <td class="bf-num">
                    <bf-money
                      [amountMinor]="row.available.amountMinor"
                      [currency]="row.available.currency"
                    />
                  </td>
                  <td>
                    <span class="bf-cell__primary"
                      >{{ (row.utilizationBps / 100).toFixed(1) }}%</span
                    >
                    <span
                      class="bf-progress"
                      role="img"
                      [attr.aria-label]="(row.utilizationBps / 100).toFixed(1) + '% used'"
                      ><span
                        class="bf-progress__fill"
                        [style.width.%]="min(row.utilizationBps / 100, 100)"
                      ></span
                    ></span>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="9">No budgets you can see.</td>
                </tr>
              }
              <tr class="bf-total">
                <td>{{ r.totals.name }}</td>
                <td class="bf-num">{{ r.totals.budgets }}</td>
                <td class="bf-num">
                  <bf-money
                    [amountMinor]="r.totals.authorized.amountMinor"
                    [currency]="r.totals.authorized.currency"
                  />
                </td>
                <td class="bf-num">
                  <bf-money
                    [amountMinor]="r.totals.held.amountMinor"
                    [currency]="r.totals.held.currency"
                  />
                </td>
                <td class="bf-num">
                  <bf-money
                    [amountMinor]="r.totals.pending.amountMinor"
                    [currency]="r.totals.pending.currency"
                  />
                </td>
                <td class="bf-num">
                  <bf-money
                    [amountMinor]="r.totals.committed.amountMinor"
                    [currency]="r.totals.committed.currency"
                  />
                </td>
                <td class="bf-num">
                  <bf-money
                    [amountMinor]="r.totals.actual.amountMinor"
                    [currency]="r.totals.actual.currency"
                  />
                </td>
                <td class="bf-num">
                  <bf-money
                    [amountMinor]="r.totals.available.amountMinor"
                    [currency]="r.totals.available.currency"
                  />
                </td>
                <td>{{ (r.totals.utilizationBps / 100).toFixed(1) }}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UtilizationPage {
  private readonly api = injectApi();
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly groupBy = signal<GroupBy>(
    (this.route.snapshot.queryParamMap.get('groupBy') as GroupBy) ?? 'location',
  );
  protected readonly report = resource({
    params: () => ({ groupBy: this.groupBy() }),
    loader: ({ params }) => data(this.api.getUtilization({ query: params })),
  });
  protected readonly label = computed(
    () => ({ location: 'Location', team: 'Team', budget: 'Budget' })[this.groupBy()],
  );

  protected min(a: number, b: number): number {
    return Math.min(a, b);
  }

  protected set(g: GroupBy): void {
    this.groupBy.set(g);
    void this.router.navigate([], { queryParams: { groupBy: g }, replaceUrl: true });
  }

  protected exportCsv(): void {
    const r = valueOf(this.report);
    if (!r) return;
    const major = (m: { amountMinor: number }) => (m.amountMinor / 100).toFixed(2);
    const lines = [
      [
        this.label(),
        'Budgets',
        'Authorized',
        'Earmarked',
        'Pending',
        'Approved',
        'Actual',
        'Available',
        'Used %',
        'Currency',
      ],
    ];
    for (const row of [...r.rows, r.totals])
      lines.push([
        row.name,
        String(row.budgets),
        major(row.authorized),
        major(row.held),
        major(row.pending),
        major(row.committed),
        major(row.actual),
        major(row.available),
        (row.utilizationBps / 100).toFixed(1),
        r.currency,
      ]);
    const csv = lines
      .map((l) =>
        l.map((v) => `"${(/^[=+\-@]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`).join(','),
      )
      .join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `utilization-by-${this.groupBy()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  protected print(): void {
    window.print();
  }
}
