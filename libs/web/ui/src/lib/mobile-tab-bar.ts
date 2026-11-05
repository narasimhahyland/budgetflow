import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink, RouterLinkActive } from '@angular/router';

export interface MobileTabItem {
  id: 'approve' | 'balance' | 'receipt' | 'alerts';
  label: string;
  icon: string;
  link: string;
  badge?: number;
}

/**
 * Custom bottom navigation bar for the installable mobile web app (screens 059a, 059b, 123 mobile),
 * built with `--mat-sys-*` tokens and Material Icons per the 059a specification.
 */
@Component({
  selector: 'bf-mobile-tab-bar',
  imports: [MatIconModule, RouterLink, RouterLinkActive],
  template: `
    <nav class="bf-mobile-tabs" aria-label="Mobile navigation">
      <a
        routerLink="/m/approvals"
        routerLinkActive="bf-mobile-tabs__link--active"
        #rlaApprove="routerLinkActive"
        class="bf-mobile-tabs__link"
        [attr.aria-current]="rlaApprove.isActive ? 'page' : null"
        data-testid="mobile-tab-approve"
      >
        <span class="bf-mobile-tabs__icon-wrap">
          <mat-icon svgIcon="check_double" aria-hidden="true" />
          @if (approvalCount() > 0) {
            <span class="bf-mobile-tabs__badge" data-testid="mobile-approve-badge">{{
              approvalCount()
            }}</span>
          }
        </span>
        <span class="bf-mobile-tabs__label">Approve</span>
      </a>
      <a
        routerLink="/m/balance"
        routerLinkActive="bf-mobile-tabs__link--active"
        #rlaBalance="routerLinkActive"
        class="bf-mobile-tabs__link"
        [attr.aria-current]="rlaBalance.isActive ? 'page' : null"
        data-testid="mobile-tab-balance"
      >
        <span class="bf-mobile-tabs__icon-wrap">
          <mat-icon svgIcon="currency_dollar" aria-hidden="true" />
        </span>
        <span class="bf-mobile-tabs__label">Balance</span>
      </a>
      <a
        routerLink="/m/receipt"
        routerLinkActive="bf-mobile-tabs__link--active"
        #rlaReceipt="routerLinkActive"
        class="bf-mobile-tabs__link"
        [attr.aria-current]="rlaReceipt.isActive ? 'page' : null"
        data-testid="mobile-tab-receipt"
      >
        <span class="bf-mobile-tabs__icon-wrap">
          <mat-icon svgIcon="upload" aria-hidden="true" />
        </span>
        <span class="bf-mobile-tabs__label">Receipt</span>
      </a>
      <a
        routerLink="/m/alerts"
        routerLinkActive="bf-mobile-tabs__link--active"
        #rlaAlerts="routerLinkActive"
        class="bf-mobile-tabs__link"
        [attr.aria-current]="rlaAlerts.isActive ? 'page' : null"
        data-testid="mobile-tab-alerts"
      >
        <span class="bf-mobile-tabs__icon-wrap">
          <mat-icon svgIcon="bell" aria-hidden="true" />
          @if (alertCount() > 0) {
            <span class="bf-mobile-tabs__badge" data-testid="mobile-alert-badge">{{
              alertCount()
            }}</span>
          }
        </span>
        <span class="bf-mobile-tabs__label">Alerts</span>
      </a>
    </nav>
  `,
  styles: `
    .bf-mobile-tabs {
      position: sticky;
      bottom: 0;
      z-index: 20;
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      background: var(--mat-sys-surface-container);
      border-top: 1px solid var(--mat-sys-outline-variant);
      padding: 4px 8px env(safe-area-inset-bottom, 4px);
    }
    .bf-mobile-tabs__link {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      min-height: 52px;
      padding: 6px 4px;
      border-radius: var(--mat-sys-corner-medium);
      color: var(--mat-sys-on-surface-variant);
      text-decoration: none;
      font: var(--mat-sys-label-medium);
    }
    .bf-mobile-tabs__link--active {
      color: var(--mat-sys-primary);
      background: var(--mat-sys-secondary-container);
    }
    .bf-mobile-tabs__icon-wrap {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .bf-mobile-tabs__badge {
      position: absolute;
      top: -6px;
      inset-inline-end: -12px;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: var(--mat-sys-corner-full);
      background: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
      font: var(--mat-sys-label-small);
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .bf-mobile-tabs__label {
      line-height: 1.2;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MobileTabBar {
  readonly approvalCount = input(0);
  readonly alertCount = input(0);
}
