// Template for apps/web-e2e/playwright.config.ts (copy when Phase 2 creates the project).
// Standalone on purpose: no Nx preset, so it also runs inside the pinned Playwright image (scripts/visual/pw-docker.sh).
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.BASE_URL ?? 'http://localhost:4200';
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
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: '../../dist/.playwright/apps/web-e2e/report', open: 'never' }],
  ],
  expect: {
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
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'desktop',
      dependencies: ['setup'],
      testIgnore: /visual\//,
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'tablet',
      dependencies: ['setup'],
      testIgnore: /visual\//,
      use: { viewport: { width: 834, height: 1112 }, hasTouch: true },
    },
    {
      name: 'mobile',
      dependencies: ['setup'],
      testIgnore: /visual\//,
      use: { ...devices['Pixel 7'] },
    },
    // Light theme only (dark theme deferred). To re-enable dark: add a 'visual-dark' project with colorScheme 'dark'
    // and pass --project=visual-dark in the e2e:visual and e2e:update-snapshots scripts.
    {
      name: 'visual-light',
      dependencies: ['setup'],
      testMatch: /visual\/.*\.spec\.ts/,
      use: { colorScheme: 'light' },
    },
  ],
});
