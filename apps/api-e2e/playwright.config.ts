// API scenarios over HTTP against the running API (scripts/stack.sh up && reset) with real Keycloak tokens.
// Scenarios create their own budgets through the API, so they are order-independent and repeatable
// without a reset; destructive integrity checks run only in the Initech Sandbox tenant and restore it.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './src',
  outputDir: '../../dist/.playwright/apps/api-e2e/test-results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  reporter: [
    ['list'],
    ['html', { outputFolder: '../../dist/.playwright/apps/api-e2e/report', open: 'never' }],
  ],
  use: {
    baseURL: process.env.API_URL ?? `http://localhost:${process.env.BF_API_PORT ?? '3000'}`,
    extraHTTPHeaders: { accept: 'application/json' },
  },
});
