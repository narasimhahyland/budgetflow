import { ChangeDetectionStrategy, Component, resource } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { LoadState, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { data, injectApi, valueOf } from './api';
import { approverList } from './labels';
import { RuleEffectTag } from './rule-tags';
import { RulesTabs } from './rules-tabs';

/** Screen 071a: the approval bands by amount, and the templates new rules can start from. */
@Component({
  selector: 'bf-thresholds-page',
  imports: [
    LoadState,
    MatButtonModule,
    Money,
    RouterLink,
    RuleEffectTag,
    RulesTabs,
    SAT_BANNER_IMPORTS,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Approval thresholds and templates</h1>
        <p class="bf-page__subtitle">
          Amount bands decide who has to approve. Bands have to run from zero upward with no gaps
          and no overlaps, so every amount lands in exactly one band.
        </p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button routerLink="/admin/rules/policies/limits">Policy settings</a>
      </div>
    </header>
    <bf-rules-tabs current="policies" />
    <bf-load-state
      [loading]="view.isLoading() && !view.hasValue()"
      [error]="view.error()"
      what="thresholds and templates"
      shape="table"
      (retry)="view.reload()"
    />
    @if (valueOf(view); as v) {
      @for (family of v.families; track family.family) {
        <section class="bf-card" [attr.aria-label]="family.label">
          <div class="bf-card__header">
            <h2 class="bf-card__title">{{ family.label }}</h2>
            <p class="bf-card__hint">
              Generated as rule {{ family.generatedRuleCode }}. Below
              {{ family.remainingPctBelow }}% of the budget left, the
              {{ approver(family.remainingApprover) }} is added whatever the amount.
            </p>
          </div>
          <div class="bf-table-scroll">
            <table
              class="bf-split-table bf-bands bf-table--stack"
              [attr.aria-label]="family.label + ' bands'"
            >
              <colgroup>
                <col class="bf-bands__amount" />
                <col class="bf-bands__amount" />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" class="bf-num">From</th>
                  <th scope="col" class="bf-num">Up to</th>
                  <th scope="col">Who has to approve</th>
                </tr>
              </thead>
              <tbody>
                @for (b of family.bands; track b.minMinor) {
                  <tr>
                    <td class="bf-num">
                      <bf-money [amountMinor]="b.minMinor" currency="USD" />
                    </td>
                    <td class="bf-num" data-label="Up to">
                      @if (b.maxMinor !== null) {
                        <bf-money [amountMinor]="b.maxMinor" currency="USD" />
                      } @else {
                        No upper limit
                      }
                    </td>
                    <td data-label="Who has to approve">{{ approverList(b.approvers) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }

      <section class="bf-card" aria-labelledby="templates-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="templates-title">Templates</h2>
          <p class="bf-card__hint">
            A template fills in a new rule's conditions and outcome; you then adjust the numbers.
          </p>
        </div>
        <div class="bf-table-scroll">
          <table class="bf-split-table bf-table--stack" aria-label="Policy templates">
            <thead>
              <tr>
                <th scope="col">Template</th>
                <th scope="col">What it does</th>
                <th scope="col">Default outcome</th>
                <th scope="col">Used by</th>
              </tr>
            </thead>
            <tbody>
              @for (t of v.templates; track t.code) {
                <tr>
                  <td>
                    <span class="bf-cell__primary">{{ t.name }}</span>
                    <span class="bf-cell__secondary"
                      ><span class="bf-cell__code">{{ t.code }}</span></span
                    >
                  </td>
                  <td data-label="What it does">{{ t.description }}</td>
                  <td data-label="Default outcome">
                    <bf-rule-effect [effect]="t.defaultEffect" />
                  </td>
                  <td data-label="Used by">
                    <span class="bf-codes">
                      @for (code of t.usedByRuleCodes; track code) {
                        <span class="bf-cell__code">{{ code }}</span>
                      } @empty {
                        Not used yet
                      }
                    </span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    }
  `,
  styles: `
    /* Every band table uses the same column widths so the bands line up from table to table. */
    @media (width >= 600px) {
      .bf-bands {
        table-layout: fixed;
      }
      .bf-bands__amount {
        width: 11rem;
      }
    }
    .bf-codes {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 4px;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThresholdsPage {
  private readonly api = injectApi();
  protected readonly valueOf = valueOf;
  protected readonly approverList = approverList;
  protected readonly approver = (k: string) => approverList([k]);
  protected readonly view = resource({
    loader: () => data(this.api.getTemplatesAndThresholds({})),
  });
}
