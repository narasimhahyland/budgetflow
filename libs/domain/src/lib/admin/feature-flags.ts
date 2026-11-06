/**
 * Feature flags (screen 105). A flag hides or reveals a capability; it never grants authority.
 * `PolicyService.can` decides every action regardless of flag state, so the catalog records the
 * action a capability needs (`gatedAction`) only so the API can check both.
 */
import type { Action, RoleId } from '../authorization/policy';

export type FlagArea =
  | 'approvals'
  | 'cofunding'
  | 'channels'
  | 'integrations'
  | 'events'
  | 'experience';

export interface FlagDefinition {
  key: string;
  area: FlagArea;
  name: string;
  description: string;
  /** Changes how money or approvals work: a second person (`flags.confirm_finance`) must confirm. */
  moneyAffecting: boolean;
  defaultEnabled: boolean;
  /**
   * The action the capability behind this flag needs. The API asserts it in addition to the flag, so
   * turning a flag on never gives anyone an action the policy refuses.
   */
  gatedAction: Action | null;
  /** Plain-English dependency shown when the capability needs something else first. */
  dependsOn: string | null;
}

export const FLAG_CATALOG: readonly FlagDefinition[] = [
  {
    key: 'approvals.auto_approve_within_policy',
    area: 'approvals',
    name: 'Auto-approve within policy',
    description:
      'Requests that every rule marks as auto-approvable are approved without a person. Off by default.',
    moneyAffecting: true,
    defaultEnabled: false,
    gatedAction: 'request.approve',
    dependsOn: null,
  },
  {
    key: 'approvals.counter_offers',
    area: 'approvals',
    name: 'Counter-offers from approvers',
    description: 'An approver may offer a different amount instead of rejecting a request.',
    moneyAffecting: false,
    defaultEnabled: true,
    gatedAction: 'request.approve',
    dependsOn: null,
  },
  {
    key: 'cofunding.transfer_mode',
    area: 'cofunding',
    name: 'Transfer mode for co-funding requests',
    description:
      'A giving director may transfer money to the event budget instead of earmarking it. Earmark stays the default mode.',
    moneyAffecting: false,
    defaultEnabled: true,
    gatedAction: 'contribution.decide',
    dependsOn: null,
  },
  {
    key: 'channels.slack_app',
    area: 'channels',
    name: 'Slack app',
    description: 'People see and answer approvals in Slack.',
    moneyAffecting: false,
    defaultEnabled: true,
    gatedAction: null,
    dependsOn: 'Connect the Slack app first (061e).',
  },
  {
    key: 'channels.teams_app',
    area: 'channels',
    name: 'Microsoft Teams app',
    description: 'People see and answer approvals in Microsoft Teams.',
    moneyAffecting: false,
    defaultEnabled: false,
    gatedAction: null,
    dependsOn: 'Connect the Microsoft Teams app first (061e).',
  },
  {
    key: 'channels.mobile_push',
    area: 'channels',
    name: 'Push notifications in the mobile app',
    description: 'Approvals and reminders reach the mobile app as push notifications.',
    moneyAffecting: false,
    defaultEnabled: true,
    gatedAction: null,
    dependsOn: null,
  },
  {
    key: 'integrations.card_limit_push',
    area: 'integrations',
    name: 'Push approved commitments to card limits',
    description:
      'An approved commitment raises the card limit of the card provider. Off by default.',
    moneyAffecting: true,
    defaultEnabled: false,
    gatedAction: 'integration.manage',
    dependsOn: 'Connect a card provider first (096).',
  },
  {
    key: 'events.waitlist_auto_promotion',
    area: 'events',
    name: 'Waitlist auto-promotion',
    description: 'A free place goes to the first person on the waitlist automatically.',
    moneyAffecting: false,
    defaultEnabled: true,
    gatedAction: 'event.manage',
    dependsOn: null,
  },
  {
    key: 'events.post_event_surveys',
    area: 'events',
    name: 'Post-event surveys',
    description: 'Attendees are asked for feedback after an event closes.',
    moneyAffecting: false,
    defaultEnabled: true,
    gatedAction: 'event.manage',
    dependsOn: null,
  },
  {
    key: 'experience.bulk_owner_invites',
    area: 'experience',
    name: 'Bulk owner invites',
    description:
      'Invite several budget owners at once from the users screen (103a). Off by default; each invited person still gets their roles through user administration.',
    moneyAffecting: false,
    defaultEnabled: false,
    gatedAction: 'users.manage',
    dependsOn: null,
  },
];

export const flagByKey = (key: string): FlagDefinition | undefined =>
  FLAG_CATALOG.find((f) => f.key === key);

export type RolloutMode = 'everyone' | 'pilot';

export interface FlagRollout {
  enabled: boolean;
  mode: RolloutMode;
  /** Pilot group: org units (a unit covers its subtree) and roles. */
  orgUnitIds: readonly string[];
  roleIds: readonly string[];
}

/** Who is asking: the actor's roles and the org units they belong to, ancestors included. */
export interface FlagAudience {
  roles: readonly RoleId[];
  orgUnitIds: readonly string[];
}

/**
 * Whether the capability is revealed to this audience. Never an authorization answer: the API still
 * asserts the flag's `gatedAction` through `PolicyService`.
 */
export function flagAppliesTo(rollout: FlagRollout, audience: FlagAudience): boolean {
  if (!rollout.enabled) return false;
  if (rollout.mode === 'everyone') return true;
  if (rollout.orgUnitIds.some((u) => audience.orgUnitIds.includes(u))) return true;
  return rollout.roleIds.some((r) => audience.roles.includes(r as RoleId));
}

export type FlagSwitchError =
  | 'FLAG_UNKNOWN'
  | 'FLAG_DEPENDENCY_MISSING'
  | 'FLAG_CHANGE_PENDING'
  | 'FLAG_ROLLOUT_INVALID';

export interface FlagSwitchPlan {
  flag: FlagDefinition;
  rollout: FlagRollout;
  /** Money-affecting flags wait for a Finance Controller (`flags.confirm_finance`). */
  needsConfirmation: boolean;
}

/** Validates a requested switch. Pure: the caller supplies dependency and pending-change facts. */
export function planFlagSwitch(input: {
  key: string;
  rollout: FlagRollout;
  dependencyMet: boolean;
  hasPendingChange: boolean;
}): { ok: true; plan: FlagSwitchPlan } | { ok: false; code: FlagSwitchError; message: string } {
  const flag = flagByKey(input.key);
  if (!flag) return { ok: false, code: 'FLAG_UNKNOWN', message: `No feature flag ${input.key}.` };
  if (input.hasPendingChange)
    return {
      ok: false,
      code: 'FLAG_CHANGE_PENDING',
      message: 'A change to this flag is already waiting for confirmation.',
    };
  if (input.rollout.enabled && !input.dependencyMet)
    return {
      ok: false,
      code: 'FLAG_DEPENDENCY_MISSING',
      message: flag.dependsOn ?? 'This capability needs something else to be connected first.',
    };
  if (
    input.rollout.enabled &&
    input.rollout.mode === 'pilot' &&
    input.rollout.orgUnitIds.length === 0 &&
    input.rollout.roleIds.length === 0
  )
    return {
      ok: false,
      code: 'FLAG_ROLLOUT_INVALID',
      message: 'A pilot needs at least one location or role.',
    };
  return {
    ok: true,
    plan: { flag, rollout: input.rollout, needsConfirmation: flag.moneyAffecting },
  };
}
