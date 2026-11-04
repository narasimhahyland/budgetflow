import { z } from 'zod';
import type { Endpoint } from '../endpoint';
import { named } from '../registry';

// Health ---------------------------------------------------------------------------------------
export const HealthResponse = named(
  'HealthResponse',
  z
    .object({ status: z.literal('ok') })
    .strict()
    .describe('Liveness.'),
);

export const ReadinessResponse = named(
  'ReadinessResponse',
  z
    .object({
      status: z.enum(['ready', 'not_ready']),
      checks: z
        .object({ database: z.enum(['up', 'down']), identityProvider: z.enum(['up', 'down']) })
        .strict(),
    })
    .strict()
    .describe('Readiness: database and Keycloak JWKS reachable.'),
);

export type HealthResponse = z.infer<typeof HealthResponse>;
export type ReadinessResponse = z.infer<typeof ReadinessResponse>;

export const healthEndpoints = {
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
} as const satisfies Record<string, Endpoint>;
