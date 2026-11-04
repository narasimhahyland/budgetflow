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
import type { ResponseOf } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi } from './api';
import { LoadState } from './load-state';

type Vendor = ResponseOf<'listVendors'>['items'][number];
type Status = Vendor['status'];

const STATUS: Record<
  Status,
  { label: string; tone: 'success' | 'info' | 'important' | 'neutral' }
> = {
  preferred: { label: 'Preferred', tone: 'success' },
  approved: { label: 'Approved', tone: 'info' },
  blocked: { label: 'Blocked', tone: 'important' },
  unknown: { label: 'Not reviewed', tone: 'neutral' },
};

/** Screen 106c: vendor master (approved, preferred, blocked). */
@Component({
  selector: 'bf-vendors-page',
  imports: [
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    SAT_BANNER_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Vendors</h1>
        <p class="bf-page__subtitle">
          Approved and preferred vendors for events and engagement; blocked vendors cannot be used
          for new commitments.
        </p>
      </div>
      @if (canManage() && !adding()) {
        <button mat-flat-button type="button" (click)="adding.set(true); failure.set(null)">
          Add vendor
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
      <section class="bf-card" aria-label="Add vendor">
        <form class="bf-form" (ngSubmit)="add()">
          <mat-form-field appearance="outline">
            <mat-label>Name</mat-label>
            <input
              matInput
              required
              name="name"
              [ngModel]="name()"
              (ngModelChange)="name.set($event)"
            />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Status</mat-label>
            <mat-select name="status" [ngModel]="status()" (ngModelChange)="status.set($event)">
              @for (s of statuses; track s) {
                <mat-option [value]="s">{{ statusInfo[s].label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Category</mat-label>
            <input
              matInput
              name="category"
              [ngModel]="category()"
              (ngModelChange)="category.set($event)"
              placeholder="venue, catering, gifts"
            />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Country (ISO code)</mat-label>
            <input
              matInput
              name="country"
              maxlength="2"
              [ngModel]="country()"
              (ngModelChange)="country.set($event.toUpperCase())"
            />
          </mat-form-field>
          <div class="bf-form__wide bf-form__actions">
            <button mat-flat-button type="submit" [disabled]="busy() || !name().trim()">
              Add vendor
            </button>
            <button mat-button type="button" (click)="adding.set(false)">Cancel</button>
          </div>
        </form>
      </section>
    }
    @if (changing(); as v) {
      <section class="bf-card" aria-label="Change vendor status">
        <div class="bf-card__header">
          <h2 class="bf-card__title">Change status of {{ v.name }}</h2>
        </div>
        <form class="bf-form" (ngSubmit)="changeStatus(v.id)">
          <mat-form-field appearance="outline">
            <mat-label>New status</mat-label>
            <mat-select name="newStatus" [ngModel]="status()" (ngModelChange)="status.set($event)">
              @for (s of statuses; track s) {
                <mat-option [value]="s">{{ statusInfo[s].label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline" class="bf-form__wide">
            <mat-label>Reason</mat-label>
            <input
              matInput
              required
              name="reason"
              [ngModel]="reason()"
              (ngModelChange)="reason.set($event)"
            />
          </mat-form-field>
          <div class="bf-form__wide bf-form__actions">
            <button mat-flat-button type="submit" [disabled]="busy() || !reason().trim()">
              Save
            </button>
            <button mat-button type="button" (click)="changing.set(null)">Cancel</button>
          </div>
        </form>
      </section>
    }
    <section class="bf-card" aria-labelledby="v-title">
      <div class="bf-card__header"><h2 class="bf-card__title" id="v-title">Vendor master</h2></div>
      <div class="bf-filters">
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Search</mat-label>
          <input
            matInput
            [ngModel]="q()"
            (ngModelChange)="search($event)"
            data-testid="vendor-search"
          />
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Status</mat-label>
          <mat-select [ngModel]="statusFilter()" (ngModelChange)="statusFilter.set($event)">
            <mat-option [value]="null">All</mat-option>
            @for (s of statuses; track s) {
              <mat-option [value]="s">{{ statusInfo[s].label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>
      <bf-load-state
        [loading]="list.isLoading() && !list.hasValue()"
        [error]="list.error()"
        what="vendors"
        (retry)="list.reload()"
      />
      @if (list.value(); as l) {
        @if (l.items.length === 0) {
          <p class="bf-empty">No vendors match.</p>
        } @else {
          <div class="bf-table-scroll">
            <table mat-table [dataSource]="l.items" aria-labelledby="v-title">
              <ng-container matColumnDef="name">
                <th mat-header-cell *matHeaderCellDef>Vendor</th>
                <td mat-cell *matCellDef="let v">
                  <span class="bf-cell__primary">{{ v.name }}</span>
                  <span class="bf-cell__secondary">{{
                    v.erpVendorId ? 'ERP ' + v.erpVendorId : 'Not in the ERP'
                  }}</span>
                </td>
              </ng-container>
              <ng-container matColumnDef="category">
                <th mat-header-cell *matHeaderCellDef>Category</th>
                <td mat-cell *matCellDef="let v">{{ v.category ?? '—' }}</td>
              </ng-container>
              <ng-container matColumnDef="country">
                <th mat-header-cell *matHeaderCellDef>Country</th>
                <td mat-cell *matCellDef="let v">{{ v.country ?? '—' }}</td>
              </ng-container>
              <ng-container matColumnDef="status">
                <th mat-header-cell *matHeaderCellDef>Status</th>
                <td mat-cell *matCellDef="let v">
                  <sat-status-tag [status]="statusOf(v.status).tone">{{
                    statusOf(v.status).label
                  }}</sat-status-tag>
                </td>
              </ng-container>
              <ng-container matColumnDef="actions">
                <th mat-header-cell *matHeaderCellDef><span class="bf-sr">Actions</span></th>
                <td mat-cell *matCellDef="let v">
                  @if (canManage()) {
                    <button mat-button type="button" (click)="startChange(v)">Change status</button>
                  }
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="columns"></tr>
              <tr mat-row *matRowDef="let row; columns: columns"></tr>
            </table>
          </div>
        }
      }
    </section>
  `,
  styleUrl: './page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VendorsPage {
  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly statusInfo = STATUS;
  protected readonly statuses = Object.keys(STATUS) as Status[];
  protected readonly columns = ['name', 'category', 'country', 'status', 'actions'];
  protected readonly q = signal('');
  private readonly debounced = signal('');
  private timer: ReturnType<typeof setTimeout> | undefined;
  protected readonly statusFilter = signal<Status | null>(null);
  protected readonly adding = signal(false);
  protected readonly changing = signal<Vendor | null>(null);
  protected readonly name = signal('');
  protected readonly status = signal<Status>('approved');
  protected readonly category = signal('');
  protected readonly country = signal('');
  protected readonly reason = signal('');
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly canManage = computed(() => this.session.can('master_data.manage'));

  protected readonly list = resource({
    params: () => ({
      ...(this.debounced() ? { q: this.debounced() } : {}),
      ...(this.statusFilter() ? { status: this.statusFilter()! } : {}),
      limit: 200,
    }),
    loader: ({ params }) => data(this.api.listVendors({ query: params })),
  });

  protected statusOf(status: Status) {
    return STATUS[status];
  }

  protected search(value: string): void {
    this.q.set(value);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.debounced.set(value.trim()), 250);
  }

  protected startChange(v: Vendor): void {
    this.changing.set(v);
    this.status.set(v.status);
    this.reason.set('');
    this.failure.set(null);
  }

  protected async add(): Promise<void> {
    await this.run(async () => {
      const v = await data(
        this.api.createVendor({
          body: {
            name: this.name(),
            status: this.status(),
            ...(this.category() ? { category: this.category() } : {}),
            ...(this.country() ? { country: this.country() } : {}),
          },
        }),
      );
      this.notice.set(`${v.name} added as ${STATUS[v.status].label.toLowerCase()}.`);
      this.adding.set(false);
      this.name.set('');
    });
  }

  protected async changeStatus(id: string): Promise<void> {
    await this.run(async () => {
      const v = await data(
        this.api.updateVendor({
          params: { vendorId: id },
          body: { status: this.status(), reason: this.reason() },
        }),
      );
      this.notice.set(`${v.name} is now ${STATUS[v.status].label.toLowerCase()}.`);
      this.changing.set(null);
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
