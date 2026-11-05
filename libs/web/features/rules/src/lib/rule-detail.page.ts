import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  resource,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import type { RuleVersionView } from '@bf/contracts';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { data, errorMessage, injectApi, valueOf } from './api';
import { conditionText, moneyText } from './conditions';
import { approverList } from './labels';
import { LoadState } from './load-state';
import { RuleEffectTag, RuleStatusTag } from './rule-tags';
import { RulesTabs } from './rules-tabs';

/** Screen 068: one rule in plain English, its draft, its conflicts and what can be done to it. */
@Component({
  selector: 'bf-rule-detail-page',
  imports: [
    DecimalPipe,
    LoadState,
    NgTemplateOutlet,
    MatButtonModule,
    RouterLink,
    RuleEffectTag,
    RuleStatusTag,
    RulesTabs,
    SAT_BANNER_IMPORTS,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">{{ rule()?.code ?? 'Rule' }} {{ rule()?.name ?? '' }}</h1>
        <p class="bf-page__subtitle">
          An active version never changes. Edits open a draft; publishing the draft starts a new
          version from its start date and leaves decisions already made alone.
        </p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button routerLink="/admin/rules/list">All rules</a>
        @if (rule(); as r) {
          <a mat-stroked-button [routerLink]="['/admin/rules', r.id, 'history']">History</a>
          @if (can('publish')) {
            <button mat-flat-button type="button" [disabled]="busy()" (click)="publish()">
              Publish draft
            </button>
          }
        }
      </div>
    </header>
    <bf-rules-tabs current="list" />
    @if (failure()) {
      <sat-banner variant="important"
        ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
      >
    }
    @if (notice()) {
      <sat-banner variant="success"
        ><sat-banner-message>{{ notice() }}</sat-banner-message></sat-banner
      >
    }
    <bf-load-state
      [loading]="detail.isLoading() && !detail.hasValue()"
      [error]="detail.error()"
      what="this rule"
      (retry)="detail.reload()"
    />
    @if (rule(); as r) {
      @if (r.conflicts.length) {
        <sat-banner variant="important">
          <sat-banner-message>
            This draft cannot be published yet. {{ r.conflicts[0].reason }}
          </sat-banner-message>
        </sat-banner>
      }

      <section class="bf-card" aria-labelledby="active-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="active-title">In force now</h2>
          <p class="bf-card__hint">
            @if (r.active) {
              Version {{ r.active.version }}, published by
              {{ r.active.publishedByName ?? 'Finance' }}.
            } @else {
              This rule has never been published.
            }
          </p>
        </div>
        <div class="bf-card__body">
          @if (r.active; as v) {
            <ng-container *ngTemplateOutlet="versionBody; context: { $implicit: v }" />
          } @else {
            <p>Nothing is in force. Publish the draft to start applying this rule.</p>
          }
        </div>
      </section>

      @if (r.draft; as d) {
        <section class="bf-card" aria-labelledby="draft-title">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="draft-title">
              Draft version {{ d.version }} <bf-rule-status status="draft" />
            </h2>
            <p class="bf-card__hint">
              Not in force yet. It would start on {{ d.validFrom }} once published.
            </p>
          </div>
          <div class="bf-card__body">
            <ng-container *ngTemplateOutlet="versionBody; context: { $implicit: d }" />
          </div>
          <div class="bf-form__actions">
            <a mat-stroked-button [routerLink]="['/admin/rules', r.id, 'history']"
              >Compare with the active version</a
            >
            <a
              mat-stroked-button
              routerLink="/admin/rules/backtest"
              [queryParams]="{ ruleId: r.id }"
              >Check against past requests</a
            >
          </div>
        </section>
      }

      @if (r.conflicts.length) {
        <section class="bf-card" aria-labelledby="conflicts-title">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="conflicts-title">Conflicts to resolve</h2>
          </div>
          <div class="bf-table-scroll">
            <table class="bf-split-table" aria-label="Conflicting rules">
              <thead>
                <tr>
                  <th scope="col">Rule</th>
                  <th scope="col" class="bf-num">Priority</th>
                  <th scope="col">Its outcome</th>
                  <th scope="col">Outcome that wins</th>
                  <th scope="col">Why</th>
                </tr>
              </thead>
              <tbody>
                @for (c of r.conflicts; track c.ruleId) {
                  <tr>
                    <td>
                      <a [routerLink]="['/admin/rules', c.ruleId]" class="bf-cell__primary">{{
                        c.ruleCode
                      }}</a>
                      <span class="bf-cell__secondary">{{ c.ruleName }}</span>
                    </td>
                    <td class="bf-num">{{ c.priority }}</td>
                    <td><bf-rule-effect [effect]="c.effect" /></td>
                    <td><bf-rule-effect [effect]="c.winningEffect" /></td>
                    <td>{{ c.reason }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }
    }

    <ng-template #versionBody let-v>
      <dl class="bf-facts">
        <dt>Outcome</dt>
        <dd><bf-rule-effect [effect]="v.effect" /></dd>
        <dt>Priority</dt>
        <dd>{{ v.priority }}</dd>
        <dt>Applies when</dt>
        <dd>
          @for (c of v.conditions.conditions; track $index) {
            <div>{{ conditionText(c) }}</div>
          } @empty {
            <div>Every request in scope.</div>
          }
        </dd>
        <dt>Approvers added</dt>
        <dd>{{ approvers(v) }}</dd>
        <dt>In force</dt>
        <dd>
          {{ v.validFrom }}
          @if (v.validTo) {
            to {{ v.validTo }}
          } @else {
            onwards
          }
        </dd>
        <dt>What requesters are told</dt>
        <dd>{{ v.explanation }}</dd>
        <dt>Matches in the last 30 days</dt>
        <dd>{{ v.matchCount30d | number }}</dd>
      </dl>
    </ng-template>
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RuleDetailPage {
  /** Bound from the route parameter. */
  readonly ruleId = input.required<string>();

  private readonly api = injectApi();
  private readonly snack = inject(MatSnackBar);
  protected readonly conditionText = conditionText;
  protected readonly moneyText = moneyText;
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly notice = signal('');
  protected readonly detail = resource({
    params: () => ({ ruleId: this.ruleId() }),
    loader: ({ params }) => data(this.api.getRule({ params })),
  });
  protected readonly rule = computed(() => valueOf(this.detail));

  protected can(action: string): boolean {
    return (this.rule()?.allowedActions ?? []).includes(action);
  }

  protected approvers(v: RuleVersionView): string {
    return approverList(v.actions.flatMap((a) => a.approvers ?? []));
  }

  protected async publish(): Promise<void> {
    this.busy.set(true);
    this.failure.set('');
    this.notice.set('');
    try {
      await data(this.api.publishRule({ params: { ruleId: this.ruleId() }, body: {} }));
      this.notice.set('The draft is published and applies to new requests from its start date.');
      this.snack.open('Rule published', undefined, { duration: 4000 });
      this.detail.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
