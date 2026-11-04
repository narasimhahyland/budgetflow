import { z } from 'zod';

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
  AI_PROVIDER: z.enum(['fake']).default('fake'),
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
