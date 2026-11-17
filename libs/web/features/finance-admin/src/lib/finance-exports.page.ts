import { DatePipe, DOCUMENT } from '@angular/common';
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
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import type {
  FinanceExportDetail,
  FinanceExportFormat,
  FinanceExportStatus,
  FinanceExportSummary,
} from '@bf/contracts';
import { LoadState, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import {
  FinanceExportLinesDialog,
  MarkExportPostedDialog,
  NewFinanceExportDialog,
  typeLabel,
  type NewExportData,
} from './finance-export-dialogs';

const STATUS: Record<
  FinanceExportStatus,
  { label: string; tag: 'neutral' | 'info' | 'success' | 'important' | 'warning' }
> = {
  draft: { label: 'Draft', tag: 'neutral' },
  sent: { label: 'Sent', tag: 'info' },
  acknowledged: { label: 'Acknowledged', tag: 'info' },
  posted: { label: 'Posted', tag: 'success' },
  failed: { label: 'Failed', tag: 'important' },
};

/**
 * Screen 094b: finance and payroll exports by month. Each export hands the ERP or payroll entries
 * BudgetFlow already posted (intercompany recharges, chargeback and reclass journals, reportable
 * employee benefits) as a balanced, period-stamped CSV and XLSX file; an item is exported once and a
 * re-send needs a reason. Exports never change a balance. Built from the written spec (decision D2).
 */
@Component({
  selector: 'bf-finance-exports-page',
  host: { class: 'bf-page-layout' },
  imports: [
    DatePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatMenuModule,
    MatSelectModule,
    Money,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatImportantButton,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Finance exports</h1>
        <p class="bf-page__subtitle">
          Balanced, period-stamped files of the entries BudgetFlow posted, for the ERP and payroll.
          Each item is exported once; exports never change a balance.
        </p>
      </div>
    </header>
    <div class="bf-exports__toolbar" role="toolbar" aria-label="Exports">
      <mat-form-field appearance="outline" subscriptSizing="dynamic">
        <mat-label>Period</mat-label>
        <mat-select
          [ngModel]="period() ?? valueOf(list)?.period"
          (ngModelChange)="period.set($event)"
          name="period"
        >
          @for (p of periods(); track p.value) {
            <mat-option [value]="p.value">{{ p.label }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      @if (valueOf(list)?.canCreate) {
        <button mat-flat-button type="button" class="bf-exports__create" (click)="newExport()">
          <mat-icon svgIcon="circle_add" aria-hidden="true" />New export
        </button>
      }
    </div>

    @if (failure()) {
      <sat-banner variant="important" class="bf-banner"
        ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
      >
    }

    <section class="bf-card" aria-labelledby="exports-title">
      <div class="bf-card__header">
        <div>
          <h2 class="bf-card__title" id="exports-title">
            Exports for {{ valueOf(list)?.periodLabel ?? 'the period' }}
          </h2>
          <p class="bf-card__hint">
            Debits and credits in
            {{ valueOf(list)?.reportingCurrency ?? 'the reporting currency' }}; payroll exports
            total the reportable amount per person.
          </p>
        </div>
      </div>
      <bf-load-state
        [loading]="list.isLoading() && !list.hasValue()"
        [error]="list.error()"
        what="the exports"
        (retry)="list.reload()"
      />
      @if (valueOf(list); as l) {
        @if (l.items.length === 0) {
          <sat-empty-state class="bf-exports__empty">
            <h3 satEmptyStateHeadline>No exports for {{ l.periodLabel }}</h3>
            <p satEmptyStateDescription>
              @if (l.canCreate) {
                Create one to hand this month's recharges, chargebacks and reclasses, or payroll
                benefits, to the ERP and payroll.
              } @else {
                Exports appear here when finance sends them.
              }
            </p>
            @if (l.canCreate) {
              <button satEmptyStateAction mat-stroked-button type="button" (click)="newExport()">
                New export
              </button>
            }
          </sat-empty-state>
        } @else {
          <div class="bf-table-scroll">
            <table class="bf-table bf-table--stack bf-exports" aria-labelledby="exports-title">
              <thead>
                <tr>
                  <th>Export</th>
                  <th>Type</th>
                  <th>Entity</th>
                  <th class="bf-num">Lines</th>
                  <th class="bf-num">Debit</th>
                  <th class="bf-num">Credit</th>
                  <th>Target</th>
                  <th>Status</th>
                  <th>Created by</th>
                  <th>Sent</th>
                  <th class="bf-col-actions"><span class="bf-sr">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                @for (x of l.items; track x.id) {
                  <tr>
                    <td class="bf-cell--full bf-nowrap">
                      {{ x.number }}
                      @if (x.duplicate) {
                        <span class="bf-cell__secondary"
                          >Duplicate send: {{ x.duplicateReason }}</span
                        >
                      }
                    </td>
                    <td data-label="Type">{{ typeName(x) }}</td>
                    <td data-label="Entity">{{ x.entityLabel }}</td>
                    <td class="bf-num" data-label="Lines">
                      {{ x.lineCount }}
                      @if (x.personCount !== null) {
                        <span class="bf-cell__secondary"
                          >{{ x.personCount }} {{ x.personCount === 1 ? 'person' : 'people' }}</span
                        >
                      }
                    </td>
                    @if (x.reportableTotal; as r) {
                      <td class="bf-num" data-label="Reportable" colspan="2">
                        <bf-money [amountMinor]="r.amountMinor" [currency]="r.currency" />
                        <span class="bf-cell__secondary">reportable</span>
                      </td>
                    } @else {
                      <td class="bf-num" data-label="Debit">
                        <bf-money
                          [amountMinor]="x.debitTotal.amountMinor"
                          [currency]="x.debitTotal.currency"
                        />
                      </td>
                      <td class="bf-num" data-label="Credit">
                        <bf-money
                          [amountMinor]="x.creditTotal.amountMinor"
                          [currency]="x.creditTotal.currency"
                        />
                      </td>
                    }
                    <td data-label="Target">File</td>
                    <td data-label="Status">
                      <sat-status-tag [status]="status[x.status].tag">{{
                        status[x.status].label
                      }}</sat-status-tag>
                      @if (x.erpDocumentNumber) {
                        <span class="bf-cell__secondary">{{ x.erpDocumentNumber }}</span>
                      }
                      @if (x.failureMessage) {
                        <span class="bf-cell__secondary">{{ x.failureMessage }}</span>
                      }
                    </td>
                    <td data-label="Created by">{{ x.createdByName ?? '–' }}</td>
                    <td data-label="Sent" class="bf-nowrap">
                      {{ x.sentAt ? (x.sentAt | date: 'd MMM y, HH:mm') : '–' }}
                    </td>
                    <td class="bf-col-actions">
                      @if (x.canDownload || x.canMarkPosted) {
                        <button
                          mat-icon-button
                          type="button"
                          [matMenuTriggerFor]="menu"
                          [attr.aria-label]="'Actions for ' + x.number"
                        >
                          <mat-icon svgIcon="more_vert" aria-hidden="true" />
                        </button>
                        <mat-menu #menu="matMenu">
                          @if (x.canDownload) {
                            <button mat-menu-item type="button" (click)="download(x, 'csv')">
                              Download CSV
                            </button>
                            <button mat-menu-item type="button" (click)="download(x, 'xlsx')">
                              Download XLSX
                            </button>
                            <button mat-menu-item type="button" (click)="viewLines(x)">
                              View lines
                            </button>
                          }
                          @if (x.canResend) {
                            <button mat-menu-item type="button" (click)="resend(x)">Resend</button>
                          }
                          @if (x.canMarkPosted) {
                            <button mat-menu-item type="button" (click)="markPosted(x)">
                              Mark posted
                            </button>
                          }
                        </mat-menu>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    </section>
  `,
  styles: `
    .bf-exports__empty {
      display: block;
      padding-bottom: 24px;
    }
    .bf-exports__toolbar {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    // Wide enough to read on tablet (the scroll container scrolls); phones stack the rows instead.
    @media (width >= 600px) {
      .bf-exports {
        min-width: 1100px;
      }
    }
  `,
  styleUrl: './page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FinanceExportsPage {
  protected readonly valueOf = valueOf;
  private readonly api = injectApi();
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly document = inject(DOCUMENT);
  protected readonly status = STATUS;
  protected readonly period = signal<string | undefined>(undefined);
  protected readonly failure = signal<string | null>(null);

  protected readonly list = resource({
    params: () => ({ period: this.period() }),
    loader: ({ params }) =>
      data(this.api.listFinanceExports({ query: params.period ? { period: params.period } : {} })),
  });
  private readonly entities = resource({
    loader: async () => (await data(this.api.listLegalEntities({}))).items,
  });
  protected readonly periods = computed(() => valueOf(this.list)?.periods ?? []);

  protected typeName(x: FinanceExportSummary): string {
    return typeLabel(x.type);
  }

  private dialogData(extra: Partial<NewExportData> = {}): NewExportData {
    const l = valueOf(this.list);
    return {
      period: l?.period ?? this.period() ?? '',
      periods: l?.periods ?? [],
      entities: (valueOf(this.entities) ?? [])
        .map((e) => ({ id: e.id, code: e.code }))
        .sort((a, b) => a.code.localeCompare(b.code)),
      ...extra,
    };
  }

  private openNew(extra: Partial<NewExportData> = {}): void {
    this.dialog
      .open<NewFinanceExportDialog, NewExportData, FinanceExportDetail>(NewFinanceExportDialog, {
        data: this.dialogData(extra),
        width: '1040px',
        maxWidth: '96vw',
        autoFocus: 'first-tabbable',
      })
      .afterClosed()
      .subscribe((created) => {
        if (!created) return;
        this.snack.open(
          `${created.export.number} created: ${created.export.lineCount} ${created.export.lineCount === 1 ? 'line' : 'lines'}, ready to download.`,
          'Close',
          { duration: 6000 },
        );
        if (created.export.period !== this.period()) this.period.set(created.export.period);
        else this.list.reload();
      });
  }

  protected newExport(): void {
    this.openNew();
  }

  protected resend(x: FinanceExportSummary): void {
    this.openNew({
      type: x.type,
      period: x.period,
      legalEntityId: x.legalEntityId,
      includeExported: true,
    });
  }

  protected markPosted(x: FinanceExportSummary): void {
    this.dialog
      .open<MarkExportPostedDialog, FinanceExportSummary, FinanceExportSummary>(
        MarkExportPostedDialog,
        { data: x, width: '480px' },
      )
      .afterClosed()
      .subscribe((done) => {
        if (!done) return;
        this.snack.open(`${done.number} marked posted as ${done.erpDocumentNumber}.`, 'Close', {
          duration: 5000,
        });
        this.list.reload();
      });
  }

  protected viewLines(x: FinanceExportSummary): void {
    this.dialog.open(FinanceExportLinesDialog, { data: x, width: '1040px', maxWidth: '96vw' });
  }

  protected async download(x: FinanceExportSummary, format: FinanceExportFormat): Promise<void> {
    this.failure.set(null);
    try {
      const link = await data(
        this.api.getFinanceExportDownload({ params: { exportId: x.id }, query: { format } }),
      );
      const a = this.document.createElement('a');
      a.href = link.url;
      a.download = link.fileName;
      a.rel = 'noopener';
      a.click();
      this.snack.open(`Downloading ${link.fileName}.`, 'Close', { duration: 4000 });
    } catch (e) {
      this.failure.set(errorMessage(e));
    }
  }
}
