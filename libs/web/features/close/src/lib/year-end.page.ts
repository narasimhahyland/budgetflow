import { DatePipe } from '@angular/common';
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
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { Router, RouterLink } from '@angular/router';
import type { YearEndRun } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { LoadState, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { data, errorMessage, injectApi, valueOf } from './api';
import { CloseTabs } from './close-tabs';
import { ordered, RUN_STATUS } from './close-format';
import { CloseTag } from './close-tag';

/** Screen 87b, step 1: the year-end runs, and setting one up for the year that is ending. */
@Component({
  selector: 'bf-year-end-page',
  imports: [
    CloseTag,
    CloseTabs,
    DatePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Year-end</h1>
        <p class="bf-page__subtitle">
          One controlled run per fiscal year: dry run as often as you like, collect the approvals
          carry-overs need, then execute once. The execution posts real journals and cannot be
          undone.
        </p>
      </div>
      @if (canReclaim()) {
        <div class="bf-page__actions">
          <a mat-stroked-button routerLink="/finance/reclaim" data-testid="reclaim-before-year-end"
            >Reclaim before year end</a
          >
        </div>
      }
    </header>
    <bf-close-tabs />
    @if (failure()) {
      <sat-banner variant="important" data-testid="year-end-failure">
        <sat-banner-message>{{ failure() }}</sat-banner-message>
      </sat-banner>
    }
    <section class="bf-card" aria-labelledby="runs-title">
      <div class="bf-card__header">
        <h2 class="bf-card__title" id="runs-title">Runs</h2>
      </div>
      @if (runs.isLoading() && !valueOf(runs)) {
        <bf-load-state [loading]="true" what="year-end runs" />
      } @else if (runs.error()) {
        <bf-load-state [error]="runs.error()" what="year-end runs" (retry)="runs.reload()" />
      } @else if (!rows().length) {
        <sat-empty-state>
          <h3 satEmptyStateHeadline>No year-end runs yet</h3>
          <p satEmptyStateDescription>
            Set one up below to see what every budget would carry, lapse and sweep. Setting up and
            dry running post nothing.
          </p>
        </sat-empty-state>
      } @else {
        <div class="bf-table-scroll">
          <table mat-table class="bf-table" [dataSource]="rows()" aria-label="Year-end runs">
            <ng-container matColumnDef="years">
              <th mat-header-cell *matHeaderCellDef scope="col">Run</th>
              <td mat-cell *matCellDef="let r">
                <a class="bf-cell__primary" [routerLink]="['/finance/year-end', r.id]"
                  >{{ r.fiscalYearLabel }} → {{ r.targetFiscalYearLabel }}</a
                >
                <span class="bf-cell__secondary">{{ r.rootBudgetName }}</span>
              </td>
            </ng-container>
            <ng-container matColumnDef="status">
              <th mat-header-cell *matHeaderCellDef scope="col">Status</th>
              <td mat-cell *matCellDef="let r">
                <span class="bf-tag-cell"><bf-close-tag [tag]="status(r)" /></span>
              </td>
            </ng-container>
            <ng-container matColumnDef="carry">
              <th mat-header-cell *matHeaderCellDef scope="col" class="bf-num">Carries</th>
              <td mat-cell *matCellDef="let r" class="bf-num">
                <bf-money [amountMinor]="r.totals.carryMinor" [currency]="r.totals.currency" />
              </td>
            </ng-container>
            <ng-container matColumnDef="lapse">
              <th mat-header-cell *matHeaderCellDef scope="col" class="bf-num">Lapses</th>
              <td mat-cell *matCellDef="let r" class="bf-num">
                <bf-money [amountMinor]="r.totals.lapseMinor" [currency]="r.totals.currency" />
              </td>
            </ng-container>
            <ng-container matColumnDef="freeze">
              <th mat-header-cell *matHeaderCellDef scope="col">Commitment freeze</th>
              <td mat-cell *matCellDef="let r">
                {{ r.commitmentFreezeDate ? (r.commitmentFreezeDate | date: 'd MMM y') : '—' }}
              </td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="columns"></tr>
            <tr mat-row *matRowDef="let row; columns: columns"></tr>
          </table>
        </div>
      }
    </section>
    @if (canRun()) {
      <section class="bf-card" aria-labelledby="setup-title">
        <div class="bf-card__header">
          <div>
            <h2 class="bf-card__title" id="setup-title">Set up a run</h2>
            <p class="bf-card__hint">
              Pick the root budget of the year that is ending and the year it rolls into. Setting up
              posts nothing.
            </p>
          </div>
        </div>
        <div class="bf-form">
          <mat-form-field appearance="outline">
            <mat-label>Root budget (year ending)</mat-label>
            <mat-select
              [ngModel]="rootBudgetId()"
              (ngModelChange)="rootBudgetId.set($event)"
              data-testid="run-root-budget"
            >
              @for (b of roots(); track b.id) {
                <mat-option [value]="b.id">{{ b.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Target fiscal year</mat-label>
            <mat-select
              [ngModel]="targetFiscalYearId()"
              (ngModelChange)="targetFiscalYearId.set($event)"
              data-testid="run-target-year"
            >
              @for (y of fiscalYears(); track y.id) {
                <mat-option [value]="y.id">{{ y.label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Commitment freeze date</mat-label>
            <input
              matInput
              type="date"
              [ngModel]="freezeDate()"
              (ngModelChange)="freezeDate.set($event)"
              data-testid="run-freeze-date"
            />
            <mat-hint>After this date new commitments need Finance Admin approval.</mat-hint>
          </mat-form-field>
        </div>
        <div class="bf-form__actions">
          <button
            mat-flat-button
            type="button"
            [disabled]="busy() || !ready()"
            (click)="create()"
            data-testid="create-run"
          >
            Set up the run
          </button>
        </div>
      </section>
    }
  `,
  styleUrl: './close.scss',
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class YearEndPage {
  private readonly api = injectApi();
  private readonly router = inject(Router);
  private readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly columns = ['years', 'status', 'carry', 'lapse', 'freeze'];
  protected readonly canRun = computed(() => this.session.can('yearend.run'));
  /** 086a entry: ask owners to release money that would lapse before the run sweeps it. */
  protected readonly canReclaim = computed(() => this.session.can('reclaim.manage'));
  protected readonly fiscalYears = computed(() => this.session.me()?.fiscalYears ?? []);
  protected readonly runs = resource({
    loader: () => data(this.api.listYearEndRuns({ query: {} })),
  });
  /** Newest year first, then target year, then id: a stable order even when two runs share a year. */
  protected readonly rows = computed(() =>
    ordered(
      valueOf(this.runs)?.items ?? [],
      (r) => r.fiscalYearLabel,
      (r) => r.targetFiscalYearLabel,
    ),
  );
  private readonly budgets = resource({
    loader: async () =>
      (await data(this.api.listBudgets({ query: { topLevel: 'true', limit: 100 } }))).items,
  });
  protected readonly roots = computed(() =>
    ordered(
      (valueOf(this.budgets) ?? []).filter((b) => b.parentId === null),
      (b) => b.name,
    ),
  );
  protected readonly rootBudgetId = signal('');
  protected readonly targetFiscalYearId = signal('');
  protected readonly freezeDate = signal('');
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly ready = computed(
    () => this.rootBudgetId().length > 0 && this.targetFiscalYearId().length > 0,
  );

  protected status(r: YearEndRun) {
    return RUN_STATUS[r.status];
  }

  protected async create(): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      const run = await data(
        this.api.createYearEndRun({
          body: {
            rootBudgetId: this.rootBudgetId(),
            targetFiscalYearId: this.targetFiscalYearId(),
            ...(this.freezeDate() ? { commitmentFreezeDate: this.freezeDate() } : {}),
          },
        }),
      );
      await this.router.navigate(['/finance/year-end', run.id]);
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
