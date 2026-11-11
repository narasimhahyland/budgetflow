// Phase 18: the API and the worker refuse to start in production on a public development secret.
// Chat account linking, Slack and Teams webhook signing and integration credential encryption fell
// back to values written in this repository, so anyone could forge a chat link and approve as someone
// else. Each scenario starts the built bundle (dist/apps/<app>/main.js, made by scripts/stack.sh up)
// with only the variables it needs and reads what the process says before it would reach the database.
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
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

/** Starts an app bundle with exactly `env` (plus PATH) and returns what it printed and its exit code. */
function start(app: 'api' | 'worker', env: Record<string, string>) {
  const main = resolve(ROOT, `dist/apps/${app}/main.js`);
  expect(existsSync(main), `${main} (run scripts/stack.sh up first)`).toBe(true);
  // An unreachable database: past the secret check the app fails fast on its first connection.
  const r = spawnSync(process.execPath, [main], {
    cwd: resolve(ROOT, `dist/apps/${app}`),
    env: {
      PATH: process.env['PATH'] ?? '',
      DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:1/none',
      KEYCLOAK_ISSUER: 'http://127.0.0.1:1/realms/budgetflow',
      PORT: '0',
      HEALTH_PORT: '0',
      ...env,
    },
    encoding: 'utf8',
    // Past the check the app may wait on its database; the secret check has spoken by then.
    timeout: 8_000,
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

for (const app of ['api', 'worker'] as const) {
  test(`${app}: production without its secrets refuses to start and names the variable`, () => {
    const r = start(app, { NODE_ENV: 'production' });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(REFUSAL);
    expect(r.out).toMatch(/SLACK_SIGNING_SECRET|TEAMS_WEBHOOK_SECRET|CHAT_LINK_SECRET/);
  });

  test(`${app}: one missing secret is enough to refuse`, () => {
    const { CHAT_LINK_SECRET: _omitted, ...others } = SECRETS;
    const r = start(app, { NODE_ENV: 'production', ...others });
    expect(r.out).toMatch(REFUSAL);
    expect(r.out).toContain('CHAT_LINK_SECRET is not set');
  });

  test(`${app}: real secrets, or the local stack's opt-in, pass the check`, () => {
    const real = start(app, { NODE_ENV: 'production', ...SECRETS });
    expect(real.out).not.toMatch(REFUSAL);
    expect(real.out).not.toContain('public development value');
    expect(real.out, 'the app got past the check and started').toContain(
      'Starting Nest application',
    );
    const local = start(app, { NODE_ENV: 'production', BF_ALLOW_DEV_SECRETS: 'true' });
    expect(local.out).not.toMatch(REFUSAL);
    // The local stack says, once per secret, that it is on the public development value.
    expect(local.out).toContain('CHAT_LINK_SECRET is not set; using the public development value');
    expect(local.out).toContain('Starting Nest application');
  });
}
