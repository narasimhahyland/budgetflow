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
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { DecisionResponse } from '@bf/contracts';
import { formatMoney } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
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
    MatInputModule,
    MatSelectModule,
    RouterLink,
    SAT_BANNER_IMPORTS,
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
          <p class="bf-section" aria-busy="true">Checking the link…</p>
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
              <span class="bf-chip">{{ p.ref }}</span> {{ p.title }}
            </p>
            <p class="bf-kpi__value">{{ money(p.amount) }}</p>
            <p class="bf-cell__secondary">
              Requested by {{ p.requesterName }} · charge to {{ p.budgetName }} · approver
              {{ p.approverName }}
            </p>
            @if (p.availableBefore && p.availableAfter) {
              <p class="bf-cell__secondary">
                Available now {{ money(p.availableBefore) }}; after approval
                {{ money(p.availableAfter) }}
              </p>
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
            <p class="bf-section" aria-busy="true">{{ busy() ? 'Approving…' : '' }}</p>
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
              </mat-form-field>
            </div>
            <div class="bf-form__actions">
              <button
                mat-stroked-button
                satImportantButton
                type="button"
                [disabled]="busy() || !reason.trim()"
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

  protected money(m: { amountMinor: number; currency: string }): string {
    return formatMoney(m.amountMinor, m.currency);
  }

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
