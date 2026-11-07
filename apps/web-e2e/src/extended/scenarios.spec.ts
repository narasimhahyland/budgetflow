// Screen 031a. A what-if scenario is a private projection: the editor shows what a reduction would
// do, computed by the same domain checks as the real command, while the budget it models keeps the
// balances it had. Promotion is the only thing that changes anything, and it is refused — visibly,
// before the dialog opens — once the ledger has moved past the baseline the author reviewed.
import { expect, test } from '@playwright/test';
import { P15_IDS, SEED } from '@bf/seed';
import { expectShell } from '../support/auth';
import { authFile } from '../support/roles';
import { getJson, money, postJson, type Money } from './support';

interface ScenarioChangeImpact {
  changeId: string;
  budgetId: string;
  currentAuthorized: Money;
  floor: Money;
  newAuthorized: Money;
  blocked: boolean;
}
interface ScenarioImpact {
  scenarioId: string;
  baselineAt: string;
  stale: boolean;
  ledgerWritesSinceBaseline: number;
  changes: ScenarioChangeImpact[];
  blocked: boolean;
}
interface Scenario {
  id: string;
  name: string;
  status: string;
  changes: { id: string; kind: string; budgetId: string; promotion: unknown | null }[];
}
interface BudgetDetail {
  id: string;
  status: string;
  balances: { authorized: Money };
}

const SEEDED = P15_IDS.scenarioEuropeToIndia;

test.describe('a what-if scenario is a projection, not a decision (031a)', () => {
  test.use({ storageState: authFile('finance-admin') });

  test('the list names the seeded scenario and says nothing here has changed a budget', async ({
    page,
  }) => {
    await page.goto('/budgets/scenarios');
    await expectShell(page);
    await expect(page.getByRole('heading', { name: 'What-if scenarios' })).toBeVisible();

    await expect(page.getByTestId('scenarios-note')).toContainText(
      'A scenario is a private projection, not a decision',
    );
    await expect(page.getByTestId('scenarios-note')).toContainText(
      'Modelling a change moves no money',
    );

    // Picked by its seeded id, never by position or status, so the test cannot drift onto another
    // scenario that a different suite happened to create.
    const card = page.getByTestId(`scenario-${SEEDED}`);
    await expect(card).toContainText('Europe -20% to fund India festivals');
    await expect(card).toContainText('Draft');
  });

  test('the editor projects a reduction while the budget keeps the balances it has', async ({
    page,
  }) => {
    await page.goto(`/budgets/scenarios/${SEEDED}`);
    await expect(
      page.getByRole('heading', { name: 'Europe -20% to fund India festivals' }),
    ).toBeVisible();
    await expect(page.getByTestId('scenario-projection-note')).toContainText(
      'no journal, balance or budget status changes until you promote',
    );

    // The projection the API computed, and the ledger as it stands, read back to back.
    const impact = await getJson<ScenarioImpact>(
      'finance-admin',
      `/api/scenarios/${SEEDED}/impact`,
    );
    const europe = impact.changes.find((c) => c.budgetId === SEED.budgets.europe);
    expect(europe, 'the seeded scenario models a reduction on the Europe budget').toBeTruthy();
    const budget = await getJson<BudgetDetail>(
      'finance-admin',
      `/api/budgets/${SEED.budgets.europe}`,
    );

    // The reduction is real arithmetic, not a no-op the screen could show safely by accident.
    expect(europe!.newAuthorized.amountMinor).toBeLessThan(europe!.currentAuthorized.amountMinor);
    // And the budget itself still holds the "before" number: modelling posted nothing.
    expect(budget.balances.authorized.amountMinor).toBe(europe!.currentAuthorized.amountMinor);
    expect(budget.status).not.toBe('frozen');

    const row = page.getByTestId(`change-${europe!.changeId}`);
    await expect(row).toContainText(money(europe!.currentAuthorized.amountMinor));
    await expect(row).toContainText(money(europe!.floor.amountMinor));
    await expect(row).toContainText(money(europe!.newAuthorized.amountMinor));

    // Nothing on the scenario claims to have been applied.
    const scenario = await getJson<Scenario>('finance-admin', `/api/scenarios/${SEEDED}`);
    expect(scenario.status).toBe('draft');
    expect(scenario.changes.every((c) => c.promotion === null)).toBe(true);
  });

  test('a scenario whose baseline has moved refuses promotion and says so before the dialog', async ({
    page,
  }) => {
    const scenario = await postJson<Scenario>('finance-admin', '/api/scenarios', {
      name: `Baseline journey ${Date.now()}`,
      note: 'Created by the Phase 15 journey to prove a moved baseline blocks promotion.',
    });
    await postJson<Scenario>('finance-admin', `/api/scenarios/${scenario.id}/changes`, {
      kind: 'reduce',
      budgetId: SEED.budgets.europe,
      percentBps: 100,
      destination: 'parent',
    });
    const before = await getJson<ScenarioImpact>(
      'finance-admin',
      `/api/scenarios/${scenario.id}/impact`,
    );

    // Somebody else spends while the author is reading: a submitted request pre-encumbers its
    // budget, which is a journal, which is exactly what the baseline exists to notice.
    await postJson('event-organizer', '/api/requests', {
      kind: 'spending',
      budgetId: SEED.budgets.bengaluru,
      amount: { amountMinor: 1_500, currency: 'USD' },
      spendType: 'team_lunch',
      title: 'Journey spend while a scenario is open',
      purpose: 'Posts a journal so the open scenario is measurably behind the ledger.',
      category: 'team_lunch',
      submit: true,
    });

    const after = await getJson<ScenarioImpact>(
      'finance-admin',
      `/api/scenarios/${scenario.id}/impact`,
    );
    expect(after.ledgerWritesSinceBaseline).toBeGreaterThan(before.ledgerWritesSinceBaseline);
    expect(after.stale).toBe(true);

    await page.goto(`/budgets/scenarios/${scenario.id}`);
    await expect(page.getByTestId('scenario-stale')).toContainText(
      'The ledger has changed since this scenario took its baseline',
    );
    await expect(page.getByTestId('scenario-stale')).toContainText(
      'promotion is refused until it is rebuilt',
    );
    await expect(page.getByTestId('promote-scenario')).toBeDisabled();

    // The refusal is the point: nothing was promoted and the budget is untouched.
    const reread = await getJson<Scenario>('finance-admin', `/api/scenarios/${scenario.id}`);
    expect(reread.status).toBe('draft');
  });
});

test.describe('scenarios are private to the people who model them', () => {
  test.use({ storageState: authFile('employee') });

  test('an employee is refused the scenarios screen', async ({ page }) => {
    await page.goto('/budgets/scenarios');
    await expectShell(page);
    await expect(
      page.getByRole('heading', { name: 'You do not have access to this page' }),
    ).toBeVisible();
  });
});
