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
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import { ROLE_IDS, type OwnerInvite, type RoleId } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, LoadState } from '@bf/web/ui';
import { SatAvatar } from '@hylandsoftware/satori-ui/avatar';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { ReasonField } from './admin-ui';
import { data, errorMessage, initialsOf, injectApi, valueOf } from './api';
import { ROLE_LABELS } from './role-labels';

interface Draft {
  email: string;
  displayName: string;
  proposedRole: RoleId;
  orgUnitId: string;
}

const STATUS_TONE: Record<string, 'success' | 'info' | 'neutral'> = {
  accepted: 'success',
  invited: 'info',
  expired: 'neutral',
  revoked: 'neutral',
} satisfies Record<OwnerInvite['status'], 'success' | 'info' | 'neutral'>;

const STATUS_LABEL: Record<string, string> = {
  accepted: 'Signed in',
  invited: 'Invited',
  expired: 'Expired',
  revoked: 'Withdrawn',
} satisfies Record<OwnerInvite['status'], string>;

/**
 * Screen 103a: invite several budget owners at once and track who has accepted.
 *
 * The capability sits behind the `experience.bulk_owner_invites` flag **and** behind user
 * administration. The page reads `GET /api/me/features` and only offers the form when the
 * capability is both shown to the person and allowed for them; when it is shown but not allowed the
 * page says so instead of offering a form the API would refuse.
 */
@Component({
  selector: 'bf-owner-invites-page',
  host: { class: 'bf-page-layout' },
  imports: [
    DateTimePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    ReasonField,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_TAG_IMPORTS,
    SatAvatar,
  ],
  templateUrl: './owner-invites.page.html',
  styleUrls: ['./page.scss', './users.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OwnerInvitesPage {
  protected readonly valueOf = valueOf;
  protected readonly initials = initialsOf;
  protected readonly roleLabel = ROLE_LABELS;
  protected readonly roles = ROLE_IDS;
  protected readonly statusTone = STATUS_TONE;
  protected readonly statusLabel = STATUS_LABEL;
  protected readonly columns = ['person', 'role', 'status', 'expires'];
  protected readonly draftColumns = ['email', 'name', 'role', 'remove'];

  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly timezone = this.session.timezone;

  protected readonly email = signal('');
  protected readonly displayName = signal('');
  protected readonly role = signal<RoleId>('budget-owner');
  protected readonly orgUnitId = signal('');
  protected readonly drafts = signal<Draft[]>([]);
  protected readonly reason = signal('');
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly skipped = signal<string[]>([]);

  protected readonly invites = resource({ loader: () => data(this.api.ownerInvites({})) });
  protected readonly mine = resource({ loader: () => data(this.api.myFeatures({})) });
  protected readonly units = resource({ loader: () => data(this.api.listOrgUnits({})) });

  protected readonly capability = computed(() =>
    (valueOf(this.mine)?.items ?? []).find((f) => f.key === 'experience.bulk_owner_invites'),
  );
  /** Both must be true. A flag being on is never permission; the API checks the action as well. */
  protected readonly canInvite = computed(() => {
    const capability = this.capability();
    return capability !== undefined && capability.on && capability.allowed;
  });
  protected readonly shownButNotAllowed = computed(() => {
    const capability = this.capability();
    return capability !== undefined && capability.on && !capability.allowed;
  });

  protected readonly accepted = computed(
    () => (valueOf(this.invites)?.items ?? []).filter((i) => i.status === 'accepted').length,
  );

  protected addDraft(): void {
    const email = this.email().trim();
    const name = this.displayName().trim();
    if (!email || !name) return;
    this.drafts.update((d) => [
      ...d,
      { email, displayName: name, proposedRole: this.role(), orgUnitId: this.orgUnitId() },
    ]);
    this.email.set('');
    this.displayName.set('');
  }

  protected removeDraft(index: number): void {
    this.drafts.update((d) => d.filter((_, i) => i !== index));
  }

  protected async send(): Promise<void> {
    const drafts = this.drafts();
    if (drafts.length === 0) return;
    this.busy.set(true);
    this.failure.set(null);
    this.notice.set(null);
    try {
      const result = await data(
        this.api.createOwnerInvites({
          body: {
            invites: drafts.map((d) => ({
              email: d.email,
              displayName: d.displayName,
              proposedRole: d.proposedRole,
              orgUnitId: d.orgUnitId || null,
            })),
            reason: this.reason(),
          },
        }),
      );
      this.drafts.set([]);
      this.reason.set('');
      this.skipped.set([...result.skippedExisting]);
      this.notice.set(
        `${result.created} invitation(s) sent. An invitation grants nothing on its own: each person still gets their roles through user administration.`,
      );
      this.invites.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
