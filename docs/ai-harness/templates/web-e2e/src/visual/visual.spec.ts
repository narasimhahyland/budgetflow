// Template for apps/web-e2e/src/visual/visual.spec.ts: visual regression baselines for every screen state in
// apps/web-e2e/visual/screens.json (the same file the visual QA capture script reads). Runs in the visual-light
// project (light theme only; dark theme deferred), inside the pinned Playwright image only (npm run e2e:visual / e2e:update-snapshots).
// Data comes from the deterministic e2e seed (scripts/stack.sh reset); the clock is frozen; animations are off.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

type Action = {
  click?: string;
  fill?: [string, string];
  select?: [string, string];
  hover?: string;
  press?: string;
  waitFor?: string;
};
type State = {
  state: string;
  path?: string;
  role?: string;
  waitFor?: string;
  actions?: Action[];
  mask?: string[];
  fullPage?: boolean;
};
type Screen = {
  id: string;
  path: string;
  role?: string;
  waitFor?: string;
  mask?: string[];
  states: State[];
};
type ScreensFile = { freezeTime?: string; mask?: string[]; screens: Screen[] };

const config: ScreensFile = JSON.parse(
  readFileSync(new URL('../../visual/screens.json', import.meta.url), 'utf8'),
);
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 834, height: 1112 },
  mobile: { width: 412, height: 915 },
};

for (const screen of config.screens) {
  for (const state of screen.states) {
    const role = state.role ?? screen.role;
    test.describe(`${screen.id} ${state.state}`, () => {
      if (role) test.use({ storageState: `tmp/e2e-auth/${role}.json` });

      for (const [viewport, size] of Object.entries(VIEWPORTS)) {
        test(viewport, async ({ page }) => {
          if (config.freezeTime) await page.clock.setFixedTime(new Date(config.freezeTime));
          await page.setViewportSize(size);
          await page.goto(state.path ?? screen.path);
          const ready = state.waitFor ?? screen.waitFor;
          if (ready) await expect(page.locator(ready).first()).toBeVisible();
          for (const a of state.actions ?? []) {
            if (a.click) await page.locator(a.click).first().click();
            else if (a.fill) await page.locator(a.fill[0]).first().fill(a.fill[1]);
            else if (a.select) await page.locator(a.select[0]).first().selectOption(a.select[1]);
            else if (a.hover) await page.locator(a.hover).first().hover();
            else if (a.press) await page.keyboard.press(a.press);
            else if (a.waitFor) await expect(page.locator(a.waitFor).first()).toBeVisible();
          }
          await page.evaluate(() => document.fonts.ready);
          const mask = [...(config.mask ?? []), ...(screen.mask ?? []), ...(state.mask ?? [])].map(
            (s) => page.locator(s),
          );
          await expect(page).toHaveScreenshot(`${screen.id}--${state.state}--${viewport}.png`, {
            fullPage: state.fullPage ?? true,
            mask,
          });
        });
      }
    });
  }
}
