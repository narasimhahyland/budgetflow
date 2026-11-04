import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import type { CalendarDefinition, FiscalPeriod } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi } from './api';
import { LoadState } from './load-state';

type PeriodAction = FiscalPeriod['allowedActions'][number];
type CalendarType = CalendarDefinition['type'];

const ACTION_LABEL: Record<PeriodAction, string> = {
  soft_close: 'Soft-close',
  close: 'Close',
  lock: 'Lock',
  reopen: 'Reopen',
  unlock: 'Unlock',
};
const STATUS: Record<
  FiscalPeriod['status'],
  { label: string; tone: 'success' | 'warning' | 'neutral' | 'important' }
> = {
  open: { label: 'Open', tone: 'success' },
  soft_closed: { label: 'Soft-closed', tone: 'warning' },
  closed: { label: 'Closed', tone: 'neutral' },
  locked: { label: 'Locked', tone: 'important' },
};
const TYPE_LABEL: Record<CalendarType, string> = {
  calendar_year: 'Calendar year (Jan-Dec)',
  non_calendar: 'Non-calendar year',
  '4-4-5': '4-4-5 weeks (52/53-week year)',
  '4-5-4': '4-5-4 weeks (52/53-week year)',
  '5-4-4': '5-4-4 weeks (52/53-week year)',
  '13-period': '13 periods of 4 weeks',
};
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Screens 7, 108 and 108a: fiscal calendars, variants and period statuses. */
@Component({
  selector: 'bf-fiscal-calendars-page',
  imports: [
    DatePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    SAT_BANNER_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  templateUrl: './fiscal-calendars.page.html',
  styleUrl: './page.scss',
  styles: `
    .bf-years {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 0 20px 12px;
    }
    .bf-reason {
      min-width: 220px;
    }
    .bf-year--active {
      background: var(--mat-sys-secondary-container);
    }
    .bf-year-hint {
      margin: 0;
      padding: 0 20px 8px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FiscalCalendarsPage {
  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly actionLabel = ACTION_LABEL;
  protected readonly status = STATUS;
  protected readonly typeLabel = TYPE_LABEL;
  protected readonly types = Object.keys(TYPE_LABEL) as CalendarType[];
  protected readonly months = MONTHS;
  protected readonly weekdays = WEEKDAYS;
  protected readonly columns = ['period', 'dates', 'days', 'status', 'actions'];

  protected readonly calendars = resource({ loader: () => data(this.api.listFiscalCalendars({})) });
  protected readonly calendarId = linkedSignal(() => {
    const items = this.calendars.value()?.items ?? [];
    return (
      (items.find((c) => c.legalEntities.some((l) => l.code === 'HYL-US')) ?? items[0])?.id ?? null
    );
  });
  protected readonly detail = resource({
    params: () => (this.calendarId() ? { id: this.calendarId()! } : undefined),
    loader: ({ params }) => data(this.api.getFiscalCalendar({ params: { calendarId: params.id } })),
  });
  protected readonly yearId = linkedSignal(() => {
    const years = this.detail.value()?.fiscalYears ?? [];
    const today = new Date().toISOString().slice(0, 10);
    return (years.find((y) => y.startDate <= today && today <= y.endDate) ?? years[0])?.id ?? null;
  });
  protected readonly year = computed(
    () => this.detail.value()?.fiscalYears.find((y) => y.id === this.yearId()) ?? null,
  );

  protected readonly canManage = computed(() => this.session.can('period.manage'));
  protected readonly pendingAction = signal<{ period: FiscalPeriod; action: PeriodAction } | null>(
    null,
  );
  protected readonly reason = signal('');
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  // New calendar
  protected readonly creating = signal(false);
  protected readonly newName = signal('');
  protected readonly newType = signal<CalendarType>('4-4-5');
  protected readonly startMonth = signal(4);
  protected readonly endMonth = signal(12);
  protected readonly endWeekday = signal(6);
  protected readonly method = signal<'last' | 'nearest'>('last');
  protected readonly firstYear = signal(new Date().getUTCFullYear() + 1);
  protected readonly yearCount = signal(2);
  protected readonly mapToGroup = signal(true);

  protected readonly definition = computed<CalendarDefinition>(() => {
    const type = this.newType();
    if (type === 'calendar_year') return { type, labelBy: 'end' };
    if (type === 'non_calendar') return { type, startMonth: this.startMonth(), labelBy: 'end' };
    return {
      type,
      endMonth: this.endMonth(),
      endWeekday: this.endWeekday(),
      method: this.method(),
    };
  });

  protected readonly preview = resource({
    params: () =>
      this.creating() ? { definition: this.definition(), year: this.firstYear() } : undefined,
    loader: ({ params }) => data(this.api.previewFiscalCalendar({ body: params })),
  });

  protected readonly groupCalendarId = computed(
    () =>
      this.calendars.value()?.items.find((c) => c.legalEntities.some((l) => l.code === 'HYL-US'))
        ?.id,
  );

  protected describe(def: CalendarDefinition): string {
    if (def.type === 'non_calendar') return `Starts in ${MONTHS[(def.startMonth ?? 1) - 1]}`;
    if (def.type === 'calendar_year') return 'January to December';
    return `Ends the ${def.method === 'nearest' ? 'nearest' : 'last'} ${WEEKDAYS[def.endWeekday ?? 6]} of ${MONTHS[(def.endMonth ?? 12) - 1]}`;
  }

  protected entityCodes(list: { code: string }[]): string {
    return list.length ? list.map((l) => l.code).join(', ') : 'None';
  }

  protected days(start: string, end: string): number {
    return (
      Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) +
      1
    );
  }

  protected ask(period: FiscalPeriod, action: PeriodAction): void {
    this.failure.set(null);
    this.notice.set(null);
    if (action === 'reopen' || action === 'unlock') {
      this.reason.set('');
      this.pendingAction.set({ period, action });
      return;
    }
    void this.change(period, action);
  }

  protected async change(
    period: FiscalPeriod,
    action: PeriodAction,
    reason?: string,
  ): Promise<void> {
    this.busy.set(true);
    try {
      const p = await data(
        this.api.changePeriodStatus({
          params: { periodId: period.id },
          body: reason ? { action, reason } : { action },
        }),
      );
      this.notice.set(`${p.label} is now ${STATUS[p.status].label.toLowerCase()}.`);
      this.pendingAction.set(null);
      this.detail.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async create(): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      const years = Array.from({ length: this.yearCount() }, (_, i) => this.firstYear() + i);
      const group = this.mapToGroup() ? this.groupCalendarId() : undefined;
      const cal = await data(
        this.api.createFiscalCalendar({
          body: {
            name: this.newName(),
            definition: this.definition(),
            years,
            ...(group ? { groupCalendarId: group } : {}),
          },
        }),
      );
      this.notice.set(`${cal.name} is ready with ${cal.fiscalYears.length} fiscal year(s).`);
      this.creating.set(false);
      this.calendars.reload();
      this.calendarId.set(cal.id);
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
