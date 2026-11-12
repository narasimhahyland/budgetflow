// Gap A2 journey: a request whose recipient reaches 80% of the employee annual cap shows the policy
// check on its page (outcome, the decisive rule's explanation, the cap facts and the rules that
// matched), and the recipient then appears in Finance's "employees nearest cap" list. The recipient
// is a fictional employee created for this journey (standing in for an HR feed), so no other test's
// spend counts against them.
import { expect, test } from '@playwright/test';
import { SEED } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { api } from '../budgets/api';
import { env } from '../support/env';
import { authFile } from '../support/roles';
import { desktopOnly, directorTree, usd } from '../spend/api';

async function freshEmployee(): Promise<{ id: string; name: string }> {
  const id = randomUUID();
  const name = `Priya Cap ${id.slice(0, 4)}`;
  const c = new Client({
    host: '127.0.0.1',
    port: Number(env('BF_PG_PORT')),
    database: env('BF_PG_DB'),
    user: 'bf_app',
    password: env('BF_PG_APP_PASSWORD'),
  });
  await c.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('app.tenant_id', $1, true)`, [SEED.tenants.acme]);
    await c.query(
      `insert into people (id, tenant_id, display_name, email, employing_entity_id, location_org_unit_id)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        SEED.tenants.acme,
        name,
        `cap-journey-${id.slice(0, 8)}@example.test`,
        SEED.legalEntities.acmeUs,
        SEED.orgUnits.newYork,
      ],
    );
    await c.query('commit');
  } finally {
    await c.end();
  }
  return { id, name };
}

test.describe('employee annual cap', () => {
  test.use({ storageState: authFile('budget-owner') });

  test('the request page explains the cap warning and Finance sees who is nearest the cap', async ({
    page,
    browser,
  }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    const { team } = await directorTree();
    const person = await freshEmployee();
    const r = await api<{ id: string }>('budget-owner', 'post', '/api/requests', {
      kind: 'spending',
      budgetId: team.id,
      amount: usd(25_000),
      spendType: 'team_lunch',
      title: `Lunch for ${person.name}`,
      purpose: 'Welcome lunch for a new starter',
      benefitRecipientIds: [person.id],
    });

    await page.goto(`/requests/${r.id}`);
    const card = page.getByTestId('policy-check');
    await expect(card.getByRole('heading', { name: 'Policy check' })).toBeVisible();
    await expect(card.getByText('Allowed with a warning')).toBeVisible();
    await expect(
      card
        .getByText('A recipient has used 80% or more of their annual employee benefit cap')
        .first(),
    ).toBeVisible();
    await expect(card.getByText('Checked at submission')).toBeVisible();
    const facts = card.getByRole('definition');
    await expect(card.getByText('Benefit recipients')).toBeVisible();
    await expect(facts.filter({ hasText: person.name }).first()).toBeVisible();
    await expect(card.getByText('Employee annual cap left')).toBeVisible();
    await expect(facts.filter({ hasText: 'USD 50.00' })).toBeVisible();
    await expect(facts.filter({ hasText: '83%' })).toBeVisible();
    await expect(card.getByText(/R-32 v1 Employee benefit nearing the annual cap/)).toBeVisible();
    await expect(
      card.getByText(/Employee benefit nearing the annual cap \(decides\)/),
    ).toBeVisible();

    const finance = await browser.newContext({ storageState: authFile('finance-admin') });
    try {
      const fp = await finance.newPage();
      await fp.goto('/admin/rules/policies/limits');
      const nearest = fp.getByRole('table', { name: 'People closest to the yearly limit' });
      const row = nearest.getByRole('row').filter({ hasText: person.name });
      await expect(row).toContainText('USD 250.00');
      await expect(row).toContainText('USD 50.00');
      await expect(row).toContainText('New York');
    } finally {
      await finance.close();
    }
  });
});
