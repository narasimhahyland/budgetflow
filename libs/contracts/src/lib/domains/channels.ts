import { z } from 'zod';
import { CursorQuery, Id, IsoDate, IsoDateTime, Money, RoleId } from '../common';
import type { Endpoint } from '../endpoint';
import { named } from '../registry';
import { DecisionResponse } from './approvals';

// Notifications and tasks (screen 123) ---------------------------------------------------------

export const NOTIFICATION_AREAS = [
  'approvals',
  'budgets',
  'events',
  'requests',
  'finance',
  'discussion',
] as const;
export const NotificationArea = z.enum(NOTIFICATION_AREAS);
export type NotificationArea = z.infer<typeof NotificationArea>;

export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'push', 'slack', 'teams'] as const;
export const NotificationChannel = z.enum(NOTIFICATION_CHANNELS);
export type NotificationChannel = z.infer<typeof NotificationChannel>;

export const NOTIFICATION_TONES = ['neutral', 'info', 'warning', 'important', 'success'] as const;
export const NotificationTone = z.enum(NOTIFICATION_TONES);

export const NotificationItem = named(
  'NotificationItem',
  z
    .object({
      id: Id,
      area: NotificationArea,
      type: z.string(),
      tone: NotificationTone,
      title: z.string(),
      detail: z.string(),
      itemType: z.enum(['budget', 'event', 'request', 'contribution']).nullable(),
      itemId: Id.nullable(),
      itemRef: z.string().nullable(),
      itemLink: z.string().nullable(),
      commentId: Id.nullable(),
      available: z.boolean().describe('False when the related item was deleted or is out of scope.'),
      channelsDelivered: z.array(NotificationChannel),
      readAt: IsoDateTime.nullable(),
      createdAt: IsoDateTime,
    })
    .strict(),
);
export type NotificationItem = z.infer<typeof NotificationItem>;

export const TaskItem = named(
  'TaskItem',
  z
    .object({
      id: z.string(),
      kind: z.enum([
        'approval',
        'receipt',
        'changes_requested',
        'forecast',
        'checklist',
        'reclaim',
        'sign_off',
      ]),
      title: z.string(),
      subtitle: z.string(),
      amount: Money.nullable(),
      dueAt: IsoDateTime.nullable(),
      overdue: z.boolean(),
      dueToday: z.boolean(),
      actionLabel: z.string(),
      actionLink: z.string(),
      mobileLink: z.string().nullable(),
      taskId: Id.nullable(),
      requestId: Id.nullable(),
      budgetId: Id.nullable(),
      eventId: Id.nullable(),
    })
    .strict(),
);
export type TaskItem = z.infer<typeof TaskItem>;

export const NotificationsFeed = named(
  'NotificationsFeed',
  z
    .object({
      items: z.array(NotificationItem),
      tasks: z.array(TaskItem),
      counts: z
        .object({
          unread: z.int(),
          tasks: z.int(),
          mentions: z.int(),
          following: z.int(),
        })
        .strict(),
      nextCursor: z.string().nullable(),
    })
    .strict(),
);
export type NotificationsFeed = z.infer<typeof NotificationsFeed>;

export const NotificationsQuery = CursorQuery.extend({
  tab: z.enum(['all', 'tasks', 'mentions', 'following']).optional(),
  area: NotificationArea.optional(),
  unreadOnly: z.coerce.boolean().optional(),
  periodDays: z.coerce.number().int().min(1).max(90).optional(),
}).strict();

export const MarkNotificationsRequest = named(
  'MarkNotificationsRequest',
  z
    .object({
      ids: z.array(Id).max(200).optional().describe('Omit with markAll: true to mark every item.'),
      read: z.boolean(),
      markAll: z.boolean().optional(),
    })
    .strict(),
);
export type MarkNotificationsRequest = z.infer<typeof MarkNotificationsRequest>;

export const MarkNotificationsResponse = named(
  'MarkNotificationsResponse',
  z.object({ updated: z.int(), unreadCount: z.int() }).strict(),
);

// Notification preferences and push devices (screen 059c) --------------------------------------

export const NOTIFICATION_PREFERENCE_TYPES = [
  'approval.assigned',
  'approval.escalated',
  'approval.reminder',
  'approval.decided',
  'budget.threshold_50',
  'budget.threshold_80',
  'budget.threshold_100',
  'budget.control_changed',
  'budget.allocation_received',
  'contribution.received',
  'event.invitation',
  'event.changed',
  'event.task_assigned',
  'discussion.mentioned',
  'discussion.replied',
  'discussion.followed_activity',
  'finance.receipt_needed',
  'finance.forecast_due',
  'finance.sign_off_ready',
] as const;
export const NotificationPreferenceType = z.enum(NOTIFICATION_PREFERENCE_TYPES);
export type NotificationPreferenceType = z.infer<typeof NotificationPreferenceType>;

export const NotificationMatrixRow = named(
  'NotificationMatrixRow',
  z
    .object({
      type: NotificationPreferenceType,
      area: z.enum(['approvals', 'budgets', 'events', 'discussion', 'finance']),
      label: z.string(),
      required: z.boolean(),
      inApp: z.boolean(),
      email: z.boolean(),
      push: z.boolean(),
      slack: z.boolean(),
      teams: z.boolean(),
    })
    .strict(),
);
export type NotificationMatrixRow = z.infer<typeof NotificationMatrixRow>;

export const PushDevice = named(
  'PushDevice',
  z
    .object({
      id: Id,
      deviceLabel: z.string(),
      userAgentFamily: z.string(),
      endpoint: z.string(),
      createdAt: IsoDateTime,
    })
    .strict(),
);
export type PushDevice = z.infer<typeof PushDevice>;

export const ChatAccountLinkView = named(
  'ChatAccountLinkView',
  z
    .object({
      id: Id,
      personId: Id,
      personName: z.string(),
      personRole: z.string(),
      provider: z.enum(['slack', 'teams']),
      providerUserId: z.string(),
      handle: z.string(),
      verifiedEmail: z.string(),
      linkedAt: IsoDateTime,
      lastUsedAt: IsoDateTime.nullable(),
    })
    .strict(),
);
export type ChatAccountLinkView = z.infer<typeof ChatAccountLinkView>;

export const NotificationSettingsView = named(
  'NotificationSettingsView',
  z
    .object({
      email: z.string(),
      timezone: z.string(),
      slackInstalled: z.boolean(),
      teamsInstalled: z.boolean(),
      slackLink: ChatAccountLinkView.nullable(),
      teamsLink: ChatAccountLinkView.nullable(),
      pushDevices: z.array(PushDevice),
      matrix: z.array(NotificationMatrixRow),
      digest: z
        .object({
          frequency: z.enum(['daily', 'weekly', 'off']),
          channel: z.enum(['email', 'slack', 'teams']),
          sendTime: z.string().regex(/^\d{2}:\d{2}$/),
          templateId: Id.nullable(),
          templateName: z.string(),
          bundleNonUrgent: z.boolean(),
        })
        .strict(),
      quietHours: z
        .object({
          start: z.string().regex(/^\d{2}:\d{2}$/),
          end: z.string().regex(/^\d{2}:\d{2}$/),
          companyDefaultStart: z.string().regex(/^\d{2}:\d{2}$/),
          companyDefaultEnd: z.string().regex(/^\d{2}:\d{2}$/),
          weekendQuiet: z.boolean(),
        })
        .strict(),
      privacy: z
        .object({
          showAmountsInPush: z.boolean(),
        })
        .strict(),
    })
    .strict(),
);
export type NotificationSettingsView = z.infer<typeof NotificationSettingsView>;

export const UpdateNotificationSettingsRequest = named(
  'UpdateNotificationSettingsRequest',
  z
    .object({
      matrixRow: z
        .object({
          type: NotificationPreferenceType,
          inApp: z.boolean().optional(),
          email: z.boolean().optional(),
          push: z.boolean().optional(),
          slack: z.boolean().optional(),
          teams: z.boolean().optional(),
        })
        .strict()
        .optional(),
      digest: z
        .object({
          frequency: z.enum(['daily', 'weekly', 'off']).optional(),
          channel: z.enum(['email', 'slack', 'teams']).optional(),
          sendTime: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .optional(),
          bundleNonUrgent: z.boolean().optional(),
        })
        .strict()
        .optional(),
      quietHours: z
        .object({
          start: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .optional(),
          end: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .optional(),
          weekendQuiet: z.boolean().optional(),
        })
        .strict()
        .optional(),
      privacy: z
        .object({
          showAmountsInPush: z.boolean(),
        })
        .strict()
        .optional(),
    })
    .strict(),
);
export type UpdateNotificationSettingsRequest = z.infer<typeof UpdateNotificationSettingsRequest>;

export const CreatePushDeviceRequest = named(
  'CreatePushDeviceRequest',
  z
    .object({
      deviceLabel: z.string().trim().min(1).max(120),
      userAgentFamily: z.string().trim().min(1).max(80),
      endpoint: z.string().trim().min(10).max(500),
      p256dh: z.string().trim().min(4).max(200),
      authKey: z.string().trim().min(4).max(200),
    })
    .strict(),
);
export type CreatePushDeviceRequest = z.infer<typeof CreatePushDeviceRequest>;

export const TestChannelRequest = named(
  'TestChannelRequest',
  z.object({ channel: NotificationChannel }).strict(),
);
export const TestChannelResponse = named(
  'TestChannelResponse',
  z
    .object({
      channel: NotificationChannel,
      status: z.enum(['sent', 'failed']),
      message: z.string(),
      deliveryId: Id,
    })
    .strict(),
);
export type TestChannelResponse = z.infer<typeof TestChannelResponse>;

// Comments, mentions and follow (screen 060a) --------------------------------------------------

export const DISCUSSION_ITEM_TYPES = ['budget', 'event', 'request'] as const;
export const DiscussionItemType = z.enum(DISCUSSION_ITEM_TYPES);
export type DiscussionItemType = z.infer<typeof DiscussionItemType>;

export const MentionCandidate = named(
  'MentionCandidate',
  z
    .object({
      personId: Id,
      displayName: z.string(),
      email: z.string(),
      roleLabel: z.string(),
      locationName: z.string().nullable(),
      hasAccess: z.boolean(),
      noAccessReason: z.string().nullable(),
    })
    .strict(),
);
export type MentionCandidate = z.infer<typeof MentionCandidate>;

export const CommentView = named(
  'CommentView',
  z
    .object({
      id: Id,
      itemType: DiscussionItemType,
      itemId: Id,
      parentCommentId: Id.nullable(),
      authorPersonId: Id,
      authorName: z.string(),
      authorRole: z.string(),
      body: z.string().describe('Empty when removed.'),
      mentions: z.array(z.object({ personId: Id, displayName: z.string() }).strict()),
      createdAt: IsoDateTime,
      editedAt: IsoDateTime.nullable(),
      removedAt: IsoDateTime.nullable(),
      removedByName: z.string().nullable(),
      canEdit: z.boolean(),
      canDelete: z.boolean(),
    })
    .strict(),
);
export type CommentView = z.infer<typeof CommentView>;

export const DiscussionSystemEntry = named(
  'DiscussionSystemEntry',
  z
    .object({
      id: Id,
      at: IsoDateTime,
      summary: z.string(),
      link: z.string().nullable(),
    })
    .strict(),
);

export const FollowState = named(
  'FollowState',
  z
    .object({
      following: z.boolean(),
      level: z.enum(['all', 'money_decisions']).nullable(),
      source: z.enum(['owner', 'manual']).nullable(),
    })
    .strict(),
);
export type FollowState = z.infer<typeof FollowState>;

export const DiscussionThread = named(
  'DiscussionThread',
  z
    .object({
      itemType: DiscussionItemType,
      itemId: Id,
      itemName: z.string(),
      commentCount: z.int(),
      canComment: z.boolean(),
      readOnlyReason: z.string().nullable(),
      follow: FollowState,
      comments: z.array(CommentView),
      systemEntries: z.array(DiscussionSystemEntry),
      mentionCandidates: z.array(MentionCandidate),
    })
    .strict(),
);
export type DiscussionThread = z.infer<typeof DiscussionThread>;

export const CreateCommentRequest = named(
  'CreateCommentRequest',
  z
    .object({
      body: z.string().trim().min(1).max(2000),
      parentCommentId: Id.optional(),
      mentionedPersonIds: z.array(Id).max(20).optional(),
    })
    .strict(),
);
export type CreateCommentRequest = z.infer<typeof CreateCommentRequest>;

export const UpdateCommentRequest = named(
  'UpdateCommentRequest',
  z
    .object({
      body: z.string().trim().min(1).max(2000),
      mentionedPersonIds: z.array(Id).max(20).optional(),
    })
    .strict(),
);
export type UpdateCommentRequest = z.infer<typeof UpdateCommentRequest>;

export const UpdateFollowRequest = named(
  'UpdateFollowRequest',
  z
    .object({
      following: z.boolean(),
      level: z.enum(['all', 'money_decisions']).optional(),
    })
    .strict(),
);
export type UpdateFollowRequest = z.infer<typeof UpdateFollowRequest>;

export const FollowedItemView = named(
  'FollowedItemView',
  z
    .object({
      id: Id,
      itemType: DiscussionItemType,
      itemId: Id,
      name: z.string(),
      ref: z.string().nullable(),
      status: z.string(),
      link: z.string(),
      lastActivitySummary: z.string(),
      lastActivityAt: IsoDateTime,
      level: z.enum(['all', 'money_decisions']),
      source: z.enum(['owner', 'manual']),
    })
    .strict(),
);
export type FollowedItemView = z.infer<typeof FollowedItemView>;

export const FollowedItemsList = named(
  'FollowedItemsList',
  z.object({ items: z.array(FollowedItemView) }).strict(),
);

export const FollowingQuery = z
  .object({
    itemType: DiscussionItemType.optional(),
    q: z.string().max(100).optional(),
  })
  .strict();

// Chat app setup, account linking & delivery logs (screen 061e) --------------------------------

export const CHAT_PROVIDERS = ['slack', 'teams'] as const;
export const ChatProvider = z.enum(CHAT_PROVIDERS);
export type ChatProvider = z.infer<typeof ChatProvider>;

export const CHAT_INSTALLATION_STATUSES = [
  'connected',
  'waiting_for_consent',
  'needs_attention',
  'not_connected',
] as const;
export const ChatInstallationStatus = z.enum(CHAT_INSTALLATION_STATUSES);

export const ChatFeatures = named(
  'ChatFeatures',
  z
    .object({
      approvalCards: z.boolean(),
      balanceAndQuickRequest: z.boolean(),
      alerts: z.boolean(),
      scheduledReportPosts: z.boolean(),
    })
    .strict(),
);
export type ChatFeatures = z.infer<typeof ChatFeatures>;

export const ChatInstallationView = named(
  'ChatInstallationView',
  z
    .object({
      provider: ChatProvider,
      workspaceId: z.string(),
      workspaceName: z.string(),
      status: ChatInstallationStatus,
      statusDetail: z.string().nullable(),
      features: ChatFeatures,
      allowedChannels: z.array(z.string()),
      installedByName: z.string().nullable(),
      installedAt: IsoDateTime.nullable(),
      linkedApproversCount: z.int(),
      totalApproversCount: z.int(),
      delivery24h: z
        .object({
          sent: z.int(),
          retried: z.int(),
          failed: z.int(),
        })
        .strict(),
    })
    .strict(),
);
export type ChatInstallationView = z.infer<typeof ChatInstallationView>;

export const ChannelDeliveryLogView = named(
  'ChannelDeliveryLogView',
  z
    .object({
      id: Id,
      channel: NotificationChannel,
      recipientPersonId: Id.nullable(),
      recipientName: z.string().nullable(),
      kind: z.string(),
      subjectType: z.string().nullable(),
      subjectId: Id.nullable(),
      status: z.enum(['queued', 'sent', 'updated', 'retried', 'failed']),
      attempts: z.int(),
      externalMessageId: z.string().nullable(),
      errorMessage: z.string().nullable(),
      payload: z.record(z.string(), z.unknown()),
      createdAt: IsoDateTime,
      updatedAt: IsoDateTime,
    })
    .strict(),
);
export type ChannelDeliveryLogView = z.infer<typeof ChannelDeliveryLogView>;

export const AdminChannelsView = named(
  'AdminChannelsView',
  z
    .object({
      slack: ChatInstallationView,
      teams: ChatInstallationView,
      links: z.array(ChatAccountLinkView),
      unlinkedApprovers: z.array(
        z
          .object({
            personId: Id,
            displayName: z.string(),
            email: z.string(),
            roleLabel: z.string(),
          })
          .strict(),
      ),
      deliveries: z.array(ChannelDeliveryLogView),
      canManage: z.boolean(),
    })
    .strict(),
);
export type AdminChannelsView = z.infer<typeof AdminChannelsView>;

export const UpdateChatInstallationRequest = named(
  'UpdateChatInstallationRequest',
  z
    .object({
      action: z.enum(['connect', 'configure', 'disconnect', 'check_status', 'remind_unlinked']),
      workspaceName: z.string().trim().min(1).max(120).optional(),
      features: ChatFeatures.partial().optional(),
      allowedChannels: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
      confirmText: z.string().optional(),
    })
    .strict(),
);
export type UpdateChatInstallationRequest = z.infer<typeof UpdateChatInstallationRequest>;

export const CreateChatLinkIntentRequest = named(
  'CreateChatLinkIntentRequest',
  z
    .object({
      provider: ChatProvider,
      providerUserId: z.string().trim().min(2).max(120).optional(),
      handle: z.string().trim().min(2).max(120).optional(),
      verifiedEmail: z.string().email().optional(),
    })
    .strict(),
);
export type CreateChatLinkIntentRequest = z.infer<typeof CreateChatLinkIntentRequest>;

export const ChatLinkPreview = named(
  'ChatLinkPreview',
  z
    .object({
      token: z.string(),
      provider: ChatProvider,
      providerLabel: z.string(),
      providerUserId: z.string(),
      handle: z.string(),
      chatEmail: z.string(),
      personId: Id,
      personName: z.string(),
      personEmail: z.string(),
      personRole: z.string(),
      personLocation: z.string().nullable(),
      emailMatches: z.boolean(),
      alreadyLinked: z.boolean(),
    })
    .strict(),
);
export type ChatLinkPreview = z.infer<typeof ChatLinkPreview>;

export const CompleteChatLinkRequest = named(
  'CompleteChatLinkRequest',
  z.object({ token: z.string().min(10).max(500) }).strict(),
);
export type CompleteChatLinkRequest = z.infer<typeof CompleteChatLinkRequest>;

// Slack and Teams interactive cards, commands & webhooks (screens 061b, 061c, 061d) ------------

export const ChatApprovalCardView = named(
  'ChatApprovalCardView',
  z
    .object({
      provider: ChatProvider,
      taskId: Id,
      subjectType: z.enum(['request', 'contribution']),
      subjectId: Id,
      ref: z.string(),
      title: z.string(),
      amount: Money,
      budgetAmount: Money,
      planRateNote: z.string().nullable(),
      requesterName: z.string(),
      chargeTo: z.string(),
      eventName: z.string().nullable(),
      neededBy: IsoDate.nullable(),
      purpose: z.string(),
      availableBefore: Money.nullable(),
      availableAfter: Money.nullable(),
      warning: z.string().nullable(),
      whyYou: z.string(),
      dueAt: IsoDateTime.nullable(),
      state: z.enum([
        'waiting',
        'approved',
        'rejected',
        'outside_doa',
        'hard_block',
        'request_changed',
        'decided_elsewhere',
        'not_linked',
        'read_only',
      ]),
      stateHeadline: z.string(),
      canApprove: z.boolean(),
      canReject: z.boolean(),
      stepUpUrl: z.string().nullable(),
      detailsUrl: z.string(),
      blockKit: z.record(z.string(), z.unknown()).describe('Slack Block Kit payload.'),
      adaptiveCard: z.record(z.string(), z.unknown()).describe('Microsoft Teams Adaptive Card 1.5 payload.'),
    })
    .strict(),
);
export type ChatApprovalCardView = z.infer<typeof ChatApprovalCardView>;

export const ChatWebhookInteractionRequest = named(
  'ChatWebhookInteractionRequest',
  z
    .object({
      tenantId: Id.optional(),
      providerUserId: z.string().trim().min(1).max(120),
      viewerProviderUserId: z.string().trim().min(1).max(120).optional(),
      interactionId: z.string().trim().min(4).max(160),
      kind: z.enum(['decision', 'balance', 'app_home', 'quick_request', 'card_view']),
      taskId: Id.optional(),
      decision: z.enum(['approve', 'reject']).optional(),
      reasonCode: z.string().trim().max(50).optional(),
      reason: z.string().trim().max(2000).optional(),
      budgetQuery: z.string().trim().max(120).optional(),
      quickRequest: z
        .object({
          budgetId: Id,
          amountMinor: z.int(),
          currency: z.string().regex(/^[A-Z]{3}$/),
          category: z.string().trim().min(1).max(50),
          title: z.string().trim().min(3).max(200),
          neededBy: IsoDate.optional(),
          eventId: Id.optional(),
          purpose: z.string().trim().min(3).max(2000),
          confirmSoftWarning: z.boolean().optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
);
export type ChatWebhookInteractionRequest = z.infer<typeof ChatWebhookInteractionRequest>;

export const ChatBalanceLine = named(
  'ChatBalanceLine',
  z
    .object({
      budgetId: Id,
      name: z.string(),
      status: z.string(),
      authorized: Money,
      pending: Money,
      committed: Money,
      actual: Money,
      available: Money,
      utilizationPct: z.number(),
      pausedNote: z.string().nullable(),
    })
    .strict(),
);

export const ChatWebhookResponse = named(
  'ChatWebhookResponse',
  z
    .object({
      provider: ChatProvider,
      kind: z.enum(['decision', 'balance', 'app_home', 'quick_request', 'card_view', 'not_linked', 'step_up']),
      ephemeral: z.boolean(),
      headline: z.string(),
      text: z.string(),
      card: ChatApprovalCardView.nullable(),
      decision: DecisionResponse.nullable(),
      stepUpRequired: z.boolean(),
      stepUpReason: z.string().nullable(),
      stepUpUrl: z.string().nullable(),
      balances: z.array(ChatBalanceLine).optional(),
      didYouMean: z.array(z.object({ budgetId: Id, name: z.string() }).strict()).optional(),
      waitingApprovals: z
        .array(
          z
            .object({
              taskId: Id,
              ref: z.string(),
              title: z.string(),
              amount: Money,
              dueAt: IsoDateTime.nullable(),
            })
            .strict(),
        )
        .optional(),
      myRequests: z
        .array(
          z
            .object({
              id: Id,
              ref: z.string(),
              title: z.string(),
              amount: Money,
              statusLabel: z.string(),
            })
            .strict(),
        )
        .optional(),
      softWarning: z.string().nullable().optional(),
      createdRequestRef: z.string().nullable().optional(),
      createdRequestId: Id.nullable().optional(),
    })
    .strict(),
);
export type ChatWebhookResponse = z.infer<typeof ChatWebhookResponse>;

// Role-based digest templates (screen 064a) ----------------------------------------------------

export const DigestSectionConfig = named(
  'DigestSectionConfig',
  z
    .object({
      key: z.string().min(1).max(60),
      label: z.string().min(1).max(120),
      enabled: z.boolean(),
      maxItems: z.int().min(1).max(20),
    })
    .strict(),
);
export type DigestSectionConfig = z.infer<typeof DigestSectionConfig>;

export const DigestTemplateView = named(
  'DigestTemplateView',
  z
    .object({
      id: Id,
      code: z.string(),
      name: z.string(),
      audienceRoles: z.array(RoleId),
      frequency: z.enum(['daily_weekdays', 'weekly']),
      weekday: z.int().min(1).max(7).nullable(),
      sendTime: z.string().regex(/^\d{2}:\d{2}$/),
      channelsAllowed: z.array(z.enum(['email', 'slack', 'teams'])),
      introLine: z.string(),
      sections: z.array(DigestSectionConfig),
      skipWhenEmpty: z.boolean(),
      status: z.enum(['published', 'draft_changes', 'off']),
      version: z.int(),
      recipientCount: z.int(),
      lastSentAt: IsoDateTime.nullable(),
      updatedAt: IsoDateTime,
    })
    .strict(),
);
export type DigestTemplateView = z.infer<typeof DigestTemplateView>;

export const DigestTemplateList = named(
  'DigestTemplateList',
  z.object({ items: z.array(DigestTemplateView), canManage: z.boolean() }).strict(),
);

export const UpdateDigestTemplateRequest = named(
  'UpdateDigestTemplateRequest',
  z
    .object({
      name: z.string().trim().min(3).max(120).optional(),
      audienceRoles: z.array(RoleId).min(1).optional(),
      frequency: z.enum(['daily_weekdays', 'weekly']).optional(),
      weekday: z.int().min(1).max(7).nullable().optional(),
      sendTime: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .optional(),
      channelsAllowed: z.array(z.enum(['email', 'slack', 'teams'])).min(1).optional(),
      introLine: z.string().trim().max(300).optional(),
      sections: z.array(DigestSectionConfig).min(1).optional(),
      skipWhenEmpty: z.boolean().optional(),
      status: z.enum(['published', 'draft_changes', 'off']).optional(),
      publish: z.boolean().optional(),
    })
    .strict(),
);
export type UpdateDigestTemplateRequest = z.infer<typeof UpdateDigestTemplateRequest>;

export const DigestPreviewResponse = named(
  'DigestPreviewResponse',
  z
    .object({
      templateId: Id,
      templateName: z.string(),
      recipientPersonId: Id,
      recipientName: z.string(),
      recipientTimezone: z.string(),
      nothingToReport: z.boolean(),
      subject: z.string(),
      sections: z.array(
        z
          .object({
            key: z.string(),
            title: z.string(),
            lines: z.array(z.string()),
          })
          .strict(),
      ),
      emailHtml: z.string(),
      emailText: z.string(),
      slackBlockKit: z.record(z.string(), z.unknown()),
      teamsAdaptiveCard: z.record(z.string(), z.unknown()),
    })
    .strict(),
);
export type DigestPreviewResponse = z.infer<typeof DigestPreviewResponse>;

export const RemovePushDeviceResponse = named(
  'RemovePushDeviceResponse',
  z.object({ removed: z.boolean() }).strict(),
);
export const UnlinkChatAccountResponse = named(
  'UnlinkChatAccountResponse',
  z.object({ unlinked: z.boolean() }).strict(),
);
export const ChannelDeliveryList = named(
  'ChannelDeliveryList',
  z.object({ items: z.array(ChannelDeliveryLogView) }).strict(),
);
export const SendDigestTestRequest = named(
  'SendDigestTestRequest',
  z.object({ channel: z.enum(['email', 'slack', 'teams']).optional() }).strict(),
);

// Endpoints ------------------------------------------------------------------------------------

const IdParams = z.object({ id: Id }).strict();
const DiscussionParams = z.object({ itemType: DiscussionItemType, itemId: Id }).strict();
const CommentParams = z.object({ commentId: Id }).strict();
const ProviderParams = z.object({ provider: ChatProvider }).strict();
const CardParams = z.object({ provider: ChatProvider, taskId: Id }).strict();
const TemplateParams = z.object({ templateId: Id }).strict();
const DigestPreviewQuery = z.object({ personId: Id.optional() }).strict();
const LinkTokenQuery = z.object({ token: z.string().min(10).max(500) }).strict();
const DeliveriesQuery = z
  .object({
    channel: NotificationChannel.optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export const channelEndpoints = {
  listNotifications: {
    operationId: 'listNotifications',
    method: 'get',
    path: '/api/notifications',
    summary: 'My notifications and open tasks (All, Tasks, Mentions, Following)',
    tags: ['channels'],
    auth: true,
    query: NotificationsQuery,
    response: { status: 200, schema: NotificationsFeed },
    errors: [400, 401],
  },
  markNotifications: {
    operationId: 'markNotifications',
    method: 'post',
    path: '/api/notifications/mark',
    summary: 'Mark selected or all notifications as read or unread',
    tags: ['channels'],
    auth: true,
    idempotent: true,
    body: MarkNotificationsRequest,
    response: { status: 200, schema: MarkNotificationsResponse },
    errors: [400, 401],
  },
  getNotificationSettings: {
    operationId: 'getNotificationSettings',
    method: 'get',
    path: '/api/me/notification-settings',
    summary: 'My notification channels, matrix, digest, quiet hours and push devices',
    tags: ['channels'],
    auth: true,
    response: { status: 200, schema: NotificationSettingsView },
    errors: [401],
  },
  updateNotificationSettings: {
    operationId: 'updateNotificationSettings',
    method: 'patch',
    path: '/api/me/notification-settings',
    summary: 'Save a notification channel preference, digest, quiet hours or privacy setting',
    tags: ['channels'],
    auth: true,
    idempotent: true,
    body: UpdateNotificationSettingsRequest,
    response: { status: 200, schema: NotificationSettingsView },
    errors: [400, 401, 422],
  },
  registerPushDevice: {
    operationId: 'registerPushDevice',
    method: 'post',
    path: '/api/me/push-devices',
    summary: 'Register a Web Push subscription on this device (audited)',
    tags: ['channels'],
    auth: true,
    idempotent: true,
    body: CreatePushDeviceRequest,
    response: { status: 201, schema: PushDevice },
    errors: [400, 401],
  },
  removePushDevice: {
    operationId: 'removePushDevice',
    method: 'delete',
    path: '/api/me/push-devices/{id}',
    summary: 'Remove a registered push device (audited)',
    tags: ['channels'],
    auth: true,
    idempotent: true,
    params: IdParams,
    response: { status: 200, schema: RemovePushDeviceResponse },
    errors: [401, 404],
  },
  sendTestNotification: {
    operationId: 'sendTestNotification',
    method: 'post',
    path: '/api/me/notification-settings/test',
    summary: 'Send a test notification to one of my enabled channels',
    tags: ['channels'],
    auth: true,
    idempotent: true,
    body: TestChannelRequest,
    response: { status: 200, schema: TestChannelResponse },
    errors: [400, 401, 409, 422],
  },
  getDiscussion: {
    operationId: 'getDiscussion',
    method: 'get',
    path: '/api/discussions/{itemType}/{itemId}',
    summary: 'Discussion thread, follow state and mention candidates for a budget, event or request',
    tags: ['channels'],
    auth: true,
    params: DiscussionParams,
    response: { status: 200, schema: DiscussionThread },
    errors: [401, 404],
  },
  createComment: {
    operationId: 'createComment',
    method: 'post',
    path: '/api/discussions/{itemType}/{itemId}/comments',
    summary: 'Post a comment with optional @mentions (checks read access of every mentioned person)',
    tags: ['channels'],
    auth: true,
    idempotent: true,
    params: DiscussionParams,
    body: CreateCommentRequest,
    response: { status: 201, schema: CommentView },
    errors: [400, 401, 403, 404, 409, 422],
  },
  updateComment: {
    operationId: 'updateComment',
    method: 'patch',
    path: '/api/comments/{commentId}',
    summary: 'Edit my own comment within 15 minutes (audited with original text)',
    tags: ['channels'],
    auth: true,
    idempotent: true,
    params: CommentParams,
    body: UpdateCommentRequest,
    response: { status: 200, schema: CommentView },
    errors: [400, 401, 403, 404, 409, 422],
  },
  removeComment: {
    operationId: 'removeComment',
    method: 'delete',
    path: '/api/comments/{commentId}',
    summary: 'Soft-remove my own comment (leaves a tombstone; full text stays in the audit log)',
    tags: ['channels'],
    auth: true,
    idempotent: true,
    params: CommentParams,
    response: { status: 200, schema: CommentView },
    errors: [401, 403, 404],
  },
  updateFollow: {
    operationId: 'updateFollow',
    method: 'put',
    path: '/api/discussions/{itemType}/{itemId}/follow',
    summary: 'Follow or unfollow a budget, event or request at a chosen notification level',
    tags: ['channels'],
    auth: true,
    idempotent: true,
    params: DiscussionParams,
    body: UpdateFollowRequest,
    response: { status: 200, schema: FollowState },
    errors: [400, 401, 404],
  },
  listFollowedItems: {
    operationId: 'listFollowedItems',
    method: 'get',
    path: '/api/me/following',
    summary: 'Budgets, events and requests I follow (owner or manual)',
    tags: ['channels'],
    auth: true,
    query: FollowingQuery,
    response: { status: 200, schema: FollowedItemsList },
    errors: [401],
  },
  getAdminChannels: {
    operationId: 'getAdminChannels',
    method: 'get',
    path: '/api/admin/channels',
    summary: 'Slack and Microsoft Teams installations, linked accounts and delivery health',
    tags: ['channels'],
    auth: true,
    response: { status: 200, schema: AdminChannelsView },
    errors: [401, 403],
  },
  updateChatInstallation: {
    operationId: 'updateChatInstallation',
    method: 'patch',
    path: '/api/admin/channels/{provider}',
    summary: 'Connect, configure features/channels, check consent or disconnect Slack or Teams',
    tags: ['channels'],
    auth: true,
    idempotent: true,
    params: ProviderParams,
    body: UpdateChatInstallationRequest,
    response: { status: 200, schema: ChatInstallationView },
    errors: [400, 401, 403, 422],
  },
  unlinkChatAccount: {
    operationId: 'unlinkChatAccount',
    method: 'delete',
    path: '/api/admin/channels/links/{id}',
    summary: 'Unlink a chat account (Integration Admin or the person themselves)',
    tags: ['channels'],
    auth: true,
    idempotent: true,
    params: IdParams,
    response: { status: 200, schema: UnlinkChatAccountResponse },
    errors: [401, 403, 404],
  },
  createChatLinkIntent: {
    operationId: 'createChatLinkIntent',
    method: 'post',
    path: '/api/channels/link-intent',
    summary: 'Create a signed chat account link token for the current user or a chat prompt',
    tags: ['channels'],
    auth: true,
    idempotent: true,
    body: CreateChatLinkIntentRequest,
    response: { status: 201, schema: ChatLinkPreview },
    errors: [400, 401],
  },
  previewChatLink: {
    operationId: 'previewChatLink',
    method: 'get',
    path: '/api/channels/link-preview',
    summary: 'Inspect a chat account-link token and verify email match with the signed-in user',
    tags: ['channels'],
    auth: true,
    query: LinkTokenQuery,
    response: { status: 200, schema: ChatLinkPreview },
    errors: [400, 401, 404],
  },
  completeChatLink: {
    operationId: 'completeChatLink',
    method: 'post',
    path: '/api/channels/link-complete',
    summary: 'Bind the chat account to the signed-in BudgetFlow person (requires exact email match)',
    tags: ['channels'],
    auth: true,
    idempotent: true,
    body: CompleteChatLinkRequest,
    response: { status: 200, schema: ChatAccountLinkView },
    errors: [400, 401, 404, 409, 422],
  },
  getChatApprovalCard: {
    operationId: 'getChatApprovalCard',
    method: 'get',
    path: '/api/channels/{provider}/cards/{taskId}',
    summary: 'Render the Slack Block Kit or Microsoft Teams Adaptive Card for an approval task',
    tags: ['channels'],
    auth: true,
    params: CardParams,
    response: { status: 200, schema: ChatApprovalCardView },
    errors: [401, 404],
  },
  handleChatWebhook: {
    operationId: 'handleChatWebhook',
    method: 'post',
    path: '/api/channels/webhooks/{provider}',
    summary:
      'Incoming Slack or Microsoft Teams interactive callback (HMAC + timestamp verified, DoA enforced)',
    tags: ['channels'],
    auth: false,
    params: ProviderParams,
    body: ChatWebhookInteractionRequest,
    response: { status: 200, schema: ChatWebhookResponse },
    errors: [400, 401, 403, 404, 409, 422],
  },
  listChannelDeliveries: {
    operationId: 'listChannelDeliveries',
    method: 'get',
    path: '/api/channels/deliveries',
    summary: 'Outbound channel delivery logs (Slack, Teams, email, push)',
    tags: ['channels'],
    auth: true,
    query: DeliveriesQuery,
    response: { status: 200, schema: ChannelDeliveryList },
    errors: [401],
  },
  listDigestTemplates: {
    operationId: 'listDigestTemplates',
    method: 'get',
    path: '/api/digests/templates',
    summary: 'Role-based digest templates and schedules',
    tags: ['channels'],
    auth: true,
    response: { status: 200, schema: DigestTemplateList },
    errors: [401],
  },
  getDigestTemplate: {
    operationId: 'getDigestTemplate',
    method: 'get',
    path: '/api/digests/templates/{templateId}',
    summary: 'A digest template with its sections and schedule',
    tags: ['channels'],
    auth: true,
    params: TemplateParams,
    response: { status: 200, schema: DigestTemplateView },
    errors: [401, 404],
  },
  updateDigestTemplate: {
    operationId: 'updateDigestTemplate',
    method: 'patch',
    path: '/api/digests/templates/{templateId}',
    summary: 'Edit or publish a new version of a digest template (audited)',
    tags: ['channels'],
    auth: true,
    idempotent: true,
    params: TemplateParams,
    body: UpdateDigestTemplateRequest,
    response: { status: 200, schema: DigestTemplateView },
    errors: [400, 401, 403, 404, 422],
  },
  previewDigestTemplate: {
    operationId: 'previewDigestTemplate',
    method: 'get',
    path: '/api/digests/templates/{templateId}/preview',
    summary: 'Render a live scoped digest preview (Email, Slack, Teams) for a chosen person',
    tags: ['channels'],
    auth: true,
    params: TemplateParams,
    query: DigestPreviewQuery,
    response: { status: 200, schema: DigestPreviewResponse },
    errors: [401, 404],
  },
  sendDigestTest: {
    operationId: 'sendDigestTest',
    method: 'post',
    path: '/api/digests/templates/{templateId}/test',
    summary: 'Send a test digest for this template to the signed-in user',
    tags: ['channels'],
    auth: true,
    idempotent: true,
    params: TemplateParams,
    body: SendDigestTestRequest,
    response: { status: 200, schema: TestChannelResponse },
    errors: [400, 401, 404],
  },
} as const satisfies Record<string, Endpoint>;
