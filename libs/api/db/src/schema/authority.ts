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
import { ccy, createdAt, minor, pk, tenantRef, ts, validFrom, validTo } from './_columns';
import { approvalChannel, approvalStatus, roleId } from './enums';
import { legalEntities } from './finance';
import { people } from './org';
import { currencies, tenants } from './tenancy';

/** Versioned, effective-dated delegation-of-authority matrix. */
export const doaMatrixVersions = pgTable(
  'doa_matrix_versions',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    version: integer('version').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    validFrom: validFrom(),
    validTo: validTo(),
    approvedBy: uuid('approved_by'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('doa_matrix_versions_unique').on(t.tenantId, t.version)],
);

/** who × spend type × legal entity × limit ('*' wildcards). */
export const doaLimits = pgTable(
  'doa_limits',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    matrixVersionId: uuid('matrix_version_id')
      .notNull()
      .references(() => doaMatrixVersions.id),
    personId: uuid('person_id').references(() => people.id),
    role: roleId('role'),
    spendType: varchar('spend_type', { length: 50 }).notNull(),
    legalEntityId: uuid('legal_entity_id').references(() => legalEntities.id),
    limitMinor: minor('limit_minor').notNull(),
    currency: ccy('currency')
      .notNull()
      .references(() => currencies.code),
    validFrom: validFrom(),
    validTo: validTo(),
  },
  (t) => [index('doa_limits_lookup').on(t.tenantId, t.matrixVersionId, t.spendType)],
);

/** Time-boxed delegations, capped by the delegator's own limit and dates. */
export const approvalDelegations = pgTable(
  'approval_delegations',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    delegatorPersonId: uuid('delegator_person_id')
      .notNull()
      .references(() => people.id),
    delegatePersonId: uuid('delegate_person_id')
      .notNull()
      .references(() => people.id),
    spendType: varchar('spend_type', { length: 50 }),
    limitMinor: minor('limit_minor'),
    currency: ccy('currency').references(() => currencies.code),
    validFrom: validFrom(),
    validTo: validTo(),
    reason: text('reason').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('approval_delegations_delegator').on(t.tenantId, t.delegatorPersonId)],
);

export const reasonCodes = pgTable(
  'reason_codes',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    code: varchar('code', { length: 50 }).notNull(),
    category: varchar('category', { length: 30 }).notNull(),
    label: text('label').notNull(),
    active: boolean('active').notNull().default(true),
  },
  (t) => [uniqueIndex('reason_codes_tenant_code').on(t.tenantId, t.category, t.code)],
);

export const approvalInstances = pgTable(
  'approval_instances',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    subjectType: varchar('subject_type', { length: 50 }).notNull(),
    subjectId: uuid('subject_id').notNull(),
    workflowTemplateId: uuid('workflow_template_id'),
    status: approvalStatus('status').notNull().default('pending'),
    explanation: jsonb('explanation').notNull().default({}),
    createdAt: createdAt(),
    completedAt: ts('completed_at'),
  },
  (t) => [index('approval_instances_subject').on(t.tenantId, t.subjectType, t.subjectId)],
);

export const approvalTasks = pgTable(
  'approval_tasks',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => approvalInstances.id),
    stepNo: integer('step_no').notNull(),
    assigneePersonId: uuid('assignee_person_id')
      .notNull()
      .references(() => people.id),
    resolver: varchar('resolver', { length: 50 }).notNull(),
    status: approvalStatus('status').notNull().default('pending'),
    dueAt: ts('due_at'),
    escalatedFromTaskId: uuid('escalated_from_task_id'),
    createdAt: createdAt(),
  },
  (t) => [index('approval_tasks_assignee').on(t.tenantId, t.assigneePersonId, t.status)],
);

export const approvalActions = pgTable(
  'approval_actions',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    taskId: uuid('task_id')
      .notNull()
      .references(() => approvalTasks.id),
    actorPersonId: uuid('actor_person_id')
      .notNull()
      .references(() => people.id),
    onBehalfOfPersonId: uuid('on_behalf_of_person_id'),
    action: varchar('action', { length: 30 }).notNull(),
    approvedMinor: minor('approved_minor'),
    reason: text('reason'),
    channel: approvalChannel('channel').notNull().default('web'),
    createdAt: createdAt(),
  },
  (t) => [index('approval_actions_task').on(t.tenantId, t.taskId)],
);
