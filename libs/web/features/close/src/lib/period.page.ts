import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  resource,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type {
  CloseCheck,
  CloseEntityChecklist,
  ClosePeriodDetail,
  ReopenRequest,
} from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, LoadState, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SAT_NAVIGATION_TABS_IMPORTS } from '@hylandsoftware/satori-ui/navigation-tabs';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, injectApi, valueOf } from './api';
import { checkTag, ordered, PERIOD_STATUS } from './close-format';
import {
  AcknowledgeCheckDialog,
  BreakGlassDialog,
  ClosePeriodDialog,
  PeriodStatusDialog,
  ReopenDecisionDialog,
} from './close-dialogs';
import { CloseTag } from './close-tag';

type Tab = 'checklist' | 'snapshots' | 'late-items';
type Action = ClosePeriodDetail['allowedActions'][number];

/**
 * Screen 80e: the close checklist for one period, per legal entity, with soft close, close, lock
 * and the break-glass reopen two people have to agree on. Nothing here recomputes money: the
 * checks, the blocking reasons and the snapshots are exactly what the API returns.
 */
@Component({
  selector: 'bf-close-period-page',
  imports: [
    CloseTag,
    DatePipe,
    DateTimePipe,
    LoadState,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatTooltipModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_NAVIGATION_TABS_IMPORTS,
    SatImportantButton,
    SatStatusTag,
  ],
  templateUrl: './period.page.html',
  styleUrl: './close.scss',
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClosePeriodPage {
  readonly periodId = input.required<string>();
  private readonly api = injectApi();
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly session = inject(SessionStore);
  private readonly queryParams = toSignal(inject(ActivatedRoute).queryParamMap);
  protected readonly valueOf = valueOf;
  protected readonly checkTag = checkTag;
  protected readonly timezone = computed(() => this.session.timezone());
  protected readonly checkColumns = ['check', 'kind', 'status', 'count', 'actions'];
  protected readonly snapshotColumns = [
    'entity',
    'authorized',
    'committed',
    'actual',
    'accrued',
    'taken',
  ];
  protected readonly lateColumns = ['date', 'posted', 'command', 'amount'];
  protected readonly notice = signal<string | null>(null);

  protected readonly detail = resource({
    params: () => ({ periodId: this.periodId() }),
    loader: ({ params }) => data(this.api.getClosePeriod({ params })),
  });
  protected readonly lateItems = resource({
    params: () => ({ periodId: this.periodId() }),
    loader: ({ params }) => data(this.api.listLateItems({ params })),
  });
  protected readonly view = computed(() => valueOf(this.detail));
  protected readonly tab = computed<Tab>(() => {
    const t = this.queryParams()?.get('tab');
    return t === 'snapshots' || t === 'late-items' ? t : 'checklist';
  });
  protected readonly tabs = computed(() => [
    { id: 'checklist' as const, label: 'Checklist' },
    { id: 'snapshots' as const, label: `Snapshots (${this.view()?.snapshots.length ?? 0})` },
    { id: 'late-items' as const, label: `Late items (${this.lateRows().length})` },
  ]);
  protected readonly lateRows = computed(() =>
    [...(valueOf(this.lateItems)?.items ?? [])].sort(
      (a, b) =>
        (a.accountingDate < b.accountingDate ? -1 : a.accountingDate > b.accountingDate ? 1 : 0) ||
        (a.journalId < b.journalId ? -1 : a.journalId > b.journalId ? 1 : 0),
    ),
  );

  protected periodStatus(d: ClosePeriodDetail) {
    return PERIOD_STATUS[d.period.status];
  }

  /** A closed or locked period refuses postings; its checklist is a record, not a to-do list. */
  protected isShut(d: ClosePeriodDetail): boolean {
    return d.period.status === 'closed' || d.period.status === 'locked';
  }

  /** Why Close period is disabled, said next to the button (frontend-angular blocked state). */
  protected closeBlockedReason(d: ClosePeriodDetail): string {
    const n = d.blockingReasons.length;
    if (n)
      return `${n} ${n === 1 ? 'check is' : 'checks are'} holding the close. Resolve or accept them first.`;
    return 'Your role cannot close this period.';
  }

  protected can(d: ClosePeriodDetail, action: Action): boolean {
    return d.allowedActions.includes(action);
  }

  protected canBreakGlass(d: ClosePeriodDetail): boolean {
    return !d.reopenRequest && (this.can(d, 'reopen') || this.can(d, 'unlock'));
  }

  /** Hard checks can never be accepted; a soft check already accepted does not ask twice. */
  protected canAcknowledge(d: ClosePeriodDetail, check: CloseCheck): boolean {
    return (
      check.kind === 'soft' &&
      check.status !== 'pass' &&
      !check.acknowledgement &&
      (d.period.status === 'open' || d.period.status === 'soft_closed')
    );
  }

  /** Entities by code, checks in the order the contract declares them: the same order every load. */
  protected entities(d: ClosePeriodDetail): CloseEntityChecklist[] {
    return [...d.entities].sort((a, b) =>
      a.legalEntityCode < b.legalEntityCode
        ? -1
        : a.legalEntityCode > b.legalEntityCode
          ? 1
          : a.legalEntityId < b.legalEntityId
            ? -1
            : 1,
    );
  }

  /** Hard checks first, then the blocking ones, then by code so ties never shuffle. */
  protected checks(entity: CloseEntityChecklist): CloseCheck[] {
    return [...entity.checks].sort(
      (a, b) =>
        Number(b.kind === 'hard') - Number(a.kind === 'hard') ||
        Number(b.blocking) - Number(a.blocking) ||
        (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
    );
  }

  protected snapshots(d: ClosePeriodDetail) {
    return ordered(
      d.snapshots,
      (s) => s.legalEntityCode,
      (s) => s.version,
    );
  }

  protected softClose(d: ClosePeriodDetail): void {
    this.statusDialog(d, 'soft_close', `${d.period.label} is soft-closed.`);
  }

  protected lock(d: ClosePeriodDetail): void {
    this.statusDialog(d, 'lock', `${d.period.label} is locked.`);
  }

  protected close(d: ClosePeriodDetail): void {
    this.dialog
      .open(ClosePeriodDialog, { data: { detail: d }, width: '560px' })
      .afterClosed()
      .subscribe((updated?: ClosePeriodDetail) => {
        if (!updated) return;
        this.applied(
          updated,
          `${updated.period.label} is closed. ${updated.snapshots.length} as-of snapshot(s) taken.`,
        );
      });
  }

  protected acknowledge(
    d: ClosePeriodDetail,
    entity: CloseEntityChecklist,
    check: CloseCheck,
  ): void {
    this.dialog
      .open(AcknowledgeCheckDialog, {
        data: { periodId: d.period.id, entity, check },
        width: '520px',
      })
      .afterClosed()
      .subscribe((updated?: ClosePeriodDetail) => {
        if (!updated) return;
        this.applied(updated, `“${check.title}” accepted for ${entity.legalEntityCode}.`);
      });
  }

  protected requestBreakGlass(d: ClosePeriodDetail): void {
    this.dialog
      .open(BreakGlassDialog, {
        data: {
          periodId: d.period.id,
          periodLabel: d.period.label,
          action: d.period.status === 'locked' ? 'unlock' : 'reopen',
        },
        width: '560px',
      })
      .afterClosed()
      .subscribe((request?: ReopenRequest) => {
        if (!request) return;
        this.reload(
          'Request recorded and audited. The period does not move until a different person approves it.',
        );
      });
  }

  protected decide(request: ReopenRequest): void {
    this.dialog
      .open(ReopenDecisionDialog, { data: { request }, width: '560px' })
      .afterClosed()
      .subscribe((decided?: ReopenRequest) => {
        if (!decided) return;
        this.reload(
          decided.status === 'approved'
            ? 'Approved. The period moved; a re-close takes the next snapshot version.'
            : 'Declined. The period stays as it is.',
        );
      });
  }

  private statusDialog(d: ClosePeriodDetail, action: 'soft_close' | 'lock', done: string): void {
    this.dialog
      .open(PeriodStatusDialog, {
        data: { periodId: d.period.id, periodLabel: d.period.label, action },
        width: '520px',
      })
      .afterClosed()
      .subscribe((updated?: ClosePeriodDetail) => {
        if (!updated) return;
        this.applied(updated, done);
      });
  }

  /** The API answered with the period as it now is; the screen shows that, never a guess. */
  private applied(updated: ClosePeriodDetail, message: string): void {
    this.detail.set(updated);
    this.lateItems.reload();
    this.announce(message);
  }

  private reload(message: string): void {
    this.detail.reload();
    this.lateItems.reload();
    this.announce(message);
  }

  private announce(message: string): void {
    this.notice.set(message);
    this.snack.open(message, undefined, { duration: 5000 });
  }
}
