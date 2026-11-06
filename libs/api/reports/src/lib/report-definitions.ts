import type { ReportFormat, ReportGroupBy, ReportId } from '@bf/contracts';

export interface ReportSpec {
  reportId: ReportId;
  name: string;
  question: string;
  group: 'budgets' | 'comparisons' | 'events' | 'fairness';
  /** Screen number in the inventory, so a figure can be traced back to its spec. */
  screen: string;
  groupBys: ReportGroupBy[];
  defaultGroupBy: ReportGroupBy;
  formats: ReportFormat[];
  /** A budget owner may open it, scoped to their subtree. */
  ownerScoped: boolean;
}

const ALL_FORMATS: ReportFormat[] = ['csv', 'xlsx', 'pdf'];

/** The Phase 10 catalog, organised by the question people ask rather than by data source. */
export const REPORT_SPECS: Record<ReportId, ReportSpec> = {
  'budget-vs-actual': {
    reportId: 'budget-vs-actual',
    name: 'Budget versus actual',
    question: 'How much of what we authorized have we actually spent?',
    group: 'budgets',
    screen: '080',
    groupBys: ['budget', 'location', 'department', 'legal_entity', 'cost_center', 'category'],
    defaultGroupBy: 'budget',
    formats: ALL_FORMATS,
    ownerScoped: true,
  },
  allocation: {
    reportId: 'allocation',
    name: 'Allocation',
    question: 'Who allocated how much to whom, and what is still unallocated?',
    group: 'budgets',
    screen: '081',
    groupBys: ['budget'],
    defaultGroupBy: 'budget',
    formats: ALL_FORMATS,
    ownerScoped: true,
  },
  utilization: {
    reportId: 'utilization',
    name: 'Utilization',
    question: 'How much of each budget is pending, committed, spent and still available?',
    group: 'budgets',
    screen: '082',
    groupBys: ['budget', 'location', 'department', 'legal_entity', 'category'],
    defaultGroupBy: 'budget',
    formats: ALL_FORMATS,
    ownerScoped: true,
  },
  'unused-expired': {
    reportId: 'unused-expired',
    name: 'Unused and expired budget',
    question: 'Which budgets will end the year with money unused?',
    group: 'budgets',
    screen: '086',
    groupBys: ['budget'],
    defaultGroupBy: 'budget',
    formats: ALL_FORMATS,
    ownerScoped: true,
  },
  'location-comparison': {
    reportId: 'location-comparison',
    name: 'Location comparison',
    question: 'How do our locations compare on budget and spend?',
    group: 'comparisons',
    screen: '083',
    groupBys: ['location'],
    defaultGroupBy: 'location',
    formats: ALL_FORMATS,
    ownerScoped: true,
  },
  'department-comparison': {
    reportId: 'department-comparison',
    name: 'Department comparison',
    question: 'How do our departments and teams compare on budget and spend?',
    group: 'comparisons',
    screen: '084',
    groupBys: ['department'],
    defaultGroupBy: 'department',
    formats: ALL_FORMATS,
    ownerScoped: true,
  },
  'event-spending': {
    reportId: 'event-spending',
    name: 'Event spending',
    question: 'Where does event money go, and which events ran over or under?',
    group: 'events',
    screen: '085',
    groupBys: ['event', 'location', 'status', 'month'],
    defaultGroupBy: 'event',
    formats: ALL_FORMATS,
    ownerScoped: true,
  },
  'spend-per-head': {
    reportId: 'spend-per-head',
    name: 'Spend per head by location',
    question: 'Does engagement money reach every location fairly?',
    group: 'fairness',
    screen: '015a',
    groupBys: ['location'],
    defaultGroupBy: 'location',
    formats: ALL_FORMATS,
    ownerScoped: false,
  },
  'participation-reach': {
    reportId: 'participation-reach',
    name: 'Participation and reach',
    question: 'Does the money reach people, not only get spent?',
    group: 'fairness',
    screen: '015b',
    groupBys: ['location', 'department'],
    defaultGroupBy: 'location',
    formats: ALL_FORMATS,
    ownerScoped: false,
  },
  'forecast-variance': {
    reportId: 'forecast-variance',
    name: 'Forecast and variance',
    question: 'Where will the year land against what we authorized, and why?',
    group: 'budgets',
    screen: '087',
    groupBys: ['budget'],
    defaultGroupBy: 'budget',
    formats: ALL_FORMATS,
    ownerScoped: true,
  },
};

export const REPORT_LIST: ReportSpec[] = Object.values(REPORT_SPECS);
