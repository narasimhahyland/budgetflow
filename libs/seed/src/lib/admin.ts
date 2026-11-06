import { ORG_UNITS, seedId, TENANTS } from './ids';
import { P5_IDS } from './events';
import { userById } from './roles';

/**
 * Phase 14 seed (prefix 91): the administration surface as Hyland would have set it up - retention
 * periods at their provisional defaults, the capability switches with one pilot, a money-affecting
 * flag waiting for the Finance Controller, an active legal hold and a released one, a planned
 * maintenance notice and two owner invitations. Everything fictional.
 */
export const P14_IDS = {
  flags: {
    slack: seedId('91000000', 1),
    teams: seedId('91000000', 2),
    mobilePush: seedId('91000000', 3),
    counterOffers: seedId('91000000', 4),
    transferMode: seedId('91000000', 5),
    waitlist: seedId('91000000', 6),
    surveys: seedId('91000000', 7),
    autoApprove: seedId('91000000', 8),
    cardLimitPush: seedId('91000000', 9),
    bulkOwnerInvites: seedId('91000000', 10),
  },
  pendingFlagChange: seedId('91000000', 20),
  holds: { activeEvent: seedId('91000000', 30), released: seedId('91000000', 31) },
  maintenanceNotice: seedId('91000000', 40),
  invites: { priyaPatel: seedId('91000000', 50), lukasHofer: seedId('91000000', 51) },
} as const;

const T = TENANTS.acme;

export interface SeedFeatureFlag {
  id: string;
  tenantId: string;
  key: string;
  enabled: boolean;
  rolloutMode: 'everyone' | 'pilot';
  pilotOrgUnitIds: string[];
  pilotRoleIds: string[];
}

/**
 * The switches as Hyland has them. `events.waitlist_auto_promotion` runs as a pilot in Bengaluru and
 * Berlin so the rollout state has a real example; the two money-affecting flags stay off.
 */
export const ADMIN_FEATURE_FLAGS: readonly SeedFeatureFlag[] = [
  {
    id: P14_IDS.flags.slack,
    tenantId: T,
    key: 'channels.slack_app',
    enabled: true,
    rolloutMode: 'everyone',
    pilotOrgUnitIds: [],
    pilotRoleIds: [],
  },
  {
    id: P14_IDS.flags.teams,
    tenantId: T,
    key: 'channels.teams_app',
    enabled: false,
    rolloutMode: 'everyone',
    pilotOrgUnitIds: [],
    pilotRoleIds: [],
  },
  {
    id: P14_IDS.flags.mobilePush,
    tenantId: T,
    key: 'channels.mobile_push',
    enabled: true,
    rolloutMode: 'everyone',
    pilotOrgUnitIds: [],
    pilotRoleIds: [],
  },
  {
    id: P14_IDS.flags.counterOffers,
    tenantId: T,
    key: 'approvals.counter_offers',
    enabled: true,
    rolloutMode: 'everyone',
    pilotOrgUnitIds: [],
    pilotRoleIds: [],
  },
  {
    id: P14_IDS.flags.transferMode,
    tenantId: T,
    key: 'cofunding.transfer_mode',
    enabled: true,
    rolloutMode: 'everyone',
    pilotOrgUnitIds: [],
    pilotRoleIds: [],
  },
  {
    id: P14_IDS.flags.waitlist,
    tenantId: T,
    key: 'events.waitlist_auto_promotion',
    enabled: true,
    rolloutMode: 'pilot',
    pilotOrgUnitIds: [ORG_UNITS.bengaluru, ORG_UNITS.berlin],
    pilotRoleIds: [],
  },
  {
    id: P14_IDS.flags.surveys,
    tenantId: T,
    key: 'events.post_event_surveys',
    enabled: true,
    rolloutMode: 'everyone',
    pilotOrgUnitIds: [],
    pilotRoleIds: [],
  },
  {
    id: P14_IDS.flags.autoApprove,
    tenantId: T,
    key: 'approvals.auto_approve_within_policy',
    enabled: false,
    rolloutMode: 'everyone',
    pilotOrgUnitIds: [],
    pilotRoleIds: [],
  },
  {
    id: P14_IDS.flags.cardLimitPush,
    tenantId: T,
    key: 'integrations.card_limit_push',
    enabled: false,
    rolloutMode: 'everyone',
    pilotOrgUnitIds: [],
    pilotRoleIds: [],
  },
  {
    id: P14_IDS.flags.bulkOwnerInvites,
    tenantId: T,
    key: 'experience.bulk_owner_invites',
    enabled: false,
    rolloutMode: 'everyone',
    pilotOrgUnitIds: [],
    pilotRoleIds: [],
  },
];

/** A money-affecting flag the Finance Admin asked for, still waiting for the Finance Controller. */
export const ADMIN_PENDING_FLAG_CHANGE = {
  id: P14_IDS.pendingFlagChange,
  tenantId: T,
  kind: 'feature_flag' as const,
  subjectKey: 'integrations.card_limit_push',
  payload: {
    enabled: true,
    rolloutMode: 'everyone' as const,
    pilotOrgUnitIds: [] as string[],
    pilotRoleIds: [] as string[],
  },
  reason: 'Card limits should follow approved commitments so cards stop matching stale amounts.',
  requestedByPersonId: userById('finance-admin').personId,
  requestedBySubject: userById('finance-admin').subject,
  status: 'pending' as const,
  needsConfirmation: true,
};

/**
 * Legal holds: one active hold over the cross-location event under review, and one already released.
 * Both were placed by the Auditor and confirmed by the Finance Controller.
 */
export const ADMIN_LEGAL_HOLDS = [
  {
    id: P14_IDS.holds.activeEvent,
    tenantId: T,
    scopeKind: 'event' as const,
    scopeRefId: P5_IDS.event,
    reason:
      'Expense review of the cross-location event: keep every record until the review closes.',
    placedByPersonId: userById('auditor').personId,
    confirmedByPersonId: userById('finance-controller').personId,
    status: 'active' as const,
  },
  {
    id: P14_IDS.holds.released,
    tenantId: T,
    scopeKind: 'date_range' as const,
    scopeFrom: '2026-01-01',
    scopeTo: '2026-03-31',
    reason: 'First-quarter sampling for the external audit.',
    placedByPersonId: userById('auditor').personId,
    confirmedByPersonId: userById('finance-controller').personId,
    status: 'released' as const,
    releasedByPersonId: userById('auditor').personId,
    releaseReason: 'Sampling finished; the external auditors have what they asked for.',
  },
];

/** A planned maintenance window announced in the shell banner. */
export const ADMIN_MAINTENANCE_NOTICE = {
  id: P14_IDS.maintenanceNotice,
  tenantId: T,
  message: 'BudgetFlow is unavailable for about an hour while we upgrade the database.',
  startsAt: '2026-12-13T02:00:00.000Z',
  endsAt: '2026-12-13T03:00:00.000Z',
  showFrom: '2026-12-12T02:00:00.000Z',
  createdByPersonId: userById('org-admin').personId,
};

/** Two budget owners invited in one batch from the users screen. */
export const ADMIN_OWNER_INVITES = [
  {
    id: P14_IDS.invites.priyaPatel,
    tenantId: T,
    batchId: seedId('91000000', 60),
    email: 'nisha.varma@example.test',
    displayName: 'Nisha Varma',
    proposedRole: 'budget-owner',
    orgUnitId: ORG_UNITS.bengaluru,
    expiresAt: '2026-11-20T09:00:00.000Z',
    invitedByPersonId: userById('org-admin').personId,
  },
  {
    id: P14_IDS.invites.lukasHofer,
    tenantId: T,
    batchId: seedId('91000000', 60),
    email: 'lukas.hofer@example.test',
    displayName: 'Lukas Hofer',
    proposedRole: 'location-manager',
    orgUnitId: ORG_UNITS.berlin,
    expiresAt: '2026-11-20T09:00:00.000Z',
    invitedByPersonId: userById('org-admin').personId,
  },
];
