import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import type { EcosystemConnectionList, EcosystemConnectionView } from '@bf/contracts';
import { DateTimePipe } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import type { Tone } from '../labels';
import { byRank, byText, ordered, rankIn } from '../order';
import {
  CONNECTION_STATUS_LABELS,
  CONNECTION_STATUS_NOTES,
  CONNECTION_STATUS_ORDER,
  CONNECTION_STATUS_TONES,
  TOKEN_SECRECY_NOTE,
} from './labels';

/**
 * The connections of one surface (092a, 092b, 092c). Three things this table must never fudge.
 *
 * - **No token is on screen.** The API returns a token exactly once, in the create response. The
 *   list carries only when a connection was made, when it was last used and when it expires, so
 *   there is nothing here to copy and nothing to leak in a screenshot.
 * - **A dead connection looks dead.** Revoked and expired rows carry an important tone and a line
 *   saying what now happens to calls, so a revoked token is never mistaken for a healthy one.
 * - **Grants are listed in full.** What the connection may reach is the whole of what it may reach.
 */
@Component({
  selector: 'bf-ecosystem-connections',
  imports: [
    DateTimePipe,
    DecimalPipe,
    MatButtonModule,
    MatTableModule,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  template: `
    <div class="bf-card__header">
      <div>
        <h2 class="bf-card__title" [id]="headingId()">{{ heading() }}</h2>
        <p class="bf-card__hint">
          @if (list()?.seesAll) {
            Every connection in the company, because revoking someone else's is your job.
          } @else {
            Connections you made. Other people's are not listed.
          }
        </p>
      </div>
    </div>

    <sat-banner variant="info" class="bf-banner" [attr.data-testid]="testId() + '-secrecy'">
      <sat-banner-message>{{ tokenNote }}</sat-banner-message>
    </sat-banner>

    @if (items().length) {
      <div class="bf-table-scroll">
        <table mat-table [dataSource]="items()" [attr.aria-labelledby]="headingId()">
          <ng-container matColumnDef="label">
            <th mat-header-cell *matHeaderCellDef scope="col">Connection</th>
            <td mat-cell *matCellDef="let c">
              <span class="bf-cell__primary">{{ c.label }}</span>
              <span class="bf-cell__secondary">{{ c.clientLabel }}</span>
            </td>
          </ng-container>

          <ng-container matColumnDef="person">
            <th mat-header-cell *matHeaderCellDef scope="col">Acts as</th>
            <td mat-cell *matCellDef="let c">{{ c.personName ?? 'Someone who has left' }}</td>
          </ng-container>

          <ng-container matColumnDef="grants">
            <th mat-header-cell *matHeaderCellDef scope="col">{{ grantsHeading() }}</th>
            <td mat-cell *matCellDef="let c">
              <ul class="bf-chip-list">
                @for (g of c.grants; track g) {
                  <li class="bf-chip">{{ grantLabel()(g) }}</li>
                }
              </ul>
            </td>
          </ng-container>

          <ng-container matColumnDef="created">
            <th mat-header-cell *matHeaderCellDef scope="col">Made</th>
            <td mat-cell *matCellDef="let c">
              <span data-testid="relative-time">{{ c.createdAt | bfDateTime: timezone() }}</span>
            </td>
          </ng-container>

          <ng-container matColumnDef="used">
            <th mat-header-cell *matHeaderCellDef scope="col">Last used</th>
            <td mat-cell *matCellDef="let c">
              @if (c.lastUsedAt) {
                <span class="bf-cell__primary" data-testid="relative-time">{{
                  c.lastUsedAt | bfDateTime: timezone()
                }}</span>
              } @else {
                <span class="bf-cell__primary">Never used</span>
              }
              <span class="bf-cell__secondary"
                >{{ c.callsLast7Days | number }} calls in 7 days</span
              >
            </td>
          </ng-container>

          <ng-container matColumnDef="expires">
            <th mat-header-cell *matHeaderCellDef scope="col">Expires</th>
            <td mat-cell *matCellDef="let c">
              <span data-testid="relative-time">{{ c.expiresAt | bfDateTime: timezone() }}</span>
            </td>
          </ng-container>

          <ng-container matColumnDef="status">
            <th mat-header-cell *matHeaderCellDef scope="col">Status</th>
            <td mat-cell *matCellDef="let c">
              <sat-status-tag
                [status]="statusTone(c.status)"
                [attr.data-testid]="'connection-status-' + c.id"
                >{{ statusLabel(c.status) }}</sat-status-tag
              >
              <span class="bf-cell__secondary">{{ statusNote(c.status) }}</span>
            </td>
          </ng-container>

          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef scope="col">Actions</th>
            <td mat-cell *matCellDef="let c">
              @if (canRevoke(c)) {
                <button
                  mat-stroked-button
                  type="button"
                  (click)="revoke.emit(c)"
                  [attr.data-testid]="'revoke-connection-' + c.id"
                >
                  Revoke
                </button>
              } @else if (c.status === 'revoked') {
                <span class="bf-muted">Revoked</span>
              }
            </td>
          </ng-container>

          <tr mat-header-row *matHeaderRowDef="columns()"></tr>
          <tr
            mat-row
            *matRowDef="let row; columns: columns()"
            [class.bf-row--dead]="row.status === 'revoked' || row.status === 'expired'"
          ></tr>
        </table>
      </div>
    } @else {
      <sat-empty-state [attr.data-testid]="testId() + '-empty'">
        <h3 satEmptyStateHeadline>{{ emptyHeadline() }}</h3>
        <p satEmptyStateDescription>{{ emptyDescription() }}</p>
      </sat-empty-state>
    }
  `,
  styleUrls: ['../page.scss', '../integrations.scss', './ecosystem.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EcosystemConnections {
  readonly list = input<EcosystemConnectionList | undefined>(undefined);
  readonly heading = input('Connections');
  readonly headingId = input('connections-title');
  readonly grantsHeading = input('Can read');
  readonly grantLabel = input<(grant: string) => string>((g) => g);
  readonly emptyHeadline = input('No connections yet');
  readonly emptyDescription = input('Nothing outside BudgetFlow is reading through this surface.');
  readonly testId = input('connections');
  readonly timezone = input('UTC');
  readonly revoke = output<EcosystemConnectionView>();

  protected readonly tokenNote = TOKEN_SECRECY_NOTE;

  /** Connections about to stop working first, then the working ones, then the dead ones. */
  protected readonly items = computed(() =>
    ordered(
      this.list()?.items ?? [],
      byRank<EcosystemConnectionView>((c) => rankIn(CONNECTION_STATUS_ORDER, c.status)),
      byText<EcosystemConnectionView>((c) => c.label),
    ),
  );

  protected readonly columns = computed(() => {
    const base = ['label', 'grants', 'created', 'used', 'expires', 'status', 'actions'];
    return this.list()?.seesAll ? ['label', 'person', ...base.slice(1)] : base;
  });

  protected statusLabel(status: EcosystemConnectionView['status']): string {
    return CONNECTION_STATUS_LABELS[status];
  }

  protected statusTone(status: EcosystemConnectionView['status']): Tone {
    return CONNECTION_STATUS_TONES[status];
  }

  protected statusNote(status: EcosystemConnectionView['status']): string {
    return CONNECTION_STATUS_NOTES[status];
  }

  /** A revoked connection cannot be revoked again, and the API refuses a second attempt with 409. */
  protected canRevoke(c: EcosystemConnectionView): boolean {
    return c.status !== 'revoked';
  }
}
