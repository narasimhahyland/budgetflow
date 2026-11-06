// db-check: drizzle-kit check (snapshot consistency) plus drift detection: generating from the schema
// into a scratch copy of the migrations must produce no new migration. Run by the build gate.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';

const config = 'libs/api/db/drizzle.config.ts';
const migrations = 'libs/api/db/migrations';
const env = { ...process.env, TSX_TSCONFIG_PATH: 'libs/api/db/tsconfig.lib.json' };

execFileSync('npx', ['drizzle-kit', 'check', '--config', config], {
  env,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
console.log('db-check: drizzle-kit check passed');

// The scratch copy has to live inside the repository: drizzle-kit resolves `out` against the working
// directory even when it is already absolute, so a system temp directory becomes './/var/folders/...'
// and the probe reads no snapshots at all.
mkdirSync('tmp', { recursive: true });
const scratch = mkdtempSync('tmp/db-check-');
try {
  cpSync(migrations, scratch, { recursive: true });
  const sqlCount = () => readdirSync(scratch).filter((f) => f.endsWith('.sql')).length;
  const before = sqlCount();
  const probe = spawnSync(
    'npx',
    ['drizzle-kit', 'generate', '--config', config, '--name', 'drift_probe'],
    {
      env: { ...env, DRIZZLE_OUT: scratch },
      encoding: 'utf8',
    },
  );
  const output = `${probe.stdout ?? ''}${probe.stderr ?? ''}`;
  const after = sqlCount();
  const inSync = output.includes('No schema changes, nothing to migrate');

  // drizzle-kit exits 0 even when it fails outright, so an unchanged migration count on its own does
  // not mean "no drift" — it also happens when the probe never ran. Make the probe prove it ran:
  // either it said there was nothing to migrate, or it wrote a migration. Anything else is a broken
  // check, which must fail loudly rather than pass a snapshot nobody verified.
  if (probe.error || probe.status !== 0 || (!inSync && after === before)) {
    console.error('db-check: the drift probe did not run, so drift could not be ruled out.');
    console.error(output.trim() || probe.error?.message || `exit code ${probe.status}`);
    process.exit(1);
  }
  if (!inSync || after !== before) {
    console.error(
      'db-check: the Drizzle schema has changes without a migration. Run: npx nx run db:generate -- --name <verb_noun>',
    );
    // Only the tail: drizzle-kit prints every table above it, and the last lines name what it wrote.
    console.error(output.trim().split('\n').slice(-5).join('\n'));
    process.exit(1);
  }
  console.log('db-check: schema and migrations are in sync');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
