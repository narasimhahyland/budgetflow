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
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { data, errorMessage, injectApi, todayIso, valueOf } from './api';
import { LoadState } from './load-state';

/** Screens 39-40: employee profile and reporting relationship management (effective-dated). */
@Component({
  selector: 'bf-person-page',
  imports: [
    DatePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    RouterLink,
    SAT_BANNER_IMPORTS,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <a mat-button routerLink="/org/people" class="bf-back">Back to people</a>
        <h1 class="bf-page__title">{{ valueOf(person)?.displayName ?? 'Person' }}</h1>
        <p class="bf-page__subtitle">{{ valueOf(person)?.jobTitle }}</p>
      </div>
      @if (canManage() && !editing()) {
        <button mat-flat-button type="button" (click)="editing.set(true)">Change manager</button>
      }
    </header>
    @if (notice()) {
      <sat-banner variant="success"
        ><sat-banner-message>{{ notice() }}</sat-banner-message></sat-banner
      >
    }
    <section class="bf-card">
      <bf-load-state
        [loading]="person.isLoading() && !person.hasValue()"
        [error]="person.error()"
        what="this person"
        (retry)="person.reload()"
      />
      @if (valueOf(person); as p) {
        @if (editing()) {
          <form class="bf-form" aria-label="Change manager" (ngSubmit)="save(p.id)">
            <mat-form-field appearance="outline">
              <mat-label>New manager</mat-label>
              <mat-select
                required
                name="manager"
                [ngModel]="managerId()"
                (ngModelChange)="managerId.set($event)"
              >
                @for (c of valueOf(candidates)?.items ?? []; track c.id) {
                  @if (c.id !== p.id) {
                    <mat-option [value]="c.id">{{ c.displayName }} · {{ c.jobTitle }}</mat-option>
                  }
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
                [ngModel]="effectiveFrom()"
                (ngModelChange)="effectiveFrom.set($event)"
              />
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
            @if (failure()) {
              <sat-banner variant="important" class="bf-form__wide"
                ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
              >
            }
            <div class="bf-form__wide bf-form__actions">
              <button
                mat-flat-button
                type="submit"
                [disabled]="saving() || !managerId() || !reason().trim()"
              >
                Save
              </button>
              <button mat-button type="button" (click)="editing.set(false)">Cancel</button>
            </div>
          </form>
        }
        <dl class="bf-facts">
          <div>
            <dt>Email</dt>
            <dd>{{ p.email }}</dd>
          </div>
          <div>
            <dt>Location</dt>
            <dd>{{ p.locationName ?? '—' }}</dd>
          </div>
          <div>
            <dt>Team</dt>
            <dd>{{ p.orgUnitName ?? '—' }}</dd>
          </div>
          <div>
            <dt>Manager</dt>
            <dd data-testid="manager">{{ p.managerName ?? '—' }}</dd>
          </div>
          <div>
            <dt>Employing entity</dt>
            <dd>{{ p.employingEntityCode ?? '—' }}</dd>
          </div>
          <div>
            <dt>Cost center</dt>
            <dd>{{ p.costCenterCode ?? '—' }}</dd>
          </div>
          <div>
            <dt>Employment type</dt>
            <dd>{{ p.employmentType }}</dd>
          </div>
          <div>
            <dt>Timezone</dt>
            <dd>{{ p.timezone ?? '—' }}</dd>
          </div>
          <div>
            <dt>Start date</dt>
            <dd>{{ p.startDate ? (p.startDate | date: 'd MMM y' : 'UTC') : '—' }}</dd>
          </div>
        </dl>
      }
    </section>
    @if (valueOf(person); as p) {
      <section class="bf-card" aria-labelledby="lines-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="lines-title">Reporting history</h2>
        </div>
        <div class="bf-table-scroll">
          <table mat-table [dataSource]="p.reportingLines" aria-labelledby="lines-title">
            <ng-container matColumnDef="manager">
              <th mat-header-cell *matHeaderCellDef>Manager</th>
              <td mat-cell *matCellDef="let l">{{ l.managerName }}</td>
            </ng-container>
            <ng-container matColumnDef="kind">
              <th mat-header-cell *matHeaderCellDef>Line</th>
              <td mat-cell *matCellDef="let l">{{ l.kind === 'solid' ? 'Solid' : 'Matrix' }}</td>
            </ng-container>
            <ng-container matColumnDef="from">
              <th mat-header-cell *matHeaderCellDef>From</th>
              <td mat-cell *matCellDef="let l">{{ l.validFrom | date: 'd MMM y' : 'UTC' }}</td>
            </ng-container>
            <ng-container matColumnDef="to">
              <th mat-header-cell *matHeaderCellDef>To</th>
              <td mat-cell *matCellDef="let l">
                {{ l.validTo ? (l.validTo | date: 'd MMM y' : 'UTC') : 'Open' }}
              </td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="lineColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: lineColumns"></tr>
          </table>
        </div>
        @if (p.reportingLines.length === 0) {
          <p class="bf-empty">No manager recorded.</p>
        }
      </section>
      <section class="bf-card" aria-labelledby="reports-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="reports-title">Direct reports</h2>
        </div>
        @if (p.directReports.length) {
          <ul class="bf-list">
            @for (r of p.directReports; track r.id) {
              <li>
                <a [routerLink]="['/org/people', r.id]">{{ r.displayName }}</a> · {{ r.jobTitle }}
              </li>
            }
          </ul>
        } @else {
          <p class="bf-empty">No direct reports.</p>
        }
      </section>
    }
  `,
  styleUrl: './page.scss',
  styles: `
    .bf-list {
      margin: 0;
      padding: 0 20px 20px 40px;
      font: var(--mat-sys-body-medium);
    }
    .bf-back {
      align-self: flex-start;
      margin-inline-start: -12px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonPage {
  protected readonly valueOf = valueOf;
  private readonly api = injectApi();
  private readonly personId = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('personId') ?? '')),
    { initialValue: '' },
  );
  protected readonly lineColumns = ['manager', 'kind', 'from', 'to'];
  protected readonly editing = signal(false);
  protected readonly managerId = signal<string | null>(null);
  protected readonly effectiveFrom = signal(todayIso());
  protected readonly reason = signal('');
  protected readonly saving = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected readonly person = resource({
    params: () => (this.personId() ? { id: this.personId() } : undefined),
    loader: ({ params }) => data(this.api.getPerson({ params: { personId: params.id } })),
  });

  protected readonly candidates = resource({
    params: () => (this.editing() ? { limit: 200 } : undefined),
    loader: ({ params }) => data(this.api.listPeople({ query: params })),
  });

  protected readonly canManage = computed(
    () => valueOf(this.person)?.allowedActions.includes('org.manage') ?? false,
  );

  protected async save(personId: string): Promise<void> {
    this.saving.set(true);
    this.failure.set(null);
    try {
      const after = await data(
        this.api.changeReportingLine({
          params: { personId },
          body: {
            managerPersonId: this.managerId()!,
            effectiveFrom: this.effectiveFrom(),
            reason: this.reason(),
          },
        }),
      );
      this.notice.set(
        `${after.displayName} reports to ${after.managerName} from ${this.effectiveFrom()}.`,
      );
      this.editing.set(false);
      this.person.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
