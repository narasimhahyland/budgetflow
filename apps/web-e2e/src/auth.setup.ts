// Signs in every seeded role persona once through the real BudgetFlow sign-in page and saves its
// storageState to tmp/e2e-auth/<role>.json (gitignored: it holds the Keycloak session cookies). The app
// keeps tokens in memory only, so specs that load a state get signed in silently through Keycloak SSO.
import { mkdirSync } from 'node:fs';
import { test as setup } from '@playwright/test';
import { expectShell, submitSignIn } from './support/auth';
import { authFile, ROLES } from './support/roles';

mkdirSync('tmp/e2e-auth', { recursive: true });

for (const role of ROLES) {
  setup(`sign in as ${role.id}`, async ({ page }) => {
    await page.goto('/');
    await submitSignIn(page, role.id);
    await expectShell(page);
    await page.context().storageState({ path: authFile(role.id) });
  });
}
