// Template for apps/api-e2e/playwright.config.ts (copy when Phase 1 creates the project).
// API scenarios over HTTP against the running API (scripts/stack.sh up && reset) with real Keycloak tokens.
// Set API_E2E_ISOLATED=1 to give each worker its own Testcontainers Postgres + API instance (src/support/isolated.ts).
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './src',
  outputDir: '../../dist/.playwright/apps/api-e2e/test-results',
  fullyParallel: process.env.API_E2E_ISOLATED === '1',
  workers: process.env.API_E2E_ISOLATED === '1' ? undefined : 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: '../../dist/.playwright/apps/api-e2e/report', open: 'never' }]],
  use: {
    baseURL: process.env.API_URL ?? 'http://localhost:3000',
    extraHTTPHeaders: { accept: 'application/json' },
  },
});
