import { z } from 'zod';
import { BudgetType, CurrencyCode, Id, IsoDateTime } from '../common';
import type { Endpoint } from '../endpoint';
import { named } from '../registry';
import { ControlSettings } from './budgets';
import { EmploymentType } from './org';

// Plan versions --------------------------------------------------------------------------------
const PlanVersionKind = z.enum(['original', 'current', 'forecast']);
const PlanVersionStatus = z.enum(['draft', 'approved', 'superseded']);
const PlanVersionParams = z.object({ planVersionId: Id }).strict();

export const PlanTieOut = named(
  'PlanTieOut',
  z
    .object({
      fiscalYearId: Id,
      planVersionId: Id.nullable(),
      planVersionLabel: z.string().nullable(),
      currency: CurrencyCode,
      planTotalMinor: z.int(),
      rootAuthorizedMinor: z.int(),
      savingsMinor: z.int().describe('Money cut and returned to savings out of these roots.'),
      differenceMinor: z.int().describe('Plan total − root authorized − savings.'),
      tiedOut: z.boolean(),
      rootCount: z.int(),
    })
    .strict()
    .describe('Root budgets of the year tie to the controlling plan version.'),
);
export type PlanTieOut = z.infer<typeof PlanTieOut>;

export const PlanVersion = named(
  'PlanVersion',
  z
    .object({
      id: Id,
      fiscalYearId: Id,
      fiscalYearLabel: z.string(),
      kind: PlanVersionKind,
      label: z.string(),
      status: PlanVersionStatus,
      source: z.string(),
      controlling: z.boolean().describe('Root budgets of the year currently tie to this version.'),
      approvedAt: IsoDateTime.nullable(),
      approvedByName: z.string().nullable(),
      appliedAt: IsoDateTime.nullable(),
      currency: CurrencyCode,
      totalMinor: z.int(),
      lineCount: z.int(),
      createdAt: IsoDateTime,
    })
    .strict(),
);
export type PlanVersion = z.infer<typeof PlanVersion>;

export const PlanVersionLine = named(
  'PlanVersionLine',
  z
    .object({
      lineNo: z.int(),
      budgetId: Id.nullable(),
      code: z.string(),
      name: z.string(),
      legalEntityId: Id.nullable(),
      costCenterId: Id.nullable(),
      ownerPersonId: Id.nullable(),
      categoryCode: z.string().nullable(),
      amountMinor: z.int(),
      rootAuthorizedMinor: z.int().nullable().describe('Current authorized of the linked root.'),
      savingsMinor: z.int().nullable(),
      differenceMinor: z
        .int()
        .nullable()
        .describe('Plan − (root authorized + savings): what applying this version would post.'),
    })
    .strict(),
);
export type PlanVersionLine = z.infer<typeof PlanVersionLine>;

export const PlanVersionDetail = named(
  'PlanVersionDetail',
  PlanVersion.extend({ lines: z.array(PlanVersionLine), tieOut: PlanTieOut }).strict(),
);
export type PlanVersionDetail = z.infer<typeof PlanVersionDetail>;

export const PlanVersionList = named(
  'PlanVersionList',
  z.object({ items: z.array(PlanVersion) }).strict(),
);

const PlanLineInput = z
  .object({
    code: z.string().trim().min(1).max(50),
    name: z.string().trim().min(2).max(200),
    amountMinor: z.int().min(1),
    budgetId: Id.optional(),
    legalEntityId: Id.optional(),
    costCenterId: Id.optional(),
    ownerPersonId: Id.optional(),
    categoryCode: z.string().max(50).optional(),
  })
  .strict();

export const CreatePlanVersionRequest = named(
  'CreatePlanVersionRequest',
  z
    .object({
      fiscalYearId: Id,
      kind: PlanVersionKind,
      label: z.string().trim().min(2).max(100),
      copyFromId: Id.optional().describe('Start from the lines of another version.'),
      lines: z.array(PlanLineInput).max(500).optional(),
    })
    .strict(),
);
export type CreatePlanVersionRequest = z.infer<typeof CreatePlanVersionRequest>;

export const PlanImportMapping = named(
  'PlanImportMapping',
  z
    .object({
      code: z.string().min(1),
      name: z.string().min(1),
      amount: z.string().min(1).describe('Column with the amount in major units (e.g. 30000.00).'),
      legalEntity: z.string().optional().describe('Column with the legal entity code.'),
      costCenter: z.string().optional().describe('Column with the cost center code.'),
      ownerEmail: z.string().optional(),
      category: z.string().optional(),
    })
    .strict()
    .describe('Which spreadsheet column holds each field (by header name).'),
);

export const PlanImportRequest = named(
  'PlanImportRequest',
  z
    .object({
      fiscalYearId: Id,
      kind: PlanVersionKind,
      label: z.string().trim().min(2).max(100),
      csv: z
        .string()
        .min(1)
        .max(500_000)
        .describe(
          'Spreadsheet rows as CSV or tab-separated text (pasted from Excel), header first.',
        ),
      mapping: PlanImportMapping,
      dryRun: z.boolean(),
    })
    .strict(),
);
export type PlanImportRequest = z.infer<typeof PlanImportRequest>;

export const PlanImportResult = named(
  'PlanImportResult',
  z
    .object({
      dryRun: z.boolean(),
      valid: z.boolean(),
      columns: z.array(z.string()),
      currency: CurrencyCode,
      totalMinor: z.int(),
      rows: z.array(
        z
          .object({
            line: z.int(),
            code: z.string(),
            name: z.string(),
            amountMinor: z.int().nullable(),
            legalEntityId: Id.nullable(),
            costCenterId: Id.nullable(),
            ownerPersonId: Id.nullable(),
            categoryCode: z.string().nullable(),
            existingBudgetId: Id.nullable(),
            errors: z.array(z.string()),
          })
          .strict(),
      ),
      planVersion: PlanVersionDetail.nullable(),
    })
    .strict(),
);
export type PlanImportResult = z.infer<typeof PlanImportResult>;

export const ApplyPlanVersionResult = named(
  'ApplyPlanVersionResult',
  z
    .object({
      planVersion: PlanVersionDetail,
      journalIds: z.array(Id),
      createdBudgetIds: z.array(Id),
      adjustedBudgetIds: z.array(Id),
    })
    .strict(),
);
export type ApplyPlanVersionResult = z.infer<typeof ApplyPlanVersionResult>;

// Program templates ----------------------------------------------------------------------------
export const ProgramTemplateDefaults = named(
  'ProgramTemplateDefaults',
  z
    .object({
      description: z.string().max(500).optional(),
      rateMinor: z.int().min(1).optional().describe('Per-head rate in USD minor units.'),
      eligibleTypes: z.array(EmploymentType).optional(),
      prorate: z.boolean().optional(),
      categoryCode: z.string().max(50).optional(),
      budgetType: BudgetType.optional(),
      alertThresholdsPct: z.array(z.int().min(1).max(100)).max(5).optional(),
      control: ControlSettings.optional(),
    })
    .strict(),
);
export type ProgramTemplateDefaults = z.infer<typeof ProgramTemplateDefaults>;

export const ProgramTemplate = named(
  'ProgramTemplate',
  z
    .object({
      id: Id,
      code: z.string(),
      name: z.string(),
      kind: z.string(),
      driver: z.enum(['fixed', 'per_head']),
      defaults: ProgramTemplateDefaults,
      budgetCount: z.int(),
    })
    .strict(),
);
export type ProgramTemplate = z.infer<typeof ProgramTemplate>;
export const ProgramTemplateList = named(
  'ProgramTemplateList',
  z.object({ items: z.array(ProgramTemplate) }).strict(),
);
export const UpsertProgramTemplateRequest = named(
  'UpsertProgramTemplateRequest',
  z
    .object({
      code: z
        .string()
        .trim()
        .regex(/^[A-Z0-9-]{2,50}$/, 'Use capital letters, digits and dashes.'),
      name: z.string().trim().min(2).max(200),
      driver: z.enum(['fixed', 'per_head']),
      defaults: ProgramTemplateDefaults,
    })
    .strict(),
);
export type UpsertProgramTemplateRequest = z.infer<typeof UpsertProgramTemplateRequest>;
const TemplateParams = z.object({ templateId: Id }).strict();

export const TieOutQuery = z.object({ fiscalYearId: Id }).strict();
export const PlanVersionQuery = z.object({ fiscalYearId: Id.optional() }).strict();

export const planningEndpoints = {
  listPlanVersions: {
    operationId: 'listPlanVersions',
    method: 'get',
    path: '/api/plan-versions',
    summary: 'Plan versions (original, current, forecast) by fiscal year',
    tags: ['planning'],
    auth: true,
    query: PlanVersionQuery,
    response: { status: 200, schema: PlanVersionList },
    errors: [400, 401, 403],
  },
  getPlanVersion: {
    operationId: 'getPlanVersion',
    method: 'get',
    path: '/api/plan-versions/{planVersionId}',
    summary: 'A plan version with its lines and the root tie-out',
    tags: ['planning'],
    auth: true,
    params: PlanVersionParams,
    response: { status: 200, schema: PlanVersionDetail },
    errors: [401, 403, 404],
  },
  createPlanVersion: {
    operationId: 'createPlanVersion',
    method: 'post',
    path: '/api/plan-versions',
    summary: 'Create a draft plan version',
    tags: ['planning'],
    auth: true,
    idempotent: true,
    body: CreatePlanVersionRequest,
    response: { status: 201, schema: PlanVersionDetail },
    errors: [400, 401, 403, 404, 409, 422],
  },
  importPlan: {
    operationId: 'importPlan',
    method: 'post',
    path: '/api/plan-versions/import',
    summary: 'Budget-plan spreadsheet import with column mapping (dry run, then a draft version)',
    tags: ['planning'],
    auth: true,
    idempotent: true,
    body: PlanImportRequest,
    response: { status: 200, schema: PlanImportResult },
    errors: [400, 401, 403, 422],
  },
  approvePlanVersion: {
    operationId: 'approvePlanVersion',
    method: 'post',
    path: '/api/plan-versions/{planVersionId}/approve',
    summary: 'Approve a draft plan version',
    tags: ['planning'],
    auth: true,
    idempotent: true,
    params: PlanVersionParams,
    response: { status: 200, schema: PlanVersionDetail },
    errors: [401, 403, 404, 409],
  },
  applyPlanVersion: {
    operationId: 'applyPlanVersion',
    method: 'post',
    path: '/api/plan-versions/{planVersionId}/apply',
    summary: 'Make an approved version controlling: create or adjust root budgets so they tie out',
    tags: ['planning'],
    auth: true,
    idempotent: true,
    params: PlanVersionParams,
    response: { status: 200, schema: ApplyPlanVersionResult },
    errors: [401, 403, 404, 409, 422],
  },
  planTieOut: {
    operationId: 'planTieOut',
    method: 'get',
    path: '/api/plan-versions/tie-out',
    summary: 'Root authorized for the year against the controlling plan version',
    tags: ['planning'],
    auth: true,
    query: TieOutQuery,
    response: { status: 200, schema: PlanTieOut },
    errors: [400, 401, 403],
  },
  listProgramTemplates: {
    operationId: 'listProgramTemplates',
    method: 'get',
    path: '/api/program-templates',
    summary: 'Program templates (per-head engagement, festival, offsite, wellbeing, recognition)',
    tags: ['planning'],
    auth: true,
    response: { status: 200, schema: ProgramTemplateList },
    errors: [401, 403],
  },
  createProgramTemplate: {
    operationId: 'createProgramTemplate',
    method: 'post',
    path: '/api/program-templates',
    summary: 'Add a program template',
    tags: ['planning'],
    auth: true,
    idempotent: true,
    body: UpsertProgramTemplateRequest,
    response: { status: 201, schema: ProgramTemplate },
    errors: [400, 401, 403, 409, 422],
  },
  updateProgramTemplate: {
    operationId: 'updateProgramTemplate',
    method: 'put',
    path: '/api/program-templates/{templateId}',
    summary: 'Change a program template',
    tags: ['planning'],
    auth: true,
    idempotent: true,
    params: TemplateParams,
    body: UpsertProgramTemplateRequest,
    response: { status: 200, schema: ProgramTemplate },
    errors: [400, 401, 403, 404, 409, 422],
  },
} as const satisfies Record<string, Endpoint>;
