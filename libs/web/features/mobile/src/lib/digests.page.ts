import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
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
import { Router, RouterLink } from '@angular/router';
import type { DigestSectionConfig, DigestTemplateView } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SAT_NAVIGATION_TABS_IMPORTS } from '@hylandsoftware/satori-ui/navigation-tabs';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

const ROLES: { id: string; label: string }[] = [
  { id: 'ceo', label: 'CEO' },
  { id: 'finance-admin', label: 'Finance admin' },
  { id: 'finance-controller', label: 'Finance controller' },
  { id: 'budget-owner', label: 'Budget owner' },
  { id: 'department-head', label: 'Department head' },
  { id: 'regional-manager', label: 'Regional manager' },
  { id: 'location-manager', label: 'Location manager' },
  { id: 'event-organizer', label: 'Event organizer' },
];

/**
 * Screen 064a: Role-based digest templates (`/admin/digests`, `/admin/digests/:templateId`).
 * Template list and split editor with live scoped preview (Email, Slack Block Kit, Teams Adaptive Card)
 * and Send test to me.
 */
@Component({
  selector: 'bf-digests-page',
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
    RouterLink,
    SAT_BANNER_IMPORTS,
    SatImportantButton,
    SAT_NAVIGATION_TABS_IMPORTS,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Role-based digest templates</h1>
        <p class="bf-page__subtitle">
          Scheduled summaries rendered per recipient within their own scope
        </p>
      </div>
      @if (selected()) {
        <div class="bf-page__actions">
          <button
            mat-stroked-button
            type="button"
            (click)="closeEditor()"
            data-testid="back-to-digest-list"
          >
            All digest templates
          </button>
        </div>
      }
    </header>

    @if (failure()) {
      <sat-banner variant="important" data-testid="digests-error">
        <sat-banner-message>{{ failure() }}</sat-banner-message>
      </sat-banner>
    }

    <bf-load-state
      [loading]="list.isLoading() && !list.hasValue()"
      [error]="list.error()"
      what="digest templates"
      (retry)="list.reload()"
    />

    @if (valueOf(list); as l) {
      @if (!l.canManage) {
        <sat-banner variant="info">
          <sat-banner-message>
            You have read-only access to digest templates. Only Finance Admins and Organization
            Admins can publish changes.
          </sat-banner-message>
        </sat-banner>
      }

      @if (!selected()) {
        <section class="bf-card" aria-label="Digest templates" data-testid="digest-templates-table">
          <div class="bf-table-scroll">
            <table mat-table [dataSource]="l.items" aria-label="Digest templates">
              <ng-container matColumnDef="name">
                <th mat-header-cell *matHeaderCellDef>Template</th>
                <td mat-cell *matCellDef="let t">
                  <button
                    type="button"
                    class="bf-digests__link-btn"
                    (click)="openTemplate(t)"
                    [attr.data-testid]="'open-digest-' + t.code"
                  >
                    <strong>{{ t.name }}</strong>
                  </button>
                  <span class="bf-cell__secondary">v{{ t.version }} · {{ t.introLine }}</span>
                </td>
              </ng-container>
              <ng-container matColumnDef="audience">
                <th mat-header-cell *matHeaderCellDef>Audience</th>
                <td mat-cell *matCellDef="let t">
                  {{ t.audienceRoles.join(', ') }}
                </td>
              </ng-container>
              <ng-container matColumnDef="schedule">
                <th mat-header-cell *matHeaderCellDef>When (recipient local)</th>
                <td mat-cell *matCellDef="let t">
                  {{ t.frequency === 'daily_weekdays' ? 'Weekdays' : 'Monday' }} {{ t.sendTime }}
                </td>
              </ng-container>
              <ng-container matColumnDef="channels">
                <th mat-header-cell *matHeaderCellDef>Channels allowed</th>
                <td mat-cell *matCellDef="let t">
                  {{ t.channelsAllowed.join(', ') }}
                </td>
              </ng-container>
              <ng-container matColumnDef="recipients">
                <th mat-header-cell *matHeaderCellDef class="bf-num">Recipients</th>
                <td mat-cell *matCellDef="let t" class="bf-num">{{ t.recipientCount }}</td>
              </ng-container>
              <ng-container matColumnDef="lastSent">
                <th mat-header-cell *matHeaderCellDef>Last sent</th>
                <td mat-cell *matCellDef="let t">
                  @if (t.lastSentAt) {
                    <span data-testid="relative-time">{{
                      t.lastSentAt | bfDateTime: session.timezone()
                    }}</span>
                  } @else {
                    —
                  }
                </td>
              </ng-container>
              <ng-container matColumnDef="status">
                <th mat-header-cell *matHeaderCellDef>Status</th>
                <td mat-cell *matCellDef="let t">
                  <sat-status-tag
                    [status]="
                      t.status === 'published'
                        ? 'success'
                        : t.status === 'draft_changes'
                          ? 'warning'
                          : 'neutral'
                    "
                  >
                    {{
                      t.status === 'published'
                        ? 'Published'
                        : t.status === 'draft_changes'
                          ? 'Draft changes'
                          : 'Off'
                    }}
                  </sat-status-tag>
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="columns"></tr>
              <tr mat-row *matRowDef="let row; columns: columns"></tr>
            </table>
          </div>
        </section>
      } @else {
        @let t = selected()!;
        <div class="bf-split" data-testid="digest-editor">
          <!-- Left: Editor -->
          <section class="bf-card" aria-labelledby="editor-title">
            <div class="bf-card__header">
              <div>
                <h2 class="bf-card__title" id="editor-title">{{ t.name }} · v{{ t.version }}</h2>
                <p class="bf-card__hint">Changes apply from the next scheduled send</p>
              </div>
              <sat-status-tag [status]="t.status === 'published' ? 'success' : 'neutral'">
                {{ t.status }}
              </sat-status-tag>
            </div>

            <div class="bf-form">
              <mat-form-field appearance="outline" class="bf-form__wide">
                <mat-label>Template name</mat-label>
                <input
                  matInput
                  [(ngModel)]="editName"
                  [disabled]="!l.canManage"
                  name="editName"
                  data-testid="digest-name-input"
                />
              </mat-form-field>

              <mat-form-field appearance="outline">
                <mat-label>Frequency</mat-label>
                <mat-select
                  [(ngModel)]="editFrequency"
                  [disabled]="!l.canManage"
                  name="editFrequency"
                >
                  <mat-option value="daily_weekdays">Daily weekdays</mat-option>
                  <mat-option value="weekly">Weekly (Monday)</mat-option>
                </mat-select>
              </mat-form-field>

              <mat-form-field appearance="outline">
                <mat-label>Send time (recipient local)</mat-label>
                <input
                  matInput
                  [(ngModel)]="editSendTime"
                  [disabled]="!l.canManage"
                  name="editSendTime"
                />
              </mat-form-field>

              <mat-form-field appearance="outline" class="bf-form__wide">
                <mat-label>Intro line</mat-label>
                <textarea
                  matInput
                  rows="2"
                  [(ngModel)]="editIntro"
                  [disabled]="!l.canManage"
                  name="editIntro"
                  data-testid="digest-intro-input"
                ></textarea>
              </mat-form-field>
            </div>

            <div class="bf-section">
              <h3 class="bf-section__title">Channels allowed</h3>
              <div class="bf-digests__channels">
                @for (ch of ['email', 'slack', 'teams']; track ch) {
                  <mat-checkbox
                    [checked]="editChannels().includes($any(ch))"
                    [disabled]="!l.canManage"
                    (change)="toggleChannel($any(ch), $event.checked)"
                    [attr.data-testid]="'digest-channel-' + ch"
                  >
                    {{ ch === 'teams' ? 'Microsoft Teams' : ch === 'slack' ? 'Slack' : 'Email' }}
                  </mat-checkbox>
                }
              </div>
              @if (editChannels().length === 0) {
                <p class="bf-digests__validation" data-testid="validation-channels">
                  Choose at least one channel
                </p>
              }
            </div>

            <div class="bf-section">
              <h3 class="bf-section__title">Sections</h3>
              <ul class="bf-list" data-testid="digest-sections-list">
                @for (sec of editSections(); track sec.key; let idx = $index) {
                  <li class="bf-list__item bf-list__row">
                    <mat-checkbox
                      [checked]="sec.enabled"
                      [disabled]="!l.canManage"
                      (change)="toggleSection(idx, $event.checked)"
                      [attr.data-testid]="'section-toggle-' + sec.key"
                    >
                      {{ sec.label }}
                    </mat-checkbox>
                    <span class="bf-cell__secondary">Show up to {{ sec.maxItems }} items</span>
                  </li>
                }
              </ul>
              @if (!hasEnabledSection()) {
                <p class="bf-digests__validation" data-testid="validation-sections">
                  Choose at least one section
                </p>
              }
            </div>

            <div class="bf-section">
              <mat-slide-toggle
                [(ngModel)]="editSkipEmpty"
                [disabled]="!l.canManage"
                name="editSkipEmpty"
              >
                Skip sending when there is nothing to report
              </mat-slide-toggle>
            </div>

            @if (l.canManage) {
              <div class="bf-form__actions">
                <button mat-button type="button" (click)="closeEditor()">Discard</button>
                <button
                  mat-flat-button
                  satImportantButton
                  type="button"
                  [disabled]="busy() || !valid()"
                  (click)="publish()"
                  data-testid="publish-digest"
                >
                  Publish
                </button>
              </div>
            }
          </section>

          <!-- Right: Live preview -->
          <section class="bf-card" aria-labelledby="preview-title" data-testid="digest-preview-card">
            <div class="bf-card__header">
              <div>
                <h2 class="bf-card__title" id="preview-title">Live preview</h2>
                @if (valueOf(preview); as p) {
                  <p class="bf-card__hint">
                    Rendered for {{ p.recipientName }} ({{ p.recipientTimezone }})
                  </p>
                }
              </div>
              <button
                mat-stroked-button
                type="button"
                [disabled]="busy()"
                (click)="sendTest()"
                data-testid="send-digest-test"
              >
                Send test to me
              </button>
            </div>

            <sat-navigation-tabs class="bf-tabs" aria-label="Preview channel">
              <a
                satNavigationTab
                [active]="previewTab() === 'email'"
                (click)="previewTab.set('email')"
                (keydown.enter)="previewTab.set('email')"
                tabindex="0"
                data-testid="preview-tab-email"
                >Email</a
              >
              <a
                satNavigationTab
                [active]="previewTab() === 'slack'"
                (click)="previewTab.set('slack')"
                (keydown.enter)="previewTab.set('slack')"
                tabindex="0"
                data-testid="preview-tab-slack"
                >Slack</a
              >
              <a
                satNavigationTab
                [active]="previewTab() === 'teams'"
                (click)="previewTab.set('teams')"
                (keydown.enter)="previewTab.set('teams')"
                tabindex="0"
                data-testid="preview-tab-teams"
                >Teams</a
              >
            </sat-navigation-tabs>

            <bf-load-state
              [loading]="preview.isLoading() && !preview.hasValue()"
              [error]="preview.error()"
              what="the digest preview"
              (retry)="preview.reload()"
            />

            @if (valueOf(preview); as p) {
              @if (p.nothingToReport) {
                <sat-banner variant="info" data-testid="nothing-to-report-banner">
                  <sat-banner-message>
                    This person would not get a digest this week (nothing to report).
                  </sat-banner-message>
                </sat-banner>
              }

              @switch (previewTab()) {
                @case ('email') {
                  <div class="bf-digests__preview-box" data-testid="preview-email-content">
                    <div class="bf-digests__email-header">
                      <strong>BudgetFlow · Hyland</strong>
                      <span>{{ p.subject }}</span>
                    </div>
                    <p>{{ editIntro }}</p>
                    @for (sec of p.sections; track sec.key) {
                      <div class="bf-digests__preview-sec">
                        <h4>{{ sec.title }}</h4>
                        <ul>
                          @for (line of sec.lines; track $index) {
                            <li>{{ line }}</li>
                          } @empty {
                            <li class="bf-cell__secondary">None this period</li>
                          }
                        </ul>
                      </div>
                    }
                  </div>
                }
                @case ('slack') {
                  <div class="bf-digests__preview-box" data-testid="preview-slack-content">
                    <p class="bf-cell__secondary">Slack Block Kit direct message</p>
                    <h4>{{ p.subject }}</h4>
                    <p>{{ editIntro }}</p>
                    @for (sec of p.sections; track sec.key) {
                      <div class="bf-digests__preview-sec">
                        <strong>{{ sec.title }}</strong>
                        <ul>
                          @for (line of sec.lines; track $index) {
                            <li>{{ line }}</li>
                          } @empty {
                            <li class="bf-cell__secondary">None</li>
                          }
                        </ul>
                      </div>
                    }
                  </div>
                }
                @case ('teams') {
                  <div class="bf-digests__preview-box" data-testid="preview-teams-content">
                    <p class="bf-cell__secondary">Microsoft Teams Adaptive Card 1.5</p>
                    <h4>{{ p.subject }}</h4>
                    <p>{{ editIntro }}</p>
                    @for (sec of p.sections; track sec.key) {
                      <div class="bf-digests__preview-sec">
                        <strong>{{ sec.title }}</strong>
                        <ul>
                          @for (line of sec.lines; track $index) {
                            <li>{{ line }}</li>
                          } @empty {
                            <li class="bf-cell__secondary">None</li>
                          }
                        </ul>
                      </div>
                    }
                  </div>
                }
              }
            }
          </section>
        </div>
      }
    }
  `,
  styles: `
    .bf-digests__link-btn {
      border: none;
      background: transparent;
      padding: 0;
      cursor: pointer;
      color: var(--mat-sys-primary);
      text-align: start;
      font: var(--mat-sys-body-medium);
    }
    .bf-digests__channels {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
    }
    .bf-digests__validation {
      margin: 6px 0 0;
      color: var(--mat-sys-error);
      font: var(--mat-sys-body-small);
    }
    .bf-digests__preview-box {
      padding: 16px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-medium);
      background: var(--mat-sys-surface-container-low);
    }
    .bf-digests__email-header {
      display: flex;
      justify-content: space-between;
      padding: 10px 14px;
      margin-bottom: 12px;
      border-radius: var(--mat-sys-corner-small);
      background: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
    }
    .bf-digests__preview-sec {
      margin-top: 12px;
    }
    .bf-digests__preview-sec h4 {
      margin: 0 0 4px;
      font: var(--mat-sys-title-small);
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DigestsPage {
  private readonly api = injectApi();
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  protected readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;

  readonly templateId = input<string | undefined>(undefined);
  protected readonly columns = [
    'name',
    'audience',
    'schedule',
    'channels',
    'recipients',
    'lastSent',
    'status',
  ];
  protected readonly roles = ROLES;

  protected readonly pickedId = signal<string | null>(null);
  protected readonly previewTab = signal<'email' | 'slack' | 'teams'>('email');
  protected readonly busy = signal(false);
  protected readonly failure = signal('');

  protected editName = '';
  protected editFrequency: 'daily_weekdays' | 'weekly' = 'weekly';
  protected editSendTime = '08:30';
  protected editIntro = '';
  protected editSkipEmpty = true;
  protected readonly editChannels = signal<('email' | 'slack' | 'teams')[]>(['email']);
  protected readonly editSections = signal<DigestSectionConfig[]>([]);

  protected readonly list = resource({
    loader: async () => {
      const r = await data(this.api.listDigestTemplates({}));
      const routeId = this.templateId();
      if (routeId) {
        const found = r.items.find((x) => x.id === routeId);
        if (found) this.loadIntoForm(found);
      }
      return r;
    },
  });

  protected readonly selected = computed<DigestTemplateView | null>(() => {
    const id = this.pickedId() ?? this.templateId() ?? null;
    if (!id) return null;
    return (valueOf(this.list)?.items ?? []).find((x) => x.id === id) ?? null;
  });

  protected readonly preview = resource({
    params: () => {
      const s = this.selected();
      return s ? { templateId: s.id } : undefined;
    },
    loader: ({ params }) =>
      data(this.api.previewDigestTemplate({ params: { templateId: params.templateId }, query: {} })),
  });

  protected readonly hasEnabledSection = computed(() =>
    this.editSections().some((s) => s.enabled),
  );
  protected readonly valid = computed(
    () =>
      this.editName.trim().length >= 3 &&
      this.editChannels().length > 0 &&
      this.hasEnabledSection(),
  );

  private loadIntoForm(t: DigestTemplateView): void {
    this.pickedId.set(t.id);
    this.editName = t.name;
    this.editFrequency = t.frequency;
    this.editSendTime = t.sendTime;
    this.editIntro = t.introLine;
    this.editSkipEmpty = t.skipWhenEmpty;
    this.editChannels.set([...t.channelsAllowed]);
    this.editSections.set(t.sections.map((s) => ({ ...s })));
  }

  protected openTemplate(t: DigestTemplateView): void {
    this.loadIntoForm(t);
    void this.router.navigate(['/admin/digests', t.id]);
  }

  protected closeEditor(): void {
    this.pickedId.set(null);
    void this.router.navigate(['/admin/digests']);
  }

  protected toggleChannel(ch: 'email' | 'slack' | 'teams', checked: boolean): void {
    const cur = new Set(this.editChannels());
    if (checked) cur.add(ch);
    else cur.delete(ch);
    this.editChannels.set([...cur]);
  }

  protected toggleSection(idx: number, enabled: boolean): void {
    const copy = this.editSections().map((s, i) => (i === idx ? { ...s, enabled } : s));
    this.editSections.set(copy);
  }

  protected async publish(): Promise<void> {
    const s = this.selected();
    if (!s || !this.valid()) return;
    this.busy.set(true);
    this.failure.set('');
    try {
      await data(
        this.api.updateDigestTemplate({
          params: { templateId: s.id },
          body: {
            name: this.editName.trim(),
            frequency: this.editFrequency,
            sendTime: this.editSendTime,
            introLine: this.editIntro.trim(),
            channelsAllowed: this.editChannels(),
            sections: this.editSections(),
            skipWhenEmpty: this.editSkipEmpty,
            publish: true,
          },
        }),
      );
      this.snack.open(
        `Published ${this.editName.trim()}; applies from the next scheduled send`,
        undefined,
        { duration: 4000 },
      );
      this.list.reload();
      this.preview.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async sendTest(): Promise<void> {
    const s = this.selected();
    if (!s) return;
    this.busy.set(true);
    try {
      const res = await data(
        this.api.sendDigestTest({
          params: { templateId: s.id },
          body: { channel: this.previewTab() },
        }),
      );
      this.snack.open(res.message, undefined, { duration: 3500 });
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
