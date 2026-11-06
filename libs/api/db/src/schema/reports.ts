import { boolean, index, integer, jsonb, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, minor, pk, tenantRef, ts, updatedAt } from './_columns';
import { people } from './org';
import { tenants } from './tenancy';

/**
 * Phase 10 reporting. Reports themselves are read models over the ledger; only the things people
 * save are stored here: saved views (filters, never data), scheduled deliveries, their run history
 * and export jobs.
 */

/** A named set of report filters a person saved or starred (screen 079). */
export const reportSavedViews = pgTable(
  'report_saved_views',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    reportId: varchar('report_id', { length: 40 }).notNull(),
    name: text('name').notNull(),
    filters: jsonb('filters').notNull().default({}),
    favourite: boolean('favourite').notNull().default(false),
    ownerPersonId: uuid('owner_person_id').references(() => people.id),
    lastOpenedAt: ts('last_opened_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('report_saved_views_owner').on(t.tenantId, t.ownerPersonId, t.reportId)],
);

/**
 * Scheduled delivery of a report (screen 091). The schedule runs with its owner's scope; each email
 * recipient is re-checked against `report.read` at run time and skipped when they cannot see the
 * same data. Channels receive headline figures and a link, never a file.
 */
export const reportSchedules = pgTable(
  'report_schedules',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    name: text('name').notNull(),
    reportId: varchar('report_id', { length: 40 }).notNull(),
    savedViewId: uuid('saved_view_id').references(() => reportSavedViews.id),
    filters: jsonb('filters').notNull().default({}),
    formats: text('formats').array().notNull().default(['pdf']),
    frequency: varchar('frequency', { length: 30 }).notNull().default('weekly'),
    weekday: integer('weekday'),
    dayOfMonth: integer('day_of_month'),
    sendTime: varchar('send_time', { length: 5 }).notNull().default('08:00'),
    timezone: varchar('timezone', { length: 60 }).notNull().default('UTC'),
    recipientPersonIds: uuid('recipient_person_ids').array().notNull().default([]),
    channels: jsonb('channels').notNull().default([]),
    message: text('message'),
    ownerPersonId: uuid('owner_person_id').references(() => people.id),
    active: boolean('active').notNull().default(true),
    pausedReason: text('paused_reason'),
    nextRunAt: ts('next_run_at'),
    lastRunAt: ts('last_run_at'),
    lastRunStatus: varchar('last_run_status', { length: 20 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('report_schedules_owner').on(t.tenantId, t.ownerPersonId),
    index('report_schedules_due').on(t.tenantId, t.active, t.nextRunAt),
  ],
);

/** One delivery attempt of a schedule, with who received it and who was skipped and why. */
export const reportScheduleRuns = pgTable(
  'report_schedule_runs',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    scheduleId: uuid('schedule_id')
      .notNull()
      .references(() => reportSchedules.id),
    runAt: ts('run_at').notNull().defaultNow(),
    trigger: varchar('trigger', { length: 20 }).notNull().default('scheduled'),
    status: varchar('status', { length: 20 }).notNull().default('delivered'),
    deliveredCount: integer('delivered_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    channelCount: integer('channel_count').notNull().default(0),
    rowCount: integer('row_count').notNull().default(0),
    skipped: jsonb('skipped').notNull().default([]),
    exportIds: uuid('export_ids').array().notNull().default([]),
    error: text('error'),
  },
  (t) => [index('report_schedule_runs_schedule').on(t.tenantId, t.scheduleId, t.runAt)],
);

/** An export of a report run; the rendered file lives in the DocumentStore and the link expires. */
export const reportExports = pgTable(
  'report_exports',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    reportId: varchar('report_id', { length: 40 }).notNull(),
    format: varchar('format', { length: 10 }).notNull(),
    filters: jsonb('filters').notNull().default({}),
    rowCount: integer('row_count').notNull().default(0),
    status: varchar('status', { length: 20 }).notNull().default('queued'),
    documentId: uuid('document_id'),
    sizeBytes: minor('size_bytes'),
    scheduleId: uuid('schedule_id').references(() => reportSchedules.id),
    requestedByPersonId: uuid('requested_by_person_id').references(() => people.id),
    requestedAt: ts('requested_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [index('report_exports_tenant_requested').on(t.tenantId, t.requestedAt)],
);
