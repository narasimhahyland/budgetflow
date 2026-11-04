import { z } from 'zod';
import {
  BudgetStatus,
  BudgetType,
  ConsumingBucket,
  ControlMode,
  CurrencyCode,
  CursorQuery,
  Id,
  IsoDate,
  IsoDateTime,
  Money,
} from '../common';
import type { Endpoint } from '../endpoint';
import { named } from '../registry';
import { Journal, LedgerLineList } from './ledger';

const BudgetParams = z.object({ budgetId: Id }).strict();

// Budgets --------------------------------------------------------------------------------------
export const ControlSettings = named(
  'ControlSettings',
  z
    .object({
      basis: z.array(ConsumingBucket).min(1).describe('Buckets counted against available.'),
      mode: ControlMode.describe('hard blocks, soft warns, track only records.'),
      toleranceBps: z
        .int()
        .min(0)
        .max(10_000)
        .describe('Spend tolerance in basis points of authorized.'),
    })
    .strict(),
);

const bucketMoney = z
  .object({
    authorized: Money,
    allocatedOut: Money,
    held: Money,
    preEncumbered: Money,
    encumbered: Money,
    actual: Money,
    accrued: Money,
  })
  .strict();

export const BudgetBalances = named(
  'BudgetBalances',
  z
    .object({
      budgetCurrency: bucketMoney.describe(
        'Bucket balances in the budget currency (natural sign).',
      ),
      reporting: bucketMoney.describe(
        'Bucket balances in the reporting currency at the locked plan rate.',
      ),
      available: Money.describe(
        'authorized − counted buckets per the control basis, budget currency.',
      ),
      availableReporting: Money,
      allocationAvailable: Money.describe(
        'What can still be allocated to children (allocated out always counts, no tolerance).',
      ),
    })
    .strict(),
);

export const BudgetDetail = named(
  'BudgetDetail',
  z
    .object({
      id: Id,
      parentId: Id.nullable(),
      path: z.string().describe('Materialized path of ancestor ids, root first.'),
      name: z.string(),
      code: z.string().nullable(),
      status: BudgetStatus,
      allocationBadge: z.enum(['unallocated', 'partially_allocated', 'fully_allocated']),
      budgetType: BudgetType,
      categoryCode: z.string().nullable(),
      legalEntityId: Id,
      costCenterId: Id.nullable(),
      orgUnitId: Id.nullable(),
      ownerPersonId: Id.nullable(),
      currency: CurrencyCode,
      reportingCurrency: CurrencyCode,
      fiscalYearId: Id,
      planVersionId: Id.nullable(),
      control: ControlSettings,
      alertThresholdsPct: z.array(z.int().min(1).max(100)),
      balances: BudgetBalances,
      version: z.int(),
      allowedActions: z
        .array(z.string())
        .describe('Actions the current user may take on this budget (from PolicyService).'),
      createdAt: IsoDateTime,
    })
    .strict()
    .describe('A budget with its ledger-derived balances.'),
);
export type BudgetDetail = z.infer<typeof BudgetDetail>;

export const BudgetList = named(
  'BudgetList',
  z
    .object({ items: z.array(BudgetDetail), nextCursor: z.string().nullable() })
    .strict()
    .describe('Budgets visible to the user, cursor-paginated.'),
);

export const CreateBudgetRequest = named(
  'CreateBudgetRequest',
  z
    .object({
      name: z.string().trim().min(2).max(200),
      code: z.string().trim().min(1).max(50).optional(),
      parentId: Id.nullable().optional().describe('Omit for a root budget.'),
      legalEntityId: Id,
      costCenterId: Id.nullable()
        .optional()
        .describe(
          'Required on leaf budgets that take spend (Phase 4 enforces at first commitment).',
        ),
      orgUnitId: Id.nullable().optional(),
      ownerPersonId: Id.nullable().optional(),
      categoryCode: z.string().max(50).optional(),
      budgetType: BudgetType.optional().describe('Defaults to operating.'),
      currency: CurrencyCode,
      fiscalYearId: Id,
      planVersionId: Id.optional().describe(
        'Required for a root budget: the approved plan version it ties to.',
      ),
      originalAmount: Money.optional().describe(
        'Root budgets only: the original authorized amount in the budget currency.',
      ),
      control: ControlSettings.optional(),
      alertThresholdsPct: z.array(z.int().min(1).max(100)).max(5).optional(),
      accountingDate: IsoDate.optional(),
    })
    .strict()
    .describe('Create a root budget (posts the original budget journal) or an empty child budget.'),
);
export type CreateBudgetRequest = z.infer<typeof CreateBudgetRequest>;

export const AllocateRequest = named(
  'AllocateRequest',
  z
    .object({
      childBudgetId: Id,
      amount: Money.describe(
        "In the parent's or the child's budget currency; converted at the locked plan rate.",
      ),
      accountingDate: IsoDate.optional(),
      memo: z.string().max(500).optional(),
    })
    .strict(),
);

export const AllocationResponse = named(
  'AllocationResponse',
  z.object({ journal: Journal, parent: BudgetDetail, child: BudgetDetail }).strict(),
);

export type ControlSettings = z.infer<typeof ControlSettings>;
export type BudgetBalances = z.infer<typeof BudgetBalances>;
export type BudgetList = z.infer<typeof BudgetList>;
export type AllocateRequest = z.infer<typeof AllocateRequest>;
export type AllocationResponse = z.infer<typeof AllocationResponse>;

export const budgetEndpoints = {
  listBudgets: {
    operationId: 'listBudgets',
    method: 'get',
    path: '/api/budgets',
    summary: 'Budgets visible to the user',
    tags: ['budgets'],
    auth: true,
    query: CursorQuery,
    response: { status: 200, schema: BudgetList },
    errors: [400, 401, 403],
  },
  createBudget: {
    operationId: 'createBudget',
    method: 'post',
    path: '/api/budgets',
    summary: 'Create a root budget with its original amount, or an empty child budget',
    tags: ['budgets'],
    auth: true,
    idempotent: true,
    body: CreateBudgetRequest,
    response: { status: 201, schema: BudgetDetail },
    errors: [400, 401, 403, 404, 409, 422],
  },
  getBudget: {
    operationId: 'getBudget',
    method: 'get',
    path: '/api/budgets/{budgetId}',
    summary: 'A budget with ledger-derived balances',
    tags: ['budgets'],
    auth: true,
    params: BudgetParams,
    response: { status: 200, schema: BudgetDetail },
    errors: [401, 403, 404],
  },
  allocate: {
    operationId: 'allocate',
    method: 'post',
    path: '/api/budgets/{budgetId}/allocations',
    summary: 'Allocate to a child budget, checked against parent available at the locked plan rate',
    tags: ['budgets'],
    auth: true,
    idempotent: true,
    params: BudgetParams,
    body: AllocateRequest,
    response: { status: 201, schema: AllocationResponse },
    errors: [400, 401, 403, 404, 409, 422],
  },
  budgetLedger: {
    operationId: 'budgetLedger',
    method: 'get',
    path: '/api/budgets/{budgetId}/ledger',
    summary: 'Ledger lines posted to a budget',
    tags: ['ledger'],
    auth: true,
    params: BudgetParams,
    response: { status: 200, schema: LedgerLineList },
    errors: [401, 403, 404],
  },
} as const satisfies Record<string, Endpoint>;
