import { ChangeDetectionStrategy, Component, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import type { Person } from '@bf/contracts';
import { DateOnlyPipe, LoadState, Money } from '@bf/web/ui';
import { SatAvatar } from '@hylandsoftware/satori-ui/avatar';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, todayIso, valueOf } from './api';

/** Delegations (the 62 delegated state): hand my approvals to someone for a period, capped by my own limit. */
@Component({
  selector: 'bf-delegations-page',
  imports: [
    DateOnlyPipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SatAvatar,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Delegations</h1>
        <p class="bf-page__subtitle">
          A delegate decides for you between the dates, within the lower of their delegation limit
          and your own; both names are audited.
        </p>
      </div>
      <div class="bf-page__actions"><a mat-button routerLink="/approvals">Back to inbox</a></div>
    </header>
    @if (failure()) {
      <sat-banner variant="important"
        ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
      >
    }
    <section class="bf-card" aria-labelledby="new-title">
      <div class="bf-card__header">
        <h2 class="bf-card__title" id="new-title">Set up a delegate</h2>
      </div>
      <div class="bf-form">
        <mat-form-field appearance="outline" class="bf-form__wide">
          <mat-label>Find the delegate</mat-label>
          <input matInput [ngModel]="query()" (ngModelChange)="query.set($event)" name="q" />
        </mat-form-field>
      </div>
      @if (!delegate() && query().length > 1) {
        <ul class="bf-list">
          @for (p of valueOf(people)?.items ?? []; track p.id) {
            <li>
              <button type="button" class="bf-list__item" (click)="delegate.set(p)">
                {{ p.displayName }} <span class="bf-cell__secondary">{{ p.jobTitle }}</span>
              </button>
            </li>
          }
        </ul>
      }
      @if (delegate(); as d) {
        <p class="bf-section">
          Delegate: <strong>{{ d.displayName }}</strong>
          <button mat-button type="button" (click)="delegate.set(null)">Change</button>
        </p>
      }
      <div class="bf-form">
        <mat-form-field appearance="outline"
          ><mat-label>From</mat-label><input matInput type="date" [(ngModel)]="from" name="from"
        /></mat-form-field>
        <mat-form-field appearance="outline"
          ><mat-label>To</mat-label><input matInput type="date" [(ngModel)]="to" name="to"
        /></mat-form-field>
        <mat-form-field appearance="outline"
          ><mat-label>Limit (USD, optional)</mat-label
          ><input matInput inputmode="decimal" [(ngModel)]="limit" name="limit"
        /></mat-form-field>
        <mat-form-field appearance="outline" class="bf-form__wide"
          ><mat-label>Reason</mat-label><input matInput [(ngModel)]="reason" name="reason"
        /></mat-form-field>
      </div>
      <div class="bf-form__actions">
        <button
          mat-flat-button
          type="button"
          [disabled]="busy() || !delegate() || !from || !to || reason.trim().length < 3"
          (click)="create()"
        >
          Delegate
        </button>
      </div>
    </section>
    <section class="bf-card" aria-labelledby="list-title">
      <div class="bf-card__header">
        <h2 class="bf-card__title" id="list-title">Delegations I gave or received</h2>
      </div>
      <bf-load-state
        [loading]="list.isLoading() && !list.hasValue()"
        [error]="list.error()"
        what="delegations"
        (retry)="list.reload()"
      />
      <div class="bf-table-scroll">
        <table class="bf-split-table bf-table--stack" aria-label="Delegations">
          <thead>
            <tr>
              <th>From</th>
              <th>To</th>
              <th>Dates</th>
              <th class="bf-num">Limit</th>
              <th>Reason</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            @for (d of valueOf(list)?.items ?? []; track d.id) {
              <tr>
                <td data-label="From">
                  <span class="bf-cell__owner"
                    ><sat-avatar
                      size="24"
                      [initials]="initials(d.delegatorName)"
                      aria-hidden="true"
                    />{{ d.delegatorName }}</span
                  >
                </td>
                <td data-label="To">
                  <span class="bf-cell__owner"
                    ><sat-avatar
                      size="24"
                      [initials]="initials(d.delegateName)"
                      aria-hidden="true"
                    />{{ d.delegateName }}</span
                  >
                </td>
                <td data-label="Dates">
                  {{ d.validFrom | bfDate: 'UTC' }} – {{ d.validTo | bfDate: 'UTC' }}
                </td>
                <td class="bf-num" data-label="Limit">
                  @if (d.limit) {
                    <bf-money [amountMinor]="d.limit.amountMinor" [currency]="d.limit.currency" />
                  } @else {
                    Delegator's limit
                  }
                </td>
                <td data-label="Reason">{{ d.reason }}</td>
                <td data-label="State">
                  @if (d.active) {
                    <sat-status-tag status="success"
                      ><mat-icon svgIcon="circle_check" aria-hidden="true" />Active</sat-status-tag
                    >
                  } @else {
                    <sat-status-tag status="neutral"
                      ><mat-icon svgIcon="timer_off" aria-hidden="true" />Ended</sat-status-tag
                    >
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="6">No delegations.</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DelegationsPage {
  private readonly api = injectApi();
  private readonly snack = inject(MatSnackBar);
  protected readonly valueOf = valueOf;
  protected readonly query = signal('');
  protected readonly delegate = signal<Person | null>(null);
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected from = todayIso();
  protected to = todayIso();
  protected limit = '';
  protected reason = '';
  protected readonly list = resource({ loader: () => data(this.api.listDelegations({})) });
  protected readonly people = resource({
    params: () =>
      this.query().trim().length > 1 ? { q: this.query().trim(), limit: 8 } : undefined,
    loader: ({ params }) => data(this.api.listPeople({ query: params })),
  });

  protected initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join('');
  }

  protected async create(): Promise<void> {
    this.busy.set(true);
    this.failure.set('');
    const limit = Number(this.limit.replace(/[,\s]/g, ''));
    try {
      await data(
        this.api.createDelegation({
          body: {
            delegatePersonId: this.delegate()!.id,
            validFrom: this.from,
            validTo: this.to,
            reason: this.reason.trim(),
            ...(this.limit && Number.isFinite(limit) && limit > 0
              ? { limit: { amountMinor: Math.round(limit * 100), currency: 'USD' } }
              : {}),
          },
        }),
      );
      this.snack.open(`Delegated to ${this.delegate()!.displayName}`, undefined, {
        duration: 4000,
      });
      this.delegate.set(null);
      this.query.set('');
      this.reason = '';
      this.list.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
