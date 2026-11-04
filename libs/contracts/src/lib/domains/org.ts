import { z } from 'zod';
import { Id, IsoDate, IsoDateTime } from '../common';
import type { Endpoint } from '../endpoint';
import { named } from '../registry';

// Org hierarchy ----------------------------------------------------------------------------------
export const ORG_UNIT_KINDS = [
  'company',
  'business_unit',
  'region',
  'location',
  'department',
  'team',
] as const;
export const OrgUnitKind = z.enum(ORG_UNIT_KINDS).describe('Kind of org unit.');
export const EmploymentType = z.enum(['employee', 'contractor', 'intern']);
export const OrgScope = z
  .enum(['tenant', 'subtree', 'self'])
  .describe(
    'What the caller sees: the whole tenant, the subtrees of their org scope, or only their own units.',
  );

const Code = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,49}$/)
  .describe('Business code: letters, digits, dot, dash or underscore (up to 50).');
const Reason = z.string().trim().min(1).max(500);

export const AsOfQuery = z
  .object({ asOf: IsoDate.optional().describe('Effective date to read (default today, UTC).') })
  .strict();

const OrgUnitParams = z.object({ orgUnitId: Id }).strict();
const PersonParams = z.object({ personId: Id }).strict();
const CostCenterParams = z.object({ costCenterId: Id }).strict();

export const OrgUnit = named(
  'OrgUnit',
  z
    .object({
      id: Id,
      code: z.string(),
      kind: OrgUnitKind,
      name: z.string(),
      parentId: Id.nullable(),
      ancestorIds: z.array(Id).describe('Ancestors from the root down to this unit (inclusive).'),
      depth: z.int().min(0),
      legalEntityId: Id.nullable(),
      timezone: z.string().nullable(),
      managerPersonId: Id.nullable(),
      managerName: z.string().nullable(),
      validFrom: IsoDate,
      validTo: IsoDate.nullable(),
      peopleCount: z.int().min(0).describe('People whose location or team is this unit.'),
      allowedActions: z.array(z.string()),
    })
    .strict()
    .describe('An org unit as of the requested date.'),
);
export type OrgUnit = z.infer<typeof OrgUnit>;

export const OrgUnitList = named(
  'OrgUnitList',
  z
    .object({ asOf: IsoDate, scope: OrgScope, items: z.array(OrgUnit) })
    .strict()
    .describe('Org units visible to the caller as of a date, parents before children.'),
);

export const OrgUnitVersion = named(
  'OrgUnitVersion',
  z
    .object({
      validFrom: IsoDate,
      validTo: IsoDate.nullable(),
      changeKind: z.string(),
      name: z.string(),
      parentId: Id.nullable(),
      parentName: z.string().nullable(),
      managerPersonId: Id.nullable(),
      managerName: z.string().nullable(),
      legalEntityId: Id.nullable(),
      timezone: z.string().nullable(),
      reason: z.string().nullable(),
      createdAt: IsoDateTime,
    })
    .strict()
    .describe('One effective-dated version of an org unit.'),
);

export const HeadcountByType = named(
  'HeadcountByType',
  z
    .object({ employee: z.int(), contractor: z.int(), intern: z.int() })
    .strict()
    .describe('Headcount split by employment type.'),
);

export const OrgUnitDetail = named(
  'OrgUnitDetail',
  OrgUnit.extend({
    asOf: IsoDate,
    versions: z.array(OrgUnitVersion).describe('Full history, newest first.'),
    children: z.array(OrgUnit),
    costCenters: z.array(z.object({ id: Id, code: z.string(), name: z.string() }).strict()),
    headcount: z
      .object({ asOfDate: IsoDate, total: z.int(), byType: HeadcountByType })
      .strict()
      .nullable(),
  })
    .strict()
    .describe('An org unit with its history, children, cost centers and latest headcount.'),
);
export type OrgUnitDetail = z.infer<typeof OrgUnitDetail>;

export const CreateOrgUnitRequest = named(
  'CreateOrgUnitRequest',
  z
    .object({
      code: Code,
      name: z.string().trim().min(1).max(200),
      kind: OrgUnitKind,
      parentId: Id.nullable(),
      legalEntityId: Id.nullable().optional(),
      timezone: z.string().max(64).nullable().optional(),
      managerPersonId: Id.nullable().optional(),
      effectiveFrom: IsoDate,
      reason: Reason.optional(),
    })
    .strict(),
);
export type CreateOrgUnitRequest = z.infer<typeof CreateOrgUnitRequest>;

export const OrgUnitChangeRequest = named(
  'OrgUnitChangeRequest',
  z
    .object({
      effectiveFrom: IsoDate.describe(
        'The day the change takes effect (after any earlier change).',
      ),
      name: z.string().trim().min(1).max(200).optional(),
      parentId: Id.optional().describe('Move under this unit.'),
      managerPersonId: Id.nullable().optional(),
      deactivate: z.literal(true).optional().describe('Close the unit from the effective date.'),
      reason: Reason,
    })
    .strict()
    .refine(
      (r) =>
        r.name !== undefined ||
        r.parentId !== undefined ||
        r.managerPersonId !== undefined ||
        r.deactivate === true,
      { message: 'Give at least one change: name, parentId, managerPersonId or deactivate.' },
    )
    .describe('An effective-dated change: rename, move, change manager or deactivate.'),
);
export type OrgUnitChangeRequest = z.infer<typeof OrgUnitChangeRequest>;

// People -----------------------------------------------------------------------------------------
export const Person = named(
  'Person',
  z
    .object({
      id: Id,
      displayName: z.string(),
      email: z.string(),
      jobTitle: z.string().nullable(),
      seniority: z.int().nullable(),
      employmentType: EmploymentType,
      locationOrgUnitId: Id.nullable(),
      locationName: z.string().nullable(),
      orgUnitId: Id.nullable(),
      orgUnitName: z.string().nullable(),
      costCenterId: Id.nullable(),
      costCenterCode: z.string().nullable(),
      employingEntityId: Id.nullable(),
      employingEntityCode: z.string().nullable(),
      timezone: z.string().nullable(),
      startDate: IsoDate.nullable(),
      endDate: IsoDate.nullable(),
      managerPersonId: Id.nullable(),
      managerName: z.string().nullable(),
    })
    .strict()
    .describe('A person in the directory (fictional seed data).'),
);
export type Person = z.infer<typeof Person>;

export const PeopleQuery = z
  .object({
    q: z.string().trim().max(100).optional().describe('Matches name, email or job title.'),
    orgUnitId: Id.optional().describe('Only people in this unit or below it.'),
    asOf: IsoDate.optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

export const PersonList = named(
  'PersonList',
  z
    .object({
      scope: OrgScope,
      total: z.int().min(0),
      items: z.array(Person),
      nextCursor: z.string().nullable(),
    })
    .strict(),
);

export const ReportingLineKind = z.enum(['solid', 'matrix']);

export const ReportingLine = named(
  'ReportingLine',
  z
    .object({
      id: Id,
      managerPersonId: Id,
      managerName: z.string(),
      kind: ReportingLineKind,
      validFrom: IsoDate,
      validTo: IsoDate.nullable(),
    })
    .strict(),
);

export const PersonDetail = named(
  'PersonDetail',
  Person.extend({
    asOf: IsoDate,
    reportingLines: z.array(ReportingLine).describe('Reporting history, newest first.'),
    directReports: z.array(
      z.object({ id: Id, displayName: z.string(), jobTitle: z.string().nullable() }).strict(),
    ),
    allowedActions: z.array(z.string()),
  }).strict(),
);
export type PersonDetail = z.infer<typeof PersonDetail>;

export const ReportingLineChangeRequest = named(
  'ReportingLineChangeRequest',
  z
    .object({
      managerPersonId: Id,
      kind: ReportingLineKind.default('solid'),
      effectiveFrom: IsoDate,
      reason: Reason,
    })
    .strict()
    .describe('Effective-dated manager change; the current solid line closes the day before.'),
);

// Cost centers -----------------------------------------------------------------------------------
export const CostCenter = named(
  'CostCenter',
  z
    .object({
      id: Id,
      code: z.string(),
      name: z.string(),
      legalEntityId: Id,
      legalEntityCode: z.string(),
      orgUnitId: Id.nullable(),
      orgUnitName: z.string().nullable(),
      validFrom: IsoDate,
      validTo: IsoDate.nullable(),
      active: z.boolean().describe('Active on the requested date.'),
    })
    .strict(),
);
export type CostCenter = z.infer<typeof CostCenter>;

export const CostCenterList = named(
  'CostCenterList',
  z.object({ asOf: IsoDate, items: z.array(CostCenter) }).strict(),
);

export const CreateCostCenterRequest = named(
  'CreateCostCenterRequest',
  z
    .object({
      code: Code,
      name: z.string().trim().min(1).max(200),
      legalEntityId: Id,
      orgUnitId: Id.nullable().optional(),
      effectiveFrom: IsoDate,
    })
    .strict(),
);

export const CostCenterChangeRequest = named(
  'CostCenterChangeRequest',
  z
    .object({
      name: z.string().trim().min(1).max(200).optional(),
      orgUnitId: Id.nullable().optional(),
      deactivateFrom: IsoDate.optional().describe('Last active day is the day before.'),
      reason: Reason,
    })
    .strict()
    .refine(
      (r) => r.name !== undefined || r.orgUnitId !== undefined || r.deactivateFrom !== undefined,
      { message: 'Give at least one change: name, orgUnitId or deactivateFrom.' },
    ),
);

// HR headcount and imports -----------------------------------------------------------------------
export const ImportIssue = named(
  'ImportIssue',
  z
    .object({ line: z.int().min(1), field: z.string().nullable(), message: z.string() })
    .strict()
    .describe('A problem on one line of an uploaded file (header is line 1).'),
);

export const HeadcountUnitSummary = named(
  'HeadcountUnitSummary',
  z
    .object({
      orgUnitId: Id,
      code: z.string(),
      name: z.string(),
      kind: OrgUnitKind,
      legalEntityId: Id.nullable(),
      headcount: z.int(),
      proratedHeadcountMilli: z.int().describe('Prorated headcount in thousandths.'),
      byType: HeadcountByType,
      previousHeadcount: z.int().nullable().describe('Same unit in the previous snapshot.'),
    })
    .strict(),
);

export const HeadcountLocation = named(
  'HeadcountLocation',
  HeadcountUnitSummary.extend({ teams: z.array(HeadcountUnitSummary) }).strict(),
);

export const HeadcountSnapshotSummary = named(
  'HeadcountSnapshotSummary',
  z
    .object({
      id: Id,
      asOfDate: IsoDate,
      source: z.string(),
      createdAt: IsoDateTime,
      lineCount: z.int(),
      totalHeadcount: z.int(),
    })
    .strict(),
);

export const HeadcountSummary = named(
  'HeadcountSummary',
  z
    .object({
      scope: OrgScope,
      snapshot: HeadcountSnapshotSummary.nullable(),
      total: z.int(),
      locations: z.array(HeadcountLocation),
    })
    .strict()
    .describe('Latest headcount snapshot on or before the date, by location and team.'),
);
export type HeadcountSummary = z.infer<typeof HeadcountSummary>;

export const HeadcountSnapshotList = named(
  'HeadcountSnapshotList',
  z.object({ items: z.array(HeadcountSnapshotSummary) }).strict(),
);

const Csv = z.string().min(1).max(2_000_000).describe('CSV text (UTF-8, header row first).');

export const HeadcountImportRequest = named(
  'HeadcountImportRequest',
  z
    .object({
      csv: Csv.describe(
        'Columns: location_code, team_code (optional), employment_type, headcount, prorated_headcount (optional).',
      ),
      asOfDate: IsoDate,
      dryRun: z.boolean().default(false).describe('Validate and preview without saving.'),
      fileName: z.string().max(200).optional(),
    })
    .strict(),
);
export type HeadcountImportRequest = z.infer<typeof HeadcountImportRequest>;

export const HeadcountImportResult = named(
  'HeadcountImportResult',
  z
    .object({
      dryRun: z.boolean(),
      accepted: z.boolean().describe('False when any line has an issue; nothing is saved then.'),
      snapshotId: Id.nullable(),
      asOfDate: IsoDate,
      rowsRead: z.int().describe('Data rows in the file (valid and invalid).'),
      lineCount: z.int(),
      totalHeadcount: z.int(),
      previousTotal: z.int().nullable(),
      issues: z.array(ImportIssue),
      units: z.array(HeadcountUnitSummary),
      locations: z
        .array(HeadcountUnitSummary)
        .describe('Totals per location in the file, with the previous snapshot.'),
    })
    .strict(),
);
export type HeadcountImportResult = z.infer<typeof HeadcountImportResult>;

export const OrgImportRequest = named(
  'OrgImportRequest',
  z
    .object({
      csv: Csv.describe(
        'Columns: code, name, kind, parent_code, legal_entity_code (optional), timezone (optional).',
      ),
      effectiveFrom: IsoDate,
      dryRun: z.boolean().default(false),
      reason: Reason.optional(),
    })
    .strict(),
);
export type OrgImportRequest = z.infer<typeof OrgImportRequest>;

export const OrgImportResult = named(
  'OrgImportResult',
  z
    .object({
      dryRun: z.boolean(),
      accepted: z.boolean(),
      effectiveFrom: IsoDate,
      created: z.int(),
      changed: z.int(),
      unchanged: z.int(),
      issues: z.array(ImportIssue),
      operations: z.array(
        z
          .object({
            line: z.int(),
            op: z.enum(['create', 'change', 'unchanged']),
            code: z.string(),
            name: z.string().nullable(),
            kind: OrgUnitKind.nullable(),
            parentCode: z.string().nullable(),
          })
          .strict(),
      ),
    })
    .strict(),
);
export type OrgImportResult = z.infer<typeof OrgImportResult>;

export const orgEndpoints = {
  listOrgUnits: {
    operationId: 'listOrgUnits',
    method: 'get',
    path: '/api/org/units',
    summary: 'Org units visible to the caller as of a date',
    tags: ['org'],
    auth: true,
    query: AsOfQuery,
    response: { status: 200, schema: OrgUnitList },
    errors: [400, 401, 403, 404],
  },
  getOrgUnit: {
    operationId: 'getOrgUnit',
    method: 'get',
    path: '/api/org/units/{orgUnitId}',
    summary: 'An org unit as of a date, with history, children and headcount',
    tags: ['org'],
    auth: true,
    params: OrgUnitParams,
    query: AsOfQuery,
    response: { status: 200, schema: OrgUnitDetail },
    errors: [400, 401, 403, 404],
  },
  createOrgUnit: {
    operationId: 'createOrgUnit',
    method: 'post',
    path: '/api/org/units',
    summary: 'Create an org unit effective from a date',
    tags: ['org'],
    auth: true,
    idempotent: true,
    body: CreateOrgUnitRequest,
    response: { status: 201, schema: OrgUnitDetail },
    errors: [400, 401, 403, 404, 409, 422],
  },
  changeOrgUnit: {
    operationId: 'changeOrgUnit',
    method: 'post',
    path: '/api/org/units/{orgUnitId}/changes',
    summary: 'Rename, move, change manager or deactivate an org unit from an effective date',
    tags: ['org'],
    auth: true,
    idempotent: true,
    params: OrgUnitParams,
    body: OrgUnitChangeRequest,
    response: { status: 201, schema: OrgUnitDetail },
    errors: [400, 401, 403, 404, 409, 422],
  },
  listPeople: {
    operationId: 'listPeople',
    method: 'get',
    path: '/api/org/people',
    summary: 'People visible to the caller',
    tags: ['org'],
    auth: true,
    query: PeopleQuery,
    response: { status: 200, schema: PersonList },
    errors: [400, 401, 403, 404],
  },
  getPerson: {
    operationId: 'getPerson',
    method: 'get',
    path: '/api/org/people/{personId}',
    summary: 'A person with reporting lines and direct reports',
    tags: ['org'],
    auth: true,
    params: PersonParams,
    query: AsOfQuery,
    response: { status: 200, schema: PersonDetail },
    errors: [400, 401, 403, 404],
  },
  changeReportingLine: {
    operationId: 'changeReportingLine',
    method: 'post',
    path: '/api/org/people/{personId}/reporting-lines',
    summary: 'Change who a person reports to from an effective date',
    tags: ['org'],
    auth: true,
    idempotent: true,
    params: PersonParams,
    body: ReportingLineChangeRequest,
    response: { status: 201, schema: PersonDetail },
    errors: [400, 401, 403, 404, 409, 422],
  },
  listCostCenters: {
    operationId: 'listCostCenters',
    method: 'get',
    path: '/api/org/cost-centers',
    summary: 'Cost centers as of a date',
    tags: ['org'],
    auth: true,
    query: AsOfQuery,
    response: { status: 200, schema: CostCenterList },
    errors: [400, 401, 403, 404],
  },
  createCostCenter: {
    operationId: 'createCostCenter',
    method: 'post',
    path: '/api/org/cost-centers',
    summary: 'Create a cost center effective from a date',
    tags: ['org'],
    auth: true,
    idempotent: true,
    body: CreateCostCenterRequest,
    response: { status: 201, schema: CostCenter },
    errors: [400, 401, 403, 404, 409, 422],
  },
  changeCostCenter: {
    operationId: 'changeCostCenter',
    method: 'post',
    path: '/api/org/cost-centers/{costCenterId}/changes',
    summary: 'Rename, re-link or deactivate a cost center',
    tags: ['org'],
    auth: true,
    idempotent: true,
    params: CostCenterParams,
    body: CostCenterChangeRequest,
    response: { status: 201, schema: CostCenter },
    errors: [400, 401, 403, 404, 409, 422],
  },
  getHeadcount: {
    operationId: 'getHeadcount',
    method: 'get',
    path: '/api/org/headcount',
    summary: 'Latest HR headcount on or before a date, by location and team',
    tags: ['org'],
    auth: true,
    query: AsOfQuery,
    response: { status: 200, schema: HeadcountSummary },
    errors: [400, 401, 403, 404],
  },
  listHeadcountSnapshots: {
    operationId: 'listHeadcountSnapshots',
    method: 'get',
    path: '/api/org/headcount/snapshots',
    summary: 'HR headcount snapshots, newest first',
    tags: ['org'],
    auth: true,
    response: { status: 200, schema: HeadcountSnapshotList },
    errors: [401, 403],
  },
  importHeadcount: {
    operationId: 'importHeadcount',
    method: 'post',
    path: '/api/org/headcount/imports',
    summary:
      'Validate (dry run) or apply an HR headcount CSV, refreshing counts by location and team',
    tags: ['org'],
    auth: true,
    idempotent: true,
    body: HeadcountImportRequest,
    response: { status: 201, schema: HeadcountImportResult },
    errors: [400, 401, 403, 404, 409, 422],
  },
  importOrgUnits: {
    operationId: 'importOrgUnits',
    method: 'post',
    path: '/api/org/imports',
    summary: 'Validate (dry run) or apply an org hierarchy CSV from an effective date',
    tags: ['org'],
    auth: true,
    idempotent: true,
    body: OrgImportRequest,
    response: { status: 201, schema: OrgImportResult },
    errors: [400, 401, 403, 404, 409, 422],
  },
} as const satisfies Record<string, Endpoint>;
