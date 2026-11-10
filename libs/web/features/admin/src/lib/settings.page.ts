import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import {
  NOTIFICATION_CHANNELS,
  type DocumentKindSettings,
  type NotificationChannel,
  type QuietHoursSettings,
} from '@bf/contracts';
import { LoadState } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { ReasonField } from './admin-ui';
import { data, errorMessage, injectApi, valueOf } from './api';

const CHANNEL_LABEL: Record<string, string> = {
  in_app: 'In-app',
  email: 'Email',
  push: 'Mobile push',
  slack: 'Slack',
  teams: 'Microsoft Teams',
} satisfies Record<NotificationChannel, string>;

const AUDIENCE_LABEL: Record<string, string> = {
  approvers: 'Approvers',
  requesters: 'Requesters',
  owners: 'Budget owners',
  organizers_employees: 'Organizers and employees',
  finance: 'Finance',
};

type Section = 'branding' | 'notifications' | 'documents' | 'security';

/**
 * Screens 102b, 109, 110 and 112 in one read: branding, notification defaults, document rules and
 * security.
 *
 * `GET /api/admin/settings` returns `allowedActions`, naming the sections this person may change.
 * The page drives every editing control from that list rather than guessing from role names, so it
 * never offers a form the API would refuse.
 */
const FILE_TYPE_LABEL: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/heic': 'HEIC',
  'image/webp': 'WebP',
  'text/csv': 'CSV',
  'application/vnd.ms-excel': 'Excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
  'application/msword': 'Word',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'text/plain': 'Text',
};

@Component({
  selector: 'bf-admin-settings-page',
  host: { class: 'bf-page-layout' },
  imports: [
    DecimalPipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    ReasonField,
    SAT_BANNER_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  templateUrl: './settings.page.html',
  styleUrls: ['./page.scss', './settings.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminSettingsPage {
  protected readonly valueOf = valueOf;
  protected readonly channels = NOTIFICATION_CHANNELS;
  protected readonly channelLabel = CHANNEL_LABEL;
  protected readonly audienceLabel = AUDIENCE_LABEL;
  protected readonly notificationColumns = ['type', 'audience', 'channels'];
  protected readonly documentColumns = ['kind', 'types', 'size', 'download'];

  private readonly api = injectApi();

  protected readonly settings = resource({ loader: () => data(this.api.adminSettings({})) });

  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly editing = signal<Section | null>(null);
  protected readonly reason = signal('');

  // Branding --------------------------------------------------------------------------------
  protected readonly programName = signal('');
  protected readonly tagline = signal('');
  protected readonly emailFooter = signal('');
  protected readonly accentColor = signal('');

  // Notifications ---------------------------------------------------------------------------
  protected readonly channelChoice = signal<Record<string, NotificationChannel[]>>({});
  protected readonly quietHours = signal<QuietHoursSettings | null>(null);

  // Documents -------------------------------------------------------------------------------
  protected readonly documentKinds = signal<DocumentKindSettings[]>([]);

  // Security --------------------------------------------------------------------------------
  protected readonly idleTimeout = signal('');
  protected readonly maxSessionHours = signal('');
  protected readonly serviceUsersOnly = signal(true);
  protected readonly biometricUnlock = signal(false);

  /** Sections the API says this person may change; everything else is read-only here. */
  protected readonly allowed = computed(
    () => new Set(valueOf(this.settings)?.allowedActions ?? []),
  );
  protected mayChange(section: Section): boolean {
    return this.allowed().has(section);
  }
  protected readonly readOnly = computed(() => this.allowed().size === 0);

  protected open(section: Section): void {
    const current = valueOf(this.settings);
    if (!current) return;
    this.editing.set(section);
    this.reason.set('');
    this.failure.set(null);
    this.notice.set(null);
    if (section === 'branding') {
      this.programName.set(current.branding.programName);
      this.tagline.set(current.branding.tagline);
      this.emailFooter.set(current.branding.emailFooter);
      this.accentColor.set(current.branding.accentColor);
    }
    if (section === 'notifications') {
      this.channelChoice.set(
        Object.fromEntries(current.notifications.defaults.map((d) => [d.type, [...d.channels]])),
      );
      this.quietHours.set({ ...current.notifications.quietHours });
    }
    if (section === 'documents') {
      this.documentKinds.set(current.documents.kinds.map((k) => ({ ...k })));
    }
    if (section === 'security') {
      this.idleTimeout.set(String(current.security.idleTimeoutMinutes));
      this.maxSessionHours.set(String(current.security.maxSessionHours));
      this.serviceUsersOnly.set(current.security.localAccountsForServiceUsersOnly);
      this.biometricUnlock.set(current.security.biometricUnlockAllowed);
    }
  }

  protected setChannels(type: string, channels: NotificationChannel[]): void {
    this.channelChoice.update((c) => ({ ...c, [type]: channels }));
  }

  protected setQuietHours<K extends keyof QuietHoursSettings>(
    key: K,
    value: QuietHoursSettings[K],
  ): void {
    this.quietHours.update((q) => (q ? { ...q, [key]: value } : q));
  }

  protected setDocumentKind(kind: string, patch: Partial<DocumentKindSettings>): void {
    this.documentKinds.update((kinds) =>
      kinds.map((k) => (k.kind === kind ? { ...k, ...patch } : k)),
    );
  }

  /** Content types in plain English (PDF, PNG, Excel), as people know the files. */
  protected fileTypes(types: readonly string[]): string {
    return [
      ...new Set(types.map((t) => FILE_TYPE_LABEL[t] ?? t.split('/').pop()?.toUpperCase() ?? t)),
    ].join(', ');
  }

  protected async saveBranding(): Promise<void> {
    await this.run(async () => {
      await data(
        this.api.updateBranding({
          body: {
            programName: this.programName(),
            tagline: this.tagline(),
            emailFooter: this.emailFooter(),
            accentColor: this.accentColor(),
            reason: this.reason(),
          },
        }),
      );
      this.notice.set('The program branding is saved.');
    });
  }

  protected async saveNotifications(): Promise<void> {
    const quiet = this.quietHours();
    await this.run(async () => {
      await data(
        this.api.updateNotificationDefaults({
          body: {
            defaults: Object.entries(this.channelChoice()).map(([type, channels]) => ({
              type,
              channels,
            })),
            quietHours: quiet ?? undefined,
            reason: this.reason(),
          },
        }),
      );
      this.notice.set('The company notification defaults are saved.');
    });
  }

  protected async saveDocuments(): Promise<void> {
    await this.run(async () => {
      await data(
        this.api.updateDocumentSettings({
          body: {
            kinds: this.documentKinds().map((k) => ({
              kind: k.kind,
              allowedContentTypes: k.allowedContentTypes,
              maxBytes: k.maxBytes,
              downloadAllowed: k.downloadAllowed,
              inlinePreview: k.inlinePreview,
            })),
            reason: this.reason(),
          },
        }),
      );
      this.notice.set('The upload rules are saved.');
    });
  }

  protected async saveSecurity(): Promise<void> {
    await this.run(async () => {
      await data(
        this.api.updateSecuritySettings({
          body: {
            idleTimeoutMinutes: Number(this.idleTimeout()),
            maxSessionHours: Number(this.maxSessionHours()),
            localAccountsForServiceUsersOnly: this.serviceUsersOnly(),
            biometricUnlockAllowed: this.biometricUnlock(),
            reason: this.reason(),
          },
        }),
      );
      this.notice.set('The session and sign-in settings are saved.');
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    this.notice.set(null);
    try {
      await action();
      this.editing.set(null);
      this.settings.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
