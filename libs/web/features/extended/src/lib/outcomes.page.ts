import { ChangeDetectionStrategy, Component, computed, inject, resource } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { data, injectApi, valueOf } from './api';
import { Suppressible } from './figures';
import { LoadState } from './load-state';

/**
 * Screen 015c: pulse, eNPS and retention against participation.
 *
 * Two things this page must never do. It must not let a figure stand for a group small enough to
 * point at a person: where the API suppressed a figure, the cell says "fewer than N" and keeps the
 * group size, instead of going blank (which reads as "no data") or showing a zero (which reads as
 * an answer). And it must not let association read as cause, which is why the note above the
 * figures is permanent rather than dismissible.
 */
@Component({
  selector: 'bf-outcomes-page',
  imports: [
    DateTimePipe,
    LoadState,
    MatIconModule,
    MatTooltipModule,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    Suppressible,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Outcomes</h1>
        <p class="bf-page__subtitle">
          Does the engagement money do any good? Group figures only, never a person.
        </p>
      </div>
      @if (outcomes(); as o) {
        <div class="bf-page__actions">
          <span class="bf-cell__secondary" data-testid="outcomes-as-of">
            As of
            <span data-testid="relative-time">{{ o.asOf | bfDateTime: session.timezone() }}</span>
          </span>
        </div>
      }
    </header>

    <bf-load-state
      [loading]="linkage.isLoading() && !linkage.hasValue()"
      [error]="linkage.error()"
      what="outcome figures"
      (retry)="linkage.reload()"
    />

    @if (outcomes(); as o) {
      <sat-banner variant="info" data-testid="association-note">
        <sat-banner-message>{{ o.associationNote }}</sat-banner-message>
      </sat-banner>

      <p class="bf-cell__secondary" data-testid="thresholds">
        Survey figures need at least {{ o.thresholds.surveyResponses }} responses and retention
        figures at least {{ o.thresholds.retentionGroup }} people. Below that BudgetFlow drops the
        figure rather than showing it.
      </p>

      @if (!o.enoughData) {
        <sat-empty-state data-testid="outcomes-empty">
          <h2 satEmptyStateHeadline>
            Outcomes appear after some attendance and at least one survey
          </h2>
          <p satEmptyStateDescription>
            Once organizers mark attendance and a post-event survey has run, the figures build up
            here.
          </p>
        </sat-empty-state>
      } @else {
        <div class="bf-kpis">
          <article class="bf-card bf-kpi" data-testid="kpi-pulse">
            <h2 class="bf-kpi__title">Average event pulse</h2>
            <bf-suppressible
              class="bf-kpi__value"
              [figure]="o.averagePulse"
              kind="rating"
              noun="responses"
              testId="pulse"
            />
          </article>
          <article class="bf-card bf-kpi" data-testid="kpi-enps">
            <h2 class="bf-kpi__title">eNPS</h2>
            <bf-suppressible
              class="bf-kpi__value"
              [figure]="o.enps"
              kind="enps"
              noun="responses"
              testId="enps"
            />
            <p class="bf-cell__secondary">
              <span
                [matTooltip]="
                  'Survey question: How likely are you to recommend Hyland as a place to work?'
                "
                tabindex="0"
                >Promoters minus detractors.</span
              >
            </p>
          </article>
          <article class="bf-card bf-kpi" data-testid="kpi-reach">
            <h2 class="bf-kpi__title">Reach</h2>
            @if (o.reachBps !== null) {
              <span class="bf-kpi__value">{{ (o.reachBps / 100).toFixed(1) }}%</span>
              <p class="bf-cell__secondary">
                of eligible employees took part in at least one event
              </p>
            } @else {
              <span class="bf-kpi__value bf-kpi__value--none">Not available</span>
              <p class="bf-cell__secondary">No events in this fiscal year yet</p>
            }
          </article>
        </div>

        <section class="bf-card bf-section" data-testid="categories">
          <h2 class="bf-section__title">Event outcomes by category</h2>
          <table class="bf-split-table" aria-label="Event outcomes by category">
            <thead>
              <tr>
                <th>Category</th>
                <th class="bf-num">Events</th>
                <th class="bf-num">Attendance rate</th>
                <th>Average pulse</th>
              </tr>
            </thead>
            <tbody>
              @for (row of o.categories; track row.categoryCode) {
                <tr [attr.data-testid]="'category-' + row.categoryCode">
                  <td>{{ row.categoryName }}</td>
                  <td class="bf-num">{{ row.eventCount }}</td>
                  <td class="bf-num">
                    @if (row.attendanceRateBps !== null) {
                      {{ (row.attendanceRateBps / 100).toFixed(0) }}%
                    } @else {
                      <span class="bf-cell__secondary">No invitations yet</span>
                    }
                  </td>
                  <td>
                    <bf-suppressible
                      [figure]="row.pulse"
                      kind="rating"
                      noun="responses"
                      [testId]="'category-pulse-' + row.categoryCode"
                    />
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="4">No events have been held in this fiscal year.</td>
                </tr>
              }
            </tbody>
          </table>
        </section>

        <section class="bf-card bf-section" data-testid="retention">
          <h2 class="bf-section__title">Retention by participation band</h2>
          @if (!o.retentionAvailable) {
            <p data-testid="retention-not-available">
              Retention cohorts span the whole company, so they are shown to roles that read people
              company-wide. Your view covers pulse and eNPS for your region.
            </p>
          } @else {
            <p class="bf-cell__secondary">
              Still employed at the end of the fiscal year, by how many events a person attended.
              Reading down this table shows an association, not a cause.
            </p>
            <table class="bf-split-table" aria-label="Retention by participation band">
              <thead>
                <tr>
                  <th>Events attended</th>
                  <th>Still employed</th>
                </tr>
              </thead>
              <tbody>
                @for (band of o.retentionBands; track band.band) {
                  <tr [attr.data-testid]="'retention-' + band.band">
                    <td>{{ band.bandLabel }}</td>
                    <td>
                      <bf-suppressible
                        [figure]="band.retention"
                        kind="percent"
                        noun="people"
                        [testId]="'retention-value-' + band.band"
                      />
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </section>
      }
    }
  `,
  styles: `
    .bf-kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
      margin-top: 12px;
    }
    .bf-kpi {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 16px;
    }
    .bf-kpi__title {
      margin: 0;
      font: var(--mat-sys-label-large);
      color: var(--mat-sys-on-surface-variant);
    }
    .bf-kpi__value {
      font: var(--mat-sys-headline-small);
    }
    .bf-kpi__value--none {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-title-medium);
    }
    .bf-kpi p {
      margin: 0;
    }
    .bf-section {
      padding: 16px;
      margin-top: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .bf-section__title {
      margin: 0;
      font: var(--mat-sys-title-small);
    }
    .bf-section p {
      margin: 0;
    }
    @media (max-width: 834px) {
      .bf-split-table {
        display: block;
        overflow-x: auto;
      }
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OutcomesPage {
  private readonly api = injectApi();
  protected readonly session = inject(SessionStore);

  protected readonly linkage = resource({ loader: () => data(this.api.getOutcomeLinkage({})) });
  protected readonly outcomes = computed(() => valueOf(this.linkage));
}
