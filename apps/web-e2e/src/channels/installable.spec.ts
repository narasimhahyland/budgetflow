// Installable app (B8, screen 059a), on the emulated phone:
// - the app is installable: a web app manifest with icons, and a service worker that controls it;
// - offline, the app shell still loads and says plainly that it is offline; it never shows money from
//   an earlier visit (the service worker caches no API response), and a page that was already open
//   says its figures stopped updating and disables decisions;
// - a Web Push message becomes a notification that opens the approval (the worker's push handler).
// The other journeys block service workers (playwright.config.ts); this file turns them on.
import { expect, test, type Page } from '@playwright/test';
import { authFile } from '../support/roles';
import { directorTree, spendingRequest, taskOf } from '../spend/api';

test.use({ storageState: authFile('department-head'), serviceWorkers: 'allow' });

/** Waits until the service worker is active and controls this page (a reload hands control over). */
async function controlledBySw(page: Page): Promise<string> {
  const script = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return reg.active?.scriptURL ?? '';
  });
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
    await page.reload();
  }
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  return script;
}

test.describe('installable app and offline (059a)', () => {
  // Phone journeys run once, on the emulated phone.
  test.skip(({ isMobile }) => !isMobile, 'phone journey runs once, on the mobile project');

  test('the app is installable: a manifest with icons and a service worker in control', async ({
    page,
  }) => {
    // The page itself, whatever is waiting: this test owns no approvals.
    await page.goto('/m/approvals');
    await expect(page.getByRole('heading', { name: 'Mobile approvals', level: 1 })).toBeVisible();

    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBe('manifest.webmanifest');
    const res = await page.request.get('/manifest.webmanifest');
    expect(res.status()).toBe(200);
    const manifest = (await res.json()) as {
      name: string;
      start_url: string;
      display: string;
      icons: { src: string; sizes: string; purpose: string }[];
    };
    expect(manifest).toMatchObject({
      name: 'BudgetFlow',
      start_url: '/m/approvals',
      display: 'standalone',
    });
    // Install needs at least a 192 px and a 512 px icon; each one must load as a PNG.
    expect(manifest.icons.map((i) => i.sizes)).toEqual(
      expect.arrayContaining(['192x192', '512x512']),
    );
    for (const icon of manifest.icons) {
      const img = await page.request.get(icon.src);
      expect(img.status(), icon.src).toBe(200);
      expect(img.headers()['content-type']).toContain('image/png');
    }

    expect(await controlledBySw(page)).toMatch(/\/sw\.js$/);
  });

  test('offline, the shell says so and never shows figures from an earlier visit', async ({
    page,
    context,
  }) => {
    // A request this test owns, waiting for the department head.
    const { team } = await directorTree();
    const r = await spendingRequest(team.id, 140_000);
    const taskId = await taskOf(r.id, 'department-head', 'requests');

    await page.goto('/m/approvals');
    await expect(page.getByTestId('mobile-approval-cards')).toBeVisible();
    await controlledBySw(page);
    await page.goto(`/m/approvals/${taskId}`);
    await expect(page.getByTestId('mobile-approval-detail')).toContainText(r.ref);
    await expect(page.getByTestId('mobile-approve-btn')).toBeEnabled();

    // The cache holds the app shell only: no API answer (budgets, approvals, balances) is kept.
    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        for (const req of await (await caches.open(name)).keys())
          urls.push(new URL(req.url).pathname);
      }
      return urls;
    });
    expect(cached).toContain('/index.html');
    expect(cached.some((u) => u.endsWith('.js'))).toBe(true);
    expect(cached.filter((u) => u.startsWith('/api/') || u === '/health')).toEqual([]);

    // Losing the connection on an open page: the figures are labelled as no longer updating and
    // decisions wait for the connection.
    await context.setOffline(true);
    await expect(page.getByTestId('offline-banner')).toContainText(
      "You're offline. Figures on this page were loaded",
    );
    await expect(page.getByTestId('offline-banner')).toContainText('are not updating');
    await expect(page.getByTestId('offline-banner')).toContainText(
      'Changes and decisions need a connection',
    );
    // One notice, not two: the page's own banner is only the review preview (?offline=1).
    await expect(page.getByTestId('mobile-offline-banner')).toHaveCount(0);
    await expect(page.getByTestId('mobile-approve-btn')).toBeDisabled();
    await expect(page.getByTestId('mobile-open-reject')).toBeDisabled();
    await page.screenshot({ path: 'dist/.playwright/b8/offline-open-page.png', fullPage: true });

    // Starting the app with no connection: the shell comes from the service worker and says it is
    // offline. No amount appears, because none is stored on the device.
    await page.goto('/m/approvals');
    const offline = page.getByTestId('offline-state');
    await expect(offline).toBeVisible();
    await expect(offline.getByRole('heading', { name: "You're offline" })).toBeVisible();
    await expect(offline).toContainText('Nothing from an earlier visit is shown');
    await expect(page.locator('body')).not.toContainText(/\b(USD|INR|EUR|GBP)\b/);
    await page.screenshot({ path: 'dist/.playwright/b8/offline-start.png', fullPage: true });

    // Back online, the page signs in again by itself and shows live figures.
    await context.setOffline(false);
    await expect(page.getByTestId('mobile-approval-cards')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('offline-banner')).toHaveCount(0);
  });

  test('a push message becomes a notification that opens the approval', async ({
    page,
    context,
  }) => {
    await page.goto('/m/approvals');
    await expect(page.getByRole('heading', { name: 'Mobile approvals', level: 1 })).toBeVisible();
    await controlledBySw(page);

    // Headless Chromium refuses notification permission, so the worker's showNotification is
    // recorded instead of drawn; everything before it is the real push event in the real worker.
    const found = context.serviceWorkers().find((w) => w.url().endsWith('/sw.js'));
    if (!found) throw new Error('the BudgetFlow service worker is not running');
    const worker = found;
    await worker.evaluate(() => {
      const g = self as unknown as {
        __shown: unknown[];
        registration: { showNotification: (t: string, o: NotificationOptions) => Promise<void> };
      };
      g.__shown = [];
      g.registration.showNotification = (title, options) => {
        g.__shown.push({ title, body: options.body, tag: options.tag, data: options.data });
        return Promise.resolve();
      };
    });

    // Deliver a message the way the push service would, already decrypted by the browser.
    const cdp = await context.newCDPSession(page);
    const registrationId = new Promise<string>((resolve) => {
      cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => {
        const reg = e.registrations.find((r) => r.scopeURL.endsWith('/') && !r.isDeleted);
        if (reg) resolve(reg.registrationId);
      });
    });
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.deliverPushMessage', {
      origin: new URL(page.url()).origin,
      registrationId: await registrationId,
      data: JSON.stringify({
        title: 'REQ-2026-0418 Diwali celebration catering, waits for you',
        body: 'Rahul Verma · Bengaluru Events',
        url: '/m/approvals',
        tag: 'b8-journey',
        deliveryId: 'journey',
      }),
    });

    await expect
      .poll(() => worker.evaluate(() => (self as unknown as { __shown: unknown[] }).__shown))
      .toEqual([
        {
          title: 'REQ-2026-0418 Diwali celebration catering, waits for you',
          body: 'Rahul Verma · Bengaluru Events',
          tag: 'b8-journey',
          data: { url: '/m/approvals', deliveryId: 'journey' },
        },
      ]);
    await cdp.detach();
  });
});
