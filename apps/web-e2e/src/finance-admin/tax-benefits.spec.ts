// Gap B3 journeys: a budget owner sees on their request that recoverable UK VAT does not use budget
// (080g); Finance reads the rules in force and previews a mixed-attendance split; the Finance
// Controller reads the benefit ledger with its Approaching and Over flags, opens a person's entries
// and sees the thresholds by jurisdiction (080h). Seeded rules, thresholds and benefits are fictional.
import { expect, test } from '@playwright/test';
import { SEED, userById } from '@bf/seed';
import { allocate, api, createRoot } from '../budgets/api';
import { authFile } from '../support/roles';
import { desktopOnly, suffix, usd } from '../spend/api';

const UK = '20000000-0000-4000-8000-000000000006';

async function ukTeam() {
  const tag = suffix();
  const root = await createRoot({ amountMinor: 50_000_000, name: `B3 journey root ${tag}` });
  const make = (
    name: string,
    parentId: string,
    owner: 'department-head' | 'budget-owner',
    as: 'ceo' | 'department-head',
  ) =>
    api<{ id: string }>(as, 'post', '/api/budgets', {
      name,
      parentId,
      legalEntityId: UK,
      fiscalYearId: SEED.fiscalYears.acmeFy2026,
      ownerPersonId: userById(owner).personId,
    });
  const dept = await make(`B3 journey department ${tag}`, root.id, 'department-head', 'ceo');
  await allocate(root.id, dept.id, 10_000_000, 'ceo');
  const team = await make(`B3 journey team ${tag}`, dept.id, 'budget-owner', 'department-head');
  await allocate(dept.id, team.id, 5_000_000, 'department-head');
  return team;
}

test.describe('tax-aware consumption (080g)', () => {
  test.use({ storageState: authFile('budget-owner') });

  test('a request shows that recoverable VAT does not use budget', async ({ page }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    const team = await ukTeam();
    const r = await api<{ id: string }>('budget-owner', 'post', '/api/requests', {
      kind: 'spending',
      budgetId: team.id,
      amount: usd(100_000),
      tax: { amount: usd(20_000) },
      spendType: 'training',
      title: `London course ${suffix()}`,
      purpose: 'Leadership course for the London team',
    });
    await page.goto(`/requests/${r.id}`);
    const card = page.getByTestId('request-tax');
    await expect(card.getByRole('heading', { name: 'Tax' })).toBeVisible();
    await expect(card.getByText('Recorded on the commitment')).toBeVisible();
    await expect(card.getByText('Recoverable VAT-20 (100%)')).toBeVisible();
    const facts = card.getByRole('definition');
    await expect(facts.filter({ hasText: 'USD 200.00' })).toContainText('does not use budget');
    await expect(facts.filter({ hasText: 'at the locked plan rate' })).toContainText(
      'USD 1,000.00',
    );
  });
});

test.describe('tax rules and the calculator (080g)', () => {
  test.use({ storageState: authFile('finance-admin') });

  test('Finance reads the rules by entity and previews a mixed-attendance split', async ({
    page,
  }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    await page.goto('/finance/tax-recoverability');
    await expect(page.getByRole('heading', { name: 'Tax recoverability', level: 1 })).toBeVisible();
    await expect(page.getByTestId('tax-version')).toContainText('v1 Published');
    const uk = page.getByRole('table', { name: 'HYL-UK rules' });
    await expect(uk.getByRole('row').filter({ hasText: 'Mixed attendees' }).first()).toContainText(
      'In proportion to employees',
    );
    const us = page.getByRole('table', { name: 'HYL-US rules' });
    await expect(us).toContainText('Budget uses amount plus sales tax');
    await expect(page.getByText('they are not tax advice')).toBeVisible();

    await page.getByTestId('calc-entity').click();
    await page.getByRole('option', { name: 'HYL-UK' }).click();
    await page.getByRole('button', { name: 'Preview' }).click();
    const result = page.getByTestId('calc-result');
    await expect(result).toContainText('Recoverable tax (80%)');
    await expect(result).toContainText('GBP 96.00');
    await expect(result).toContainText('GBP 24.00');
    await expect(result).toContainText('GBP 624.00');
  });
});

test.describe('employee benefit ledger (080h)', () => {
  test.use({ storageState: authFile('finance-controller') });

  test('the ledger flags who is approaching or over a threshold, per person and tax year', async ({
    page,
  }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    await page.goto('/finance/employee-benefits');
    const table = page.getByRole('table', { name: 'Ledger' });
    const oliver = table
      .getByRole('row')
      .filter({ hasText: 'Oliver Hayes' })
      .filter({ hasText: 'UK annual staff functions' });
    await expect(oliver).toContainText('Over');
    await expect(oliver).toContainText('GBP 168.00');
    await expect(oliver).toContainText('whole amount');
    await expect(oliver).toContainText('6 Apr 2026');
    const amelia = table.getByRole('row').filter({ hasText: 'Amelia Clarke' });
    await expect(amelia).toContainText('Approaching');
    await expect(page.getByTestId('benefit-template')).toContainText('Germany company events');

    await amelia.getByRole('button', { name: 'Amelia Clarke' }).click();
    const drawer = page.getByTestId('benefit-person');
    await expect(drawer.getByRole('heading', { name: 'Amelia Clarke' })).toBeVisible();
    await expect(drawer).toContainText('London summer social');
    await expect(drawer).toContainText('GBP 142.50');

    await page.getByRole('tab', { name: 'Thresholds' }).click();
    const thresholds = page.getByRole('table', { name: 'Thresholds by jurisdiction' });
    await expect(
      thresholds.getByRole('row').filter({ hasText: 'Germany company events' }),
    ).toContainText('Template');
    await expect(
      thresholds.getByRole('row').filter({ hasText: 'UK annual staff functions' }),
    ).toContainText('Whole amount becomes reportable');
  });
});
