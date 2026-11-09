import type {
  DigestSectionConfig,
  NotificationMatrixRow,
  NotificationPreferenceType,
  RoleId,
} from '@bf/contracts';

export interface MatrixSpec {
  type: NotificationPreferenceType;
  area: 'approvals' | 'budgets' | 'events' | 'discussion' | 'finance';
  label: string;
  required: boolean;
}

export const NOTIFICATION_MATRIX_SPECS: readonly MatrixSpec[] = [
  // Approvals
  {
    type: 'approval.assigned',
    area: 'approvals',
    label: 'Assigned to me',
    required: true,
  },
  {
    type: 'approval.escalated',
    area: 'approvals',
    label: 'Escalated to me',
    required: true,
  },
  {
    type: 'approval.reminder',
    area: 'approvals',
    label: 'Reminders before the SLA',
    required: false,
  },
  {
    type: 'approval.decided',
    area: 'approvals',
    label: 'Decided on my request',
    required: true,
  },
  // Budgets I own
  {
    type: 'budget.threshold_50',
    area: 'budgets',
    label: 'Alert threshold 50%',
    required: false,
  },
  {
    type: 'budget.threshold_80',
    area: 'budgets',
    label: 'Alert threshold 80%',
    required: false,
  },
  {
    type: 'budget.threshold_100',
    area: 'budgets',
    label: 'Alert threshold 100%',
    required: false,
  },
  {
    type: 'budget.control_changed',
    area: 'budgets',
    label: 'Frozen, reduced or set to zero',
    required: true,
  },
  {
    type: 'budget.allocation_received',
    area: 'budgets',
    label: 'Allocation received',
    required: false,
  },
  {
    type: 'contribution.received',
    area: 'budgets',
    label: 'Co-funding request received',
    required: false,
  },
  // Events
  {
    type: 'event.invitation',
    area: 'events',
    label: 'Invitations and RSVP reminders',
    required: false,
  },
  {
    type: 'event.changed',
    area: 'events',
    label: 'Event changed or cancelled',
    required: false,
  },
  {
    type: 'event.task_assigned',
    area: 'events',
    label: 'Task assigned to me',
    required: false,
  },
  // Discussion
  {
    type: 'discussion.mentioned',
    area: 'discussion',
    label: 'Mentions of me',
    required: false,
  },
  {
    type: 'discussion.replied',
    area: 'discussion',
    label: 'Replies to my comments',
    required: false,
  },
  {
    type: 'discussion.followed_activity',
    area: 'discussion',
    label: 'Activity on items I follow',
    required: false,
  },
  // Finance tasks
  {
    type: 'finance.receipt_needed',
    area: 'finance',
    label: 'Receipt needed',
    required: false,
  },
  {
    type: 'finance.forecast_due',
    area: 'finance',
    label: 'Forecast commentary required',
    required: false,
  },
  {
    type: 'finance.sign_off_ready',
    area: 'finance',
    label: 'Sign-off ready',
    required: false,
  },
] as const;

export function buildMatrixRows(
  stored: Record<
    string,
    { inApp?: boolean; email?: boolean; push?: boolean; slack?: boolean; teams?: boolean }
  >,
  hasSlack: boolean,
  hasTeams: boolean,
): NotificationMatrixRow[] {
  return NOTIFICATION_MATRIX_SPECS.map((spec) => {
    const custom = stored[spec.type] ?? {};
    const defaultOptional = [
      'approval.reminder',
      'budget.threshold_80',
      'budget.threshold_100',
      'contribution.received',
      'discussion.mentioned',
      'finance.receipt_needed',
    ].includes(spec.type);
    return {
      type: spec.type,
      area: spec.area,
      label: spec.label,
      required: spec.required,
      inApp: spec.required ? true : (custom.inApp ?? true),
      email: spec.required ? true : (custom.email ?? defaultOptional),
      push: custom.push ?? (spec.required || spec.type === 'discussion.mentioned'),
      slack: hasSlack ? (custom.slack ?? (spec.required || defaultOptional)) : false,
      teams: hasTeams ? (custom.teams ?? false) : false,
    };
  });
}

export const COMPANY_QUIET_START = '20:00';
export const COMPANY_QUIET_END = '08:00';

/**
 * Quiet hours validation (screen 059c): users may extend the company default quiet hours
 * (20:00 to 08:00 local, i.e. start <= 20:00 and end >= 08:00), never shorten them.
 */
export function isQuietHoursValid(start: string, end: string): boolean {
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  const s = toMin(start);
  const e = toMin(end);
  const defaultStart = toMin(COMPANY_QUIET_START); // 1200 (20:00)
  const defaultEnd = toMin(COMPANY_QUIET_END); // 480 (08:00)
  return s <= defaultStart && s >= 12 * 60 && e >= defaultEnd && e <= 11 * 60;
}

export interface DefaultDigestSpec {
  code: string;
  name: string;
  audienceRoles: RoleId[];
  frequency: 'daily_weekdays' | 'weekly';
  weekday: number | null;
  sendTime: string;
  channelsAllowed: ('email' | 'slack' | 'teams')[];
  introLine: string;
  sections: DigestSectionConfig[];
}

export const DEFAULT_DIGEST_TEMPLATES: readonly DefaultDigestSpec[] = [
  {
    code: 'APPROVER_DAILY',
    name: 'Approver daily digest',
    audienceRoles: [
      'ceo',
      'finance-admin',
      'finance-controller',
      'budget-owner',
      'department-head',
      'regional-manager',
      'location-manager',
    ],
    frequency: 'daily_weekdays',
    weekday: null,
    sendTime: '08:30',
    channelsAllowed: ['email', 'slack', 'teams'],
    introLine: 'Approvals waiting for your decision today, ordered by due time.',
    sections: [
      {
        key: 'waiting_for_you',
        label: 'Waiting for you (count, oldest, due today)',
        enabled: true,
        maxItems: 5,
      },
      { key: 'escalated_to_you', label: 'Escalated to you', enabled: true, maxItems: 5 },
      { key: 'delegations', label: 'Delegations starting or ending', enabled: true, maxItems: 5 },
    ],
  },
  {
    code: 'OWNER_WEEKLY',
    name: 'Owner weekly digest',
    audienceRoles: ['budget-owner', 'department-head', 'regional-manager', 'location-manager'],
    frequency: 'weekly',
    weekday: 1,
    sendTime: '08:30',
    channelsAllowed: ['email', 'slack', 'teams'],
    introLine:
      'Your budgets this week: available under each budget’s rules, thresholds and open items.',
    sections: [
      {
        key: 'budget_position',
        label: 'Budget position (available, utilization, change since last week)',
        enabled: true,
        maxItems: 5,
      },
      { key: 'thresholds_crossed', label: 'Thresholds crossed', enabled: true, maxItems: 5 },
      { key: 'pending_requests', label: 'Pending requests', enabled: true, maxItems: 5 },
      { key: 'unused_budget', label: 'Unused budget days left', enabled: true, maxItems: 5 },
      { key: 'receipts_missing', label: 'Receipts missing', enabled: true, maxItems: 5 },
    ],
  },
  {
    code: 'ORGANIZER_WEEKLY',
    name: 'Organizer weekly digest',
    audienceRoles: ['event-organizer', 'location-manager'],
    frequency: 'weekly',
    weekday: 1,
    sendTime: '08:30',
    channelsAllowed: ['email', 'slack'],
    introLine: 'Upcoming events, funding status and receipts still needed.',
    sections: [
      {
        key: 'upcoming_events',
        label: 'Upcoming events with RSVP counts',
        enabled: true,
        maxItems: 5,
      },
      { key: 'open_tasks', label: 'Open tasks and funding requests', enabled: true, maxItems: 5 },
      { key: 'receipts_missing', label: 'Receipts missing', enabled: true, maxItems: 5 },
    ],
  },
  {
    code: 'FINANCE_WEEKLY',
    name: 'Finance weekly digest',
    audienceRoles: ['finance-controller', 'finance-admin'],
    frequency: 'weekly',
    weekday: 1,
    sendTime: '08:00',
    channelsAllowed: ['email', 'slack', 'teams'],
    introLine: 'Queues that need finance attention before month-end close.',
    sections: [
      { key: 'unmatched_actuals', label: 'Unmatched actuals by age', enabled: true, maxItems: 5 },
      { key: 'accruals_review', label: 'Accruals to review', enabled: true, maxItems: 5 },
      { key: 'tieout_status', label: 'GL tie-out status', enabled: true, maxItems: 5 },
      {
        key: 'recharges_pending',
        label: 'Intercompany recharges awaiting tax approval',
        enabled: true,
        maxItems: 5,
      },
    ],
  },
  {
    code: 'EXECUTIVE_WEEKLY',
    name: 'Executive weekly digest',
    audienceRoles: ['ceo'],
    frequency: 'weekly',
    weekday: 1,
    sendTime: '08:00',
    channelsAllowed: ['email', 'slack'],
    introLine: 'Company-wide Available, regional utilization and active budget controls.',
    sections: [
      {
        key: 'company_available',
        label: 'Company-wide Available and utilization by region',
        enabled: true,
        maxItems: 5,
      },
      {
        key: 'controls_applied',
        label: 'Controls applied (freeze, reduce, set to zero)',
        enabled: true,
        maxItems: 5,
      },
      {
        key: 'approval_cycle',
        label: 'Approval cycle time and pending executive items',
        enabled: true,
        maxItems: 5,
      },
    ],
  },
] as const;
