// The expanded navigation is Satori's modal overlay at every width (it has no docked mode): it must never
// cover page content the user can work with, and its menu must scroll above the account row so every item
// stays reachable. The finance admin (Priya Raman) has the longest menu.
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { authFile } from '../support/roles';

test.use({ storageState: authFile('finance-admin') });

const DESKTOP_SIZES = [
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];

function navigation(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Platform Navigation' });
}

async function openNav(page: Page, testInfo: TestInfo): Promise<void> {
  const name = testInfo.project.name === 'mobile' ? 'Open navigation' : 'Expand navigation';
  await page.getByRole('button', { name }).click();
  await expect(navigation(page).getByText('Budgets', { exact: true })).toBeVisible();
}

async function expectClosedWithoutCoveringContent(page: Page): Promise<void> {
  await expect(navigation(page).getByText('Budgets', { exact: true })).toHaveCount(0);
  // The leading edge of the page content takes clicks: no part of the navigation lies over it.
  await page.getByRole('main').click({ trial: true, position: { x: 2, y: 120 }, timeout: 5_000 });
}

async function sizesFor(testInfo: TestInfo, page: Page) {
  return testInfo.project.name === 'desktop' ? DESKTOP_SIZES : [page.viewportSize()];
}

test('the expanded navigation closes on a page pick, Escape and an outside click', async ({
  page,
}, testInfo) => {
  for (const size of await sizesFor(testInfo, page)) {
    if (size) await page.setViewportSize(size);
    await page.goto('/budgets');
    await expect(page.getByRole('heading', { level: 1, name: 'Budget hierarchy' })).toBeVisible();
    await expectClosedWithoutCoveringContent(page);

    await openNav(page, testInfo);
    await page.keyboard.press('Escape');
    await expectClosedWithoutCoveringContent(page);

    // With the account menu open, Escape closes the menu first and then the navigation.
    await openNav(page, testInfo);
    await page.getByRole('button', { name: 'Priya Raman', exact: true }).click();
    const signOut = page.getByRole('menuitem', { name: 'Sign out' });
    await expect(signOut).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(signOut).toBeHidden();
    await expect(navigation(page).getByText('Budgets', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expectClosedWithoutCoveringContent(page);

    // Content behind the open navigation is not clickable; a click there only closes the navigation.
    await openNav(page, testInfo);
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('no viewport');
    await page.mouse.click(viewport.width - 12, Math.round(viewport.height / 2));
    await expectClosedWithoutCoveringContent(page);
    await expect(page).toHaveURL(/\/budgets$/);

    // Picking the page that is already open closes it too.
    await openNav(page, testInfo);
    await navigation(page).getByRole('menuitem', { name: 'Budget hierarchy' }).click();
    await expectClosedWithoutCoveringContent(page);

    await openNav(page, testInfo);
    await navigation(page).getByRole('menuitem', { name: 'Budget list' }).click();
    await expect(page).toHaveURL(/\/budgets\/list$/);
    await expectClosedWithoutCoveringContent(page);
  }
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true });

  test('a swipe reaches the last menu item above the account row', async ({ page }, testInfo) => {
    for (const size of await sizesFor(testInfo, page)) {
      if (size) await page.setViewportSize(size);
      await page.goto('/budgets');
      await expect(page.getByRole('heading', { level: 1, name: 'Budget hierarchy' })).toBeVisible();
      await openNav(page, testInfo);

      const nav = navigation(page);
      const last = nav.getByRole('menuitem').last();
      await expect(last).toHaveText('Rules and policies');
      const account = page.getByRole('button', { name: 'Priya Raman', exact: true });

      // A finger swipe over the menu (no mouse hover). Playwright has no touch-scroll API, so the swipe
      // goes through the browser's gesture input.
      const start = await nav.getByRole('menuitem', { name: 'Home' }).boundingBox();
      if (!start) throw new Error('Home is not on screen');
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.synthesizeScrollGesture', {
        x: Math.round(start.x + start.width / 2),
        y: Math.round(start.y + start.height / 2),
        yDistance: -3000,
        speed: 6000,
        gestureSourceType: 'touch',
      });
      await cdp.detach();

      await expect(last).toBeInViewport({ ratio: 1 });
      await expect(account).toBeInViewport({ ratio: 1 });
      await expect
        .poll(async () => {
          const item = await last.boundingBox();
          const profile = await account.boundingBox();
          return item && profile ? Math.round(profile.y - (item.y + item.height)) : -1;
        }, 'gap between the last menu item and the account row (px)')
        .toBeGreaterThanOrEqual(0);

      await last.tap();
      await expect(page).toHaveURL(/\/admin\/rules$/);
      await expectClosedWithoutCoveringContent(page);
    }
  });
});
