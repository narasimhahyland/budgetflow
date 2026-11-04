// Dev-only stack settings: the shell first, then .env (when a worktree changed ports), then infra/.env.example.
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

export const KEYCLOAK_ISSUER =
  process.env.KEYCLOAK_ISSUER ?? `http://localhost:${env('BF_KEYCLOAK_PORT')}/realms/budgetflow`;
export const PG = { host: '127.0.0.1', port: Number(env('BF_PG_PORT')), database: env('BF_PG_DB') };
