// Phase 16 journeys (092a-092d, 102d): the surfaces that face outside BudgetFlow. These screens are
// the widest external edge in the product, so the journeys are about what the UI promises rather
// than about layout: a token that is shown once and never again, a revoked connection that does not
// look healthy, an assistant that is read-only and offers no action it cannot perform, a widget that
// renders only on the sites someone listed, and another company's admin getting nothing.
//
// Subjects are created by the journey and then referred to by id, never found by a mutable status:
// other suites share this stack and repair or break the seeded rows.
import { randomUUID } from 'node:crypto';
import {
  expect,
  request as pwRequest,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { SEED } from '@bf/seed';
import { apiToken, expectShell, submitSignIn } from '../support/auth';
import { API_URL } from '../support/env';
import { authFile, type RoleId } from '../support/roles';
import { desktopOnly } from '../spend/api';

interface Connection {
  id: string;
  label: string;
  clientLabel: string;
  status: string;
  grants: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
}
interface ConnectionList {
  items: Connection[];
  seesAll: boolean;
  canRevokeAll: boolean;
}
interface AssistantConnector {
  enabled: boolean;
  tools: { tool: string; title: string; enabled: boolean }[];
  neverDoes: string[];
  consentText: string;
  aiFeatureEnabled: boolean;
}
interface AutomationConnector {
  platforms: { platform: string; title: string; allowed: boolean }[];
  triggers: { trigger: string; title: string; deliveryAvailable: boolean }[];
  neverDoes: string[];
}
interface Partner {
  id: string;
  name: string;
  status: string;
  vendorId: string | null;
  vendorStatus: string | null;
}
interface Widget {
  id: string;
  name: string;
  allowedOrigins: string[];
  frameAncestors: string;
  embedSnippet: string;
  status: string;
  blockedOriginsLast30Days: { origin: string; attempts: number }[];
}

test.describe.configure({ mode: 'default' });

const tokens = new Map<RoleId | 'globex-admin', Promise<string>>();
const tokenFor = (role: RoleId | 'globex-admin'): Promise<string> => {
  const hit = tokens.get(role) ?? apiToken(role as RoleId);
  tokens.set(role, hit);
  return hit;
};

async function apiAs(role: RoleId, extra: Record<string, string> = {}): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: {
      authorization: `Bearer ${await tokenFor(role)}`,
      'x-tenant-id': SEED.tenants.acme,
      accept: 'application/json',
      ...extra,
    },
  });
}

async function getJson<T>(
  role: RoleId,
  path: string,
  extra: Record<string, string> = {},
): Promise<T> {
  const ctx = await apiAs(role, extra);
  const res = await ctx.get(path);
  expect(res.status(), `${role} GET ${path}: ${await res.text()}`).toBe(200);
  const body = (await res.json()) as T;
  await ctx.dispose();
  return body;
}

/** The whole page text, for assertions about what must not be on screen. */
const screenText = async (page: Page): Promise<string> => page.locator('body').innerText();

/**
 * Offers are cached from a partner catalogue, so a stack that has never synced has none. The seed
 * deliberately leaves them unsynced; the journeys that need an offer pull one first.
 */
async function syncEnabledPartners(): Promise<void> {
  const list = await getJson<{ items: Partner[] }>(
    'integration-admin',
    '/api/ecosystem/marketplace/partners',
  );
  const ctx = await apiAs('integration-admin');
  for (const partner of list.items.filter((p) => p.status === 'enabled')) {
    const res = await ctx.post(`/api/ecosystem/marketplace/partners/${partner.id}/sync`, {
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(res.status(), `sync ${partner.name}: ${await res.text()}`).toBe(200);
  }
  await ctx.dispose();
}

test.describe('BI connector (092a)', () => {
  test.use({ storageState: authFile('integration-admin') });

  test('the connector states what it can read and what it can never do', async ({ page }) => {
    await page.goto('/admin/integrations/bi');
    await expectShell(page);
    await expect(page.getByRole('heading', { level: 1, name: 'BI connector' })).toBeVisible();

    const connector = await getJson<{
      datasets: { dataset: string; title: string; enabled: boolean }[];
      connectionsActive: number;
      feedBaseUrl: string;
    }>('integration-admin', '/api/ecosystem/bi');

    await expect(page.getByTestId('bi-feed-url')).toContainText(connector.feedBaseUrl);
    await expect(page.getByTestId('bi-connections-active')).toHaveText(
      String(connector.connectionsActive),
    );
    // The boundary is stated on the page, not left for the reader to infer from the field list.
    await expect(page.getByTestId('bi-never')).toContainText(
      'It cannot approve, reject, submit, apply a control or move money',
    );
    await expect(page.getByTestId('bi-never')).toContainText(
      'never shows more than the person who connected it can see',
    );
    for (const d of connector.datasets)
      await expect(page.getByTestId(`bi-dataset-${d.dataset}`)).toBeVisible();

    // An Integration Admin configures the connector but holds no report access, so the page says
    // why there is no Connect button rather than showing one that would be refused.
    await expect(page.getByTestId('bi-no-scope')).toContainText('need report access');
    await expect(page.getByTestId('bi-connect')).toHaveCount(0);
  });
});

test.describe('BI connections (092a, a person connecting their own tool)', () => {
  // The Read-only Analyst is who 092a has connecting a BI tool: `report.read` is what the API asks
  // for, and an Integration Admin does not hold it.
  test.use({ storageState: authFile('analyst') });

  test('a connection token is shown once, and a revoked connection does not look healthy', async ({
    page,
  }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    const label = `Journey workbook ${randomUUID().slice(0, 8)}`;

    await page.goto('/me/bi-connections');
    await expect(page.getByRole('heading', { level: 1, name: 'My BI connections' })).toBeVisible();
    await page.getByTestId('bi-connect').click();
    await page.getByTestId('bi-label').fill(label);
    await page.getByTestId('bi-connect-submit').click();

    // The token is on screen exactly once, and the page says plainly it cannot come back.
    const panel = page.getByTestId('bi-token');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('You will not see it again');
    await expect(panel).toContainText('stores only a hash');
    const token = (await page.getByTestId('bi-connection-token').innerText()).trim();
    expect(token.length, 'a token was issued').toBeGreaterThan(20);

    await page.getByTestId('bi-connection-token-stored').click();
    await page.getByTestId('bi-connection-token-done').click();
    await expect(panel).toBeHidden();

    // It is gone from the page, and the list that replaces it carries no token at all.
    expect(
      await screenText(page),
      'the token is not on screen after it is dismissed',
    ).not.toContain(token);
    await expect(page.getByTestId('bi-connections-secrecy')).toContainText(
      'can never be shown again',
    );

    const list = await getJson<ConnectionList>('analyst', '/api/ecosystem/bi/connections');
    const made = list.items.find((c) => c.label === label);
    expect(made, 'the connection the journey made is listed').toBeTruthy();
    expect(
      JSON.stringify(made),
      'the connection the API returns carries no token material',
    ).not.toContain(token);

    const row = page.getByTestId(`connection-status-${made!.id}`);
    await expect(row).toHaveText('Active');

    // Revoking says what now happens to calls, and the row stops reading as a working connection.
    await page.getByTestId(`revoke-connection-${made!.id}`).click();
    await page.getByTestId('bi-revoke-reason').fill('Finished with the journey');
    await page.getByTestId('bi-revoke-confirm').click();

    await expect(page.getByTestId('bi-notice')).toContainText('Access revoked');
    await expect(page.getByTestId(`connection-status-${made!.id}`)).toHaveText('Revoked');
    await expect(page.getByTestId(`connection-status-${made!.id}`).locator('..')).toContainText(
      'The token can never be used again',
    );
    // A revoked connection offers no second revoke, because the API refuses one.
    await expect(page.getByTestId(`revoke-connection-${made!.id}`)).toHaveCount(0);
    expect(await screenText(page), 'the revoked token is still nowhere on screen').not.toContain(
      token,
    );
  });
});

test.describe('connector for AI assistants (092c)', () => {
  test.use({ storageState: authFile('integration-admin') });

  test('the connector is presented as read-only and offers no action it cannot perform', async ({
    page,
  }) => {
    const connector = await getJson<AssistantConnector>(
      'integration-admin',
      '/api/ecosystem/assistants',
    );

    await page.goto('/admin/integrations/assistants');
    await expectShell(page);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Connector for AI assistants' }),
    ).toBeVisible();

    const never = page.getByTestId('assistant-never');
    await expect(never).toContainText('can only read');
    for (const line of connector.neverDoes) await expect(never).toContainText(line);
    await expect(never).toContainText('There is no tool that approves, submits, applies a control');
    await expect(never).toContainText('Not found in budgets you can see');

    // Every tool the API offers is on the page, and each one says read-only on its own row.
    expect(connector.tools.length, 'the connector offers tools').toBeGreaterThan(0);
    for (const t of connector.tools) {
      const row = page.getByTestId(`assistant-tool-row-${t.tool}`);
      await expect(row).toContainText(t.title);
      await expect(row).toContainText('Read-only');
    }

    // Nothing on this screen offers an assistant a way to act on money.
    const text = (await screenText(page)).toLowerCase();
    for (const forbidden of ['approve a request', 'submit a request', 'freeze a budget'])
      expect(text, `the connector must not offer "${forbidden}"`).not.toContain(forbidden);
  });

  test('the consent a person gives says the assistant cannot change anything', async ({ page }) => {
    const connector = await getJson<AssistantConnector>(
      'integration-admin',
      '/api/ecosystem/assistants',
    );
    await page.goto('/admin/integrations/assistants');
    await page.getByTestId('assistant-connect').click();
    const consent = page.getByTestId('assistant-consent-text');
    await expect(consent).toContainText(connector.consentText);
    await expect(consent).toContainText('cannot approve or change anything');
    // Allow stays disabled until the person has actually acknowledged it.
    await expect(page.getByTestId('assistant-connect-submit')).toBeDisabled();
  });
});

test.describe('no-code automations (092b)', () => {
  test.use({ storageState: authFile('integration-admin') });

  test('platforms carry their allowed state and triggers say they are not delivered yet', async ({
    page,
  }) => {
    const connector = await getJson<AutomationConnector>(
      'integration-admin',
      '/api/ecosystem/automations',
    );
    await page.goto('/admin/integrations/automations');
    await expectShell(page);
    await expect(
      page.getByRole('heading', { level: 1, name: 'No-code automations' }),
    ).toBeVisible();

    await expect(page.getByTestId('automation-never')).toContainText(connector.neverDoes[0]);
    await expect(page.getByTestId('automation-never')).toContainText('stays a Draft');

    for (const p of connector.platforms) {
      const toggle = page.getByTestId(`automation-platform-${p.platform}`);
      await expect(toggle).toContainText(p.allowed ? 'Allowed' : 'Not allowed');
    }

    // The trigger catalogue is listed, with the plain statement that nothing is delivered from it.
    expect(
      connector.triggers.every((t) => !t.deliveryAvailable),
      'no trigger delivers yet in this build',
    ).toBe(true);
    await expect(page.getByTestId('automation-triggers-pending')).toContainText(
      'Triggers are not delivered yet',
    );
    for (const t of connector.triggers)
      await expect(page.getByTestId(`automation-trigger-${t.trigger}`)).toContainText(t.title);
  });
});

test.describe('marketplace partners (092d, administration)', () => {
  test.use({ storageState: authFile('integration-admin') });

  test('a partner without an approved vendor cannot be enabled, and says why', async ({ page }) => {
    const list = await getJson<{ items: Partner[] }>(
      'integration-admin',
      '/api/ecosystem/marketplace/partners',
    );
    // By name: the seeded partner that deliberately has no vendor link. Status is mutable, the name is not.
    const unlinked = list.items.find((p) => p.name === 'Kindly Gifts');
    expect(unlinked, 'the seeded partner without a vendor is present').toBeTruthy();

    await page.goto('/admin/integrations/partners');
    await expectShell(page);
    await expect(page.getByTestId('partners-sample')).toContainText(
      'These partners are sample data',
    );

    if (!unlinked!.vendorId) {
      await expect(page.getByTestId(`partner-blocked-${unlinked!.id}`)).toContainText(
        'cannot be enabled',
      );
      await expect(page.getByTestId(`partner-enable-${unlinked!.id}`)).toBeDisabled();
    }
    await expect(page.getByTestId(`partner-status-${unlinked!.id}`)).toHaveText(
      unlinked!.status === 'enabled' ? 'Enabled' : 'Paused',
    );
  });

  test('syncing a partner says what it moved and that nothing reached the ledger', async ({
    page,
  }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    const list = await getJson<{ items: Partner[] }>(
      'integration-admin',
      '/api/ecosystem/marketplace/partners',
    );
    // By name: the seeded partner that is linked to a Preferred vendor and can take bookings.
    const partner = list.items.find((p) => p.name === 'CityQuest Experiences');
    expect(partner, 'the seeded experiences partner is present').toBeTruthy();

    await page.goto('/admin/integrations/partners');
    await page.getByTestId(`partner-sync-${partner!.id}`).click();
    const result = page.getByTestId('partners-synced');
    await expect(result).toContainText(partner!.name);
    await expect(result).toContainText('Nothing posted to the ledger');
  });
});

test.describe('marketplace browse and booking (092d)', () => {
  test.use({ storageState: authFile('event-organizer') });

  test('an organizer asks a partner for a price and gets a quote, not a commitment', async ({
    page,
  }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    await syncEnabledPartners();
    const offers = await getJson<{ items: { id: string; title: string; capacityMin: number }[] }>(
      'event-organizer',
      '/api/marketplace/offers',
    );
    expect(offers.items.length, 'enabled partners offer something').toBeGreaterThan(0);
    const offer = offers.items[0];

    await page.goto('/marketplace');
    await expectShell(page);
    await expect(page.getByTestId('marketplace-sample')).toContainText('Sample partners');
    await expect(page.getByTestId('marketplace-sample')).toContainText(
      'becomes a commitment only when you select it on the event',
    );

    await page.getByTestId(`offer-${offer.id}`).click();
    await expect(page.getByRole('heading', { level: 1, name: offer.title })).toBeVisible();
    await expect(page.getByTestId('offer-cancellation')).not.toBeEmpty();

    await page.getByTestId('offer-request').click();
    await page.getByTestId('offer-people').fill(String(offer.capacityMin));
    await page.getByTestId('offer-request-submit').click();

    const booked = page.getByTestId('offer-booked');
    await expect(booked).toBeVisible();
    await expect(booked).toContainText('A booking request is a quote');
    await expect(booked).toContainText('becomes a commitment only when you select it on the event');

    // It shows on the marketplace as waiting for the partner, with no money against it.
    await page.goto('/marketplace');
    const bookings = await getJson<{ items: { id: string; offerId: string; status: string }[] }>(
      'event-organizer',
      '/api/marketplace/bookings',
    );
    const made = bookings.items.find((b) => b.offerId === offer.id);
    expect(made, 'the booking the journey made is listed').toBeTruthy();
    await expect(page.getByTestId(`booking-status-${made!.id}`)).toHaveText('Waiting for partner');
  });
});

test.describe('embeddable widgets (102d)', () => {
  test.use({ storageState: authFile('integration-admin') });

  test('the allowed-site list is presented as the boundary it is', async ({ page }) => {
    const list = await getJson<{ items: Widget[] }>('integration-admin', '/api/ecosystem/widgets');
    expect(list.items.length, 'the seed configures widgets').toBeGreaterThan(0);

    await page.goto('/admin/widgets');
    await expectShell(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Embeddable widgets' })).toBeVisible();

    const note = page.getByTestId('widget-identity-note');
    await expect(note).toContainText('A widget never carries an identity');
    await expect(note).toContainText('no key or token is placed in it');

    for (const w of list.items) {
      const origins = page.getByTestId(`widget-origins-${w.id}`);
      await expect(origins).toBeVisible();
      for (const o of w.allowedOrigins) await expect(origins).toContainText(o);
      // The policy that actually stops other pages framing it is shown, not summarised away.
      await expect(page.getByTestId(`widget-snippet-${w.id}`)).toContainText(w.id);
      await expect(page.locator('body')).toContainText(w.frameAncestors);
    }
  });

  test('a site that is not on the list is refused, listed with its address, and never free', async ({
    page,
  }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    const name = `Journey widget ${randomUUID().slice(0, 8)}`;
    const allowed = 'https://journey-intranet.example.test';
    const refused = 'https://journey-copied.example.test';

    const ctx = await apiAs('integration-admin');
    const created = await ctx.post('/api/ecosystem/widgets', {
      data: { name, kind: 'team_budget', allowedOrigins: [allowed], showAmounts: true },
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
    });
    expect(created.status(), await created.text()).toBe(201);
    const widget = (await created.json()) as Widget;
    await ctx.dispose();

    try {
      // An allowed site gets the viewer's own content; a copied snippet elsewhere gets nothing.
      const ok = await apiAs('integration-admin', { origin: allowed });
      const okRes = await ok.get(`/api/ecosystem/widgets/${widget.id}/content`);
      expect(okRes.status(), await okRes.text()).toBe(200);
      await ok.dispose();

      const bad = await apiAs('integration-admin', { origin: refused });
      const badRes = await bad.get(`/api/ecosystem/widgets/${widget.id}/content`);
      expect(badRes.status()).toBe(403);
      expect(await badRes.text()).toContain('not allowed to show the widget');
      await bad.dispose();

      await page.goto('/admin/widgets');
      // The refusal is reported with the address, so a missing entry is found rather than guessed.
      await expect(page.getByTestId('widget-refused-banner')).toContainText('not on its list');
      const refusal = page.getByTestId(`widget-refused-${widget.id}`);
      await expect(refusal).toContainText(refused);
      await expect(refusal).toContainText('is not on the list');

      // Emptying the list is refused by the form, and says what an empty list would mean.
      await page.getByTestId(`widget-edit-${widget.id}`).click();
      await page.getByTestId('widget-edit-origins').fill('');
      await expect(page.getByTestId('widget-edit-empty')).toContainText('embeddable nowhere');
      await expect(page.getByTestId('widget-edit-submit')).toBeDisabled();

      // A wildcard is refused too: it would let any page on any host frame the widget.
      await page.getByTestId('widget-edit-origins').fill('https://*.example.test');
      await expect(page.getByTestId('widget-edit-submit')).toBeDisabled();
    } finally {
      const cleanup = await apiAs('integration-admin');
      await cleanup.delete(`/api/ecosystem/widgets/${widget.id}`, {
        headers: { 'idempotency-key': randomUUID() },
      });
      await cleanup.dispose();
    }
  });

  test('the embed frame refuses a host that is not on the list, and says why', async ({ page }) => {
    const list = await getJson<{ items: Widget[] }>('integration-admin', '/api/ecosystem/widgets');
    const widget = list.items.find((w) => w.name === 'Intranet: your team budget');
    expect(widget, 'the seeded team budget widget is present').toBeTruthy();

    // Opening the embed route from a page that is not an allowed site gets the refusal, with the
    // reason, and nothing of the viewer's data.
    await page.goto(`/embed/${widget!.id}`);
    const refusal = page.getByTestId('embed-not-allowed');
    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText('This site is not allowed to show the widget');
    await expect(refusal).toContainText('no data has been read');
    expect(await screenText(page), 'no figure leaks into a refused frame').not.toMatch(
      /USD\s[\d,]+/,
    );
  });
});

test.describe('another company (102d, tenant isolation)', () => {
  // Signs in fresh: globex-admin is not one of the roles with a saved session.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("an admin of another company gets nothing from this company's widget", async ({
    page,
  }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    const list = await getJson<{ items: Widget[] }>('integration-admin', '/api/ecosystem/widgets');
    const widget = list.items.find((w) => w.name === 'Intranet: your team budget');
    expect(widget, 'the seeded team budget widget is present').toBeTruthy();

    await page.goto('/');
    await submitSignIn(page, 'globex-admin');
    // Their own company, not this one: `expectShell` asserts Hyland, which is the point here.
    await expect(page.getByRole('navigation', { name: 'Platform Navigation' })).toBeAttached();
    await expect(page.getByTestId('header-company')).toHaveText('Globex Corporation');

    await page.goto(`/embed/${widget!.id}`);
    // Not "you may not see this", which would confirm it exists: it does not exist for them.
    await expect(page.getByTestId('embed-missing')).toContainText('no longer exists');
    const text = await screenText(page);
    expect(text, "another company's widget name never appears").not.toContain(widget!.name);
    expect(text, 'no figure from the other company appears').not.toMatch(/USD\s[\d,]+/);
  });
});
