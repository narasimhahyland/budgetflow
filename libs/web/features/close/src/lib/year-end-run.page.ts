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
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import type { YearEndLine, YearEndReadinessCheck, YearEndRun } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { LoadState, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { ordered, RUN_STATUS, YEAR_END_LINE_STATUS } from './close-format';
import { CarryDecisionDialog, ExecuteYearEndDialog } from './year-end-dialogs';
import { CloseTag } from './close-tag';

type CheckCode = YearEndReadinessCheck['code'];

/** Where someone fixes a readiness check that has not passed. */
const FIX: Partial<Record<CheckCode, { path: string; label: string }>> = {
  target_year_exists: { path: '/finance/periods', label: 'Open the fiscal calendar' },
  target_plan_rates_locked: { path: '/finance/rates', label: 'Open exchange rates' },
  target_budgets_exist: {
    path: '/budgets',
    label: 'Roll this year’s tree forward into the new year',
  },
  prior_periods_closed: { path: '/finance/close', label: 'Open period close' },
  posting_periods_open: { path: '/finance/periods', label: 'Open the fiscal calendar' },
  rollover_policies_assigned: {
    path: '/finance/rollover-policies',
    label: 'Assign rollover policies',
  },
};

/**
 * Screen 87b: one year-end run — readiness, the dry run outcome per budget, the carry approvals,
 * and the single irreversible execution. Every amount is the server's; nothing is recomputed here.
 */
@Component({
  selector: 'bf-year-end-run-page',
  imports: [
    CloseTag,
    DatePipe,
    LoadState,
    MatButtonModule,
    MatTableModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatImportantButton,
    SatStatusTag,
  ],
  templateUrl: './year-end-run.page.html',
  styleUrl: './close.scss',
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class YearEndRunPage {
  readonly runId = input.required<string>();
  private readonly api = injectApi();
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly columns = [
    'budget',
    'available',
    'carry',
    'lapse',
    'sweep',
    'commitments',
    'target',
    'status',
    'actions',
  ];
  protected readonly canRun = computed(() => this.session.can('yearend.run'));
  protected readonly canDecide = computed(() => this.session.can('yearend.approve'));
  protected readonly busy = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);
  protected readonly run = resource({
    params: () => ({ runId: this.runId() }),
    loader: ({ params }) => data(this.api.getYearEndRun({ params })),
  });
  protected readonly view = computed(() => valueOf(this.run));

  protected status(r: YearEndRun) {
    return RUN_STATUS[r.status];
  }

  protected lineStatus(l: YearEndLine) {
    return YEAR_END_LINE_STATUS[l.status];
  }

  protected fixLink(code: CheckCode) {
    return FIX[code];
  }

  /** Checks in the contract's own order of work, blockers first, then by code for a stable tie. */
  protected readiness(r: YearEndRun): YearEndReadinessCheck[] {
    return [...r.readiness].sort(
      (a, b) =>
        Number(a.passed) - Number(b.passed) ||
        Number(b.blocksExecution) - Number(a.blocksExecution) ||
        (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
    );
  }

  /** Lines down the tree, then by name, then by id: ties never depend on the query order. */
  protected lines(r: YearEndRun): YearEndLine[] {
    return ordered(
      r.lines,
      (l) => l.budgetPath,
      (l) => l.budgetName,
    );
  }

  protected blockers(r: YearEndRun): string[] {
    if (r.status === 'completed') return [];
    const failed = r.readiness.filter((c) => !c.passed && c.blocksExecution).map((c) => c.detail);
    if (r.status === 'draft') {
      return [
        'No dry run yet: run one so every budget’s outcome is known before anything posts.',
        ...failed,
      ];
    }
    return failed;
  }

  protected executable(r: YearEndRun): boolean {
    return r.status === 'dry_run' && this.blockers(r).length === 0;
  }

  protected steps(r: YearEndRun) {
    const reached =
      r.status === 'completed'
        ? 5
        : r.status === 'running'
          ? 4
          : r.lines.some((l) => l.status === 'awaiting_approval')
            ? 3
            : r.status === 'dry_run'
              ? 2
              : 1;
    return ['Setup', 'Dry run', 'Approvals', 'Execute', 'Results'].map((label, i) => ({
      label,
      state: i + 1 < reached ? 'done' : i + 1 === reached ? 'current' : 'todo',
    }));
  }

  protected async dryRun(r: YearEndRun): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    this.notice.set(null);
    try {
      const updated = await data(this.api.dryRunYearEnd({ params: { runId: r.id } }));
      this.run.set(updated);
      this.announce(
        `Dry run done: ${updated.lines.length} budget(s) worked out. Nothing has been posted.`,
      );
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected execute(r: YearEndRun): void {
    this.dialog
      .open(ExecuteYearEndDialog, { data: { run: r }, width: '560px' })
      .afterClosed()
      .subscribe((updated?: YearEndRun) => {
        if (!updated) return;
        this.run.set(updated);
        this.announce(
          updated.status === 'completed'
            ? `Year end ${updated.fiscalYearLabel} executed: ${updated.journalIds.length} journal(s) posted.`
            : `The run finished as ${updated.status}. ${updated.error ?? ''}`.trim(),
        );
      });
  }

  protected decide(r: YearEndRun, line: YearEndLine): void {
    this.dialog
      .open(CarryDecisionDialog, { data: { runId: r.id, line }, width: '520px' })
      .afterClosed()
      .subscribe((updated?: YearEndRun) => {
        if (!updated) return;
        this.run.set(updated);
        this.announce(`Decision recorded for ${line.budgetName}.`);
      });
  }

  private announce(message: string): void {
    this.notice.set(message);
    this.snack.open(message, undefined, { duration: 5000 });
  }
}
