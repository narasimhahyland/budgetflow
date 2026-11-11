import { NgTemplateOutlet } from '@angular/common';
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
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import type { BreakGlassGrant, BreakGlassStatus } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { ReasonField } from './admin-ui';
import { data, errorMessage, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

const STATUS: Record<
  BreakGlassStatus,
  { label: string; tone: 'warning' | 'important' | 'neutral' | 'info' }
> = {
  requested: { label: 'Requested', tone: 'warning' },
  active: { label: 'Active', tone: 'important' },
  expired: { label: 'Expired', tone: 'neutral' },
  declined: { label: 'Declined', tone: 'neutral' },
  revoked: { label: 'Revoked', tone: 'info' },
};

type Pending = { grant: BreakGlassGrant; action: 'approve' | 'decline' | 'revoke' };

/**
 * Screen 112, break-glass access. The platform operator asks for time-limited, read-only access to
 * budgets and the ledger; an Organization Admin who is not the operator approves or declines it, and
 * can revoke an active grant. Every control comes from the API (`canRequest`, `canDecide` and each
 * grant's `allowedActions`); the status, window and actions-taken count are the API's, never derived
 * here.
 */
@Component({
  selector: 'bf-break-glass-page',
  imports: [
    DateTimePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatTableModule,
    NgTemplateOutlet,
    ReasonField,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Break-glass access</h1>
        <p class="bf-page__subtitle">
          Time-limited, read-only access for the platform operator in an emergency, approved by an
          Organization Admin and fully audited.
        </p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button routerLink="/admin/settings">Back to company settings</a>
      </div>
    </header>

    @if (notice()) {
      <sat-banner variant="success" class="bf-banner">
        <sat-banner-message data-testid="break-glass-notice">{{ notice() }}</sat-banner-message>
      </sat-banner>
    }
    @if (failure()) {
      <sat-banner variant="important" class="bf-banner">
        <sat-banner-message data-testid="break-glass-error">{{ failure() }}</sat-banner-message>
      </sat-banner>
    }

    <bf-load-state
      [loading]="grants.isLoading() && !grants.hasValue()"
      [error]="grants.error()"
      what="break-glass access"
      (retry)="grants.reload()"
    />

    @if (valueOf(grants); as list) {
      @for (g of active(); track g.id) {
        <sat-banner variant="important" class="bf-banner" data-testid="break-glass-active">
          <sat-banner-message>
            Break-glass access is active for {{ g.requestedByName }} until
            {{ g.endsAt | bfDateTime: timezone() }}. Read-only: budgets and the ledger.
          </sat-banner-message>
        </sat-banner>
        <ng-container *ngTemplateOutlet="bannerActions; context: { $implicit: g }" />
      }
      @for (g of waiting(); track g.id) {
        <sat-banner variant="warning" class="bf-banner" data-testid="break-glass-requested">
          <sat-banner-message>
            {{ g.requestedByName }} requests {{ duration(g.requestedMinutes) }} of read access:
            {{ g.reason }}
          </sat-banner-message>
        </sat-banner>
        <ng-container *ngTemplateOutlet="bannerActions; context: { $implicit: g }" />
      }
      <ng-template #bannerActions let-g>
        @if (g.allowedActions.length > 0) {
          <div class="bf-banner-actions">
            @for (a of g.allowedActions; track a) {
              <button
                mat-stroked-button
                type="button"
                [attr.data-testid]="'break-glass-banner-' + a"
                [disabled]="busy()"
                (click)="start(g, a)"
              >
                {{ actionLabel(a) }}
              </button>
            }
          </div>
        }
      </ng-template>

      @if (pending(); as p) {
        <form
          class="bf-card bf-inline-form"
          (ngSubmit)="confirm(p)"
          aria-label="Decide break-glass access"
        >
          <div class="bf-form">
            <div class="bf-form__wide">
              <bf-reason-field
                [label]="actionLabel(p.action) + ': reason'"
                testId="break-glass-decision-reason"
                [value]="decisionReason()"
                (valueChange)="decisionReason.set($event)"
              />
            </div>
          </div>
          <div class="bf-form__actions">
            <button
              mat-flat-button
              type="submit"
              data-testid="break-glass-confirm"
              [disabled]="busy() || !decisionReason().trim()"
            >
              {{ actionLabel(p.action) }} for {{ p.grant.requestedByName }}
            </button>
            <button mat-button type="button" (click)="pending.set(null)">Cancel</button>
          </div>
        </form>
      }

      <section class="bf-card" aria-labelledby="bg-about">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="bg-about">How it works</h2>
        </div>
        <div class="bf-card__body">
          <sat-banner variant="info">
            <sat-banner-message>{{ list.note }}</sat-banner-message>
          </sat-banner>
        </div>
      </section>

      @if (list.canRequest) {
        <section class="bf-card" aria-labelledby="bg-request">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="bg-request">Request access</h2>
          </div>
          <form class="bf-inline-form" (ngSubmit)="request()">
            <div class="bf-form">
              <div class="bf-form__wide">
                <bf-reason-field
                  label="Why you need access"
                  hint="Organization Admins see this when they decide."
                  testId="break-glass-reason"
                  [value]="reason()"
                  (valueChange)="reason.set($event)"
                />
              </div>
              <mat-form-field appearance="outline">
                <mat-label>How long (minutes)</mat-label>
                <input
                  matInput
                  type="number"
                  inputmode="numeric"
                  name="minutes"
                  data-testid="break-glass-minutes"
                  [ngModel]="minutes()"
                  (ngModelChange)="minutes.set($event)"
                />
                <mat-hint
                  >15 to {{ list.maxMinutes }} minutes; the window starts on approval.</mat-hint
                >
              </mat-form-field>
            </div>
            <div class="bf-form__actions">
              <button
                mat-flat-button
                type="submit"
                data-testid="break-glass-submit"
                [disabled]="busy() || !reason().trim()"
              >
                Request read-only access
              </button>
            </div>
          </form>
        </section>
      }

      <section class="bf-card" aria-labelledby="bg-grants">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="bg-grants">Requests and grants</h2>
        </div>
        @if (list.items.length === 0) {
          <sat-empty-state>
            <h3 satEmptyStateHeadline>No break-glass requests</h3>
            <p satEmptyStateDescription>
              The platform operator has never asked for access to this company's financial data.
            </p>
          </sat-empty-state>
        } @else {
          <div class="bf-table-scroll">
            <table mat-table [dataSource]="list.items" aria-label="Break-glass requests and grants">
              <ng-container matColumnDef="requested">
                <th mat-header-cell *matHeaderCellDef>Requested</th>
                <td mat-cell *matCellDef="let g">
                  <span class="bf-cell__primary">{{ g.requestedByName }}</span>
                  <span class="bf-cell__secondary">{{
                    g.requestedAt | bfDateTime: timezone()
                  }}</span>
                </td>
              </ng-container>
              <ng-container matColumnDef="reason">
                <th mat-header-cell *matHeaderCellDef>Reason and scope</th>
                <td mat-cell *matCellDef="let g">
                  <span class="bf-cell__primary">{{ g.reason }}</span>
                  <span class="bf-cell__secondary"
                    >{{ g.scopeLabel }}, {{ duration(g.requestedMinutes) }}</span
                  >
                </td>
              </ng-container>
              <ng-container matColumnDef="status">
                <th mat-header-cell *matHeaderCellDef>Status</th>
                <td mat-cell *matCellDef="let g">
                  <sat-status-tag [status]="tag(g).tone">{{ tag(g).label }}</sat-status-tag>
                </td>
              </ng-container>
              <ng-container matColumnDef="window">
                <th mat-header-cell *matHeaderCellDef>Window</th>
                <td mat-cell *matCellDef="let g">
                  @if (g.startsAt) {
                    <span class="bf-cell__primary"
                      >{{ g.startsAt | bfDateTime: timezone() }} to
                      {{ g.endsAt | bfDateTime: timezone() }}</span
                    >
                  } @else {
                    <span class="bf-cell__secondary">Not started</span>
                  }
                </td>
              </ng-container>
              <ng-container matColumnDef="decision">
                <th mat-header-cell *matHeaderCellDef>Decision</th>
                <td mat-cell *matCellDef="let g">
                  @if (g.decidedByName) {
                    <span class="bf-cell__primary">{{ g.decidedByName }}</span>
                    <span class="bf-cell__secondary">{{ g.decisionReason }}</span>
                  }
                  @if (g.revokedByName) {
                    <span class="bf-cell__secondary"
                      >Revoked by {{ g.revokedByName }}: {{ g.revokeReason }}</span
                    >
                  }
                </td>
              </ng-container>
              <ng-container matColumnDef="actions">
                <th mat-header-cell *matHeaderCellDef class="bf-num">Actions taken</th>
                <td mat-cell *matCellDef="let g" class="bf-num" data-testid="break-glass-actions">
                  {{ g.actionsTaken }}
                </td>
              </ng-container>
              <ng-container matColumnDef="controls">
                <th mat-header-cell *matHeaderCellDef><span class="bf-sr">Decide</span></th>
                <td mat-cell *matCellDef="let g">
                  <div class="bf-row-actions">
                    @for (a of g.allowedActions; track a) {
                      <button
                        mat-stroked-button
                        type="button"
                        [attr.data-testid]="'break-glass-' + a"
                        [disabled]="busy()"
                        (click)="start(g, a)"
                      >
                        {{ actionLabel(a) }}
                      </button>
                    }
                  </div>
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="columns"></tr>
              <tr mat-row *matRowDef="let row; columns: columns"></tr>
            </table>
          </div>
        }
      </section>
    }
  `,
  styles: `
    .bf-banner-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: -4px 20px 12px;
    }
  `,
  styleUrls: ['./page.scss', './settings.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BreakGlassPage {
  protected readonly valueOf = valueOf;
  protected readonly columns = [
    'requested',
    'reason',
    'status',
    'window',
    'decision',
    'actions',
    'controls',
  ];

  private readonly api = injectApi();
  protected readonly timezone = inject(SessionStore).timezone;

  protected readonly grants = resource({ loader: () => data(this.api.breakGlassGrants({})) });
  protected readonly active = computed(
    () => valueOf(this.grants)?.items.filter((g) => g.status === 'active') ?? [],
  );
  protected readonly waiting = computed(() => {
    const list = valueOf(this.grants);
    return list?.canDecide ? list.items.filter((g) => g.status === 'requested') : [];
  });

  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly reason = signal('');
  protected readonly minutes = signal<number | string>(60);
  protected readonly pending = signal<Pending | null>(null);
  protected readonly decisionReason = signal('');

  protected tag(g: BreakGlassGrant): (typeof STATUS)[BreakGlassStatus] {
    return STATUS[g.status];
  }

  protected duration(minutes: number): string {
    if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`;
    return `${minutes} minutes`;
  }

  protected actionLabel(a: Pending['action']): string {
    return a === 'approve' ? 'Approve' : a === 'decline' ? 'Decline' : 'Revoke';
  }

  protected start(grant: BreakGlassGrant, action: Pending['action']): void {
    this.decisionReason.set('');
    this.pending.set({ grant, action });
  }

  protected async request(): Promise<void> {
    await this.run(async () => {
      await data(
        this.api.requestBreakGlass({
          body: { reason: this.reason(), durationMinutes: Number(this.minutes()) },
        }),
      );
      this.reason.set('');
      this.notice.set('Your request is sent. An Organization Admin has to approve it.');
    });
  }

  protected async confirm(p: Pending): Promise<void> {
    await this.run(async () => {
      const reason = this.decisionReason();
      if (p.action === 'revoke')
        await data(
          this.api.revokeBreakGlass({ params: { grantId: p.grant.id }, body: { reason } }),
        );
      else
        await data(
          this.api.decideBreakGlass({
            params: { grantId: p.grant.id },
            body: { decision: p.action, reason },
          }),
        );
      this.pending.set(null);
      this.notice.set(
        p.action === 'approve'
          ? `Access approved for ${p.grant.requestedByName}.`
          : p.action === 'decline'
            ? `The request from ${p.grant.requestedByName} is declined.`
            : `Access for ${p.grant.requestedByName} is revoked.`,
      );
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    this.notice.set(null);
    try {
      await action();
      this.grants.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
