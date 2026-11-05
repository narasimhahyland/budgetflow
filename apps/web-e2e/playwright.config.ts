// Standalone on purpose: no Nx preset, so it also runs inside the pinned Playwright image (scripts/visual/pw-docker.sh).
// The `setup` project signs every role in once (src/auth.setup.ts); the other projects depend on it.
// Visual checks are light-only by default (dark theme deferred).
import { defineConfig, devices } from '@playwright/test';
import { env } from './src/support/env';

// Journeys that sign in fresh sessions, change a password or trip lockout counters run once, on desktop.
const SESSION_JOURNEYS = [/src\/auth\//, /src\/shell\/analytics\.spec\.ts/];

// Port from the shell, then .env (worktrees run their own stack), then infra/.env.example.
const baseURL = process.env.BASE_URL ?? `http://localhost:${env('BF_WEB_PORT')}`;
const updating = process.argv.some((a) => a === '-u' || a.startsWith('--update-snapshots'));
if (updating && process.env.PW_DOCKER !== '1') {
  throw new Error(
    'Visual baselines are updated only with `npm run e2e:update-snapshots` (pinned Playwright image).',
  );
}

export default defineConfig({
  testDir: './src',
  outputDir: '../../dist/.playwright/apps/web-e2e/test-results',
  // No {platform} segment: baselines are only produced in the pinned Linux image, locally and in CI.
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  fullyParallel: true,
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: '../../dist/.playwright/apps/web-e2e/report', open: 'never' }],
  ],
  expect: {
    // Signed-in pages first pass through the OIDC redirect to Keycloak and back.
    timeout: 15_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.002,
      threshold: 0.2,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },
  use: {
    baseURL,
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/, workers: 1 },
    {
      name: 'desktop',
      dependencies: ['setup'],
      testIgnore: /visual\//,
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'tablet',
      dependencies: ['setup'],
      testIgnore: [/visual\//, ...SESSION_JOURNEYS],
      use: { viewport: { width: 834, height: 1112 }, hasTouch: true },
    },
    {
      name: 'mobile',
      dependencies: ['setup'],
      testIgnore: [/visual\//, ...SESSION_JOURNEYS],
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'visual-light',
      dependencies: ['setup'],
      testMatch: /visual\/.*\.spec\.ts/,
      workers: 1,
      use: { colorScheme: 'light', trace: 'off' },
    },
  ],
});
