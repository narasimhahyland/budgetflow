import { ProblemDetails } from './common';
import { analyticsEndpoints } from './domains/analytics';
import { approvalEndpoints } from './domains/approvals';
import { auditEndpoints } from './domains/audit';
import { budgetEndpoints } from './domains/budgets';
import { contributionEndpoints } from './domains/contributions';
import { documentEndpoints } from './domains/documents';
import { eventEndpoints } from './domains/events';
import { financeEndpoints } from './domains/finance';
import { healthEndpoints } from './domains/health';
import { identityEndpoints } from './domains/identity';
import { integrityEndpoints } from './domains/integrity';
import { ledgerEndpoints } from './domains/ledger';
import { orgEndpoints } from './domains/org';
import { planningEndpoints } from './domains/planning';
import { requestEndpoints } from './domains/requests';

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
  ...eventEndpoints,
  ...requestEndpoints,
  ...approvalEndpoints,
  ...contributionEndpoints,
  ...documentEndpoints,
} as const;

export type Endpoints = typeof endpoints;
export type OperationId = keyof Endpoints;

export const problemResponse = ProblemDetails;
