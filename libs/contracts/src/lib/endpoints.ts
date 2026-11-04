import { ProblemDetails } from './common';
import { analyticsEndpoints } from './domains/analytics';
import { auditEndpoints } from './domains/audit';
import { budgetEndpoints } from './domains/budgets';
import { financeEndpoints } from './domains/finance';
import { healthEndpoints } from './domains/health';
import { identityEndpoints } from './domains/identity';
import { integrityEndpoints } from './domains/integrity';
import { ledgerEndpoints } from './domains/ledger';
import { orgEndpoints } from './domains/org';
import { planningEndpoints } from './domains/planning';

export type { Endpoint } from './endpoint';

/**
 * The API surface, combined from one file per domain (libs/contracts/src/lib/domains/<domain>.ts).
 * OpenAPI and the typed client are generated from it. A phase adds a domain file and one line here.
 */
export const endpoints = {
  ...healthEndpoints,
  ...identityEndpoints,
  ...budgetEndpoints,
  ...ledgerEndpoints,
  ...integrityEndpoints,
  ...auditEndpoints,
  ...orgEndpoints,
  ...financeEndpoints,
  ...analyticsEndpoints,
  ...planningEndpoints,
} as const;

export type Endpoints = typeof endpoints;
export type OperationId = keyof Endpoints;

export const problemResponse = ProblemDetails;
