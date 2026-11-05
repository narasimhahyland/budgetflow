import { BUDGETS, ORG_UNITS, seedId, TENANTS } from './ids';
import { P5_EVENT } from './events';

/**
 * Phase 9 seed (prefix 78): company event templates, the plan, invitations, RSVPs and attendee needs
 * of the Diwali celebration, its catering quotes, and a wellbeing week taken through attendance,
 * the attendance-based split and a post-event survey. Company Hyland; everything else is fictional.
 */
const T = TENANTS.acme;

export const P9_IDS = {
  templates: {
    diwali: seedId('78000000', 1),
    teamLunch: seedId('78000000', 2),
    offsite: seedId('78000000', 3),
    townhall: seedId('78000000', 4),
    wellbeing: seedId('78000000', 5),
  },
  wellbeingEvent: seedId('78000000', 20),
  quoteRequest: seedId('78000000', 30),
} as const;

type Section = 'before' | 'on_the_day' | 'after';

const task = (
  section: Section,
  title: string,
  relativeDueDays: number,
  linkedItemType: string | null = null,
) => ({
  section,
  title,
  relativeDueDays,
  ownerRole: 'organizer' as const,
  linkedItemType,
  isSystem: linkedItemType !== null,
});

const agenda = (
  startTime: string,
  endTime: string,
  title: string,
  locationRoom: string,
  visibleToInvitees = true,
) => ({
  startTime,
  endTime,
  title,
  locationRoom,
  hostName: null,
  notes: null,
  visibleToInvitees,
});

const RATING_QUESTIONS = [
  {
    id: 'rating',
    type: 'rating' as const,
    prompt: 'How would you rate the event?',
    required: true,
  },
  {
    id: 'again',
    type: 'yes_no' as const,
    prompt: 'Would you attend a similar event again?',
    required: true,
  },
  {
    id: 'change',
    type: 'short_text' as const,
    prompt: 'What should we change next time?',
    required: false,
  },
];

const NEEDS_CONFIG = {
  collectDietary: true,
  collectAccessibility: true,
  collectTravel: false,
  collectPhotoConsent: true,
};

/** Company templates every organizer can start from (estimates per attendee in USD minor units). */
export const P9_TEMPLATES = [
  {
    id: P9_IDS.templates.diwali,
    name: 'Diwali celebration',
    category: 'employee_events',
    eventType: 'celebration',
    typicalDuration: 'One evening',
    locationType: 'office' as const,
    estimatePerAttendeeMinor: 4_000,
    toleranceBps: 500,
    costSplitRule: 'location' as const,
    preferredVendorNames: ['Spice Route Caterers', 'Deccan Event Studio'],
    checklistTasks: [
      task('before', 'Confirm the venue booking', -21),
      task('before', 'Choose a caterer', -14, 'quote'),
      task('before', 'Send invitations', -10, 'invitations'),
      task('before', 'Book the photographer', -7),
      task('before', 'Order decorations', -7),
      task('before', 'Share the dietary counts with the caterer', -2),
      task('on_the_day', 'Set up the registration desk', 0),
      task('on_the_day', 'Mark attendance', 0, 'attendance'),
      task('after', 'Upload receipts within 7 days', 7),
      task('after', 'Send the feedback survey', 1, 'survey'),
      task('after', 'Start reconciliation', 10),
    ],
    agendaItems: [
      agenda('18:00', '18:30', 'Welcome and lamp lighting', 'Atrium'),
      agenda('18:30', '19:15', 'Rangoli contest', 'Atrium'),
      agenda('19:15', '20:30', 'Dinner', 'Cafeteria'),
      agenda('20:30', '21:30', 'Awards', 'Atrium'),
    ],
    invitationDefaults: {
      message:
        'Join us for the Diwali celebration: lamp lighting, a rangoli contest, dinner and awards. Please tell us whether you can come.',
      rsvpDeadlineDaysBefore: 4,
      capacity: 200,
      waitlistEnabled: true,
    },
    needsConfig: NEEDS_CONFIG,
    surveyQuestions: RATING_QUESTIONS,
  },
  {
    id: P9_IDS.templates.teamLunch,
    name: 'Quarterly team lunch',
    category: 'team_events',
    eventType: 'team_lunch',
    typicalDuration: 'Two hours',
    locationType: 'office' as const,
    estimatePerAttendeeMinor: 1_800,
    toleranceBps: 300,
    costSplitRule: 'cost_center' as const,
    preferredVendorNames: ['Garden City Catering Co.'],
    checklistTasks: [
      task('before', 'Pick the date with the team', -14),
      task('before', 'Book the restaurant or the caterer', -7, 'quote'),
      task('before', 'Send invitations', -5, 'invitations'),
      task('on_the_day', 'Mark attendance', 0, 'attendance'),
      task('after', 'Upload the bill', 3),
    ],
    agendaItems: [agenda('12:30', '14:00', 'Team lunch', 'Cafeteria')],
    invitationDefaults: {
      message: 'Our quarterly team lunch. Let us know whether you can join so we can order enough.',
      rsvpDeadlineDaysBefore: 3,
      capacity: null,
      waitlistEnabled: false,
    },
    needsConfig: NEEDS_CONFIG,
    surveyQuestions: RATING_QUESTIONS.slice(0, 2),
  },
  {
    id: P9_IDS.templates.offsite,
    name: 'Team offsite',
    category: 'team_events',
    eventType: 'offsite',
    typicalDuration: 'Two days',
    locationType: 'venue' as const,
    estimatePerAttendeeMinor: 30_000,
    toleranceBps: 500,
    costSplitRule: 'location' as const,
    preferredVendorNames: ['Lakeside Banquets', 'Harbor View Hotel Group'],
    checklistTasks: [
      task('before', 'Agree the goals with the team leads', -56),
      task('before', 'Shortlist venues and ask for quotes', -42, 'quote'),
      task('before', 'Confirm travel and hotel nights', -28),
      task('before', 'Send invitations', -21, 'invitations'),
      task('before', 'Collect dietary and travel needs', -14),
      task('on_the_day', 'Mark attendance', 0, 'attendance'),
      task('after', 'Send the feedback survey', 1, 'survey'),
      task('after', 'Upload receipts within 7 days', 7),
    ],
    agendaItems: [
      agenda('09:00', '10:30', 'Where we are', 'Main hall'),
      agenda('10:45', '12:30', 'Planning workshop', 'Main hall'),
      agenda('13:30', '17:00', 'Team activities', 'Lawn'),
      agenda('19:00', '21:00', 'Dinner', 'Restaurant'),
    ],
    invitationDefaults: {
      message:
        'Two days away from the desk to plan the next quarter together. Tell us whether you can come and what you need to travel.',
      rsvpDeadlineDaysBefore: 14,
      capacity: 80,
      waitlistEnabled: true,
    },
    needsConfig: { ...NEEDS_CONFIG, collectTravel: true },
    surveyQuestions: RATING_QUESTIONS,
  },
  {
    id: P9_IDS.templates.townhall,
    name: 'Townhall',
    category: 'company_events',
    eventType: 'townhall',
    typicalDuration: 'Ninety minutes',
    locationType: 'office' as const,
    estimatePerAttendeeMinor: 1_200,
    toleranceBps: 300,
    costSplitRule: 'legal_entity' as const,
    preferredVendorNames: ['Deccan Event Studio'],
    checklistTasks: [
      task('before', 'Agree the agenda with the leadership team', -14),
      task('before', 'Book the room and the sound system', -10, 'quote'),
      task('before', 'Send invitations', -7, 'invitations'),
      task('on_the_day', 'Mark attendance', 0, 'attendance'),
      task('after', 'Share the recording and the slides', 2),
    ],
    agendaItems: [
      agenda('15:00', '15:30', 'Business update', 'Auditorium'),
      agenda('15:30', '16:00', 'Team highlights', 'Auditorium'),
      agenda('16:00', '16:30', 'Questions', 'Auditorium'),
    ],
    invitationDefaults: {
      message: 'Our quarterly townhall: business update, team highlights and your questions.',
      rsvpDeadlineDaysBefore: 2,
      capacity: 300,
      waitlistEnabled: false,
    },
    needsConfig: { ...NEEDS_CONFIG, collectDietary: false },
    surveyQuestions: RATING_QUESTIONS.slice(0, 2),
  },
  {
    id: P9_IDS.templates.wellbeing,
    name: 'Wellbeing week',
    category: 'employee_events',
    eventType: 'wellbeing',
    typicalDuration: 'Five days',
    locationType: 'office' as const,
    estimatePerAttendeeMinor: 2_500,
    toleranceBps: 500,
    costSplitRule: 'location' as const,
    preferredVendorNames: ['Cloud Nine Wellness'],
    checklistTasks: [
      task('before', 'Agree the week with the people team', -30),
      task('before', 'Book the sessions', -21, 'quote'),
      task('before', 'Send invitations', -14, 'invitations'),
      task('on_the_day', 'Mark attendance', 0, 'attendance'),
      task('after', 'Send the feedback survey', 1, 'survey'),
    ],
    agendaItems: [
      agenda('08:00', '09:00', 'Morning yoga', 'Studio'),
      agenda('12:30', '13:30', 'Nutrition talk', 'Cafeteria'),
      agenda('17:00', '18:00', 'Guided walk', 'Campus'),
    ],
    invitationDefaults: {
      message:
        'A week of yoga, talks and walks. Join whichever sessions suit you and tell us if you need anything.',
      rsvpDeadlineDaysBefore: 5,
      capacity: 60,
      waitlistEnabled: true,
    },
    needsConfig: NEEDS_CONFIG,
    surveyQuestions: RATING_QUESTIONS,
  },
];

/** The Diwali celebration's catering quotes (51a): three vendors, the preferred one not the lowest. */
export const P9_QUOTE_REQUEST = {
  id: P9_IDS.quoteRequest,
  eventId: P5_EVENT.id,
  title: 'Catering for the Diwali celebration',
  category: 'catering',
  description: 'Festive dinner with vegetarian and non-vegetarian counters, 230 people.',
  quantity: 230,
  neededBy: '2026-11-20',
  respondBy: '2026-11-12',
  vendorNames: ['Spice Route Caterers', 'Garden City Catering Co.', 'Deccan Event Studio'],
  quotes: [
    {
      vendorName: 'Spice Route Caterers',
      amount: { USD: 300_000, INR: 25_000_000 },
      depositPct: 20,
      depositRefundable: false,
      depositTerms: 'Non-refundable within 7 days of the event',
      cancellationTerms: 'Free until 12 November',
      validUntil: '2026-11-18',
      includesText: 'GST, service and one live counter',
    },
    {
      vendorName: 'Garden City Catering Co.',
      amount: { USD: 278_000, INR: 23_166_000 },
      depositPct: 30,
      depositRefundable: true,
      depositTerms: 'Refundable until 10 November',
      cancellationTerms: 'Free until 10 November',
      validUntil: '2026-11-15',
      includesText: 'GST and service',
    },
    {
      vendorName: 'Deccan Event Studio',
      amount: { USD: 334_000, INR: 27_833_000 },
      depositPct: 25,
      depositRefundable: false,
      depositTerms: 'Non-refundable',
      cancellationTerms: 'Free until 14 November',
      validUntil: '2026-11-30',
      includesText: 'GST, service and two live counters',
    },
  ],
  /** Chosen over the lowest quote, so the reason is kept with the audit entry. */
  selection: {
    vendorName: 'Spice Route Caterers',
    reason: 'Preferred vendor, and the only one including the live counter the teams asked for.',
  },
};

/** RSVP answers on the Diwali celebration, by position in `P5_EVENT.participants`. */
export const P9_DIWALI_RSVPS = [
  { index: 0, status: 'going' as const },
  { index: 1, status: 'going' as const },
  { index: 2, status: 'going' as const },
  { index: 3, status: 'cant_go' as const },
  { index: 4, status: 'going' as const },
  { index: 5, status: 'going' as const },
  { index: 6, status: 'invited' as const },
  { index: 7, status: 'going' as const },
];

/** Attendee needs on the Diwali celebration, by position in `P5_EVENT.participants`. */
export const P9_DIWALI_NEEDS = [
  {
    index: 0,
    dietaryPreference: 'vegetarian',
    allergies: [],
    severeAllergy: false,
    accessibility: [],
  },
  {
    index: 1,
    dietaryPreference: 'vegan',
    allergies: ['nuts'],
    severeAllergy: true,
    accessibility: [],
  },
  {
    index: 2,
    dietaryPreference: 'no_preference',
    allergies: ['gluten'],
    severeAllergy: false,
    accessibility: ['step_free_access'],
  },
  { index: 4, dietaryPreference: 'jain', allergies: [], severeAllergy: false, accessibility: [] },
  {
    index: 5,
    dietaryPreference: 'vegetarian',
    allergies: ['dairy'],
    severeAllergy: false,
    accessibility: ['seating_near_an_exit'],
  },
];

/**
 * A wellbeing week that already happened: attendance is final, the attendance-based split has been
 * applied and the survey is open with enough answers to show results (54a, 54b).
 */
export const P9_WELLBEING_EVENT = {
  id: P9_IDS.wellbeingEvent,
  name: 'Bengaluru wellbeing week 2026',
  eventType: 'wellbeing',
  eventCode: 'EV-2026-WELLBEING',
  homeBudgetId: BUDGETS.bengaluru,
  organizer: 'event-organizer' as const,
  approver: 'location-manager' as const,
  startsAt: '2026-10-19T03:30:00.000Z',
  endsAt: '2026-10-23T12:30:00.000Z',
  venue: 'Bengaluru office studio and campus',
  description:
    'A week of yoga, nutrition talks and guided walks for the Bengaluru and Hyderabad teams.',
  locations: [ORG_UNITS.bengaluru, ORG_UNITS.hyderabad],
  toleranceBps: 500,
  ownFunds: { USD: 150_000, INR: 12_500_000 },
  perHeadLimit: { USD: 5_000, INR: 420_000 },
  expectedAttendance: 60,
  costLines: [
    {
      category: 'wellbeing',
      description: 'Yoga and nutrition sessions',
      quantity: 5,
      unit: { USD: 18_000, INR: 1_500_000 },
    },
    {
      category: 'catering',
      description: 'Healthy lunch for the sessions',
      quantity: 60,
      unit: { USD: 1_000, INR: 83_000 },
    },
  ],
  commitment: {
    description: 'Wellbeing sessions: Cloud Nine Wellness',
    vendorName: 'Cloud Nine Wellness',
    amount: { USD: 90_000, INR: 7_500_000 },
  },
  /** Who came: everyone invited is marked, so attendance can be made final. */
  attended: [0, 1, 2, 4, 5, 7, 8],
  noShow: [3, 6],
  survey: {
    responses: [
      {
        index: 0,
        rating: 5,
        wouldAttendAgain: true,
        comment: 'The morning yoga was the best part.',
      },
      {
        index: 1,
        rating: 4,
        wouldAttendAgain: true,
        comment: 'More vegan options at lunch please.',
      },
      { index: 2, rating: 5, wouldAttendAgain: true, comment: null },
      { index: 4, rating: 4, wouldAttendAgain: true, comment: 'Guided walks were too short.' },
      { index: 5, rating: 3, wouldAttendAgain: false, comment: null },
      { index: 7, rating: 5, wouldAttendAgain: true, comment: 'Please run this every quarter.' },
    ],
  },
  notes:
    'Book the studio eight weeks ahead; the nutrition talk filled up first and needed a second session.',
};

export const P9_TENANT = T;
