import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { data, injectApi, valueOf } from './api';
import { LoadState } from './load-state';
import { RuleStatusTag } from './rule-tags';
import { RulesTabs } from './rules-tabs';

/** Screen 078: every version of a rule and a plain-English comparison of any two of them. */
@Component({
  selector: 'bf-rule-history-page',
  imports: [
    DecimalPipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
    RouterLink,
    RuleStatusTag,
    RulesTabs,
    SAT_BANNER_IMPORTS,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Rule history</h1>
        <p class="bf-page__subtitle">
          Every version is kept. Decisions made under an older version keep that version, so the
          record of why something was approved never changes.
        </p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button [routerLink]="['/admin/rules', ruleId()]">Back to the rule</a>
      </div>
    </header>
    <bf-rules-tabs current="list" />
    <bf-load-state
      [loading]="detail.isLoading() && !detail.hasValue()"
      [error]="detail.error()"
      what="this rule"
      (retry)="detail.reload()"
    />
    @if (valueOf(detail); as r) {
      <section class="bf-card" aria-labelledby="versions-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="versions-title">{{ r.code }} versions</h2>
        </div>
        <div class="bf-table-scroll">
          <table class="bf-split-table" aria-label="Rule versions">
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col">Status</th>
                <th scope="col" class="bf-num">Priority</th>
                <th scope="col">In force</th>
                <th scope="col">Published by</th>
                <th scope="col" class="bf-num">Matches</th>
              </tr>
            </thead>
            <tbody>
              @for (v of r.versions; track v.id) {
                <tr>
                  <td class="bf-cell__primary">v{{ v.version }}</td>
                  <td><bf-rule-status [status]="v.status" /></td>
                  <td class="bf-num">{{ v.priority }}</td>
                  <td>{{ v.validFrom }}{{ v.validTo ? ' to ' + v.validTo : ' onwards' }}</td>
                  <td>{{ v.publishedByName ?? 'Not published' }}</td>
                  <td class="bf-num">{{ v.matchCount30d | number }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <section class="bf-card" aria-labelledby="compare-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="compare-title">Compare two versions</h2>
        </div>
        <div class="bf-filters">
          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label>From version</mat-label>
            <mat-select [ngModel]="from()" (ngModelChange)="from.set($event)" name="from">
              @for (v of r.versions; track v.id) {
                <mat-option [value]="v.version">v{{ v.version }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label>To version</mat-label>
            <mat-select [ngModel]="to()" (ngModelChange)="to.set($event)" name="to">
              @for (v of r.versions; track v.id) {
                <mat-option [value]="v.version">v{{ v.version }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>
        <bf-load-state
          [loading]="diff.isLoading() && !diff.hasValue()"
          [error]="diff.error()"
          what="the comparison"
          (retry)="diff.reload()"
        />
        @if (valueOf(diff); as d) {
          <div class="bf-card__body">
            <sat-banner variant="info">
              <sat-banner-message>
                {{ d.decisionsWithToVersion | number }} decision(s) were made while version
                {{ d.toVersion }} was in force. Those decisions keep that version.
              </sat-banner-message>
            </sat-banner>
            <ul class="bf-timeline">
              @for (line of d.summaryLines; track $index) {
                <li>{{ line.text }}</li>
              }
            </ul>
          </div>
        }
      </section>
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RuleHistoryPage {
  readonly ruleId = input.required<string>();

  private readonly api = injectApi();
  protected readonly valueOf = valueOf;
  protected readonly from = signal<number | null>(null);
  protected readonly to = signal<number | null>(null);
  protected readonly detail = resource({
    params: () => ({ ruleId: this.ruleId() }),
    loader: ({ params }) => data(this.api.getRule({ params })),
  });

  /** Defaults to the two newest versions until the reader picks a pair. */
  private readonly pair = computed(() => {
    const versions = valueOf(this.detail)?.versions ?? [];
    if (!versions.length) return null;
    return {
      fromVersion: this.from() ?? versions[Math.min(1, versions.length - 1)].version,
      toVersion: this.to() ?? versions[0].version,
    };
  });

  protected readonly diff = resource({
    params: () => {
      const pair = this.pair();
      return pair ? { ruleId: this.ruleId(), ...pair } : undefined;
    },
    loader: ({ params }) =>
      data(
        this.api.compareRuleVersions({
          params: { ruleId: params.ruleId },
          query: { fromVersion: params.fromVersion, toVersion: params.toVersion },
        }),
      ),
  });
}
