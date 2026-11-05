import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { ccy, createdAt, day, minor, pk, tenantRef, ts, updatedAt } from './_columns';
import { documents } from './documents';
import { people } from './org';
import { commitments, events, vendors } from './spend';
import { currencies, tenants } from './tenancy';

/**
 * Phase 9 event templates: company templates (published by Finance Admin or Organization Admin) and
 * personal templates (saved by organizers). Carries estimate per attendee, tolerance, checklist,
 * agenda, invitation defaults, attendee needs config, survey questions, and preferred vendors.
 */
export const eventTemplates = pgTable(
  'event_templates',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    scope: varchar('scope', { length: 20 }).notNull().default('personal'),
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    ownerPersonId: uuid('owner_person_id').references(() => people.id),
    name: text('name').notNull(),
    category: varchar('category', { length: 50 }).notNull().default('employee_events'),
    eventType: varchar('event_type', { length: 50 }).notNull().default('celebration'),
    typicalDuration: varchar('typical_duration', { length: 100 }).notNull().default('Half day'),
    locationType: varchar('location_type', { length: 30 }).notNull().default('office'),
    estimatePerAttendeeMinor: minor('estimate_per_attendee_minor').notNull().default(0),
    useLocationLimit: boolean('use_location_limit').notNull().default(false),
    currency: ccy('currency')
      .notNull()
      .default('USD')
      .references(() => currencies.code),
    toleranceBps: integer('tolerance_bps').notNull().default(500),
    costSplitRule: varchar('cost_split_rule', { length: 30 }).notNull().default('location'),
    checklistTasks: jsonb('checklist_tasks').notNull().default([]),
    agendaItems: jsonb('agenda_items').notNull().default([]),
    invitationDefaults: jsonb('invitation_defaults').notNull().default({}),
    needsConfig: jsonb('needs_config').notNull().default({}),
    surveyQuestions: jsonb('survey_questions').notNull().default([]),
    preferredVendorIds: uuid('preferred_vendor_ids').array().notNull().default([]),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('event_templates_tenant_scope').on(t.tenantId, t.scope, t.status),
    index('event_templates_owner').on(t.tenantId, t.ownerPersonId),
  ],
);

/**
 * Recurring event series (45a): each occurrence is created as a normal Draft event up to 12 months
 * ahead; the series itself never reserves or moves money.
 */
export const eventSeries = pgTable(
  'event_series',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    name: text('name').notNull(),
    templateId: uuid('template_id').references(() => eventTemplates.id),
    organizerPersonId: uuid('organizer_person_id')
      .notNull()
      .references(() => people.id),
    frequency: varchar('frequency', { length: 20 }).notNull(),
    firstDate: day('first_date').notNull(),
    endCount: integer('end_count'),
    endDate: day('end_date'),
    customDates: jsonb('custom_dates').notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('event_series_tenant').on(t.tenantId, t.organizerPersonId)],
);

/** Checklist tasks per event (46b): Before, On the day, After; manual or system-linked. */
export const eventChecklists = pgTable(
  'event_checklists',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    section: varchar('section', { length: 20 }).notNull().default('before'),
    title: text('title').notNull(),
    description: text('description'),
    assigneePersonId: uuid('assignee_person_id').references(() => people.id),
    dueDate: day('due_date'),
    reminder: varchar('reminder', { length: 30 }),
    status: varchar('status', { length: 20 }).notNull().default('open'),
    linkedItemType: varchar('linked_item_type', { length: 30 }),
    linkedItemId: uuid('linked_item_id'),
    linkedLabel: text('linked_label'),
    isSystem: boolean('is_system').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    comments: jsonb('comments').notNull().default([]),
    completedAt: ts('completed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('event_checklists_event').on(t.tenantId, t.eventId, t.section, t.sortOrder)],
);

/** Event agenda items (46b): items marked `visible_to_invitees` appear on employee invitations. */
export const eventAgendaItems = pgTable(
  'event_agenda_items',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    startTime: varchar('start_time', { length: 20 }).notNull(),
    endTime: varchar('end_time', { length: 20 }),
    title: text('title').notNull(),
    locationRoom: text('location_room'),
    hostName: text('host_name'),
    notes: text('notes'),
    visibleToInvitees: boolean('visible_to_invitees').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('event_agenda_items_event').on(t.tenantId, t.eventId, t.sortOrder)],
);

/** Event invitation settings and RSVP state (47a). */
export const eventInvitations = pgTable(
  'event_invitations',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    message: text('message').notNull().default(''),
    deadline: ts('deadline'),
    capacity: integer('capacity'),
    waitlistEnabled: boolean('waitlist_enabled').notNull().default(true),
    autoPromoteWaitlist: boolean('auto_promote_waitlist').notNull().default(true),
    attachCalendarInvite: boolean('attach_calendar_invite').notNull().default(true),
    collectTravelNeeds: boolean('collect_travel_needs').notNull().default(false),
    reminderSchedule: jsonb('reminder_schedule').notNull().default({}),
    status: varchar('status', { length: 20 }).notNull().default('not_sent'),
    sentByPersonId: uuid('sent_by_person_id').references(() => people.id),
    sentAt: ts('sent_at'),
    closedAt: ts('closed_at'),
    remindersSentCount: integer('reminders_sent_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('event_invitations_event').on(t.tenantId, t.eventId)],
);

/** Quote requests to vendors for an event (51a). */
export const eventQuoteRequests = pgTable(
  'event_quote_requests',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    title: text('title').notNull(),
    category: varchar('category', { length: 50 }).notNull().default('catering'),
    description: text('description'),
    quantity: integer('quantity').notNull().default(1),
    neededBy: day('needed_by'),
    respondBy: day('respond_by'),
    includeDietaryCounts: boolean('include_dietary_counts').notNull().default(false),
    emailed: boolean('emailed').notNull().default(true),
    createdByPersonId: uuid('created_by_person_id').references(() => people.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('event_quote_requests_event').on(t.tenantId, t.eventId)],
);

/** Individual vendor quotes compared side by side in transaction currency and USD at the locked plan rate (51a). */
export const eventQuotes = pgTable(
  'event_quotes',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    quoteRequestId: uuid('quote_request_id')
      .notNull()
      .references(() => eventQuoteRequests.id),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id),
    status: varchar('status', { length: 20 }).notNull().default('received'),
    amountMinor: minor('amount_minor').notNull().default(0),
    currency: ccy('currency')
      .notNull()
      .default('USD')
      .references(() => currencies.code),
    budgetAmountMinor: minor('budget_amount_minor').notNull().default(0),
    budgetCurrency: ccy('budget_currency')
      .notNull()
      .default('USD')
      .references(() => currencies.code),
    perHeadMinor: minor('per_head_minor').notNull().default(0),
    depositPct: integer('deposit_pct').notNull().default(0),
    depositMinor: minor('deposit_minor').notNull().default(0),
    depositRefundable: boolean('deposit_refundable').notNull().default(true),
    depositTerms: text('deposit_terms'),
    cancellationTerms: text('cancellation_terms'),
    validUntil: day('valid_until'),
    includesText: text('includes_text'),
    documentId: uuid('document_id').references(() => documents.id),
    commitmentId: uuid('commitment_id').references(() => commitments.id),
    selectionReason: text('selection_reason'),
    selectedByPersonId: uuid('selected_by_person_id').references(() => people.id),
    selectedAt: ts('selected_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('event_quotes_event').on(t.tenantId, t.eventId),
    index('event_quotes_request').on(t.tenantId, t.quoteRequestId),
  ],
);

/** Post-event pulse survey configuration and schedule (54a). */
export const eventSurveys = pgTable(
  'event_surveys',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    anonymous: boolean('anonymous').notNull().default(true),
    questions: jsonb('questions').notNull().default([]),
    scheduledFor: ts('scheduled_for'),
    closesAt: ts('closes_at'),
    sentAt: ts('sent_at'),
    closedAt: ts('closed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('event_surveys_event').on(t.tenantId, t.eventId)],
);

/** Survey responses: anonymous responses store no person reference; `respondent_token_hash` prevents duplicate submissions. */
export const eventSurveyResponses = pgTable(
  'event_survey_responses',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    surveyId: uuid('survey_id')
      .notNull()
      .references(() => eventSurveys.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    respondentTokenHash: varchar('respondent_token_hash', { length: 64 }).notNull(),
    locationOrgUnitId: uuid('location_org_unit_id'),
    locationName: text('location_name'),
    rating: integer('rating').notNull(),
    wouldAttendAgain: boolean('would_attend_again').notNull(),
    comment: text('comment'),
    answers: jsonb('answers').notNull().default({}),
    commentHidden: boolean('comment_hidden').notNull().default(false),
    commentHiddenReason: text('comment_hidden_reason'),
    submittedAt: createdAt(),
  },
  (t) => [
    index('event_survey_responses_survey').on(t.tenantId, t.surveyId),
    uniqueIndex('event_survey_responses_token').on(t.tenantId, t.surveyId, t.respondentTokenHash),
  ],
);

/** Private event photo gallery (54a): respects attendee photo consent and immediate removal requests. */
export const eventGalleryPhotos = pgTable(
  'event_gallery_photos',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    documentId: uuid('document_id').references(() => documents.id),
    caption: text('caption').notNull(),
    fileName: text('file_name').notNull(),
    uploadedByPersonId: uuid('uploaded_by_person_id').references(() => people.id),
    status: varchar('status', { length: 20 }).notNull().default('visible'),
    removalReason: text('removal_reason'),
    removalRequestedByPersonId: uuid('removal_requested_by_person_id').references(() => people.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('event_gallery_photos_event').on(t.tenantId, t.eventId, t.status)],
);
