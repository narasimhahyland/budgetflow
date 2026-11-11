import { Logger } from '@nestjs/common';

/**
 * Development secrets are written in this public repository, so they protect nothing. They are used
 * only outside production, or on a local stack that opts in with `BF_ALLOW_DEV_SECRETS=true`
 * (infra/compose.yaml). Anywhere else a missing secret stops the API and the worker at startup.
 */
export function devSecretsAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env['BF_ALLOW_DEV_SECRETS'] === 'true' || (env['NODE_ENV'] ?? 'development') !== 'production'
  );
}

const warned = new Set<string>();

/** The configured secret (at least 16 characters), the development one where allowed, or an error. */
export function secretOrDev(
  name: string,
  value: string | undefined,
  devValue: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (value && value.length >= 16) return value;
  if (!devSecretsAllowed(env))
    throw new Error(
      `${name} is not set. Set it to a random value of at least 16 characters; the development value is public. ` +
        'On a local stack only, BF_ALLOW_DEV_SECRETS=true allows the development value.',
    );
  if (!warned.has(name)) {
    warned.add(name);
    new Logger('Secrets').warn(
      `${name} is not set; using the public development value (local stack only).`,
    );
  }
  return devValue;
}
