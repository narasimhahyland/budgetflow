import { DEFAULT_DIGEST_TEMPLATES } from '@bf/api/channels';
import { CoreModule, DB } from '@bf/api/core';
import * as s from '@bf/api/db';
import type { Db } from '@bf/api/db';
import {
  BUDGETS,
  P5_IDS,
  P8_CHAT_LINKS,
  P8_COMMENTS,
  P8_FOLLOWS,
  P8_IDS,
  TENANTS,
  userById,
} from '@bf/seed';
import { Module, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

@Module({ imports: [CoreModule] })
class ChannelsSeedModule {}

/**
 * Phase 8 deterministic seed: Slack and Teams installations, bound chat accounts, push devices,
 * discussion threads with @mentions, followed items, digest templates, notifications and delivery logs.
 */
export async function seedChannels(_app: INestApplicationContext): Promise<void> {
  const ctx = await NestFactory.createApplicationContext(ChannelsSeedModule, {
    logger: ['error', 'warn'],
  });
  try {
    const db = ctx.get<Db>(DB);
    await s.withTenant(db, { tenantId: TENANTS.acme, subject: 'seed:p8' }, async (tx) => {
      // 1. Chat installations
      await tx
        .insert(s.chatInstallations)
        .values([
          {
            id: P8_IDS.installations.slack,
            tenantId: TENANTS.acme,
            provider: 'slack',
            workspaceId: 'T-HYLAND-01',
            workspaceName: 'Hyland',
            status: 'connected',
            features: {
              approvalCards: true,
              balanceAndQuickRequest: true,
              alerts: true,
              scheduledReportPosts: true,
            },
            allowedChannels: ['#finance-reports', '#india-leads'],
            secretRef: 'secret-store://slack/hyland-bot',
            installedByPersonId: userById('integration-admin').personId,
            installedAt: new Date('2026-11-02T09:00:00Z'),
          },
          {
            id: P8_IDS.installations.teams,
            tenantId: TENANTS.acme,
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
          },
        ])
        .onConflictDoNothing();

      // 2. Chat account links
      await tx
        .insert(s.chatAccountLinks)
        .values(
          P8_CHAT_LINKS.map((l) => ({
            ...l,
            linkedAt: new Date('2026-11-02T10:00:00Z'),
            lastUsedAt: new Date('2026-11-15T09:30:00Z'),
          })),
        )
        .onConflictDoNothing();

      // 3. Push subscriptions
      await tx
        .insert(s.pushSubscriptions)
        .values([
          {
            id: P8_IDS.pushDevices.regionalManagerPixel,
            tenantId: TENANTS.acme,
            personId: userById('regional-manager').personId!,
            deviceLabel: 'Pixel 8, Chrome',
            userAgentFamily: 'Android, Chrome',
            endpoint: 'https://push.budgetflow.example.test/sub/rm-pixel-8',
            p256dh: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFg',
            authKey: 'UUQM145_auth_rm_pixel8',
            createdAt: new Date('2026-11-03T08:00:00Z'),
          },
          {
            id: P8_IDS.pushDevices.locationManagerPixel,
            tenantId: TENANTS.acme,
            personId: userById('location-manager').personId!,
            deviceLabel: 'Pixel 8, Chrome',
            userAgentFamily: 'Android, Chrome',
            endpoint: 'https://push.budgetflow.example.test/sub/lm-pixel-8',
            p256dh: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFg',
            authKey: 'UUQM145_auth_lm_pixel8',
            createdAt: new Date('2026-11-03T08:30:00Z'),
          },
        ])
        .onConflictDoNothing();

      // 4. Comments & mentions
      await tx
        .insert(s.comments)
        .values(
          P8_COMMENTS.map((c) => ({
            ...c,
            mentions: [...c.mentions],
          })),
        )
        .onConflictDoNothing();

      // 5. Follows
      await tx
        .insert(s.follows)
        .values([...P8_FOLLOWS])
        .onConflictDoNothing();

      // 6. Digest templates
      const digestIds = [
        P8_IDS.digests.approverDaily,
        P8_IDS.digests.ownerWeekly,
        P8_IDS.digests.organizerWeekly,
        P8_IDS.digests.financeWeekly,
        P8_IDS.digests.executiveWeekly,
      ];
      await tx
        .insert(s.digests)
        .values(
          DEFAULT_DIGEST_TEMPLATES.map((d, idx) => ({
            id: digestIds[idx],
            tenantId: TENANTS.acme,
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
            lastSentAt: new Date('2026-11-16T03:00:00Z'),
          })),
        )
        .onConflictDoNothing();

      // 7. Notifications
      await tx
        .insert(s.notifications)
        .values([
          {
            id: P8_IDS.notifications.lmApprovalWaiting,
            tenantId: TENANTS.acme,
            recipientPersonId: userById('location-manager').personId!,
            area: 'approvals',
            type: 'approval.assigned',
            tone: 'warning',
            title: 'Team lunch: Platform squad, USD 216.00, waits for you',
            detail: 'Kavya Rao · Bengaluru Events',
            itemType: 'request',
            itemId: P5_IDS.requests.teamLunch,
            itemRef: 'REQ-00002',
            channelsDelivered: ['in_app', 'email', 'slack'],
            createdAt: new Date('2026-11-15T10:00:00Z'),
          },
          {
            id: P8_IDS.notifications.lmMentioned,
            tenantId: TENANTS.acme,
            recipientPersonId: userById('location-manager').personId!,
            area: 'discussion',
            type: 'discussion.mentioned',
            tone: 'info',
            title: 'Kavya Rao mentioned you on Diwali celebration 2026',
            detail: 'Caterer quote came in for 230 people. @Rahul Menon can we fund it from Bengaluru Events?',
            itemType: 'event',
            itemId: P5_IDS.event,
            itemRef: 'EV-2026-DIWALI',
            commentId: P8_IDS.comments.diwaliQuote,
            channelsDelivered: ['in_app', 'slack'],
            createdAt: new Date('2026-11-03T10:12:00Z'),
          },
          {
            id: P8_IDS.notifications.rmCofundingWaiting,
            tenantId: TENANTS.acme,
            recipientPersonId: userById('regional-manager').personId!,
            area: 'approvals',
            type: 'approval.assigned',
            tone: 'warning',
            title: 'Gifts for the Hyderabad attendees, USD 720.00, waits for you',
            detail: 'Kavya Rao · India Events',
            itemType: 'contribution',
            itemId: P5_IDS.contributions.pending,
            itemRef: 'IDC-00002',
            channelsDelivered: ['in_app', 'email', 'slack'],
            createdAt: new Date('2026-11-15T11:00:00Z'),
          },
          {
            id: P8_IDS.notifications.rmMentioned,
            tenantId: TENANTS.acme,
            recipientPersonId: userById('regional-manager').personId!,
            area: 'discussion',
            type: 'discussion.mentioned',
            tone: 'info',
            title: 'Rahul Menon mentioned you on Diwali celebration 2026',
            detail: 'Yes, submit it. @Ananya Iyer the Hyderabad gifts share will reach you as a co-funding request.',
            itemType: 'event',
            itemId: P5_IDS.event,
            itemRef: 'EV-2026-DIWALI',
            commentId: P8_IDS.comments.diwaliReply,
            channelsDelivered: ['in_app', 'slack'],
            createdAt: new Date('2026-11-03T11:05:00Z'),
          },
          {
            id: P8_IDS.notifications.eoSnacksApproved,
            tenantId: TENANTS.acme,
            recipientPersonId: userById('event-organizer').personId!,
            area: 'requests',
            type: 'approval.decided',
            tone: 'success',
            title: 'Snacks for the planning offsite was approved by Rahul Menon',
            detail: 'USD 114.00 · Bengaluru Events · Upload your receipt after the offsite',
            itemType: 'request',
            itemId: P5_IDS.requests.snacks,
            itemRef: 'REQ-00003',
            channelsDelivered: ['in_app', 'email', 'slack'],
            createdAt: new Date('2026-11-14T15:20:00Z'),
          },
          {
            id: P8_IDS.notifications.eoReply,
            tenantId: TENANTS.acme,
            recipientPersonId: userById('event-organizer').personId!,
            area: 'discussion',
            type: 'discussion.followed_activity',
            tone: 'neutral',
            title: 'New comment on Bengaluru Events',
            detail: 'Ananya Iyer commented on Diwali celebration 2026',
            itemType: 'budget',
            itemId: BUDGETS.bengaluru,
            itemRef: 'EX-IN-BLR',
            channelsDelivered: ['in_app'],
            createdAt: new Date('2026-11-04T09:30:00Z'),
          },
        ])
        .onConflictDoNothing();

      // 8. Channel delivery logs
      await tx
        .insert(s.channelDeliveries)
        .values([
          {
            id: P8_IDS.deliveries.slackCardLunch,
            tenantId: TENANTS.acme,
            channel: 'slack',
            recipientPersonId: userById('location-manager').personId!,
            kind: 'approval.assigned',
            subjectType: 'request',
            subjectId: P5_IDS.requests.teamLunch,
            status: 'sent',
            attempts: 1,
            externalMessageId: 'slack-msg-lunch-01',
            payload: { title: 'Team lunch: Platform squad', channel: '@rahul.menon' },
            createdAt: new Date('2026-11-15T10:00:05Z'),
          },
          {
            id: P8_IDS.deliveries.slackCardCofunding,
            tenantId: TENANTS.acme,
            channel: 'slack',
            recipientPersonId: userById('regional-manager').personId!,
            kind: 'approval.assigned',
            subjectType: 'contribution',
            subjectId: P5_IDS.contributions.pending,
            status: 'sent',
            attempts: 1,
            externalMessageId: 'slack-msg-cofund-02',
            payload: { title: 'Gifts for the Hyderabad attendees', channel: '@ananya.iyer' },
            createdAt: new Date('2026-11-15T11:00:05Z'),
          },
          {
            id: P8_IDS.deliveries.emailCardLunch,
            tenantId: TENANTS.acme,
            channel: 'email',
            recipientPersonId: userById('location-manager').personId!,
            kind: 'approval.requested',
            subjectType: 'request',
            subjectId: P5_IDS.requests.teamLunch,
            status: 'sent',
            attempts: 1,
            externalMessageId: 'smtp-msg-lunch-01',
            payload: { title: 'Approve USD 216.00: Team lunch: Platform squad' },
            createdAt: new Date('2026-11-15T10:00:02Z'),
          },
        ])
        .onConflictDoNothing();
    });
  } finally {
    await ctx.close();
  }
}
