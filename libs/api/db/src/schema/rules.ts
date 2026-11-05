import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  ccy,
  createdAt,
  minor,
  pk,
  tenantRef,
  ts,
  updatedAt,
  validFrom,
  validTo,
} from './_columns';
import { budgets } from './budgets';
import { people } from './org';
import { currencies, tenants } from './tenancy';

/** Policy rules (condition AST over typed facts -> actions), versioned and effective-dated. */
export const rules = pgTable(
  'rules',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    code: varchar('code', { length: 30 }).notNull(),
    name: text('name').notNull(),
    family: varchar('family', { length: 50 }).notNull().default('general'),
    templateCode: varchar('template_code', { length: 50 }),
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    activeVersion: integer('active_version'),
    draftVersion: integer('draft_version'),
    retiredReason: text('retired_reason'),
    retiredAt: ts('retired_at'),
    createdBy: uuid('created_by').references(() => people.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('rules_tenant_code').on(t.tenantId, t.code),
    index('rules_tenant_status').on(t.tenantId, t.status),
  ],
);

/** Immutable once active; edits create a new version. */
export const ruleVersions = pgTable(
  'rule_versions',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => rules.id),
    version: integer('version').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    priority: integer('priority').notNull().default(50),
    effect: varchar('effect', { length: 30 }).notNull().default('require_approval'),
    conditions: jsonb('conditions').notNull().default({}),
    actions: jsonb('actions').notNull().default([]),
    scope: jsonb('scope').notNull().default({}),
    explanation: text('explanation').notNull().default(''),
    validFrom: validFrom(),
    validTo: validTo(),
    publishedAt: ts('published_at'),
    publishedBy: uuid('published_by').references(() => people.id),
    createdBy: uuid('created_by').references(() => people.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('rule_versions_unique').on(t.tenantId, t.ruleId, t.version),
    index('rule_versions_rule_status').on(t.tenantId, t.ruleId, t.status),
  ],
);

/** Records every rule evaluation or simulation/backtest run with the rule versions and facts used. */
export const ruleExecutions = pgTable(
  'rule_executions',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    subjectType: varchar('subject_type', { length: 30 }).notNull(),
    subjectId: uuid('subject_id'),
    ruleId: uuid('rule_id').references(() => rules.id),
    effect: varchar('effect', { length: 30 }).notNull(),
    matchedRules: jsonb('matched_rules').notNull().default([]),
    facts: jsonb('facts').notNull().default({}),
    explanation: text('explanation').notNull().default(''),
    evaluatedBy: uuid('evaluated_by').references(() => people.id),
    evaluatedAt: createdAt(),
  },
  (t) => [
    index('rule_executions_subject').on(t.tenantId, t.subjectType, t.subjectId),
    index('rule_executions_rule').on(t.tenantId, t.ruleId, t.evaluatedAt),
  ],
);

/** Versioned approval routing definitions per request kind (070). */
export const workflowTemplates = pgTable(
  'workflow_templates',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    requestKind: varchar('request_kind', { length: 50 }).notNull(),
    version: integer('version').notNull().default(1),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    steps: jsonb('steps').notNull().default([]),
    validFrom: validFrom(),
    validTo: validTo(),
    publishedBy: uuid('published_by').references(() => people.id),
    publishedAt: ts('published_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('workflow_templates_kind_version').on(t.tenantId, t.requestKind, t.version),
    index('workflow_templates_lookup').on(t.tenantId, t.requestKind, t.status),
  ],
);

/**
 * Policy configuration sections behind screens 071-076 (spending limits, categories, gifts and
 * entertainment, locations, vendors, over-budget, freeze/zero, SLA and notifications). Each save
 * bumps `version` and writes an audit entry; the payload shape is validated by the zod contract.
 */
export const policyConfigs = pgTable(
  'policy_configs',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    section: varchar('section', { length: 50 }).notNull(),
    version: integer('version').notNull().default(1),
    payload: jsonb('payload').notNull().default({}),
    updatedBy: uuid('updated_by').references(() => people.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('policy_configs_tenant_section').on(t.tenantId, t.section)],
);

/** Post-spend policy exceptions queue (074a): alcohol over cap, blocked vendor, split purchase, etc. */
export const postSpendExceptions = pgTable(
  'post_spend_exceptions',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    type: varchar('type', { length: 40 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('open'),
    sourceKind: varchar('source_kind', { length: 20 }).notNull(),
    sourceRef: varchar('source_ref', { length: 60 }).notNull(),
    sourceId: uuid('source_id'),
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id),
    location: varchar('location', { length: 100 }).notNull(),
    personId: uuid('person_id').references(() => people.id),
    personName: text('person_name').notNull(),
    transactionAmountMinor: minor('transaction_amount_minor').notNull(),
    transactionCurrency: ccy('transaction_currency')
      .notNull()
      .references(() => currencies.code),
    reportingAmountMinor: minor('reporting_amount_minor').notNull(),
    reportingCurrency: ccy('reporting_currency')
      .notNull()
      .references(() => currencies.code),
    ruleCode: varchar('rule_code', { length: 30 }).notNull(),
    ruleVersion: integer('rule_version').notNull().default(1),
    summary: text('summary').notNull(),
    facts: jsonb('facts').notNull().default({}),
    relatedItems: jsonb('related_items').notNull().default([]),
    ownerExplanation: text('owner_explanation'),
    resolution: varchar('resolution', { length: 40 }),
    resolutionReasonCode: varchar('resolution_reason_code', { length: 50 }),
    resolutionReason: text('resolution_reason'),
    repaymentMinor: minor('repayment_minor'),
    reclassifiedToGlCode: varchar('reclassified_to_gl_code', { length: 30 }),
    reversalJournalId: uuid('reversal_journal_id'),
    resolvedBy: uuid('resolved_by').references(() => people.id),
    resolvedAt: ts('resolved_at'),
    raisedAt: createdAt(),
  },
  (t) => [
    index('post_spend_exceptions_status').on(t.tenantId, t.status, t.type),
    index('post_spend_exceptions_budget').on(t.tenantId, t.budgetId),
  ],
);
