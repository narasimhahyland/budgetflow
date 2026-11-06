import { ApprovalsService, budgetResourceOf, personNames, systemActor } from '@bf/api/approvals';
import { AuditService } from '@bf/api/audit';
import { BudgetViews } from '@bf/api/budgets';
import {
  ActorResolver,
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  type CommandResult,
  type RequestActor,
} from '@bf/api/core';
import {
  accruals,
  actuals,
  approvalDelegations,
  approvalTasks,
  budgets,
  channelDeliveries,
  chatAccountLinks,
  chatInstallations,
  comments,
  contributionRequests,
  digests,
  documents,
  eventCoOrganizers,
  eventParticipants,
  events,
  follows,
  glTieoutRuns,
  memberships,
  notificationPreferences,
  notifications,
  orgUnits,
  outboxMessages,
  people,
  pushSubscriptions,
  rechargeSchedules,
  requests,
  roleGrants,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import { DocumentsService } from '@bf/api/documents';
import { formatMoney, noticeEmail, NotificationsService } from '@bf/api/notifications';
import { RequestsService } from '@bf/api/spend';
import { AnalyticsService } from '@bf/api/tenancy';
import type {
  AdminChannelsView,
  ChannelDeliveryLogView,
  ChatAccountLinkView,
  ChatApprovalCardView,
  ChatFeatures,
  ChatInstallationView,
  ChatLinkPreview,
  ChatProvider,
  ChatWebhookInteractionRequest,
  ChatWebhookResponse,
  CommentView,
  CompleteChatLinkRequest,
  CreateChatLinkIntentRequest,
  CreateCommentRequest,
  CreatePushDeviceRequest,
  DigestPreviewResponse,
  DigestSectionConfig,
  DigestTemplateView,
  DiscussionItemType,
  DiscussionThread,
  FollowedItemView,
  FollowState,
  MarkNotificationsRequest,
  MentionCandidate,
  NotificationChannel,
  NotificationItem,
  NotificationsFeed,
  NotificationSettingsView,
  ProblemCode,
  PushDevice,
  RoleId,
  TaskItem,
  TestChannelResponse,
  UpdateChatInstallationRequest,
  UpdateCommentRequest,
  UpdateDigestTemplateRequest,
  UpdateFollowRequest,
  UpdateNotificationSettingsRequest,
} from '@bf/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  buildSlackApprovalBlockKit,
  buildTeamsApprovalAdaptiveCard,
  formatMoneyTripletNote,
  signChatLinkToken,
  verifyChatLinkToken,
  verifyChatWebhookSignature,
} from './chat-adapters';
import {
  buildMatrixRows,
  COMPANY_QUIET_END,
  COMPANY_QUIET_START,
  DEFAULT_DIGEST_TEMPLATES,
  isQuietHoursValid,
  NOTIFICATION_MATRIX_SPECS,
} from './defaults';

export const CHANNEL_DELIVER_TOPIC = 'channel.deliver';

const ROLE_LABELS: Record<string, string> = {
  'super-admin': 'Super admin',
  'org-admin': 'Organization admin',
  ceo: 'CEO',
  'finance-admin': 'Finance admin',
  'finance-controller': 'Finance controller',
  'budget-owner': 'Budget owner',
  'department-head': 'Department head',
  'regional-manager': 'Regional manager',
  'location-manager': 'Location manager',
  'event-organizer': 'Event organizer',
  employee: 'Employee',
  auditor: 'Auditor',
  'integration-admin': 'Integration admin',
  analyst: 'Read-only analyst',
};

const EDIT_WINDOW_MS = 15 * 60 * 1000;
const CLOSED_THREAD_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const ARCHIVE_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const DELIVERY_WINDOW_MS = 24 * 60 * 60 * 1000;
const STEP_UP_THRESHOLD_MINOR = 2_500_000; // USD 25,000.00 requires web app step-up

export interface ChannelDeliverJob {
  tenantId: string;
  kind: string;
  recipientPersonId: string;
  taskId?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  subjectRef?: string | null;
  commentId?: string | null;
  title: string;
  detail: string;
  tone?: 'neutral' | 'info' | 'warning' | 'important' | 'success';
  amountMinor?: number | null;
  currency?: string | null;
  createdAtIso?: string | null;
}

@Injectable()
export class ChannelsService {
  private readonly log = new Logger('Channels');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly actors: ActorResolver,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly requests: RequestsService,
    private readonly budgetViews: BudgetViews,
    private readonly documents: DocumentsService,
    private readonly notifications: NotificationsService,
    private readonly analytics: AnalyticsService,
  ) {}

  // 123 Notifications and tasks -----------------------------------------------------------------

  private itemLink(
    itemType: string | null,
    itemId: string | null,
    commentId: string | null,
  ): string | null {
    if (!itemType || !itemId) return null;
    const suffix = commentId ? `?discussion=open#comment-${commentId}` : '';
    if (itemType === 'budget') return `/budgets/${itemId}${suffix}`;
    if (itemType === 'event') return `/events/${itemId}${suffix}`;
    if (itemType === 'request') return `/requests/${itemId}${suffix}`;
    if (itemType === 'contribution') return `/contributions/${itemId}`;
    return null;
  }

  private async isItemAvailable(
    tx: Tx,
    actor: RequestActor,
    itemType: string | null,
    itemId: string | null,
  ): Promise<boolean> {
    if (!itemType || !itemId) return true;
    if (itemType === 'budget') {
      const [b] = await tx.select().from(budgets).where(eq(budgets.id, itemId));
      return Boolean(b && this.policy.can(actor, 'budget.read', budgetResourceOf(b)).allowed);
    }
    if (itemType === 'event') {
      const [e] = await tx.select().from(events).where(eq(events.id, itemId));
      if (!e) return false;
      if (e.organizerPersonId === actor.personId) return true;
      if (
        this.policy.can(actor, 'budget.read', {
          kind: 'budget',
          tenantId: actor.tenantId,
          id: '',
          path: '/',
        }).allowed
      )
        return true;
      if (e.budgetId) {
        const [b] = await tx.select().from(budgets).where(eq(budgets.id, e.budgetId));
        if (b && this.policy.can(actor, 'budget.read', budgetResourceOf(b)).allowed) return true;
      }
      if (actor.personId) {
        const [p] = await tx
          .select({ id: eventParticipants.id })
          .from(eventParticipants)
          .where(
            and(
              eq(eventParticipants.eventId, itemId),
              eq(eventParticipants.personId, actor.personId),
            ),
          );
        if (p) return true;
      }
      return false;
    }
    if (itemType === 'request') {
      const [r] = await tx.select().from(requests).where(eq(requests.id, itemId));
      if (!r) return false;
      if (r.requesterPersonId === actor.personId) return true;
      if (r.budgetId) {
        const [b] = await tx.select().from(budgets).where(eq(budgets.id, r.budgetId));
        if (b && this.policy.can(actor, 'budget.read', budgetResourceOf(b)).allowed) return true;
      }
      return Boolean(await this.approvals.myTask(tx, actor, 'request', itemId));
    }
    if (itemType === 'contribution') {
      const [c] = await tx
        .select()
        .from(contributionRequests)
        .where(eq(contributionRequests.id, itemId));
      if (!c) return false;
      if (c.requesterPersonId === actor.personId) return true;
      const [b] = await tx.select().from(budgets).where(eq(budgets.id, c.giverBudgetId));
      if (b && this.policy.can(actor, 'budget.read', budgetResourceOf(b)).allowed) return true;
      return Boolean(await this.approvals.myTask(tx, actor, 'contribution', itemId));
    }
    return true;
  }

  private async deriveTasks(tx: Tx, actor: RequestActor): Promise<TaskItem[]> {
    if (!actor.personId) return [];
    const out: TaskItem[] = [];
    const now = Date.now();
    const todayStr = new Date(now).toISOString().slice(0, 10);

    // 1. Open approval tasks (assigned or delegated)
    const inbox = await this.approvals.inbox(actor, 'assigned', 25);
    const delegated = await this.approvals.inbox(actor, 'delegated', 25);
    for (const t of [...inbox.items, ...delegated.items]) {
      const dueMs = t.dueAt ? new Date(t.dueAt).getTime() : null;
      const overdue = dueMs !== null && dueMs < now;
      const dueToday = t.dueAt ? t.dueAt.slice(0, 10) === todayStr : false;
      out.push({
        id: `approval:${t.taskId}`,
        kind: 'approval',
        title: `Approve ${t.ref} ${t.title}, ${formatMoney(t.amount)}`,
        subtitle: `${t.requesterName} · ${t.budgetName}${t.delegatedFromName ? ` · For ${t.delegatedFromName}` : ''}`,
        amount: t.amount,
        dueAt: t.dueAt,
        overdue,
        dueToday,
        actionLabel: 'Review',
        actionLink: `/approvals?task=${t.taskId}`,
        mobileLink: `/m/approvals/${t.taskId}`,
        taskId: t.taskId,
        requestId: t.subjectType === 'request' ? t.subjectId : null,
        budgetId: t.budgetId,
        eventId: null,
      });
    }

    // 2. Approved spending requests of mine that still have no verified receipt
    const myApproved = await tx
      .select()
      .from(requests)
      .where(
        and(
          eq(requests.requesterPersonId, actor.personId),
          eq(requests.kind, 'spending'),
          inArray(requests.status, ['approved', 'partially_approved']),
        ),
      )
      .orderBy(desc(requests.decidedAt));
    if (myApproved.length) {
      const docs = await tx
        .select({ ownerId: documents.ownerId })
        .from(documents)
        .where(
          and(
            eq(documents.ownerType, 'request'),
            inArray(
              documents.ownerId,
              myApproved.map((r) => r.id),
            ),
            eq(documents.status, 'verified'),
          ),
        );
      const hasReceipt = new Set(docs.map((d) => d.ownerId));
      for (const r of myApproved) {
        if (hasReceipt.has(r.id)) continue;
        const dueDate = r.neededBy
          ? `${r.neededBy}T18:00:00.000Z`
          : new Date(r.createdAt.getTime() + 14 * 86400_000).toISOString();
        const overdue = new Date(dueDate).getTime() < now;
        out.push({
          id: `receipt:${r.id}`,
          kind: 'receipt',
          title: `Upload receipt for ${r.ref} ${r.title}`,
          subtitle: `Approved ${formatMoney({ amountMinor: r.approvedMinor ?? r.amountMinor, currency: r.currency })}`,
          amount: { amountMinor: r.approvedMinor ?? r.amountMinor, currency: r.currency },
          dueAt: dueDate,
          overdue,
          dueToday: dueDate.slice(0, 10) === todayStr,
          actionLabel: 'Upload',
          actionLink: `/requests/upload?request=${r.id}`,
          mobileLink: `/m/receipt?request=${r.id}`,
          taskId: null,
          requestId: r.id,
          budgetId: r.budgetId,
          eventId: r.eventId,
        });
      }
    }

    // 3. Requests where changes were requested
    const changesAsked = await tx
      .select()
      .from(requests)
      .where(
        and(
          eq(requests.requesterPersonId, actor.personId),
          eq(requests.status, 'changes_requested'),
        ),
      );
    for (const r of changesAsked) {
      out.push({
        id: `changes:${r.id}`,
        kind: 'changes_requested',
        title: `Update and resubmit ${r.ref} ${r.title}`,
        subtitle: r.decisionReason ?? 'Changes requested by approver',
        amount: { amountMinor: r.amountMinor, currency: r.currency },
        dueAt: null,
        overdue: false,
        dueToday: false,
        actionLabel: 'Resubmit',
        actionLink: `/requests/${r.id}`,
        mobileLink: `/requests/${r.id}`,
        taskId: null,
        requestId: r.id,
        budgetId: r.budgetId,
        eventId: r.eventId,
      });
    }

    return out.sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
      if (a.dueAt) return -1;
      if (b.dueAt) return 1;
      return a.id.localeCompare(b.id);
    });
  }

  listNotifications(
    actor: RequestActor,
    q: {
      tab?: 'all' | 'tasks' | 'mentions' | 'following';
      area?: string;
      unreadOnly?: boolean;
      periodDays?: number;
      limit?: number;
    },
  ): Promise<NotificationsFeed> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      if (!actor.personId) {
        return {
          items: [],
          tasks: [],
          counts: { unread: 0, tasks: 0, mentions: 0, following: 0 },
          nextCursor: null,
        };
      }
      const cutoff = new Date(Date.now() - Math.min(q.periodDays ?? 90, 90) * 24 * 60 * 60 * 1000);
      const archiveCutoff = new Date(Date.now() - ARCHIVE_DAYS_MS);
      const allRows = await tx
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.recipientPersonId, actor.personId),
            gte(notifications.createdAt, archiveCutoff),
          ),
        )
        // Id breaks ties so notifications created in the same transaction keep a stable order.
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(200);

      const tasks = await this.deriveTasks(tx, actor);
      const unreadCount = allRows.filter((n) => !n.readAt).length;
      const mentionsCount = allRows.filter((n) => n.type === 'discussion.mentioned').length;
      const followingCount = allRows.filter(
        (n) => n.type === 'discussion.followed_activity',
      ).length;

      let filtered = allRows.filter((n) => n.createdAt >= cutoff);
      if (q.tab === 'mentions') {
        filtered = filtered.filter((n) => n.type === 'discussion.mentioned');
      } else if (q.tab === 'following') {
        filtered = filtered.filter((n) => n.type === 'discussion.followed_activity');
      }
      if (q.area) filtered = filtered.filter((n) => n.area === q.area);
      if (q.unreadOnly) filtered = filtered.filter((n) => !n.readAt);

      const items: NotificationItem[] = [];
      for (const r of filtered.slice(0, q.limit ?? 50)) {
        const available = await this.isItemAvailable(tx, actor, r.itemType, r.itemId);
        items.push({
          id: r.id,
          area: r.area as NotificationItem['area'],
          type: r.type,
          tone: r.tone as NotificationItem['tone'],
          title: r.title,
          detail: available ? r.detail : 'No longer available',
          itemType: (r.itemType as NotificationItem['itemType']) ?? null,
          itemId: r.itemId,
          itemRef: r.itemRef,
          itemLink: available ? this.itemLink(r.itemType, r.itemId, r.commentId) : null,
          commentId: r.commentId,
          available,
          channelsDelivered: (r.channelsDelivered ?? ['in_app']) as NotificationChannel[],
          readAt: r.readAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
        });
      }

      return {
        items,
        tasks,
        counts: {
          unread: unreadCount,
          tasks: tasks.length,
          mentions: mentionsCount,
          following: followingCount,
        },
        nextCursor: null,
      };
    });
  }

  markNotifications(
    actor: RequestActor,
    req: MarkNotificationsRequest,
    ctx: { idempotencyKey: string; requestId: string | null },
  ): Promise<CommandResult<{ updated: number; unreadCount: number }>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'notifications.mark',
        request: req,
        status: 200,
      },
      async (tx) => {
        if (!actor.personId) return { updated: 0, unreadCount: 0 };
        const readAt = req.read ? new Date() : null;
        let updatedRows: { id: string }[] = [];
        if (req.markAll) {
          updatedRows = await tx
            .update(notifications)
            .set({ readAt })
            .where(eq(notifications.recipientPersonId, actor.personId))
            .returning({ id: notifications.id });
        } else if (req.ids?.length) {
          updatedRows = await tx
            .update(notifications)
            .set({ readAt })
            .where(
              and(
                eq(notifications.recipientPersonId, actor.personId),
                inArray(notifications.id, req.ids),
              ),
            )
            .returning({ id: notifications.id });
        }
        const unread = await tx
          .select({ n: sql<number>`count(*)` })
          .from(notifications)
          .where(
            and(eq(notifications.recipientPersonId, actor.personId), isNull(notifications.readAt)),
          );
        return {
          updated: updatedRows.length,
          unreadCount: Number(unread[0]?.n ?? 0),
        };
      },
    );
  }

  // 059c Notification channels and push settings -------------------------------------------------

  private async ensureDefaultDigestsTx(tx: Tx, tenantId: string): Promise<void> {
    const existing = await tx.select({ code: digests.code }).from(digests);
    if (existing.length >= DEFAULT_DIGEST_TEMPLATES.length) return;
    const have = new Set(existing.map((e) => e.code));
    const missing = DEFAULT_DIGEST_TEMPLATES.filter((d) => !have.has(d.code));
    if (!missing.length) return;
    await tx
      .insert(digests)
      .values(
        missing.map((d) => ({
          tenantId,
          code: d.code,
          name: d.name,
          audienceRoles: d.audienceRoles,
          frequency: d.frequency,
          weekday: d.weekday,
          sendTime: d.sendTime,
          channelsAllowed: d.channelsAllowed,
          introLine: d.introLine,
          sections: d.sections,
          skipWhenEmpty: true,
          status: 'published',
          version: 1,
        })),
      )
      .onConflictDoNothing();
  }

  private async settingsTx(tx: Tx, actor: RequestActor): Promise<NotificationSettingsView> {
    if (!actor.personId) {
      throw ApiProblem.forbidden('Only people have notification settings.');
    }
    await this.ensureDefaultDigestsTx(tx, actor.tenantId);
    const [person] = await tx.select().from(people).where(eq(people.id, actor.personId));
    const [pref] = await tx
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.personId, actor.personId));
    const installs = await tx.select().from(chatInstallations);
    const slackInstall = installs.find((i) => i.provider === 'slack');
    const teamsInstall = installs.find((i) => i.provider === 'teams');
    const slackInstalled = slackInstall?.status === 'connected';
    const teamsInstalled = teamsInstall?.status === 'connected';

    const links = await tx
      .select()
      .from(chatAccountLinks)
      .where(eq(chatAccountLinks.personId, actor.personId));
    const roleLabel = actor.roles.map((r) => ROLE_LABELS[r] ?? r).join(', ');
    const toLinkView = (
      l: typeof chatAccountLinks.$inferSelect | undefined,
    ): ChatAccountLinkView | null =>
      l
        ? {
            id: l.id,
            personId: l.personId,
            personName: actor.displayName,
            personRole: roleLabel,
            provider: l.provider as 'slack' | 'teams',
            providerUserId: l.providerUserId,
            handle: l.handle,
            verifiedEmail: l.verifiedEmail,
            linkedAt: l.linkedAt.toISOString(),
            lastUsedAt: l.lastUsedAt?.toISOString() ?? null,
          }
        : null;
    const slackLink = toLinkView(links.find((l) => l.provider === 'slack'));
    const teamsLink = toLinkView(links.find((l) => l.provider === 'teams'));

    const devices = await tx
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.personId, actor.personId))
      .orderBy(desc(pushSubscriptions.createdAt));

    const allTemplates = await tx.select().from(digests).orderBy(asc(digests.createdAt));
    const defaultTemplate =
      allTemplates.find((d) => actor.roles.some((r) => (d.audienceRoles ?? []).includes(r))) ??
      allTemplates[0];
    const selectedTemplate =
      (pref?.digestTemplateId
        ? allTemplates.find((d) => d.id === pref.digestTemplateId)
        : undefined) ?? defaultTemplate;

    const storedMatrix = (pref?.matrix ?? {}) as Record<
      string,
      { inApp?: boolean; email?: boolean; push?: boolean; slack?: boolean; teams?: boolean }
    >;

    return {
      email: person?.email ?? `${actor.subject}@example.test`,
      timezone: person?.timezone ?? 'America/New_York',
      slackInstalled,
      teamsInstalled,
      slackLink,
      teamsLink,
      pushDevices: devices.map((d) => ({
        id: d.id,
        deviceLabel: d.deviceLabel,
        userAgentFamily: d.userAgentFamily,
        endpoint: d.endpoint,
        createdAt: d.createdAt.toISOString(),
      })),
      matrix: buildMatrixRows(storedMatrix, Boolean(slackLink), Boolean(teamsLink)),
      digest: {
        frequency: (pref?.digestFrequency as 'daily' | 'weekly' | 'off') ?? 'daily',
        channel: (pref?.digestChannel as 'email' | 'slack' | 'teams') ?? 'email',
        sendTime: pref?.digestSendTime ?? '08:30',
        templateId: selectedTemplate?.id ?? null,
        templateName: selectedTemplate?.name ?? 'Approver daily digest',
        bundleNonUrgent: pref?.bundleNonUrgent ?? false,
      },
      quietHours: {
        start: pref?.quietStart ?? COMPANY_QUIET_START,
        end: pref?.quietEnd ?? COMPANY_QUIET_END,
        companyDefaultStart: COMPANY_QUIET_START,
        companyDefaultEnd: COMPANY_QUIET_END,
        weekendQuiet: pref?.weekendQuiet ?? true,
      },
      privacy: {
        showAmountsInPush: pref?.showAmountsInPush ?? false,
      },
    };
  }

  getNotificationSettings(actor: RequestActor): Promise<NotificationSettingsView> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) =>
      this.settingsTx(tx, actor),
    );
  }

  updateNotificationSettings(
    actor: RequestActor,
    req: UpdateNotificationSettingsRequest,
    ctx: { idempotencyKey: string; requestId: string | null },
  ): Promise<CommandResult<NotificationSettingsView>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'notifications.settings.update',
        request: req,
        status: 200,
      },
      async (tx) => {
        if (!actor.personId) throw ApiProblem.forbidden();
        const [existing] = await tx
          .select()
          .from(notificationPreferences)
          .where(eq(notificationPreferences.personId, actor.personId));
        const matrix = {
          ...((existing?.matrix ?? {}) as Record<string, Record<string, boolean>>),
        };

        if (req.matrixRow) {
          const rowInput = req.matrixRow;
          const spec = NOTIFICATION_MATRIX_SPECS.find((s) => s.type === rowInput.type);
          if (!spec) {
            throw new ApiProblem(400, 'VALIDATION_FAILED', 'Unknown notification preference type.');
          }
          if (spec.required && (rowInput.inApp === false || rowInput.email === false)) {
            throw new ApiProblem(
              422,
              'NOTIFICATION_REQUIRED',
              `${spec.label} is required: you need in-app and email alerts to act on time.`,
            );
          }
          matrix[spec.type] = {
            ...(matrix[spec.type] ?? {}),
            ...(rowInput.inApp !== undefined ? { inApp: rowInput.inApp } : {}),
            ...(rowInput.email !== undefined ? { email: rowInput.email } : {}),
            ...(rowInput.push !== undefined ? { push: rowInput.push } : {}),
            ...(rowInput.slack !== undefined ? { slack: rowInput.slack } : {}),
            ...(rowInput.teams !== undefined ? { teams: rowInput.teams } : {}),
          };
        }

        const quietStart = req.quietHours?.start ?? existing?.quietStart ?? COMPANY_QUIET_START;
        const quietEnd = req.quietHours?.end ?? existing?.quietEnd ?? COMPANY_QUIET_END;
        if (!isQuietHoursValid(quietStart, quietEnd)) {
          throw new ApiProblem(
            422,
            'QUIET_HOURS_INVALID',
            `Quiet hours can extend the company window (${COMPANY_QUIET_START} to ${COMPANY_QUIET_END}), not shorten it.`,
          );
        }

        const values = {
          tenantId: actor.tenantId,
          personId: actor.personId,
          matrix,
          digestFrequency: req.digest?.frequency ?? existing?.digestFrequency ?? 'daily',
          digestChannel: req.digest?.channel ?? existing?.digestChannel ?? 'email',
          digestSendTime: req.digest?.sendTime ?? existing?.digestSendTime ?? '08:30',
          bundleNonUrgent: req.digest?.bundleNonUrgent ?? existing?.bundleNonUrgent ?? false,
          quietStart,
          quietEnd,
          weekendQuiet: req.quietHours?.weekendQuiet ?? existing?.weekendQuiet ?? true,
          showAmountsInPush: req.privacy?.showAmountsInPush ?? existing?.showAmountsInPush ?? false,
          updatedAt: new Date(),
        };

        if (existing) {
          await tx
            .update(notificationPreferences)
            .set(values)
            .where(eq(notificationPreferences.id, existing.id));
        } else {
          await tx.insert(notificationPreferences).values(values);
        }

        await this.analytics.track(tx, actor, 'notification.preferences_updated', {
          hasMatrixRow: Boolean(req.matrixRow),
          hasDigest: Boolean(req.digest),
          hasQuietHours: Boolean(req.quietHours),
        });
        return this.settingsTx(tx, actor);
      },
    );
  }

  registerPushDevice(
    actor: RequestActor,
    req: CreatePushDeviceRequest,
    ctx: { idempotencyKey: string; requestId: string | null },
  ): Promise<CommandResult<PushDevice>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'notifications.push.register',
        request: req,
        status: 201,
      },
      async (tx) => {
        if (!actor.personId) throw ApiProblem.forbidden();
        const [d] = await tx
          .insert(pushSubscriptions)
          .values({
            tenantId: actor.tenantId,
            personId: actor.personId,
            deviceLabel: req.deviceLabel,
            userAgentFamily: req.userAgentFamily,
            endpoint: req.endpoint,
            p256dh: req.p256dh,
            authKey: req.authKey,
          })
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'channel.push_device_added',
          resourceType: 'push_subscription',
          resourceId: d.id,
          requestId: ctx.requestId,
          changes: {
            deviceLabel: { from: null, to: d.deviceLabel },
            userAgentFamily: { from: null, to: d.userAgentFamily },
          },
        });
        return {
          id: d.id,
          deviceLabel: d.deviceLabel,
          userAgentFamily: d.userAgentFamily,
          endpoint: d.endpoint,
          createdAt: d.createdAt.toISOString(),
        };
      },
    );
  }

  removePushDevice(
    actor: RequestActor,
    id: string,
    ctx: { idempotencyKey: string; requestId: string | null },
  ): Promise<CommandResult<{ removed: boolean }>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `notifications.push.remove:${id}`,
        request: {},
        status: 200,
      },
      async (tx) => {
        if (!actor.personId) throw ApiProblem.forbidden();
        const [d] = await tx
          .select()
          .from(pushSubscriptions)
          .where(and(eq(pushSubscriptions.id, id), eq(pushSubscriptions.personId, actor.personId)));
        if (!d) throw ApiProblem.notFound('push device');
        await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'channel.push_device_removed',
          resourceType: 'push_subscription',
          resourceId: d.id,
          requestId: ctx.requestId,
          changes: {
            deviceLabel: { from: d.deviceLabel, to: null },
          },
        });
        return { removed: true };
      },
    );
  }

  sendTestNotification(
    actor: RequestActor,
    channel: NotificationChannel,
    ctx: { idempotencyKey: string; requestId: string | null },
  ): Promise<CommandResult<TestChannelResponse>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `notifications.test:${channel}`,
        request: { channel },
        status: 200,
      },
      async (tx) => {
        if (!actor.personId) throw ApiProblem.forbidden();
        if (channel === 'slack' || channel === 'teams') {
          const [link] = await tx
            .select()
            .from(chatAccountLinks)
            .where(
              and(
                eq(chatAccountLinks.personId, actor.personId),
                eq(chatAccountLinks.provider, channel),
              ),
            );
          if (!link) {
            throw new ApiProblem(
              409,
              'CHAT_ACCOUNT_NOT_LINKED',
              `Your ${channel === 'slack' ? 'Slack' : 'Microsoft Teams'} account is not linked yet.`,
            );
          }
        }
        if (channel === 'email') {
          const recipient = await this.notifications.personEmail(tx, actor.personId);
          if (recipient) {
            await this.notifications.queueEmail(
              tx,
              actor.tenantId,
              recipient,
              noticeEmail({
                firstName: recipient.firstName,
                subject: 'BudgetFlow test notification',
                headline: 'Your email channel in BudgetFlow is working.',
                lines: [
                  ['Channel', 'Email'],
                  ['Recipient', recipient.email],
                ],
                detailsUrl: `${this.notifications.webBaseUrl}/me/notifications`,
              }),
              'channel.test',
            );
          }
        }
        await tx.insert(notifications).values({
          tenantId: actor.tenantId,
          recipientPersonId: actor.personId,
          area: 'approvals',
          type: 'channel.test',
          tone: 'info',
          title: `Test notification (${channel.replace('_', '-')})`,
          detail: 'Sent from your notification settings.',
          channelsDelivered: [channel],
        });
        const [delivery] = await tx
          .insert(channelDeliveries)
          .values({
            tenantId: actor.tenantId,
            channel,
            recipientPersonId: actor.personId,
            kind: 'channel.test',
            status: 'sent',
            attempts: 1,
            externalMessageId: `${channel}-test-${randomUUID().slice(0, 8)}`,
            payload: { title: 'BudgetFlow test notification', channel },
          })
          .returning();
        const label =
          channel === 'slack'
            ? 'Slack'
            : channel === 'teams'
              ? 'Microsoft Teams'
              : channel === 'push'
                ? 'push on this device'
                : channel === 'email'
                  ? 'your email'
                  : 'in-app notifications';
        return {
          channel,
          status: 'sent',
          message: `Test sent to ${label}`,
          deliveryId: delivery.id,
        };
      },
    );
  }

  // 060a Comments, mentions, follow and watch ----------------------------------------------------

  private async resolveDiscussionItem(
    tx: Tx,
    actor: RequestActor,
    itemType: DiscussionItemType,
    itemId: string,
  ): Promise<{
    name: string;
    ref: string | null;
    status: string;
    closedAt: Date | null;
    isAutoFollower: boolean;
  }> {
    if (itemType === 'budget') {
      const [b] = await tx.select().from(budgets).where(eq(budgets.id, itemId));
      if (!b || !this.policy.can(actor, 'budget.read', budgetResourceOf(b)).allowed) {
        throw ApiProblem.notFound('budget');
      }
      return {
        name: b.name,
        ref: b.code,
        status: b.status,
        closedAt: null,
        isAutoFollower: Boolean(actor.personId && b.ownerPersonId === actor.personId),
      };
    }
    if (itemType === 'event') {
      const [e] = await tx.select().from(events).where(eq(events.id, itemId));
      if (!e || !(await this.isItemAvailable(tx, actor, 'event', itemId))) {
        throw ApiProblem.notFound('event');
      }
      const co = actor.personId
        ? await tx
            .select({ p: eventCoOrganizers.personId })
            .from(eventCoOrganizers)
            .where(
              and(
                eq(eventCoOrganizers.eventId, itemId),
                eq(eventCoOrganizers.personId, actor.personId),
              ),
            )
        : [];
      return {
        name: e.name,
        ref: e.eventCode,
        status: e.status,
        closedAt: e.closedAt,
        isAutoFollower: Boolean(
          actor.personId && (e.organizerPersonId === actor.personId || co.length > 0),
        ),
      };
    }
    const [r] = await tx.select().from(requests).where(eq(requests.id, itemId));
    if (!r || !(await this.isItemAvailable(tx, actor, 'request', itemId))) {
      throw ApiProblem.notFound('request');
    }
    const myTask = await this.approvals.myTask(tx, actor, 'request', itemId);
    return {
      name: `${r.ref} · ${r.title}`,
      ref: r.ref,
      status: r.status,
      closedAt: r.decidedAt,
      isAutoFollower: Boolean(actor.personId && (r.requesterPersonId === actor.personId || myTask)),
    };
  }

  private async canPersonReadItem(
    tx: Tx,
    tenantId: string,
    personId: string,
    itemType: DiscussionItemType,
    itemId: string,
  ): Promise<boolean> {
    const [m] = await tx
      .select({ subject: memberships.idpSubject })
      .from(memberships)
      .where(and(eq(memberships.personId, personId), eq(memberships.status, 'active')));
    if (!m) return false;
    try {
      const targetActor = await this.actors.resolve(m.subject, tenantId, undefined);
      return await this.isItemAvailable(tx, targetActor, itemType, itemId);
    } catch {
      return false;
    }
  }

  private canRoleComment(actor: RequestActor): { allowed: boolean; reason: string | null } {
    const readOnlyOnly =
      actor.roles.length > 0 && actor.roles.every((r) => r === 'auditor' || r === 'analyst');
    if (readOnlyOnly) {
      return {
        allowed: false,
        reason: actor.roles.includes('auditor')
          ? 'Auditors can read the discussion'
          : 'Analysts can read the discussion',
      };
    }
    if (!actor.personId) {
      return { allowed: false, reason: 'Platform operators cannot post comments' };
    }
    return { allowed: true, reason: null };
  }

  private async commentViews(
    tx: Tx,
    rows: (typeof comments.$inferSelect)[],
    viewerPersonId: string | null,
  ): Promise<CommentView[]> {
    if (!rows.length) return [];
    const personIds = [
      ...new Set(
        rows
          .flatMap((r) => [r.authorPersonId, r.removedByPersonId, ...(r.mentions ?? [])])
          .filter((x): x is string => Boolean(x)),
      ),
    ];
    const pRows = personIds.length
      ? await tx
          .select({ id: people.id, name: people.displayName, title: people.jobTitle })
          .from(people)
          .where(inArray(people.id, personIds))
      : [];
    const byId = new Map(pRows.map((p) => [p.id, p]));
    const now = Date.now();
    return rows.map((r) => {
      const author = byId.get(r.authorPersonId);
      const isMine = viewerPersonId !== null && r.authorPersonId === viewerPersonId;
      const withinWindow = now - r.createdAt.getTime() <= EDIT_WINDOW_MS;
      const removed = Boolean(r.removedAt);
      return {
        id: r.id,
        itemType: r.itemType as DiscussionItemType,
        itemId: r.itemId,
        parentCommentId: r.parentCommentId,
        authorPersonId: r.authorPersonId,
        authorName: author?.name ?? 'User',
        authorRole: author?.title ?? 'Member',
        body: removed ? '' : r.body,
        mentions: (r.mentions ?? []).map((id) => ({
          personId: id,
          displayName: byId.get(id)?.name ?? 'User',
        })),
        createdAt: r.createdAt.toISOString(),
        editedAt: r.editedAt?.toISOString() ?? null,
        removedAt: r.removedAt?.toISOString() ?? null,
        removedByName: r.removedByPersonId ? (byId.get(r.removedByPersonId)?.name ?? null) : null,
        canEdit: isMine && !removed && withinWindow,
        canDelete: isMine && !removed,
      };
    });
  }

  private async followStateOf(
    tx: Tx,
    personId: string | null,
    itemType: DiscussionItemType,
    itemId: string,
    isAutoFollower: boolean,
  ): Promise<FollowState> {
    if (!personId) return { following: false, level: null, source: null };
    const [row] = await tx
      .select()
      .from(follows)
      .where(
        and(
          eq(follows.personId, personId),
          eq(follows.itemType, itemType),
          eq(follows.itemId, itemId),
        ),
      );
    if (row) {
      return {
        following: true,
        level: row.level as 'all' | 'money_decisions',
        source: row.source as 'owner' | 'manual',
      };
    }
    if (isAutoFollower) {
      return {
        following: true,
        level: 'all',
        source: 'owner',
      };
    }
    return { following: false, level: null, source: null };
  }

  getDiscussion(
    actor: RequestActor,
    itemType: DiscussionItemType,
    itemId: string,
  ): Promise<DiscussionThread> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const item = await this.resolveDiscussionItem(tx, actor, itemType, itemId);
      const rows = await tx
        .select()
        .from(comments)
        .where(and(eq(comments.itemType, itemType), eq(comments.itemId, itemId)))
        .orderBy(asc(comments.createdAt));

      const roleCheck = this.canRoleComment(actor);
      const closedExpired =
        item.closedAt !== null && Date.now() - item.closedAt.getTime() > CLOSED_THREAD_DAYS_MS;
      const canComment = roleCheck.allowed && !closedExpired;
      const readOnlyReason = !roleCheck.allowed
        ? roleCheck.reason
        : closedExpired
          ? `Discussion closed 30 days after this ${itemType} was completed.`
          : null;

      // System entries (linked requests on events, or audit milestones)
      const systemEntries: DiscussionThread['systemEntries'] = [];
      if (itemType === 'event') {
        const eventReqs = await tx
          .select()
          .from(requests)
          .where(eq(requests.eventId, itemId))
          .orderBy(asc(requests.createdAt))
          .limit(5);
        for (const r of eventReqs) {
          systemEntries.push({
            id: r.id,
            at: (r.submittedAt ?? r.createdAt).toISOString(),
            summary: `${r.ref} submitted for ${formatMoney({ amountMinor: r.amountMinor, currency: r.currency })}`,
            link: `/requests/${r.id}`,
          });
        }
      }

      // Mention candidates: active members in the tenant with access status
      const directory = await tx
        .select({
          id: people.id,
          name: people.displayName,
          email: people.email,
          title: people.jobTitle,
          locName: orgUnits.name,
        })
        .from(people)
        .innerJoin(memberships, eq(memberships.personId, people.id))
        .leftJoin(orgUnits, eq(orgUnits.id, people.locationOrgUnitId))
        .where(eq(memberships.status, 'active'))
        .orderBy(asc(people.displayName))
        .limit(30);

      const mentionCandidates: MentionCandidate[] = [];
      for (const p of directory) {
        const hasAccess = await this.canPersonReadItem(tx, actor.tenantId, p.id, itemType, itemId);
        mentionCandidates.push({
          personId: p.id,
          displayName: p.name,
          email: p.email,
          roleLabel: p.title ?? 'Employee',
          locationName: p.locName ?? null,
          hasAccess,
          noAccessReason: hasAccess ? null : `Can't see this ${itemType}`,
        });
      }

      return {
        itemType,
        itemId,
        itemName: item.name,
        commentCount: rows.filter((r) => !r.removedAt).length,
        canComment,
        readOnlyReason,
        follow: await this.followStateOf(tx, actor.personId, itemType, itemId, item.isAutoFollower),
        comments: await this.commentViews(tx, rows, actor.personId),
        systemEntries,
        mentionCandidates,
      };
    });
  }

  createComment(
    actor: RequestActor,
    itemType: DiscussionItemType,
    itemId: string,
    req: CreateCommentRequest,
    ctx: { idempotencyKey: string; requestId: string | null },
  ): Promise<CommandResult<CommentView>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `discussion.comment.create:${itemType}:${itemId}`,
        request: req,
        status: 201,
      },
      async (tx) => {
        const item = await this.resolveDiscussionItem(tx, actor, itemType, itemId);
        const roleCheck = this.canRoleComment(actor);
        if (!roleCheck.allowed) {
          throw ApiProblem.forbidden(roleCheck.reason ?? 'You cannot post comments.');
        }
        if (
          item.closedAt !== null &&
          Date.now() - item.closedAt.getTime() > CLOSED_THREAD_DAYS_MS
        ) {
          throw new ApiProblem(
            409,
            'COMMENT_THREAD_CLOSED',
            `Commenting closes 30 days after a ${itemType} is completed.`,
          );
        }
        if (req.parentCommentId) {
          const [parent] = await tx
            .select()
            .from(comments)
            .where(
              and(
                eq(comments.id, req.parentCommentId),
                eq(comments.itemType, itemType),
                eq(comments.itemId, itemId),
              ),
            );
          if (!parent) throw ApiProblem.notFound('comment');
          if (parent.parentCommentId) {
            throw new ApiProblem(422, 'VALIDATION_FAILED', 'Replies are one level deep.', {
              field: 'parentCommentId',
            });
          }
        }

        const mentionedIds = [...new Set(req.mentionedPersonIds ?? [])];
        for (const mId of mentionedIds) {
          const hasAccess = await this.canPersonReadItem(tx, actor.tenantId, mId, itemType, itemId);
          if (!hasAccess) {
            throw new ApiProblem(
              422,
              'MENTION_NO_ACCESS',
              `That person cannot see this ${itemType} and cannot be mentioned.`,
              { personId: mId },
            );
          }
        }

        if (!actor.personId) {
          throw ApiProblem.forbidden('Only people can post comments.');
        }
        const [created] = await tx
          .insert(comments)
          .values({
            tenantId: actor.tenantId,
            itemType,
            itemId,
            parentCommentId: req.parentCommentId ?? null,
            authorPersonId: actor.personId,
            body: req.body,
            mentions: mentionedIds,
          })
          .returning();

        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'comment.created',
          resourceType: itemType,
          resourceId: itemId,
          requestId: ctx.requestId,
          changes: {
            commentId: { from: null, to: created.id },
            body: { from: null, to: req.body },
            mentions: { from: null, to: mentionedIds },
          },
        });

        for (const mId of mentionedIds) {
          if (mId === actor.personId) continue;
          await tx.insert(notifications).values({
            tenantId: actor.tenantId,
            recipientPersonId: mId,
            area: 'discussion',
            type: 'discussion.mentioned',
            tone: 'info',
            title: `${actor.displayName} mentioned you on ${item.name}`,
            detail: req.body.slice(0, 200),
            itemType,
            itemId,
            itemRef: item.ref,
            commentId: created.id,
            channelsDelivered: ['in_app'],
          });
          await tx.insert(outboxMessages).values({
            tenantId: actor.tenantId,
            topic: CHANNEL_DELIVER_TOPIC,
            payload: {
              kind: 'discussion.mentioned',
              recipientPersonId: mId,
              subjectType: itemType,
              subjectId: itemId,
              subjectRef: item.ref,
              commentId: created.id,
              title: `${actor.displayName} mentioned you on ${item.name}`,
              detail: req.body.slice(0, 200),
              tone: 'info',
            },
          });
        }

        const [view] = await this.commentViews(tx, [created], actor.personId);
        return view;
      },
    );
  }

  updateComment(
    actor: RequestActor,
    commentId: string,
    req: UpdateCommentRequest,
    ctx: { idempotencyKey: string; requestId: string | null },
  ): Promise<CommandResult<CommentView>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `discussion.comment.update:${commentId}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        const [existing] = await tx
          .select()
          .from(comments)
          .where(eq(comments.id, commentId))
          .for('update');
        if (!existing) throw ApiProblem.notFound('comment');
        await this.resolveDiscussionItem(
          tx,
          actor,
          existing.itemType as DiscussionItemType,
          existing.itemId,
        );
        if (existing.authorPersonId !== actor.personId) {
          throw ApiProblem.forbidden('Only the author can edit this comment.');
        }
        if (existing.removedAt) {
          throw new ApiProblem(409, 'CONFLICT', 'Removed comments cannot be edited.');
        }
        if (Date.now() - existing.createdAt.getTime() > EDIT_WINDOW_MS) {
          throw new ApiProblem(
            409,
            'COMMENT_EDIT_WINDOW_EXPIRED',
            'Comments can be edited for 15 minutes after posting.',
          );
        }

        const mentionedIds = [...new Set(req.mentionedPersonIds ?? existing.mentions ?? [])];
        for (const mId of mentionedIds) {
          const hasAccess = await this.canPersonReadItem(
            tx,
            actor.tenantId,
            mId,
            existing.itemType as DiscussionItemType,
            existing.itemId,
          );
          if (!hasAccess) {
            throw new ApiProblem(
              422,
              'MENTION_NO_ACCESS',
              `That person cannot see this ${existing.itemType} and cannot be mentioned.`,
              { personId: mId },
            );
          }
        }

        const [updated] = await tx
          .update(comments)
          .set({
            body: req.body,
            mentions: mentionedIds,
            editedAt: new Date(),
          })
          .where(eq(comments.id, commentId))
          .returning();

        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'comment.edited',
          resourceType: existing.itemType,
          resourceId: existing.itemId,
          requestId: ctx.requestId,
          changes: {
            commentId: { from: existing.id, to: existing.id },
            body: { from: existing.body, to: req.body },
          },
        });

        const [view] = await this.commentViews(tx, [updated], actor.personId);
        return view;
      },
    );
  }

  removeComment(
    actor: RequestActor,
    commentId: string,
    ctx: { idempotencyKey: string; requestId: string | null },
  ): Promise<CommandResult<CommentView>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `discussion.comment.remove:${commentId}`,
        request: {},
        status: 200,
      },
      async (tx) => {
        const [existing] = await tx
          .select()
          .from(comments)
          .where(eq(comments.id, commentId))
          .for('update');
        if (!existing) throw ApiProblem.notFound('comment');
        await this.resolveDiscussionItem(
          tx,
          actor,
          existing.itemType as DiscussionItemType,
          existing.itemId,
        );
        if (existing.authorPersonId !== actor.personId) {
          throw ApiProblem.forbidden('Only the author can remove this comment.');
        }
        const [updated] = await tx
          .update(comments)
          .set({
            removedAt: new Date(),
            removedByPersonId: actor.personId,
          })
          .where(eq(comments.id, commentId))
          .returning();

        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'comment.removed',
          resourceType: existing.itemType,
          resourceId: existing.itemId,
          requestId: ctx.requestId,
          changes: {
            commentId: { from: existing.id, to: existing.id },
            originalBody: { from: existing.body, to: null },
          },
        });

        const [view] = await this.commentViews(tx, [updated], actor.personId);
        return view;
      },
    );
  }

  updateFollow(
    actor: RequestActor,
    itemType: DiscussionItemType,
    itemId: string,
    req: UpdateFollowRequest,
    ctx: { idempotencyKey: string; requestId: string | null },
  ): Promise<CommandResult<FollowState>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `discussion.follow:${itemType}:${itemId}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        if (!actor.personId) throw ApiProblem.forbidden();
        const item = await this.resolveDiscussionItem(tx, actor, itemType, itemId);
        const [existing] = await tx
          .select()
          .from(follows)
          .where(
            and(
              eq(follows.personId, actor.personId),
              eq(follows.itemType, itemType),
              eq(follows.itemId, itemId),
            ),
          );
        if (!req.following) {
          if (existing) {
            await tx.delete(follows).where(eq(follows.id, existing.id));
          }
          await this.analytics.track(tx, actor, 'item.unfollowed', { itemType });
          return { following: false, level: null, source: null };
        }
        const level = req.level ?? 'all';
        const source = item.isAutoFollower ? 'owner' : 'manual';
        if (existing) {
          await tx
            .update(follows)
            .set({ level, updatedAt: new Date() })
            .where(eq(follows.id, existing.id));
        } else {
          await tx.insert(follows).values({
            tenantId: actor.tenantId,
            personId: actor.personId,
            itemType,
            itemId,
            level,
            source,
          });
        }
        await this.analytics.track(tx, actor, 'item.followed', { itemType, level });
        return { following: true, level, source };
      },
    );
  }

  listFollowedItems(
    actor: RequestActor,
    q: { itemType?: DiscussionItemType; q?: string },
  ): Promise<{ items: FollowedItemView[] }> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      if (!actor.personId) return { items: [] };
      const rows = await tx
        .select()
        .from(follows)
        .where(
          and(
            eq(follows.personId, actor.personId),
            ...(q.itemType ? [eq(follows.itemType, q.itemType)] : []),
          ),
        )
        .orderBy(desc(follows.updatedAt));

      const out: FollowedItemView[] = [];
      for (const f of rows) {
        try {
          const item = await this.resolveDiscussionItem(
            tx,
            actor,
            f.itemType as DiscussionItemType,
            f.itemId,
          );
          if (q.q && !item.name.toLowerCase().includes(q.q.toLowerCase())) continue;
          const [latestComment] = await tx
            .select()
            .from(comments)
            .where(and(eq(comments.itemType, f.itemType), eq(comments.itemId, f.itemId)))
            .orderBy(desc(comments.createdAt))
            .limit(1);
          out.push({
            id: f.id,
            itemType: f.itemType as DiscussionItemType,
            itemId: f.itemId,
            name: item.name,
            ref: item.ref,
            status: item.status,
            link: this.itemLink(f.itemType, f.itemId, null) ?? '/',
            lastActivitySummary: latestComment
              ? `Comment: ${latestComment.body.slice(0, 80)}`
              : `Status: ${item.status.replace(/_/g, ' ')}`,
            lastActivityAt: (latestComment?.createdAt ?? f.updatedAt).toISOString(),
            level: f.level as 'all' | 'money_decisions',
            source: f.source as 'owner' | 'manual',
          });
        } catch {
          // Skip items no longer visible
        }
      }
      return { items: out };
    });
  }

  // 061e Slack and Teams app setup, account linking & delivery logs ------------------------------

  private defaultFeatures(): ChatFeatures {
    return {
      approvalCards: true,
      balanceAndQuickRequest: true,
      alerts: true,
      scheduledReportPosts: true,
    };
  }

  private async ensureDefaultInstallationsTx(tx: Tx, tenantId: string): Promise<void> {
    const existing = await tx.select().from(chatInstallations);
    const have = new Set(existing.map((e) => e.provider));
    if (!have.has('slack')) {
      await tx
        .insert(chatInstallations)
        .values({
          tenantId,
          provider: 'slack',
          workspaceId: 'T-HYLAND-01',
          workspaceName: 'Hyland',
          status: 'connected',
          features: this.defaultFeatures(),
          allowedChannels: ['#finance-reports', '#india-leads'],
          secretRef: 'secret-store://slack/hyland-bot',
          installedAt: new Date('2026-11-02T09:00:00Z'),
        })
        .onConflictDoNothing();
    }
    if (!have.has('teams')) {
      await tx
        .insert(chatInstallations)
        .values({
          tenantId,
          provider: 'teams',
          workspaceId: 'ENTRA-HYLAND-01',
          workspaceName: 'Hyland',
          status: 'waiting_for_consent',
          statusDetail: 'Waiting for Microsoft Entra admin consent',
          features: {
            approvalCards: false,
            balanceAndQuickRequest: false,
            alerts: false,
            scheduledReportPosts: false,
          },
          allowedChannels: [],
          secretRef: 'secret-store://teams/hyland-bot',
        })
        .onConflictDoNothing();
    }
  }

  private async approverPeopleTx(tx: Tx) {
    const approverRoles: RoleId[] = [
      'ceo',
      'finance-admin',
      'finance-controller',
      'budget-owner',
      'department-head',
      'regional-manager',
      'location-manager',
    ];
    const rows = await tx
      .selectDistinct({
        id: people.id,
        name: people.displayName,
        email: people.email,
        title: people.jobTitle,
        role: roleGrants.role,
      })
      .from(people)
      .innerJoin(memberships, eq(memberships.personId, people.id))
      .innerJoin(roleGrants, eq(roleGrants.membershipId, memberships.id))
      .where(and(eq(memberships.status, 'active'), inArray(roleGrants.role, approverRoles)))
      .orderBy(asc(people.displayName));
    const map = new Map<
      string,
      { personId: string; displayName: string; email: string; roleLabel: string }
    >();
    for (const r of rows) {
      if (!map.has(r.id)) {
        map.set(r.id, {
          personId: r.id,
          displayName: r.name,
          email: r.email,
          roleLabel: ROLE_LABELS[r.role] ?? r.title ?? r.role,
        });
      }
    }
    return [...map.values()];
  }

  private async installationViewTx(
    tx: Tx,
    row: typeof chatInstallations.$inferSelect,
    links: (typeof chatAccountLinks.$inferSelect)[],
    approverIds: Set<string>,
  ): Promise<ChatInstallationView> {
    const installer = row.installedByPersonId
      ? ((await personNames(tx, [row.installedByPersonId])).get(row.installedByPersonId) ??
        'Nadia Farouk')
      : row.status === 'connected'
        ? 'Nadia Farouk'
        : null;
    const since = new Date(Date.now() - DELIVERY_WINDOW_MS);
    const dels = await tx
      .select()
      .from(channelDeliveries)
      .where(
        and(eq(channelDeliveries.channel, row.provider), gte(channelDeliveries.createdAt, since)),
      );
    const sent = dels.filter((d) => d.status === 'sent' || d.status === 'updated').length;
    const retried = dels.filter((d) => d.status === 'retried' || d.attempts > 1).length;
    const failed = dels.filter((d) => d.status === 'failed').length;
    const linkedApprovers = links.filter(
      (l) => l.provider === row.provider && approverIds.has(l.personId),
    ).length;
    const rawFeatures = (row.features ?? {}) as Partial<ChatFeatures>;
    return {
      provider: row.provider as ChatProvider,
      workspaceId: row.workspaceId,
      workspaceName: row.workspaceName,
      status: row.status as ChatInstallationView['status'],
      statusDetail: row.statusDetail,
      features: {
        approvalCards: rawFeatures.approvalCards ?? row.status === 'connected',
        balanceAndQuickRequest: rawFeatures.balanceAndQuickRequest ?? row.status === 'connected',
        alerts: rawFeatures.alerts ?? row.status === 'connected',
        scheduledReportPosts: rawFeatures.scheduledReportPosts ?? row.status === 'connected',
      },
      allowedChannels: row.allowedChannels ?? [],
      installedByName: installer,
      installedAt: row.installedAt?.toISOString() ?? null,
      linkedApproversCount: linkedApprovers,
      totalApproversCount: approverIds.size,
      delivery24h: { sent, retried, failed },
    };
  }

  private async deliveryLogViewsTx(
    tx: Tx,
    rows: (typeof channelDeliveries.$inferSelect)[],
  ): Promise<ChannelDeliveryLogView[]> {
    const names = await personNames(
      tx,
      rows.map((r) => r.recipientPersonId),
    );
    return rows.map((d) => ({
      id: d.id,
      channel: d.channel as NotificationChannel,
      recipientPersonId: d.recipientPersonId,
      recipientName: d.recipientPersonId ? (names.get(d.recipientPersonId) ?? null) : null,
      kind: d.kind,
      subjectType: d.subjectType,
      subjectId: d.subjectId,
      status: d.status as ChannelDeliveryLogView['status'],
      attempts: d.attempts,
      externalMessageId: d.externalMessageId,
      errorMessage: d.errorMessage,
      payload: (d.payload ?? {}) as Record<string, unknown>,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    }));
  }

  getAdminChannels(actor: RequestActor): Promise<AdminChannelsView> {
    const tenantRes = { kind: 'tenant', tenantId: actor.tenantId } as const;
    this.policy.assert(actor, 'tenant.read', tenantRes, 'channels');
    const canManage = this.policy.can(actor, 'integration.manage', tenantRes).allowed;
    const canReadAdmin =
      canManage ||
      this.policy.can(actor, 'tenant.settings.manage', tenantRes).allowed ||
      this.policy.can(actor, 'master_data.manage', tenantRes).allowed ||
      this.policy.can(actor, 'audit.read', tenantRes).allowed;
    if (!canReadAdmin) {
      throw ApiProblem.forbidden(
        'Only Integration, Organization or Finance Admins can open Channels.',
      );
    }

    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      await this.ensureDefaultInstallationsTx(tx, actor.tenantId);
      const installs = await tx.select().from(chatInstallations);
      const links = await tx
        .select()
        .from(chatAccountLinks)
        .orderBy(desc(chatAccountLinks.linkedAt));
      const approvers = await this.approverPeopleTx(tx);
      const approverIds = new Set(approvers.map((a) => a.personId));
      const pRows = links.length
        ? await tx
            .select({ id: people.id, name: people.displayName, title: people.jobTitle })
            .from(people)
            .where(
              inArray(
                people.id,
                links.map((l) => l.personId),
              ),
            )
        : [];
      const pMap = new Map(pRows.map((p) => [p.id, p]));

      const slackRow = installs.find((i) => i.provider === 'slack') ?? installs[0];
      const teamsRow = installs.find((i) => i.provider === 'teams') ?? installs[0];
      const linkedSet = new Set(links.map((l) => l.personId));
      const dels = await tx
        .select()
        .from(channelDeliveries)
        .orderBy(desc(channelDeliveries.createdAt))
        .limit(50);

      return {
        slack: await this.installationViewTx(tx, slackRow, links, approverIds),
        teams: await this.installationViewTx(tx, teamsRow, links, approverIds),
        links: links.map((l) => ({
          id: l.id,
          personId: l.personId,
          personName: pMap.get(l.personId)?.name ?? 'User',
          personRole: pMap.get(l.personId)?.title ?? 'Member',
          provider: l.provider as 'slack' | 'teams',
          providerUserId: l.providerUserId,
          handle: l.handle,
          verifiedEmail: l.verifiedEmail,
          linkedAt: l.linkedAt.toISOString(),
          lastUsedAt: l.lastUsedAt?.toISOString() ?? null,
        })),
        unlinkedApprovers: approvers.filter((a) => !linkedSet.has(a.personId)),
        deliveries: await this.deliveryLogViewsTx(tx, dels),
        canManage,
      };
    });
  }

  updateChatInstallation(
    actor: RequestActor,
    provider: ChatProvider,
    req: UpdateChatInstallationRequest,
    ctx: { idempotencyKey: string; requestId: string | null },
  ): Promise<CommandResult<ChatInstallationView>> {
    const tenantRes = { kind: 'tenant', tenantId: actor.tenantId } as const;
    this.policy.assert(actor, 'integration.manage', tenantRes, 'channels');
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `channels.installation.update:${provider}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        await this.ensureDefaultInstallationsTx(tx, actor.tenantId);
        const [existing] = await tx
          .select()
          .from(chatInstallations)
          .where(eq(chatInstallations.provider, provider))
          .for('update');
        if (!existing) throw ApiProblem.notFound('chat installation');

        const beforeStatus = existing.status;
        const beforeFeatures = existing.features;
        const beforeChannels = existing.allowedChannels;
        let nextStatus = existing.status;
        let nextFeatures = {
          ...this.defaultFeatures(),
          ...((existing.features ?? {}) as Partial<ChatFeatures>),
        };
        let nextChannels = existing.allowedChannels ?? [];
        let installedAt = existing.installedAt;
        let installedBy = existing.installedByPersonId;

        if (req.action === 'disconnect') {
          if (req.confirmText !== 'DISCONNECT') {
            throw new ApiProblem(
              422,
              'VALIDATION_FAILED',
              'Type DISCONNECT to confirm disconnecting this workspace.',
              { field: 'confirmText' },
            );
          }
          nextStatus = 'not_connected';
          nextFeatures = {
            approvalCards: false,
            balanceAndQuickRequest: false,
            alerts: false,
            scheduledReportPosts: false,
          };
        } else if (req.action === 'connect' || req.action === 'check_status') {
          nextStatus = 'connected';
          nextFeatures = this.defaultFeatures();
          installedAt = new Date();
          installedBy = actor.personId;
        } else if (req.action === 'configure') {
          if (req.features) {
            nextFeatures = { ...nextFeatures, ...req.features };
          }
          if (req.allowedChannels) {
            nextChannels = [...new Set(req.allowedChannels)];
          }
        } else if (req.action === 'remind_unlinked') {
          const approvers = await this.approverPeopleTx(tx);
          const links = await tx
            .select()
            .from(chatAccountLinks)
            .where(eq(chatAccountLinks.provider, provider));
          const linkedIds = new Set(links.map((l) => l.personId));
          for (const a of approvers.filter((x) => !linkedIds.has(x.personId))) {
            await tx.insert(channelDeliveries).values({
              tenantId: actor.tenantId,
              channel: provider,
              recipientPersonId: a.personId,
              kind: 'chat.link_reminder',
              status: 'sent',
              attempts: 1,
              externalMessageId: `${provider}-remind-${randomUUID().slice(0, 8)}`,
              payload: {
                text: `Connect your BudgetFlow account to decide approvals in ${provider === 'slack' ? 'Slack' : 'Microsoft Teams'}.`,
                connectUrl: `${this.notifications.webBaseUrl}/link/chat?provider=${provider}`,
              },
            });
          }
        }

        const [updated] = await tx
          .update(chatInstallations)
          .set({
            status: nextStatus,
            workspaceName: req.workspaceName ?? existing.workspaceName,
            features: nextFeatures,
            allowedChannels: nextChannels,
            installedAt,
            installedByPersonId: installedBy,
            updatedAt: new Date(),
          })
          .where(eq(chatInstallations.id, existing.id))
          .returning();

        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: `channel.${req.action}`,
          resourceType: 'chat_installation',
          resourceId: updated.id,
          requestId: ctx.requestId,
          changes: {
            provider: { from: provider, to: provider },
            status: { from: beforeStatus, to: updated.status },
            features: { from: beforeFeatures, to: updated.features },
            allowedChannels: { from: beforeChannels, to: updated.allowedChannels },
          },
        });

        const links = await tx.select().from(chatAccountLinks);
        const approvers = await this.approverPeopleTx(tx);
        return this.installationViewTx(
          tx,
          updated,
          links,
          new Set(approvers.map((a) => a.personId)),
        );
      },
    );
  }

  unlinkChatAccount(
    actor: RequestActor,
    id: string,
    ctx: { idempotencyKey: string; requestId: string | null },
  ): Promise<CommandResult<{ unlinked: boolean }>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `channels.link.remove:${id}`,
        request: {},
        status: 200,
      },
      async (tx) => {
        const [link] = await tx.select().from(chatAccountLinks).where(eq(chatAccountLinks.id, id));
        if (!link) throw ApiProblem.notFound('chat account link');
        const isSelf = actor.personId !== null && link.personId === actor.personId;
        const canManage = this.policy.can(actor, 'integration.manage', {
          kind: 'tenant',
          tenantId: actor.tenantId,
        }).allowed;
        if (!isSelf && !canManage) {
          throw ApiProblem.forbidden('Only Integration Admins or the account owner can unlink.');
        }

        await tx.delete(chatAccountLinks).where(eq(chatAccountLinks.id, id));

        // Also clear this provider from the person's notification matrix rows
        const [pref] = await tx
          .select()
          .from(notificationPreferences)
          .where(eq(notificationPreferences.personId, link.personId));
        if (pref) {
          const matrix = {
            ...((pref.matrix ?? {}) as Record<string, Record<string, boolean>>),
          };
          for (const k of Object.keys(matrix)) {
            if (link.provider in matrix[k]) matrix[k][link.provider] = false;
          }
          await tx
            .update(notificationPreferences)
            .set({ matrix, updatedAt: new Date() })
            .where(eq(notificationPreferences.id, pref.id));
        }

        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'channel.account_unlinked',
          resourceType: 'chat_account_link',
          resourceId: link.id,
          requestId: ctx.requestId,
          changes: {
            provider: { from: link.provider, to: null },
            handle: { from: link.handle, to: null },
            personId: { from: link.personId, to: null },
          },
        });
        return { unlinked: true };
      },
    );
  }

  createChatLinkIntent(
    actor: RequestActor,
    req: CreateChatLinkIntentRequest,
    ctx: { idempotencyKey: string; requestId: string | null },
  ): Promise<CommandResult<ChatLinkPreview>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `channels.link.intent:${req.provider}`,
        request: req,
        status: 201,
      },
      async (tx) => {
        if (!actor.personId) throw ApiProblem.forbidden();
        const [person] = await tx
          .select({
            id: people.id,
            name: people.displayName,
            email: people.email,
            title: people.jobTitle,
            locName: orgUnits.name,
          })
          .from(people)
          .leftJoin(orgUnits, eq(orgUnits.id, people.locationOrgUnitId))
          .where(eq(people.id, actor.personId));
        if (!person) throw ApiProblem.notFound('person');

        const email = req.verifiedEmail ?? person.email;
        const localPart = email.split('@')[0] ?? 'user';
        const handle = req.handle ?? `@${localPart}`;
        const providerUserId =
          req.providerUserId ??
          `${req.provider === 'slack' ? 'U-' : 'ENTRA-'}${person.id.slice(-8).toUpperCase()}`;
        const token = signChatLinkToken({
          tenantId: actor.tenantId,
          personId: person.id,
          provider: req.provider,
          providerUserId,
          handle,
          verifiedEmail: email,
          exp: Date.now() + 24 * 3600_000,
        });
        return this.previewChatLinkTx(tx, actor, token);
      },
    );
  }

  private async previewChatLinkTx(
    tx: Tx,
    actor: RequestActor,
    token: string,
  ): Promise<ChatLinkPreview> {
    if (!actor.personId) throw ApiProblem.forbidden();
    const payload = verifyChatLinkToken(token);
    if (payload.tenantId !== actor.tenantId) {
      throw new ApiProblem(404, 'CHAT_LINK_INVALID', 'This account-linking link is not valid.');
    }
    const [person] = await tx
      .select({
        id: people.id,
        name: people.displayName,
        email: people.email,
        title: people.jobTitle,
        locName: orgUnits.name,
      })
      .from(people)
      .leftJoin(orgUnits, eq(orgUnits.id, people.locationOrgUnitId))
      .where(eq(people.id, actor.personId));
    if (!person) throw ApiProblem.notFound('person');
    const [existing] = await tx
      .select()
      .from(chatAccountLinks)
      .where(
        and(
          eq(chatAccountLinks.personId, person.id),
          eq(chatAccountLinks.provider, payload.provider),
        ),
      );
    const roleLabel = actor.roles.map((r) => ROLE_LABELS[r] ?? r).join(', ');
    return {
      token,
      provider: payload.provider,
      providerLabel: payload.provider === 'slack' ? 'Slack' : 'Microsoft Teams',
      providerUserId: payload.providerUserId,
      handle: payload.handle,
      chatEmail: payload.verifiedEmail,
      personId: person.id,
      personName: person.name,
      personEmail: person.email,
      personRole: roleLabel || person.title || 'Employee',
      personLocation: person.locName ?? null,
      emailMatches:
        payload.verifiedEmail.trim().toLowerCase() === person.email.trim().toLowerCase(),
      alreadyLinked: Boolean(existing),
    };
  }

  previewChatLink(actor: RequestActor, token: string): Promise<ChatLinkPreview> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) =>
      this.previewChatLinkTx(tx, actor, token),
    );
  }

  completeChatLink(
    actor: RequestActor,
    req: CompleteChatLinkRequest,
    ctx: { idempotencyKey: string; requestId: string | null },
  ): Promise<CommandResult<ChatAccountLinkView>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'channels.link.complete',
        request: req,
        status: 200,
      },
      async (tx) => {
        const preview = await this.previewChatLinkTx(tx, actor, req.token);
        if (!preview.emailMatches) {
          throw new ApiProblem(
            422,
            'CHAT_LINK_EMAIL_MISMATCH',
            `Your ${preview.providerLabel} email (${preview.chatEmail}) doesn't match your BudgetFlow email (${preview.personEmail}). Ask your administrator to fix one of them.`,
          );
        }
        const [existing] = await tx
          .select()
          .from(chatAccountLinks)
          .where(
            and(
              eq(chatAccountLinks.personId, preview.personId),
              eq(chatAccountLinks.provider, preview.provider),
            ),
          );
        let row: typeof chatAccountLinks.$inferSelect;
        if (existing) {
          [row] = await tx
            .update(chatAccountLinks)
            .set({
              providerUserId: preview.providerUserId,
              handle: preview.handle,
              verifiedEmail: preview.chatEmail,
              lastUsedAt: new Date(),
            })
            .where(eq(chatAccountLinks.id, existing.id))
            .returning();
        } else {
          [row] = await tx
            .insert(chatAccountLinks)
            .values({
              tenantId: actor.tenantId,
              personId: preview.personId,
              provider: preview.provider,
              providerUserId: preview.providerUserId,
              handle: preview.handle,
              verifiedEmail: preview.chatEmail,
              lastUsedAt: new Date(),
            })
            .returning();
        }

        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'channel.account_linked',
          resourceType: 'chat_account_link',
          resourceId: row.id,
          requestId: ctx.requestId,
          changes: {
            provider: { from: null, to: row.provider },
            providerUserId: { from: null, to: row.providerUserId },
            handle: { from: null, to: row.handle },
            verifiedEmail: { from: null, to: row.verifiedEmail },
          },
        });

        return {
          id: row.id,
          personId: row.personId,
          personName: preview.personName,
          personRole: preview.personRole,
          provider: row.provider as 'slack' | 'teams',
          providerUserId: row.providerUserId,
          handle: row.handle,
          verifiedEmail: row.verifiedEmail,
          linkedAt: row.linkedAt.toISOString(),
          lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
        };
      },
    );
  }

  listChannelDeliveries(
    actor: RequestActor,
    q: { channel?: NotificationChannel; limit?: number },
  ): Promise<{ items: ChannelDeliveryLogView[] }> {
    this.policy.assert(
      actor,
      'tenant.read',
      { kind: 'tenant', tenantId: actor.tenantId },
      'deliveries',
    );
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const rows = await tx
        .select()
        .from(channelDeliveries)
        .where(
          and(
            ...(q.channel ? [eq(channelDeliveries.channel, q.channel)] : []),
            ...(actor.personId &&
            !this.policy.can(actor, 'integration.manage', {
              kind: 'tenant',
              tenantId: actor.tenantId,
            }).allowed &&
            !this.policy.can(actor, 'audit.read', {
              kind: 'tenant',
              tenantId: actor.tenantId,
            }).allowed
              ? [eq(channelDeliveries.recipientPersonId, actor.personId)]
              : []),
          ),
        )
        .orderBy(desc(channelDeliveries.createdAt))
        .limit(q.limit ?? 50);
      return { items: await this.deliveryLogViewsTx(tx, rows) };
    });
  }

  // 061b, 061c, 061d Interactive chat approval cards, commands & webhooks ------------------------

  private async actorForPersonIdTx(
    tx: Tx,
    tenantId: string,
    personId: string,
  ): Promise<RequestActor> {
    const [m] = await tx
      .select({ subject: memberships.idpSubject })
      .from(memberships)
      .where(and(eq(memberships.personId, personId), eq(memberships.status, 'active')));
    if (!m) throw new ApiProblem(404, 'NOT_FOUND', 'Person membership not found.');
    return this.actors.resolve(m.subject, tenantId, undefined);
  }

  private async renderCardTx(
    tx: Tx,
    actor: RequestActor,
    provider: ChatProvider,
    taskId: string,
    opts?: { notLinked?: boolean; readOnlyViewer?: boolean },
  ): Promise<ChatApprovalCardView> {
    const d = await this.approvals.task(actor, taskId, (t, type, id) =>
      this.documents.listTx(t, type, id),
    );
    const t = d.task;
    const stepUpUrl = `${this.notifications.webBaseUrl}/approvals?task=${t.taskId}`;
    const detailsUrl =
      t.subjectType === 'request'
        ? `${this.notifications.webBaseUrl}/requests/${t.subjectId}`
        : `${this.notifications.webBaseUrl}/contributions/${t.subjectId}`;

    let state: ChatApprovalCardView['state'] = 'waiting';
    let stateHeadline = `Approval needed: ${t.ref}`;
    let canApprove = d.allowedDecisions.includes('approve');
    let canReject = d.allowedDecisions.includes('reject');

    const isApprover = d.allowedDecisions.length > 0;
    if (opts?.notLinked) {
      state = 'not_linked';
      stateHeadline = `Connect your BudgetFlow account to decide from ${provider === 'slack' ? 'Slack' : 'Teams'}`;
      canApprove = false;
      canReject = false;
    } else if (
      opts?.readOnlyViewer ||
      (t.taskStatus === 'pending' &&
        !isApprover &&
        !t.onHold &&
        !d.impact?.blocked &&
        d.doa.message === 'Shown to the approver.')
    ) {
      state = 'read_only';
      const [taskRow] = await tx
        .select({ assignee: approvalTasks.assigneePersonId })
        .from(approvalTasks)
        .where(eq(approvalTasks.id, taskId));
      const assigneeName = taskRow
        ? ((await personNames(tx, [taskRow.assignee])).get(taskRow.assignee) ?? 'the approver')
        : 'the approver';
      stateHeadline = `Only ${assigneeName} or their delegate can decide this`;
      canApprove = false;
      canReject = false;
    } else if (t.taskStatus === 'approved' || t.taskStatus === 'partially_approved') {
      state = 'approved';
      const step = d.route.steps.find((s) => s.taskId === t.taskId);
      const who = step?.actedByName ?? 'you';
      const ch = step?.channel ?? provider;
      stateHeadline = `Approved by ${who}, from ${ch === 'slack' ? 'Slack' : ch === 'teams' ? 'Teams' : ch}`;
      canApprove = false;
      canReject = false;
    } else if (t.taskStatus === 'rejected') {
      state = 'rejected';
      stateHeadline = `Rejected by you. Reason sent to ${t.requesterName.split(' ')[0]}.`;
      canApprove = false;
      canReject = false;
    } else if (t.taskStatus !== 'pending') {
      state = 'decided_elsewhere';
      const step = d.route.steps.find((s) => s.taskId === t.taskId);
      stateHeadline = `Decided by ${step?.actedByName ?? 'another approver'} in BudgetFlow`;
      canApprove = false;
      canReject = false;
    } else if (d.impact?.blocked || t.onHold) {
      state = 'hard_block';
      stateHeadline =
        d.impact?.blocked ?? t.holdReason ?? `New approvals are paused: ${t.budgetName} is frozen`;
      canApprove = false;
    } else if (!d.doa.withinLimit) {
      state = 'outside_doa';
      stateHeadline = `${formatMoney(t.budgetAmount)} is above your ${d.doa.limit ? formatMoney(d.doa.limit) : 'delegation-of-authority'} limit`;
      canApprove = false;
    } else if (t.budgetAmount.amountMinor > STEP_UP_THRESHOLD_MINOR) {
      state = 'outside_doa';
      stateHeadline = `${formatMoney(t.budgetAmount)} exceeds the chat single-click threshold and requires review in BudgetFlow`;
      canApprove = false;
    }

    const base: Omit<ChatApprovalCardView, 'blockKit' | 'adaptiveCard'> = {
      provider,
      taskId: t.taskId,
      subjectType: t.subjectType,
      subjectId: t.subjectId,
      ref: t.ref,
      title: t.title,
      amount: t.amount,
      budgetAmount: t.budgetAmount,
      planRateNote: formatMoneyTripletNote(t.amount, t.budgetAmount),
      requesterName: t.requesterName,
      chargeTo: t.budgetName,
      eventName: t.eventName,
      neededBy: null,
      purpose: d.purpose,
      availableBefore: d.impact?.availableBefore ?? null,
      availableAfter: d.impact?.availableAfter ?? null,
      warning: d.impact?.warning ?? null,
      whyYou: `${d.ruleReason} ${d.doa.message}`.trim(),
      dueAt: t.dueAt,
      state,
      stateHeadline,
      canApprove,
      canReject,
      stepUpUrl,
      detailsUrl,
    };

    return {
      ...base,
      blockKit: buildSlackApprovalBlockKit(base),
      adaptiveCard: buildTeamsApprovalAdaptiveCard(base),
    };
  }

  getChatApprovalCard(
    actor: RequestActor,
    provider: ChatProvider,
    taskId: string,
  ): Promise<ChatApprovalCardView> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) =>
      this.renderCardTx(tx, actor, provider, taskId),
    );
  }

  /**
   * Incoming signed webhook from Slack or Microsoft Teams (`POST /api/channels/webhooks/:provider`).
   * Verifies HMAC + timestamp replay window, maps the provider user to the bound BudgetFlow person,
   * enforces `PolicyService.can` and DoA limits, and records idempotent decisions or balance/request replies.
   */
  async handleChatWebhook(
    provider: ChatProvider,
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
    body: ChatWebhookInteractionRequest,
    requestId: string | null,
  ): Promise<ChatWebhookResponse> {
    verifyChatWebhookSignature(provider, headers, rawBody);

    // Resolve tenant: explicit tenantId in payload, or look up the linked account / task across tenants
    const tenantId = await this.resolveWebhookTenant(provider, body);
    const idempotencyKey = `chat:${provider}:${body.interactionId}`;

    return withTenant(this.db, { tenantId, subject: `webhook:${provider}` }, async (tx) => {
      await this.ensureDefaultInstallationsTx(tx, tenantId);
      const [install] = await tx
        .select()
        .from(chatInstallations)
        .where(eq(chatInstallations.provider, provider));
      if (!install || install.status !== 'connected') {
        throw new ApiProblem(
          409,
          'CHAT_INSTALLATION_NOT_CONNECTED',
          `${provider === 'slack' ? 'Slack' : 'Microsoft Teams'} is not connected for this workspace.`,
        );
      }

      const [link] = await tx
        .select()
        .from(chatAccountLinks)
        .where(
          and(
            eq(chatAccountLinks.provider, provider),
            eq(chatAccountLinks.providerUserId, body.providerUserId),
          ),
        );

      if (!link) {
        const connectUrl = `${this.notifications.webBaseUrl}/link/chat?provider=${provider}`;
        return {
          provider,
          kind: 'not_linked',
          ephemeral: true,
          headline: `Connect your BudgetFlow account to decide from ${provider === 'slack' ? 'Slack' : 'Teams'}`,
          text: `Connect your BudgetFlow account at ${connectUrl} or open BudgetFlow.`,
          card: null,
          decision: null,
          stepUpRequired: true,
          stepUpReason: 'CHAT_ACCOUNT_NOT_LINKED',
          stepUpUrl: connectUrl,
        };
      }

      await tx
        .update(chatAccountLinks)
        .set({ lastUsedAt: new Date() })
        .where(eq(chatAccountLinks.id, link.id));

      const actor = await this.actorForPersonIdTx(tx, tenantId, link.personId);

      // 1. Card view (including Teams Universal Actions per-viewer refresh)
      if (body.kind === 'card_view') {
        if (!body.taskId) {
          throw new ApiProblem(400, 'VALIDATION_FAILED', 'taskId is required for card_view.');
        }
        let readOnlyViewer = false;
        if (body.viewerProviderUserId && body.viewerProviderUserId !== body.providerUserId) {
          readOnlyViewer = true;
        } else {
          const [taskRow] = await tx
            .select()
            .from(approvalTasks)
            .where(eq(approvalTasks.id, body.taskId));
          if (taskRow && taskRow.assigneePersonId !== actor.personId) {
            const delegateId = actor.personId ?? '';
            const [del] = await tx
              .select()
              .from(approvalDelegations)
              .where(
                and(
                  eq(approvalDelegations.delegatorPersonId, taskRow.assigneePersonId),
                  eq(approvalDelegations.delegatePersonId, delegateId),
                ),
              );
            if (!del) readOnlyViewer = true;
          }
        }
        // The card is always rendered with the viewer's own actor, so a shared channel never shows
        // amounts to somebody PolicyService would not let read the request.
        const card = await this.renderCardTx(tx, actor, provider, body.taskId, {
          readOnlyViewer,
        }).catch((e: unknown) => {
          if (readOnlyViewer && e instanceof ApiProblem && e.status === 404) return null;
          throw e;
        });
        if (!card) {
          return {
            provider,
            kind: 'card_view',
            ephemeral: true,
            headline: 'This approval is not yours to see',
            text: 'Only the approver or their delegate can open this approval.',
            card: null,
            decision: null,
            stepUpRequired: false,
            stepUpReason: null,
            stepUpUrl: null,
          };
        }
        return {
          provider,
          kind: 'card_view',
          ephemeral: readOnlyViewer,
          headline: card.stateHeadline,
          text: card.stateHeadline,
          card,
          decision: null,
          stepUpRequired: false,
          stepUpReason: null,
          stepUpUrl: card.stepUpUrl,
        };
      }

      // 2. Approval decision from Slack / Teams card
      if (body.kind === 'decision') {
        if (!body.taskId || !body.decision) {
          throw new ApiProblem(400, 'VALIDATION_FAILED', 'taskId and decision are required.');
        }
        if (body.decision === 'reject') {
          if (!body.reasonCode || !body.reason?.trim()) {
            throw new ApiProblem(
              422,
              'REASON_REQUIRED',
              !body.reasonCode
                ? 'Choose a reason code.'
                : 'Give a reason so the requester knows why.',
            );
          }
        }
        // Check if step-up to web app is required (above DoA limit or above chat single-click threshold)
        const cardBefore = await this.renderCardTx(tx, actor, provider, body.taskId).catch(
          () => null,
        );
        if (body.decision === 'approve' && cardBefore && cardBefore.state === 'outside_doa') {
          return {
            provider,
            kind: 'step_up',
            ephemeral: true,
            headline: cardBefore.stateHeadline,
            text: `${cardBefore.stateHeadline}. Escalate or review in BudgetFlow: ${cardBefore.stepUpUrl}`,
            card: cardBefore,
            decision: null,
            stepUpRequired: true,
            stepUpReason: 'DOA_OR_STEP_UP_REQUIRED',
            stepUpUrl: cardBefore.stepUpUrl,
          };
        }

        const cmdRes = await this.approvals.decide(
          actor,
          body.taskId,
          {
            decision: body.decision,
            noConflictAttested: body.decision === 'approve',
            ...(body.reasonCode ? { reasonCode: body.reasonCode } : {}),
            ...(body.reason ? { comment: body.reason.trim() } : {}),
            channel: provider,
          },
          {
            idempotencyKey,
            requestId,
            channel: provider,
          },
        );

        const updatedCard = await this.renderCardTx(tx, actor, provider, body.taskId);
        await tx.insert(channelDeliveries).values({
          tenantId,
          channel: provider,
          recipientPersonId: actor.personId,
          kind: `approval.card_${body.decision === 'approve' ? 'approved' : 'rejected'}`,
          subjectType: cmdRes.body.subjectType,
          subjectId: cmdRes.body.subjectId,
          status: 'updated',
          attempts: 1,
          externalMessageId: `${provider}-card-${body.taskId}`,
          payload: {
            taskId: body.taskId,
            decision: body.decision,
            headline: updatedCard.stateHeadline,
          },
        });

        return {
          provider,
          kind: 'decision',
          ephemeral: false,
          headline: updatedCard.stateHeadline,
          text: cmdRes.body.message,
          card: updatedCard,
          decision: cmdRes.body,
          stepUpRequired: false,
          stepUpReason: null,
          stepUpUrl: null,
        };
      }

      // 3. Balance check (`/budgetflow balance [query]`)
      if (body.kind === 'balance') {
        const allRows = await tx
          .select()
          .from(budgets)
          .where(ne(budgets.status, 'cancelled'))
          .orderBy(asc(budgets.createdAt), asc(budgets.path));
        const scoped = allRows
          .filter((b) => this.policy.can(actor, 'budget.read', budgetResourceOf(b)).allowed)
          .sort(
            (a, b) =>
              Number(b.ownerPersonId === actor.personId) -
                Number(a.ownerPersonId === actor.personId) ||
              a.createdAt.getTime() - b.createdAt.getTime(),
          );
        const query = body.budgetQuery?.trim().toLowerCase() ?? '';
        let matched = scoped;
        if (query) {
          const exact = scoped.filter((b) => b.name.toLowerCase() === query);
          matched = exact.length
            ? exact
            : scoped.filter(
                (b) =>
                  b.name.toLowerCase().includes(query) ||
                  (b.code ?? '').toLowerCase().includes(query),
              );
        }

        await this.analytics.track(tx, actor, 'chat.balance_checked', {
          provider,
          hasQuery: Boolean(query),
          matched: matched.length,
        });

        if (query && matched.length > 1) {
          return {
            provider,
            kind: 'balance',
            ephemeral: true,
            headline: `Did you mean one of these budgets?`,
            text: matched
              .slice(0, 5)
              .map((b) => b.name)
              .join(', '),
            card: null,
            decision: null,
            stepUpRequired: false,
            stepUpReason: null,
            stepUpUrl: null,
            balances: [],
            didYouMean: matched.slice(0, 5).map((b) => ({ budgetId: b.id, name: b.name })),
          };
        }

        const details = await this.budgetViews.details(tx, actor, matched.slice(0, 20));
        const lines = details.map((d) => {
          const b = d.balances.budgetCurrency;
          const avail = d.balances.available;
          return {
            budgetId: d.id,
            name: d.name,
            status: d.status,
            authorized: b.authorized,
            pending: b.preEncumbered,
            committed: b.encumbered,
            actual: b.actual,
            available: avail,
            utilizationPct: d.utilizationBps / 100,
            pausedNote:
              d.status === 'frozen'
                ? 'Frozen: new requests paused, existing commitments continue.'
                : d.status === 'set_to_zero'
                  ? 'Set to zero: no new requests accepted.'
                  : null,
          };
        });

        const text =
          lines.length === 0
            ? "You don't own or use any budgets yet."
            : lines
                .map(
                  (l) =>
                    `${l.name}: Available under this budget's rules ${formatMoney(l.available)} of ${formatMoney(l.authorized)} (${l.utilizationPct.toFixed(1)}% used), ${l.status.replace(/_/g, ' ')}.`,
                )
                .join('\n');

        return {
          provider,
          kind: 'balance',
          ephemeral: true,
          headline:
            lines.length === 0
              ? "You don't own or use any budgets yet."
              : 'Your budgets, in USD (Available under each budget’s rules)',
          text,
          card: null,
          decision: null,
          stepUpRequired: false,
          stepUpReason: null,
          stepUpUrl: null,
          balances: lines,
        };
      }

      // 4. App Home (Slack) / Personal Tab (Teams)
      if (body.kind === 'app_home') {
        const inbox = await this.approvals.inbox(actor, 'assigned', 10);
        const myReqs = await this.requests.list(actor, { scope: 'mine', limit: 5 });
        const allBudgets = await tx
          .select()
          .from(budgets)
          .where(ne(budgets.status, 'cancelled'))
          .orderBy(asc(budgets.path));
        const scoped = allBudgets
          .filter((b) => this.policy.can(actor, 'budget.read', budgetResourceOf(b)).allowed)
          .slice(0, 5);
        const details = await this.budgetViews.details(tx, actor, scoped);
        const balances = details.map((d) => ({
          budgetId: d.id,
          name: d.name,
          status: d.status,
          authorized: d.balances.budgetCurrency.authorized,
          pending: d.balances.budgetCurrency.preEncumbered,
          committed: d.balances.budgetCurrency.encumbered,
          actual: d.balances.budgetCurrency.actual,
          available: d.balances.available,
          utilizationPct: d.utilizationBps / 100,
          pausedNote: d.status === 'frozen' ? 'Frozen, new requests paused.' : null,
        }));

        return {
          provider,
          kind: 'app_home',
          ephemeral: true,
          headline: 'BudgetFlow · Hyland',
          text: `${inbox.items.length} waiting for you · ${balances.length} budgets · ${myReqs.items.length} recent requests`,
          card: null,
          decision: null,
          stepUpRequired: false,
          stepUpReason: null,
          stepUpUrl: null,
          balances,
          waitingApprovals: inbox.items.map((i) => ({
            taskId: i.taskId,
            ref: i.ref,
            title: i.title,
            amount: i.amount,
            dueAt: i.dueAt,
          })),
          myRequests: myReqs.items.map((r) => ({
            id: r.id,
            ref: r.ref,
            title: r.title,
            amount: r.amount,
            statusLabel: r.currentStep
              ? `Pending with ${r.currentStep.approverName}`
              : r.status.replace(/_/g, ' '),
          })),
        };
      }

      // 5. Quick spending request modal submission
      if (body.kind === 'quick_request') {
        const qr = body.quickRequest;
        if (!qr) {
          throw new ApiProblem(400, 'VALIDATION_FAILED', 'quickRequest payload is required.');
        }
        const preview = await this.requests.previewRoute(actor, {
          budgetId: qr.budgetId,
          amountMinor: qr.amountMinor,
          currency: qr.currency,
          spendType: qr.category,
        });
        if (preview.blockedCode) {
          throw new ApiProblem(
            409,
            preview.blockedCode as ProblemCode,
            preview.blockedReason ?? 'This budget cannot accept the request.',
          );
        }
        if (preview.impact.warning && !qr.confirmSoftWarning) {
          return {
            provider,
            kind: 'quick_request',
            ephemeral: true,
            headline: 'Confirm before submitting',
            text: `${preview.impact.warning} Submit anyway?`,
            card: null,
            decision: null,
            stepUpRequired: false,
            stepUpReason: null,
            stepUpUrl: null,
            softWarning: preview.impact.warning,
          };
        }

        const created = await this.requests.create(
          actor,
          {
            kind: 'spending',
            budgetId: qr.budgetId,
            amount: { amountMinor: qr.amountMinor, currency: qr.currency },
            spendType: qr.category,
            category: qr.category,
            title: qr.title,
            purpose: qr.purpose,
            ...(qr.neededBy ? { neededBy: qr.neededBy } : {}),
            submit: true,
          },
          { idempotencyKey, requestId },
        );
        const r = created.body;
        const approver = r.currentStep?.approverName ?? 'the budget owner';
        return {
          provider,
          kind: 'quick_request',
          ephemeral: true,
          headline: `${r.ref} ${r.title}, ${formatMoney(r.amount)}, submitted. Routed to ${approver}.`,
          text: `${r.ref} ${r.title}, ${formatMoney(r.amount)}, submitted. Routed to ${approver}. Open in BudgetFlow: ${this.notifications.webBaseUrl}/requests/${r.id}`,
          card: null,
          decision: null,
          stepUpRequired: false,
          stepUpReason: null,
          stepUpUrl: `${this.notifications.webBaseUrl}/requests/${r.id}`,
          createdRequestRef: r.ref,
          createdRequestId: r.id,
        };
      }

      throw new ApiProblem(400, 'VALIDATION_FAILED', 'Unsupported webhook interaction kind.');
    });
  }

  private async resolveWebhookTenant(
    provider: ChatProvider,
    body: ChatWebhookInteractionRequest,
  ): Promise<string> {
    if (body.tenantId) return body.tenantId;
    const rows = await this.db.transaction((tx) =>
      tx.execute<{ tenant_id: string }>(sql`
        select tenant_id from chat_account_links
        where provider = ${provider} and provider_user_id = ${body.providerUserId}
        limit 1
      `),
    );
    if (rows.rows[0]?.tenant_id) return rows.rows[0].tenant_id;
    const fallback = await this.db.transaction((tx) =>
      tx.execute<{ id: string }>(sql`select id from tenants order by created_at asc limit 1`),
    );
    if (!fallback.rows[0]?.id) {
      throw new ApiProblem(404, 'NOT_FOUND', 'No tenant configured.');
    }
    return fallback.rows[0].id;
  }

  // 064a Role-based digest templates -------------------------------------------------------------

  private async countRecipientsTx(tx: Tx, roles: readonly string[]): Promise<number> {
    if (!roles.length) return 0;
    const rows = await tx
      .selectDistinct({ personId: memberships.personId })
      .from(memberships)
      .innerJoin(roleGrants, eq(roleGrants.membershipId, memberships.id))
      .where(and(eq(memberships.status, 'active'), inArray(roleGrants.role, roles as RoleId[])));
    return rows.filter((r) => Boolean(r.personId)).length;
  }

  private async toDigestTemplateViewTx(
    tx: Tx,
    row: typeof digests.$inferSelect,
  ): Promise<DigestTemplateView> {
    const recipientCount = await this.countRecipientsTx(tx, row.audienceRoles ?? []);
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      audienceRoles: (row.audienceRoles ?? []) as RoleId[],
      frequency: row.frequency as 'daily_weekdays' | 'weekly',
      weekday: row.weekday,
      sendTime: row.sendTime,
      channelsAllowed: (row.channelsAllowed ?? ['email']) as ('email' | 'slack' | 'teams')[],
      introLine: row.introLine,
      sections: (row.sections ?? []) as DigestSectionConfig[],
      skipWhenEmpty: row.skipWhenEmpty,
      status: row.status as 'published' | 'draft_changes' | 'off',
      version: row.version,
      recipientCount,
      lastSentAt: row.lastSentAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  listDigestTemplates(
    actor: RequestActor,
  ): Promise<{ items: DigestTemplateView[]; canManage: boolean }> {
    const tenantRes = { kind: 'tenant', tenantId: actor.tenantId } as const;
    this.policy.assert(actor, 'tenant.read', tenantRes, 'digests');
    const canManage =
      this.policy.can(actor, 'notification.manage', tenantRes).allowed ||
      this.policy.can(actor, 'tenant.settings.manage', tenantRes).allowed;
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      await this.ensureDefaultDigestsTx(tx, actor.tenantId);
      const rows = await tx.select().from(digests).orderBy(asc(digests.createdAt));
      const items: DigestTemplateView[] = [];
      for (const r of rows) items.push(await this.toDigestTemplateViewTx(tx, r));
      return { items, canManage };
    });
  }

  getDigestTemplate(actor: RequestActor, templateId: string): Promise<DigestTemplateView> {
    this.policy.assert(
      actor,
      'tenant.read',
      { kind: 'tenant', tenantId: actor.tenantId },
      'digest',
    );
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      await this.ensureDefaultDigestsTx(tx, actor.tenantId);
      const [row] = await tx.select().from(digests).where(eq(digests.id, templateId));
      if (!row) throw ApiProblem.notFound('digest template');
      return this.toDigestTemplateViewTx(tx, row);
    });
  }

  updateDigestTemplate(
    actor: RequestActor,
    templateId: string,
    req: UpdateDigestTemplateRequest,
    ctx: { idempotencyKey: string; requestId: string | null },
  ): Promise<CommandResult<DigestTemplateView>> {
    const tenantRes = { kind: 'tenant', tenantId: actor.tenantId } as const;
    if (
      !this.policy.can(actor, 'notification.manage', tenantRes).allowed &&
      !this.policy.can(actor, 'tenant.settings.manage', tenantRes).allowed
    ) {
      throw ApiProblem.forbidden(
        'Only Finance Admins or Organization Admins can edit digest templates.',
      );
    }

    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `digests.template.update:${templateId}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        const [existing] = await tx
          .select()
          .from(digests)
          .where(eq(digests.id, templateId))
          .for('update');
        if (!existing) throw ApiProblem.notFound('digest template');

        const nextSections = (req.sections ?? existing.sections ?? []) as DigestSectionConfig[];
        if (!nextSections.some((s) => s.enabled)) {
          throw new ApiProblem(422, 'VALIDATION_FAILED', 'Choose at least one section.', {
            field: 'sections',
          });
        }
        const nextChannels = req.channelsAllowed ?? existing.channelsAllowed ?? ['email'];
        if (!nextChannels.length) {
          throw new ApiProblem(422, 'VALIDATION_FAILED', 'Choose at least one channel.', {
            field: 'channelsAllowed',
          });
        }

        const nextVersion = req.publish ? existing.version + 1 : existing.version;
        const nextStatus = req.publish ? 'published' : (req.status ?? existing.status);

        const [updated] = await tx
          .update(digests)
          .set({
            name: req.name ?? existing.name,
            audienceRoles: req.audienceRoles ?? existing.audienceRoles,
            frequency: req.frequency ?? existing.frequency,
            weekday: req.weekday !== undefined ? req.weekday : existing.weekday,
            sendTime: req.sendTime ?? existing.sendTime,
            channelsAllowed: nextChannels,
            introLine: req.introLine ?? existing.introLine,
            sections: nextSections,
            skipWhenEmpty: req.skipWhenEmpty ?? existing.skipWhenEmpty,
            status: nextStatus,
            version: nextVersion,
            updatedAt: new Date(),
          })
          .where(eq(digests.id, templateId))
          .returning();

        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: req.publish ? 'digest.template_published' : 'digest.template_updated',
          resourceType: 'digest',
          resourceId: updated.id,
          requestId: ctx.requestId,
          changes: {
            name: { from: existing.name, to: updated.name },
            status: { from: existing.status, to: updated.status },
            version: { from: existing.version, to: updated.version },
            channelsAllowed: { from: existing.channelsAllowed, to: updated.channelsAllowed },
          },
        });

        return this.toDigestTemplateViewTx(tx, updated);
      },
    );
  }

  private async renderDigestTx(
    tx: Tx,
    actor: RequestActor,
    templateId: string,
    personId?: string,
  ): Promise<DigestPreviewResponse> {
    await this.ensureDefaultDigestsTx(tx, actor.tenantId);
    const [template] = await tx.select().from(digests).where(eq(digests.id, templateId));
    if (!template) throw ApiProblem.notFound('digest template');

    const targetPersonId = personId ?? actor.personId;
    if (!targetPersonId) throw ApiProblem.notFound('recipient');
    const [person] = await tx.select().from(people).where(eq(people.id, targetPersonId));
    if (!person) throw ApiProblem.notFound('recipient');

    const recipientActor = await this.actorForPersonIdTx(tx, actor.tenantId, targetPersonId).catch(
      () => actor,
    );

    const enabledSections = ((template.sections ?? []) as DigestSectionConfig[]).filter(
      (s) => s.enabled,
    );
    const renderedSections: DigestPreviewResponse['sections'] = [];

    for (const sec of enabledSections) {
      const lines: string[] = [];
      if (sec.key === 'waiting_for_you' || sec.key === 'approval_cycle') {
        const inbox = await this.approvals.inbox(recipientActor, 'assigned', sec.maxItems);
        for (const item of inbox.items) {
          lines.push(
            `${item.ref} ${item.title} · ${formatMoney(item.amount)} (${item.requesterName} · ${item.budgetName})`,
          );
        }
      } else if (sec.key === 'escalated_to_you') {
        const esc = await this.approvals.inbox(recipientActor, 'escalated', sec.maxItems);
        for (const item of esc.items) {
          lines.push(`${item.ref} ${item.title} · ${formatMoney(item.amount)}`);
        }
      } else if (sec.key === 'delegations') {
        const dels = await this.approvals.delegations(recipientActor);
        for (const d of dels.items.slice(0, sec.maxItems)) {
          lines.push(`${d.delegatorName} → ${d.delegateName} (${d.validFrom} to ${d.validTo})`);
        }
      } else if (
        sec.key === 'budget_position' ||
        sec.key === 'company_available' ||
        sec.key === 'thresholds_crossed' ||
        sec.key === 'controls_applied' ||
        sec.key === 'unused_budget'
      ) {
        const allB = await tx
          .select()
          .from(budgets)
          .where(ne(budgets.status, 'cancelled'))
          .orderBy(asc(budgets.path));
        const scoped = allB
          .filter(
            (b) => this.policy.can(recipientActor, 'budget.read', budgetResourceOf(b)).allowed,
          )
          .slice(0, sec.maxItems);
        const details = await this.budgetViews.details(tx, recipientActor, scoped);
        for (const d of details) {
          if (sec.key === 'company_available') {
            lines.push(
              `${d.name}: Company-wide Available ${formatMoney(d.available.companyWide)} of ${formatMoney(d.balances.reporting.authorized)} (${(d.utilizationBps / 100).toFixed(1)}% used)`,
            );
          } else if (sec.key === 'thresholds_crossed') {
            if (d.thresholdsReachedPct.length) {
              lines.push(
                `${d.name}: passed ${d.thresholdsReachedPct.at(-1)}% (${(d.utilizationBps / 100).toFixed(1)}% used)`,
              );
            }
          } else if (sec.key === 'controls_applied') {
            if (d.status !== 'active') {
              lines.push(`${d.name}: ${d.status.replace(/_/g, ' ')}`);
            }
          } else {
            lines.push(
              `${d.name}: Available under this budget's rules ${formatMoney(d.balances.available)} of ${formatMoney(d.balances.budgetCurrency.authorized)} (${(d.utilizationBps / 100).toFixed(1)}% used)`,
            );
          }
        }
      } else if (sec.key === 'pending_requests' || sec.key === 'open_tasks') {
        const reqList = await this.requests.list(recipientActor, {
          scope: 'visible',
          tab: 'pending',
          limit: sec.maxItems,
        });
        for (const r of reqList.items) {
          lines.push(
            `${r.ref} ${r.title} · ${formatMoney(r.amount)} (${r.currentStep ? `with ${r.currentStep.approverName}` : r.status})`,
          );
        }
      } else if (sec.key === 'upcoming_events') {
        const evs = await tx
          .select()
          .from(events)
          .orderBy(asc(events.startsAt))
          .limit(sec.maxItems);
        for (const e of evs) {
          if (await this.isItemAvailable(tx, recipientActor, 'event', e.id)) {
            lines.push(`${e.name} (${e.eventCode}) · ${e.status.replace(/_/g, ' ')}`);
          }
        }
      } else if (sec.key === 'receipts_missing') {
        const tasks = await this.deriveTasks(tx, recipientActor);
        for (const t of tasks.filter((x) => x.kind === 'receipt').slice(0, sec.maxItems)) {
          lines.push(`${t.title} (${t.subtitle})`);
        }
      } else if (sec.key === 'unmatched_actuals') {
        const unm = await tx
          .select()
          .from(actuals)
          .where(eq(actuals.matchStatus, 'unmatched'))
          .limit(sec.maxItems);
        for (const a of unm) {
          lines.push(
            `${a.merchant ?? a.memo ?? 'Actual'} · ${formatMoney({ amountMinor: a.transactionAmountMinor, currency: a.transactionCurrency })}`,
          );
        }
      } else if (sec.key === 'accruals_review') {
        const acc = await tx
          .select()
          .from(accruals)
          .where(eq(accruals.status, 'proposed'))
          .limit(sec.maxItems);
        for (const a of acc) {
          lines.push(
            `Proposed accrual · ${formatMoney({ amountMinor: a.amountMinor, currency: a.currency })}`,
          );
        }
      } else if (sec.key === 'tieout_status') {
        const runs = await tx
          .select()
          .from(glTieoutRuns)
          .orderBy(desc(glTieoutRuns.createdAt))
          .limit(sec.maxItems);
        for (const r of runs) {
          lines.push(`GL tie-out: ${r.status.replace(/_/g, ' ')}`);
        }
      } else if (sec.key === 'recharges_pending') {
        const rechs = await tx
          .select()
          .from(rechargeSchedules)
          .where(inArray(rechargeSchedules.status, ['proposed', 'pending_tax_approval']))
          .limit(sec.maxItems);
        for (const r of rechs) {
          lines.push(
            `Intercompany recharge · ${formatMoney({ amountMinor: r.amountMinor + r.markupMinor, currency: r.currency })}`,
          );
        }
      }

      renderedSections.push({
        key: sec.key,
        title: sec.label,
        lines,
      });
    }

    const totalItems = renderedSections.reduce((sum, s) => sum + s.lines.length, 0);
    const nothingToReport = template.skipWhenEmpty && totalItems === 0;
    const subject = `${template.name} · Hyland`;
    const flatLines: [string, string][] = renderedSections.flatMap((s) =>
      s.lines.length
        ? s.lines.map((l, i): [string, string] => [i === 0 ? s.title : '', l])
        : [[s.title, 'None this period']],
    );

    const email = noticeEmail({
      firstName: person.displayName.split(' ')[0],
      subject,
      headline: template.introLine || template.name,
      lines: flatLines.length ? flatLines : [['Summary', 'Nothing to report this period']],
      detailsUrl: `${this.notifications.webBaseUrl}/notifications`,
    });

    const slackBlockKit = {
      text: `${subject}: ${template.introLine}`,
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: subject } },
        { type: 'section', text: { type: 'mrkdwn', text: template.introLine } },
        ...renderedSections.map((s) => ({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${s.title}*\n${s.lines.length ? s.lines.map((l) => `• ${l}`).join('\n') : '_None_'}`,
          },
        })),
      ],
    };

    const teamsAdaptiveCard = {
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      type: 'AdaptiveCard',
      version: '1.5',
      body: [
        { type: 'TextBlock', weight: 'Bolder', size: 'Medium', text: subject },
        { type: 'TextBlock', wrap: true, text: template.introLine },
        ...renderedSections.map((s) => ({
          type: 'Container',
          items: [
            { type: 'TextBlock', weight: 'Bolder', text: s.title },
            {
              type: 'TextBlock',
              wrap: true,
              text: s.lines.length ? s.lines.join('\n') : 'None',
            },
          ],
        })),
      ],
    };

    return {
      templateId: template.id,
      templateName: template.name,
      recipientPersonId: person.id,
      recipientName: person.displayName,
      recipientTimezone: person.timezone ?? 'America/New_York',
      nothingToReport,
      subject,
      sections: renderedSections,
      emailHtml: email.html,
      emailText: email.text,
      slackBlockKit,
      teamsAdaptiveCard,
    };
  }

  previewDigestTemplate(
    actor: RequestActor,
    templateId: string,
    personId?: string,
  ): Promise<DigestPreviewResponse> {
    this.policy.assert(
      actor,
      'tenant.read',
      { kind: 'tenant', tenantId: actor.tenantId },
      'digest',
    );
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) =>
      this.renderDigestTx(tx, actor, templateId, personId),
    );
  }

  sendDigestTest(
    actor: RequestActor,
    templateId: string,
    channel: 'email' | 'slack' | 'teams' = 'email',
    ctx: { idempotencyKey: string; requestId: string | null },
  ): Promise<CommandResult<TestChannelResponse>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `digests.test:${templateId}:${channel}`,
        request: { channel },
        status: 200,
      },
      async (tx) => {
        if (!actor.personId) throw ApiProblem.forbidden();
        const preview = await this.renderDigestTx(tx, actor, templateId, actor.personId);
        if (channel === 'email') {
          const recipient = await this.notifications.personEmail(tx, actor.personId);
          if (recipient) {
            await this.notifications.queueEmail(
              tx,
              actor.tenantId,
              recipient,
              {
                subject: preview.subject,
                html: preview.emailHtml,
                text: preview.emailText,
              },
              'digest.test',
            );
          }
        }
        const [delivery] = await tx
          .insert(channelDeliveries)
          .values({
            tenantId: actor.tenantId,
            channel,
            recipientPersonId: actor.personId,
            kind: 'digest.test',
            subjectType: 'digest',
            subjectId: templateId,
            status: 'sent',
            attempts: 1,
            externalMessageId: `digest-${channel}-${randomUUID().slice(0, 8)}`,
            payload: {
              templateName: preview.templateName,
              subject: preview.subject,
            },
          })
          .returning();

        return {
          channel,
          status: 'sent',
          message:
            channel === 'email'
              ? 'Test sent to your email'
              : `Test sent to ${channel === 'slack' ? 'Slack' : 'Microsoft Teams'}`,
          deliveryId: delivery.id,
        };
      },
    );
  }

  // Worker job: deliver multi-channel notifications & approval cards -----------------------------

  async deliverChannelJob(job: ChannelDeliverJob): Promise<void> {
    await withTenant(this.db, { tenantId: job.tenantId, subject: 'system:worker' }, async (tx) => {
      await this.ensureDefaultInstallationsTx(tx, job.tenantId);
      const area: NotificationItem['area'] = job.kind.startsWith('approval')
        ? 'approvals'
        : job.kind.startsWith('budget') || job.kind.startsWith('contribution')
          ? 'budgets'
          : job.kind.startsWith('event')
            ? 'events'
            : job.kind.startsWith('discussion')
              ? 'discussion'
              : 'finance';

      const installs = await tx.select().from(chatInstallations);
      const links = await tx
        .select()
        .from(chatAccountLinks)
        .where(eq(chatAccountLinks.personId, job.recipientPersonId));
      const pushDevs = await tx
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.personId, job.recipientPersonId));

      const delivered: NotificationChannel[] = ['in_app', 'email'];

      for (const provider of ['slack', 'teams'] as const) {
        const inst = installs.find((i) => i.provider === provider);
        const link = links.find((l) => l.provider === provider);
        if (inst?.status === 'connected' && link) {
          delivered.push(provider);
          let payload: Record<string, unknown> = {
            title: job.title,
            detail: job.detail,
          };
          if (job.taskId) {
            const actor = await this.actorForPersonIdTx(
              tx,
              job.tenantId,
              job.recipientPersonId,
            ).catch(() => systemActor(job.tenantId));
            const card = await this.renderCardTx(tx, actor, provider, job.taskId).catch(() => null);
            if (card) {
              payload =
                provider === 'slack'
                  ? { blockKit: card.blockKit, taskId: job.taskId, ref: card.ref }
                  : { adaptiveCard: card.adaptiveCard, taskId: job.taskId, ref: card.ref };
            }
          }
          await tx.insert(channelDeliveries).values({
            tenantId: job.tenantId,
            channel: provider,
            recipientPersonId: job.recipientPersonId,
            kind: job.kind,
            subjectType: job.subjectType ?? null,
            subjectId: job.subjectId ?? null,
            status: 'sent',
            attempts: 1,
            externalMessageId: `${provider}-msg-${(job.taskId ?? randomUUID()).slice(0, 8)}`,
            payload,
          });
        }
      }

      if (pushDevs.length > 0) {
        delivered.push('push');
        const [pref] = await tx
          .select()
          .from(notificationPreferences)
          .where(eq(notificationPreferences.personId, job.recipientPersonId));
        const showAmounts = pref?.showAmountsInPush ?? false;
        const pushTitle = showAmounts
          ? job.title
          : job.title.replace(/,\s*[A-Z]{3}\s*[\d,.]+/g, '');
        await tx.insert(channelDeliveries).values({
          tenantId: job.tenantId,
          channel: 'push',
          recipientPersonId: job.recipientPersonId,
          kind: job.kind,
          subjectType: job.subjectType ?? null,
          subjectId: job.subjectId ?? null,
          status: 'sent',
          attempts: 1,
          externalMessageId: `push-${randomUUID().slice(0, 8)}`,
          payload: { title: pushTitle, detail: job.detail, showAmounts },
        });
      }

      if (job.kind !== 'discussion.mentioned') {
        await tx.insert(notifications).values({
          tenantId: job.tenantId,
          recipientPersonId: job.recipientPersonId,
          area,
          type: job.kind,
          tone: job.tone ?? 'neutral',
          title: job.title,
          detail: job.detail,
          itemType: job.subjectType ?? null,
          itemId: job.subjectId ?? null,
          itemRef: job.subjectRef ?? null,
          commentId: job.commentId ?? null,
          channelsDelivered: delivered,
          ...(job.createdAtIso ? { createdAt: new Date(job.createdAtIso) } : {}),
        });
      }
    });
  }
}
