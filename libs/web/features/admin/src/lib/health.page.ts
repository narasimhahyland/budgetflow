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
import { MatInputModule } from '@angular/material/input';
import { MatTableModule } from '@angular/material/table';
import type { HealthServiceStatus, SystemHealth } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { ReasonField } from './admin-ui';
import { data, errorMessage, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

const STATUS_TONE: Record<HealthServiceStatus, 'success' | 'warning' | 'important' | 'neutral'> = {
  healthy: 'success',
  degraded: 'warning',
  down: 'important',
  not_enabled: 'neutral',
};

const STATUS_LABEL: Record<HealthServiceStatus, string> = {
  healthy: 'Working',
  degraded: 'Needs attention',
  down: 'Not responding',
  not_enabled: 'Not switched on',
};

const JOB_TONE: Record<string, 'success' | 'warning' | 'important' | 'neutral'> = {
  ok: 'success',
  attention: 'warning',
  failed: 'important',
  never_run: 'neutral',
};

const JOB_LABEL: Record<string, string> = {
  ok: 'Clean',
  attention: 'Needs attention',
  failed: 'Failed',
  never_run: 'Never run',
};

/**
 * Screen 114: operational health and the planned-maintenance notices the shell shows. Nothing here
 * is financial data: the API returns statuses, counts and durations only.
 */
@Component({
  selector: 'bf-system-health-page',
  imports: [
    DateTimePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatTableModule,
    ReasonField,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  templateUrl: './health.page.html',
  styleUrls: ['./page.scss', './health.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SystemHealthPage {
  protected readonly valueOf = valueOf;
  protected readonly statusTone = STATUS_TONE;
  protected readonly statusLabel = STATUS_LABEL;
  protected readonly jobTone = JOB_TONE;
  protected readonly jobLabel = JOB_LABEL;
  protected readonly queueColumns = ['name', 'waiting', 'active', 'failed', 'oldest'];
  protected readonly jobColumns = ['job', 'schedule', 'lastRun', 'result'];
  protected readonly noticeColumns = ['message', 'window', 'status', 'actions'];

  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly timezone = this.session.timezone;
  protected readonly canManage = computed(() => this.session.can('tenant.settings.manage'));

  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly scheduling = signal(false);
  protected readonly message = signal('');
  protected readonly startsAt = signal('');
  protected readonly endsAt = signal('');
  protected readonly cancelling = signal<string | null>(null);
  protected readonly cancelReason = signal('');

  protected readonly health = resource({ loader: () => data(this.api.systemHealth({})) });
  protected readonly notices = resource({ loader: () => data(this.api.maintenanceNotices({})) });

  protected readonly overallNote = computed(() => {
    const value = valueOf(this.health);
    if (!value) return '';
    switch (value.overall) {
      case 'healthy':
        return 'Everything BudgetFlow depends on is answering.';
      case 'degraded':
        return 'Something is slower or further behind than it should be. Work still goes through.';
      case 'down':
        return 'Part of BudgetFlow is not responding. Some actions will fail until it is back.';
      default:
        return 'Not every service is switched on in this environment.';
    }
  });

  protected readonly attention = computed(() =>
    (valueOf(this.health)?.services ?? []).filter(
      (s) => s.status === 'degraded' || s.status === 'down',
    ),
  );

  protected readonly failedJobs = computed(() =>
    (valueOf(this.health)?.nightlyJobs ?? []).filter((j) => j.status === 'failed'),
  );

  protected outboxNote(value: SystemHealth): string {
    if (value.outboxUnpublished === 0) return 'Every message has been published.';
    const lag = value.outboxLagSeconds;
    return `${value.outboxUnpublished} message(s) waiting${lag === null ? '' : `, oldest ${lag}s behind`}.`;
  }

  protected async schedule(): Promise<void> {
    await this.run(async () => {
      await data(
        this.api.createMaintenanceNotice({
          body: {
            message: this.message(),
            startsAt: new Date(this.startsAt()).toISOString(),
            endsAt: new Date(this.endsAt()).toISOString(),
          },
        }),
      );
      this.scheduling.set(false);
      this.message.set('');
      this.notice.set('The maintenance notice is scheduled and will appear in the app banner.');
    });
  }

  protected async cancel(noticeId: string): Promise<void> {
    await this.run(async () => {
      await data(
        this.api.cancelMaintenanceNotice({
          params: { noticeId },
          body: { reason: this.cancelReason() },
        }),
      );
      this.cancelling.set(null);
      this.cancelReason.set('');
      this.notice.set('The maintenance notice is cancelled and no longer shown.');
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    this.notice.set(null);
    try {
      await action();
      this.health.reload();
      this.notices.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
