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
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { DecisionResponse } from '@bf/contracts';
import { Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatGhost } from '@hylandsoftware/satori-ui/ghost';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SatCategoryTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, errorStatus, injectApi, valueOf } from './api';

const REASONS = [
  { code: 'REJ-BUDGET', label: 'Insufficient budget' },
  { code: 'REJ-POLICY', label: 'Outside policy' },
];

/**
 * Screen 61a landing page (public, outside the shell): an actionable email link re-checked now. Approve
 * runs once on opening; Reject asks for a reason first. Used, expired or changed links explain why.
 */
@Component({
  selector: 'bf-email-action-page',
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SatCategoryTag,
    SatGhost,
    SatImportantButton,
  ],
  template: `
    <main class="bf-landing">
      <section class="bf-card bf-landing__card" aria-labelledby="landing-title">
        <div class="bf-card__header">
          <h1 class="bf-page__title" id="landing-title">BudgetFlow · Hyland</h1>
        </div>
        @if (!token) {
          <p class="bf-section">This link is incomplete. Open the request in BudgetFlow instead.</p>
        } @else if (preview.isLoading() && !preview.hasValue()) {
          <div class="bf-section bf-email__ghost" aria-busy="true" aria-label="Checking the link">
            <sat-ghost variant="box" [height]="24" fitContainer />
            <sat-ghost variant="box" [height]="32" fitContainer />
            <sat-ghost variant="box" [height]="16" fitContainer />
            <sat-ghost variant="box" [height]="56" fitContainer />
          </div>
        } @else if (preview.error()) {
          <sat-banner variant="important" class="bf-banner"
            ><sat-banner-message>{{ message(preview.error()) }}</sat-banner-message></sat-banner
          >
          <div class="bf-form__actions">
            <a mat-stroked-button routerLink="/approvals">Open the approval inbox</a>
          </div>
        } @else if (valueOf(preview); as p) {
          <div class="bf-section">
            <p class="bf-meta">
              <sat-category-tag category="gray">{{ p.ref }}</sat-category-tag> {{ p.title }}
            </p>
            <p class="bf-email__amount">
              <bf-money [amountMinor]="p.amount.amountMinor" [currency]="p.amount.currency" />
            </p>
            <p class="bf-cell__secondary">
              Requested by {{ p.requesterName }} · charge to {{ p.budgetName }} · approver
              {{ p.approverName }}
            </p>
            @if (p.availableBefore && p.availableAfter) {
              <dl class="bf-email__figures" aria-label="Available under this budget's rules">
                <div>
                  <dt>Available now</dt>
                  <dd>
                    <bf-money
                      [amountMinor]="p.availableBefore.amountMinor"
                      [currency]="p.availableBefore.currency"
                    />
                  </dd>
                </div>
                <mat-icon class="bf-email__arrow" svgIcon="arrow_right" aria-hidden="true" />
                <div>
                  <dt>After approval</dt>
                  <dd [class.bf-email__negative]="p.availableAfter.amountMinor < 0">
                    <bf-money
                      [amountMinor]="p.availableAfter.amountMinor"
                      [currency]="p.availableAfter.currency"
                    />
                  </dd>
                </div>
              </dl>
            }
            @if (p.warning) {
              <sat-banner variant="warning"
                ><sat-banner-message>{{ p.warning }}</sat-banner-message></sat-banner
              >
            }
          </div>
          @if (result(); as r) {
            <sat-banner variant="success" class="bf-banner" data-testid="email-action-result"
              ><sat-banner-message>{{ r.message }}</sat-banner-message></sat-banner
            >
            <div class="bf-form__actions">
              <a mat-stroked-button [routerLink]="detailsLink(r)">See details in BudgetFlow</a>
            </div>
          } @else if (failure()) {
            <sat-banner variant="important" class="bf-banner"
              ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
            >
          } @else if (p.state !== 'valid') {
            <sat-banner [variant]="p.state === 'held' ? 'info' : 'warning'" class="bf-banner"
              ><sat-banner-message>{{ p.message }}</sat-banner-message></sat-banner
            >
            <div class="bf-form__actions">
              <a
                mat-stroked-button
                [routerLink]="
                  p.subjectType === 'request'
                    ? ['/requests', p.subjectId]
                    : ['/contributions', p.subjectId]
                "
                >Open in BudgetFlow</a
              >
            </div>
          } @else if (p.action === 'approve') {
            <p class="bf-section bf-cell__secondary" role="status" aria-busy="true">
              {{ busy() ? 'Recording your approval…' : '' }}
            </p>
          } @else {
            <div class="bf-form">
              <mat-form-field appearance="outline">
                <mat-label>Reason code</mat-label>
                <mat-select [(ngModel)]="reasonCode" name="reasonCode">
                  @for (r of reasons; track r.code) {
                    <mat-option [value]="r.code">{{ r.code }} · {{ r.label }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline" class="bf-form__wide">
                <mat-label>Reason for the requester</mat-label>
                <textarea matInput rows="3" [(ngModel)]="reason" name="reason" required></textarea>
                <mat-error
                  ><mat-icon class="bf-error-icon" svgIcon="error" aria-hidden="true" />Say why, so
                  the requester knows what to change.</mat-error
                >
              </mat-form-field>
            </div>
            <div class="bf-form__actions">
              @if (!busy() && !reason.trim()) {
                <p class="bf-email__why" id="reject-why">Give the requester a reason to reject.</p>
              }
              <button
                mat-flat-button
                satImportantButton
                type="button"
                [disabled]="busy() || !reason.trim()"
                [attr.aria-describedby]="!reason.trim() ? 'reject-why' : null"
                (click)="execute()"
              >
                Reject {{ p.ref }}
              </button>
            </div>
          }
          <p class="bf-section bf-cell__secondary">
            To approve part or ask for changes, open the request in BudgetFlow.
          </p>
        }
      </section>
    </main>
  `,
  styles: `
    .bf-landing {
      display: flex;
      justify-content: center;
      min-height: 100vh;
      padding: 48px 16px;
      background: var(--mat-sys-surface-container-low);
      box-sizing: border-box;
    }
    .bf-landing__card {
      width: min(560px, 100%);
      align-self: flex-start;
    }
    .bf-email__ghost {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .bf-email__amount {
      margin: 8px 0 4px;
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-headline-small);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .bf-email__figures {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 16px;
      margin: 12px 0;
      padding: 12px 16px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-medium);
    }
    .bf-email__figures dt {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-medium);
    }
    .bf-email__figures dd {
      margin: 2px 0 0;
      font: var(--mat-sys-title-medium);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .bf-email__negative {
      color: var(--mat-sys-error);
    }
    .bf-email__arrow {
      color: var(--mat-sys-on-surface-variant);
    }
    .bf-email__why {
      flex: 1 1 200px;
      margin: 0;
      align-self: center;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .bf-error-icon {
      width: 16px;
      height: 16px;
      margin-inline-end: 4px;
      vertical-align: -3px;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmailActionPage {
  private readonly api = injectApi();
  protected readonly valueOf = valueOf;
  protected readonly reasons = REASONS;
  protected readonly token = inject(ActivatedRoute).snapshot.queryParamMap.get('token') ?? '';
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly result = signal<DecisionResponse | null>(null);
  protected reasonCode = '';
  protected reason = '';
  private started = false;

  protected readonly preview = resource({
    params: () => (this.token ? { token: this.token } : undefined),
    loader: async ({ params }) => {
      const p = await data(this.api.previewEmailAction({ params }));
      if (p.state === 'valid' && p.action === 'approve' && !this.started) {
        this.started = true;
        queueMicrotask(() => void this.execute());
      }
      return p;
    },
  });
  protected readonly state = computed(() => valueOf(this.preview)?.state);

  protected message(e: unknown): string {
    const status = errorStatus(e);
    if (status >= 400 && status < 500)
      return 'This approval link is not valid. It may be incomplete or changed; open the approval inbox to decide there.';
    return errorMessage(e);
  }

  protected detailsLink(r: DecisionResponse): string[] {
    return r.subjectType === 'request'
      ? ['/requests', r.subjectId]
      : ['/contributions', r.subjectId];
  }

  protected async execute(): Promise<void> {
    this.busy.set(true);
    this.failure.set('');
    try {
      this.result.set(
        await data(
          this.api.executeEmailAction({
            body: {
              token: this.token,
              ...(this.reasonCode ? { reasonCode: this.reasonCode } : {}),
              ...(this.reason.trim() ? { reason: this.reason.trim() } : {}),
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
