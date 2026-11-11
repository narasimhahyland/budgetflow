// Phase 17: migration checks against throwaway Postgres 16 containers (Testcontainers).
//
// 1. Empty to current: every committed migration applies to a fresh database prepared exactly as
//    the stack prepares one (infra/postgres/init), producing the tables the latest snapshot records,
//    with row level security enabled AND forced on every tenant table.
// 2. Previous to current, with data: the repository has no releases, so "the previous release" is
//    the database as the previous migration left it, populated with the deterministic seed. A
//    current database is seeded; its data is copied into a database migrated only to the previous
//    migration, table by table and column by column as the previous snapshot records them (so a
//    future migration that adds a column to an old table still yields a valid previous database);
//    then the newest migration is applied and every row must survive it.
//
// Both use the built migrator and seed (dist/apps/api/migrate.js, seed.js): the code the stack runs,
// not a test-only path. Build first: `npx nx build api`.
import { expect, test } from '@playwright/test';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Network, type StartedNetwork } from 'testcontainers';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../..');
const DIST = join(ROOT, 'dist/apps/api');
const MIGRATIONS = join(ROOT, 'libs/api/db/migrations');
const IMAGE = 'postgres:16.11-alpine'; // the image infra/compose.yaml pins
const OWNER = 'bf_owner';
const PASSWORD = 'migration-check-only';
const DB = 'budgetflow';

interface Snapshot {
  tables: Record<string, { columns: Record<string, { generated?: unknown }> }>;
}
interface Journal {
  entries: { idx: number; tag: string }[];
}

const journal = (): Journal =>
  JSON.parse(readFileSync(join(MIGRATIONS, 'meta/_journal.json'), 'utf8'));
const snapshot = (idx: number): Snapshot =>
  JSON.parse(
    readFileSync(join(MIGRATIONS, `meta/${String(idx).padStart(4, '0')}_snapshot.json`), 'utf8'),
  );

async function postgres(
  network: StartedNetwork,
  alias: string,
): Promise<StartedPostgreSqlContainer> {
  return new PostgreSqlContainer(IMAGE)
    .withDatabase(DB)
    .withUsername(OWNER)
    .withPassword(PASSWORD)
    .withEnvironment({
      BF_PG_APP_PASSWORD: 'app-check-only',
      BF_PG_WORKER_PASSWORD: 'worker-check-only',
    })
    .withBindMounts([
      {
        source: join(ROOT, 'infra/postgres/init'),
        target: '/docker-entrypoint-initdb.d',
        mode: 'ro',
      },
    ])
    .withNetwork(network)
    .withNetworkAliases(alias)
    .start();
}

function migrate(pg: StartedPostgreSqlContainer, migrationsDir: string): void {
  execFileSync('node', [join(DIST, 'migrate.js')], {
    env: {
      ...process.env,
      DATABASE_URL_OWNER: pg.getConnectionUri(),
      MIGRATIONS_DIR: migrationsDir,
    },
    stdio: 'pipe',
  });
}

function seed(pg: StartedPostgreSqlContainer): void {
  execFileSync('node', [join(DIST, 'seed.js')], {
    env: { ...process.env, DATABASE_URL_OWNER: pg.getConnectionUri() },
    stdio: 'pipe',
    timeout: 10 * 60_000,
  });
}

/** The committed migrations up to and including `lastIdx`, as a directory the migrator can read. */
function migrationsUpTo(lastIdx: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'bf-migrations-'));
  cpSync(MIGRATIONS, dir, { recursive: true });
  const j = journal();
  const kept = j.entries.filter((e) => e.idx <= lastIdx);
  writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify({ ...j, entries: kept }, null, 2));
  for (const e of j.entries.filter((x) => x.idx > lastIdx)) {
    expect(existsSync(join(dir, `${e.tag}.sql`))).toBe(true);
  }
  return dir;
}

async function sql(pg: StartedPostgreSqlContainer, query: string): Promise<string> {
  const r = await pg.exec([
    'psql',
    '-U',
    OWNER,
    '-d',
    DB,
    '-At',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    query,
  ]);
  expect(r.exitCode, r.output).toBe(0);
  return r.output.trim();
}

async function rowCount(pg: StartedPostgreSqlContainer, qualified: string): Promise<number> {
  return Number(await sql(pg, `SELECT count(*) FROM ${qualified}`));
}

const quoted = (qualified: string) =>
  qualified
    .split('.')
    .map((p) => `"${p}"`)
    .join('.');

test.describe.configure({ mode: 'serial', timeout: 20 * 60_000 });

test.describe('migrations (Testcontainers, Postgres 16)', () => {
  let network: StartedNetwork;
  test.beforeAll(async () => {
    expect(existsSync(join(DIST, 'migrate.js')), 'build the API first: npx nx build api').toBe(
      true,
    );
    network = await new Network().start();
  });
  test.afterAll(async () => {
    await network?.stop();
  });

  test('an empty database migrates to the current schema, with RLS forced on every tenant table', async () => {
    const pg = await postgres(network, 'pg-empty');
    try {
      migrate(pg, join(DIST, 'migrations'));
      const last = journal().entries.at(-1)!;
      const expected = Object.keys(snapshot(last.idx).tables).length;
      const tables = Number(
        await sql(pg, `SELECT count(*) FROM pg_tables WHERE schemaname = 'public'`),
      );
      expect(tables, `the ${last.tag} snapshot records ${expected} tables`).toBe(expected);

      const unforced = await sql(
        pg,
        `SELECT string_agg(c.relname, ', ') FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
           JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
          WHERE c.relkind = 'r' AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`,
      );
      expect(unforced, 'tenant tables without ENABLE and FORCE ROW LEVEL SECURITY').toBe('');

      const bypass = await sql(
        pg,
        `SELECT string_agg(rolname, ', ') FROM pg_roles
          WHERE rolname IN ('bf_app', 'bf_worker') AND (rolbypassrls OR rolsuper)`,
      );
      expect(bypass, 'application roles must never bypass RLS').toBe('');
    } finally {
      await pg.stop();
    }
  });

  test('the previous migration, populated by the seed, upgrades to the current one with every row intact', async () => {
    const entries = journal().entries;
    const previous = entries.at(-2)!;
    const current = entries.at(-1)!;
    const before = snapshot(previous.idx);

    const source = await postgres(network, 'pg-source');
    const target = await postgres(network, 'pg-target');
    try {
      // Source: the current schema with the deterministic seed in it.
      migrate(source, join(DIST, 'migrations'));
      seed(source);
      // Target: the schema as the previous migration left it.
      migrate(target, migrationsUpTo(previous.idx));

      // Copy every table the previous schema had, with the columns it had then. Triggers are off
      // for the copy (session_replication_role = replica) so append-only, closed-period and
      // foreign-key triggers do not refuse rows the seed wrote legitimately in another order.
      const copied: string[] = [];
      for (const [qualified, t] of Object.entries(before.tables)) {
        const cols = Object.entries(t.columns)
          .filter(([, c]) => !c.generated)
          .map(([name]) => `"${name}"`)
          .join(', ');
        const pipe =
          `PGPASSWORD=${PASSWORD} psql -h pg-source -U ${OWNER} -d ${DB} -v ON_ERROR_STOP=1 ` +
          `-c "\\copy (SELECT ${cols.replace(/"/g, '\\"')} FROM ${quoted(qualified).replace(/"/g, '\\"')}) TO STDOUT" | ` +
          `PGOPTIONS='-c session_replication_role=replica' psql -U ${OWNER} -d ${DB} -v ON_ERROR_STOP=1 ` +
          `-c "\\copy ${quoted(qualified).replace(/"/g, '\\"')} (${cols.replace(/"/g, '\\"')}) FROM STDIN"`;
        const r = await target.exec(['sh', '-c', pipe]);
        expect(r.exitCode, `copying ${qualified}: ${r.output}`).toBe(0);
        copied.push(qualified);
      }
      const counts = new Map<string, number>();
      for (const q of copied) counts.set(q, await rowCount(target, quoted(q)));
      const populated = [...counts.values()].filter((n) => n > 0).length;
      expect(
        populated,
        'the seed populates a meaningful share of the previous schema',
      ).toBeGreaterThan(50);

      // Upgrade: the newest migration applies to a populated previous-release database...
      migrate(target, join(DIST, 'migrations'));
      // ...adds what the current snapshot adds...
      const now = Number(
        await sql(target, `SELECT count(*) FROM pg_tables WHERE schemaname = 'public'`),
      );
      expect(now, `${current.tag} brings the table count to the current snapshot's`).toBe(
        Object.keys(snapshot(current.idx).tables).length,
      );
      // ...and every row survives it.
      const total = [...counts.values()].reduce((a, b) => a + b, 0);
      test.info().annotations.push({
        type: 'upgrade',
        description: `${previous.tag} -> ${current.tag}: ${copied.length} tables copied, ${populated} populated, ${total} rows`,
      });
      for (const q of copied) {
        expect(await rowCount(target, quoted(q)), `${q} rows after ${current.tag}`).toBe(
          counts.get(q),
        );
      }
    } finally {
      await source.stop();
      await target.stop();
    }
  });
});
