import { z } from 'zod';
import { isCidr } from './client-ip';

/** Environment, validated once at startup. Every variable is listed in infra/.env.example with a dev placeholder. */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1).describe('Application role (no BYPASSRLS).'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  KEYCLOAK_ISSUER: z
    .url()
    .describe('Public issuer URL, e.g. http://localhost:8080/realms/budgetflow'),
  KEYCLOAK_JWKS_URL: z
    .url()
    .optional()
    .describe('Where the API fetches signing keys (inside Compose: the keycloak service).'),
  KEYCLOAK_AUDIENCE: z.string().default('budgetflow-api'),
  KEYCLOAK_WEB_CLIENT_ID: z
    .string()
    .default('budgetflow-web')
    .describe('Public OIDC client the web app signs in with (served by /api/auth/config).'),
  AI_PROVIDER: z
    .enum(['recorded', 'bedrock'])
    .default('recorded')
    .describe(
      'recorded: offline answers from committed recordings (local stack, functional runs, CI). bedrock: Amazon Bedrock, credentials from the environment.',
    ),
  // Compose passes `FIXED_NOW: ${BF_FIXED_NOW:-}`, which is an empty string when the variable is
  // unset rather than absent, so empty has to mean "not set" or an ordinary stack fails to boot.
  FIXED_NOW: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.iso.datetime().optional(),
    )
    .describe(
      'Development and test only: the instant the API treats as now, so server-computed ages and ' +
        'countdowns stay still for a visual run. Read by clock.ts. Never set it in a deployment.',
    ),
  TRUSTED_PROXY_CIDRS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .refine((list) => list.every(isCidr), {
      message: 'every entry must be an IP address or a CIDR range, separated by commas',
    })
    .describe(
      'Proxies in front of the API whose X-Forwarded-For header may be believed, as addresses or ' +
        'CIDR ranges. Empty (the default) ignores the header, so a caller cannot claim an address.',
    ),
});

export type AppConfig = z.infer<typeof EnvSchema> & { jwksUrl: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const c = parsed.data;
  return {
    ...c,
    jwksUrl: c.KEYCLOAK_JWKS_URL ?? `${c.KEYCLOAK_ISSUER}/protocol/openid-connect/certs`,
  };
}
