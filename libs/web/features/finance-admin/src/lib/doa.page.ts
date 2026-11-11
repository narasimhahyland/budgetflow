import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import type { DoaLimit, DoaLookupResponse } from '@bf/contracts';
import { LoadState, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { data, errorMessage, injectApi, valueOf } from './api';

type RoleId = NonNullable<DoaLimit['role']>;

const ROLE_LABEL: Partial<Record<RoleId, string>> = {
  ceo: 'CEO',
  'finance-admin': 'Finance admin',
  'finance-controller': 'Finance controller',
  'budget-owner': 'Budget owner',
  'department-head': 'Department head',
  'regional-manager': 'Regional manager',
  'location-manager': 'Location manager',
  'event-organizer': 'Event organizer',
};

/** Screen 104a: delegation-of-authority matrix (seeded, read-only), with a limit lookup. */
@Component({
  selector: 'bf-doa-page',
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
    Money,
    SAT_BANNER_IMPORTS,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Delegation of authority</h1>
        <p class="bf-page__subtitle">
          Who may approve what: role or person × spend type × legal entity × limit in USD. Approval
          authority is separate from budget ownership: owning a budget does not let you approve
          spend from it. The matrix is read-only on this page.
        </p>
      </div>
    </header>
    <section class="bf-card" aria-labelledby="doa-check-title">
      <div class="bf-card__header">
        <div>
          <h2 class="bf-card__title" id="doa-check-title">Check a limit</h2>
          <p class="bf-card__hint">
            The most specific row applies: person, then spend type, then entity. Exactly at the
            limit passes.
          </p>
        </div>
      </div>
      <form class="bf-form" (ngSubmit)="check()" aria-label="Check a limit">
        <mat-form-field appearance="outline">
          <mat-label>Approver role</mat-label>
          <mat-select
            name="role"
            [ngModel]="role()"
            (ngModelChange)="role.set($event)"
            data-testid="doa-role"
          >
            @for (r of roles; track r) {
              <mat-option [value]="r">{{ roleLabel[r] }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Spend type</mat-label>
          <mat-select
            name="spend"
            [ngModel]="spendType()"
            (ngModelChange)="spendType.set($event)"
            data-testid="doa-spend"
          >
            @for (s of spendTypes(); track s) {
              <mat-option [value]="s">{{ s === '*' ? 'Any other spend' : s }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Legal entity</mat-label>
          <mat-select
            name="entity"
            [ngModel]="entityId()"
            (ngModelChange)="entityId.set($event)"
            data-testid="doa-entity"
          >
            @for (e of valueOf(entities)?.items ?? []; track e.id) {
              <mat-option [value]="e.id">{{ e.code }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Amount</mat-label>
          <input
            matInput
            type="number"
            min="0"
            name="amount"
            [ngModel]="amount()"
            (ngModelChange)="amount.set($event)"
            data-testid="doa-amount"
          />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Currency</mat-label>
          <mat-select name="ccy" [ngModel]="currency()" (ngModelChange)="currency.set($event)">
            <mat-option value="USD">USD</mat-option>
            <mat-option value="INR">INR</mat-option>
            <mat-option value="EUR">EUR</mat-option>
            <mat-option value="GBP">GBP</mat-option>
          </mat-select>
        </mat-form-field>
        <div class="bf-form__wide bf-form__actions">
          <button mat-flat-button type="submit" [disabled]="busy() || !entityId() || !spendType()">
            Check
          </button>
        </div>
      </form>
      @if (failure()) {
        <sat-banner variant="important" class="bf-banner"
          ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
        >
      }
      @if (result(); as r) {
        <sat-banner
          [variant]="r.withinLimit ? 'success' : 'warning'"
          class="bf-banner"
          data-testid="doa-result"
        >
          <sat-banner-message>
            {{
              r.withinLimit
                ? 'Within the limit.'
                : r.code === 'DOA_NO_AUTHORITY'
                  ? 'No authority:'
                  : 'Above the limit; the approval escalates.'
            }}
            @if (r.limit; as l) {
              Applies: {{ l.personName ?? roleName(l.role) }} ·
              {{ l.spendType === '*' ? 'any spend' : l.spendType }} ·
              {{ l.legalEntityCode ?? 'any entity' }} · limit
              <bf-money [amountMinor]="l.limit.amountMinor" [currency]="l.limit.currency" />.
            } @else {
              {{ r.message }}
            }
          </sat-banner-message>
        </sat-banner>
      }
    </section>
    <section class="bf-card" aria-labelledby="doa-title">
      <div class="bf-card__header">
        <div>
          <h2 class="bf-card__title" id="doa-title">Matrix</h2>
          @if (valueOf(matrix)?.version; as v) {
            <p class="bf-card__hint">
              Version {{ v.version }} · {{ v.status }} since
              {{ v.validFrom | date: 'd MMM y' : 'UTC'
              }}{{ v.approvedByName ? ' · approved by ' + v.approvedByName : '' }}
            </p>
          }
        </div>
      </div>
      <bf-load-state
        [loading]="matrix.isLoading() && !matrix.hasValue()"
        [error]="matrix.error()"
        what="the DoA matrix"
        (retry)="matrix.reload()"
      />
      @if (valueOf(matrix); as m) {
        @if (m.items.length === 0) {
          <p class="bf-empty">No active matrix.</p>
        } @else {
          <div class="bf-table-scroll">
            <table
              class="bf-table bf-table--stack"
              mat-table
              [dataSource]="m.items"
              aria-labelledby="doa-title"
            >
              <ng-container matColumnDef="who">
                <th mat-header-cell *matHeaderCellDef>Who</th>
                <td class="bf-cell--full" mat-cell *matCellDef="let l">
                  <span class="bf-cell__primary">{{ l.personName ?? roleName(l.role) }}</span>
                  <span class="bf-cell__secondary">{{
                    l.personName ? 'Person-specific' : 'Role'
                  }}</span>
                </td>
              </ng-container>
              <ng-container matColumnDef="spend">
                <th mat-header-cell *matHeaderCellDef>Spend type</th>
                <td mat-cell *matCellDef="let l" data-label="Spend type">
                  {{ l.spendType === '*' ? 'Any' : l.spendType }}
                </td>
              </ng-container>
              <ng-container matColumnDef="entity">
                <th mat-header-cell *matHeaderCellDef>Legal entity</th>
                <td mat-cell *matCellDef="let l" data-label="Legal entity">
                  {{ l.legalEntityCode ?? 'Any' }}
                </td>
              </ng-container>
              <ng-container matColumnDef="limit">
                <th mat-header-cell *matHeaderCellDef class="bf-num">Limit</th>
                <td mat-cell *matCellDef="let l" class="bf-num" data-label="Limit">
                  <bf-money [amountMinor]="l.limit.amountMinor" [currency]="l.limit.currency" />
                </td>
              </ng-container>
              <ng-container matColumnDef="from">
                <th mat-header-cell *matHeaderCellDef>Effective</th>
                <td mat-cell *matCellDef="let l" data-label="Effective">
                  {{ l.validFrom | date: 'd MMM y' : 'UTC'
                  }}{{ l.validTo ? ' – ' + (l.validTo | date: 'd MMM y' : 'UTC') : '' }}
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
export class DoaPage {
  protected readonly valueOf = valueOf;
  private readonly api = injectApi();
  protected readonly roleLabel = ROLE_LABEL;
  protected readonly roles = Object.keys(ROLE_LABEL) as RoleId[];
  protected readonly columns = ['who', 'spend', 'entity', 'limit', 'from'];
  protected readonly matrix = resource({ loader: () => data(this.api.getDoaMatrix({})) });
  protected readonly entities = resource({ loader: () => data(this.api.listLegalEntities({})) });
  protected readonly spendTypes = computed(() => valueOf(this.matrix)?.spendTypes ?? ['*']);
  protected readonly role = signal<RoleId>('location-manager');
  protected readonly spendType = signal('team_lunch');
  protected readonly entityId = signal<string | null>(null);
  protected readonly amount = signal('1000');
  protected readonly currency = signal('USD');
  protected readonly result = signal<DoaLookupResponse | null>(null);
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);

  protected roleName(role: RoleId | null): string {
    return role ? (ROLE_LABEL[role] ?? role) : '';
  }

  protected async check(): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      this.result.set(
        await data(
          this.api.lookupDoa({
            query: {
              role: this.role(),
              spendType: this.spendType(),
              legalEntityId: this.entityId()!,
              // USD, INR, EUR and GBP all have two minor-unit digits.
              amountMinor: Math.round(Number(this.amount()) * 100),
              currency: this.currency(),
            },
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
