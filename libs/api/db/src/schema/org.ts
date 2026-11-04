import {
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, day, pk, tenantRef, validFrom, validTo } from './_columns';
import { employmentType, orgUnitKind, reportingLineKind } from './enums';
import { legalEntities } from './finance';
import { tenants } from './tenancy';

/** Org units (company, BU, department, team, region, location), effective-dated. */
export const orgUnits = pgTable(
  'org_units',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    kind: orgUnitKind('kind').notNull(),
    code: varchar('code', { length: 50 }).notNull(),
    name: text('name').notNull(),
    parentId: uuid('parent_id'),
    legalEntityId: uuid('legal_entity_id').references(() => legalEntities.id),
    timezone: text('timezone'),
    /** Current manager (head of the unit); history lives in org_unit_versions. */
    managerPersonId: uuid('manager_person_id'),
    validFrom: validFrom(),
    validTo: validTo(),
    createdAt: createdAt(),
  },
  (t) => [
    index('org_units_tenant_parent').on(t.tenantId, t.parentId),
    uniqueIndex('org_units_tenant_code_from').on(t.tenantId, t.code, t.validFrom),
    unique('org_units_tenant_id_key').on(t.tenantId, t.id),
  ],
);

/**
 * Effective-dated attributes of an org unit (name, parent, manager, entity, timezone). One row per
 * change; ranges never overlap (exclusion constraint). `org_units` holds the identity and current values.
 */
export const orgUnitVersions = pgTable(
  'org_unit_versions',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    orgUnitId: uuid('org_unit_id')
      .notNull()
      .references(() => orgUnits.id),
    name: text('name').notNull(),
    parentId: uuid('parent_id').references(() => orgUnits.id),
    managerPersonId: uuid('manager_person_id').references(() => people.id),
    legalEntityId: uuid('legal_entity_id').references(() => legalEntities.id),
    timezone: text('timezone'),
    changeKind: varchar('change_kind', { length: 20 }).notNull(),
    reason: text('reason'),
    validFrom: validFrom(),
    validTo: validTo(),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('org_unit_versions_unit_from').on(t.tenantId, t.orgUnitId, t.validFrom)],
);

/** Effective-dated closure table for subtree scope queries. */
export const orgUnitClosure = pgTable(
  'org_unit_closure',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    ancestorId: uuid('ancestor_id')
      .notNull()
      .references(() => orgUnits.id),
    descendantId: uuid('descendant_id')
      .notNull()
      .references(() => orgUnits.id),
    depth: integer('depth').notNull(),
    validFrom: validFrom(),
    validTo: validTo(),
  },
  (t) => [
    index('org_unit_closure_ancestor').on(t.tenantId, t.ancestorId),
    index('org_unit_closure_descendant').on(t.tenantId, t.descendantId),
  ],
);

export const costCenters = pgTable(
  'cost_centers',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    code: varchar('code', { length: 50 }).notNull(),
    name: text('name').notNull(),
    legalEntityId: uuid('legal_entity_id')
      .notNull()
      .references(() => legalEntities.id),
    orgUnitId: uuid('org_unit_id').references(() => orgUnits.id),
    validFrom: validFrom(),
    validTo: validTo(),
  },
  (t) => [
    uniqueIndex('cost_centers_tenant_code').on(t.tenantId, t.code),
    unique('cost_centers_tenant_id_key').on(t.tenantId, t.id),
  ],
);

export const people = pgTable(
  'people',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    displayName: text('display_name').notNull(),
    email: varchar('email', { length: 320 }).notNull(),
    jobTitle: text('job_title'),
    seniority: integer('seniority'),
    locationOrgUnitId: uuid('location_org_unit_id').references(() => orgUnits.id),
    timezone: text('timezone'),
    employingEntityId: uuid('employing_entity_id').references(() => legalEntities.id),
    costCenterId: uuid('cost_center_id').references(() => costCenters.id),
    /** Department or team the person works in (headcount by team). */
    orgUnitId: uuid('org_unit_id').references(() => orgUnits.id),
    employmentType: employmentType('employment_type').notNull().default('employee'),
    startDate: day('start_date'),
    endDate: day('end_date'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('people_tenant_email').on(t.tenantId, t.email),
    unique('people_tenant_id_key').on(t.tenantId, t.id),
  ],
);

export const reportingLines = pgTable(
  'reporting_lines',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id),
    managerPersonId: uuid('manager_person_id')
      .notNull()
      .references(() => people.id),
    kind: reportingLineKind('kind').notNull().default('solid'),
    validFrom: validFrom(),
    validTo: validTo(),
  },
  (t) => [index('reporting_lines_person').on(t.tenantId, t.personId)],
);

export const headcountSnapshots = pgTable(
  'headcount_snapshots',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    asOfDate: day('as_of_date').notNull(),
    source: varchar('source', { length: 50 }).notNull(),
    importedBy: uuid('imported_by'),
    createdAt: createdAt(),
  },
  (t) => [index('headcount_snapshots_tenant').on(t.tenantId, t.asOfDate)],
);

export const headcountSnapshotLines = pgTable(
  'headcount_snapshot_lines',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    snapshotId: uuid('snapshot_id')
      .notNull()
      .references(() => headcountSnapshots.id),
    orgUnitId: uuid('org_unit_id')
      .notNull()
      .references(() => orgUnits.id),
    costCenterId: uuid('cost_center_id').references(() => costCenters.id),
    employmentType: employmentType('employment_type').notNull(),
    headcount: integer('headcount').notNull(),
    /** Joiners and leavers in the period, for proration and true-ups. */
    proratedHeadcountMilli: integer('prorated_headcount_milli').notNull(),
  },
  (t) => [index('headcount_snapshot_lines_snapshot').on(t.tenantId, t.snapshotId)],
);
