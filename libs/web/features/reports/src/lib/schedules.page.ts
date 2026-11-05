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
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import {
  REPORT_FORMATS,
  SCHEDULE_FREQUENCIES,
  type ReportFormat,
  type ReportId,
  type ReportSchedule,
  type ScheduleFrequency,
  type ScheduleRun,
} from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

const FREQUENCY_LABELS: Record<ScheduleFrequency, string> = {
  daily_weekdays: 'Every weekday',
  weekly: 'Weekly',
  monthly: 'Monthly',
  monthly_after_close: 'Monthly, after the close',
};
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
type ScheduleRunStatus = ScheduleRun['status'];

const RUN_STATUS_LABELS: Record<ScheduleRunStatus, string> = {
  queued: 'Queued',
  delivered: 'Delivered',
  partly_delivered: 'Partly delivered',
  failed: 'Failed',
};

/**
 * Screen 091: scheduled report delivery and the export record. A delivery carries the headline
 * figures and a sign-in link — BudgetFlow does not attach a file, and the screen says so rather than
 * promising a download that never arrives.
 */
@Component({
  selector: 'bf-report-schedules-page',
  imports: [
    DateTimePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Scheduled reports</h1>
        <p class="bf-page__subtitle">
          Deliveries run with their owner's access. A recipient who cannot see the data is skipped.
        </p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button routerLink="/reports">
          <mat-icon svgIcon="bar_chart" />All reports
        </a>
        <button
          mat-flat-button
          type="button"
          [disabled]="!canSchedule()"
          (click)="creating.set(!creating())"
        >
          <mat-icon svgIcon="plus_small" aria-hidden="true" />New schedule
        </button>
      </div>
    </header>

    <sat-banner status="info" data-testid="delivery-note">
      <span satBannerTitle>Deliveries carry figures, not files</span>
      <span satBannerDescription>
        Email and chat deliveries carry the headline figures and a sign-in link. BudgetFlow records
        the export for audit and expires it after 7 days, but does not produce a file to download
        yet.
      </span>
    </sat-banner>

    @if (notice(); as text) {
      <sat-banner status="success" data-testid="schedule-notice">
        <span satBannerTitle>{{ text }}</span>
      </sat-banner>
    }
    @if (failure(); as text) {
      <sat-banner status="error" data-testid="schedule-failure">
        <span satBannerTitle>{{ text }}</span>
      </sat-banner>
    }

    @if (creating()) {
      <section class="bf-card" aria-labelledby="new-schedule-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="new-schedule-title">New schedule</h2>
          <p class="bf-card__hint">
            Pick at least one format and at least one recipient or channel.
          </p>
        </div>
        <div class="bf-form">
          <mat-form-field appearance="outline">
            <mat-label>Name</mat-label>
            <input matInput [(ngModel)]="name" maxlength="120" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Report</mat-label>
            <mat-select [(ngModel)]="reportId">
              @for (r of reports(); track r.reportId) {
                <mat-option [value]="r.reportId">{{ r.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Formats</mat-label>
            <mat-select [(ngModel)]="formats" multiple>
              @for (f of allFormats; track f) {
                <mat-option [value]="f">{{ f.toUpperCase() }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>How often</mat-label>
            <mat-select [(ngModel)]="frequency">
              @for (f of allFrequencies; track f) {
                <mat-option [value]="f">{{ frequencyLabel(f) }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          @if (frequency() === 'weekly') {
            <mat-form-field appearance="outline">
              <mat-label>Day of the week</mat-label>
              <mat-select [(ngModel)]="weekday">
                @for (d of weekdays; track d; let i = $index) {
                  <mat-option [value]="i">{{ d }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          }
          @if (frequency() === 'monthly' || frequency() === 'monthly_after_close') {
            <mat-form-field appearance="outline">
              <mat-label>Day of the month</mat-label>
              <input matInput type="number" min="1" max="28" [(ngModel)]="dayOfMonth" />
            </mat-form-field>
          }
          <mat-form-field appearance="outline">
            <mat-label>Send at</mat-label>
            <input matInput type="time" [(ngModel)]="sendTime" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Timezone</mat-label>
            <input matInput [(ngModel)]="timezone" maxlength="60" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="bf-form__wide">
            <mat-label>Recipients</mat-label>
            <mat-select [(ngModel)]="recipientIds" multiple [disabled]="!people().length">
              @for (p of people(); track p.id) {
                <mat-option [value]="p.id">{{ p.displayName }} · {{ p.email }}</mat-option>
              }
            </mat-select>
            @if (!people().length) {
              <mat-hint>No directory access, so schedule to a chat channel instead.</mat-hint>
            } @else {
              <mat-hint>External addresses are refused; only the directory is offered.</mat-hint>
            }
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Chat channel (optional)</mat-label>
            <input matInput [(ngModel)]="channel" placeholder="#india-leads" maxlength="80" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="bf-form__wide">
            <mat-label>Message (optional)</mat-label>
            <input matInput [(ngModel)]="message" maxlength="500" />
          </mat-form-field>
        </div>
        <div class="bf-form__actions">
          <button
            mat-flat-button
            type="button"
            [disabled]="busy() || !canSubmit()"
            (click)="create()"
          >
            Create schedule
          </button>
          <button mat-stroked-button type="button" (click)="creating.set(false)">Cancel</button>
        </div>
      </section>
    }

    <bf-load-state
      [loading]="schedules.isLoading() && !schedules.hasValue()"
      [error]="schedules.error()"
      what="scheduled reports"
      (retry)="schedules.reload()"
    />

    @if (valueOf(schedules); as list) {
      @if (list.items.length) {
        @for (schedule of list.items; track schedule.id) {
          <section class="bf-card" [attr.aria-labelledby]="'schedule-' + schedule.id">
            <div class="bf-card__header">
              <div>
                <h2 class="bf-card__title" [id]="'schedule-' + schedule.id">
                  {{ schedule.name }}
                  @if (schedule.active) {
                    <sat-status-tag status="success">Active</sat-status-tag>
                  } @else {
                    <sat-status-tag status="neutral-quiet">Paused</sat-status-tag>
                  }
                </h2>
                <p class="bf-card__hint">
                  {{ schedule.reportName }} · {{ summary(schedule) }} ·
                  {{ formatList(schedule.formats) }} · owned by
                  {{ schedule.ownerName ?? 'someone who has left' }}
                </p>
              </div>
              <div class="bf-row-actions">
                <button
                  mat-stroked-button
                  type="button"
                  [disabled]="busy()"
                  (click)="runNow(schedule)"
                >
                  Run now
                </button>
                <button
                  mat-stroked-button
                  type="button"
                  [disabled]="busy()"
                  (click)="toggle(schedule)"
                >
                  {{ schedule.active ? 'Pause' : 'Resume' }}
                </button>
                <button
                  mat-stroked-button
                  type="button"
                  [disabled]="busy()"
                  (click)="remove(schedule)"
                >
                  Delete
                </button>
                <button
                  mat-stroked-button
                  type="button"
                  (click)="toggleRuns(schedule.id)"
                  [attr.aria-expanded]="openRuns() === schedule.id"
                >
                  Delivery history
                </button>
              </div>
            </div>

            @if (schedule.pausedReason) {
              <sat-banner class="bf-banner" status="warning">
                <span satBannerTitle>Paused: {{ schedule.pausedReason }}</span>
              </sat-banner>
            }

            <dl class="bf-facts">
              <div>
                <dt>Next run</dt>
                <dd>
                  @if (schedule.nextRunAt) {
                    <span data-testid="relative-time">{{
                      schedule.nextRunAt | bfDateTime: session.timezone()
                    }}</span>
                  } @else {
                    Not scheduled
                  }
                </dd>
              </div>
              <div>
                <dt>Last run</dt>
                <dd>
                  @if (schedule.lastRunAt) {
                    <span data-testid="relative-time">{{
                      schedule.lastRunAt | bfDateTime: session.timezone()
                    }}</span>
                    @if (schedule.lastRunStatus) {
                      · {{ runStatusLabel(schedule.lastRunStatus) }}
                    }
                  } @else {
                    Never
                  }
                </dd>
              </div>
              <div>
                <dt>Chat channels</dt>
                <dd>
                  @if (schedule.channels.length) {
                    {{ channelList(schedule) }}
                  } @else {
                    None
                  }
                </dd>
              </div>
            </dl>

            <div class="bf-section">
              <h3 class="bf-section__title">Recipients</h3>
              <ul class="bf-recipients">
                @for (r of schedule.recipients; track r.personId) {
                  <li>
                    <span>{{ r.name }} · {{ r.email }}</span>
                    @if (r.hasAccess) {
                      <sat-status-tag status="success">Will receive it</sat-status-tag>
                    } @else {
                      <sat-status-tag status="warning">Skipped</sat-status-tag>
                      <span class="bf-cell__secondary">{{
                        r.skipReason ?? 'Cannot see this data.'
                      }}</span>
                    }
                  </li>
                } @empty {
                  <li class="bf-cell__secondary">
                    No email recipients — this one goes to chat only.
                  </li>
                }
              </ul>
            </div>

            @if (openRuns() === schedule.id) {
              <div class="bf-section">
                <h3 class="bf-section__title">Delivery history</h3>
                <bf-load-state
                  [loading]="runs.isLoading() && !runs.hasValue()"
                  [error]="runs.error()"
                  what="the delivery history"
                  [lines]="3"
                  (retry)="runs.reload()"
                />
                @if (valueOf(runs); as runList) {
                  <div class="bf-table-scroll">
                    <table class="bf-split-table" aria-label="Delivery history">
                      <thead>
                        <tr>
                          <th>Ran at</th>
                          <th>Status</th>
                          <th>Trigger</th>
                          <th class="bf-num">Delivered</th>
                          <th class="bf-num">Skipped</th>
                          <th class="bf-num">Rows</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (run of runList.items; track run.id) {
                          <tr>
                            <td>
                              <span data-testid="relative-time">{{
                                run.runAt | bfDateTime: session.timezone()
                              }}</span>
                            </td>
                            <td>
                              <sat-status-tag [status]="runTone(run.status)">{{
                                runStatusLabel(run.status)
                              }}</sat-status-tag>
                              @if (run.error) {
                                <span class="bf-cell__secondary">{{ run.error }}</span>
                              }
                            </td>
                            <td>{{ run.trigger === 'manual' ? 'Run now' : 'Scheduled' }}</td>
                            <td class="bf-num">{{ run.deliveredCount }}</td>
                            <td class="bf-num">{{ run.skippedCount }}</td>
                            <td class="bf-num">{{ run.rowCount }}</td>
                          </tr>
                        } @empty {
                          <tr>
                            <td colspan="6" class="bf-empty">This schedule has not run yet.</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                }
              </div>
            }
          </section>
        }
      } @else {
        <sat-empty-state>
          <h2 satEmptyStateHeadline>No scheduled reports yet</h2>
          <p satEmptyStateDescription>
            Schedule a report to send its headline figures to people and chat channels on a rhythm.
          </p>
        </sat-empty-state>
      }
    }

    <section class="bf-card" aria-labelledby="exports-title">
      <div class="bf-card__header">
        <div>
          <h2 class="bf-card__title" id="exports-title">Recent exports</h2>
          <p class="bf-card__hint">
            Every export is recorded for audit and expires after 7 days. No file is produced yet.
          </p>
        </div>
      </div>
      <bf-load-state
        [loading]="exports.isLoading() && !exports.hasValue()"
        [error]="exports.error()"
        what="recent exports"
        [lines]="3"
        (retry)="exports.reload()"
      />
      @if (valueOf(exports); as list) {
        <div class="bf-table-scroll">
          <table class="bf-split-table" aria-label="Recent exports">
            <thead>
              <tr>
                <th>Report</th>
                <th>Format</th>
                <th class="bf-num">Rows</th>
                <th>Status</th>
                <th>Requested by</th>
                <th>Expires</th>
              </tr>
            </thead>
            <tbody>
              @for (item of list.items; track item.id) {
                <tr>
                  <td>{{ item.reportName }}</td>
                  <td>{{ item.format.toUpperCase() }}</td>
                  <td class="bf-num">{{ item.rowCount }}</td>
                  <td>
                    <sat-status-tag [status]="exportTone(item.status)">{{
                      item.status
                    }}</sat-status-tag>
                  </td>
                  <td>{{ item.requestedByName ?? 'A schedule' }}</td>
                  <td>
                    <span data-testid="relative-time">{{
                      item.expiresAt | bfDateTime: session.timezone()
                    }}</span>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="6" class="bf-empty">Nobody has exported a report recently.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
  styles: `
    .bf-recipients {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .bf-recipients li {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      font: var(--mat-sys-body-medium);
    }
    .bf-facts > div {
      min-width: 0;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportSchedulesPage {
  private readonly api = injectApi();
  protected readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly allFormats = REPORT_FORMATS;
  protected readonly allFrequencies = SCHEDULE_FREQUENCIES;
  protected readonly weekdays = WEEKDAYS;

  protected readonly schedules = resource({
    loader: () => data(this.api.listReportSchedules({})),
  });
  protected readonly exports = resource({ loader: () => data(this.api.listReportExports({})) });
  protected readonly catalog = resource({ loader: () => data(this.api.getReportCatalog({})) });
  protected readonly reports = computed(() => valueOf(this.catalog)?.reports ?? []);
  protected readonly canSchedule = computed(() => this.session.can('report.schedule'));

  /** The directory is only offered to viewers who may read it; otherwise schedules go to chat. */
  protected readonly directory = resource({
    loader: async () => {
      if (!this.session.can('org.read')) return [];
      try {
        return (await data(this.api.listPeople({ query: { limit: 200 } }))).items;
      } catch {
        return [];
      }
    },
  });
  protected readonly people = computed(() => valueOf(this.directory) ?? []);

  protected readonly openRuns = signal<string | null>(null);
  protected readonly runs = resource({
    params: () => {
      const scheduleId = this.openRuns();
      return scheduleId ? { scheduleId } : undefined;
    },
    loader: ({ params }) => data(this.api.listScheduleRuns({ params })),
  });

  protected readonly creating = signal(false);
  protected readonly busy = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);

  protected readonly name = signal('');
  protected readonly reportId = signal<ReportId>('budget-vs-actual');
  protected readonly formats = signal<ReportFormat[]>(['pdf']);
  protected readonly frequency = signal<ScheduleFrequency>('weekly');
  protected readonly weekday = signal(1);
  protected readonly dayOfMonth = signal(5);
  protected readonly sendTime = signal('08:00');
  protected readonly timezone = signal('America/New_York');
  protected readonly recipientIds = signal<string[]>([]);
  protected readonly channel = signal('');
  protected readonly message = signal('');

  protected readonly canSubmit = computed(
    () =>
      this.name().trim().length > 0 &&
      this.formats().length > 0 &&
      (this.recipientIds().length > 0 || this.channel().trim().length > 0),
  );

  protected frequencyLabel(frequency: ScheduleFrequency): string {
    return FREQUENCY_LABELS[frequency];
  }

  protected runStatusLabel(status: ScheduleRunStatus): string {
    return RUN_STATUS_LABELS[status];
  }

  protected runTone(status: ScheduleRunStatus): 'success' | 'warning' | 'important' | 'info' {
    switch (status) {
      case 'delivered':
        return 'success';
      case 'partly_delivered':
        return 'warning';
      case 'failed':
        return 'important';
      default:
        return 'info';
    }
  }

  protected exportTone(status: string): 'success' | 'warning' | 'important' | 'info' {
    switch (status) {
      case 'ready':
        return 'success';
      case 'expired':
        return 'warning';
      case 'failed':
        return 'important';
      default:
        return 'info';
    }
  }

  protected summary(schedule: ReportSchedule): string {
    const when = FREQUENCY_LABELS[schedule.frequency];
    const day =
      schedule.frequency === 'weekly' && schedule.weekday !== null
        ? ` on ${WEEKDAYS[schedule.weekday]}`
        : schedule.dayOfMonth !== null
          ? ` on day ${schedule.dayOfMonth}`
          : '';
    return `${when}${day} at ${schedule.sendTime} ${schedule.timezone}`;
  }

  protected formatList(formats: readonly ReportFormat[]): string {
    return formats.map((f) => f.toUpperCase()).join(', ');
  }

  protected channelList(schedule: ReportSchedule): string {
    return schedule.channels.map((c) => c.channel).join(', ');
  }

  protected toggleRuns(scheduleId: string): void {
    this.openRuns.set(this.openRuns() === scheduleId ? null : scheduleId);
  }

  protected async create(): Promise<void> {
    await this.act(async () => {
      const schedule = await data(
        this.api.createReportSchedule({
          body: {
            name: this.name().trim(),
            reportId: this.reportId(),
            filters: {},
            formats: this.formats(),
            frequency: this.frequency(),
            ...(this.frequency() === 'weekly' ? { weekday: this.weekday() } : {}),
            ...(this.frequency() === 'monthly' || this.frequency() === 'monthly_after_close'
              ? { dayOfMonth: this.dayOfMonth() }
              : {}),
            sendTime: this.sendTime(),
            timezone: this.timezone().trim(),
            ...(this.recipientIds().length ? { recipientPersonIds: this.recipientIds() } : {}),
            ...(this.channel().trim()
              ? { channels: [{ provider: 'slack' as const, channel: this.channel().trim() }] }
              : {}),
            ...(this.message().trim() ? { message: this.message().trim() } : {}),
          },
        }),
      );
      const skipped = schedule.recipients.filter((r) => !r.hasAccess).length;
      this.notice.set(
        skipped
          ? `${schedule.name} scheduled. ${skipped} recipient${skipped === 1 ? '' : 's'} will be skipped: they cannot see this data.`
          : `${schedule.name} scheduled.`,
      );
      this.creating.set(false);
      this.name.set('');
      this.schedules.reload();
    });
  }

  protected async toggle(schedule: ReportSchedule): Promise<void> {
    await this.act(async () => {
      const after = await data(
        this.api.updateReportSchedule({
          params: { scheduleId: schedule.id },
          body: { active: !schedule.active },
        }),
      );
      this.notice.set(`${after.name} ${after.active ? 'resumed' : 'paused'}.`);
      this.schedules.reload();
    });
  }

  protected async remove(schedule: ReportSchedule): Promise<void> {
    await this.act(async () => {
      await data(this.api.deleteReportSchedule({ params: { scheduleId: schedule.id } }));
      this.notice.set(`${schedule.name} deleted.`);
      if (this.openRuns() === schedule.id) this.openRuns.set(null);
      this.schedules.reload();
    });
  }

  protected async runNow(schedule: ReportSchedule): Promise<void> {
    await this.act(async () => {
      const run = await data(this.api.runReportSchedule({ params: { scheduleId: schedule.id } }));
      this.notice.set(
        `${schedule.name} queued. The worker delivers the headline figures to ${run.channelCount + schedule.recipients.length} place(s).`,
      );
      this.openRuns.set(schedule.id);
      this.runs.reload();
      this.schedules.reload();
    });
  }

  private async act(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    this.notice.set(null);
    try {
      await action();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
