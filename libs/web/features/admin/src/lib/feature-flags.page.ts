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
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { ROLE_IDS, type FeatureFlag, type RoleId } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { PendingChange, ReasonField } from './admin-ui';
import { data, errorMessage, injectApi, valueOf } from './api';
import { LoadState } from './load-state';
import { ROLE_LABELS } from './role-labels';

const AREA_LABEL: Record<FeatureFlag['area'], string> = {
  approvals: 'Approvals',
  cofunding: 'Co-funding',
  channels: 'Channels',
  integrations: 'Integrations',
  events: 'Events',
  experience: 'Experience',
};
const AREAS = Object.keys(AREA_LABEL) as FeatureFlag['area'][];

type FlagRow = FeatureFlag & { detail: boolean };

type Decision = 'confirm' | 'decline' | 'cancel';
interface OpenDecision {
  key: string;
  changeId: string;
  decision: Decision;
}

const DECISION_LABEL: Record<Decision, string> = {
  confirm: 'Confirm the change',
  decline: 'Decline the change',
  cancel: 'Withdraw your request',
};

/**
 * Screen 105: the capability switches, with the rollout each one has, the capabilities as the
 * signed-in person sees them, and the changes waiting for a second person.
 *
 * Two things this screen must never get wrong:
 * 1. A money-affecting change comes back `applied: false`. The row keeps showing the state that is
 *    in force and says the request is waiting, so nobody reads a request as a result.
 * 2. A flag being on is not permission. `GET /api/me/features` answers `on` and `allowed`
 *    separately and the capability panel says so in words, because the API refuses either way.
 */
@Component({
  selector: 'bf-feature-flags-page',
  imports: [
    DateTimePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatRadioModule,
    MatSelectModule,
    MatTableModule,
    PendingChange,
    ReasonField,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  templateUrl: './feature-flags.page.html',
  styleUrls: ['./page.scss', './feature-flags.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeatureFlagsPage {
  protected readonly valueOf = valueOf;
  protected readonly areaLabel = AREA_LABEL;
  protected readonly decisionLabel = DECISION_LABEL;
  protected readonly roleLabel = ROLE_LABELS;
  protected readonly roles = ROLE_IDS;
  protected readonly columns = ['capability', 'state', 'rollout', 'change', 'actions'];
  protected readonly capabilityColumns = ['name', 'on', 'allowed', 'available'];
  protected readonly historyColumns = ['what', 'status', 'who', 'confirmed'];
  /** The second row of a flag: its waiting change, the switch form or the decision form. */
  protected readonly hasDetail = (_index: number, row: { detail: boolean }): boolean => row.detail;
  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly timezone = this.session.timezone;

  /** Who may ask for a change, and who may confirm a money-affecting one. The API checks both again. */
  protected readonly canRequest = computed(
    () => this.session.can('tenant.settings.manage') || this.session.can('master_data.manage'),
  );
  protected readonly canConfirmFinance = computed(() => this.session.can('flags.confirm_finance'));

  protected readonly search = signal('');
  protected readonly area = signal<'all' | FeatureFlag['area']>('all');
  protected readonly areas = AREAS;
  protected readonly editing = signal<string | null>(null);
  protected readonly enabling = signal(true);
  protected readonly rolloutMode = signal<'everyone' | 'pilot'>('everyone');
  protected readonly pilotUnits = signal<string[]>([]);
  protected readonly pilotRoles = signal<RoleId[]>([]);
  protected readonly reason = signal('');
  protected readonly deciding = signal<OpenDecision | null>(null);
  protected readonly decisionReason = signal('');
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly showHistory = signal(false);

  protected readonly list = resource({ loader: () => data(this.api.featureFlags({})) });
  protected readonly mine = resource({ loader: () => data(this.api.myFeatures({})) });
  protected readonly units = resource({
    params: () => (this.editing() ? {} : undefined),
    loader: () => data(this.api.listOrgUnits({})),
  });
  protected readonly history = resource({
    params: () => (this.showHistory() ? {} : undefined),
    loader: () => data(this.api.featureFlagHistory({})),
  });

  protected readonly visible = computed(() => {
    const all = valueOf(this.list)?.items ?? [];
    const needle = this.search().trim().toLowerCase();
    const area = this.area();
    return all.filter(
      (f) =>
        (area === 'all' || f.area === area) &&
        (needle === '' ||
          f.name.toLowerCase().includes(needle) ||
          f.key.includes(needle) ||
          f.description.toLowerCase().includes(needle)),
    );
  });

  /**
   * Areas in the order the API sent them, each with the flags that passed the filter. `detail` marks
   * the rows that need their second row; it depends on the open forms so the table re-renders.
   */
  protected readonly groups = computed(() => {
    const editing = this.editing();
    const deciding = this.deciding();
    const byArea = new Map<FeatureFlag['area'], FlagRow[]>();
    for (const flag of this.visible()) {
      const group = byArea.get(flag.area) ?? [];
      group.push({
        ...flag,
        detail: flag.pendingChange !== null || editing === flag.key || deciding?.key === flag.key,
      });
      byArea.set(flag.area, group);
    }
    return [...byArea].map(([area, flags]) => ({ area, flags }));
  });

  /** A capability is usable only when it is shown to the person and the policy allows the action. */
  protected readonly capabilities = computed(() =>
    (valueOf(this.mine)?.items ?? []).map((f) => ({ ...f, available: f.on && f.allowed })),
  );

  protected readonly availableCount = computed(
    () => this.capabilities().filter((c) => c.available).length,
  );

  /** The row shows the state in force; a waiting change never changes it. */
  protected stateLabel(flag: FeatureFlag): string {
    if (!flag.enabled) return 'Off';
    return flag.rolloutMode === 'pilot' ? 'Pilot' : 'On';
  }

  protected stateTone(flag: FeatureFlag): 'success' | 'info' | 'neutral' {
    if (!flag.enabled) return 'neutral';
    return flag.rolloutMode === 'pilot' ? 'info' : 'success';
  }

  protected rolloutLabel(flag: FeatureFlag): string {
    if (!flag.enabled) return 'Nobody';
    if (flag.rolloutMode === 'everyone') return 'Everyone at Hyland';
    const places = flag.pilotOrgUnitNames.join(', ');
    const roles = flag.pilotRoleIds.map((r) => ROLE_LABELS[r] ?? r).join(', ');
    return [places, roles].filter(Boolean).join(' · ') || 'Pilot with nobody chosen';
  }

  protected openSwitch(flag: FeatureFlag, enabled: boolean): void {
    this.editing.set(flag.key);
    this.enabling.set(enabled);
    this.rolloutMode.set(enabled ? flag.rolloutMode : 'everyone');
    this.pilotUnits.set([...flag.pilotOrgUnitIds]);
    this.pilotRoles.set([...flag.pilotRoleIds]);
    this.reason.set('');
    this.failure.set(null);
    this.notice.set(null);
  }

  protected openPilot(flag: FeatureFlag): void {
    this.openSwitch(flag, true);
    this.rolloutMode.set('pilot');
  }

  protected closeSwitch(): void {
    this.editing.set(null);
  }

  protected async submit(flag: FeatureFlag): Promise<void> {
    await this.run(async () => {
      const result = await data(
        this.api.switchFeatureFlag({
          params: { key: flag.key },
          body: {
            enabled: this.enabling(),
            rolloutMode: this.enabling() ? this.rolloutMode() : 'everyone',
            pilotOrgUnitIds:
              this.enabling() && this.rolloutMode() === 'pilot' ? this.pilotUnits() : [],
            pilotRoleIds:
              this.enabling() && this.rolloutMode() === 'pilot' ? this.pilotRoles() : [],
            reason: this.reason(),
          },
        }),
      );
      this.editing.set(null);
      this.notice.set(
        result.applied
          ? `${flag.name} is now ${result.enabled ? (result.rolloutMode === 'pilot' ? 'running as a pilot' : 'on') : 'off'}.`
          : `${flag.name} is unchanged and stays ${flag.enabled ? 'on' : 'off'}. Your request is waiting for a Finance Controller to confirm it.`,
      );
    });
  }

  protected openDecision(flag: FeatureFlag, decision: Decision): void {
    const change = flag.pendingChange;
    if (!change) return;
    this.deciding.set({ key: flag.key, changeId: change.id, decision });
    this.decisionReason.set('');
    this.editing.set(null);
    this.failure.set(null);
    this.notice.set(null);
  }

  protected async decide(flag: FeatureFlag): Promise<void> {
    const open = this.deciding();
    if (!open || open.key !== flag.key) return;
    await this.run(async () => {
      const result = await data(
        this.api.decideFeatureFlagChange({
          params: { changeId: open.changeId },
          body: { decision: open.decision, reason: this.decisionReason() },
        }),
      );
      this.deciding.set(null);
      this.notice.set(
        open.decision === 'confirm'
          ? `${flag.name} is now ${result.enabled ? 'on' : 'off'}.`
          : `The change to ${flag.name} was ${open.decision === 'decline' ? 'declined' : 'withdrawn'}. ${flag.name} stays ${flag.enabled ? 'on' : 'off'}.`,
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
      this.mine.reload();
      if (this.showHistory()) this.history.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
