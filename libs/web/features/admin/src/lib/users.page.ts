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
import { ROLE_IDS, type AdminUser, type RoleId } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { PendingChange, ReasonField } from './admin-ui';
import { data, errorMessage, injectApi, valueOf } from './api';
import { LoadState } from './load-state';
import { ROLE_LABELS } from './role-labels';

type UserRow = AdminUser & { detail: boolean };

/**
 * Screen 103: who is in the tenant, the roles they hold and the role changes that need a second
 * person. A role grant never carries an approval limit: the amount somebody may approve comes from
 * the delegation-of-authority matrix, not from this screen.
 */
@Component({
  selector: 'bf-users-page',
  imports: [
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    PendingChange,
    ReasonField,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  templateUrl: './users.page.html',
  styleUrls: ['./page.scss', './users.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UsersPage {
  protected readonly valueOf = valueOf;
  protected readonly roleLabel = ROLE_LABELS;
  protected readonly roles = ROLE_IDS;
  protected readonly columns = ['person', 'roles', 'review', 'status', 'actions'];
  protected readonly hasDetail = (_index: number, row: { detail: boolean }): boolean => row.detail;

  private readonly api = injectApi();
  private readonly session = inject(SessionStore);

  protected readonly search = signal('');
  protected readonly roleFilter = signal<'all' | RoleId>('all');
  protected readonly open = signal<string | null>(null);
  protected readonly grantRole = signal<RoleId>('budget-owner');
  protected readonly grantScope = signal<string>('');
  protected readonly grantReason = signal('');
  protected readonly revoking = signal<{ membershipId: string; role: RoleId } | null>(null);
  protected readonly revokeReason = signal('');
  protected readonly deciding = signal<{
    membershipId: string;
    changeId: string;
    decision: 'confirm' | 'decline' | 'cancel';
  } | null>(null);
  protected readonly decisionReason = signal('');
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  /** Actions a grant would add that the requester does not hold; the API sends them back. */
  protected readonly beyondRequester = signal<string[]>([]);

  protected readonly canManage = computed(() => this.session.can('users.manage'));

  /** The bulk owner invite capability is on only when the flag reveals it and the policy allows it. */
  protected readonly mine = resource({ loader: () => data(this.api.myFeatures({})) });
  protected readonly inviteCapability = computed(() =>
    (valueOf(this.mine)?.items ?? []).find((f) => f.key === 'experience.bulk_owner_invites'),
  );
  protected readonly canInviteOwners = computed(() => {
    const capability = this.inviteCapability();
    return capability !== undefined && capability.on && capability.allowed;
  });

  protected readonly list = resource({
    params: () => ({
      search: this.search().trim() || undefined,
      role: this.roleFilter() === 'all' ? undefined : (this.roleFilter() as RoleId),
    }),
    loader: ({ params }) => data(this.api.adminUsers({ query: params })),
  });

  protected readonly units = resource({
    params: () => (this.open() ? {} : undefined),
    loader: () => data(this.api.listOrgUnits({})),
  });

  protected readonly rows = computed<UserRow[]>(() => {
    const open = this.open();
    return (valueOf(this.list)?.items ?? []).map((u) => ({
      ...u,
      detail: u.pendingRoleChanges.length > 0 || open === u.membershipId,
    }));
  });

  protected readonly privilegedCount = computed(() => this.rows().filter((u) => u.privileged).length);

  protected roleNames(user: AdminUser): string {
    return user.roles.map((r) => ROLE_LABELS[r] ?? r).join(', ') || 'No role';
  }

  protected toggle(user: AdminUser): void {
    this.open.set(this.open() === user.membershipId ? null : user.membershipId);
    this.grantReason.set('');
    this.grantScope.set('');
    this.beyondRequester.set([]);
    this.failure.set(null);
    this.notice.set(null);
  }

  protected async grant(user: AdminUser): Promise<void> {
    await this.run(async () => {
      const result = await data(
        this.api.grantRole({
          params: { membershipId: user.membershipId },
          body: {
            role: this.grantRole(),
            scopeOrgUnitId: this.grantScope() || null,
            reason: this.grantReason(),
          },
        }),
      );
      this.beyondRequester.set([...result.authorityBeyondRequester]);
      this.grantReason.set('');
      this.notice.set(
        result.applied
          ? `${user.displayName} now holds ${ROLE_LABELS[result.role] ?? result.role}.`
          : `${user.displayName} does not hold ${ROLE_LABELS[result.role] ?? result.role}. The grant is waiting for somebody who already holds the authority it gives.`,
      );
    });
  }

  protected openRevoke(user: AdminUser, role: RoleId): void {
    this.revoking.set({ membershipId: user.membershipId, role });
    this.revokeReason.set('');
    this.failure.set(null);
    this.notice.set(null);
  }

  protected async revoke(user: AdminUser): Promise<void> {
    const open = this.revoking();
    if (!open || open.membershipId !== user.membershipId) return;
    await this.run(async () => {
      await data(
        this.api.revokeRole({
          params: { membershipId: user.membershipId },
          body: { role: open.role, reason: this.revokeReason() },
        }),
      );
      this.revoking.set(null);
      this.notice.set(
        `${ROLE_LABELS[open.role] ?? open.role} was taken away from ${user.displayName}.`,
      );
    });
  }

  protected openDecision(
    user: AdminUser,
    changeId: string,
    decision: 'confirm' | 'decline' | 'cancel',
  ): void {
    this.deciding.set({ membershipId: user.membershipId, changeId, decision });
    this.decisionReason.set('');
    this.failure.set(null);
    this.notice.set(null);
  }

  protected async decide(user: AdminUser): Promise<void> {
    const open = this.deciding();
    if (!open || open.membershipId !== user.membershipId) return;
    await this.run(async () => {
      const result = await data(
        this.api.decideRoleGrant({
          params: { changeId: open.changeId },
          body: { decision: open.decision, reason: this.decisionReason() },
        }),
      );
      this.deciding.set(null);
      this.notice.set(
        result.applied
          ? `${user.displayName} now holds ${ROLE_LABELS[result.role] ?? result.role}.`
          : `The grant was ${open.decision === 'decline' ? 'declined' : 'withdrawn'}. ${user.displayName}'s roles are unchanged.`,
      );
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    this.notice.set(null);
    try {
      await action();
      this.list.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
