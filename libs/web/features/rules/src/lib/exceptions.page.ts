import { DecimalPipe } from '@angular/common';
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
import { MatSnackBar } from '@angular/material/snack-bar';
import type { PostSpendExceptionItem } from '@bf/contracts';
import { Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_NAVIGATION_TABS_IMPORTS } from '@hylandsoftware/satori-ui/navigation-tabs';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { LoadState } from './load-state';
import { RulesTabs } from './rules-tabs';

const STATUS_TONES: Record<string, 'warning' | 'info' | 'success'> = {
  open: 'warning',
  explained: 'info',
  resolved: 'success',
};

const RESOLUTIONS = [
  { value: 'accept_with_reason', label: 'Accept with a reason' },
  { value: 'ask_repayment', label: 'Ask for repayment' },
  { value: 'reclassify', label: 'Reclassify to another account' },
  { value: 'mark_duplicate', label: 'Mark as a duplicate' },
  { value: 'not_an_exception', label: 'Not an exception' },
];

/** Screen 074a: spend that broke a rule after it happened, and how Finance settled it. */
@Component({
  selector: 'bf-exceptions-page',
  imports: [
    DecimalPipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    Money,
    RulesTabs,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_NAVIGATION_TABS_IMPORTS,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Post-spend exceptions</h1>
        <p class="bf-page__subtitle">
          Spend that broke a rule after it already happened. It cannot be undone, so each one is
          explained, repaid or moved to another account with a reversal.
        </p>
      </div>
    </header>
    <bf-rules-tabs current="exceptions" />
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
      [loading]="list.isLoading() && !list.hasValue()"
      [error]="list.error()"
      what="post-spend exceptions"
      (retry)="list.reload()"
    />
    @if (valueOf(list); as v) {
      <sat-navigation-tabs class="bf-tabs" aria-label="Exception states">
        @for (t of tabs; track t.id) {
          <a
            satNavigationTab
            [active]="tab() === t.id"
            (click)="tab.set(t.id)"
            (keydown.enter)="tab.set(t.id)"
            tabindex="0"
          >
            {{ t.label }}
            <span class="bf-chip">{{ count(t.id) }}</span>
          </a>
        }
      </sat-navigation-tabs>

      <section class="bf-card" aria-labelledby="queue-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="queue-title">
            {{ rows().length | number }}
            {{ rows().length === 1 ? 'exception' : 'exceptions' }}
          </h2>
        </div>
        @if (rows().length) {
          <div class="bf-table-scroll">
            <table class="bf-split-table" aria-label="Post-spend exceptions">
              <thead>
                <tr>
                  <th scope="col">What happened</th>
                  <th scope="col">Budget</th>
                  <th scope="col" class="bf-num">Amount</th>
                  <th scope="col">Rule</th>
                  <th scope="col" class="bf-num">Age</th>
                  <th scope="col">State</th>
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                @for (e of rows(); track e.id) {
                  <tr>
                    <td>
                      <span class="bf-cell__primary">{{ e.typeLabel }}</span>
                      <span class="bf-cell__secondary">{{ e.summary }}</span>
                    </td>
                    <td>
                      {{ e.budgetName }}
                      <span class="bf-cell__secondary">{{ e.location }} · {{ e.personName }}</span>
                    </td>
                    <td class="bf-num">
                      <bf-money
                        [amountMinor]="e.reportingAmount.amountMinor"
                        [currency]="e.reportingAmount.currency"
                      />
                    </td>
                    <td>{{ e.ruleCode }} v{{ e.ruleVersion }}</td>
                    <td class="bf-num">{{ e.ageDays }} days</td>
                    <td>
                      <sat-status-tag [status]="tone(e.status)">{{ stateLabel(e) }}</sat-status-tag>
                    </td>
                    <td>
                      @if (e.allowedActions.includes('resolve')) {
                        <button mat-button type="button" (click)="open.set(e.id)">Settle</button>
                      }
                    </td>
                  </tr>
                  @if (open() === e.id) {
                    <tr>
                      <td colspan="7">
                        <div class="bf-form">
                          <mat-form-field appearance="outline">
                            <mat-label>How to settle it</mat-label>
                            <mat-select [(ngModel)]="resolution" name="resolution">
                              @for (r of resolutions; track r.value) {
                                <mat-option [value]="r.value">{{ r.label }}</mat-option>
                              }
                            </mat-select>
                          </mat-form-field>
                          @if (resolution === 'reclassify') {
                            <mat-form-field appearance="outline">
                              <mat-label>Move to GL account</mat-label>
                              <input matInput [(ngModel)]="glCode" name="glCode" />
                            </mat-form-field>
                          }
                          @if (resolution === 'ask_repayment') {
                            <mat-form-field appearance="outline">
                              <mat-label>Repayment (USD)</mat-label>
                              <input
                                matInput
                                inputmode="decimal"
                                [(ngModel)]="repayment"
                                name="repayment"
                              />
                            </mat-form-field>
                          }
                          <mat-form-field appearance="outline" class="bf-form__wide">
                            <mat-label>Reason</mat-label>
                            <input matInput [(ngModel)]="reason" name="reason" />
                          </mat-form-field>
                        </div>
                        @if (resolution === 'reclassify') {
                          <sat-banner variant="warning">
                            <sat-banner-message>
                              Reclassifying posts a reversal of the original entry and a new entry
                              on the account you choose. The original entry is never edited.
                            </sat-banner-message>
                          </sat-banner>
                        }
                        <div class="bf-form__actions">
                          <button mat-button type="button" (click)="open.set(null)">Cancel</button>
                          <button
                            mat-flat-button
                            type="button"
                            [disabled]="busy() || reason.trim().length < 3"
                            (click)="resolve(e.id)"
                          >
                            Settle this exception
                          </button>
                        </div>
                      </td>
                    </tr>
                  }
                }
              </tbody>
            </table>
          </div>
        } @else {
          <sat-empty-state>
            <h3 satEmptyStateHeadline>Nothing here</h3>
            <p satEmptyStateDescription>No exception is in this state.</p>
          </sat-empty-state>
        }
      </section>
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExceptionsPage {
  private readonly api = injectApi();
  private readonly snack = inject(MatSnackBar);
  protected readonly valueOf = valueOf;
  protected readonly resolutions = RESOLUTIONS;
  protected readonly tabs = [
    { id: 'open', label: 'Open' },
    { id: 'explained', label: 'Explained' },
    { id: 'resolved', label: 'Settled' },
  ] as const;

  protected readonly tab = signal<'open' | 'explained' | 'resolved'>('open');
  protected readonly open = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly notice = signal('');
  protected resolution = 'accept_with_reason';
  protected reason = '';
  protected glCode = '';
  protected repayment = '';

  protected readonly list = resource({ loader: () => data(this.api.listPostSpendExceptions({})) });
  protected readonly rows = computed(() =>
    (valueOf(this.list)?.items ?? []).filter((e) => e.status === this.tab()),
  );

  protected count(state: string): number {
    const counts = valueOf(this.list)?.counts;
    if (!counts) return 0;
    return counts[state as keyof typeof counts] ?? 0;
  }

  protected tone(status: string): 'warning' | 'info' | 'success' {
    return STATUS_TONES[status] ?? 'warning';
  }

  protected stateLabel(e: PostSpendExceptionItem): string {
    return e.status === 'resolved' ? 'Settled' : e.status === 'explained' ? 'Explained' : 'Open';
  }

  protected async resolve(exceptionId: string): Promise<void> {
    this.busy.set(true);
    this.failure.set('');
    this.notice.set('');
    const repaymentMinor = Math.round(Number(this.repayment.replace(/[,\s]/g, '')) * 100);
    try {
      await data(
        this.api.resolvePostSpendException({
          params: { exceptionId },
          body: {
            action: 'resolve',
            resolution: this.resolution as 'accept_with_reason',
            reason: this.reason.trim(),
            ...(this.resolution === 'reclassify' && this.glCode
              ? { reclassifyGlCode: this.glCode.trim() }
              : {}),
            ...(this.resolution === 'ask_repayment' && repaymentMinor > 0
              ? { repaymentMinor }
              : {}),
          },
        }),
      );
      this.notice.set('The exception is settled and the decision is recorded in the audit trail.');
      this.snack.open('Exception settled', undefined, { duration: 4000 });
      this.open.set(null);
      this.reason = '';
      this.list.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
