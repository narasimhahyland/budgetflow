import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { ccy, createdAt, day, minor, pk, tenantRef, ts, updatedAt } from './_columns';
import {
  allocationDriver,
  budgetStatus,
  budgetType,
  controlMode,
  ledgerAccount,
  planVersionKind,
  planVersionStatus,
  rolloverMode,
  sweepTarget,
} from './enums';
import { costCenters, orgUnits, people } from './org';
import { fiscalPeriods, fiscalYears, legalEntities } from './finance';
import { currencies, tenants } from './tenancy';

/** Configurable per tenant; the 11 spec categories are seeded. */
export const budgetCategories = pgTable(
  'budget_categories',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    code: varchar('code', { length: 50 }).notNull(),
    name: text('name').notNull(),
    isCustom: boolean('is_custom').notNull().default(false),
    active: boolean('active').notNull().default(true),
  },
  (t) => [uniqueIndex('budget_categories_tenant_code').on(t.tenantId, t.code)],
);

export const customFieldDefinitions = pgTable(
  'custom_field_definitions',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    entity: varchar('entity', { length: 50 }).notNull(),
    key: varchar('key', { length: 50 }).notNull(),
    label: text('label').notNull(),
    fieldType: varchar('field_type', { length: 20 }).notNull(),
    required: boolean('required').notNull().default(false),
  },
  (t) => [uniqueIndex('custom_field_definitions_key').on(t.tenantId, t.entity, t.key)],
);

export const programTemplates = pgTable(
  'program_templates',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    code: varchar('code', { length: 50 }).notNull(),
    name: text('name').notNull(),
    kind: varchar('kind', { length: 30 }).notNull(),
    driver: allocationDriver('driver').notNull().default('fixed'),
    defaults: jsonb('defaults').notNull().default({}),
  },
  (t) => [uniqueIndex('program_templates_tenant_code').on(t.tenantId, t.code)],
);

export const planVersions = pgTable(
  'plan_versions',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    fiscalYearId: uuid('fiscal_year_id')
      .notNull()
      .references(() => fiscalYears.id),
    kind: planVersionKind('kind').notNull(),
    label: text('label').notNull(),
    status: planVersionStatus('status').notNull().default('draft'),
    approvedAt: ts('approved_at'),
    approvedBy: uuid('approved_by'),
    createdAt: createdAt(),
  },
  (t) => [index('plan_versions_tenant_year').on(t.tenantId, t.fiscalYearId)],
);

export const rolloverPolicies = pgTable(
  'rollover_policies',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    code: varchar('code', { length: 50 }).notNull(),
    name: text('name').notNull(),
    mode: rolloverMode('mode').notNull(),
    capBps: integer('cap_bps'),
    sweepTo: sweepTarget('sweep_to').notNull().default('parent'),
  },
  (t) => [uniqueIndex('rollover_policies_tenant_code').on(t.tenantId, t.code)],
);

export const budgets = pgTable(
  'budgets',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    parentId: uuid('parent_id'),
    /** Materialized path of ancestor ids, root first: `/root/child/`. Scope checks use prefix matching. */
    path: text('path').notNull(),
    depth: integer('depth').notNull(),
    name: text('name').notNull(),
    code: varchar('code', { length: 50 }),
    status: budgetStatus('status').notNull().default('draft'),
    budgetType: budgetType('budget_type').notNull().default('operating'),
    categoryId: uuid('category_id').references(() => budgetCategories.id),
    legalEntityId: uuid('legal_entity_id')
      .notNull()
      .references(() => legalEntities.id),
    costCenterId: uuid('cost_center_id'),
    orgUnitId: uuid('org_unit_id'),
    ownerPersonId: uuid('owner_person_id'),
    currency: ccy('currency')
      .notNull()
      .references(() => currencies.code),
    fiscalYearId: uuid('fiscal_year_id')
      .notNull()
      .references(() => fiscalYears.id),
    planVersionId: uuid('plan_version_id').references(() => planVersions.id),
    controlBasis: ledgerAccount('control_basis').array().notNull(),
    controlMode: controlMode('control_mode').notNull().default('hard'),
    toleranceBps: integer('tolerance_bps').notNull().default(0),
    alertThresholdsPct: integer('alert_thresholds_pct').array().notNull().default([50, 80, 100]),
    allocationDriver: allocationDriver('allocation_driver').notNull().default('fixed'),
    driverConfig: jsonb('driver_config'),
    rolloverPolicyId: uuid('rollover_policy_id').references(() => rolloverPolicies.id),
    programTemplateId: uuid('program_template_id').references(() => programTemplates.id),
    expiresOn: day('expires_on'),
    version: integer('version').notNull().default(1),
    customFields: jsonb('custom_fields').notNull().default({}),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('budgets_tenant_parent').on(t.tenantId, t.parentId),
    index('budgets_tenant_path').on(t.tenantId, t.path),
    index('budgets_tenant_owner').on(t.tenantId, t.ownerPersonId),
    unique('budgets_tenant_id_key').on(t.tenantId, t.id),
    // Foreign keys are checked without row-level security, so references to tenant-owned rows
    // include tenant_id: a budget can never point at another tenant's parent or master data.
    foreignKey({
      name: 'budgets_parent_same_tenant_fk',
      columns: [t.tenantId, t.parentId],
      foreignColumns: [t.tenantId, t.id],
    }),
    foreignKey({
      name: 'budgets_cost_center_same_tenant_fk',
      columns: [t.tenantId, t.costCenterId],
      foreignColumns: [costCenters.tenantId, costCenters.id],
    }),
    foreignKey({
      name: 'budgets_org_unit_same_tenant_fk',
      columns: [t.tenantId, t.orgUnitId],
      foreignColumns: [orgUnits.tenantId, orgUnits.id],
    }),
    foreignKey({
      name: 'budgets_owner_same_tenant_fk',
      columns: [t.tenantId, t.ownerPersonId],
      foreignColumns: [people.tenantId, people.id],
    }),
  ],
);

export const budgetCoOwners = pgTable(
  'budget_co_owners',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('budget_co_owners_unique').on(t.tenantId, t.budgetId, t.personId)],
);

/** Immutable snapshots with a reason (append-only). */
export const budgetVersions = pgTable(
  'budget_versions',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id),
    version: integer('version').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    reason: text('reason').notNull(),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('budget_versions_unique').on(t.tenantId, t.budgetId, t.version)],
);

/** Period phasing (even, seasonal, manual) in the budget currency. */
export const budgetPeriodAllotments = pgTable(
  'budget_period_allotments',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id),
    fiscalPeriodId: uuid('fiscal_period_id')
      .notNull()
      .references(() => fiscalPeriods.id),
    amountMinor: minor('amount_minor').notNull(),
  },
  (t) => [
    uniqueIndex('budget_period_allotments_unique').on(t.tenantId, t.budgetId, t.fiscalPeriodId),
  ],
);
