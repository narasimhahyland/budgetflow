import { z } from 'zod';
import { CurrencyCode, Id, IsoDate, IsoDateTime, Money } from '../common';
import type { Endpoint } from '../endpoint';
import { named } from '../registry';

/**
 * Gap B3: tax-aware consumption (080g) and the employee benefit ledger with benefit-in-kind
 * thresholds (080h). Recoverable GST/VAT never uses budget; the benefit ledger never moves budget money.
 */

export const TAX_ATTENDEE_TYPES = ['employees', 'clients', 'mixed', 'any'] as const;
export const TaxAttendeeType = z
  .enum(TAX_ATTENDEE_TYPES)
  .describe('Who attended or received the spend: employees, clients, a mix, or any.');
export const VersionStatus = z
  .enum(['draft', 'pending_approval', 'returned', 'published', 'superseded'])
  .describe('Version lifecycle: drafted by finance, published by the tax approver.');
const ChangeMarker = z.enum(['added', 'changed', 'unchanged']);
const Comment = z.string().trim().min(1).max(1000);

// Tax breakdown ---------------------------------------------------------------------------------

export const TaxBreakdown = named(
  'TaxBreakdown',
  z
    .object({
      taxCode: z.string(),
      ruleId: Id.nullable().describe('The rule in force; null when no rule covers the spend.'),
      ruleVersion: z.int().nullable(),
      attendeeType: TaxAttendeeType,
      recoverableShareBps: z.int().min(0).max(10000),
      net: Money.describe('Amount without tax, transaction currency.'),
      tax: Money,
      recoverable: Money.describe('Recoverable tax: tracked for reporting, never uses budget.'),
      nonRecoverable: Money.describe('Tax the entity cannot recover: it uses budget.'),
      usesBudget: Money.describe('Net plus non-recoverable tax, transaction currency.'),
      usesBudgetReporting: Money.describe(
        'The same in the reporting currency at the locked plan rate.',
      ),
      recoverableReporting: Money.describe(
        'Recoverable tax in the reporting currency at the plan rate.',
      ),
      posted: z
        .boolean()
        .describe('True once the split is recorded on a commitment or actual (never re-posted).'),
    })
    .strict(),
);
export type TaxBreakdown = z.infer<typeof TaxBreakdown>;

export const RequestTaxInput = named(
  'RequestTaxInput',
  z
    .object({
      amount: Money.describe(
        'GST/VAT on top of the request amount, in the request currency. The split into recoverable and non-recoverable tax follows the rule in force on the submission date.',
      ),
    })
    .strict(),
);

export const ActualTaxView = named(
  'ActualTaxView',
  z
    .object({
      gross: Money.describe('The line as charged, tax included.'),
      lines: z.array(
        z
          .object({
            taxCode: z.string(),
            amount: Money,
            recoverable: z.boolean(),
            shareBps: z.int().nullable(),
            ruleId: Id.nullable(),
          })
          .strict(),
      ),
      recoverable: Money,
      nonRecoverable: Money,
      usesBudget: Money.describe('Gross less recoverable tax: what matching can consume.'),
    })
    .strict(),
);
export type ActualTaxView = z.infer<typeof ActualTaxView>;

// Tax rule sets ---------------------------------------------------------------------------------

export const TaxRuleInput = named(
  'TaxRuleInput',
  z
    .object({
      legalEntityId: Id,
      categoryCode: z
        .string()
        .trim()
        .min(1)
        .max(50)
        .describe('Spend category code, or * for every category of the entity.'),
      attendeeType: TaxAttendeeType,
      taxCode: z.string().trim().min(1).max(30),
      recoverableBps: z
        .int()
        .nullable()
        .describe('Recoverable share in basis points (0-10000); null when proportional.'),
      proportional: z
        .boolean()
        .describe('Recoverable in proportion to the employees present (mixed attendance).'),
      notes: z.string().trim().max(500).nullable().optional(),
    })
    .strict(),
);
export type TaxRuleInput = z.infer<typeof TaxRuleInput>;

export const TaxRuleView = named(
  'TaxRuleView',
  z
    .object({
      id: Id,
      legalEntityId: Id,
      legalEntityCode: z.string(),
      taxJurisdiction: z.string().nullable(),
      categoryCode: z.string(),
      categoryName: z.string(),
      attendeeType: TaxAttendeeType,
      taxCode: z.string(),
      recoverableBps: z.int().nullable(),
      proportional: z.boolean(),
      notes: z.string().nullable(),
      effect: z.string().describe('Plain-English effect on the budget.'),
      changeMarker: ChangeMarker.describe('Against the version in force.'),
    })
    .strict(),
);
export type TaxRuleView = z.infer<typeof TaxRuleView>;

export const TaxRuleSetView = named(
  'TaxRuleSetView',
  z
    .object({
      id: Id,
      version: z.int(),
      status: VersionStatus,
      effectiveFrom: IsoDate.nullable(),
      comment: z.string().nullable().describe('The tax approver’s comments when returned.'),
      submittedByName: z.string().nullable(),
      submittedAt: IsoDateTime.nullable(),
      decidedByName: z.string().nullable(),
      decidedAt: IsoDateTime.nullable(),
      rules: z.array(TaxRuleView),
    })
    .strict(),
);
export type TaxRuleSetView = z.infer<typeof TaxRuleSetView>;

export const TaxRulesView = named(
  'TaxRulesView',
  z
    .object({
      asOf: IsoDate,
      current: TaxRuleSetView.nullable().describe('The published version in force today.'),
      upcoming: TaxRuleSetView.nullable().describe('A published version that starts later.'),
      draft: TaxRuleSetView.nullable().describe('The draft, pending or returned version.'),
      categories: z.array(z.object({ code: z.string(), name: z.string() }).strict()),
      entities: z.array(
        z
          .object({
            id: Id,
            code: z.string(),
            name: z.string(),
            currency: CurrencyCode,
            taxJurisdiction: z.string().nullable(),
          })
          .strict(),
      ),
      reportingCurrency: CurrencyCode,
      canEdit: z.boolean(),
      canPublish: z.boolean(),
    })
    .strict(),
);
export type TaxRulesView = z.infer<typeof TaxRulesView>;

export const SaveTaxRulesRequest = named(
  'SaveTaxRulesRequest',
  z.object({ rules: z.array(TaxRuleInput).max(500) }).strict(),
);
export const PublishVersionRequest = named(
  'PublishVersionRequest',
  z.object({ effectiveFrom: IsoDate }).strict(),
);
export const ReturnVersionRequest = named(
  'ReturnVersionRequest',
  z.object({ comment: Comment }).strict(),
);

export const TaxPreviewQuery = z
  .object({
    legalEntityId: Id,
    categoryCode: z.string().min(1).max(50),
    employees: z.coerce.number().int().min(0).max(100000).default(1),
    others: z.coerce.number().int().min(0).max(100000).default(0),
    amountMinor: z.coerce.number().int().safe(),
    taxMinor: z.coerce.number().int().safe(),
    currency: CurrencyCode,
    date: IsoDate.optional(),
    ruleSetId: Id.optional().describe('Preview against a draft instead of the rules in force.'),
  })
  .strict();

// Benefit ledger --------------------------------------------------------------------------------

export const BenefitStatus = z.enum(['under', 'approaching', 'over']);
export const ThresholdBasis = z.enum(['per_year', 'per_event']);
export const ExceededBehaviour = z
  .enum(['whole', 'excess', 'not_reportable'])
  .describe('Once exceeded: the whole amount, only the excess, or nothing (company caps).');

const Window = z.object({ fromDate: IsoDate, toDate: IsoDate }).strict();

export const BenefitLedgerRow = named(
  'BenefitLedgerRow',
  z
    .object({
      personId: Id,
      personName: z.string(),
      legalEntityId: Id,
      legalEntityCode: z.string(),
      locationName: z.string().nullable(),
      thresholdId: Id,
      thresholdName: z.string(),
      window: Window.describe('The threshold’s own tax year.'),
      basis: ThresholdBasis,
      counted: Money.describe('Counted toward the threshold, in its currency at the plan rate.'),
      limit: Money,
      occasions: z.int(),
      maxOccasions: z.int().nullable(),
      status: BenefitStatus,
      exceeded: ExceededBehaviour,
      reportable: Money.nullable().describe('Null for company caps (never reportable).'),
      exported: z.boolean().describe('Payroll exports arrive with the finance exports package.'),
    })
    .strict(),
);
export type BenefitLedgerRow = z.infer<typeof BenefitLedgerRow>;

export const BenefitLedgerView = named(
  'BenefitLedgerView',
  z
    .object({
      asOf: IsoDate,
      items: z.array(BenefitLedgerRow),
      templates: z
        .array(z.object({ thresholdId: Id, name: z.string(), note: z.string() }).strict())
        .describe('Published thresholds with no legal entity in scope yet.'),
      benefitTypes: z.array(z.string()),
      reportingCurrency: CurrencyCode,
    })
    .strict(),
);
export type BenefitLedgerView = z.infer<typeof BenefitLedgerView>;

export const BenefitLedgerQuery = z
  .object({
    legalEntityId: Id.optional(),
    status: BenefitStatus.optional(),
    benefitType: z.string().max(50).optional(),
    asOf: IsoDate.optional(),
  })
  .strict();

export const BenefitEntry = named(
  'BenefitEntry',
  z
    .object({
      id: Id,
      personId: Id,
      entryDate: IsoDate,
      benefitType: z.string(),
      description: z.string().nullable(),
      source: z
        .object({
          type: z.enum(['event', 'request', 'manual']),
          id: Id.nullable(),
          label: z.string(),
        })
        .strict(),
      amount: Money.describe('Local currency of the benefit.'),
      reporting: Money.describe('Reporting currency at the locked plan rate.'),
      reversalOfId: Id.nullable(),
      reversedById: Id.nullable(),
      countedToward: z.array(z.string()).describe('Threshold names this entry counts toward.'),
      createdAt: IsoDateTime,
    })
    .strict(),
);
export type BenefitEntry = z.infer<typeof BenefitEntry>;

export const BenefitPersonView = named(
  'BenefitPersonView',
  z
    .object({
      personId: Id,
      personName: z.string(),
      legalEntityCode: z.string().nullable(),
      asOf: IsoDate,
      entries: z.array(BenefitEntry),
      totals: z.array(BenefitLedgerRow),
    })
    .strict(),
);
export type BenefitPersonView = z.infer<typeof BenefitPersonView>;

export const RecordBenefitRequest = named(
  'RecordBenefitRequest',
  z
    .object({
      personId: Id,
      entryDate: IsoDate,
      benefitType: z.string().trim().min(1).max(50),
      amount: Money.describe('Positive; reverse an entry to take it back.'),
      description: z.string().trim().min(3).max(500),
      eventId: Id.optional().describe('The event the benefit came from, for per-event allowances.'),
    })
    .strict(),
);
export const ReverseBenefitRequest = named(
  'ReverseBenefitRequest',
  z.object({ reason: Comment }).strict(),
);

export const BenefitThresholdInput = named(
  'BenefitThresholdInput',
  z
    .object({
      code: z
        .string()
        .regex(/^[A-Z0-9][A-Z0-9_-]{1,49}$/)
        .describe('Stable code; a new version of an existing code supersedes it when published.'),
      name: z.string().trim().min(3).max(200),
      jurisdiction: z.string().trim().min(2).max(10),
      legalEntityIds: z.array(Id).max(50),
      benefitTypes: z.array(z.string().trim().min(1).max(50)).min(1).max(30),
      limit: Money,
      basis: ThresholdBasis,
      maxOccasions: z.int().min(1).max(365).nullable(),
      periodStartMonth: z.int().min(1).max(12),
      periodStartDay: z.int().min(1).max(31),
      exceeded: ExceededBehaviour,
    })
    .strict(),
);
export type BenefitThresholdInput = z.infer<typeof BenefitThresholdInput>;

export const BenefitThresholdView = named(
  'BenefitThresholdView',
  BenefitThresholdInput.extend({
    id: Id,
    version: z.int(),
    status: VersionStatus,
    template: z.boolean().describe('No legal entity in scope yet.'),
    legalEntityCodes: z.array(z.string()),
    effectiveFrom: IsoDate.nullable(),
    effectiveTo: IsoDate.nullable(),
    comment: z.string().nullable(),
    submittedByName: z.string().nullable(),
    decidedByName: z.string().nullable(),
  }).strict(),
);
export type BenefitThresholdView = z.infer<typeof BenefitThresholdView>;

export const BenefitThresholdList = named(
  'BenefitThresholdList',
  z
    .object({
      items: z.array(BenefitThresholdView),
      canEdit: z.boolean(),
      canPublish: z.boolean(),
    })
    .strict(),
);

const RuleSetParams = z.object({ ruleSetId: Id }).strict();
const ThresholdParams = z.object({ thresholdId: Id }).strict();
const PersonParams = z.object({ personId: Id }).strict();
const EntryParams = z.object({ entryId: Id }).strict();
const Empty = named('TaxEmptyCommand', z.object({}).strict().describe('No fields.'));

function command<
  B extends z.ZodType,
  R extends z.ZodType,
  P extends z.ZodObject | undefined = undefined,
>(
  operationId: string,
  method: 'post' | 'put',
  path: string,
  summary: string,
  tag: string,
  body: B,
  schema: R,
  params?: P,
  status = 200,
) {
  return {
    operationId,
    method,
    path,
    summary,
    tags: [tag],
    auth: true,
    idempotent: true,
    ...((params ? { params } : {}) as P extends z.ZodObject ? { params: P } : object),
    body,
    response: { status, schema },
    errors: [400, 401, 403, 404, 409, 422],
  };
}

export const taxEndpoints = {
  getTaxRules: {
    operationId: 'getTaxRules',
    method: 'get',
    path: '/api/finance/tax-rules',
    summary: 'Tax recoverability rules in force, upcoming and in draft',
    tags: ['tax'],
    auth: true,
    response: { status: 200, schema: TaxRulesView },
    errors: [401, 403],
  },
  previewTaxSplit: {
    operationId: 'previewTaxSplit',
    method: 'get',
    path: '/api/finance/tax-rules/preview',
    summary: 'Split a tax amount by the rules (no side effects)',
    tags: ['tax'],
    auth: true,
    query: TaxPreviewQuery,
    response: { status: 200, schema: TaxBreakdown },
    errors: [400, 401, 403, 404],
  },
  createTaxRuleDraft: command(
    'createTaxRuleDraft',
    'post',
    '/api/finance/tax-rules/drafts',
    'Start a draft from the latest published version',
    'tax',
    Empty,
    TaxRuleSetView,
    undefined,
    201,
  ),
  saveTaxRuleDraft: command(
    'saveTaxRuleDraft',
    'put',
    '/api/finance/tax-rules/drafts/{ruleSetId}',
    'Replace the rules of a draft',
    'tax',
    SaveTaxRulesRequest,
    TaxRuleSetView,
    RuleSetParams,
  ),
  submitTaxRuleDraft: command(
    'submitTaxRuleDraft',
    'post',
    '/api/finance/tax-rules/drafts/{ruleSetId}/submit',
    'Submit a draft to the tax approver',
    'tax',
    Empty,
    TaxRuleSetView,
    RuleSetParams,
  ),
  publishTaxRuleSet: command(
    'publishTaxRuleSet',
    'post',
    '/api/finance/tax-rules/drafts/{ruleSetId}/publish',
    'Publish a submitted version from an effective date (tax approver)',
    'tax',
    PublishVersionRequest,
    TaxRuleSetView,
    RuleSetParams,
  ),
  returnTaxRuleSet: command(
    'returnTaxRuleSet',
    'post',
    '/api/finance/tax-rules/drafts/{ruleSetId}/return',
    'Return a submitted version with comments (tax approver)',
    'tax',
    ReturnVersionRequest,
    TaxRuleSetView,
    RuleSetParams,
  ),
  getBenefitLedger: {
    operationId: 'getBenefitLedger',
    method: 'get',
    path: '/api/finance/benefits/ledger',
    summary: 'Benefits per person against each threshold in its own tax year',
    tags: ['benefits'],
    auth: true,
    query: BenefitLedgerQuery,
    response: { status: 200, schema: BenefitLedgerView },
    errors: [400, 401, 403],
  },
  getBenefitPerson: {
    operationId: 'getBenefitPerson',
    method: 'get',
    path: '/api/finance/benefits/people/{personId}',
    summary: 'One person’s benefit entries and totals per threshold',
    tags: ['benefits'],
    auth: true,
    params: PersonParams,
    query: z.object({ asOf: IsoDate.optional() }).strict(),
    response: { status: 200, schema: BenefitPersonView },
    errors: [400, 401, 403, 404],
  },
  recordBenefitEntry: command(
    'recordBenefitEntry',
    'post',
    '/api/finance/benefits/entries',
    'Record a benefit received outside BudgetFlow events and requests',
    'benefits',
    RecordBenefitRequest,
    BenefitEntry,
    undefined,
    201,
  ),
  reverseBenefitEntry: command(
    'reverseBenefitEntry',
    'post',
    '/api/finance/benefits/entries/{entryId}/reverse',
    'Reverse a benefit entry (append-only: a negating entry)',
    'benefits',
    ReverseBenefitRequest,
    BenefitEntry,
    EntryParams,
    201,
  ),
  listBenefitThresholds: {
    operationId: 'listBenefitThresholds',
    method: 'get',
    path: '/api/finance/benefits/thresholds',
    summary: 'Benefit-in-kind thresholds and company caps by jurisdiction',
    tags: ['benefits'],
    auth: true,
    response: { status: 200, schema: BenefitThresholdList },
    errors: [401, 403],
  },
  createBenefitThreshold: command(
    'createBenefitThreshold',
    'post',
    '/api/finance/benefits/thresholds',
    'Draft a threshold, or a new version of an existing code',
    'benefits',
    BenefitThresholdInput,
    BenefitThresholdView,
    undefined,
    201,
  ),
  updateBenefitThreshold: command(
    'updateBenefitThreshold',
    'put',
    '/api/finance/benefits/thresholds/{thresholdId}',
    'Edit a draft threshold',
    'benefits',
    BenefitThresholdInput,
    BenefitThresholdView,
    ThresholdParams,
  ),
  submitBenefitThreshold: command(
    'submitBenefitThreshold',
    'post',
    '/api/finance/benefits/thresholds/{thresholdId}/submit',
    'Submit a draft threshold to the tax approver',
    'benefits',
    Empty,
    BenefitThresholdView,
    ThresholdParams,
  ),
  publishBenefitThreshold: command(
    'publishBenefitThreshold',
    'post',
    '/api/finance/benefits/thresholds/{thresholdId}/publish',
    'Publish a submitted threshold (tax approver)',
    'benefits',
    PublishVersionRequest,
    BenefitThresholdView,
    ThresholdParams,
  ),
  returnBenefitThreshold: command(
    'returnBenefitThreshold',
    'post',
    '/api/finance/benefits/thresholds/{thresholdId}/return',
    'Return a submitted threshold with comments (tax approver)',
    'benefits',
    ReturnVersionRequest,
    BenefitThresholdView,
    ThresholdParams,
  ),
} as const satisfies Record<string, Endpoint>;
