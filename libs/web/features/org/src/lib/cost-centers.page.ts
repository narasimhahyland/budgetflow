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
import type { CostCenter } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, todayIso, valueOf } from './api';
import { LoadState } from '@bf/web/ui';

/** Screen 41: cost-center management, effective-dated per legal entity. */
@Component({
  selector: 'bf-cost-centers-page',
  host: { class: 'bf-page-layout' },
  imports: [
    DatePipe,
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
        <h1 class="bf-page__title">Cost centers</h1>
        <p class="bf-page__subtitle">
          Every cost center belongs to one legal entity and is active between two dates.
        </p>
      </div>
      <div class="bf-page__actions">
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>As of</mat-label>
          <input matInput type="date" [ngModel]="asOf()" (ngModelChange)="asOf.set($event)" />
        </mat-form-field>
        @if (canManage() && mode() === 'list') {
          <button mat-flat-button type="button" (click)="startAdd()">Add cost center</button>
        }
      </div>
    </header>
    @if (notice()) {
      <sat-banner variant="success"
        ><sat-banner-message>{{ notice() }}</sat-banner-message></sat-banner
      >
    }
    @if (mode() !== 'list') {
      <section class="bf-card" aria-label="Cost center form">
        <div class="bf-card__header">
          <h2 class="bf-card__title">
            {{ mode() === 'add' ? 'Add cost center' : 'Deactivate ' + editing()?.code }}
          </h2>
        </div>
        <form class="bf-form" (ngSubmit)="save()">
          @if (mode() === 'add') {
            <mat-form-field appearance="outline">
              <mat-label>Code</mat-label>
              <input
                matInput
                required
                name="code"
                [ngModel]="code()"
                (ngModelChange)="code.set($event)"
              />
            </mat-form-field>
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
              <mat-label>Legal entity</mat-label>
              <mat-select
                required
                name="entity"
                [ngModel]="entityId()"
                (ngModelChange)="entityId.set($event)"
              >
                @for (e of valueOf(entities)?.items ?? []; track e.id) {
                  <mat-option [value]="e.id">{{ e.code }} · {{ e.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Org unit (optional)</mat-label>
              <mat-select name="unit" [ngModel]="unitId()" (ngModelChange)="unitId.set($event)">
                <mat-option value="none">None</mat-option>
                @for (u of valueOf(units)?.items ?? []; track u.id) {
                  <mat-option [value]="u.id">{{ u.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Effective from</mat-label>
              <input
                matInput
                type="date"
                required
                name="from"
                [ngModel]="date()"
                (ngModelChange)="date.set($event)"
              />
            </mat-form-field>
          } @else {
            <mat-form-field appearance="outline">
              <mat-label>Deactivate from</mat-label>
              <input
                matInput
                type="date"
                required
                name="from"
                [ngModel]="date()"
                (ngModelChange)="date.set($event)"
              />
              <mat-hint>The last active day is the day before.</mat-hint>
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
          }
          @if (failure()) {
            <sat-banner variant="important" class="bf-form__wide"
              ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
            >
          }
          <div class="bf-form__wide bf-form__actions">
            <button mat-flat-button type="submit" [disabled]="saving()">Save</button>
            <button mat-button type="button" (click)="mode.set('list')">Cancel</button>
          </div>
        </form>
      </section>
    }
    <section class="bf-card" aria-labelledby="cc-title">
      <div class="bf-card__header">
        <h2 class="bf-card__title" id="cc-title">
          {{ activeCount() }} active on {{ asOf() | date: 'd MMM y' : 'UTC' }}
        </h2>
      </div>
      <bf-load-state
        [loading]="list.isLoading() && !list.hasValue()"
        [error]="list.error()"
        what="cost centers"
        (retry)="list.reload()"
      />
      @if (valueOf(list); as l) {
        @if (l.items.length === 0) {
          <p class="bf-empty">No cost centers yet.</p>
        } @else {
          <div class="bf-table-scroll">
            <table
              class="bf-table bf-table--stack"
              mat-table
              [dataSource]="l.items"
              aria-labelledby="cc-title"
            >
              <ng-container matColumnDef="code">
                <th mat-header-cell *matHeaderCellDef>Code</th>
                <td class="bf-cell--full" mat-cell *matCellDef="let c">
                  <span class="bf-cell__primary">{{ c.code }}</span>
                  <span class="bf-cell__secondary">{{ c.name }}</span>
                </td>
              </ng-container>
              <ng-container matColumnDef="entity">
                <th mat-header-cell *matHeaderCellDef>Legal entity</th>
                <td mat-cell *matCellDef="let c" data-label="Legal entity">
                  {{ c.legalEntityCode }}
                </td>
              </ng-container>
              <ng-container matColumnDef="unit">
                <th mat-header-cell *matHeaderCellDef>Org unit</th>
                <td mat-cell *matCellDef="let c" data-label="Org unit">
                  {{ c.orgUnitName ?? '—' }}
                </td>
              </ng-container>
              <ng-container matColumnDef="dates">
                <th mat-header-cell *matHeaderCellDef>Active</th>
                <td mat-cell *matCellDef="let c" data-label="Active">
                  {{ c.validFrom | date: 'd MMM y' : 'UTC' }} –
                  {{ c.validTo ? (c.validTo | date: 'd MMM y' : 'UTC') : 'open' }}
                </td>
              </ng-container>
              <ng-container matColumnDef="status">
                <th mat-header-cell *matHeaderCellDef>Status</th>
                <td mat-cell *matCellDef="let c" data-label="Status">
                  <sat-status-tag [status]="c.active ? 'success' : 'neutral'">{{
                    c.active ? 'Active' : 'Inactive'
                  }}</sat-status-tag>
                </td>
              </ng-container>
              <ng-container matColumnDef="actions">
                <th mat-header-cell *matHeaderCellDef class="bf-col-actions">Actions</th>
                <td mat-cell *matCellDef="let c" class="bf-col-actions" data-label="Actions">
                  @if (canManage() && !c.validTo) {
                    <button mat-button type="button" (click)="startDeactivate(c)">
                      Deactivate
                    </button>
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
export class CostCentersPage {
  protected readonly valueOf = valueOf;
  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly columns = ['code', 'entity', 'unit', 'dates', 'status', 'actions'];
  protected readonly asOf = signal(todayIso());
  protected readonly mode = signal<'list' | 'add' | 'deactivate'>('list');
  protected readonly editing = signal<CostCenter | null>(null);
  protected readonly code = signal('');
  protected readonly name = signal('');
  protected readonly entityId = signal<string | null>(null);
  protected readonly unitId = signal('none');
  protected readonly date = signal(todayIso());
  protected readonly reason = signal('');
  protected readonly saving = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected readonly list = resource({
    params: () => ({ asOf: this.asOf() }),
    loader: ({ params }) => data(this.api.listCostCenters({ query: params })),
  });
  protected readonly entities = resource({
    params: () => (this.mode() === 'add' ? {} : undefined),
    loader: () => data(this.api.listLegalEntities({})),
  });
  protected readonly units = resource({
    params: () => (this.mode() === 'add' ? { asOf: this.date() } : undefined),
    loader: ({ params }) => data(this.api.listOrgUnits({ query: params })),
  });

  protected readonly canManage = computed(
    () => this.session.can('org.manage') || this.session.can('master_data.manage'),
  );
  protected readonly activeCount = computed(
    () => (valueOf(this.list)?.items ?? []).filter((c) => c.active).length,
  );

  protected startAdd(): void {
    this.mode.set('add');
    this.code.set('');
    this.name.set('');
    this.entityId.set(null);
    this.unitId.set('none');
    this.date.set(todayIso());
    this.failure.set(null);
  }

  protected startDeactivate(c: CostCenter): void {
    this.mode.set('deactivate');
    this.editing.set(c);
    this.date.set(todayIso());
    this.reason.set('');
    this.failure.set(null);
  }

  protected async save(): Promise<void> {
    this.saving.set(true);
    this.failure.set(null);
    try {
      if (this.mode() === 'add') {
        const cc = await data(
          this.api.createCostCenter({
            body: {
              code: this.code(),
              name: this.name(),
              legalEntityId: this.entityId() ?? '',
              orgUnitId: this.unitId() === 'none' ? null : this.unitId(),
              effectiveFrom: this.date(),
            },
          }),
        );
        this.notice.set(`Cost center ${cc.code} is active from ${cc.validFrom}.`);
      } else {
        const cc = await data(
          this.api.changeCostCenter({
            params: { costCenterId: this.editing()!.id },
            body: { deactivateFrom: this.date(), reason: this.reason() },
          }),
        );
        this.notice.set(`Cost center ${cc.code} is inactive after ${cc.validTo}.`);
      }
      this.mode.set('list');
      this.list.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
