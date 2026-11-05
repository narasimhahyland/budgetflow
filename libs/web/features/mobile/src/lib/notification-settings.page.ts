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
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import type {
  NotificationChannel,
  NotificationMatrixRow,
  NotificationPreferenceType,
} from '@bf/contracts';
import { DateTimePipe, MobileTabBar } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

const AREA_TITLES: Record<NotificationMatrixRow['area'], string> = {
  approvals: 'Approvals',
  budgets: 'Budgets I own',
  events: 'Events',
  discussion: 'Discussion',
  finance: 'Finance tasks',
};

/**
 * Screen 059c: Notification channels and push settings (`/me/notifications`, `/m/settings/notifications`).
 * Channels card (In-app, Email, Push devices, Slack, Microsoft Teams), Notification matrix with
 * required rows locked, Digest card, Quiet hours card and Privacy card.
 */
@Component({
  selector: 'bf-notification-settings-page',
  imports: [
    DateTimePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTableModule,
    MatTooltipModule,
    MobileTabBar,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Notification channels and push settings</h1>
        <p class="bf-page__subtitle">
          Choose where BudgetFlow reaches you; required approval and control alerts stay on
        </p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button routerLink="/notifications">Back to notifications</a>
      </div>
    </header>

    @if (failure()) {
      <sat-banner variant="important" data-testid="settings-error">
        <sat-banner-message>{{ failure() }}</sat-banner-message>
      </sat-banner>
    }
    @if (pushState() === 'blocked') {
      <sat-banner variant="warning" data-testid="push-blocked-banner">
        <sat-banner-message>
          Your browser blocks notifications from BudgetFlow. Allow notifications in your browser
          site settings, then try again.
        </sat-banner-message>
      </sat-banner>
    }

    <bf-load-state
      [loading]="settings.isLoading() && !settings.hasValue()"
      [error]="settings.error()"
      what="your notification settings"
      (retry)="settings.reload()"
    />

    @if (valueOf(settings); as s) {
      <div class="bf-layout">
        <div class="bf-layout__main">
          <!-- Channels card -->
          <section class="bf-card" aria-labelledby="channels-title" data-testid="channels-card">
            <div class="bf-card__header">
              <h2 class="bf-card__title" id="channels-title">Channels</h2>
              <span class="bf-card__hint">Send a test notification to confirm delivery</span>
            </div>
            <ul class="bf-list">
              <li class="bf-list__item bf-settings__channel-row">
                <div>
                  <span class="bf-cell__primary">In-app</span>
                  <span class="bf-cell__secondary">Bell panel and notifications page</span>
                </div>
                <div class="bf-settings__channel-actions">
                  <sat-status-tag status="success">Always on</sat-status-tag>
                  <button
                    mat-stroked-button
                    type="button"
                    [disabled]="busy()"
                    (click)="sendTest('in_app')"
                    data-testid="test-in_app"
                  >
                    Send test
                  </button>
                </div>
              </li>

              <li class="bf-list__item bf-settings__channel-row">
                <div>
                  <span class="bf-cell__primary">Email</span>
                  <span class="bf-cell__secondary">{{ s.email }} (from identity provider)</span>
                </div>
                <div class="bf-settings__channel-actions">
                  <sat-status-tag status="success">On</sat-status-tag>
                  <button
                    mat-stroked-button
                    type="button"
                    [disabled]="busy()"
                    (click)="sendTest('email')"
                    data-testid="test-email"
                  >
                    Send a test notification
                  </button>
                </div>
              </li>

              <li class="bf-list__item bf-settings__channel-row">
                <div>
                  <span class="bf-cell__primary">Push on this device</span>
                  <span class="bf-cell__secondary">
                    {{
                      s.pushDevices.length
                        ? s.pushDevices.length + ' device(s) registered'
                        : 'Off on this browser'
                    }}
                  </span>
                  @for (d of s.pushDevices; track d.id) {
                    <div class="bf-settings__device" [attr.data-testid]="'push-device-' + d.id">
                      <span
                        >{{ d.deviceLabel }}, added
                        <span data-testid="relative-time">{{
                          d.createdAt | bfDateTime: s.timezone : 'd MMM yyyy'
                        }}</span></span
                      >
                      <button
                        mat-button
                        type="button"
                        [disabled]="busy()"
                        (click)="removeDevice(d.id)"
                        [attr.data-testid]="'remove-push-' + d.id"
                      >
                        Remove
                      </button>
                    </div>
                  }
                </div>
                <div class="bf-settings__channel-actions">
                  <sat-status-tag [status]="s.pushDevices.length ? 'success' : 'neutral'">
                    {{ s.pushDevices.length ? 'On' : 'Off' }}
                  </sat-status-tag>
                  <button
                    mat-stroked-button
                    type="button"
                    [disabled]="busy() || pushState() === 'blocked'"
                    (click)="turnOnPush()"
                    data-testid="turn-on-push"
                  >
                    Turn on
                  </button>
                  @if (s.pushDevices.length) {
                    <button
                      mat-stroked-button
                      type="button"
                      [disabled]="busy()"
                      (click)="sendTest('push')"
                      data-testid="test-push"
                    >
                      Send test
                    </button>
                  }
                </div>
              </li>

              <li class="bf-list__item bf-settings__channel-row">
                <div>
                  <span class="bf-cell__primary">Slack</span>
                  @if (!s.slackInstalled) {
                    <span class="bf-cell__secondary"
                      >Your company has not connected Slack yet</span
                    >
                  } @else if (s.slackLink; as link) {
                    <span class="bf-cell__secondary" data-testid="slack-linked-handle"
                      >Linked as {{ link.handle }} ({{ link.verifiedEmail }})</span
                    >
                  } @else {
                    <span class="bf-cell__secondary">Not linked</span>
                  }
                </div>
                <div class="bf-settings__channel-actions">
                  @if (s.slackLink; as link) {
                    <sat-status-tag status="success">Linked</sat-status-tag>
                    <button
                      mat-stroked-button
                      type="button"
                      [disabled]="busy()"
                      (click)="sendTest('slack')"
                      data-testid="test-slack"
                    >
                      Send test
                    </button>
                    <button
                      mat-button
                      type="button"
                      [disabled]="busy()"
                      (click)="unlinkChat(link.id)"
                      data-testid="unlink-slack"
                    >
                      Unlink
                    </button>
                  } @else if (s.slackInstalled) {
                    <sat-status-tag status="neutral">Not linked</sat-status-tag>
                    <button
                      mat-stroked-button
                      type="button"
                      [disabled]="busy()"
                      (click)="connectChat('slack')"
                      data-testid="connect-slack"
                    >
                      Connect Slack
                    </button>
                  }
                </div>
              </li>

              <li class="bf-list__item bf-settings__channel-row">
                <div>
                  <span class="bf-cell__primary">Microsoft Teams</span>
                  @if (!s.teamsInstalled) {
                    <span class="bf-cell__secondary"
                      >Waiting for company administrator consent</span
                    >
                  } @else if (s.teamsLink; as link) {
                    <span class="bf-cell__secondary">Linked as {{ link.handle }}</span>
                  } @else {
                    <span class="bf-cell__secondary">Not linked</span>
                  }
                </div>
                <div class="bf-settings__channel-actions">
                  @if (s.teamsLink; as link) {
                    <sat-status-tag status="success">Linked</sat-status-tag>
                    <button
                      mat-stroked-button
                      type="button"
                      [disabled]="busy()"
                      (click)="sendTest('teams')"
                      data-testid="test-teams"
                    >
                      Send test
                    </button>
                    <button
                      mat-button
                      type="button"
                      [disabled]="busy()"
                      (click)="unlinkChat(link.id)"
                      data-testid="unlink-teams"
                    >
                      Unlink
                    </button>
                  } @else if (s.teamsInstalled) {
                    <sat-status-tag status="neutral">Not linked</sat-status-tag>
                    <button
                      mat-stroked-button
                      type="button"
                      [disabled]="busy()"
                      (click)="connectChat('teams')"
                      data-testid="connect-teams"
                    >
                      Connect Teams
                    </button>
                  } @else {
                    <sat-status-tag status="neutral">Not linked</sat-status-tag>
                  }
                </div>
              </li>
            </ul>
          </section>

          <!-- Notification matrix -->
          <section class="bf-card" aria-labelledby="matrix-title" data-testid="notification-matrix">
            <div class="bf-card__header">
              <div>
                <h2 class="bf-card__title" id="matrix-title">Notification matrix</h2>
                <p class="bf-card__hint">
                  Required rows keep In-app and Email on so you never miss an approval or budget
                  control
                </p>
              </div>
            </div>
            <div class="bf-table-scroll">
              <table class="bf-split-table" aria-label="Notification preferences matrix">
                <thead>
                  <tr>
                    <th>Notification type</th>
                    <th>In-app</th>
                    <th>Email</th>
                    <th>Push</th>
                    <th>Slack</th>
                    <th>Teams</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of s.matrix; track row.type) {
                    <tr [attr.data-testid]="'matrix-row-' + row.type">
                      <td>
                        <span class="bf-cell__primary">
                          {{ areaTitle(row.area) }} · {{ row.label }}
                        </span>
                        @if (row.required) {
                          <span class="bf-cell__secondary">
                            <sat-status-tag status="neutral">Required</sat-status-tag>
                            Required: you need this to act on time
                          </span>
                        }
                      </td>
                      <td>
                        <mat-checkbox
                          [checked]="row.inApp"
                          [disabled]="row.required || busy()"
                          [matTooltip]="row.required ? 'Required: you need this to act on time' : ''"
                          [attr.aria-label]="'In-app for ' + row.label"
                          (change)="toggleMatrix(row.type, 'inApp', $event.checked)"
                        />
                      </td>
                      <td>
                        <mat-checkbox
                          [checked]="row.email"
                          [disabled]="row.required || busy()"
                          [matTooltip]="row.required ? 'Required: you need this to act on time' : ''"
                          [attr.aria-label]="'Email for ' + row.label"
                          (change)="toggleMatrix(row.type, 'email', $event.checked)"
                        />
                      </td>
                      <td>
                        <mat-checkbox
                          [checked]="row.push"
                          [disabled]="busy()"
                          [attr.aria-label]="'Push for ' + row.label"
                          (change)="toggleMatrix(row.type, 'push', $event.checked)"
                        />
                      </td>
                      <td>
                        <mat-checkbox
                          [checked]="row.slack"
                          [disabled]="!s.slackLink || busy()"
                          [attr.aria-label]="'Slack for ' + row.label"
                          (change)="toggleMatrix(row.type, 'slack', $event.checked)"
                        />
                      </td>
                      <td>
                        <mat-checkbox
                          [checked]="row.teams"
                          [disabled]="!s.teamsLink || busy()"
                          [attr.aria-label]="'Teams for ' + row.label"
                          (change)="toggleMatrix(row.type, 'teams', $event.checked)"
                        />
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <aside class="bf-layout__side">
          <!-- Digest card -->
          <section class="bf-card" aria-labelledby="digest-title" data-testid="digest-card">
            <div class="bf-card__header">
              <h2 class="bf-card__title" id="digest-title">Digest</h2>
            </div>
            <div class="bf-form">
              <p class="bf-cell__secondary">
                Template: <strong>{{ s.digest.templateName }}</strong>
              </p>
              <mat-form-field appearance="outline" class="bf-form__wide">
                <mat-label>Frequency</mat-label>
                <mat-select
                  [ngModel]="s.digest.frequency"
                  (ngModelChange)="saveDigest({ frequency: $event })"
                  name="digestFreq"
                  data-testid="digest-frequency"
                >
                  <mat-option value="daily">Daily at {{ s.digest.sendTime }}</mat-option>
                  <mat-option value="weekly">Weekly on Monday at {{ s.digest.sendTime }}</mat-option>
                  <mat-option value="off">Off</mat-option>
                </mat-select>
              </mat-form-field>

              <mat-form-field appearance="outline" class="bf-form__wide">
                <mat-label>Channel</mat-label>
                <mat-select
                  [ngModel]="s.digest.channel"
                  (ngModelChange)="saveDigest({ channel: $event })"
                  name="digestChan"
                  data-testid="digest-channel"
                >
                  <mat-option value="email">Email</mat-option>
                  <mat-option value="slack" [disabled]="!s.slackLink">Slack</mat-option>
                  <mat-option value="teams" [disabled]="!s.teamsLink">Microsoft Teams</mat-option>
                </mat-select>
              </mat-form-field>

              <mat-slide-toggle
                [checked]="s.digest.bundleNonUrgent"
                (change)="saveDigest({ bundleNonUrgent: $event.checked })"
                data-testid="bundle-non-urgent"
              >
                Send non-urgent notifications in my digest instead of one by one
              </mat-slide-toggle>

              @if (s.digest.templateId) {
                <a
                  mat-button
                  [routerLink]="['/admin/digests', s.digest.templateId]"
                  data-testid="preview-next-digest"
                  >Preview my next digest</a
                >
              }
            </div>
          </section>

          <!-- Quiet hours card -->
          <section class="bf-card" aria-labelledby="quiet-title" data-testid="quiet-hours-card">
            <div class="bf-card__header">
              <h2 class="bf-card__title" id="quiet-title">Quiet hours ({{ s.timezone }})</h2>
            </div>
            <div class="bf-form">
              <p class="bf-cell__secondary">
                Company default: {{ s.quietHours.companyDefaultStart }} to
                {{ s.quietHours.companyDefaultEnd }} local (can be extended, not shortened). Push,
                Slack and Teams wait until quiet hours end. Email still arrives.
              </p>
              <mat-form-field appearance="outline">
                <mat-label>Start</mat-label>
                <input
                  matInput
                  [ngModel]="s.quietHours.start"
                  (change)="saveQuietHours({ start: $any($event.target).value })"
                  name="quietStart"
                  data-testid="quiet-start"
                />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>End</mat-label>
                <input
                  matInput
                  [ngModel]="s.quietHours.end"
                  (change)="saveQuietHours({ end: $any($event.target).value })"
                  name="quietEnd"
                  data-testid="quiet-end"
                />
              </mat-form-field>
              <mat-slide-toggle
                [checked]="s.quietHours.weekendQuiet"
                (change)="saveQuietHours({ weekendQuiet: $event.checked })"
                data-testid="weekend-quiet"
              >
                Quiet all weekend
              </mat-slide-toggle>
            </div>
          </section>

          <!-- Privacy card -->
          <section class="bf-card" aria-labelledby="privacy-title" data-testid="privacy-card">
            <div class="bf-card__header">
              <h2 class="bf-card__title" id="privacy-title">Privacy</h2>
            </div>
            <div class="bf-form">
              <mat-slide-toggle
                [checked]="s.privacy.showAmountsInPush"
                (change)="savePrivacy($event.checked)"
                data-testid="show-amounts-push"
              >
                Show amounts in push notifications
              </mat-slide-toggle>
              <p class="bf-cell__secondary">
                Off by default so lock screens show the request and person, not the dollar amount.
              </p>
            </div>
          </section>
        </aside>
      </div>
    }

    @if (isMobileRoute()) {
      <bf-mobile-tab-bar />
    }
  `,
  styles: `
    .bf-settings__channel-row {
      /* .bf-list__item is content-box with 20px side padding, so 100% width would overrun the card. */
      box-sizing: border-box;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .bf-settings__channel-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .bf-settings__device {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 4px;
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationSettingsPage {
  private readonly api = injectApi();
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  protected readonly valueOf = valueOf;
  protected readonly isMobileRoute = computed(() => this.router.url.startsWith('/m/'));

  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly pushState = signal<'default' | 'blocked'>('default');

  protected readonly settings = resource({
    loader: () => data(this.api.getNotificationSettings({})),
  });

  protected areaTitle(area: NotificationMatrixRow['area']): string {
    return AREA_TITLES[area];
  }

  private async run(call: () => Promise<unknown>, message = 'Saved'): Promise<void> {
    this.busy.set(true);
    this.failure.set('');
    try {
      await call();
      // An empty message means the call already showed its own confirmation.
      if (message) this.snack.open(message, undefined, { duration: 3000 });
      this.settings.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
      this.settings.reload();
    } finally {
      this.busy.set(false);
    }
  }

  protected toggleMatrix(
    type: NotificationPreferenceType,
    channel: 'inApp' | 'email' | 'push' | 'slack' | 'teams',
    checked: boolean,
  ): void {
    void this.run(() =>
      data(
        this.api.updateNotificationSettings({
          body: {
            matrixRow: { type, [channel]: checked },
          },
        }),
      ),
    );
  }

  protected saveDigest(patch: {
    frequency?: 'daily' | 'weekly' | 'off';
    channel?: 'email' | 'slack' | 'teams';
    bundleNonUrgent?: boolean;
  }): void {
    void this.run(() =>
      data(this.api.updateNotificationSettings({ body: { digest: patch } })),
    );
  }

  protected saveQuietHours(patch: {
    start?: string;
    end?: string;
    weekendQuiet?: boolean;
  }): void {
    void this.run(() =>
      data(this.api.updateNotificationSettings({ body: { quietHours: patch } })),
    );
  }

  protected savePrivacy(showAmountsInPush: boolean): void {
    void this.run(() =>
      data(
        this.api.updateNotificationSettings({
          body: { privacy: { showAmountsInPush } },
        }),
      ),
    );
  }

  protected turnOnPush(): void {
    if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
      this.pushState.set('blocked');
      return;
    }
    void this.run(
      () =>
        data(
          this.api.registerPushDevice({
            body: {
              deviceLabel: 'Chrome on this device',
              userAgentFamily: 'Desktop, Chrome',
              endpoint: `https://push.budgetflow.example.test/sub/${Date.now()}`,
              p256dh: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFg',
              authKey: 'UUQM145_auth_browser_key',
            },
          }),
        ),
      'Push notifications turned on for this device',
    );
  }

  protected removeDevice(id: string): void {
    void this.run(
      () => data(this.api.removePushDevice({ params: { id } })),
      'Device removed',
    );
  }

  protected sendTest(channel: NotificationChannel): void {
    void this.run(async () => {
      const res = await data(
        this.api.sendTestNotification({ body: { channel } }),
      );
      this.snack.open(res.message, undefined, { duration: 3500 });
    }, '');
  }

  protected async connectChat(provider: 'slack' | 'teams'): Promise<void> {
    this.busy.set(true);
    this.failure.set('');
    try {
      const intent = await data(
        this.api.createChatLinkIntent({ body: { provider } }),
      );
      await this.router.navigate(['/link/chat'], {
        queryParams: { token: intent.token },
      });
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected unlinkChat(id: string): void {
    void this.run(
      () => data(this.api.unlinkChatAccount({ params: { id } })),
      'Chat account unlinked',
    );
  }
}
