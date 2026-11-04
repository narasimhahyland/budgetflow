import { z } from 'zod';
import { CurrencyCode, Id, RoleId } from '../common';
import type { Endpoint } from '../endpoint';
import { named } from '../registry';

// Identity -------------------------------------------------------------------------------------
export const MeResponse = named(
  'MeResponse',
  z
    .object({
      subject: z.string(),
      tenantId: Id,
      tenantName: z.string(),
      reportingCurrency: CurrencyCode,
      personId: Id.nullable(),
      displayName: z.string(),
      roles: z.array(RoleId),
      memberships: z.array(
        z.object({ tenantId: Id, tenantName: z.string(), roles: z.array(RoleId) }).strict(),
      ),
    })
    .strict()
    .describe('The signed-in user in the selected tenant, with every tenant they belong to.'),
);

export type MeResponse = z.infer<typeof MeResponse>;

export const identityEndpoints = {
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
} as const satisfies Record<string, Endpoint>;
