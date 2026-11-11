import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { SessionStore } from '@bf/web/data-access';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { data, errorMessage, injectApi, todayIso, valueOf } from './api';
import { LoadState } from '@bf/web/ui';

/** Screens 106 and 106a: categories, GL accounts and category-to-GL mapping per entity. */
@Component({
  selector: 'bf-gl-page',
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
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">GL accounts and mapping</h1>
        <p class="bf-page__subtitle">
          Each budget category maps to a GL account per legal entity, with separate accounts for
          client attendees (entertainment). Mappings are effective-dated.
        </p>
      </div>
      <div class="bf-page__actions">
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Legal entity</mat-label>
          <mat-select
            [ngModel]="entityId()"
            (ngModelChange)="entityId.set($event)"
            data-testid="gl-entity"
          >
            @for (e of valueOf(entities)?.items ?? []; track e.id) {
              <mat-option [value]="e.id">{{ e.code }} · {{ e.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>As of</mat-label>
          <input matInput type="date" [ngModel]="asOf()" (ngModelChange)="asOf.set($event)" />
        </mat-form-field>
      </div>
    </header>
    @if (notice()) {
      <sat-banner variant="success"
        ><sat-banner-message>{{ notice() }}</sat-banner-message></sat-banner
      >
    }
    <section class="bf-card" aria-labelledby="map-title">
      <div class="bf-card__header">
        <h2 class="bf-card__title" id="map-title">Category-to-GL mapping</h2>
        @if (canManage() && !mapping()) {
          <button mat-stroked-button type="button" (click)="startMapping()">
            Change a mapping
          </button>
        }
      </div>
      @if (mapping()) {
        <form class="bf-form" (ngSubmit)="saveMapping()" aria-label="Change a mapping">
          <mat-form-field appearance="outline">
            <mat-label>Category</mat-label>
            <mat-select
              required
              name="cat"
              [ngModel]="mapCategory()"
              (ngModelChange)="mapCategory.set($event)"
            >
              @for (c of valueOf(categories)?.items ?? []; track c.id) {
                <mat-option [value]="c.code">{{ c.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Attendees</mat-label>
            <mat-select
              name="att"
              [ngModel]="mapAttendee()"
              (ngModelChange)="mapAttendee.set($event)"
            >
              <mat-option value="employee">Employees</mat-option>
              <mat-option value="client">Clients</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>GL account</mat-label>
            <mat-select
              required
              name="acct"
              [ngModel]="mapAccount()"
              (ngModelChange)="mapAccount.set($event)"
            >
              @for (a of valueOf(accounts)?.items ?? []; track a.id) {
                <mat-option [value]="a.id">{{ a.code }} {{ a.name }}</mat-option>
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
              [ngModel]="mapFrom()"
              (ngModelChange)="mapFrom.set($event)"
            />
            <mat-hint>The current mapping ends the day before.</mat-hint>
          </mat-form-field>
          @if (failure()) {
            <sat-banner variant="important" class="bf-form__wide"
              ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
            >
          }
          <div class="bf-form__wide bf-form__actions">
            <button
              mat-flat-button
              type="submit"
              [disabled]="busy() || !mapCategory() || !mapAccount()"
            >
              Save mapping
            </button>
            <button mat-button type="button" (click)="mapping.set(false)">Cancel</button>
          </div>
        </form>
      }
      <bf-load-state
        [loading]="mappings.isLoading() && !mappings.hasValue()"
        [error]="mappings.error()"
        what="GL mappings"
        (retry)="mappings.reload()"
      />
      @if (valueOf(mappings); as m) {
        @if (rows().length === 0) {
          <p class="bf-empty">No mappings on this date for this entity.</p>
        } @else {
          <div class="bf-table-scroll">
            <table
              class="bf-table bf-table--stack"
              mat-table
              [dataSource]="rows()"
              aria-labelledby="map-title"
            >
              <ng-container matColumnDef="category">
                <th mat-header-cell *matHeaderCellDef>Category</th>
                <td class="bf-cell--full" mat-cell *matCellDef="let r">{{ r.categoryName }}</td>
              </ng-container>
              <ng-container matColumnDef="employee">
                <th mat-header-cell *matHeaderCellDef>Employee attendees</th>
                <td mat-cell *matCellDef="let r" data-label="Employee attendees">
                  {{ r.employee ?? '—' }}
                </td>
              </ng-container>
              <ng-container matColumnDef="client">
                <th mat-header-cell *matHeaderCellDef>Client attendees</th>
                <td mat-cell *matCellDef="let r" data-label="Client attendees">
                  {{ r.client ?? '—' }}
                </td>
              </ng-container>
              <ng-container matColumnDef="since">
                <th mat-header-cell *matHeaderCellDef>Since</th>
                <td mat-cell *matCellDef="let r" data-label="Since">
                  {{ r.since | date: 'd MMM y' : 'UTC' }}
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="mapColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: mapColumns"></tr>
            </table>
          </div>
        }
      }
    </section>
    <section class="bf-card" aria-labelledby="acct-title">
      <div class="bf-card__header">
        <h2 class="bf-card__title" id="acct-title">GL accounts</h2>
        @if (canManage() && !adding()) {
          <button mat-stroked-button type="button" (click)="adding.set(true); failure.set(null)">
            Add account
          </button>
        }
      </div>
      @if (adding()) {
        <form class="bf-form" (ngSubmit)="saveAccount()" aria-label="Add GL account">
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
            <mat-label>Type</mat-label>
            <mat-select name="type" [ngModel]="type()" (ngModelChange)="type.set($event)">
              <mat-option value="expense">Expense</mat-option>
              <mat-option value="liability">Liability</mat-option>
              <mat-option value="asset">Asset</mat-option>
              <mat-option value="revenue">Revenue</mat-option>
              <mat-option value="equity">Equity</mat-option>
            </mat-select>
          </mat-form-field>
          @if (failure()) {
            <sat-banner variant="important" class="bf-form__wide"
              ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
            >
          }
          <div class="bf-form__wide bf-form__actions">
            <button mat-flat-button type="submit" [disabled]="busy() || !code() || !name()">
              Add account
            </button>
            <button mat-button type="button" (click)="adding.set(false)">Cancel</button>
          </div>
        </form>
      }
      <bf-load-state
        [loading]="accounts.isLoading() && !accounts.hasValue()"
        [error]="accounts.error()"
        what="GL accounts"
        (retry)="accounts.reload()"
      />
      @if (valueOf(accounts); as a) {
        <div class="bf-table-scroll">
          <table
            class="bf-table bf-table--stack"
            mat-table
            [dataSource]="a.items"
            aria-labelledby="acct-title"
          >
            <ng-container matColumnDef="code">
              <th mat-header-cell *matHeaderCellDef>Code</th>
              <td class="bf-cell--full" mat-cell *matCellDef="let x">
                <span class="bf-cell__code">{{ x.code }}</span>
              </td>
            </ng-container>
            <ng-container matColumnDef="name">
              <th mat-header-cell *matHeaderCellDef>Name</th>
              <td mat-cell *matCellDef="let x" data-label="Name">{{ x.name }}</td>
            </ng-container>
            <ng-container matColumnDef="type">
              <th mat-header-cell *matHeaderCellDef>Type</th>
              <td mat-cell *matCellDef="let x" data-label="Type">{{ x.accountType }}</td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="acctColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: acctColumns"></tr>
          </table>
        </div>
      }
    </section>
  `,
  styleUrl: './page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GlPage {
  protected readonly valueOf = valueOf;
  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly mapColumns = ['category', 'employee', 'client', 'since'];
  protected readonly acctColumns = ['code', 'name', 'type'];
  protected readonly asOf = signal(todayIso());
  protected readonly entities = resource({ loader: () => data(this.api.listLegalEntities({})) });
  protected readonly entityId = linkedSignal(
    () =>
      valueOf(this.entities)?.items.find((e) => e.code === 'HYL-US')?.id ??
      valueOf(this.entities)?.items[0]?.id ??
      null,
  );
  protected readonly categories = resource({ loader: () => data(this.api.listCategories({})) });
  protected readonly accounts = resource({
    params: () => (this.entityId() ? { legalEntityId: this.entityId()! } : undefined),
    loader: ({ params }) => data(this.api.listGlAccounts({ query: params })),
  });
  protected readonly mappings = resource({
    params: () =>
      this.entityId() ? { legalEntityId: this.entityId()!, asOf: this.asOf() } : undefined,
    loader: ({ params }) => data(this.api.listGlMappings({ query: params })),
  });
  protected readonly rows = computed(() => {
    const byCat = new Map<
      string,
      { categoryName: string; employee: string | null; client: string | null; since: string }
    >();
    for (const m of valueOf(this.mappings)?.items ?? []) {
      const r = byCat.get(m.categoryCode) ?? {
        categoryName: m.categoryName,
        employee: null,
        client: null,
        since: m.validFrom,
      };
      r[m.attendeeType] = `${m.glAccountCode} ${m.glAccountName}`;
      if (m.validFrom > r.since) r.since = m.validFrom;
      byCat.set(m.categoryCode, r);
    }
    return [...byCat.values()];
  });
  protected readonly canManage = computed(() => this.session.can('master_data.manage'));
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly mapping = signal(false);
  protected readonly mapCategory = signal<string | null>(null);
  protected readonly mapAttendee = signal<'employee' | 'client'>('employee');
  protected readonly mapAccount = signal<string | null>(null);
  protected readonly mapFrom = signal(todayIso());
  protected readonly adding = signal(false);
  protected readonly code = signal('');
  protected readonly name = signal('');
  protected readonly type = signal<'expense' | 'liability' | 'asset' | 'revenue' | 'equity'>(
    'expense',
  );

  protected startMapping(): void {
    this.mapping.set(true);
    this.mapCategory.set(null);
    this.mapAccount.set(null);
    this.mapFrom.set(todayIso());
    this.failure.set(null);
  }

  protected async saveMapping(): Promise<void> {
    await this.run(async () => {
      const m = await data(
        this.api.createGlMapping({
          body: {
            legalEntityId: this.entityId()!,
            categoryCode: this.mapCategory()!,
            attendeeType: this.mapAttendee(),
            glAccountId: this.mapAccount()!,
            effectiveFrom: this.mapFrom(),
          },
        }),
      );
      this.notice.set(
        `${m.categoryName} (${m.attendeeType}) posts to ${m.glAccountCode} from ${m.validFrom}.`,
      );
      this.mapping.set(false);
      this.mappings.reload();
    });
  }

  protected async saveAccount(): Promise<void> {
    await this.run(async () => {
      const a = await data(
        this.api.createGlAccount({
          body: {
            legalEntityId: this.entityId()!,
            code: this.code(),
            name: this.name(),
            accountType: this.type(),
          },
        }),
      );
      this.notice.set(`GL account ${a.code} ${a.name} added.`);
      this.adding.set(false);
      this.code.set('');
      this.name.set('');
      this.accounts.reload();
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      await action();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
