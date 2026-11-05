import { BUDGETS, seedId, TENANTS } from './ids';
import { P5_IDS } from './events';
import { userById } from './roles';

/**
 * Phase 8 seed (prefix 80): Slack and Microsoft Teams installations, linked accounts for key
 * approvers and organizers, push devices, discussion comments and mentions on the Diwali event
 * and team lunch request, followed items, role-based digest templates, notifications and delivery logs.
 */
export const P8_IDS = {
  installations: {
    slack: seedId('80000000', 1),
    teams: seedId('80000000', 2),
  },
  links: {
    regionalManagerSlack: seedId('80000000', 10),
    locationManagerSlack: seedId('80000000', 11),
    departmentHeadSlack: seedId('80000000', 12),
    eventOrganizerSlack: seedId('80000000', 13),
    financeControllerSlack: seedId('80000000', 14),
    regionalManagerTeams: seedId('80000000', 15),
    locationManagerTeams: seedId('80000000', 16),
  },
  pushDevices: {
    regionalManagerPixel: seedId('80000000', 20),
    locationManagerPixel: seedId('80000000', 21),
  },
  comments: {
    diwaliQuote: seedId('80000000', 30),
    diwaliReply: seedId('80000000', 31),
    diwaliApprovedNote: seedId('80000000', 32),
    lunchComment: seedId('80000000', 33),
  },
  follows: {
    regionalManagerDiwali: seedId('80000000', 40),
    organizerBengaluru: seedId('80000000', 41),
    locationManagerLunch: seedId('80000000', 42),
  },
  digests: {
    approverDaily: seedId('80000000', 50),
    ownerWeekly: seedId('80000000', 51),
    organizerWeekly: seedId('80000000', 52),
    financeWeekly: seedId('80000000', 53),
    executiveWeekly: seedId('80000000', 54),
  },
  notifications: {
    lmApprovalWaiting: seedId('80000000', 60),
    lmMentioned: seedId('80000000', 61),
    rmCofundingWaiting: seedId('80000000', 62),
    rmMentioned: seedId('80000000', 63),
    eoSnacksApproved: seedId('80000000', 64),
    eoReply: seedId('80000000', 65),
  },
  deliveries: {
    slackCardLunch: seedId('80000000', 70),
    slackCardCofunding: seedId('80000000', 71),
    emailCardLunch: seedId('80000000', 72),
  },
} as const;

export const P8_CHAT_LINKS = [
  {
    id: P8_IDS.links.regionalManagerSlack,
    tenantId: TENANTS.acme,
    personId: userById('regional-manager').personId!,
    provider: 'slack' as const,
    providerUserId: 'U-RM-ANANYA',
    handle: '@ananya.iyer',
    verifiedEmail: userById('regional-manager').username,
  },
  {
    id: P8_IDS.links.locationManagerSlack,
    tenantId: TENANTS.acme,
    personId: userById('location-manager').personId!,
    provider: 'slack' as const,
    providerUserId: 'U-LM-RAHUL',
    handle: '@rahul.menon',
    verifiedEmail: userById('location-manager').username,
  },
  {
    id: P8_IDS.links.departmentHeadSlack,
    tenantId: TENANTS.acme,
    personId: userById('department-head').personId!,
    provider: 'slack' as const,
    providerUserId: 'U-DH-LENA',
    handle: '@lena.fischer',
    verifiedEmail: userById('department-head').username,
  },
  {
    id: P8_IDS.links.eventOrganizerSlack,
    tenantId: TENANTS.acme,
    personId: userById('event-organizer').personId!,
    provider: 'slack' as const,
    providerUserId: 'U-EO-KAVYA',
    handle: '@kavya.rao',
    verifiedEmail: userById('event-organizer').username,
  },
  {
    id: P8_IDS.links.financeControllerSlack,
    tenantId: TENANTS.acme,
    personId: userById('finance-controller').personId!,
    provider: 'slack' as const,
    providerUserId: 'U-FC-DANIEL',
    handle: '@daniel.weber',
    verifiedEmail: userById('finance-controller').username,
  },
  {
    id: P8_IDS.links.regionalManagerTeams,
    tenantId: TENANTS.acme,
    personId: userById('regional-manager').personId!,
    provider: 'teams' as const,
    providerUserId: 'ENTRA-RM-ANANYA',
    handle: 'ananya.iyer@example.test',
    verifiedEmail: userById('regional-manager').username,
  },
  {
    id: P8_IDS.links.locationManagerTeams,
    tenantId: TENANTS.acme,
    personId: userById('location-manager').personId!,
    provider: 'teams' as const,
    providerUserId: 'ENTRA-LM-RAHUL',
    handle: 'rahul.menon@example.test',
    verifiedEmail: userById('location-manager').username,
  },
] as const;

export const P8_COMMENTS = [
  {
    id: P8_IDS.comments.diwaliQuote,
    tenantId: TENANTS.acme,
    itemType: 'event',
    itemId: P5_IDS.event,
    parentCommentId: null,
    authorPersonId: userById('event-organizer').personId!,
    body: 'Caterer quote came in for 230 people. @Rahul Menon can we fund it from Bengaluru Events?',
    mentions: [userById('location-manager').personId!],
    createdAt: new Date('2026-11-03T10:12:00Z'),
  },
  {
    id: P8_IDS.comments.diwaliReply,
    tenantId: TENANTS.acme,
    itemType: 'event',
    itemId: P5_IDS.event,
    parentCommentId: P8_IDS.comments.diwaliQuote,
    authorPersonId: userById('location-manager').personId!,
    body: 'Yes, submit it. @Ananya Iyer the Hyderabad gifts share will reach you as a co-funding request.',
    mentions: [userById('regional-manager').personId!],
    createdAt: new Date('2026-11-03T11:05:00Z'),
  },
  {
    id: P8_IDS.comments.diwaliApprovedNote,
    tenantId: TENANTS.acme,
    itemType: 'event',
    itemId: P5_IDS.event,
    parentCommentId: null,
    authorPersonId: userById('regional-manager').personId!,
    body: 'Approved the first co-funding share. Please send the final headcount after RSVPs close.',
    mentions: [],
    createdAt: new Date('2026-11-04T09:30:00Z'),
  },
  {
    id: P8_IDS.comments.lunchComment,
    tenantId: TENANTS.acme,
    itemType: 'request',
    itemId: P5_IDS.requests.teamLunch,
    parentCommentId: null,
    authorPersonId: userById('event-organizer').personId!,
    body: 'Booked the restaurant for Friday at 12:30. @Rahul Menon let me know once approved.',
    mentions: [userById('location-manager').personId!],
    createdAt: new Date('2026-11-14T08:15:00Z'),
  },
] as const;

export const P8_FOLLOWS = [
  {
    id: P8_IDS.follows.regionalManagerDiwali,
    tenantId: TENANTS.acme,
    personId: userById('regional-manager').personId!,
    itemType: 'event',
    itemId: P5_IDS.event,
    level: 'all',
    source: 'manual',
  },
  {
    id: P8_IDS.follows.organizerBengaluru,
    tenantId: TENANTS.acme,
    personId: userById('event-organizer').personId!,
    itemType: 'budget',
    itemId: BUDGETS.bengaluru,
    level: 'money_decisions',
    source: 'manual',
  },
  {
    id: P8_IDS.follows.locationManagerLunch,
    tenantId: TENANTS.acme,
    personId: userById('location-manager').personId!,
    itemType: 'request',
    itemId: P5_IDS.requests.teamLunch,
    level: 'all',
    source: 'owner',
  },
] as const;
