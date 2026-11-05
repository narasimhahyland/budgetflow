import { ChangeDetectionStrategy, Component, computed, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { data, injectApi, valueOf } from './api';
import { LoadState } from './load-state';
import { RulesTabs } from './rules-tabs';

/** Screen 070: the approval steps each kind of request goes through, and when each step applies. */
@Component({
  selector: 'bf-routing-page',
  imports: [
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
    RulesTabs,
    SAT_BANNER_IMPORTS,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Approval routing</h1>
        <p class="bf-page__subtitle">
          The steps a request goes through, in order. A step is skipped when its condition does not
          apply, and every step still checks the approver's own approval limit.
        </p>
      </div>
    </header>
    <bf-rules-tabs current="routing" />
    <bf-load-state
      [loading]="routes.isLoading() && !routes.hasValue()"
      [error]="routes.error()"
      what="approval routing"
      (retry)="routes.reload()"
    />
    @if (routes.hasValue()) {
      <section class="bf-card" aria-labelledby="kind-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="kind-title">Which requests</h2>
        </div>
        <div class="bf-filters">
          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label>Kind of request</mat-label>
            <mat-select [ngModel]="kind()" (ngModelChange)="kind.set($event)" name="kind">
              @for (r of valueOf(routes)?.items ?? []; track r.id) {
                <mat-option [value]="r.requestKind">{{ r.label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>
      </section>

      @if (selected(); as route) {
        <section class="bf-card" aria-labelledby="steps-title">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="steps-title">
              {{ route.label }} — version {{ route.activeVersion }}
            </h2>
            <p class="bf-card__hint">In force from {{ route.validFrom }}.</p>
          </div>
          <div class="bf-table-scroll">
            <table class="bf-split-table" aria-label="Approval steps">
              <thead>
                <tr>
                  <th scope="col" class="bf-num">Step</th>
                  <th scope="col">Who decides</th>
                  <th scope="col">When this step applies</th>
                  <th scope="col">Order</th>
                  <th scope="col" class="bf-num">Time to decide</th>
                  <th scope="col">Approval limit applies</th>
                </tr>
              </thead>
              <tbody>
                @for (s of route.steps; track s.stepNo) {
                  <tr>
                    <td class="bf-num">{{ s.stepNo }}</td>
                    <td class="bf-cell__primary">{{ s.label }}</td>
                    <td>{{ s.conditionLabel ?? 'Always' }}</td>
                    <td>{{ order(s) }}</td>
                    <td class="bf-num">{{ decideBy(s.slaBusinessHours) }}</td>
                    <td>{{ s.applyDoa ? 'Yes' : 'No' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <div class="bf-card__body">
            <sat-banner variant="info">
              <sat-banner-message>
                A step whose approver does not hold a high enough approval limit passes the decision
                up to the next authority instead of being skipped.
              </sat-banner-message>
            </sat-banner>
          </div>
        </section>
      }
    }
  `,
  styles: `
    /* "Inter-Director Budget Contribution Requests" is the exact term and must not be clipped. */
    .bf-filters mat-form-field {
      min-width: 22rem;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoutingPage {
  private readonly api = injectApi();
  protected readonly valueOf = valueOf;
  protected readonly kind = signal('spending');
  protected readonly routes = resource({ loader: () => data(this.api.listWorkflowRoutes({})) });
  protected readonly selected = computed(() =>
    (valueOf(this.routes)?.items ?? []).find((r) => r.requestKind === this.kind()),
  );

  /**
   * Service levels are stored in hours; the response-times policy screen states the same figures
   * in days, so both screens have to agree on what a day is.
   */
  protected decideBy(hours: number): string {
    const days = Math.round(hours / 24);
    return days >= 1 ? `${days} working ${days === 1 ? 'day' : 'days'}` : `${hours} hours`;
  }

  /** One sentence for how a step runs, instead of two labels that look contradictory. */
  protected order(step: { mode: string; groupRule: string }): string {
    const when =
      step.mode === 'parallel' ? 'Runs alongside other steps' : 'Runs after the step before it';
    const who = step.groupRule === 'all' ? 'everyone named must agree' : 'any one of them decides';
    return `${when}; ${who}.`;
  }
}
