import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { LoadState } from '@bf/web/ui';
import { SatAvatar } from '@hylandsoftware/satori-ui/avatar';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, injectApi, valueOf } from './api';
import { RulesTabs } from './rules-tabs';

/** Screen 070: the approval steps each kind of request goes through, and when each step applies. */
@Component({
  selector: 'bf-routing-page',
  imports: [
    DatePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    RulesTabs,
    SAT_BANNER_IMPORTS,
    SatAvatar,
    SatStatusTag,
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
      shape="table"
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
              @for (r of valueOf(routes)?.items ?? []; track r.requestKind) {
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
            <p class="bf-card__hint">In force from {{ route.validFrom | date: 'd MMM y' }}.</p>
            <mat-button-toggle-group
              hideSingleSelectionIndicator
              aria-label="How to show the steps"
              [value]="layout()"
              (change)="layout.set($event.value)"
            >
              <mat-button-toggle value="steps">Steps</mat-button-toggle>
              <mat-button-toggle value="list">List</mat-button-toggle>
            </mat-button-toggle-group>
          </div>
          @if (layout() === 'steps') {
            <ol class="bf-steps" aria-label="Approval steps in order">
              @for (s of route.steps; track s.stepNo) {
                <li class="bf-step">
                  <sat-avatar size="28" category="purple" [initials]="'' + s.stepNo" />
                  <div class="bf-step__body">
                    <p class="bf-step__who">{{ s.label }}</p>
                    <p class="bf-step__when">{{ s.conditionLabel ?? 'Always' }}</p>
                    <p class="bf-step__meta">
                      <span class="bf-nowrap">{{ decideBy(s.slaBusinessHours) }} to decide</span>
                      ·
                      {{ order(s) }}
                    </p>
                  </div>
                  @if (s.applyDoa) {
                    <sat-status-tag status="info" class="bf-nowrap"
                      ><mat-icon svgIcon="shield" aria-hidden="true" />Approval limit
                      applies</sat-status-tag
                    >
                  }
                </li>
              }
            </ol>
          } @else {
            <div class="bf-table-scroll">
              <table class="bf-split-table bf-table--stack" aria-label="Approval steps">
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
                      <td class="bf-cell__primary" data-label="Who decides">{{ s.label }}</td>
                      <td data-label="When this step applies">
                        {{ s.conditionLabel ?? 'Always' }}
                      </td>
                      <td data-label="Order">{{ order(s) }}</td>
                      <td class="bf-num" data-label="Time to decide">
                        {{ decideBy(s.slaBusinessHours) }}
                      </td>
                      <td data-label="Approval limit applies">{{ s.applyDoa ? 'Yes' : 'No' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
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
      min-width: min(22rem, 100%);
    }
    .bf-nowrap,
    .bf-split-table td.bf-num {
      white-space: nowrap;
    }
    .bf-steps {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin: 0;
      padding: 8px 20px 16px;
      list-style: none;
    }
    .bf-step {
      position: relative;
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      gap: 12px;
      padding: 16px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-medium);
      background: var(--mat-sys-surface-container-lowest);
    }
    /* The connector between two steps reads as "then". */
    .bf-step + .bf-step::before {
      content: '';
      position: absolute;
      inset-block-start: -13px;
      inset-inline-start: 29px;
      width: 2px;
      height: 12px;
      background: var(--mat-sys-outline-variant);
    }
    .bf-step__body {
      flex: 1 1 16rem;
      min-width: 0;
    }
    .bf-step__body p {
      margin: 0;
    }
    .bf-step__who {
      font: var(--mat-sys-title-small);
    }
    .bf-step__when {
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-body-medium);
    }
    .bf-step__meta {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoutingPage {
  private readonly api = injectApi();
  protected readonly valueOf = valueOf;
  protected readonly kind = signal('spending');
  protected readonly layout = signal<'steps' | 'list'>('steps');
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
