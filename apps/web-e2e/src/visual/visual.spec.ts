// Visual regression baselines for every screen state in apps/web-e2e/visual/screens.json (the same file the visual QA capture script reads). Runs in the visual-light
// project (light theme only; dark theme deferred), inside the pinned Playwright image only (npm run e2e:visual / e2e:update-snapshots).
// Data comes from the deterministic e2e seed (scripts/stack.sh reset); the clock is frozen; animations are off.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { MEASURING_HEADROOM } from '../support/visual-allowance';

// A headroom run (`npm run visual:headroom`) compares the same states with no allowance at all, so
// Playwright reports the exact pixel difference of every state that has drifted at all, including
// the ones still inside the gate's allowance. The short timeout keeps it to one comparison per
// state: a drifting state would otherwise be re-shot until the expect timeout ran out.
const COMPARE = MEASURING_HEADROOM
  ? { maxDiffPixels: 0, maxDiffPixelRatio: 0, timeout: 2_000 }
  : {};

type Action = {
  click?: string;
  fill?: [string, string];
  select?: [string, string];
  hover?: string;
  press?: string;
  waitFor?: string;
  // Clicking a control below the fold scrolls the shell's content box, and a full-page shot keeps
  // that offset. States that interact before capturing use this to return to a fixed position.
  scrollTop?: boolean;
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
  readFileSync(resolve(__dirname, '../../visual/screens.json'), 'utf8'),
);
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 834, height: 1112 },
  mobile: { width: 412, height: 915 },
};

/**
 * Grows the viewport until the page-sized inner scroller (the shell's content box, an open dialog's
 * content) shows everything. The document itself never scrolls, so `fullPage` alone would stop at
 * the first screen and nothing below the fold would ever be compared.
 */
async function growToContent(page: Page): Promise<void> {
  for (let i = 0; i < 4; i++) {
    // Measure a settled page: requests done and no loading skeleton left, or the height would
    // depend on how far the page had loaded.
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
    await page
      .waitForFunction(() => !document.querySelector('[aria-busy="true"]'), undefined, {
        timeout: 5000,
      })
      .catch(() => undefined);
    const extra = await page.evaluate(() => {
      let max = 0;
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        if (!/(auto|scroll)/.test(cs.overflowY) || el.clientHeight < window.innerHeight * 0.5)
          continue;
        // Only the on-screen page scroller: an off-canvas drawer would add a blank tail.
        const r = el.getBoundingClientRect();
        if (r.width < window.innerWidth * 0.5 || r.right <= 0 || r.left >= window.innerWidth)
          continue;
        max = Math.max(max, el.scrollHeight - el.clientHeight);
      }
      return max;
    });
    const size = page.viewportSize();
    if (extra <= 1 || !size) return;
    const height = Math.min(size.height + extra, 12000);
    if (height === size.height) return;
    await page.setViewportSize({ width: size.width, height });
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
  }
}

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
            else if (a.scrollTop)
              await page.evaluate(() => {
                for (const el of document.querySelectorAll('*')) el.scrollTop = 0;
                window.scrollTo(0, 0);
              });
          }
          await page.evaluate(() => document.fonts.ready);
          if (state.fullPage ?? true) await growToContent(page);
          const mask = [...(config.mask ?? []), ...(screen.mask ?? []), ...(state.mask ?? [])].map(
            (s) => page.locator(s),
          );
          await expect(page).toHaveScreenshot(`${screen.id}--${state.state}--${viewport}.png`, {
            fullPage: state.fullPage ?? true,
            mask,
            ...COMPARE,
          });
        });
      }
    });
  }
}
