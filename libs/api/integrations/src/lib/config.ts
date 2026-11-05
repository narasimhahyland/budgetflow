import { z } from 'zod';

/**
 * Phase 12 configuration. Outbound HTTP (connector calls and webhook deliveries) only reaches hosts
 * on the allowlist, so a connector or a customer endpoint can never make the API call an arbitrary
 * address. Every value here is a reference or a dev placeholder; real credentials come from the
 * environment and are never committed.
 */
const Env = z.object({
  INTEGRATIONS_MOCK_BASE_URL: z.string().default('http://mock-providers:4010'),
  INTEGRATIONS_ALLOWED_HOSTS: z.string().default('mock-providers,localhost,127.0.0.1'),
  INTEGRATIONS_SECRET_KEY: z.string().optional(),
  INTEGRATIONS_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().min(30).max(900).default(300),
  INTEGRATIONS_HTTP_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(5_000),
});

/** Dev-only fallback so the local stack starts without extra setup. Never used with real data. */
const DEV_SECRET_KEY = 'integration-secrets-dev-only-0001';

export const MAX_RETRY_ATTEMPTS = 8;
/** 1, 2, 4, 8, 16, 32, 60, 60 minutes, then the dead letter (100). */
export const RETRY_BACKOFF_MINUTES = [1, 2, 4, 8, 16, 32, 60, 60] as const;
/** A webhook endpoint that keeps failing for this long is disabled and its owner notified. */
export const WEBHOOK_FAILURE_WINDOW_HOURS = 24;
/** After rotation both signing secrets are accepted for this long, so receivers can switch over. */
export const WEBHOOK_SECRET_OVERLAP_HOURS = 24;
export const DEFAULT_API_KEY_RATE_LIMIT = 120;

export interface IntegrationsConfig {
  mockBaseUrl: string;
  allowedHosts: string[];
  secretKey: string;
  webhookToleranceSeconds: number;
  httpTimeoutMs: number;
}

export function integrationsConfig(env: NodeJS.ProcessEnv = process.env): IntegrationsConfig {
  const parsed = Env.parse(env);
  const key = parsed.INTEGRATIONS_SECRET_KEY;
  return {
    mockBaseUrl: parsed.INTEGRATIONS_MOCK_BASE_URL.replace(/\/+$/, ''),
    allowedHosts: parsed.INTEGRATIONS_ALLOWED_HOSTS.split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
    secretKey: key && key.length >= 16 ? key : DEV_SECRET_KEY,
    webhookToleranceSeconds: parsed.INTEGRATIONS_WEBHOOK_TOLERANCE_SECONDS,
    httpTimeoutMs: parsed.INTEGRATIONS_HTTP_TIMEOUT_MS,
  };
}
