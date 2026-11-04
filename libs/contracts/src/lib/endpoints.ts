import { z } from 'zod';
import { CursorQuery, Id, ProblemDetails } from './common';
import {
  AllocateRequest,
  AllocationResponse,
  AuditEventList,
  AuditEventQuery,
  AuditVerification,
  BudgetDetail,
  BudgetList,
  CreateBudgetRequest,
  HealthResponse,
  IntegrityCheckRun,
  Journal,
  LedgerLineList,
  ManualJournalRequest,
  MeResponse,
  ReadinessResponse,
  ReversalRequest,
} from './schemas';

/**
 * The API surface. OpenAPI and the typed client are generated from this registry; controllers parse
 * with the same schemas. Mutations require an `Idempotency-Key` header.
 */
export interface Endpoint {
  operationId: string;
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  summary: string;
  tags: string[];
  auth: boolean;
  idempotent?: boolean;
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  response: { status: number; schema: z.ZodType };
  errors: number[];
}

const BudgetParams = z.object({ budgetId: Id }).strict();
const JournalParams = z.object({ journalId: Id }).strict();
const CheckParams = z.object({ checkId: Id }).strict();

export const endpoints = {
  health: {
    operationId: 'health',
    method: 'get',
    path: '/health',
    summary: 'Liveness',
    tags: ['health'],
    auth: false,
    response: { status: 200, schema: HealthResponse },
    errors: [],
  },
  ready: {
    operationId: 'ready',
    method: 'get',
    path: '/health/ready',
    summary: 'Readiness (database, Keycloak JWKS)',
    tags: ['health'],
    auth: false,
    response: { status: 200, schema: ReadinessResponse },
    errors: [503],
  },
  me: {
    operationId: 'me',
    method: 'get',
    path: '/api/me',
    summary: 'Current user, tenant and memberships',
    tags: ['identity'],
    auth: true,
    response: { status: 200, schema: MeResponse },
    errors: [401, 403],
  },
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
  getJournal: {
    operationId: 'getJournal',
    method: 'get',
    path: '/api/ledger/journals/{journalId}',
    summary: 'A journal with its lines and totals',
    tags: ['ledger'],
    auth: true,
    params: JournalParams,
    response: { status: 200, schema: Journal },
    errors: [401, 403, 404],
  },
  postManualJournal: {
    operationId: 'postManualJournal',
    method: 'post',
    path: '/api/ledger/journals',
    summary: 'Post a manual journal (opening balances, adjustments)',
    tags: ['ledger'],
    auth: true,
    idempotent: true,
    body: ManualJournalRequest,
    response: { status: 201, schema: Journal },
    errors: [400, 401, 403, 404, 409, 422],
  },
  reverseJournal: {
    operationId: 'reverseJournal',
    method: 'post',
    path: '/api/ledger/journals/{journalId}/reversals',
    summary: 'Reverse a journal with a linked, exactly negating journal',
    tags: ['ledger'],
    auth: true,
    idempotent: true,
    params: JournalParams,
    body: ReversalRequest,
    response: { status: 201, schema: Journal },
    errors: [400, 401, 403, 404, 409, 422],
  },
  requestLedgerCheck: {
    operationId: 'requestLedgerCheck',
    method: 'post',
    path: '/api/integrity/ledger-checks',
    summary: 'Queue a ledger rebuild check (the worker runs it; it also runs nightly)',
    tags: ['integrity'],
    auth: true,
    idempotent: true,
    response: { status: 202, schema: IntegrityCheckRun },
    errors: [401, 403],
  },
  getLedgerCheck: {
    operationId: 'getLedgerCheck',
    method: 'get',
    path: '/api/integrity/ledger-checks/{checkId}',
    summary: 'A ledger rebuild check result',
    tags: ['integrity'],
    auth: true,
    params: CheckParams,
    response: { status: 200, schema: IntegrityCheckRun },
    errors: [401, 403, 404],
  },
  listAuditEvents: {
    operationId: 'listAuditEvents',
    method: 'get',
    path: '/api/audit/events',
    summary: 'Hash-chained audit events',
    tags: ['audit'],
    auth: true,
    query: AuditEventQuery,
    response: { status: 200, schema: AuditEventList },
    errors: [400, 401, 403],
  },
  verifyAuditChain: {
    operationId: 'verifyAuditChain',
    method: 'get',
    path: '/api/audit/verification',
    summary: "Verify the tenant's audit hash chain",
    tags: ['audit'],
    auth: true,
    response: { status: 200, schema: AuditVerification },
    errors: [401, 403],
  },
} as const satisfies Record<string, Endpoint>;

export type Endpoints = typeof endpoints;
export type OperationId = keyof Endpoints;

export const problemResponse = ProblemDetails;
