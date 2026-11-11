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
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import type { AiConfidence, AnomalyFlag, AnomalyKind } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, LoadState, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { AI_OUTPUT_IMPORTS, isFeatureDisabled } from './ai-output';
import { data, errorMessage, injectApi, valueOf } from './api';

const KIND_LABELS: Record<AnomalyKind, string> = {
  possible_split: 'Possible split',
  possible_duplicate: 'Possible duplicate',
  receipt_reused: 'Receipt reused',
  unusual_cost_per_head: 'Unusual cost per head',
  unusual_vendor: 'Unusual vendor',
};

const CLEAR_REASONS = [
  { code: 'LEGITIMATE_BUSINESS_REASON', label: 'Legitimate business reason' },
  { code: 'DATA_ERROR', label: 'Data error' },
  { code: 'KNOWN_PATTERN', label: 'Known pattern' },
  { code: 'OTHER', label: 'Other' },
];

const STATUSES = ['open', 'acknowledged', 'resolved'] as const;

/**
 * Screen 017c: anomaly flags. Advisory only — a flag never blocks, holds, approves or rejects
 * anything, and the queue says so on every flag. The evidence behind a flag is deterministic and
 * comes from the records; the model only writes the one-sentence finding.
 */
@Component({
  selector: 'bf-anomalies-page',
  imports: [
    AI_OUTPUT_IMPORTS,
    FormsModule,
    DateTimePipe,
    LoadState,
    MatButtonModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <div class="bf-title-row">
          <h1 class="bf-page__title">Anomaly flags</h1>
          <bf-ai-label text="AI flags" />
        </div>
        <p class="bf-page__subtitle">
          Requests and receipts worth a second look, with the evidence beside them. A flag is
          advice: it never blocks, holds, approves or rejects anything.
        </p>
      </div>
      <div class="bf-page__actions">
        <button
          mat-stroked-button
          type="button"
          [disabled]="scanning()"
          (click)="scan()"
          data-testid="run-scan"
        >
          <mat-icon svgIcon="refresh" />Scan for flags
        </button>
      </div>
    </header>

    @if (disabled(); as detail) {
      <bf-ai-disabled
        feature="Anomaly flags"
        [detail]="detail"
        stillWorks="Approval cards, exceptions and the rules engine are unaffected."
      />
    } @else {
      <bf-load-state
        [loading]="flags.isLoading() && !flags.hasValue()"
        [error]="loadError()"
        what="the anomaly flags"
        shape="table"
        (retry)="flags.reload()"
      />
      @if (flags.hasValue()) {
        @for (paused of pausedKinds(); track paused.kind) {
          <sat-banner variant="info" [attr.data-testid]="'paused-' + paused.kind">
            <sat-banner-message>
              {{ kindLabel(paused.kind) }} flags are paused: measured precision
              {{ bps(paused.precisionBps) }} is below the {{ bps(paused.thresholdBps) }} threshold.
              No new flags of this kind are raised until it is re-evaluated.
            </sat-banner-message>
          </sat-banner>
        }

        <section class="bf-card" aria-labelledby="flags-title">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="flags-title">Flags</h2>
          </div>
          <div class="bf-filters">
            <mat-chip-listbox aria-label="Flag status">
              @for (s of statuses; track s) {
                <mat-chip-option
                  [selected]="status() === s"
                  [selectable]="status() !== s"
                  (selectionChange)="$event.selected && status.set(s)"
                  [attr.data-testid]="'flag-status-' + s"
                  >{{ statusLabel(s) }}</mat-chip-option
                >
              }
            </mat-chip-listbox>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>Kind</mat-label>
              <mat-select [ngModel]="kind()" (ngModelChange)="kind.set($event)">
                <mat-option value="">All kinds</mat-option>
                @for (k of kinds; track k) {
                  <mat-option [value]="k">{{ kindLabel(k) }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          </div>

          @if (rows().length === 0) {
            <div class="bf-card__body">
              <sat-empty-state data-testid="flags-empty">
                <h2 satEmptyStateHeadline>
                  No {{ statusLabel(status()).toLowerCase() }} anomaly flags
                </h2>
                <p satEmptyStateDescription>
                  Scan for flags, or open the post-spend exceptions for items the rules already
                  caught.
                </p>
                <button
                  mat-stroked-button
                  satEmptyStateAction
                  type="button"
                  [disabled]="scanning()"
                  (click)="scan()"
                >
                  Scan for flags
                </button>
              </sat-empty-state>
            </div>
          } @else {
            <div class="bf-table-scroll">
              <table class="bf-split-table bf-table--stack" aria-label="Anomaly flags">
                <thead>
                  <tr>
                    <th>Raised</th>
                    <th>Kind</th>
                    <th>Confidence</th>
                    <th>Subject</th>
                    <th>Budget</th>
                    <th class="bf-num">Amount</th>
                    <th>Stage</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  @for (f of rows(); track f.id) {
                    <tr [attr.data-testid]="'flag-row-' + f.id">
                      <td>
                        <span class="bf-nowrap" data-testid="relative-time">{{
                          f.raisedAt | bfDateTime: session.timezone()
                        }}</span>
                      </td>
                      <td data-label="Kind">
                        <button
                          mat-button
                          type="button"
                          (click)="selected.set(f)"
                          [attr.data-testid]="'open-flag-' + f.id"
                        >
                          {{ kindLabel(f.kind) }}
                        </button>
                      </td>
                      <td data-label="Confidence">
                        <sat-status-tag [status]="confidenceTone(f.confidence)">
                          {{ confidenceWord(f.confidence) }}
                        </sat-status-tag>
                      </td>
                      <td data-label="Subject">{{ f.subjectLabel }}</td>
                      <td data-label="Budget">{{ f.budgetName ?? '—' }}</td>
                      <td class="bf-num" data-label="Amount">
                        @if (f.amount) {
                          <bf-money
                            [amountMinor]="f.amount.amountMinor"
                            [currency]="f.amount.currency"
                          />
                        } @else {
                          <span class="bf-cell__secondary">—</span>
                        }
                      </td>
                      <td data-label="Stage">
                        {{ f.stage === 'before_approval' ? 'Before approval' : 'After approval' }}
                      </td>
                      <td data-label="Status">
                        <sat-status-tag [status]="flagStatusTone(f.status)">{{
                          statusLabel(f.status)
                        }}</sat-status-tag>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>

        @if (selected(); as f) {
          <section class="bf-card" aria-labelledby="flag-detail-title" data-testid="flag-detail">
            <div class="bf-card__header">
              <div class="bf-title-row">
                <h2 class="bf-card__title" id="flag-detail-title">{{ kindLabel(f.kind) }}</h2>
                <bf-ai-label text="AI flag" />
                <sat-status-tag status="info" data-testid="advisory-only"
                  >Does not block approval</sat-status-tag
                >
              </div>
              <button mat-button type="button" (click)="selected.set(null)">Close</button>
            </div>
            <div class="bf-card__body bf-flag">
              <bf-ai-prose [text]="f.finding" />

              <div>
                <h3 class="bf-section__title">Evidence from the records</h3>
                <p class="bf-cell__secondary">
                  Deterministic features. These figures come from the records, not from the model.
                </p>
                <dl class="bf-facts" data-testid="flag-evidence">
                  @for (e of f.evidence; track e.label) {
                    <div>
                      <dt>{{ e.label }}</dt>
                      <dd>{{ e.value }}</dd>
                    </div>
                  }
                </dl>
              </div>

              @if (f.amount) {
                <bf-ai-figures
                  [figures]="[
                    {
                      key: 'amount',
                      label: 'Amount on the flagged record',
                      amount: f.amount,
                      source: { type: 'request', id: f.subjectId, label: f.subjectLabel },
                    },
                  ]"
                  label="Amount on the flagged record"
                />
              }

              <bf-ai-why [why]="[]" [confidence]="f.confidence" />
              <bf-ai-sources [sources]="f.sources" />
              <bf-ai-provenance [provenance]="f.provenance" />

              @if (actionError(); as message) {
                <sat-banner variant="important" data-testid="flag-error">
                  <sat-banner-message>{{ message }}</sat-banner-message>
                </sat-banner>
              }

              @if (f.status === 'open') {
                <div>
                  <h3 class="bf-section__title">Not an issue</h3>
                  <p class="bf-cell__secondary">
                    Clearing a flag needs a reason code and a note; both feed the evaluation set
                    that keeps this flag kind above its precision threshold.
                  </p>
                  <div class="bf-form">
                    <mat-form-field appearance="outline" subscriptSizing="dynamic">
                      <mat-label>Reason code</mat-label>
                      <mat-select [(ngModel)]="clearReason">
                        @for (r of clearReasons; track r.code) {
                          <mat-option [value]="r.code">{{ r.label }}</mat-option>
                        }
                      </mat-select>
                    </mat-form-field>
                    <mat-form-field
                      appearance="outline"
                      class="bf-form__wide"
                      subscriptSizing="dynamic"
                    >
                      <mat-label>Note</mat-label>
                      <input matInput [(ngModel)]="clearNote" data-testid="clear-note" />
                    </mat-form-field>
                  </div>
                  <div class="bf-form__actions">
                    <button
                      mat-flat-button
                      type="button"
                      [disabled]="deciding() || !clearNote().trim()"
                      (click)="clear(f)"
                      data-testid="clear-flag"
                    >
                      Not an issue
                    </button>
                    <a mat-stroked-button [routerLink]="subjectLink(f)" data-testid="open-subject">
                      Open the record to decide
                    </a>
                  </div>
                </div>
              } @else {
                <sat-banner variant="info" data-testid="flag-decided">
                  <sat-banner-message>
                    This flag is {{ statusLabel(f.status).toLowerCase()
                    }}{{ f.resolutionReason ? ': ' + f.resolutionReason : '' }}. Cleared flags stay
                    visible to auditors.
                  </sat-banner-message>
                </sat-banner>
              }
            </div>
          </section>
        }
      }
    }
  `,
  styles: `
    .bf-flag {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnomaliesPage {
  private readonly api = injectApi();
  private readonly snack = inject(MatSnackBar);
  protected readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly statuses = STATUSES;
  protected readonly kinds = Object.keys(KIND_LABELS) as AnomalyKind[];
  protected readonly clearReasons = CLEAR_REASONS;

  protected readonly status = signal<(typeof STATUSES)[number]>('open');
  protected readonly kind = signal<'' | AnomalyKind>('');
  protected readonly selected = signal<AnomalyFlag | null>(null);
  protected readonly scanning = signal(false);
  protected readonly deciding = signal(false);
  protected readonly clearReason = signal('LEGITIMATE_BUSINESS_REASON');
  protected readonly clearNote = signal('');
  protected readonly actionError = signal<string | null>(null);

  protected readonly flags = resource({
    params: () => {
      const kind = this.kind();
      return { status: this.status(), ...(kind ? { kind } : {}) };
    },
    loader: ({ params }) => data(this.api.listAnomalyFlags({ query: params })),
  });
  protected readonly rows = computed(() => valueOf(this.flags)?.items ?? []);
  protected readonly pausedKinds = computed(() => valueOf(this.flags)?.pausedKinds ?? []);
  protected readonly disabled = computed(() =>
    isFeatureDisabled(this.flags.error()) ? errorMessage(this.flags.error()) : null,
  );
  protected readonly loadError = computed(() =>
    isFeatureDisabled(this.flags.error()) ? undefined : this.flags.error(),
  );

  protected kindLabel(kind: AnomalyKind): string {
    return KIND_LABELS[kind];
  }

  protected statusLabel(status: string): string {
    return status === 'acknowledged' ? 'Followed up' : status === 'resolved' ? 'Cleared' : 'Open';
  }

  protected bps(value: number): string {
    return (value / 10000).toFixed(2);
  }

  protected confidenceWord(c: AiConfidence): string {
    return c.charAt(0).toUpperCase() + c.slice(1);
  }

  protected confidenceTone(c: AiConfidence): 'success' | 'info' | 'warning' {
    return c === 'high' ? 'success' : c === 'medium' ? 'info' : 'warning';
  }

  protected flagStatusTone(status: AnomalyFlag['status']): 'success' | 'warning' | 'neutral' {
    return status === 'resolved' ? 'success' : status === 'open' ? 'warning' : 'neutral';
  }

  protected subjectLink(f: AnomalyFlag): string {
    const paths: Record<AnomalyFlag['subjectType'], string> = {
      request: '/requests',
      actual: '/finance/actuals/queue',
      document: '/documents/extraction',
    };
    return f.subjectType === 'request' ? `${paths.request}/${f.subjectId}` : paths[f.subjectType];
  }

  protected async scan(): Promise<void> {
    this.scanning.set(true);
    try {
      await data(this.api.runAnomalyScan({ body: {} }));
      this.flags.reload();
      this.snack.open('Scan finished. Flags are advisory and block nothing.', 'Dismiss', {
        duration: 5000,
      });
    } catch (error) {
      this.snack.open(errorMessage(error), 'Dismiss', { duration: 6000 });
    } finally {
      this.scanning.set(false);
    }
  }

  /** Clearing records a human decision on the suggestion; the request itself is untouched. */
  protected async clear(f: AnomalyFlag): Promise<void> {
    this.deciding.set(true);
    this.actionError.set(null);
    try {
      await data(
        this.api.decideAiSuggestion({
          params: { suggestionId: f.id },
          body: {
            decision: 'rejected',
            reasonCode: this.clearReason(),
            reason: this.clearNote().trim(),
          },
        }),
      );
      this.selected.set(null);
      this.clearNote.set('');
      this.flags.reload();
      this.snack.open('Flag cleared with your reason.', 'Dismiss', { duration: 5000 });
    } catch (error) {
      this.actionError.set(errorMessage(error));
    } finally {
      this.deciding.set(false);
    }
  }
}
