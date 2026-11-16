// Gap package B2, second part: pending approvals (018), approval performance (018a), product
// analytics (018b) and the evidence pack (088a) as the roles that use them, cross-checked against the
// API so the page can never disagree with the server.
import { expect, request as pwRequest, test } from '@playwright/test';
import { SEED } from '@bf/seed';
import { apiToken, expectShell } from '../support/auth';
import { API_URL } from '../support/env';
import { authFile, type RoleId } from '../support/roles';

const tokens = new Map<RoleId, Promise<string>>();
const tokenFor = (role: RoleId): Promise<string> => {
  const hit = tokens.get(role) ?? apiToken(role);
  tokens.set(role, hit);
  return hit;
};

async function getJson<T>(role: RoleId, path: string): Promise<T> {
  const ctx = await pwRequest.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: {
      authorization: `Bearer ${await tokenFor(role)}`,
      'x-tenant-id': SEED.tenants.acme,
      accept: 'application/json',
    },
  });
  const res = await ctx.get(path);
  expect(res.status(), `${role} GET ${path}: ${await res.text()}`).toBe(200);
  const body = (await res.json()) as T;
  await ctx.dispose();
  return body;
}

interface Pending {
  kpis: { pending: number; pastSla: number };
  items: { taskId: string; reference: string; approverName: string; canNudge: boolean }[];
}

test.describe('pending approvals (018)', () => {
  test.use({ storageState: authFile('finance-controller') });

  test('the finance controller sees what waits and reminds an approver', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
    const api = await getJson<Pending>('finance-controller', '/api/dashboards/pending-approvals');
    await page.goto('/dashboards/pending-approvals');
    await expectShell(page);
    await expect(page.getByTestId('kpi-pending')).toHaveText(String(api.kpis.pending));
    // A seeded pending request, chosen by its reference, never by position.
    const subject = api.items.find((i) => i.reference === 'REQ-00002');
    expect(subject, 'the seed has REQ-00002 waiting').toBeTruthy();
    expect(subject!.canNudge).toBe(true);
    const row = page.getByTestId(`pending-${subject!.reference}`);
    await expect(row).toContainText(subject!.approverName);
    await expect(row).toContainText('Pre-encumbered');
    await row
      .getByRole('button', { name: `Remind ${subject!.approverName} about ${subject!.reference}` })
      .click();
    await expect(
      page.getByText(`Reminder sent to ${subject!.approverName} by in-app and email.`),
    ).toBeVisible();
    await expect(
      row.getByRole('button', {
        name: `Remind ${subject!.approverName} about ${subject!.reference}`,
      }),
    ).toBeDisabled();
    // Nothing on this page can decide.
    await expect(page.getByRole('button', { name: /^Approve|^Reject/ })).toHaveCount(0);
  });

  test('an employee has no pending approvals dashboard', async ({ browser }) => {
    const page = await (await browser.newContext({ storageState: authFile('employee') })).newPage();
    await page.goto('/dashboards/pending-approvals');
    await expect(
      page.getByRole('heading', { name: 'You do not have access to this page' }),
    ).toBeVisible();
  });
});

test.describe('approval performance (018a)', () => {
  test('finance sees the figures the API reports; an analyst sees no names', async ({
    browser,
  }) => {
    const fc = await getJson<{ kpis: { decisions: number }; view: string }>(
      'finance-controller',
      '/api/dashboards/approval-performance',
    );
    expect(fc.view).toBe('named');
    const page = await (
      await browser.newContext({ storageState: authFile('finance-controller') })
    ).newPage();
    await page.goto('/dashboards/approval-performance');
    await expectShell(page);
    await expect(page.getByTestId('perf-kpis')).toBeVisible();
    await expect(page.getByTestId('bottlenecks')).toBeVisible();
    await expect(page.getByTestId('small-sample')).toHaveCount(fc.kpis.decisions < 30 ? 1 : 0);

    const analyst = await (
      await browser.newContext({ storageState: authFile('analyst') })
    ).newPage();
    await analyst.goto('/dashboards/approval-performance');
    await expect(analyst.getByTestId('perf-kpis')).toBeVisible();
    await expect(analyst.getByTestId('bottlenecks')).toHaveCount(0);

    const approver = await (
      await browser.newContext({ storageState: authFile('department-head') })
    ).newPage();
    await approver.goto('/dashboards/approval-performance');
    await expect(approver.getByTestId('own-view')).toContainText('Your median');
  });
});

test.describe('product analytics (018b)', () => {
  test.use({ storageState: authFile('org-admin') });

  test('the organization admin sees each KPI with its target written out', async ({ page }) => {
    const api = await getJson<{
      insufficient: boolean;
      kpis: { key: string; label: string; target: { text: string } | null }[];
    }>('org-admin', '/api/analytics/kpis');
    await page.goto('/admin/product-analytics');
    await expectShell(page);
    for (const k of api.kpis) {
      const card = page.getByTestId(`kpi-${k.key}`);
      await expect(card).toContainText(k.label);
      await expect(card).toContainText(k.target?.text ?? k.label);
    }
    await expect(page.getByTestId('insufficient')).toHaveCount(api.insufficient ? 1 : 0);
  });

  test('a budget owner is refused', async ({ browser }) => {
    const page = await (
      await browser.newContext({ storageState: authFile('regional-manager') })
    ).newPage();
    await page.goto('/admin/product-analytics');
    await expect(
      page.getByRole('heading', { name: 'You cannot see product analytics' }),
    ).toBeVisible();
  });
});

test.describe('evidence pack (088a)', () => {
  test.use({ storageState: authFile('auditor') });

  test('an auditor generates a pack for an event and downloads it', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
    await page.goto(
      '/audit/evidence-packs?subjectType=event&subjectId=77000000-0000-4000-8000-000000000001',
    );
    await expectShell(page);
    const form = page.getByTestId('generate-pack');
    await expect(form.getByRole('combobox', { name: 'Event' })).toContainText(
      'Bengaluru Annual Day 2026',
    );
    await expect(form.getByRole('checkbox', { name: 'Comments' })).not.toBeChecked();
    await form.getByRole('button', { name: 'Generate' }).click();
    await expect(page.getByTestId('pack-progress')).toContainText('Evidence pack ready', {
      timeout: 45_000,
    });
    await expect(page.getByTestId('pack-progress')).toContainText('Audit chain verified');

    const list = await getJson<{ items: { id: string; subjectLabel: string; status: string }[] }>(
      'auditor',
      '/api/evidence-packs',
    );
    const pack = list.items.find(
      (p) => p.subjectLabel.includes('BLR-ANNUAL-26') && p.status === 'ready',
    );
    expect(pack).toBeTruthy();
    const row = page.getByTestId(`pack-${pack!.id}`);
    await expect(row).toContainText('Verified');
    const download = page.waitForRequest((r) =>
      r.url().includes(`/evidence-packs/${pack!.id}.zip`),
    );
    await row.getByRole('button', { name: 'Download' }).click();
    await download;
  });

  test('the CEO can download but not generate; an owner has no access', async ({ browser }) => {
    const ceo = await (await browser.newContext({ storageState: authFile('ceo') })).newPage();
    await ceo.goto('/audit/evidence-packs');
    await expect(ceo.getByRole('heading', { level: 1, name: 'Evidence packs' })).toBeVisible();
    await expect(ceo.getByTestId('generate-pack')).toHaveCount(0);
    const owner = await (
      await browser.newContext({ storageState: authFile('regional-manager') })
    ).newPage();
    await owner.goto('/audit/evidence-packs');
    await expect(
      owner.getByRole('heading', { name: 'You do not have access to this page' }),
    ).toBeVisible();
  });
});
