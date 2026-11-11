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
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { Router } from '@angular/router';
import type { BudgetDetail, RollForwardResult } from '@bf/contracts';
import { Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { data, errorCode, errorMessage, injectApi, valueOf } from './api';

const BUCKETS = [
  { key: 'allocated_out', label: 'Allocated to children' },
  { key: 'held', label: 'Held' },
  { key: 'pre_encumbered', label: 'Pending requests' },
  { key: 'encumbered', label: 'Encumbered' },
  { key: 'actual', label: 'Actual' },
] as const;
type Bucket = (typeof BUCKETS)[number]['key'];

/** Control basis, mode and tolerance (parent owner or finance) and owner alert thresholds. */
@Component({
  selector: 'bf-settings-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    SAT_BANNER_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  styleUrl: './dialogs.scss',
  template: `
    <div mat-dialog-title class="bf-dialog__head">
      <span class="bf-dialog__icon"><mat-icon svgIcon="shield" aria-hidden="true" /></span>
      <div>
        <h2 class="bf-dialog__title">Controls and alerts</h2>
        <p class="bf-dialog__subtitle">{{ b.name }} · {{ b.currency }}</p>
      </div>
      <button
        mat-icon-button
        type="button"
        class="bf-dialog__close"
        mat-dialog-close
        aria-label="Close"
      >
        <mat-icon svgIcon="x_small" aria-hidden="true" />
      </button>
    </div>
    <mat-dialog-content>
      <p class="bf-dialog__section-title">Owner alert thresholds</p>
      <p class="bf-note">
        The owner is alerted when utilization (encumbered + actual) reaches each threshold.
      </p>
      <mat-button-toggle-group
        multiple
        [value]="thresholds()"
        (change)="thresholds.set($event.value)"
        aria-label="Alert thresholds"
        style="margin: 8px 0 16px"
      >
        @for (t of [50, 75, 80, 90, 100]; track t) {
          <mat-button-toggle [value]="t">{{ t }}%</mat-button-toggle>
        }
      </mat-button-toggle-group>
      <p class="bf-dialog__section-title">Control</p>
      @if (!canGovern) {
        <p class="bf-note">The owner of the parent budget or finance sets the control mode.</p>
      }
      <mat-button-toggle-group
        [value]="mode()"
        (change)="mode.set($event.value)"
        [disabled]="!canGovern"
        aria-label="Control mode"
      >
        <mat-button-toggle value="hard">Hard</mat-button-toggle>
        <mat-button-toggle value="soft">Soft</mat-button-toggle>
        <mat-button-toggle value="track">Track</mat-button-toggle>
      </mat-button-toggle-group>
      <p class="bf-note">
        {{
          mode() === 'hard'
            ? 'Hard: requests beyond available (plus tolerance) are blocked.'
            : mode() === 'soft'
              ? 'Soft: requests beyond available show a warning and can proceed.'
              : 'Track: amounts are recorded; nothing is blocked.'
        }}
      </p>
      <mat-form-field class="bf-field" style="margin-top: 12px">
        <mat-label>Overrun tolerance (%)</mat-label>
        <input
          matInput
          type="number"
          min="0"
          max="100"
          step="0.5"
          [ngModel]="tolerancePct()"
          (ngModelChange)="tolerancePct.set(+$event)"
          [disabled]="!canGovern"
        />
      </mat-form-field>
      <p class="bf-dialog__section-title">Counted against available (control basis)</p>
      @for (k of buckets; track k.key) {
        <mat-checkbox
          [checked]="basis().includes(k.key)"
          (change)="toggle(k.key, $event.checked)"
          [disabled]="!canGovern || k.key === 'allocated_out'"
          >{{ k.label }}</mat-checkbox
        >
      }
      <mat-form-field class="bf-field" style="margin-top: 12px">
        <mat-label>Reason for the change</mat-label>
        <input matInput [(ngModel)]="reason" />
      </mat-form-field>
    </mat-dialog-content>
    <div class="bf-dialog__status" aria-live="polite">
      @if (failure()) {
        <sat-banner variant="important" [border]="true"
          ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
        >
      }
    </div>
    <mat-dialog-actions align="end" class="bf-dialog__actions">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button
        mat-flat-button
        type="button"
        [disabled]="busy()"
        (click)="save()"
        data-testid="save-settings"
      >
        Save
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsDialog {
  private readonly api = injectApi();
  private readonly ref = inject(MatDialogRef<SettingsDialog, boolean>);
  protected readonly b = inject<{ budget: BudgetDetail }>(MAT_DIALOG_DATA).budget;
  protected readonly canGovern = this.b.allowedActions.includes('budget.control');
  protected readonly buckets = BUCKETS;
  protected readonly thresholds = signal<number[]>([...this.b.alertThresholdsPct]);
  protected readonly mode = signal(this.b.control.mode);
  protected readonly tolerancePct = signal(this.b.control.toleranceBps / 100);
  protected readonly basis = signal<Bucket[]>([...this.b.control.basis]);
  protected reason = '';
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);

  protected toggle(key: Bucket, on: boolean): void {
    this.basis.update((b) => (on ? [...new Set([...b, key])] : b.filter((x) => x !== key)));
  }

  protected async save(): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      await data(
        this.api.updateBudgetSettings({
          params: { budgetId: this.b.id },
          body: {
            expectedVersion: this.b.version,
            alertThresholdsPct: this.thresholds(),
            ...(this.canGovern
              ? {
                  control: {
                    basis: BUCKETS.map((k) => k.key).filter((k) => this.basis().includes(k)),
                    mode: this.mode(),
                    toleranceBps: Math.round(this.tolerancePct() * 100),
                  },
                }
              : {}),
            ...(this.reason.trim() ? { reason: this.reason.trim() } : {}),
          },
        }),
      );
      this.ref.close(true);
    } catch (e) {
      this.failure.set(
        errorCode(e) === 'VERSION_CONFLICT'
          ? 'Someone changed this budget after you opened it. Close this dialog to load the latest version, then try again.'
          : errorMessage(e),
      );
    } finally {
      this.busy.set(false);
    }
  }
}

/** Screen 23a: roll forward or clone last year's tree into another fiscal year under its plan version. */
@Component({
  selector: 'bf-roll-forward-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    Money,
    SAT_BANNER_IMPORTS,
  ],
  styleUrl: './dialogs.scss',
  template: `
    <div mat-dialog-title class="bf-dialog__head">
      <span class="bf-dialog__icon"><mat-icon svgIcon="redo" aria-hidden="true" /></span>
      <div>
        <h2 class="bf-dialog__title">Roll forward</h2>
        <p class="bf-dialog__subtitle">{{ b.name }} · into a new fiscal year</p>
      </div>
      <button
        mat-icon-button
        type="button"
        class="bf-dialog__close"
        mat-dialog-close
        aria-label="Close"
      >
        <mat-icon svgIcon="x_small" aria-hidden="true" />
      </button>
    </div>
    <mat-dialog-content>
      <p class="bf-note">
        Clones the tree (names, owners, cost centers, controls and per-head rules) into the target
        year. The new root ties to the plan version you choose.
      </p>
      <div class="bf-dialog__grid">
        <mat-form-field class="bf-field">
          <mat-label>Target fiscal year</mat-label>
          <mat-select [ngModel]="fy()" (ngModelChange)="fy.set($event); preview.set(null)">
            @for (y of years(); track y.id) {
              <mat-option [value]="y.id">{{ y.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field class="bf-field">
          <mat-label>Plan version</mat-label>
          <mat-select [ngModel]="pv()" (ngModelChange)="pv.set($event); preview.set(null)">
            @for (v of versions(); track v.id) {
              <mat-option [value]="v.id">{{ v.label }}</mat-option>
            }
          </mat-select>
          @if (fy() && versions().length === 0) {
            <mat-hint>Approve a plan version for that year first (Plans and versions).</mat-hint>
          }
        </mat-form-field>
        <mat-form-field class="bf-field">
          <mat-label>Amounts (% of this year)</mat-label>
          <input
            matInput
            type="number"
            min="0"
            max="1000"
            [ngModel]="scale()"
            (ngModelChange)="scale.set(+$event); preview.set(null)"
          />
          <mat-hint>100 copies the amounts; 0 copies the structure only.</mat-hint>
        </mat-form-field>
      </div>
      @if (preview(); as p) {
        <table mat-table [dataSource]="p.budgets" class="bf-table" style="margin-top: 12px">
          <ng-container matColumnDef="name">
            <th mat-header-cell *matHeaderCellDef>Budget</th>
            <td mat-cell *matCellDef="let r" [style.padding-inline-start.px]="16 + r.depth * 16">
              {{ r.name }}
            </td>
          </ng-container>
          <ng-container matColumnDef="amount">
            <th mat-header-cell *matHeaderCellDef class="bf-num">Amount</th>
            <td mat-cell *matCellDef="let r" class="bf-num">
              <bf-money [amountMinor]="r.amountMinor" [currency]="p.currency" />
            </td>
          </ng-container>
          <tr mat-header-row *matHeaderRowDef="['name', 'amount']"></tr>
          <tr mat-row *matRowDef="let row; columns: ['name', 'amount']"></tr>
        </table>
      }
    </mat-dialog-content>
    <div class="bf-dialog__status" aria-live="polite">
      @if (failure()) {
        <sat-banner variant="important" [border]="true"
          ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
        >
      }
    </div>
    <mat-dialog-actions align="end" class="bf-dialog__actions">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button mat-stroked-button type="button" [disabled]="busy() || !ready()" (click)="run(true)">
        Preview
      </button>
      <button
        mat-flat-button
        type="button"
        [disabled]="busy() || !preview()"
        (click)="run(false)"
        data-testid="confirm-roll-forward"
      >
        Roll forward
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RollForwardDialog {
  private readonly api = injectApi();
  private readonly router = inject(Router);
  private readonly ref = inject(MatDialogRef<RollForwardDialog, boolean>);
  protected readonly b = inject<{ budget: BudgetDetail }>(MAT_DIALOG_DATA).budget;
  protected readonly fy = signal<string | null>(null);
  protected readonly pv = signal<string | null>(null);
  protected readonly scale = signal(100);
  protected readonly preview = signal<RollForwardResult | null>(null);
  private readonly calendars = resource({
    loader: async () => (await data(this.api.listFiscalCalendars({}))).items,
  });
  protected readonly years = computed(() => {
    const all = valueOf(this.calendars) ?? [];
    const group = all.find((c) => c.years.some((y) => y.id === this.b.fiscalYearId));
    return (group?.years ?? []).filter((y) => y.id !== this.b.fiscalYearId);
  });
  private readonly versionsRes = resource({
    params: () => (this.fy() ? { fiscalYearId: this.fy()! } : undefined),
    loader: async ({ params }) => (await data(this.api.listPlanVersions({ query: params }))).items,
  });
  protected readonly versions = computed(() =>
    (valueOf(this.versionsRes) ?? []).filter(
      (v) => v.status === 'approved' && v.kind !== 'forecast',
    ),
  );
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly ready = computed(() => !!this.fy() && !!this.pv());

  protected async run(dryRun: boolean): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      const r = await data(
        this.api.rollForward({
          params: { budgetId: this.b.id },
          body: {
            targetFiscalYearId: this.fy()!,
            planVersionId: this.pv()!,
            scalePct: this.scale(),
            dryRun,
          },
        }),
      );
      if (dryRun) this.preview.set(r);
      else {
        this.ref.close(true);
        if (r.rootId) void this.router.navigate(['/budgets', r.rootId]);
      }
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
