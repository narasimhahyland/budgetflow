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
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import type {
  ChannelDeliveryLogView,
  ChatAccountLinkView,
  ChatFeatures,
  ChatProvider,
} from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, LoadState, type StatusView } from '@bf/web/ui';
import { SatAvatar } from '@hylandsoftware/satori-ui/avatar';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SAT_NAVIGATION_TABS_IMPORTS } from '@hylandsoftware/satori-ui/navigation-tabs';
import { SatCategoryTag, SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { channelLabel, DELIVERY_STATUS, initials, sentence } from './labels';

/**
 * Screen 061e: Slack and Microsoft Teams app setup, account linking & delivery health (`/admin/channels`).
 * Integration Admin configures workspaces, feature toggles, allowed channels, reminds unlinked approvers,
 * disconnects with typed confirmation, unlinks accounts, and inspects 24h delivery logs.
 * Organization Admin and Finance Admin view in read-only mode.
 */
@Component({
  selector: 'bf-admin-channels-page',
  imports: [
    DateTimePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSlideToggleModule,
    MatTableModule,
    SAT_BANNER_IMPORTS,
    SatAvatar,
    SatCategoryTag,
    SatImportantButton,
    SAT_NAVIGATION_TABS_IMPORTS,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Slack and Microsoft Teams channels</h1>
        <p class="bf-page__subtitle">
          Workspace connections, interactive approval cards, account linking and delivery health
        </p>
      </div>
    </header>

    @if (failure()) {
      <sat-banner variant="important" data-testid="admin-channels-error">
        <sat-banner-message>{{ failure() }}</sat-banner-message>
      </sat-banner>
    }

    <bf-load-state
      [loading]="admin.isLoading() && !admin.hasValue()"
      [error]="admin.error()"
      what="channel settings"
      (retry)="admin.reload()"
    />

    @if (valueOf(admin); as a) {
      @if (!a.canManage) {
        <sat-banner variant="info" data-testid="readonly-banner">
          <sat-banner-message>
            Only Integration Admins can change channels. You have read-only access.
          </sat-banner-message>
        </sat-banner>
      }

      <div class="bf-admin-channels__grid">
        <!-- Slack card -->
        <section class="bf-card" aria-labelledby="slack-title" data-testid="slack-card">
          <div class="bf-card__header">
            <div>
              <h2 class="bf-card__title" id="slack-title">Slack</h2>
              <p class="bf-card__hint">
                Workspace {{ a.slack.workspaceName }}
                @if (a.slack.installedByName) {
                  · connected by {{ a.slack.installedByName }}
                }
              </p>
            </div>
            <sat-status-tag
              [status]="
                a.slack.status === 'connected'
                  ? 'success'
                  : a.slack.status === 'needs_attention'
                    ? 'important'
                    : 'neutral'
              "
              data-testid="slack-status-tag"
            >
              {{ statusLabel(a.slack.status) }}
            </sat-status-tag>
          </div>

          <div class="bf-section">
            <div class="bf-admin-channels__toggles">
              <mat-slide-toggle
                [checked]="a.slack.features.approvalCards"
                [disabled]="!a.canManage || a.slack.status !== 'connected' || busy()"
                (change)="toggleFeature('slack', 'approvalCards', $event.checked)"
                data-testid="slack-toggle-approvals"
              >
                Approval cards
              </mat-slide-toggle>
              <mat-slide-toggle
                [checked]="a.slack.features.balanceAndQuickRequest"
                [disabled]="!a.canManage || a.slack.status !== 'connected' || busy()"
                (change)="toggleFeature('slack', 'balanceAndQuickRequest', $event.checked)"
                data-testid="slack-toggle-balance"
              >
                Balance and quick request
              </mat-slide-toggle>
              <mat-slide-toggle
                [checked]="a.slack.features.alerts"
                [disabled]="!a.canManage || a.slack.status !== 'connected' || busy()"
                (change)="toggleFeature('slack', 'alerts', $event.checked)"
                data-testid="slack-toggle-alerts"
              >
                Alerts
              </mat-slide-toggle>
              <mat-slide-toggle
                [checked]="a.slack.features.scheduledReportPosts"
                [disabled]="!a.canManage || a.slack.status !== 'connected' || busy()"
                (change)="toggleFeature('slack', 'scheduledReportPosts', $event.checked)"
                data-testid="slack-toggle-reports"
              >
                Scheduled report posts
              </mat-slide-toggle>
            </div>

            <div class="bf-admin-channels__channels">
              <span class="bf-cell__secondary">Allowed channels for scheduled report posts:</span>
              <div class="bf-admin-channels__chips">
                @for (ch of a.slack.allowedChannels; track ch) {
                  <span class="bf-chip">{{ ch }}</span>
                }
              </div>
              @if (a.canManage && a.slack.status === 'connected') {
                <div class="bf-admin-channels__add-channel">
                  <mat-form-field appearance="outline" subscriptSizing="dynamic">
                    <mat-label>Add channel</mat-label>
                    <input
                      matInput
                      [(ngModel)]="newSlackChannel"
                      name="newSlackChannel"
                      data-testid="new-slack-channel"
                    />
                    <mat-hint>For example #exec-updates</mat-hint>
                  </mat-form-field>
                  <button
                    mat-stroked-button
                    type="button"
                    [disabled]="busy() || !newSlackChannel.trim()"
                    (click)="addChannel('slack', a.slack.allowedChannels)"
                    data-testid="add-slack-channel"
                  >
                    Add channel
                  </button>
                </div>
              }
            </div>

            <p
              class="bf-cell__secondary bf-admin-channels__delivery"
              data-testid="slack-approvers-linked"
            >
              {{ a.slack.linkedApproversCount }} of {{ a.slack.totalApproversCount }} approvers
              linked · Last 24h: {{ a.slack.delivery24h.sent }} sent,
              {{ a.slack.delivery24h.retried }} retried, {{ a.slack.delivery24h.failed }} failed
            </p>
            <p class="bf-cell__secondary">
              Bot token and signing secret are kept in the server's secret store.
            </p>

            <div class="bf-form__actions">
              @if (a.slack.status === 'connected') {
                <button
                  mat-stroked-button
                  type="button"
                  [disabled]="!a.canManage || busy()"
                  (click)="remindUnlinked('slack')"
                  data-testid="remind-unlinked-slack"
                >
                  Remind unlinked approvers
                </button>
                <button
                  mat-stroked-button
                  type="button"
                  [disabled]="!a.canManage || busy()"
                  (click)="showDisconnect.set('slack')"
                  data-testid="open-disconnect-slack"
                >
                  Disconnect
                </button>
              } @else {
                <button
                  mat-flat-button
                  type="button"
                  [disabled]="!a.canManage || busy()"
                  (click)="connectProvider('slack')"
                  data-testid="connect-slack-workspace"
                >
                  Connect Slack
                </button>
              }
            </div>

            @if (showDisconnect() === 'slack') {
              <div class="bf-admin-channels__disconnect" data-testid="disconnect-dialog">
                <h3 class="bf-section__title">Disconnect Slack?</h3>
                <p class="bf-cell__secondary">
                  Open approval cards in Slack will stop working and pending approvals will fall
                  back to email and in-app. Type <strong>DISCONNECT</strong> to confirm.
                </p>
                <mat-form-field appearance="outline">
                  <mat-label>Type DISCONNECT to confirm</mat-label>
                  <input
                    matInput
                    [(ngModel)]="disconnectConfirm"
                    name="disconnectConfirm"
                    data-testid="disconnect-confirm-input"
                  />
                </mat-form-field>
                <div class="bf-form__actions">
                  <button mat-button type="button" (click)="showDisconnect.set(null)">
                    Cancel
                  </button>
                  <button
                    mat-flat-button
                    satImportantButton
                    type="button"
                    [disabled]="busy() || disconnectConfirm !== 'DISCONNECT'"
                    (click)="confirmDisconnect('slack')"
                    data-testid="confirm-disconnect-btn"
                  >
                    Disconnect Slack
                  </button>
                </div>
              </div>
            }
          </div>
        </section>

        <!-- Microsoft Teams card -->
        <section class="bf-card" aria-labelledby="teams-title" data-testid="teams-card">
          <div class="bf-card__header">
            <div>
              <h2 class="bf-card__title" id="teams-title">Microsoft Teams</h2>
              <p class="bf-card__hint">Tenant {{ a.teams.workspaceName }}</p>
            </div>
            <sat-status-tag
              [status]="a.teams.status === 'connected' ? 'success' : 'warning'"
              data-testid="teams-status-tag"
            >
              {{ statusLabel(a.teams.status) }}
            </sat-status-tag>
          </div>

          <div class="bf-section">
            @if (a.teams.status !== 'connected') {
              <ol class="bf-timeline">
                <li>1. Grant consent in Microsoft Entra</li>
                <li>2. Approve the BudgetFlow app in the Teams admin center</li>
                <li>3. Check status to enable Adaptive Card approvals</li>
              </ol>
            }

            <div class="bf-admin-channels__toggles">
              <mat-slide-toggle
                [checked]="a.teams.features.approvalCards"
                [disabled]="!a.canManage || a.teams.status !== 'connected' || busy()"
                (change)="toggleFeature('teams', 'approvalCards', $event.checked)"
              >
                Approval cards
              </mat-slide-toggle>
              <mat-slide-toggle
                [checked]="a.teams.features.balanceAndQuickRequest"
                [disabled]="!a.canManage || a.teams.status !== 'connected' || busy()"
                (change)="toggleFeature('teams', 'balanceAndQuickRequest', $event.checked)"
              >
                Balance and quick request
              </mat-slide-toggle>
              <mat-slide-toggle
                [checked]="a.teams.features.alerts"
                [disabled]="!a.canManage || a.teams.status !== 'connected' || busy()"
                (change)="toggleFeature('teams', 'alerts', $event.checked)"
              >
                Alerts
              </mat-slide-toggle>
            </div>

            <p class="bf-cell__secondary">
              Bot token and signing secret are kept in the server's secret store.
            </p>

            <div class="bf-form__actions">
              @if (a.teams.status !== 'connected') {
                <button
                  mat-stroked-button
                  type="button"
                  [disabled]="!a.canManage || busy()"
                  (click)="checkConsent('teams')"
                  data-testid="teams-check-status"
                >
                  Check status
                </button>
              } @else {
                <button
                  mat-stroked-button
                  type="button"
                  [disabled]="!a.canManage || busy()"
                  (click)="remindUnlinked('teams')"
                >
                  Remind unlinked approvers
                </button>
              }
            </div>
          </div>
        </section>
      </div>

      <!-- Linked people table -->
      <section class="bf-card" aria-labelledby="links-title" data-testid="linked-people-card">
        <div class="bf-card__header">
          <div>
            <h2 class="bf-card__title" id="links-title">Linked accounts</h2>
            <p class="bf-card__hint">
              People who have bound their Slack or Microsoft Teams identity to BudgetFlow
            </p>
          </div>
          <mat-checkbox
            [checked]="showUnlinkedOnly()"
            (change)="showUnlinkedOnly.set($event.checked)"
            data-testid="filter-unlinked-approvers"
          >
            Approvers not linked ({{ a.unlinkedApprovers.length }})
          </mat-checkbox>
        </div>

        @if (showUnlinkedOnly()) {
          <ul class="bf-list" data-testid="unlinked-approvers-list">
            @for (u of a.unlinkedApprovers; track u.personId) {
              <li class="bf-list__item bf-list__row">
                <span>
                  <strong>{{ u.displayName }}</strong> · {{ u.roleLabel }}
                </span>
                <span class="bf-cell__secondary">{{ u.email }}</span>
              </li>
            } @empty {
              <li class="bf-list__item">Every approver has linked their chat account.</li>
            }
          </ul>
        } @else {
          <sat-navigation-tabs class="bf-tabs" aria-label="Chat providers">
            <a
              satNavigationTab
              [active]="linkTab() === 'slack'"
              (click)="linkTab.set('slack')"
              (keydown.enter)="linkTab.set('slack')"
              tabindex="0"
              data-testid="tab-links-slack"
              >Slack</a
            >
            <a
              satNavigationTab
              [active]="linkTab() === 'teams'"
              (click)="linkTab.set('teams')"
              (keydown.enter)="linkTab.set('teams')"
              tabindex="0"
              data-testid="tab-links-teams"
              >Microsoft Teams</a
            >
          </sat-navigation-tabs>

          <div class="bf-table-scroll">
            <table
              mat-table
              class="bf-table bf-table--stack"
              [dataSource]="filteredLinks()"
              aria-label="Linked people"
              data-testid="linked-people-table"
            >
              <ng-container matColumnDef="person">
                <th mat-header-cell *matHeaderCellDef>Person</th>
                <td mat-cell *matCellDef="let l">
                  <span class="bf-cell__owner">
                    <sat-avatar size="28" [initials]="initials(l.personName)" />
                    <span>
                      <span class="bf-cell__primary">{{ l.personName }}</span>
                      <span class="bf-cell__secondary">{{ l.personRole }}</span>
                    </span>
                  </span>
                </td>
              </ng-container>
              <ng-container matColumnDef="account">
                <th mat-header-cell *matHeaderCellDef>Chat account</th>
                <td mat-cell *matCellDef="let l" data-label="Chat account">
                  <span class="bf-admin-channels__account">
                    <span class="bf-cell__primary">{{ l.handle }}</span>
                    <span class="bf-cell__secondary">{{ l.verifiedEmail }}</span>
                  </span>
                </td>
              </ng-container>
              <ng-container matColumnDef="linkedAt">
                <th mat-header-cell *matHeaderCellDef>Linked on</th>
                <td mat-cell *matCellDef="let l" data-label="Linked on">
                  <span data-testid="relative-time">{{
                    l.linkedAt | bfDateTime: session.timezone()
                  }}</span>
                </td>
              </ng-container>
              <ng-container matColumnDef="actions">
                <th mat-header-cell *matHeaderCellDef>Action</th>
                <td mat-cell *matCellDef="let l" data-label="Action">
                  @if (a.canManage) {
                    <button
                      mat-button
                      type="button"
                      [disabled]="busy()"
                      (click)="unlink(l)"
                      [attr.data-testid]="'admin-unlink-' + l.id"
                    >
                      Unlink
                    </button>
                  }
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="linkColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: linkColumns"></tr>
            </table>
          </div>
        }
      </section>

      <!-- Delivery logs table -->
      <section class="bf-card" aria-labelledby="deliveries-title" data-testid="deliveries-card">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="deliveries-title">Recent channel deliveries</h2>
          <span class="bf-card__hint">Outbound cards, alerts and emails</span>
        </div>
        <div class="bf-table-scroll">
          <table
            mat-table
            class="bf-table bf-table--stack"
            [dataSource]="a.deliveries.slice(0, 15)"
            aria-label="Recent channel deliveries"
          >
            <ng-container matColumnDef="channel">
              <th mat-header-cell *matHeaderCellDef>Channel</th>
              <td mat-cell *matCellDef="let d" data-label="Channel">
                <sat-category-tag category="gray">{{ channelLabel(d.channel) }}</sat-category-tag>
              </td>
            </ng-container>
            <ng-container matColumnDef="recipient">
              <th mat-header-cell *matHeaderCellDef>Recipient</th>
              <td mat-cell *matCellDef="let d" data-label="Recipient">
                {{ d.recipientName ?? 'Workspace' }}
              </td>
            </ng-container>
            <ng-container matColumnDef="kind">
              <th mat-header-cell *matHeaderCellDef>Event</th>
              <td mat-cell *matCellDef="let d" data-label="Event">{{ sentence(d.kind) }}</td>
            </ng-container>
            <ng-container matColumnDef="status">
              <th mat-header-cell *matHeaderCellDef>Status</th>
              <td mat-cell *matCellDef="let d" data-label="Status">
                @let s = deliveryStatusOf(d);
                <sat-status-tag [status]="s.tone"
                  ><mat-icon [svgIcon]="s.icon" aria-hidden="true" />{{ s.label }}</sat-status-tag
                >
              </td>
            </ng-container>
            <ng-container matColumnDef="createdAt">
              <th mat-header-cell *matHeaderCellDef>Time</th>
              <td mat-cell *matCellDef="let d" data-label="Time">
                <span data-testid="relative-time">{{
                  d.createdAt | bfDateTime: session.timezone()
                }}</span>
              </td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="deliveryColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: deliveryColumns"></tr>
          </table>
        </div>
      </section>
    }
  `,
  styles: `
    /* Handles and e-mail addresses have no break points; let them wrap in a narrow cell. */
    .bf-admin-channels__account {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .bf-admin-channels__grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
      gap: 16px;
      margin-bottom: 16px;
    }
    .bf-admin-channels__toggles {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 12px;
    }
    .bf-admin-channels__channels {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 12px;
    }
    .bf-admin-channels__chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .bf-admin-channels__add-channel {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .bf-admin-channels__delivery {
      /* The figures widen with the data, so in a narrow card the line count flips between one and
         two and shifts everything below. Hold both lines whatever the figures are. */
      min-block-size: calc(2 * var(--mat-sys-body-small-line-height));
    }
    .bf-admin-channels__disconnect {
      margin-top: 12px;
      padding: 12px 16px;
      border: 1px solid var(--mat-sys-error);
      border-radius: var(--mat-sys-corner-medium);
      background: var(--mat-sys-surface-container-low);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminChannelsPage {
  private readonly api = injectApi();
  private readonly snack = inject(MatSnackBar);
  protected readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly initials = initials;
  protected readonly sentence = sentence;
  protected readonly channelLabel = channelLabel;
  protected deliveryStatusOf(d: ChannelDeliveryLogView): StatusView {
    return DELIVERY_STATUS[d.status];
  }

  protected readonly linkColumns = ['person', 'account', 'linkedAt', 'actions'];
  protected readonly deliveryColumns = ['channel', 'recipient', 'kind', 'status', 'createdAt'];
  protected readonly linkTab = signal<ChatProvider>('slack');
  protected readonly showUnlinkedOnly = signal(false);
  protected readonly showDisconnect = signal<ChatProvider | null>(null);
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected newSlackChannel = '';
  protected disconnectConfirm = '';

  protected readonly admin = resource({
    loader: () => data(this.api.getAdminChannels({})),
  });

  protected readonly filteredLinks = computed<ChatAccountLinkView[]>(() =>
    (valueOf(this.admin)?.links ?? []).filter((l) => l.provider === this.linkTab()),
  );

  protected statusLabel(status: string): string {
    if (status === 'connected') return 'Connected';
    if (status === 'waiting_for_consent') return 'Waiting for admin consent';
    if (status === 'needs_attention') return 'Needs attention';
    return 'Not connected';
  }

  private async run(call: () => Promise<unknown>, done: string): Promise<void> {
    this.busy.set(true);
    this.failure.set('');
    try {
      await call();
      this.snack.open(done, undefined, { duration: 3500 });
      this.admin.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected toggleFeature(provider: ChatProvider, key: keyof ChatFeatures, enabled: boolean): void {
    void this.run(
      () =>
        data(
          this.api.updateChatInstallation({
            params: { provider },
            body: { action: 'configure', features: { [key]: enabled } },
          }),
        ),
      'Channel settings saved',
    );
  }

  protected addChannel(provider: ChatProvider, current: string[]): void {
    const ch = this.newSlackChannel.trim();
    if (!ch) return;
    const formatted = ch.startsWith('#') ? ch : `#${ch}`;
    this.newSlackChannel = '';
    void this.run(
      () =>
        data(
          this.api.updateChatInstallation({
            params: { provider },
            body: { action: 'configure', allowedChannels: [...current, formatted] },
          }),
        ),
      `Added ${formatted}`,
    );
  }

  protected remindUnlinked(provider: ChatProvider): void {
    void this.run(
      () =>
        data(
          this.api.updateChatInstallation({
            params: { provider },
            body: { action: 'remind_unlinked' },
          }),
        ),
      'Sent Connect reminders to unlinked approvers',
    );
  }

  protected connectProvider(provider: ChatProvider): void {
    void this.run(
      () =>
        data(
          this.api.updateChatInstallation({
            params: { provider },
            body: { action: 'connect' },
          }),
        ),
      `Connected ${provider === 'slack' ? 'Slack' : 'Microsoft Teams'}`,
    );
  }

  protected checkConsent(provider: ChatProvider): void {
    void this.run(
      () =>
        data(
          this.api.updateChatInstallation({
            params: { provider },
            body: { action: 'check_status' },
          }),
        ),
      'Microsoft Entra admin consent verified; Teams connected',
    );
  }

  protected confirmDisconnect(provider: ChatProvider): void {
    void this.run(async () => {
      await data(
        this.api.updateChatInstallation({
          params: { provider },
          body: { action: 'disconnect', confirmText: this.disconnectConfirm },
        }),
      );
      this.showDisconnect.set(null);
      this.disconnectConfirm = '';
    }, 'Workspace disconnected; approvals fall back to email and in-app');
  }

  protected unlink(link: ChatAccountLinkView): void {
    void this.run(
      () => data(this.api.unlinkChatAccount({ params: { id: link.id } })),
      `Unlinked ${link.personName}`,
    );
  }
}
