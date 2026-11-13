import { DatePipe, DecimalPipe } from '@angular/common';
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
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { LoadState } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { RuleEffectTag, RuleStatusTag } from './rule-tags';
import { RulesTabs } from './rules-tabs';

/** Screen 067: every rule in priority order, with its outcome, scope and any conflict. */
@Component({
  selector: 'bf-rules-list-page',
  imports: [
    DatePipe,
    DecimalPipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    RouterLink,
    RuleEffectTag,
    RuleStatusTag,
    RulesTabs,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">All rules</h1>
        <p class="bf-page__subtitle">
          Rules are checked from the highest priority down. When two rules disagree the stricter
          outcome wins: block, then hold, then approvals, then a warning, then goes through.
        </p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button routerLink="/admin/rules/simulate">Test a request</a>
      </div>
    </header>
    <bf-rules-tabs current="list" />
    @if (failure()) {
      <sat-banner variant="important"
        ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
      >
    }
    <section class="bf-card" aria-labelledby="rules-title">
      <div class="bf-card__header">
        <h2 class="bf-card__title" id="rules-title">
          {{ rows().length | number }} {{ rows().length === 1 ? 'rule' : 'rules' }}
        </h2>
      </div>
      <div class="bf-filters">
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Search rule name or code</mat-label>
          <input matInput [ngModel]="q()" (ngModelChange)="q.set($event)" name="q" />
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Status</mat-label>
          <mat-select [ngModel]="status()" (ngModelChange)="status.set($event)" name="status">
            <mat-option value="">Any status</mat-option>
            <mat-option value="active">Active</mat-option>
            <mat-option value="draft">Draft</mat-option>
            <mat-option value="scheduled">Starts later</mat-option>
            <mat-option value="retired">Retired</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Outcome</mat-label>
          <mat-select [ngModel]="effect()" (ngModelChange)="effect.set($event)" name="effect">
            <mat-option value="">Any outcome</mat-option>
            <mat-option value="block">Block</mat-option>
            <mat-option value="freeze">Hold</mat-option>
            <mat-option value="require_approval">Needs approval</mat-option>
            <mat-option value="warn">Warn</mat-option>
            <mat-option value="auto_approve">Goes through</mat-option>
          </mat-select>
        </mat-form-field>
      </div>
      <bf-load-state
        [loading]="list.isLoading() && !list.hasValue()"
        [error]="list.error()"
        what="rules"
        shape="table"
        (retry)="list.reload()"
      />
      @if (list.hasValue()) {
        @if (rows().length) {
          <sat-banner variant="info" class="bf-banner">
            <sat-banner-message>
              When rules disagree the strictest outcome wins: block, then hold, then approvals, then
              a warning, then goes through. Equal outcomes are settled by priority.
            </sat-banner-message>
          </sat-banner>
          <div class="bf-table-scroll">
            <table class="bf-split-table bf-table--stack" aria-label="Rules">
              <thead>
                <tr>
                  <th scope="col" class="bf-num">Priority</th>
                  <th scope="col">Rule</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Applies to</th>
                  <th scope="col">Status</th>
                  <th scope="col" class="bf-num">Matches (30 days)</th>
                  <th scope="col">From</th>
                </tr>
              </thead>
              <tbody>
                @for (r of rows(); track r.id) {
                  <tr>
                    <td class="bf-num">{{ r.priority }}</td>
                    <td data-label="Rule">
                      <a [routerLink]="['/admin/rules', r.id]" class="bf-cell__primary">{{
                        r.code
                      }}</a>
                      <span class="bf-cell__secondary">{{ r.name }}</span>
                      @if (r.conflictsWith.length) {
                        <span class="bf-conflict">
                          <sat-status-tag status="important-loud"
                            ><mat-icon svgIcon="error" aria-hidden="true" />Conflicts with
                            {{ r.conflictsWith.join(', ') }}</sat-status-tag
                          >
                        </span>
                      }
                    </td>
                    <td data-label="Outcome"><bf-rule-effect [effect]="r.effect" /></td>
                    <td data-label="Applies to">{{ sentence(r.scopeSummary) }}</td>
                    <td class="bf-nowrap" data-label="Status">
                      <bf-rule-status [status]="r.status" />
                      @if (r.draftVersion !== null) {
                        <span class="bf-cell__secondary">Draft v{{ r.draftVersion }} waiting</span>
                      }
                    </td>
                    <td class="bf-num" data-label="Matches (30 days)">
                      {{ r.matches30d | number }}
                    </td>
                    <td class="bf-nowrap" data-label="From">
                      @if (r.validFrom) {
                        {{ r.validFrom | date: 'd MMM y' }}
                      } @else {
                        —
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <sat-empty-state>
            <h3 satEmptyStateHeadline>No rule matches those filters</h3>
            <p satEmptyStateDescription>Clear the search or choose a different status.</p>
          </sat-empty-state>
        }
      }
    </section>
  `,
  styles: `
    .bf-conflict {
      display: block;
      margin-top: 4px;
    }
    .bf-nowrap {
      white-space: nowrap;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RulesListPage {
  private readonly api = injectApi();
  private readonly snack = inject(MatSnackBar);
  protected readonly valueOf = valueOf;
  protected readonly q = signal('');
  protected readonly status = signal('');
  protected readonly effect = signal('');
  protected readonly failure = signal('');
  protected readonly list = resource({ loader: () => data(this.api.listRules({})) });

  // Filtering happens on the loaded list so typing never re-queries the API.
  protected readonly rows = computed(() => {
    const term = this.q().trim().toLowerCase();
    return (valueOf(this.list)?.items ?? []).filter((r) => {
      if (this.status() && r.status !== this.status()) return false;
      if (this.effect() && r.effect !== this.effect()) return false;
      return !term || `${r.code} ${r.name}`.toLowerCase().includes(term);
    });
  });

  protected sentence(text: string): string {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  }

  protected notify(message: string): void {
    this.snack.open(message, undefined, { duration: 4000 });
  }

  protected fail(e: unknown): void {
    this.failure.set(errorMessage(e));
  }
}
