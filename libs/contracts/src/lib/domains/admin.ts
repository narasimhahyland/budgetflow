/**
 * Administration and experience (Phase 14): company settings, feature flags, data retention and legal
 * holds, user and role administration, owner invites, system health and maintenance notices, the
 * guided setup checklist and a person's own activity.
 *
 * Two shapes repeat here because the product repeats them: a change that needs a second person
 * (`AdminChangeRequest`) and a list that is always ordered by name then id.
 */
import { z } from 'zod';
import { Id, IsoDate, IsoDateTime, Money, RoleId } from '../common';
import type { Endpoint } from '../endpoint';
import { named } from '../registry';
import { NotificationChannel } from './channels';

const Reason = z.string().trim().min(1).max(500);
const FlagKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/)
  .max(100)
  .describe('Feature flag key, `area.capability`.');
const CategoryKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/)
  .max(60)
  .describe('Retention category key.');
const Email = z.email().max(320);

// Shared ------------------------------------------------------------------------------------------

export const AdminChangeStatus = z
  .enum(['pending', 'applied', 'declined', 'cancelled'])
  .describe('State of an administration change that needs a second person.');
export type AdminChangeStatus = z.infer<typeof AdminChangeStatus>;

export const AdminChangeRequest = named(
  'AdminChangeRequest',
  z
    .object({
      id: Id,
      kind: z.enum(['feature_flag', 'retention_policy', 'role_grant']),
      subjectKey: z.string().describe('Flag key, retention category or `<membershipId>:<role>`.'),
      status: AdminChangeStatus,
      needsConfirmation: z.boolean(),
      reason: z.string(),
      requestedByName: z.string().nullable(),
      requestedAt: IsoDateTime,
      confirmedByName: z.string().nullable(),
      decidedAt: IsoDateTime.nullable(),
      decisionReason: z.string().nullable(),
      summary: z.string().describe('What the change does, in plain English.'),
    })
    .strict()
    .describe('An administration change, waiting for a second person or already decided.'),
);
export type AdminChangeRequest = z.infer<typeof AdminChangeRequest>;

export const AdminDecisionRequest = named(
  'AdminDecisionRequest',
  z
    .object({
      decision: z
        .enum(['confirm', 'decline', 'cancel'])
        .describe('`cancel` is for the requester withdrawing their own request.'),
      reason: Reason,
    })
    .strict()
    .describe('Confirm, decline or withdraw an administration change.'),
);
export type AdminDecisionRequest = z.infer<typeof AdminDecisionRequest>;

// Company settings (102b branding, 109 notifications, 110 documents, 112 security) ------------------

export const NotificationDefault = named(
  'NotificationDefault',
  z
    .object({
      type: z.string(),
      name: z.string(),
      audience: z.enum(['approvers', 'requesters', 'owners', 'organizers_employees', 'finance']),
      required: z
        .boolean()
        .describe('Required types always reach In-app and Email and cannot be switched off.'),
      channels: z.array(NotificationChannel),
      allowOptOut: z.boolean(),
    })
    .strict()
    .describe('Company default for one notification type.'),
);
export type NotificationDefault = z.infer<typeof NotificationDefault>;

export const QuietHoursSettings = named(
  'QuietHoursSettings',
  z
    .object({
      enabled: z.boolean(),
      startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      includeWeekends: z.boolean(),
      heldChannels: z
        .array(NotificationChannel)
        .describe('Channels held until quiet hours end. Email is never held.'),
      escalationsIgnoreQuietHours: z.boolean(),
      senderName: z.string().min(1).max(100),
      replyToLocalPart: z.string().min(1).max(64),
    })
    .strict()
    .describe("Quiet hours in each person's office timezone, and how messages are signed."),
);
export type QuietHoursSettings = z.infer<typeof QuietHoursSettings>;

export const NotificationSettings = named(
  'NotificationSettings',
  z
    .object({
      defaults: z.array(NotificationDefault),
      quietHours: QuietHoursSettings,
    })
    .strict()
    .describe('Company notification defaults; each person adjusts within them (059c).'),
);
export type NotificationSettings = z.infer<typeof NotificationSettings>;

export const UpdateNotificationDefaultsRequest = named(
  'UpdateNotificationDefaultsRequest',
  z
    .object({
      defaults: z
        .array(z.object({ type: z.string(), channels: z.array(NotificationChannel) }).strict())
        .max(100),
      quietHours: QuietHoursSettings.optional(),
      reason: Reason,
    })
    .strict(),
);
export type UpdateNotificationDefaultsRequest = z.infer<typeof UpdateNotificationDefaultsRequest>;

export const DocumentKindSettings = named(
  'DocumentKindSettings',
  z
    .object({
      kind: z.string(),
      name: z.string(),
      usedOn: z.string(),
      allowedContentTypes: z.array(z.string()),
      maxBytes: z.int().positive(),
      downloadAllowed: z.boolean(),
      inlinePreview: z.boolean(),
    })
    .strict()
    .describe('Upload rules for one kind of document.'),
);
export type DocumentKindSettings = z.infer<typeof DocumentKindSettings>;

export const DocumentSettings = named(
  'DocumentSettings',
  z
    .object({
      kinds: z.array(DocumentKindSettings),
      allowedContentTypeList: z
        .array(z.string())
        .describe('The fixed safe list every kind chooses from.'),
      maxBytesLimit: z.int().positive(),
      note: z
        .string()
        .describe(
          'Who can see a document always follows the record it belongs to; these rules only narrow downloads.',
        ),
    })
    .strict(),
);
export type DocumentSettings = z.infer<typeof DocumentSettings>;

export const UpdateDocumentSettingsRequest = named(
  'UpdateDocumentSettingsRequest',
  z
    .object({
      kinds: z
        .array(
          z
            .object({
              kind: z.string(),
              allowedContentTypes: z.array(z.string()).min(1).max(10),
              maxBytes: z.int().positive(),
              downloadAllowed: z.boolean(),
              inlinePreview: z.boolean(),
            })
            .strict(),
        )
        .min(1)
        .max(20),
      reason: Reason,
    })
    .strict(),
);
export type UpdateDocumentSettingsRequest = z.infer<typeof UpdateDocumentSettingsRequest>;

export const SecuritySettings = named(
  'SecuritySettings',
  z
    .object({
      identityProviderName: z.string(),
      singleSignOnConnected: z.boolean(),
      multiFactorPolicy: z
        .string()
        .describe('Company decision, read-only here: people turn MFA on in their profile (124).'),
      idleTimeoutMinutes: z.int().min(5).max(240),
      maxSessionHours: z.int().min(1).max(24),
      localAccountsForServiceUsersOnly: z.boolean(),
      biometricUnlockAllowed: z.boolean(),
      breakGlassNote: z
        .string()
        .describe('How platform-operator access to financial data works, in plain English.'),
    })
    .strict(),
);
export type SecuritySettings = z.infer<typeof SecuritySettings>;

export const UpdateSecuritySettingsRequest = named(
  'UpdateSecuritySettingsRequest',
  z
    .object({
      idleTimeoutMinutes: z.int().min(1).max(10_000),
      maxSessionHours: z.int().min(1).max(10_000),
      localAccountsForServiceUsersOnly: z.boolean(),
      biometricUnlockAllowed: z.boolean(),
      reason: Reason,
    })
    .strict()
    .describe('Ranges are checked server-side so an out-of-range value answers a typed problem.'),
);
export type UpdateSecuritySettingsRequest = z.infer<typeof UpdateSecuritySettingsRequest>;

export const BrandingSettings = named(
  'BrandingSettings',
  z
    .object({
      programName: z.string(),
      tagline: z.string(),
      emailFooter: z.string(),
      accentColor: z.string(),
    })
    .strict()
    .describe('Program branding (102b). The Satori theme stays in charge of everything else.'),
);
export type BrandingSettings = z.infer<typeof BrandingSettings>;

export const UpdateBrandingRequest = named(
  'UpdateBrandingRequest',
  z
    .object({
      programName: z.string().trim().min(1).max(80),
      tagline: z.string().trim().max(160),
      emailFooter: z.string().trim().max(300),
      accentColor: z.string().max(7),
      reason: Reason,
    })
    .strict(),
);
export type UpdateBrandingRequest = z.infer<typeof UpdateBrandingRequest>;

export const AdminSettings = named(
  'AdminSettings',
  z
    .object({
      branding: BrandingSettings,
      notifications: NotificationSettings,
      documents: DocumentSettings,
      security: SecuritySettings,
      allowedActions: z
        .array(z.string())
        .describe('Which of these sections the signed-in user may change.'),
    })
    .strict()
    .describe('Every company setting this phase owns, in one read.'),
);
export type AdminSettings = z.infer<typeof AdminSettings>;

// Feature flags (105) -----------------------------------------------------------------------------

export const FlagRolloutMode = z.enum(['everyone', 'pilot']);
export type FlagRolloutMode = z.infer<typeof FlagRolloutMode>;

export const FeatureFlag = named(
  'FeatureFlag',
  z
    .object({
      key: FlagKey,
      area: z.enum(['approvals', 'cofunding', 'channels', 'integrations', 'events', 'experience']),
      name: z.string(),
      description: z.string(),
      enabled: z.boolean(),
      rolloutMode: FlagRolloutMode,
      pilotOrgUnitIds: z.array(Id),
      pilotOrgUnitNames: z.array(z.string()),
      pilotRoleIds: z.array(RoleId),
      moneyAffecting: z
        .boolean()
        .describe('Changes how money or approvals work: a Finance Controller must confirm.'),
      gatedAction: z
        .string()
        .nullable()
        .describe(
          'The action the capability needs. The API asserts it as well, so turning a flag on never grants it.',
        ),
      dependsOn: z.string().nullable(),
      dependencyMet: z.boolean(),
      changedByName: z.string().nullable(),
      changedAt: IsoDateTime.nullable(),
      pendingChange: AdminChangeRequest.nullable(),
    })
    .strict()
    .describe('A capability Hyland can switch on or off. Flags never grant authority.'),
);
export type FeatureFlag = z.infer<typeof FeatureFlag>;

export const FeatureFlagList = named(
  'FeatureFlagList',
  z
    .object({ items: z.array(FeatureFlag) })
    .strict()
    .describe('Flags ordered by area, then name, then key.'),
);
export type FeatureFlagList = z.infer<typeof FeatureFlagList>;

export const SwitchFeatureFlagRequest = named(
  'SwitchFeatureFlagRequest',
  z
    .object({
      enabled: z.boolean(),
      rolloutMode: FlagRolloutMode.default('everyone'),
      pilotOrgUnitIds: z.array(Id).max(50).default([]),
      pilotRoleIds: z.array(RoleId).max(20).default([]),
      reason: Reason,
    })
    .strict(),
);
export type SwitchFeatureFlagRequest = z.infer<typeof SwitchFeatureFlagRequest>;

export const SwitchFeatureFlagResult = named(
  'SwitchFeatureFlagResult',
  z
    .object({
      key: FlagKey,
      applied: z.boolean().describe('False when a Finance Controller has to confirm first.'),
      enabled: z.boolean().describe('The state now in force.'),
      rolloutMode: FlagRolloutMode,
      pendingChange: AdminChangeRequest.nullable(),
    })
    .strict(),
);
export type SwitchFeatureFlagResult = z.infer<typeof SwitchFeatureFlagResult>;

export const FeatureFlagHistory = named(
  'FeatureFlagHistory',
  z.object({ items: z.array(AdminChangeRequest) }).strict(),
);
export type FeatureFlagHistory = z.infer<typeof FeatureFlagHistory>;

export const EffectiveFeature = named(
  'EffectiveFeature',
  z
    .object({
      key: FlagKey,
      name: z.string(),
      area: z.string(),
      /** Whether the capability is revealed to this person. */
      on: z.boolean(),
      gatedAction: z.string().nullable(),
      /**
       * Whether `PolicyService` allows the action behind the capability for this person. A flag that
       * is on with `allowed: false` still refuses the action.
       */
      allowed: z.boolean(),
    })
    .strict()
    .describe('A capability as it applies to the signed-in person.'),
);
export type EffectiveFeature = z.infer<typeof EffectiveFeature>;

export const EffectiveFeatureList = named(
  'EffectiveFeatureList',
  z.object({ items: z.array(EffectiveFeature) }).strict(),
);
export type EffectiveFeatureList = z.infer<typeof EffectiveFeatureList>;

// Data retention and legal holds (111) ------------------------------------------------------------

export const RetentionAction = z.enum(['delete', 'anonymise', 'archive', 'never']);
export type RetentionAction = z.infer<typeof RetentionAction>;

export const RetentionPolicy = named(
  'RetentionPolicy',
  z
    .object({
      category: CategoryKey,
      label: z.string(),
      covers: z.string(),
      action: RetentionAction,
      periodDays: z.int().nullable().describe('Null means kept permanently.'),
      periodLabel: z.string().describe('The period in words, as it is shown.'),
      minimumDays: z.int().nullable(),
      minimumLabel: z.string().nullable(),
      locked: z.boolean(),
      lockedReason: z.string().nullable(),
      financial: z
        .boolean()
        .describe('Shortening a financial category needs a Finance Controller to confirm.'),
      automation: z
        .enum(['automatic', 'manual'])
        .describe(
          '`automatic`: the nightly run applies it. `manual`: a stated policy only, no job.',
        ),
      signoffStatus: z
        .enum(['provisional', 'approved'])
        .describe('Provisional periods are placeholders pending finance and legal sign-off.'),
      signoffNote: z.string().nullable(),
      pendingChange: AdminChangeRequest.nullable(),
      updatedAt: IsoDateTime,
    })
    .strict(),
);
export type RetentionPolicy = z.infer<typeof RetentionPolicy>;

export const RetentionPolicyList = named(
  'RetentionPolicyList',
  z
    .object({
      items: z.array(RetentionPolicy),
      note: z
        .string()
        .describe(
          'Standing statement that accounting records and the audit trail are never deleted and that every period is provisional.',
        ),
    })
    .strict(),
);
export type RetentionPolicyList = z.infer<typeof RetentionPolicyList>;

export const UpdateRetentionPolicyRequest = named(
  'UpdateRetentionPolicyRequest',
  z
    .object({
      periodDays: z.int().min(0).max(36_500).nullable(),
      reason: Reason,
    })
    .strict(),
);
export type UpdateRetentionPolicyRequest = z.infer<typeof UpdateRetentionPolicyRequest>;

export const UpdateRetentionPolicyResult = named(
  'UpdateRetentionPolicyResult',
  z
    .object({
      category: CategoryKey,
      applied: z.boolean().describe('False while a Finance Controller has to confirm.'),
      periodDays: z.int().nullable().describe('The period now in force.'),
      pendingChange: AdminChangeRequest.nullable(),
    })
    .strict(),
);
export type UpdateRetentionPolicyResult = z.infer<typeof UpdateRetentionPolicyResult>;

export const LegalHoldScopeKind = z.enum(['person', 'event', 'budget', 'date_range']);
export type LegalHoldScopeKind = z.infer<typeof LegalHoldScopeKind>;

export const LegalHold = named(
  'LegalHold',
  z
    .object({
      id: Id,
      scopeKind: LegalHoldScopeKind,
      scopeRefId: Id.nullable(),
      scopeLabel: z.string().describe('What the hold covers, in plain English.'),
      scopeFrom: IsoDate.nullable(),
      scopeTo: IsoDate.nullable(),
      reason: z.string(),
      status: z.enum(['pending_confirmation', 'active', 'declined', 'released']),
      placedByName: z.string().nullable(),
      confirmedByName: z.string().nullable(),
      confirmedAt: IsoDateTime.nullable(),
      releasedByName: z.string().nullable(),
      releasedAt: IsoDateTime.nullable(),
      releaseReason: z.string().nullable(),
      createdAt: IsoDateTime,
    })
    .strict()
    .describe('A legal hold pauses every deletion in its scope while it is active.'),
);
export type LegalHold = z.infer<typeof LegalHold>;

export const LegalHoldList = named(
  'LegalHoldList',
  z.object({ items: z.array(LegalHold) }).strict(),
);
export type LegalHoldList = z.infer<typeof LegalHoldList>;

export const PlaceLegalHoldRequest = named(
  'PlaceLegalHoldRequest',
  z
    .object({
      scopeKind: LegalHoldScopeKind,
      scopeRefId: Id.nullable().default(null),
      scopeFrom: IsoDate.nullable().default(null),
      scopeTo: IsoDate.nullable().default(null),
      reason: Reason,
    })
    .strict()
    .describe('A hold needs a second person with `legal_hold.manage` before it becomes active.'),
);
export type PlaceLegalHoldRequest = z.infer<typeof PlaceLegalHoldRequest>;

export const LegalHoldDecisionRequest = named(
  'LegalHoldDecisionRequest',
  z
    .object({
      decision: z.enum(['confirm', 'decline', 'release']),
      reason: Reason,
    })
    .strict(),
);
export type LegalHoldDecisionRequest = z.infer<typeof LegalHoldDecisionRequest>;

export const RetentionRunItem = named(
  'RetentionRunItem',
  z
    .object({
      category: CategoryKey,
      label: z.string(),
      action: RetentionAction,
      cutoffAt: IsoDateTime.nullable(),
      candidateCount: z.int(),
      appliedCount: z.int().describe('Removed or anonymised. Always 0 for a dry run.'),
      skippedHoldCount: z.int().describe('Kept because a legal hold covers them.'),
      holdIds: z.array(Id).describe('The holds that kept records in this category.'),
      note: z.string().nullable(),
    })
    .strict(),
);
export type RetentionRunItem = z.infer<typeof RetentionRunItem>;

export const RetentionRun = named(
  'RetentionRun',
  z
    .object({
      id: Id,
      mode: z.enum(['dry_run', 'apply']),
      trigger: z.enum(['manual', 'scheduled']),
      status: z.enum(['completed', 'failed']),
      categories: z.array(CategoryKey),
      dryRunId: Id.nullable().describe('The preview this run repeats; required for an apply run.'),
      requestedByName: z.string().nullable(),
      confirmedByName: z.string().nullable(),
      startedAt: IsoDateTime,
      finishedAt: IsoDateTime.nullable(),
      error: z.string().nullable(),
      items: z.array(RetentionRunItem),
      summary: z.string().describe('What the run did, in one sentence.'),
    })
    .strict()
    .describe('A retention preview or run. Reports are append-only.'),
);
export type RetentionRun = z.infer<typeof RetentionRun>;

export const RetentionRunList = named(
  'RetentionRunList',
  z.object({ items: z.array(RetentionRun) }).strict(),
);
export type RetentionRunList = z.infer<typeof RetentionRunList>;

export const StartRetentionRunRequest = named(
  'StartRetentionRunRequest',
  z
    .object({
      mode: z.enum(['dry_run', 'apply']),
      categories: z
        .array(CategoryKey)
        .max(40)
        .default([])
        .describe('Empty means every category the run can act on.'),
      dryRunId: Id.optional().describe('The preview an apply run repeats. Required to apply.'),
      confirmation: z
        .string()
        .optional()
        .describe('Apply runs are irreversible: type DELETE to confirm.'),
      reason: Reason,
    })
    .strict(),
);
export type StartRetentionRunRequest = z.infer<typeof StartRetentionRunRequest>;

// User and role administration (103, 103a) ---------------------------------------------------------

export const AdminRoleGrant = named(
  'AdminRoleGrant',
  z
    .object({
      id: Id,
      role: RoleId,
      scopeOrgUnitId: Id.nullable(),
      scopeOrgUnitName: z.string().nullable(),
      validFrom: IsoDate,
      validTo: IsoDate.nullable(),
    })
    .strict(),
);
export type AdminRoleGrant = z.infer<typeof AdminRoleGrant>;

export const AdminUser = named(
  'AdminUser',
  z
    .object({
      membershipId: Id,
      personId: Id.nullable(),
      displayName: z.string(),
      email: z.string().nullable(),
      jobTitle: z.string().nullable(),
      locationName: z.string().nullable(),
      status: z.string(),
      roles: z.array(RoleId),
      grants: z.array(AdminRoleGrant),
      privileged: z
        .boolean()
        .describe('Holds a role covered by the quarterly privileged-access review (113).'),
      anonymised: z.boolean().describe('A leaver whose personal details retention has removed.'),
      pendingRoleChanges: z.array(AdminChangeRequest),
    })
    .strict(),
);
export type AdminUser = z.infer<typeof AdminUser>;

export const AdminUserList = named(
  'AdminUserList',
  z
    .object({ items: z.array(AdminUser) })
    .strict()
    .describe('People in the tenant, ordered by display name then membership id.'),
);
export type AdminUserList = z.infer<typeof AdminUserList>;

export const GrantRoleRequest = named(
  'GrantRoleRequest',
  z
    .object({
      role: RoleId,
      scopeOrgUnitId: Id.nullable().default(null),
      reason: Reason,
    })
    .strict()
    .describe(
      'A role grant never carries an approval limit: authority to approve an amount comes from the delegation-of-authority matrix.',
    ),
);
export type GrantRoleRequest = z.infer<typeof GrantRoleRequest>;

export const GrantRoleResult = named(
  'GrantRoleResult',
  z
    .object({
      membershipId: Id,
      role: RoleId,
      applied: z
        .boolean()
        .describe('False when the role gives authority the requester does not hold themselves.'),
      authorityBeyondRequester: z
        .array(z.string())
        .describe(
          'Actions the grant would add that the requester cannot do; these need a confirmer.',
        ),
      pendingChange: AdminChangeRequest.nullable(),
      grant: AdminRoleGrant.nullable(),
    })
    .strict(),
);
export type GrantRoleResult = z.infer<typeof GrantRoleResult>;

export const RevokeRoleRequest = named(
  'RevokeRoleRequest',
  z.object({ role: RoleId, reason: Reason }).strict(),
);
export type RevokeRoleRequest = z.infer<typeof RevokeRoleRequest>;

export const RevokeRoleResult = named(
  'RevokeRoleResult',
  z.object({ membershipId: Id, role: RoleId, revoked: z.boolean() }).strict(),
);
export type RevokeRoleResult = z.infer<typeof RevokeRoleResult>;

export const OwnerInvite = named(
  'OwnerInvite',
  z
    .object({
      id: Id,
      batchId: Id,
      email: z.string(),
      displayName: z.string(),
      proposedRole: RoleId,
      orgUnitId: Id.nullable(),
      status: z.enum(['invited', 'accepted', 'expired', 'revoked']),
      invitedByName: z.string().nullable(),
      expiresAt: IsoDateTime,
      createdAt: IsoDateTime,
    })
    .strict()
    .describe('An invitation grants nothing: roles are still granted through user administration.'),
);
export type OwnerInvite = z.infer<typeof OwnerInvite>;

export const OwnerInviteList = named(
  'OwnerInviteList',
  z.object({ items: z.array(OwnerInvite) }).strict(),
);
export type OwnerInviteList = z.infer<typeof OwnerInviteList>;

export const CreateOwnerInvitesRequest = named(
  'CreateOwnerInvitesRequest',
  z
    .object({
      invites: z
        .array(
          z
            .object({
              email: Email,
              displayName: z.string().trim().min(1).max(120),
              proposedRole: RoleId,
              orgUnitId: Id.nullable().default(null),
            })
            .strict(),
        )
        .min(1)
        .max(100),
      reason: Reason,
    })
    .strict(),
);
export type CreateOwnerInvitesRequest = z.infer<typeof CreateOwnerInvitesRequest>;

export const CreateOwnerInvitesResult = named(
  'CreateOwnerInvitesResult',
  z
    .object({
      batchId: Id,
      created: z.int(),
      skippedExisting: z.array(z.string()).describe('Email addresses already invited.'),
      items: z.array(OwnerInvite),
    })
    .strict(),
);
export type CreateOwnerInvitesResult = z.infer<typeof CreateOwnerInvitesResult>;

// System health and maintenance notices (114) ------------------------------------------------------

export const HealthServiceStatus = z.enum(['healthy', 'degraded', 'down', 'not_enabled']);
export type HealthServiceStatus = z.infer<typeof HealthServiceStatus>;

export const HealthService = named(
  'HealthService',
  z
    .object({
      key: z.string(),
      name: z.string(),
      status: HealthServiceStatus,
      detail: z.string().describe('A sentence with the numbers behind the status; never amounts.'),
      checkedAt: IsoDateTime,
    })
    .strict(),
);
export type HealthService = z.infer<typeof HealthService>;

export const HealthQueue = named(
  'HealthQueue',
  z
    .object({
      name: z.string(),
      waiting: z.int(),
      active: z.int(),
      failedLast24h: z.int(),
      oldestWaitingSeconds: z.int().nullable(),
    })
    .strict(),
);
export type HealthQueue = z.infer<typeof HealthQueue>;

export const HealthJobRun = named(
  'HealthJobRun',
  z
    .object({
      job: z.string(),
      name: z.string(),
      schedule: z.string(),
      lastRunAt: IsoDateTime.nullable(),
      durationMs: z.int().nullable(),
      result: z.string().describe('Plain-English result with counts and no amounts.'),
      status: z.enum(['ok', 'attention', 'failed', 'never_run']),
    })
    .strict(),
);
export type HealthJobRun = z.infer<typeof HealthJobRun>;

export const SystemHealth = named(
  'SystemHealth',
  z
    .object({
      overall: HealthServiceStatus,
      environment: z.string(),
      version: z.string(),
      checkedAt: IsoDateTime,
      services: z.array(HealthService),
      queues: z.array(HealthQueue),
      outboxUnpublished: z.int(),
      outboxLagSeconds: z.int().nullable(),
      nightlyJobs: z.array(HealthJobRun),
      activeMaintenanceNotice: z.string().nullable(),
    })
    .strict()
    .describe('Operational health only: no budgets, amounts or financial data.'),
);
export type SystemHealth = z.infer<typeof SystemHealth>;

export const MaintenanceNotice = named(
  'MaintenanceNotice',
  z
    .object({
      id: Id,
      message: z.string(),
      startsAt: IsoDateTime,
      endsAt: IsoDateTime,
      showFrom: IsoDateTime,
      status: z.enum(['scheduled', 'cancelled']),
      createdByName: z.string().nullable(),
      createdAt: IsoDateTime,
    })
    .strict(),
);
export type MaintenanceNotice = z.infer<typeof MaintenanceNotice>;

export const MaintenanceNoticeList = named(
  'MaintenanceNoticeList',
  z.object({ items: z.array(MaintenanceNotice) }).strict(),
);
export type MaintenanceNoticeList = z.infer<typeof MaintenanceNoticeList>;

export const CreateMaintenanceNoticeRequest = named(
  'CreateMaintenanceNoticeRequest',
  z
    .object({
      message: z.string().trim().min(1).max(300),
      startsAt: IsoDateTime,
      endsAt: IsoDateTime,
      showFrom: IsoDateTime.optional().describe('Defaults to 24 hours before the start.'),
    })
    .strict(),
);
export type CreateMaintenanceNoticeRequest = z.infer<typeof CreateMaintenanceNoticeRequest>;

export const CancelMaintenanceNoticeRequest = named(
  'CancelMaintenanceNoticeRequest',
  z.object({ reason: Reason }).strict(),
);
export type CancelMaintenanceNoticeRequest = z.infer<typeof CancelMaintenanceNoticeRequest>;

// Guided setup checklist (10a) ----------------------------------------------------------------------

export const SetupChecklistItem = named(
  'SetupChecklistItem',
  z
    .object({
      key: z.string(),
      name: z.string(),
      description: z.string(),
      done: z.boolean(),
      detail: z.string().describe('What exists today, with counts.'),
      route: z.string().describe('Where to go to finish it.'),
      requiredAction: z.string().describe('The action a person needs to do it.'),
    })
    .strict(),
);
export type SetupChecklistItem = z.infer<typeof SetupChecklistItem>;

export const SetupChecklist = named(
  'SetupChecklist',
  z
    .object({
      completed: z.int(),
      total: z.int(),
      items: z.array(SetupChecklistItem),
    })
    .strict()
    .describe('What a new tenant still has to set up, computed from the data that exists.'),
);
export type SetupChecklist = z.infer<typeof SetupChecklist>;

// Personal activity (122) ----------------------------------------------------------------------------

export const MyActivityType = z.enum([
  'request',
  'approval',
  'event',
  'receipt',
  'delegation',
  'export',
  'comment',
  'budget',
  'other',
]);
export type MyActivityType = z.infer<typeof MyActivityType>;

export const MyActivityEntry = named(
  'MyActivityEntry',
  z
    .object({
      id: Id,
      occurredAt: IsoDateTime,
      type: MyActivityType,
      summary: z.string().describe('One sentence: what happened.'),
      itemType: z.string().nullable(),
      itemId: Id.nullable(),
      /** Set when someone acted as this person's delegate, or this person acted for someone else. */
      onBehalfOfName: z.string().nullable(),
      byMe: z.boolean().describe('False when it happened to the person rather than by them.'),
    })
    .strict(),
);
export type MyActivityEntry = z.infer<typeof MyActivityEntry>;

export const MyActivityTotals = named(
  'MyActivityTotals',
  z
    .object({
      fiscalYearLabel: z.string().nullable(),
      requestsSubmitted: z.int(),
      requestsApproved: z.int(),
      approvedTotal: Money.nullable(),
      eventsAttended: z.int(),
      eventsOrganised: z.int(),
    })
    .strict()
    .describe("The person's own year, in counts and reporting-currency totals."),
);
export type MyActivityTotals = z.infer<typeof MyActivityTotals>;

export const MyActivity = named(
  'MyActivity',
  z
    .object({
      personId: Id.nullable(),
      from: IsoDate,
      to: IsoDate,
      totals: MyActivityTotals,
      entries: z.array(MyActivityEntry),
      entryCount: z.int(),
    })
    .strict()
    .describe('Strictly self-service: the endpoint takes no person and never shows anyone else.'),
);
export type MyActivity = z.infer<typeof MyActivity>;

// Endpoints ------------------------------------------------------------------------------------------

const FlagParams = z.object({ key: FlagKey }).strict();
const ChangeParams = z.object({ changeId: Id }).strict();
const CategoryParams = z.object({ category: CategoryKey }).strict();
const HoldParams = z.object({ holdId: Id }).strict();
const RunParams = z.object({ runId: Id }).strict();
const MembershipParams = z.object({ membershipId: Id }).strict();
const NoticeParams = z.object({ noticeId: Id }).strict();

export const adminEndpoints = {
  adminSettings: {
    operationId: 'adminSettings',
    method: 'get',
    path: '/api/admin/settings',
    summary: 'Company settings: branding, notification defaults, documents and security',
    tags: ['admin'],
    auth: true,
    response: { status: 200, schema: AdminSettings },
    errors: [401, 403],
  },
  updateBranding: {
    operationId: 'updateBranding',
    method: 'put',
    path: '/api/admin/settings/branding',
    summary: 'Change program branding',
    tags: ['admin'],
    auth: true,
    idempotent: true,
    body: UpdateBrandingRequest,
    response: { status: 200, schema: BrandingSettings },
    errors: [401, 403, 422],
  },
  updateNotificationSettings: {
    operationId: 'updateNotificationSettings',
    method: 'put',
    path: '/api/admin/settings/notifications',
    summary: 'Change company notification defaults and quiet hours',
    tags: ['admin'],
    auth: true,
    idempotent: true,
    body: UpdateNotificationDefaultsRequest,
    response: { status: 200, schema: NotificationSettings },
    errors: [401, 403, 422],
  },
  updateDocumentSettings: {
    operationId: 'updateDocumentSettings',
    method: 'put',
    path: '/api/admin/settings/documents',
    summary: 'Change upload rules per document kind',
    tags: ['admin'],
    auth: true,
    idempotent: true,
    body: UpdateDocumentSettingsRequest,
    response: { status: 200, schema: DocumentSettings },
    errors: [401, 403, 422],
  },
  updateSecuritySettings: {
    operationId: 'updateSecuritySettings',
    method: 'put',
    path: '/api/admin/settings/security',
    summary: 'Change session limits and sign-in settings',
    tags: ['admin'],
    auth: true,
    idempotent: true,
    body: UpdateSecuritySettingsRequest,
    response: { status: 200, schema: SecuritySettings },
    errors: [401, 403, 422],
  },
  featureFlags: {
    operationId: 'featureFlags',
    method: 'get',
    path: '/api/admin/features',
    summary: 'Feature flags by area with rollout, dependencies and pending confirmations',
    tags: ['admin'],
    auth: true,
    response: { status: 200, schema: FeatureFlagList },
    errors: [401, 403],
  },
  switchFeatureFlag: {
    operationId: 'switchFeatureFlag',
    method: 'post',
    path: '/api/admin/features/{key}/switch',
    summary: 'Turn a capability on or off, or pilot it with chosen locations and roles',
    tags: ['admin'],
    auth: true,
    idempotent: true,
    params: FlagParams,
    body: SwitchFeatureFlagRequest,
    response: { status: 201, schema: SwitchFeatureFlagResult },
    errors: [401, 403, 404, 409, 422],
  },
  decideFeatureFlagChange: {
    operationId: 'decideFeatureFlagChange',
    method: 'post',
    path: '/api/admin/features/changes/{changeId}/decision',
    summary: 'Confirm, decline or withdraw a money-affecting flag change',
    tags: ['admin'],
    auth: true,
    idempotent: true,
    params: ChangeParams,
    body: AdminDecisionRequest,
    response: { status: 201, schema: SwitchFeatureFlagResult },
    errors: [401, 403, 404, 409, 422],
  },
  featureFlagHistory: {
    operationId: 'featureFlagHistory',
    method: 'get',
    path: '/api/admin/features/history',
    summary: 'Who switched which flag, when and why',
    tags: ['admin'],
    auth: true,
    query: z.object({ key: FlagKey.optional() }).strict(),
    response: { status: 200, schema: FeatureFlagHistory },
    errors: [401, 403],
  },
  myFeatures: {
    operationId: 'myFeatures',
    method: 'get',
    path: '/api/me/features',
    summary: 'Capabilities revealed to the signed-in person, with whether the policy allows each',
    tags: ['admin'],
    auth: true,
    response: { status: 200, schema: EffectiveFeatureList },
    errors: [401],
  },
  retentionPolicies: {
    operationId: 'retentionPolicies',
    method: 'get',
    path: '/api/admin/retention/policies',
    summary: 'How long each kind of data is kept, and what happens then',
    tags: ['admin'],
    auth: true,
    response: { status: 200, schema: RetentionPolicyList },
    errors: [401, 403],
  },
  updateRetentionPolicy: {
    operationId: 'updateRetentionPolicy',
    method: 'put',
    path: '/api/admin/retention/policies/{category}',
    summary: 'Change a retention period within its minimum',
    tags: ['admin'],
    auth: true,
    idempotent: true,
    params: CategoryParams,
    body: UpdateRetentionPolicyRequest,
    response: { status: 200, schema: UpdateRetentionPolicyResult },
    errors: [401, 403, 404, 409, 422],
  },
  decideRetentionChange: {
    operationId: 'decideRetentionChange',
    method: 'post',
    path: '/api/admin/retention/changes/{changeId}/decision',
    summary: 'Confirm, decline or withdraw a retention change that shortens a financial category',
    tags: ['admin'],
    auth: true,
    idempotent: true,
    params: ChangeParams,
    body: AdminDecisionRequest,
    response: { status: 201, schema: UpdateRetentionPolicyResult },
    errors: [401, 403, 404, 409, 422],
  },
  legalHolds: {
    operationId: 'legalHolds',
    method: 'get',
    path: '/api/admin/retention/holds',
    summary: 'Legal holds, newest first',
    tags: ['admin'],
    auth: true,
    query: z.object({ status: z.string().max(25).optional() }).strict(),
    response: { status: 200, schema: LegalHoldList },
    errors: [401, 403],
  },
  placeLegalHold: {
    operationId: 'placeLegalHold',
    method: 'post',
    path: '/api/admin/retention/holds',
    summary: 'Place a legal hold (a second person confirms before it becomes active)',
    tags: ['admin'],
    auth: true,
    idempotent: true,
    body: PlaceLegalHoldRequest,
    response: { status: 201, schema: LegalHold },
    errors: [401, 403, 422],
  },
  decideLegalHold: {
    operationId: 'decideLegalHold',
    method: 'post',
    path: '/api/admin/retention/holds/{holdId}/decision',
    summary: 'Confirm, decline or release a legal hold',
    tags: ['admin'],
    auth: true,
    idempotent: true,
    params: HoldParams,
    body: LegalHoldDecisionRequest,
    response: { status: 201, schema: LegalHold },
    errors: [401, 403, 404, 409, 422],
  },
  retentionRuns: {
    operationId: 'retentionRuns',
    method: 'get',
    path: '/api/admin/retention/runs',
    summary: 'Retention previews and runs, newest first',
    tags: ['admin'],
    auth: true,
    response: { status: 200, schema: RetentionRunList },
    errors: [401, 403],
  },
  retentionRun: {
    operationId: 'retentionRun',
    method: 'get',
    path: '/api/admin/retention/runs/{runId}',
    summary: 'One retention run with its per-category report',
    tags: ['admin'],
    auth: true,
    params: RunParams,
    response: { status: 200, schema: RetentionRun },
    errors: [401, 403, 404],
  },
  startRetentionRun: {
    operationId: 'startRetentionRun',
    method: 'post',
    path: '/api/admin/retention/runs',
    summary: 'Preview what retention would remove, or apply it (irreversible, confirmed)',
    tags: ['admin'],
    auth: true,
    idempotent: true,
    body: StartRetentionRunRequest,
    response: { status: 201, schema: RetentionRun },
    errors: [401, 403, 404, 409, 422],
  },
  adminUsers: {
    operationId: 'adminUsers',
    method: 'get',
    path: '/api/admin/users',
    summary: 'People in the tenant with their roles and pending role changes',
    tags: ['admin'],
    auth: true,
    query: z.object({ search: z.string().max(120).optional(), role: RoleId.optional() }).strict(),
    response: { status: 200, schema: AdminUserList },
    errors: [401, 403],
  },
  adminUser: {
    operationId: 'adminUser',
    method: 'get',
    path: '/api/admin/users/{membershipId}',
    summary: 'One person with their role grants',
    tags: ['admin'],
    auth: true,
    params: MembershipParams,
    response: { status: 200, schema: AdminUser },
    errors: [401, 403, 404],
  },
  grantRole: {
    operationId: 'grantRole',
    method: 'post',
    path: '/api/admin/users/{membershipId}/role-grants',
    summary: 'Give someone a role (a second person confirms authority the requester lacks)',
    tags: ['admin'],
    auth: true,
    idempotent: true,
    params: MembershipParams,
    body: GrantRoleRequest,
    response: { status: 201, schema: GrantRoleResult },
    errors: [401, 403, 404, 409, 422],
  },
  decideRoleGrant: {
    operationId: 'decideRoleGrant',
    method: 'post',
    path: '/api/admin/role-grants/changes/{changeId}/decision',
    summary: 'Confirm, decline or withdraw a pending role grant',
    tags: ['admin'],
    auth: true,
    idempotent: true,
    params: ChangeParams,
    body: AdminDecisionRequest,
    response: { status: 201, schema: GrantRoleResult },
    errors: [401, 403, 404, 409, 422],
  },
  revokeRole: {
    operationId: 'revokeRole',
    method: 'post',
    path: '/api/admin/users/{membershipId}/role-revocations',
    summary: 'Take a role away',
    tags: ['admin'],
    auth: true,
    idempotent: true,
    params: MembershipParams,
    body: RevokeRoleRequest,
    response: { status: 201, schema: RevokeRoleResult },
    errors: [401, 403, 404, 409, 422],
  },
  ownerInvites: {
    operationId: 'ownerInvites',
    method: 'get',
    path: '/api/admin/owner-invites',
    summary: 'Budget owners invited from the users screen',
    tags: ['admin'],
    auth: true,
    response: { status: 200, schema: OwnerInviteList },
    errors: [401, 403],
  },
  createOwnerInvites: {
    operationId: 'createOwnerInvites',
    method: 'post',
    path: '/api/admin/owner-invites',
    summary: 'Invite several budget owners at once (capability behind a feature flag)',
    tags: ['admin'],
    auth: true,
    idempotent: true,
    body: CreateOwnerInvitesRequest,
    response: { status: 201, schema: CreateOwnerInvitesResult },
    errors: [401, 403, 409, 422],
  },
  systemHealth: {
    operationId: 'systemHealth',
    method: 'get',
    path: '/api/admin/health',
    summary: 'Services, queues and nightly jobs, with no financial data',
    tags: ['admin'],
    auth: true,
    response: { status: 200, schema: SystemHealth },
    errors: [401, 403],
  },
  maintenanceNotices: {
    operationId: 'maintenanceNotices',
    method: 'get',
    path: '/api/admin/maintenance-notices',
    summary: 'Planned maintenance notices',
    tags: ['admin'],
    auth: true,
    query: z.object({ activeOnly: z.enum(['true', 'false']).optional() }).strict(),
    response: { status: 200, schema: MaintenanceNoticeList },
    errors: [401, 403],
  },
  createMaintenanceNotice: {
    operationId: 'createMaintenanceNotice',
    method: 'post',
    path: '/api/admin/maintenance-notices',
    summary: 'Announce planned maintenance in the shell banner',
    tags: ['admin'],
    auth: true,
    idempotent: true,
    body: CreateMaintenanceNoticeRequest,
    response: { status: 201, schema: MaintenanceNotice },
    errors: [401, 403, 422],
  },
  cancelMaintenanceNotice: {
    operationId: 'cancelMaintenanceNotice',
    method: 'post',
    path: '/api/admin/maintenance-notices/{noticeId}/cancellation',
    summary: 'Cancel a scheduled maintenance notice',
    tags: ['admin'],
    auth: true,
    idempotent: true,
    params: NoticeParams,
    body: CancelMaintenanceNoticeRequest,
    response: { status: 201, schema: MaintenanceNotice },
    errors: [401, 403, 404, 409, 422],
  },
  setupChecklist: {
    operationId: 'setupChecklist',
    method: 'get',
    path: '/api/admin/setup-checklist',
    summary: 'What a new tenant still has to set up',
    tags: ['admin'],
    auth: true,
    response: { status: 200, schema: SetupChecklist },
    errors: [401, 403],
  },
  myActivity: {
    operationId: 'myActivity',
    method: 'get',
    path: '/api/me/activity',
    summary: 'The signed-in person\u2019s own activity and yearly totals',
    tags: ['admin'],
    auth: true,
    query: z
      .object({
        from: IsoDate.optional(),
        to: IsoDate.optional(),
        types: z.string().max(200).optional().describe('Comma-separated activity types.'),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      })
      .strict(),
    response: { status: 200, schema: MyActivity },
    errors: [401],
  },
} as const satisfies Record<string, Endpoint>;
