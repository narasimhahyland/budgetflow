// Standalone on purpose: no Nx preset, so it also runs inside the pinned Playwright image (scripts/visual/pw-docker.sh).
// Phase 2 adds the `setup` project (src/auth.setup.ts from docs/ai-harness/templates/web-e2e/) once sign-in exists,
// and makes desktop, tablet and mobile depend on it. Visual checks are light-only by default (dark theme deferred).
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.BASE_URL ?? `http://localhost:${process.env.BF_WEB_PORT ?? '4200'}`;
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
    colorScheme: 'light',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', testIgnore: /visual\//, use: { viewport: { width: 1440, height: 900 } } },
    {
      name: 'tablet',
      testIgnore: /visual\//,
      use: { viewport: { width: 834, height: 1112 }, hasTouch: true },
    },
    { name: 'mobile', testIgnore: /visual\//, use: { ...devices['Pixel 7'] } },
    { name: 'visual-light', testMatch: /visual\/.*\.spec\.ts/, use: { colorScheme: 'light' } },
  ],
});
