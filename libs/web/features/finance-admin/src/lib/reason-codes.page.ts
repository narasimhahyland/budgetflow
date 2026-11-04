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
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTableModule } from '@angular/material/table';
import { REASON_CATEGORIES } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi } from './api';
import { LoadState } from './load-state';

type Category = (typeof REASON_CATEGORIES)[number];

const CATEGORY_LABEL: Record<Category, string> = {
  reduction: 'Reduce or set to zero',
  freeze: 'Freeze',
  transfer: 'Transfer',
  increase: 'Increase',
  reversal: 'Reversal',
  exception: 'Policy exception',
  rejection: 'Rejection',
  manual: 'Manual adjustment',
};

/** Screen 106b: reason-code taxonomy used by controls, corrections and decisions. */
@Component({
  selector: 'bf-reason-codes-page',
  imports: [
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTableModule,
    SAT_BANNER_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Reason codes</h1>
        <p class="bf-page__subtitle">
          Freeze, reduce, transfer, reversal and decision screens ask for one of these codes plus a
          typed reason.
        </p>
      </div>
      @if (canManage() && !adding()) {
        <button mat-flat-button type="button" (click)="adding.set(true); failure.set(null)">
          Add reason code
        </button>
      }
    </header>
    @if (notice()) {
      <sat-banner variant="success"
        ><sat-banner-message>{{ notice() }}</sat-banner-message></sat-banner
      >
    }
    @if (failure()) {
      <sat-banner variant="important"
        ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
      >
    }
    @if (adding()) {
      <section class="bf-card" aria-label="Add reason code">
        <form class="bf-form" (ngSubmit)="add()">
          <mat-form-field appearance="outline">
            <mat-label>Used for</mat-label>
            <mat-select name="cat" [ngModel]="category()" (ngModelChange)="category.set($event)">
              @for (c of categories; track c) {
                <mat-option [value]="c">{{ label[c] }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Code</mat-label>
            <input
              matInput
              required
              name="code"
              [ngModel]="code()"
              (ngModelChange)="code.set($event.toUpperCase())"
            />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Label</mat-label>
            <input
              matInput
              required
              name="label"
              [ngModel]="text()"
              (ngModelChange)="text.set($event)"
            />
          </mat-form-field>
          <div class="bf-form__wide bf-form__actions">
            <button mat-flat-button type="submit" [disabled]="busy() || !code() || !text()">
              Add
            </button>
            <button mat-button type="button" (click)="adding.set(false)">Cancel</button>
          </div>
        </form>
      </section>
    }
    <section class="bf-card" aria-labelledby="rc-title">
      <div class="bf-card__header">
        <h2 class="bf-card__title" id="rc-title">Taxonomy</h2>
        <mat-slide-toggle [ngModel]="showRetired()" (ngModelChange)="showRetired.set($event)"
          >Show retired codes</mat-slide-toggle
        >
      </div>
      <bf-load-state
        [loading]="list.isLoading() && !list.hasValue()"
        [error]="list.error()"
        what="reason codes"
        (retry)="list.reload()"
      />
      @if (list.value(); as l) {
        <div class="bf-table-scroll">
          <table mat-table [dataSource]="l.items" aria-labelledby="rc-title">
            <ng-container matColumnDef="category">
              <th mat-header-cell *matHeaderCellDef>Used for</th>
              <td mat-cell *matCellDef="let r">{{ labelOf(r.category) }}</td>
            </ng-container>
            <ng-container matColumnDef="code">
              <th mat-header-cell *matHeaderCellDef>Code</th>
              <td mat-cell *matCellDef="let r">{{ r.code }}</td>
            </ng-container>
            <ng-container matColumnDef="label">
              <th mat-header-cell *matHeaderCellDef>Label</th>
              <td mat-cell *matCellDef="let r">{{ r.label }}</td>
            </ng-container>
            <ng-container matColumnDef="status">
              <th mat-header-cell *matHeaderCellDef>Status</th>
              <td mat-cell *matCellDef="let r">
                <sat-status-tag [status]="r.active ? 'success' : 'neutral'">{{
                  r.active ? 'Active' : 'Retired'
                }}</sat-status-tag>
              </td>
            </ng-container>
            <ng-container matColumnDef="actions">
              <th mat-header-cell *matHeaderCellDef><span class="bf-sr">Actions</span></th>
              <td mat-cell *matCellDef="let r">
                @if (canManage()) {
                  <button
                    mat-button
                    type="button"
                    [disabled]="busy()"
                    (click)="toggle(r.id, !r.active)"
                  >
                    {{ r.active ? 'Retire' : 'Reinstate' }}
                  </button>
                }
              </td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="columns"></tr>
            <tr mat-row *matRowDef="let row; columns: columns"></tr>
          </table>
        </div>
      }
    </section>
  `,
  styleUrl: './page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReasonCodesPage {
  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly categories = REASON_CATEGORIES;
  protected readonly label = CATEGORY_LABEL;
  protected readonly columns = ['category', 'code', 'label', 'status', 'actions'];
  protected readonly showRetired = signal(false);
  protected readonly adding = signal(false);
  protected readonly category = signal<Category>('reduction');
  protected readonly code = signal('');
  protected readonly text = signal('');
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly canManage = computed(() => this.session.can('master_data.manage'));

  protected readonly list = resource({
    params: () => ({
      includeInactive: this.showRetired() ? ('true' as const) : ('false' as const),
    }),
    loader: ({ params }) => data(this.api.listReasonCodes({ query: params })),
  });

  protected labelOf(category: string): string {
    return CATEGORY_LABEL[category as Category] ?? category;
  }

  protected async add(): Promise<void> {
    await this.run(async () => {
      const r = await data(
        this.api.createReasonCode({
          body: { category: this.category(), code: this.code(), label: this.text() },
        }),
      );
      this.notice.set(`Reason code ${r.code} added.`);
      this.adding.set(false);
      this.code.set('');
      this.text.set('');
    });
  }

  protected async toggle(id: string, active: boolean): Promise<void> {
    await this.run(async () => {
      const r = await data(
        this.api.updateReasonCode({ params: { reasonCodeId: id }, body: { active } }),
      );
      this.notice.set(`${r.code} is ${r.active ? 'active again' : 'retired'}.`);
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    this.notice.set(null);
    try {
      await action();
      this.list.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
