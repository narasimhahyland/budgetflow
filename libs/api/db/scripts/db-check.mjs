// db-check: drizzle-kit check (snapshot consistency) plus drift detection: generating from the schema
// into a scratch copy of the migrations must produce no new migration. Run by the build gate.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const config = 'libs/api/db/drizzle.config.ts';
const migrations = 'libs/api/db/migrations';
const env = { ...process.env, TSX_TSCONFIG_PATH: 'libs/api/db/tsconfig.lib.json' };
const kit = (args, extraEnv = {}) =>
  execFileSync('npx', ['drizzle-kit', ...args], {
    env: { ...env, ...extraEnv },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

kit(['check', '--config', config]);
console.log('db-check: drizzle-kit check passed');

const scratch = mkdtempSync(join(tmpdir(), 'bf-db-check-'));
try {
  cpSync(migrations, scratch, { recursive: true });
  const before = readdirSync(scratch).filter((f) => f.endsWith('.sql')).length;
  kit(['generate', '--config', config, '--name', 'drift_probe'], { DRIZZLE_OUT: scratch });
  const after = readdirSync(scratch).filter((f) => f.endsWith('.sql')).length;
  if (after !== before) {
    console.error(
      'db-check: the Drizzle schema has changes without a migration. Run: npx nx run db:generate -- --name <verb_noun>',
    );
    process.exit(1);
  }
  console.log('db-check: schema and migrations are in sync');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
