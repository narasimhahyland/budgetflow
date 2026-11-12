// Phase 18: the API and the worker refuse to start in production on a public development secret.
// Chat account linking, Slack and Teams webhook signing and integration credential encryption fell
// back to values written in this repository, so anyone could forge a chat link and approve as someone
// else. Each scenario starts the built bundle (dist/apps/<app>/main.js, made by scripts/stack.sh up)
// with only the variables it needs and reads what the process says before it would reach the database.
import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../..');
const SECRETS = {
  SLACK_SIGNING_SECRET: 'scenario-slack-secret-0001',
  TEAMS_WEBHOOK_SECRET: 'scenario-teams-secret-0001',
  CHAT_LINK_SECRET: 'scenario-chat-link-secret-0001',
  INTEGRATIONS_SECRET_KEY: 'scenario-integrations-key-0001',
  APPROVAL_LINK_SECRET: 'scenario-approval-link-secret-0001',
};
const REFUSAL = /is not set\. Set it to a random value of at least 16 characters/;

/** What decides each scenario: the secret check's refusal, or Nest starting past it. */
const DECIDED = /is not set\. Set it to a random value|Starting Nest application/;

/**
 * Starts an app bundle with exactly `env` (plus PATH) and returns what it printed and its exit code.
 * It waits for the decisive line (or the process exiting) instead of a fixed time, so a busy machine
 * only makes it slower, never wrong; the ceiling is for a process that hangs before either.
 */
async function start(app: 'api' | 'worker', env: Record<string, string>) {
  const main = resolve(ROOT, `dist/apps/${app}/main.js`);
  expect(existsSync(main), `${main} (run scripts/stack.sh up first)`).toBe(true);
  // An unreachable database: past the secret check the app fails on its first connection.
  const child = spawn(process.execPath, [main], {
    cwd: resolve(ROOT, `dist/apps/${app}`),
    env: {
      PATH: process.env['PATH'] ?? '',
      DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:1/none',
      KEYCLOAK_ISSUER: 'http://127.0.0.1:1/realms/budgetflow',
      PORT: '0',
      HEALTH_PORT: '0',
      ...env,
    },
  });
  let out = '';
  const code = await new Promise<number | null>((done) => {
    const ceiling = setTimeout(() => child.kill('SIGTERM'), 60_000);
    const read = (chunk: Buffer) => {
      out += chunk.toString('utf8');
      if (DECIDED.test(out)) {
        // A refusal exits by itself; give its output a moment to flush, then stop either way.
        setTimeout(() => child.kill('SIGTERM'), 500);
      }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('exit', (c) => {
      clearTimeout(ceiling);
      done(c);
    });
  });
  return { code, out };
}

// Starting a bundle takes seconds, more on a busy machine; the ceiling in start() bounds it.
test.describe.configure({ timeout: 150_000 });

for (const app of ['api', 'worker'] as const) {
  test(`${app}: production without its secrets refuses to start and names the variable`, async () => {
    const r = await start(app, { NODE_ENV: 'production' });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(REFUSAL);
    expect(r.out).toMatch(/SLACK_SIGNING_SECRET|TEAMS_WEBHOOK_SECRET|CHAT_LINK_SECRET/);
  });

  test(`${app}: one missing secret is enough to refuse`, async () => {
    const { CHAT_LINK_SECRET: _omitted, ...others } = SECRETS;
    const r = await start(app, { NODE_ENV: 'production', ...others });
    expect(r.out).toMatch(REFUSAL);
    expect(r.out).toContain('CHAT_LINK_SECRET is not set');
  });

  test(`${app}: real secrets, or the local stack's opt-in, pass the check`, async () => {
    const real = await start(app, { NODE_ENV: 'production', ...SECRETS });
    expect(real.out).not.toMatch(REFUSAL);
    expect(real.out).not.toContain('public development value');
    expect(real.out, 'the app got past the check and started').toContain(
      'Starting Nest application',
    );
    const local = await start(app, { NODE_ENV: 'production', BF_ALLOW_DEV_SECRETS: 'true' });
    expect(local.out).not.toMatch(REFUSAL);
    // The local stack says, once per secret, that it is on the public development value.
    expect(local.out).toContain('CHAT_LINK_SECRET is not set; using the public development value');
    expect(local.out).toContain('Starting Nest application');
  });
}
