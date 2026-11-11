import { DecimalPipe, LowerCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { BacktestResponse } from '@bf/contracts';
import { Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { RulesTabs } from './rules-tabs';

const CHANGE_TONES: Record<string, 'neutral-quiet' | 'warning' | 'info' | 'important'> = {
  unchanged: 'neutral-quiet',
  stricter: 'warning',
  looser: 'info',
  blocked: 'important',
};

const CHANGE_LABELS: Record<string, string> = {
  unchanged: 'No change',
  stricter: 'Stricter',
  looser: 'Easier',
  blocked: 'Now blocked',
};

/** Screen 077: replay past requests under a draft rule before it is published. */
@Component({
  selector: 'bf-backtest-page',
  imports: [
    DecimalPipe,
    FormsModule,
    LowerCasePipe,
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
    Money,
    RouterLink,
    RulesTabs,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Check against past requests</h1>
        <p class="bf-page__subtitle">
          See how a draft rule would have decided requests that already happened. Nothing is changed
          and no decision is revisited.
        </p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button routerLink="/admin/rules/simulate">Test one request</a>
      </div>
    </header>
    <bf-rules-tabs current="simulate" />
    @if (failure()) {
      <sat-banner variant="important"
        ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
      >
    }
    <section class="bf-card" aria-labelledby="pick-title">
      <div class="bf-card__header">
        <h2 class="bf-card__title" id="pick-title">Which draft to check</h2>
      </div>
      <div class="bf-filters">
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Rule</mat-label>
          <mat-select [ngModel]="ruleId()" (ngModelChange)="ruleId.set($event)" name="ruleId">
            <mat-option value="">Every draft</mat-option>
            @for (r of drafts(); track r.id) {
              <mat-option [value]="r.id">{{ r.code }} {{ r.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>
      <div class="bf-form__actions bf-backtest__actions">
        <button mat-flat-button type="button" [disabled]="busy()" (click)="run()">Run check</button>
      </div>
    </section>

    @if (result(); as r) {
      <dl class="bf-kpis">
        <div class="bf-kpi">
          <dt class="bf-kpi__label">Requests checked</dt>
          <dd class="bf-kpi__value">{{ r.totalEvaluated | number }}</dd>
        </div>
        <div class="bf-kpi">
          <dt class="bf-kpi__label">Decided the same</dt>
          <dd class="bf-kpi__value">{{ r.unchangedCount | number }}</dd>
        </div>
        <div class="bf-kpi">
          <dt class="bf-kpi__label">Would be stricter</dt>
          <dd class="bf-kpi__value">{{ r.stricterCount | number }}</dd>
        </div>
        <div class="bf-kpi">
          <dt class="bf-kpi__label">Would be easier</dt>
          <dd class="bf-kpi__value">{{ r.looserCount | number }}</dd>
        </div>
        <div class="bf-kpi">
          <dt class="bf-kpi__label">Would be blocked</dt>
          <dd class="bf-kpi__value">{{ r.nowBlockedCount | number }}</dd>
        </div>
      </dl>

      <section class="bf-card" aria-labelledby="rows-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="rows-title">
            {{ r.ruleCode }} over {{ r.periodLabel | lowercase }}
          </h2>
          <p class="bf-card__hint">Requests that would change are listed first.</p>
        </div>
        @if (r.items.length) {
          <div class="bf-table-scroll">
            <table
              class="bf-split-table bf-table--stack"
              aria-label="Past requests under the draft rule"
            >
              <thead>
                <tr>
                  <th scope="col">Request</th>
                  <th scope="col">Budget</th>
                  <th scope="col" class="bf-num">Amount</th>
                  <th scope="col">Decided then</th>
                  <th scope="col">Would be decided</th>
                  <th scope="col">Change</th>
                </tr>
              </thead>
              <tbody>
                @for (i of r.items; track i.requestId) {
                  <tr>
                    <td>
                      <span class="bf-cell__primary">{{ i.ref }}</span>
                      <span class="bf-cell__secondary">{{ i.title }}</span>
                    </td>
                    <td data-label="Budget">
                      {{ i.budgetName }}
                      <span class="bf-cell__secondary">{{ i.location }}</span>
                    </td>
                    <td class="bf-num" data-label="Amount">
                      <bf-money
                        [amountMinor]="i.amount.amountMinor"
                        [currency]="i.amount.currency"
                      />
                    </td>
                    <td data-label="Decided then">{{ i.activeOutcome }}</td>
                    <td data-label="Would be decided">{{ i.draftOutcome }}</td>
                    <td data-label="Change">
                      <sat-status-tag [status]="tone(i.changeKind)">{{
                        changeLabel(i.changeKind)
                      }}</sat-status-tag>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <sat-empty-state>
            <h3 satEmptyStateHeadline>No past requests to check</h3>
            <p satEmptyStateDescription>
              There are no decided requests in this period, so there is nothing to compare.
            </p>
          </sat-empty-state>
        }
      </section>
    }
  `,
  styles: `
    .bf-backtest__actions {
      padding-top: 16px;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BacktestPage {
  private readonly api = injectApi();
  private readonly route = inject(ActivatedRoute);
  protected readonly valueOf = valueOf;
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly result = signal<BacktestResponse | null>(null);
  protected readonly ruleId = signal(this.route.snapshot.queryParamMap.get('ruleId') ?? '');
  private readonly list = resource({ loader: () => data(this.api.listRules({})) });

  protected drafts(): { id: string; code: string; name: string }[] {
    return (valueOf(this.list)?.items ?? []).filter((r) => r.draftVersion !== null);
  }

  protected tone(kind: string): 'neutral-quiet' | 'warning' | 'info' | 'important' {
    return CHANGE_TONES[kind] ?? 'neutral-quiet';
  }

  protected changeLabel(kind: string): string {
    return CHANGE_LABELS[kind] ?? kind;
  }

  protected async run(): Promise<void> {
    this.busy.set(true);
    this.failure.set('');
    try {
      const r = await data(
        this.api.runRuleBacktest({
          body: this.ruleId() ? { ruleId: this.ruleId() } : {},
        }),
      );
      this.result.set(r);
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
