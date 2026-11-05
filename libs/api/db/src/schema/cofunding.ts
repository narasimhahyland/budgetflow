import { index, integer, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { ccy, createdAt, minor, pk, tenantRef, ts, updatedAt } from './_columns';
import { approvalTasks } from './authority';
import { budgets } from './budgets';
import { contributionMode } from './enums';
import { people } from './org';
import { contributionRequests, events, requests } from './spend';
import { currencies, tenants } from './tenancy';

/**
 * An event's funding sources (Phase 5): own funds approved from a budget and approved Inter-Director
 * Budget Contribution Requests. Each is an earmark held on `budget_id`; commitments draw on sources
 * pro rata by funded share and the surplus returns per source at close. Amounts are in the budget
 * currency of `budget_id`; the ledger (held bucket) is the source of truth, this is its sub-ledger.
 */
export const eventFundingSources = pgTable(
  'event_funding_sources',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    kind: varchar('kind', { length: 20 }).notNull(),
    /** Budget that holds the earmark (the giver for earmarks, the home budget for own funds and transfers). */
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id),
    /** Budget the money came from (equals budget_id except for transfers); surplus returns here. */
    originBudgetId: uuid('origin_budget_id')
      .notNull()
      .references(() => budgets.id),
    requestId: uuid('request_id').references(() => requests.id),
    contributionRequestId: uuid('contribution_request_id').references(
      () => contributionRequests.id,
    ),
    mode: contributionMode('mode').notNull().default('earmark'),
    seq: integer('seq').notNull(),
    fundedMinor: minor('funded_minor').notNull(),
    consumedMinor: minor('consumed_minor').notNull().default(0),
    returnedMinor: minor('returned_minor').notNull().default(0),
    currency: ccy('currency')
      .notNull()
      .references(() => currencies.code),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('event_funding_sources_event').on(t.tenantId, t.eventId, t.seq),
    index('event_funding_sources_budget').on(t.tenantId, t.budgetId),
  ],
);

/** Estimated cost lines of an event (create event step 3); their total is the estimate. */
export const eventCostLines = pgTable(
  'event_cost_lines',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    lineNo: integer('line_no').notNull(),
    category: varchar('category', { length: 50 }).notNull(),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull(),
    unitCostMinor: minor('unit_cost_minor').notNull(),
    amountMinor: minor('amount_minor').notNull(),
    currency: ccy('currency')
      .notNull()
      .references(() => currencies.code),
  },
  (t) => [uniqueIndex('event_cost_lines_line').on(t.tenantId, t.eventId, t.lineNo)],
);

/**
 * Actionable email links: one row per approve or reject link, bound to the approver, the task and the
 * subject version. Single use (`used_at`), expiring; the link carries the id plus an HMAC signature.
 */
export const approvalActionTokens = pgTable(
  'approval_action_tokens',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    taskId: uuid('task_id')
      .notNull()
      .references(() => approvalTasks.id),
    approverPersonId: uuid('approver_person_id')
      .notNull()
      .references(() => people.id),
    action: varchar('action', { length: 20 }).notNull(),
    subjectVersion: integer('subject_version').notNull(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdAt: createdAt(),
  },
  (t) => [index('approval_action_tokens_task').on(t.tenantId, t.taskId)],
);
