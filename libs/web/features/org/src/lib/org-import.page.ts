import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import type { OrgImportResult } from '@bf/contracts';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, todayIso } from './api';
import { CsvInput } from './csv-input';

const EXAMPLE =
  'code,name,kind,parent_code,legal_entity_code,timezone\nBLR-ENG-DATA,Data Platform Team,team,BLR-ENG,,';

/** Screens 9 and 42: initial org hierarchy import and later synchronization from a CSV file. */
@Component({
  selector: 'bf-org-import-page',
  imports: [
    CsvInput,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatTableModule,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <a mat-button routerLink="/org" class="bf-back">Back to organization</a>
        <h1 class="bf-page__title">Import the org hierarchy</h1>
        <p class="bf-page__subtitle">
          Create, rename and move units from one effective date. Existing history is kept; kinds
          never change through an import.
        </p>
      </div>
    </header>
    @if (notice()) {
      <sat-banner variant="success"
        ><sat-banner-message>{{ notice() }}</sat-banner-message></sat-banner
      >
    }
    <section class="bf-card" aria-labelledby="file-title">
      <div class="bf-card__header">
        <h2 class="bf-card__title" id="file-title">File</h2>
      </div>
      <div class="bf-card__body">
        <mat-form-field appearance="outline">
          <mat-label>Effective from</mat-label>
          <input
            matInput
            type="date"
            required
            [ngModel]="effectiveFrom()"
            (ngModelChange)="effectiveFrom.set($event); result.set(null)"
            data-testid="effective-from"
          />
        </mat-form-field>
        <bf-csv-input
          [value]="csv()"
          (valueChange)="csv.set($event); result.set(null)"
          columns="code, name, kind (company, business_unit, region, location, department, team), parent_code, legal_entity_code (optional), timezone (optional)"
          [example]="example"
        />
        <mat-form-field appearance="outline" class="bf-reason">
          <mat-label>Reason (optional)</mat-label>
          <input matInput [ngModel]="reason()" (ngModelChange)="reason.set($event)" />
        </mat-form-field>
      </div>
      @if (failure()) {
        <sat-banner variant="important" class="bf-banner"
          ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
        >
      }
      @if (result(); as r) {
        <sat-banner [variant]="r.accepted ? 'info' : 'important'" class="bf-banner">
          <sat-banner-message>
            @if (r.accepted) {
              Ready: {{ r.created }} to create, {{ r.changed }} to change,
              {{ r.unchanged }} unchanged.
            } @else {
              The file has {{ r.issues.length }} problem(s). Nothing will be imported until they are
              fixed.
            }
          </sat-banner-message>
        </sat-banner>
        @if (r.issues.length) {
          <div class="bf-table-scroll">
            <table mat-table [dataSource]="r.issues" aria-label="Problems in the file">
              <ng-container matColumnDef="line">
                <th mat-header-cell *matHeaderCellDef>Line</th>
                <td mat-cell *matCellDef="let i">{{ i.line }}</td>
              </ng-container>
              <ng-container matColumnDef="field">
                <th mat-header-cell *matHeaderCellDef>Column</th>
                <td mat-cell *matCellDef="let i">{{ i.field ?? '—' }}</td>
              </ng-container>
              <ng-container matColumnDef="message">
                <th mat-header-cell *matHeaderCellDef>Problem</th>
                <td mat-cell *matCellDef="let i">{{ i.message }}</td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="issueColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: issueColumns"></tr>
            </table>
          </div>
        }
        <div class="bf-table-scroll">
          <table mat-table [dataSource]="r.operations" aria-label="Planned changes">
            <ng-container matColumnDef="line">
              <th mat-header-cell *matHeaderCellDef>Line</th>
              <td mat-cell *matCellDef="let o">{{ o.line }}</td>
            </ng-container>
            <ng-container matColumnDef="op">
              <th mat-header-cell *matHeaderCellDef>Action</th>
              <td mat-cell *matCellDef="let o">
                <sat-status-tag
                  [status]="
                    o.op === 'create' ? 'success' : o.op === 'change' ? 'warning' : 'neutral-quiet'
                  "
                  [hideIcon]="true"
                >
                  {{ o.op === 'create' ? 'Create' : o.op === 'change' ? 'Change' : 'No change' }}
                </sat-status-tag>
              </td>
            </ng-container>
            <ng-container matColumnDef="code">
              <th mat-header-cell *matHeaderCellDef>Code</th>
              <td mat-cell *matCellDef="let o">{{ o.code }}</td>
            </ng-container>
            <ng-container matColumnDef="name">
              <th mat-header-cell *matHeaderCellDef>Name</th>
              <td mat-cell *matCellDef="let o">{{ o.name ?? '—' }}</td>
            </ng-container>
            <ng-container matColumnDef="parent">
              <th mat-header-cell *matHeaderCellDef>Parent</th>
              <td mat-cell *matCellDef="let o">{{ o.parentCode ?? '—' }}</td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="opColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: opColumns"></tr>
          </table>
        </div>
      }
      <div class="bf-form__actions">
        <button
          mat-stroked-button
          type="button"
          (click)="run(true)"
          [disabled]="busy() || !csv().trim()"
        >
          Validate
        </button>
        <button
          mat-flat-button
          type="button"
          (click)="run(false)"
          [disabled]="busy() || !result()?.accepted"
        >
          Import
        </button>
      </div>
    </section>
  `,
  styleUrl: './page.scss',
  styles: `
    .bf-back {
      align-self: flex-start;
      margin-inline-start: -12px;
    }
    .bf-reason {
      width: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgImportPage {
  private readonly api = injectApi();
  protected readonly example = EXAMPLE;
  protected readonly issueColumns = ['line', 'field', 'message'];
  protected readonly opColumns = ['line', 'op', 'code', 'name', 'parent'];
  protected readonly csv = signal('');
  protected readonly effectiveFrom = signal(todayIso());
  protected readonly reason = signal('');
  protected readonly result = signal<OrgImportResult | null>(null);
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected async run(dryRun: boolean): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      const r = await data(
        this.api.importOrgUnits({
          body: {
            csv: this.csv(),
            effectiveFrom: this.effectiveFrom(),
            dryRun,
            ...(this.reason().trim() ? { reason: this.reason().trim() } : {}),
          },
        }),
      );
      if (dryRun) {
        this.result.set(r);
      } else {
        this.notice.set(
          `Imported: ${r.created} created and ${r.changed} changed, effective ${r.effectiveFrom}.`,
        );
        this.result.set(null);
        this.csv.set('');
      }
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
