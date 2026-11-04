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
import type { LegalEntity } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { data, errorMessage, injectApi } from './api';
import { LoadState } from './load-state';

/** Screens 6 and 102a: organization and legal-entity setup. */
@Component({
  selector: 'bf-legal-entities-page',
  imports: [
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    SAT_BANNER_IMPORTS,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Legal entities</h1>
        <p class="bf-page__subtitle">
          Each entity has a functional currency, a fiscal calendar, a tax jurisdiction and an ERP
          company code. Budgets are held in USD; entity transactions convert at the locked plan
          rate.
        </p>
      </div>
      @if (canManage() && mode() === 'list') {
        <button mat-flat-button type="button" (click)="startAdd()">Add legal entity</button>
      }
    </header>
    @if (notice()) {
      <sat-banner variant="success"
        ><sat-banner-message>{{ notice() }}</sat-banner-message></sat-banner
      >
    }
    @if (mode() !== 'list') {
      <section class="bf-card" aria-label="Legal entity form">
        <div class="bf-card__header">
          <h2 class="bf-card__title">
            {{ mode() === 'add' ? 'Add legal entity' : 'Edit ' + editing()?.code }}
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
          }
          <mat-form-field appearance="outline">
            <mat-label>Registered name</mat-label>
            <input
              matInput
              required
              name="name"
              [ngModel]="name()"
              (ngModelChange)="name.set($event)"
            />
          </mat-form-field>
          @if (mode() === 'add') {
            <mat-form-field appearance="outline">
              <mat-label>Country (ISO code)</mat-label>
              <input
                matInput
                required
                maxlength="2"
                name="country"
                [ngModel]="country()"
                (ngModelChange)="country.set($event.toUpperCase())"
              />
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Functional currency</mat-label>
              <mat-select
                required
                name="ccy"
                [ngModel]="currency()"
                (ngModelChange)="currency.set($event)"
              >
                @for (c of currencies.value()?.items ?? []; track c.code) {
                  <mat-option [value]="c.code">{{ c.code }} · {{ c.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Fiscal calendar</mat-label>
              <mat-select
                required
                name="cal"
                [ngModel]="calendarId()"
                (ngModelChange)="calendarId.set($event)"
              >
                @for (c of calendars.value()?.items ?? []; track c.id) {
                  <mat-option [value]="c.id">{{ c.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          }
          <mat-form-field appearance="outline">
            <mat-label>Tax jurisdiction</mat-label>
            <input matInput name="tax" [ngModel]="tax()" (ngModelChange)="tax.set($event)" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>ERP company code</mat-label>
            <input matInput name="erp" [ngModel]="erp()" (ngModelChange)="erp.set($event)" />
          </mat-form-field>
          @if (mode() === 'edit') {
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
    <section class="bf-card" aria-labelledby="le-title">
      <div class="bf-card__header"><h2 class="bf-card__title" id="le-title">Entities</h2></div>
      <bf-load-state
        [loading]="list.isLoading() && !list.hasValue()"
        [error]="list.error()"
        what="legal entities"
        (retry)="list.reload()"
      />
      @if (list.value(); as l) {
        <div class="bf-table-scroll">
          <table mat-table [dataSource]="l.items" aria-labelledby="le-title">
            <ng-container matColumnDef="entity">
              <th mat-header-cell *matHeaderCellDef>Entity</th>
              <td mat-cell *matCellDef="let e">
                <span class="bf-cell__primary">{{ e.name }}</span>
                <span class="bf-cell__secondary">{{ e.code }} · {{ e.country }}</span>
              </td>
            </ng-container>
            <ng-container matColumnDef="currency">
              <th mat-header-cell *matHeaderCellDef>Functional currency</th>
              <td mat-cell *matCellDef="let e">{{ e.functionalCurrency }}</td>
            </ng-container>
            <ng-container matColumnDef="calendar">
              <th mat-header-cell *matHeaderCellDef>Fiscal calendar</th>
              <td mat-cell *matCellDef="let e">{{ e.fiscalCalendarName }}</td>
            </ng-container>
            <ng-container matColumnDef="codes">
              <th mat-header-cell *matHeaderCellDef>Tax and ERP</th>
              <td mat-cell *matCellDef="let e">
                <span class="bf-cell__primary">{{ e.taxJurisdiction ?? '—' }}</span>
                <span class="bf-cell__secondary">ERP {{ e.erpCompanyCode ?? '—' }}</span>
              </td>
            </ng-container>
            <ng-container matColumnDef="cc">
              <th mat-header-cell *matHeaderCellDef class="bf-num">Cost centers</th>
              <td mat-cell *matCellDef="let e" class="bf-num">{{ e.costCenterCount }}</td>
            </ng-container>
            <ng-container matColumnDef="actions">
              <th mat-header-cell *matHeaderCellDef><span class="bf-sr">Actions</span></th>
              <td mat-cell *matCellDef="let e">
                @if (e.allowedActions.includes('master_data.manage')) {
                  <button mat-button type="button" (click)="startEdit(e)">Edit</button>
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
export class LegalEntitiesPage {
  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly columns = ['entity', 'currency', 'calendar', 'codes', 'cc', 'actions'];
  protected readonly mode = signal<'list' | 'add' | 'edit'>('list');
  protected readonly editing = signal<LegalEntity | null>(null);
  protected readonly code = signal('');
  protected readonly name = signal('');
  protected readonly country = signal('');
  protected readonly currency = signal('USD');
  protected readonly calendarId = signal<string | null>(null);
  protected readonly tax = signal('');
  protected readonly erp = signal('');
  protected readonly reason = signal('');
  protected readonly saving = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected readonly list = resource({ loader: () => data(this.api.listLegalEntities({})) });
  protected readonly currencies = resource({
    params: () => (this.mode() === 'add' ? {} : undefined),
    loader: () => data(this.api.listCurrencies({})),
  });
  protected readonly calendars = resource({
    params: () => (this.mode() === 'add' ? {} : undefined),
    loader: () => data(this.api.listFiscalCalendars({})),
  });
  protected readonly canManage = computed(() => this.session.can('master_data.manage'));

  protected startAdd(): void {
    this.mode.set('add');
    for (const s of [this.code, this.name, this.country, this.tax, this.erp]) s.set('');
    this.currency.set('USD');
    this.calendarId.set(null);
    this.failure.set(null);
  }

  protected startEdit(e: LegalEntity): void {
    this.mode.set('edit');
    this.editing.set(e);
    this.name.set(e.name);
    this.tax.set(e.taxJurisdiction ?? '');
    this.erp.set(e.erpCompanyCode ?? '');
    this.reason.set('');
    this.failure.set(null);
  }

  protected async save(): Promise<void> {
    this.saving.set(true);
    this.failure.set(null);
    try {
      if (this.mode() === 'add') {
        const e = await data(
          this.api.createLegalEntity({
            body: {
              code: this.code(),
              name: this.name(),
              country: this.country(),
              functionalCurrency: this.currency(),
              fiscalCalendarId: this.calendarId() ?? '',
              ...(this.tax() ? { taxJurisdiction: this.tax() } : {}),
              ...(this.erp() ? { erpCompanyCode: this.erp() } : {}),
            },
          }),
        );
        this.notice.set(`${e.name} (${e.code}) is set up.`);
      } else {
        const e = await data(
          this.api.updateLegalEntity({
            params: { legalEntityId: this.editing()!.id },
            body: {
              name: this.name(),
              taxJurisdiction: this.tax() || null,
              erpCompanyCode: this.erp() || null,
              reason: this.reason(),
            },
          }),
        );
        this.notice.set(`${e.code} is updated.`);
      }
      this.mode.set('list');
      this.list.reload();
    } catch (err) {
      this.failure.set(errorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
