import { BUDGETS, seedId, TENANTS } from './ids';
import { userById } from './roles';

/**
 * Phase 10 seed (prefix 81): saved report views, the three scheduled deliveries of screen 091 with
 * one past run, and a recent export. All data is fictional; schedules carry no figures, only filters.
 */
export const P10_IDS = {
  views: {
    indiaUtilization: seedId('81000000', 1),
    unusedWatch: seedId('81000000', 2),
    eventSpendFy2026: seedId('81000000', 3),
  },
  schedules: {
    indiaUtilizationWeekly: seedId('81000000', 10),
    monthlyBoardPack: seedId('81000000', 11),
    unusedBudgetDaily: seedId('81000000', 12),
  },
  runs: {
    indiaUtilizationLast: seedId('81000000', 20),
  },
  exports: {
    indiaUtilizationPdf: seedId('81000000', 30),
  },
} as const;

const T = TENANTS.acme;

export const P10_SAVED_VIEWS = [
  {
    id: P10_IDS.views.indiaUtilization,
    tenantId: T,
    reportId: 'utilization',
    name: 'India utilization, monthly',
    filters: { rootBudgetId: BUDGETS.india, groupBy: 'budget' },
    favourite: true,
    ownerPersonId: userById('regional-manager').personId!,
  },
  {
    id: P10_IDS.views.unusedWatch,
    tenantId: T,
    reportId: 'unused-expired',
    name: 'Unused budget watchlist',
    filters: {},
    favourite: true,
    ownerPersonId: userById('finance-admin').personId!,
  },
  {
    id: P10_IDS.views.eventSpendFy2026,
    tenantId: T,
    reportId: 'event-spending',
    name: 'Event spending FY2026',
    filters: { groupBy: 'event' },
    favourite: false,
    ownerPersonId: userById('finance-controller').personId!,
  },
] as const;

export const P10_SCHEDULES = [
  {
    id: P10_IDS.schedules.indiaUtilizationWeekly,
    tenantId: T,
    name: 'India utilization, weekly',
    reportId: 'utilization',
    savedViewId: P10_IDS.views.indiaUtilization,
    filters: { rootBudgetId: BUDGETS.india, groupBy: 'budget' },
    formats: ['pdf'],
    frequency: 'weekly',
    weekday: 1,
    dayOfMonth: null,
    sendTime: '08:00',
    timezone: 'Asia/Kolkata',
    recipientPersonIds: [
      userById('location-manager').personId!,
      userById('finance-controller').personId!,
    ],
    channels: [{ provider: 'slack', channel: '#india-leads' }],
    message: 'Weekly utilization for India Region.',
    ownerPersonId: userById('regional-manager').personId!,
    active: true,
    lastRunStatus: 'delivered',
  },
  {
    id: P10_IDS.schedules.monthlyBoardPack,
    tenantId: T,
    name: 'Monthly board pack',
    reportId: 'budget-vs-actual',
    savedViewId: null,
    filters: {},
    formats: ['pdf', 'xlsx'],
    frequency: 'monthly_after_close',
    weekday: null,
    dayOfMonth: 5,
    sendTime: '07:00',
    timezone: 'America/New_York',
    recipientPersonIds: [userById('ceo').personId!, userById('finance-admin').personId!],
    channels: [],
    message: 'Budget versus actual for the closed month.',
    ownerPersonId: userById('finance-controller').personId!,
    active: true,
    lastRunStatus: null,
  },
  {
    id: P10_IDS.schedules.unusedBudgetDaily,
    tenantId: T,
    name: 'Unused budget, weekdays',
    reportId: 'unused-expired',
    savedViewId: P10_IDS.views.unusedWatch,
    filters: {},
    formats: ['csv'],
    frequency: 'daily_weekdays',
    weekday: null,
    dayOfMonth: null,
    sendTime: '07:30',
    timezone: 'America/New_York',
    recipientPersonIds: [userById('finance-controller').personId!],
    channels: [{ provider: 'slack', channel: '#finance-reports' }],
    message: null,
    ownerPersonId: userById('finance-admin').personId!,
    active: true,
    lastRunStatus: null,
  },
] as const;

export const P10_SCHEDULE_RUN = {
  id: P10_IDS.runs.indiaUtilizationLast,
  tenantId: T,
  scheduleId: P10_IDS.schedules.indiaUtilizationWeekly,
  trigger: 'scheduled',
  status: 'delivered',
  deliveredCount: 2,
  skippedCount: 0,
  channelCount: 1,
  rowCount: 4,
  skipped: [],
  exportIds: [P10_IDS.exports.indiaUtilizationPdf],
} as const;

export const P10_EXPORT = {
  id: P10_IDS.exports.indiaUtilizationPdf,
  tenantId: T,
  reportId: 'utilization',
  format: 'pdf',
  filters: { rootBudgetId: BUDGETS.india, groupBy: 'budget' },
  rowCount: 4,
  status: 'ready',
  scheduleId: P10_IDS.schedules.indiaUtilizationWeekly,
  requestedByPersonId: userById('regional-manager').personId!,
} as const;
