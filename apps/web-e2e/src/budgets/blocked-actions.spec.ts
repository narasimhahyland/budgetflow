// Phase 17 exploratory findings F5 and F8 (evidence/phase-17/exploratory/README.md), as the people who
// would meet them. A frozen budget's owner is not offered an increase request the API would refuse:
// the button stays in place, disabled, pointing at the banner that says why. A budget id that does not
// exist reads as a sentence, not "this budget not found".
//
// The journey freezes a budget it creates itself, so no seeded figure moves. Desktop only: it mutates.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { authFile } from '../support/roles';
import { desktopOnly } from '../spend/api';
import { allocate, api, createChild, createRoot } from './api';

test.describe('blocked budgets say why (F5)', () => {
  test.use({ storageState: authFile('regional-manager') });

  test('a frozen budget shows Request increase disabled with the reason', async ({ page }) => {
    const project = test.info().project.name;
    test.skip(!!desktopOnly(project), desktopOnly(project));
    const root = await createRoot({ amountMinor: 200_000, owner: 'regional-manager' });
    const child = await createChild(root.id, {
      name: `Journey frozen child ${randomUUID().slice(0, 6)}`,
      owner: 'regional-manager',
    });
    await allocate(root.id, child.id, 50_000);

    await page.goto(`/budgets/${child.id}`);
    const increase = page.getByRole('button', { name: 'Request increase' });
    await expect(increase).toBeEnabled();

    await api('finance-admin', 'post', `/api/budgets/${child.id}/freeze`, {
      reasonCode: 'FRZ-POLICY',
      reason: 'Journey: policy review',
    });
    await page.reload();

    await expect(page.getByTestId('frozen-banner')).toContainText(
      'Frozen: new requests and allocations are blocked',
    );
    await expect(increase).toBeDisabled();
    await expect(increase).toHaveAttribute(
      'title',
      'Increase requests are paused while the budget is frozen',
    );
    await expect(increase).toHaveAccessibleDescription(/new requests and allocations are blocked/);
  });
});

test.describe('error states read as sentences (F8)', () => {
  test.use({ storageState: authFile('finance-controller') });

  test('a budget that does not exist says so plainly', async ({ page }) => {
    await page.goto(`/budgets/${randomUUID()}`);
    await expect(
      page.getByRole('heading', { name: 'We could not find this budget' }),
    ).toBeVisible();
    await expect(page.getByText('this budget not found')).toHaveCount(0);
  });
});
