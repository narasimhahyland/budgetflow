// Dev-only stack settings for journeys: the shell first, then .env (worktrees with other ports), then
// infra/.env.example. Never point journeys at shared or real environments.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../../..');

function parse(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
}

const fileEnv = { ...parse(resolve(root, 'infra/.env.example')), ...parse(resolve(root, '.env')) };

export function env(name: string): string {
  const v = process.env[name] ?? fileEnv[name];
  if (v === undefined) throw new Error(`${name} is not set (expected in infra/.env.example)`);
  return v;
}

export const KEYCLOAK_URL = `http://localhost:${env('BF_KEYCLOAK_PORT')}`;
export const KEYCLOAK_ISSUER = `${KEYCLOAK_URL}/realms/budgetflow`;
export const MAILPIT_URL = `http://localhost:${env('BF_MAILPIT_PORT')}`;
export const API_URL = `http://localhost:${env('BF_API_PORT')}`;
