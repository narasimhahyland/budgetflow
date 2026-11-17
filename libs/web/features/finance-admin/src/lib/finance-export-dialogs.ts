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
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import type {
  FinanceExportDetail,
  FinanceExportLine,
  FinanceExportSummary,
  FinanceExportType,
} from '@bf/contracts';
import { LoadState, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { data, errorMessage, injectApi, valueOf } from './api';

export const EXPORT_TYPES: { value: FinanceExportType; label: string }[] = [
  { value: 'intercompany_recharges', label: 'Intercompany recharges' },
  { value: 'chargeback_reclass', label: 'Chargeback and reclass' },
  { value: 'payroll_benefits', label: 'Payroll benefits' },
];
export const typeLabel = (t: FinanceExportType): string =>
  EXPORT_TYPES.find((x) => x.value === t)?.label ?? t;

export interface NewExportData {
  period: string;
  periods: { value: string; label: string }[];
  entities: { id: string; code: string }[];
  type?: FinanceExportType;
  legalEntityId?: string | null;
  includeExported?: boolean;
}

/** The lines table shared by the new-export preview and "View lines". */
@Component({
  selector: 'bf-finance-export-lines',
  imports: [DatePipe, Money],
  template: `
    <div class="bf-table-scroll bf-export-lines">
      @if (payroll()) {
        <table class="bf-table" [attr.aria-label]="label()">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Entity</th>
              <th>Benefit (tax year)</th>
              <th class="bf-num">Reportable</th>
            </tr>
          </thead>
          <tbody>
            @for (l of lines(); track l.lineNo) {
              <tr>
                <td>
                  {{ l.personName }}
                  @if (l.alreadyExported) {
                    <span class="bf-cell__secondary"
                      >Already exported{{ l.exportedIn ? ' in ' + l.exportedIn : '' }}</span
                    >
                  }
                </td>
                <td>{{ l.legalEntityCode }}</td>
                <td>
                  {{ l.benefit }}
                  @if (l.taxYear; as y) {
                    <span class="bf-cell__secondary"
                      >{{ y.fromDate | date: 'd MMM y' }} – {{ y.toDate | date: 'd MMM y' }}</span
                    >
                  }
                </td>
                <td class="bf-num">
                  @if (l.reportable; as r) {
                    <bf-money [amountMinor]="r.amountMinor" [currency]="r.currency" />
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      } @else {
        <table class="bf-table" [attr.aria-label]="label()">
          <thead>
            <tr>
              <th>Entity</th>
              <th>Account</th>
              <th>Cost center</th>
              <th>Event code</th>
              <th>Description</th>
              <th class="bf-num">Debit</th>
              <th class="bf-num">Credit</th>
              <th class="bf-num">Transaction</th>
              <th class="bf-num">Reporting rate</th>
            </tr>
          </thead>
          <tbody>
            @for (l of lines(); track l.lineNo) {
              <tr [class.bf-export-line--unmapped]="!l.account">
                <td>
                  {{ l.legalEntityCode }}
                  <span class="bf-cell__secondary">{{ l.periodLabel }}</span>
                </td>
                <td>
                  @if (l.account) {
                    {{ l.account }}
                    <span class="bf-cell__secondary">{{ l.accountName }}</span>
                  } @else {
                    <span class="bf-export-unmapped">No account mapping</span>
                  }
                </td>
                <td>{{ l.costCenter ?? '–' }}</td>
                <td>{{ l.eventCode ?? '–' }}</td>
                <td>
                  {{ l.description }}
                  @if (l.alreadyExported) {
                    <span class="bf-cell__secondary"
                      >Already exported{{ l.exportedIn ? ' in ' + l.exportedIn : '' }}</span
                    >
                  }
                </td>
                <td class="bf-num">
                  @if (l.debit.amountMinor) {
                    <bf-money [amountMinor]="l.debit.amountMinor" [currency]="l.debit.currency" />
                  }
                </td>
                <td class="bf-num">
                  @if (l.credit.amountMinor) {
                    <bf-money [amountMinor]="l.credit.amountMinor" [currency]="l.credit.currency" />
                  }
                </td>
                <td class="bf-num">
                  <bf-money
                    [amountMinor]="l.transaction.amountMinor"
                    [currency]="l.transaction.currency"
                  />
                </td>
                <td class="bf-num">{{ rateText(l.rate) }}</td>
              </tr>
            }
          </tbody>
          @if (totals(); as t) {
            <tfoot>
              <tr>
                <th colspan="5" scope="row">Total</th>
                <td class="bf-num">
                  <bf-money [amountMinor]="t.debit.amountMinor" [currency]="t.debit.currency" />
                </td>
                <td class="bf-num">
                  <bf-money [amountMinor]="t.credit.amountMinor" [currency]="t.credit.currency" />
                </td>
                <td colspan="2"></td>
              </tr>
            </tfoot>
          }
        </table>
      }
    </div>
  `,
  styles: `
    .bf-export-lines {
      max-height: 320px;
      overflow: auto;
    }
    .bf-export-lines table {
      min-width: 880px;
    }
    .bf-export-lines th,
    .bf-export-lines .bf-num {
      white-space: nowrap;
    }
    .bf-export-lines th,
    .bf-export-lines td {
      padding-inline: 8px;
    }
    .bf-export-unmapped {
      color: var(--mat-sys-error);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FinanceExportLines {
  readonly lines = input.required<FinanceExportLine[]>();
  readonly payroll = input(false);
  readonly totals = input<{
    debit: { amountMinor: number; currency: string };
    credit: { amountMinor: number; currency: string };
  } | null>(null);
  readonly label = input('Export lines');

  /** `1.000000000000` → `1`, `0.012000000000` → `0.012`: the stored rate without trailing zeros. */
  protected rateText(rate: string | null): string {
    if (!rate) return '–';
    return rate.includes('.') ? rate.replace(/0+$/, '').replace(/\.$/, '') : rate;
  }
}

/**
 * 094b New export: type, month, legal entity and "Include items already exported", with the lines the
 * API would export and its balance check. Create and send stays disabled until the export balances
 * (payroll: totals per person), and a re-send needs a reason.
 */
@Component({
  selector: 'bf-new-finance-export-dialog',
  imports: [
    FinanceExportLines,
    DatePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    Money,
    SAT_BANNER_IMPORTS,
    SatImportantButton,
  ],
  template: `
    <h2 mat-dialog-title>New export</h2>
    <mat-dialog-content class="bf-export-dialog">
      <div class="bf-form bf-export-dialog__filters">
        <mat-form-field appearance="outline">
          <mat-label>Type</mat-label>
          <mat-select [ngModel]="type()" (ngModelChange)="type.set($event)" name="type">
            @for (t of types; track t.value) {
              <mat-option [value]="t.value">{{ t.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Period</mat-label>
          <mat-select [ngModel]="period()" (ngModelChange)="period.set($event)" name="period">
            @for (p of d.periods; track p.value) {
              <mat-option [value]="p.value">{{ p.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Legal entity</mat-label>
          <mat-select [ngModel]="entity()" (ngModelChange)="entity.set($event)" name="entity">
            @if (type() !== 'payroll_benefits') {
              <mat-option [value]="''">All entities</mat-option>
            }
            @for (e of d.entities; track e.id) {
              <mat-option [value]="e.id">{{ e.code }}</mat-option>
            }
          </mat-select>
          @if (type() === 'payroll_benefits') {
            <mat-hint>Payroll exports go to one entity's payroll.</mat-hint>
          }
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Target</mat-label>
          <mat-select [ngModel]="'file'" name="target" disabled>
            <mat-option value="file">File (CSV and XLSX)</mat-option>
          </mat-select>
          <mat-hint>ERP connector delivery is planned.</mat-hint>
        </mat-form-field>
      </div>
      <mat-slide-toggle
        [ngModel]="includeExported()"
        (ngModelChange)="includeExported.set($event)"
        name="include"
        >Include items already exported</mat-slide-toggle
      >

      @if (needsEntity()) {
        <sat-banner variant="info" class="bf-banner">
          <sat-banner-message
            >Choose the legal entity whose payroll receives the export.</sat-banner-message
          >
        </sat-banner>
      } @else {
        <bf-load-state
          [loading]="preview.isLoading()"
          [error]="preview.error()"
          what="the export preview"
          (retry)="preview.reload()"
        />
        @if (!preview.isLoading() && valueOf(preview); as p) {
          @if (p.nothingToExport) {
            <sat-banner variant="info" class="bf-banner" data-testid="export-nothing">
              <sat-banner-message>{{ p.message }}</sat-banner-message>
            </sat-banner>
          } @else {
            @if (p.duplicates > 0) {
              <sat-banner variant="warning" class="bf-banner" data-testid="export-reexport">
                <sat-banner-message>{{ reexportWarning() }}</sat-banner-message>
              </sat-banner>
            }
            @if (p.problem) {
              <sat-banner variant="important" class="bf-banner" data-testid="export-balance">
                <sat-banner-message>{{ p.problem }}</sat-banner-message>
              </sat-banner>
            } @else if (p.type === 'payroll_benefits') {
              <p class="bf-export-check" data-testid="export-balance">
                {{ p.personTotals.length }}
                {{ p.personTotals.length === 1 ? 'person' : 'people' }}:
                @for (t of p.personTotals; track t.personId; let last = $last) {
                  {{ t.personName }}
                  <bf-money
                    [amountMinor]="t.reportable.amountMinor"
                    [currency]="t.reportable.currency"
                  />{{ last ? '' : ';' }}
                }
              </p>
            } @else {
              <sat-banner variant="success" class="bf-banner" data-testid="export-balance">
                <sat-banner-message
                  >Debits equal credits:
                  <bf-money
                    [amountMinor]="p.debitTotal.amountMinor"
                    [currency]="p.debitTotal.currency"
                  />
                  in {{ p.lineCount }}
                  {{ p.lineCount === 1 ? 'line' : 'lines' }}.</sat-banner-message
                >
              </sat-banner>
            }
            <bf-finance-export-lines
              [lines]="p.lines"
              [payroll]="p.type === 'payroll_benefits'"
              [totals]="
                p.type === 'payroll_benefits'
                  ? null
                  : { debit: p.debitTotal, credit: p.creditTotal }
              "
              label="Preview lines"
            />
            @if (p.duplicates > 0) {
              <mat-form-field appearance="outline" class="bf-export-reason">
                <mat-label>Reason for sending again</mat-label>
                <textarea
                  matInput
                  rows="2"
                  [ngModel]="reason()"
                  (ngModelChange)="reason.set($event)"
                  name="reason"
                ></textarea>
                <mat-hint>Recorded in the audit log and flagged to the receiving system.</mat-hint>
              </mat-form-field>
            }
          }
        }
      }
      @if (failure()) {
        <sat-banner variant="important" class="bf-banner"
          ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
        >
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button
        satImportantButton
        mat-flat-button
        type="button"
        [disabled]="!canCreate() || busy()"
        (click)="create()"
      >
        Create and send
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    // minmax(0, 1fr): the wide lines table scrolls inside its own container instead of widening the dialog.
    .bf-export-dialog {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 12px;
    }
    // Floating labels need room under the dialog title; fields wrap on narrow screens.
    .bf-export-dialog__filters {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 4px 16px;
      padding: 8px 0 0;
    }
    .bf-export-check {
      margin: 0;
      font: var(--mat-sys-body-medium);
    }
    .bf-export-reason {
      width: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewFinanceExportDialog {
  protected readonly valueOf = valueOf;
  protected readonly d = inject<NewExportData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<NewFinanceExportDialog, FinanceExportDetail>);
  private readonly api = injectApi();
  protected readonly types = EXPORT_TYPES;
  protected readonly type = signal<FinanceExportType>(this.d.type ?? 'intercompany_recharges');
  protected readonly period = signal(this.d.period);
  protected readonly entity = signal(this.d.legalEntityId ?? '');
  protected readonly includeExported = signal(this.d.includeExported ?? false);
  protected readonly reason = signal('');
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly needsEntity = computed(
    () => this.type() === 'payroll_benefits' && !this.entity(),
  );

  protected readonly preview = resource({
    params: () =>
      this.needsEntity()
        ? undefined
        : {
            type: this.type(),
            period: this.period(),
            entity: this.entity(),
            include: this.includeExported(),
          },
    loader: ({ params }) =>
      data(
        this.api.previewFinanceExport({
          query: {
            type: params.type,
            period: params.period,
            ...(params.entity ? { legalEntityId: params.entity } : {}),
            ...(params.include ? { includeExported: 'true' as const } : {}),
          },
        }),
      ),
  });

  protected readonly canCreate = computed(() => {
    const p = valueOf(this.preview);
    if (!p || this.preview.isLoading() || !p.canCreate) return false;
    return p.duplicates === 0 || this.reason().trim().length >= 5;
  });

  /** "EXP-2026-0141 was acknowledged on 2 Nov. Sending again can create duplicates in the ERP." */
  protected readonly reexportWarning = computed(() => {
    const p = valueOf(this.preview);
    const prev = p?.previousExports ?? [];
    const fmt = (iso: string) =>
      new Date(iso).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      });
    const said = prev.map((e) =>
      e.postedAt
        ? `${e.number} was posted on ${fmt(e.postedAt)}`
        : e.acknowledgedAt
          ? `${e.number} was acknowledged on ${fmt(e.acknowledgedAt)}`
          : e.sentAt
            ? `${e.number} was sent on ${fmt(e.sentAt)}`
            : `${e.number} was created`,
    );
    const target = this.type() === 'payroll_benefits' ? 'payroll' : 'the ERP';
    return `${said.join('; ') || 'These items were exported before'}. Sending again can create duplicates in ${target}.`;
  });

  protected async create(): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      const p = valueOf(this.preview);
      const created = await data(
        this.api.createFinanceExport({
          body: {
            type: this.type(),
            period: this.period(),
            ...(this.entity() ? { legalEntityId: this.entity() } : {}),
            includeExported: this.includeExported(),
            ...(p && p.duplicates > 0 ? { reason: this.reason().trim() } : {}),
          },
        }),
      );
      this.ref.close(created);
    } catch (e) {
      this.failure.set(errorMessage(e));
      this.preview.reload();
    } finally {
      this.busy.set(false);
    }
  }
}

/** 094b Mark posted: the document number the ERP or payroll gave the posting. */
@Component({
  selector: 'bf-mark-export-posted-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    SAT_BANNER_IMPORTS,
    SatImportantButton,
  ],
  template: `
    <h2 mat-dialog-title>Mark {{ d.number }} posted</h2>
    <mat-dialog-content>
      <p class="bf-export-note">
        Record that {{ d.type === 'payroll_benefits' ? 'payroll' : 'the ERP' }} posted this export.
        It does not change any balance in BudgetFlow.
      </p>
      <mat-form-field appearance="outline" class="bf-export-doc">
        <mat-label>ERP document number</mat-label>
        <input matInput [ngModel]="doc()" (ngModelChange)="doc.set($event)" name="doc" />
      </mat-form-field>
      @if (failure()) {
        <sat-banner variant="important" class="bf-banner"
          ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
        >
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button
        satImportantButton
        mat-flat-button
        type="button"
        [disabled]="!doc().trim() || busy()"
        (click)="save()"
      >
        Mark posted
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .bf-export-note {
      margin: 0 0 12px;
    }
    .bf-export-doc {
      width: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkExportPostedDialog {
  protected readonly d = inject<FinanceExportSummary>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<MarkExportPostedDialog, FinanceExportSummary>);
  private readonly api = injectApi();
  protected readonly doc = signal('');
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);

  protected async save(): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      this.ref.close(
        await data(
          this.api.markFinanceExportPosted({
            params: { exportId: this.d.id },
            body: { erpDocumentNumber: this.doc().trim() },
          }),
        ),
      );
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}

/** 094b View lines: the lines an export carried, with their journal links. */
@Component({
  selector: 'bf-finance-export-lines-dialog',
  imports: [FinanceExportLines, LoadState, MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>{{ d.number }} · {{ typeName }}</h2>
    <mat-dialog-content>
      <bf-load-state
        [loading]="detail.isLoading()"
        [error]="detail.error()"
        what="the export lines"
        (retry)="detail.reload()"
      />
      @if (valueOf(detail); as x) {
        <bf-finance-export-lines
          [lines]="x.lines"
          [payroll]="x.export.type === 'payroll_benefits'"
          [totals]="
            x.export.type === 'payroll_benefits'
              ? null
              : { debit: x.export.debitTotal, credit: x.export.creditTotal }
          "
          [label]="d.number + ' lines'"
        />
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FinanceExportLinesDialog {
  protected readonly valueOf = valueOf;
  protected readonly d = inject<FinanceExportSummary>(MAT_DIALOG_DATA);
  private readonly api = injectApi();
  protected readonly typeName = typeLabel(this.d.type);
  protected readonly detail = resource({
    loader: () => data(this.api.getFinanceExport({ params: { exportId: this.d.id } })),
  });
}
