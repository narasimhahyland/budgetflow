// Template for apps/web-e2e/src/auth.setup.ts: signs in every seeded Keycloak test user once and saves its
// storageState to tmp/e2e-auth/<role>.json (gitignored; it contains tokens). Specs and the visual QA capture
// script pick a role by that file name.
import { mkdirSync, readFileSync } from 'node:fs';
import { expect, test as setup } from '@playwright/test';
import { ROLES } from './support/roles';

/** Dev-only seed password: BF_E2E_PASSWORD, else the value documented in infra/.env.example. */
function password(): string {
  if (process.env.BF_E2E_PASSWORD) return process.env.BF_E2E_PASSWORD;
  const line = readFileSync('infra/.env.example', 'utf8').split('\n').find((l) => l.startsWith('BF_E2E_PASSWORD='));
  const value = line?.slice('BF_E2E_PASSWORD='.length).trim();
  if (!value) throw new Error('Set BF_E2E_PASSWORD or document the dev-only seed value in infra/.env.example');
  return value;
}

for (const role of ROLES) {
  setup(`sign in as ${role.id}`, async ({ page }) => {
    await page.goto('/');
    await page.getByLabel(/username or email/i).fill(role.username);
    await page.getByLabel(/^password$/i).fill(password());
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('navigation', { name: /primary/i })).toBeVisible();
    mkdirSync('tmp/e2e-auth', { recursive: true });
    await page.context().storageState({ path: `tmp/e2e-auth/${role.id}.json` });
  });
}
