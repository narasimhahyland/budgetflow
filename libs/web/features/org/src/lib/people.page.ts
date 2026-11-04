import { ChangeDetectionStrategy, Component, computed, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import type { Person } from '@bf/contracts';
import { SAT_TABLE_WITH_ROW_STATES_IMPORTS } from '@hylandsoftware/satori-ui/table-with-row-states';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { data, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

const TYPE_LABEL: Record<Person['employmentType'], string> = {
  employee: 'Employee',
  contractor: 'Contractor',
  intern: 'Intern',
};

/** Screen 38: employee directory, filtered by the caller's org scope. */
@Component({
  selector: 'bf-people-page',
  imports: [
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    RouterLink,
    SAT_TABLE_WITH_ROW_STATES_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">People</h1>
        <p class="bf-page__subtitle">Directory of Hyland people you can see. {{ scopeText() }}</p>
      </div>
    </header>
    <section class="bf-card" aria-labelledby="people-title">
      <div class="bf-card__header">
        <h2 class="bf-card__title" id="people-title">{{ valueOf(page)?.total ?? 0 }} people</h2>
      </div>
      <div class="bf-filters">
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Search name, email or title</mat-label>
          <input
            matInput
            [ngModel]="q()"
            (ngModelChange)="search($event)"
            data-testid="people-search"
          />
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Unit</mat-label>
          <mat-select [ngModel]="unitId()" (ngModelChange)="unitId.set($event); limit.set(50)">
            <mat-option [value]="null">All units</mat-option>
            @for (u of valueOf(units)?.items ?? []; track u.id) {
              <mat-option [value]="u.id">{{ indent(u.depth) }}{{ u.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>
      <bf-load-state
        [loading]="page.isLoading() && !page.hasValue()"
        [error]="page.error()"
        what="the people directory"
        (retry)="page.reload()"
      />
      @if (valueOf(page); as p) {
        @if (p.items.length === 0) {
          <p class="bf-empty">Nobody matches. Clear the search or pick another unit.</p>
        } @else {
          <div class="bf-table-scroll">
            <table mat-table satTableWithRowStates [dataSource]="p.items" aria-label="People">
              <ng-container matColumnDef="name">
                <th mat-header-cell *matHeaderCellDef>Name</th>
                <td mat-cell *matCellDef="let r">
                  <a
                    satRowPrimaryAction
                    [routerLink]="['/org/people', r.id]"
                    class="bf-cell__primary"
                    >{{ r.displayName }}</a
                  >
                  <span class="bf-cell__secondary">{{ r.jobTitle }}</span>
                </td>
              </ng-container>
              <ng-container matColumnDef="location">
                <th mat-header-cell *matHeaderCellDef>Location and team</th>
                <td mat-cell *matCellDef="let r">
                  <span class="bf-cell__primary">{{ r.locationName ?? '—' }}</span>
                  <span class="bf-cell__secondary">{{ r.orgUnitName ?? '' }}</span>
                </td>
              </ng-container>
              <ng-container matColumnDef="entity">
                <th mat-header-cell *matHeaderCellDef>Entity and cost center</th>
                <td mat-cell *matCellDef="let r">
                  <span class="bf-cell__primary">{{ r.employingEntityCode ?? '—' }}</span>
                  <span class="bf-cell__secondary">{{ r.costCenterCode ?? '' }}</span>
                </td>
              </ng-container>
              <ng-container matColumnDef="type">
                <th mat-header-cell *matHeaderCellDef>Type</th>
                <td mat-cell *matCellDef="let r">
                  <sat-status-tag
                    [status]="r.employmentType === 'employee' ? 'neutral' : 'info'"
                    [hideIcon]="true"
                  >
                    {{ typeName(r.employmentType) }}
                  </sat-status-tag>
                </td>
              </ng-container>
              <ng-container matColumnDef="manager">
                <th mat-header-cell *matHeaderCellDef>Manager</th>
                <td mat-cell *matCellDef="let r">{{ r.managerName ?? '—' }}</td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="columns"></tr>
              <tr mat-row satRowState *matRowDef="let row; columns: columns"></tr>
            </table>
          </div>
          @if (p.nextCursor) {
            <div class="bf-form__actions">
              <button mat-stroked-button type="button" (click)="limit.set(limit() + 50)">
                Show more
              </button>
            </div>
          }
        }
      }
    </section>
  `,
  styleUrl: './page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PeoplePage {
  protected readonly valueOf = valueOf;
  private readonly api = injectApi();
  protected readonly columns = ['name', 'location', 'entity', 'type', 'manager'];
  protected readonly q = signal('');
  protected readonly unitId = signal<string | null>(null);
  protected readonly limit = signal(50);
  private readonly debounced = signal('');
  private timer: ReturnType<typeof setTimeout> | undefined;

  protected readonly units = resource({ loader: () => data(this.api.listOrgUnits({})) });

  protected readonly page = resource({
    params: () => ({
      ...(this.debounced() ? { q: this.debounced() } : {}),
      ...(this.unitId() ? { orgUnitId: this.unitId()! } : {}),
      limit: this.limit(),
    }),
    loader: ({ params }) => data(this.api.listPeople({ query: params })),
  });

  protected readonly scopeText = computed(() =>
    valueOf(this.page)?.scope === 'tenant'
      ? 'You see everyone.'
      : valueOf(this.page)?.scope === 'subtree'
        ? 'You see people in the units you are responsible for.'
        : valueOf(this.page)?.scope === 'self'
          ? 'You see people in your own location and team.'
          : '',
  );

  protected typeName(type: Person['employmentType']): string {
    return TYPE_LABEL[type];
  }

  protected indent(depth: number): string {
    return '\u00a0\u00a0'.repeat(depth);
  }

  protected search(value: string): void {
    this.q.set(value);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.debounced.set(value.trim());
      this.limit.set(50);
    }, 250);
  }
}
