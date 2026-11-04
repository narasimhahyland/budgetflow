import { z } from 'zod';
import { CurrencyCode, Id, IsoDateTime } from '../common';
import type { Endpoint } from '../endpoint';
import { named } from '../registry';

const CheckParams = z.object({ checkId: Id }).strict();

// Integrity ------------------------------------------------------------------------------------
export const IntegrityCheckRun = named(
  'IntegrityCheckRun',
  z
    .object({
      id: Id,
      kind: z.literal('ledger_rebuild'),
      status: z.enum(['queued', 'running', 'clean', 'drift_detected', 'failed']),
      requestedAt: IsoDateTime,
      startedAt: IsoDateTime.nullable(),
      finishedAt: IsoDateTime.nullable(),
      flagsRaised: z.int(),
      summary: z
        .object({
          budgetsChecked: z.int(),
          journalsChecked: z.int(),
          linesChecked: z.int(),
          unbalancedJournals: z.array(Id),
          balanceDrifts: z.array(
            z
              .object({
                budgetId: Id,
                periodId: Id,
                bucket: z.string(),
                rebuiltBudgetMinor: z.int(),
                cachedBudgetMinor: z.int(),
                rebuiltReportingMinor: z.int(),
                cachedReportingMinor: z.int(),
              })
              .strict(),
          ),
          hierarchyMismatches: z.array(
            z
              .object({
                parentId: Id,
                currency: CurrencyCode,
                allocatedOutMinor: z.int(),
                childrenAuthorizedAtPlanMinor: z
                  .int()
                  .describe(
                    "Children's authorized valued in the parent currency at the locked plan rate.",
                  ),
                roundingAllowanceMinor: z.int(),
              })
              .strict(),
          ),
          negativeBuckets: z.array(
            z.object({ budgetId: Id, bucket: z.string(), balanceMinor: z.int() }).strict(),
          ),
          overAllocatedBudgets: z.array(
            z
              .object({ budgetId: Id, authorizedMinor: z.int(), allocatedOutMinor: z.int() })
              .strict(),
          ),
          tripletMismatches: z.array(
            z
              .object({
                lineId: Id,
                journalId: Id,
                view: z.enum(['budget', 'reporting', 'rounding', 'reversal']),
                expectedMinor: z.int().nullable(),
                storedMinor: z.int(),
              })
              .strict(),
          ),
          planTieMismatches: z.array(
            z
              .object({
                planVersionId: Id,
                planFundingReportingMinor: z.int(),
                rootAuthorizedReportingMinor: z.int(),
              })
              .strict(),
          ),
          auditChain: z
            .object({ valid: z.boolean(), checked: z.int(), firstBrokenSeq: z.int().nullable() })
            .strict(),
        })
        .strict()
        .nullable(),
    })
    .strict()
    .describe(
      'A ledger rebuild check run by the worker: rebuilt balances versus cached ones, journal balance, non-negative buckets, allocated out within authorized, per-line currency triplets, hierarchy at the plan rate, plan tie-out and the audit chain.',
    ),
);

export type IntegrityCheckRun = z.infer<typeof IntegrityCheckRun>;

export const integrityEndpoints = {
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
} as const satisfies Record<string, Endpoint>;
