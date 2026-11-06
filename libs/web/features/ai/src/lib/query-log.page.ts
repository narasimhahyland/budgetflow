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
import { MatSelectModule } from '@angular/material/select';
import { AI_FEATURES, AI_OUTCOMES, type AiFeature, type AiOutcome } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { AiLabel, OUTCOME_LABELS, outcomeTone } from './ai-output';
import { AiTabs } from './ai-tabs';
import { data, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

/**
 * Screen 113a, Query log tab: the append-only record of who used which AI feature over which
 * records, what came out, and what a person later confirmed. It holds no question or answer text by
 * design, and the scope column shows the authorization that was applied before anything was read.
 */
@Component({
  selector: 'bf-query-log-page',
  imports: [
    AiLabel,
    AiTabs,
    DateTimePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <div class="bf-title-row">
          <h1 class="bf-page__title">AI query log</h1>
          <bf-ai-label text="AI activity" />
        </div>
        <p class="bf-page__subtitle">
          Every AI call: who asked, which feature, how many records were in scope, what came out and
          what a person confirmed afterwards. Never what anyone typed or what the model wrote.
        </p>
      </div>
    </header>

    <bf-ai-tabs class="bf-tabs" />

    <section class="bf-card" aria-labelledby="log-title">
      <div class="bf-card__header">
        <h2 class="bf-card__title" id="log-title">Entries, newest first</h2>
      </div>
      <div class="bf-filters">
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Feature</mat-label>
          <mat-select [ngModel]="feature()" (ngModelChange)="feature.set($event)">
            <mat-option value="">All features</mat-option>
            @for (f of features; track f) {
              <mat-option [value]="f">{{ f }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Outcome</mat-label>
          <mat-select [ngModel]="outcome()" (ngModelChange)="outcome.set($event)">
            <mat-option value="">All outcomes</mat-option>
            @for (o of outcomes; track o) {
              <mat-option [value]="o">{{ label(o) }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>

      <bf-load-state
        [loading]="log.isLoading() && !log.hasValue()"
        [error]="log.error()"
        what="the AI query log"
        (retry)="log.reload()"
      />

      @if (log.hasValue()) {
        @if (rows().length === 0) {
          <sat-empty-state data-testid="log-empty">
            <h2 satEmptyStateHeadline>No AI activity for these filters</h2>
            <p satEmptyStateDescription>
              Entries appear as people use the AI features that are switched on.
            </p>
          </sat-empty-state>
        } @else {
          <div class="bf-table-scroll">
            <table class="bf-split-table" aria-label="AI query log">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Person</th>
                  <th>Feature</th>
                  <th>Channel</th>
                  <th>Scope applied</th>
                  <th class="bf-num">Records used</th>
                  <th>Outcome</th>
                  <th>Fields sent</th>
                  <th>Model</th>
                  <th class="bf-num">Latency</th>
                  <th>Confirmed by a person</th>
                </tr>
              </thead>
              <tbody>
                @for (e of rows(); track e.id) {
                  <tr [attr.data-testid]="'log-row-' + e.id">
                    <td>
                      <span data-testid="relative-time">{{
                        e.occurredAt | bfDateTime: session.timezone() : 'd MMM y, HH:mm'
                      }}</span>
                    </td>
                    <td>{{ e.actorName ?? 'BudgetFlow' }}</td>
                    <td>{{ e.feature }}</td>
                    <td>{{ e.channel }}</td>
                    <td>
                      <span class="bf-cell__primary">{{ e.scope.action }}</span>
                      <span class="bf-cell__secondary"
                        >{{ e.scope.scope }} · {{ e.scope.permittedCount }} of
                        {{ e.scope.consideredCount }} permitted</span
                      >
                    </td>
                    <td class="bf-num">{{ e.recordsUsed }}</td>
                    <td>
                      <sat-status-tag
                        [status]="tone(e.outcome)"
                        [attr.data-testid]="'outcome-' + e.outcome"
                        >{{ label(e.outcome) }}</sat-status-tag
                      >
                    </td>
                    <td>
                      <span class="bf-cell__secondary">{{
                        e.sentFields.length ? e.sentFields.join(', ') : 'None'
                      }}</span>
                    </td>
                    <td>
                      <span class="bf-cell__secondary">{{ e.modelId }} {{ e.modelVersion }}</span>
                    </td>
                    <td class="bf-num">{{ e.latencyMs }} ms</td>
                    <td>
                      @if (e.appliedResourceType) {
                        <span class="bf-cell__primary"
                          >{{ e.appliedResourceType }} {{ e.appliedResourceId?.slice(0, 8) }}</span
                        >
                        <span class="bf-cell__secondary"
                          >audit entry {{ e.auditEventId?.slice(0, 8) ?? '—' }}</span
                        >
                      } @else {
                        <span class="bf-cell__secondary">Nothing changed</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @if (valueOf(log)?.nextCursor) {
            <div class="bf-form__actions">
              <button
                mat-stroked-button
                type="button"
                (click)="limit.set(limit() + 50)"
                data-testid="show-more"
              >
                Show more
              </button>
            </div>
          }
        }
      }
    </section>

    <sat-banner variant="info" data-testid="log-retention">
      <sat-banner-message>
        The query log is append-only and kept 13 months. It never holds a question, an answer, or
        personal data beyond the record ids the model was given.
      </sat-banner-message>
    </sat-banner>
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QueryLogPage {
  private readonly api = injectApi();
  protected readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly features = AI_FEATURES;
  protected readonly outcomes = AI_OUTCOMES;

  protected readonly feature = signal<'' | AiFeature>('');
  protected readonly outcome = signal<'' | AiOutcome>('');
  protected readonly limit = signal(50);

  protected readonly log = resource({
    params: () => {
      const feature = this.feature();
      const outcome = this.outcome();
      return {
        limit: Math.min(this.limit(), 200),
        ...(feature ? { feature } : {}),
        ...(outcome ? { outcome } : {}),
      };
    },
    loader: ({ params }) => data(this.api.listAiQueryLog({ query: params })),
  });
  protected readonly rows = computed(() => valueOf(this.log)?.items ?? []);

  protected label(outcome: AiOutcome): string {
    return OUTCOME_LABELS[outcome];
  }

  protected tone(outcome: AiOutcome) {
    return outcomeTone(outcome);
  }
}
