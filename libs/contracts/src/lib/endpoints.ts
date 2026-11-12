import { ProblemDetails } from './common';
import { actualsEndpoints } from './domains/actuals';
import { aiEndpoints } from './domains/ai';
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
import { integrationEndpoints } from './domains/integrations';
import { integrityEndpoints } from './domains/integrity';
import { ledgerEndpoints } from './domains/ledger';
import { orgEndpoints } from './domains/org';
import { planningEndpoints } from './domains/planning';
import { reportEndpoints } from './domains/reports';
import { requestEndpoints } from './domains/requests';
import { adminEndpoints } from './domains/admin';
import { channelEndpoints } from './domains/channels';
import { closeEndpoints } from './domains/close';
import { extendedEndpoints } from './domains/extended';
import { ecosystemEndpoints } from './domains/ecosystem';
import { rulesEndpoints } from './domains/rules';
import { taxEndpoints } from './domains/tax';

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
  ...actualsEndpoints,
  ...channelEndpoints,
  ...rulesEndpoints,
  ...reportEndpoints,
  ...integrationEndpoints,
  ...closeEndpoints,
  ...adminEndpoints,
  ...aiEndpoints,
  ...extendedEndpoints,
  ...ecosystemEndpoints,
  ...taxEndpoints,
} as const;

export type Endpoints = typeof endpoints;
export type OperationId = keyof Endpoints;

export const problemResponse = ProblemDetails;
