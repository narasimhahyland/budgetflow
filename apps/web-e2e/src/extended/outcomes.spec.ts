// Screen 015c. The point of this view is what it refuses to say: an aggregate whose group is too
// small to hide a person in is rendered as "fewer than N", with the group size still on screen, and
// never as a blank or a zero. The journey checks every figure the API suppressed against what the
// page actually shows, and insists at least one really is suppressed, so a seed that stopped
// producing a small group fails the test instead of quietly making it vacuous.
import { expect, test, type Page } from '@playwright/test';
import { expectShell } from '../support/auth';
import { authFile } from '../support/roles';
import { getJson, type SuppressibleFigure } from './support';

interface OutcomeLinkage {
  associationNote: string;
  thresholds: { surveyResponses: number; retentionGroup: number };
  averagePulse: SuppressibleFigure;
  enps: SuppressibleFigure;
  reachBps: number | null;
  categories: {
    categoryCode: string;
    categoryName: string;
    pulse: SuppressibleFigure;
    responseCount: number;
  }[];
  retentionBands: { band: string; bandLabel: string; retention: SuppressibleFigure }[];
  retentionAvailable: boolean;
  enoughData: boolean;
}

/** Every figure on the page, paired with the test id the component renders it under. */
function figuresOf(o: OutcomeLinkage): { testId: string; figure: SuppressibleFigure }[] {
  return [
    { testId: 'pulse', figure: o.averagePulse },
    { testId: 'enps', figure: o.enps },
    ...o.categories.map((c) => ({
      testId: `category-pulse-${c.categoryCode}`,
      figure: c.pulse,
    })),
    ...o.retentionBands.map((b) => ({ testId: `retention-value-${b.band}`, figure: b.retention })),
  ];
}

/**
 * A suppressed figure renders under `<testId>-suppressed` and a disclosed one under `<testId>`, so
 * checking both directions proves the page never shows a figure the API withheld and never hides
 * one it disclosed.
 */
async function expectRendered(
  page: Page,
  testId: string,
  figure: SuppressibleFigure,
): Promise<void> {
  if (figure.suppressed) {
    const cell = page.getByTestId(`${testId}-suppressed`);
    await expect(cell, `${testId} is suppressed and must say so`).toBeVisible();
    await expect(cell).toHaveText(figure.suppressionReason!);
    await expect(page.getByTestId(testId)).toHaveCount(0);
    return;
  }
  const cell = page.getByTestId(testId);
  await expect(cell, `${testId} is disclosed and must show its value`).toBeVisible();
  await expect(cell).toContainText(String(figure.groupSize));
  await expect(page.getByTestId(`${testId}-suppressed`)).toHaveCount(0);
}

test.describe('outcome linkage never exposes an individual (015c)', () => {
  test.use({ storageState: authFile('ceo') });

  test('the association note and the thresholds are stated on the page itself', async ({
    page,
  }) => {
    const outcomes = await getJson<OutcomeLinkage>('ceo', '/api/insights/outcomes');

    await page.goto('/dashboards/outcomes');
    await expectShell(page);
    await expect(page.getByRole('heading', { name: 'Outcomes', exact: true })).toBeVisible();

    // `toContainText`, not `toHaveText`: the Satori banner prefixes its own "Info" label.
    await expect(page.getByTestId('association-note')).toContainText(outcomes.associationNote);
    await expect(page.getByTestId('association-note')).toContainText('association, not cause');
    await expect(page.getByTestId('thresholds')).toContainText(
      `at least ${outcomes.thresholds.surveyResponses} responses`,
    );
    await expect(page.getByTestId('thresholds')).toContainText(
      `at least ${outcomes.thresholds.retentionGroup} people`,
    );
  });

  test('a figure the API withheld reads "fewer than N", never a blank or a zero', async ({
    page,
  }) => {
    const outcomes = await getJson<OutcomeLinkage>('ceo', '/api/insights/outcomes');
    expect(outcomes.enoughData, 'the seed has enough outcome data to render the view').toBe(true);

    const figures = figuresOf(outcomes);
    const suppressed = figures.filter((f) => f.figure.suppressed);
    // Loud rather than vacuous: if no group in the seed is small any more, this check has stopped
    // proving anything and should fail rather than pass by having nothing to look at.
    expect(
      suppressed.length,
      'the seed must contain at least one group too small to disclose',
    ).toBeGreaterThan(0);

    await page.goto('/dashboards/outcomes');
    await expect(page.getByTestId('association-note')).toBeVisible();

    for (const { testId, figure } of figures) await expectRendered(page, testId, figure);

    // The wording is the whole point: it states the threshold, not an absence of data.
    for (const { testId, figure } of suppressed)
      await expect(page.getByTestId(`${testId}-suppressed`)).toContainText(
        `Fewer than ${figure.suppressionReason!.includes('people') ? outcomes.thresholds.retentionGroup : outcomes.thresholds.surveyResponses}`,
      );
  });
});

test.describe('retention cohorts stay with the roles that read people company-wide', () => {
  test.use({ storageState: authFile('regional-manager') });

  test('a regional manager gets pulse and eNPS but is told why retention is absent', async ({
    page,
  }) => {
    const outcomes = await getJson<OutcomeLinkage>('regional-manager', '/api/insights/outcomes');
    expect(outcomes.retentionAvailable).toBe(false);
    expect(outcomes.retentionBands).toEqual([]);

    await page.goto('/dashboards/outcomes');
    await expect(page.getByRole('heading', { name: 'Outcomes', exact: true })).toBeVisible();
    await expect(page.getByTestId('retention-not-available')).toContainText(
      'Retention cohorts span the whole company',
    );
    await expect(page.getByTestId('kpi-pulse')).toBeVisible();
    await expect(page.getByTestId('kpi-enps')).toBeVisible();
  });
});

test.describe('outcome figures are not for everyone', () => {
  test.use({ storageState: authFile('employee') });

  test('an employee is refused the outcomes screen', async ({ page }) => {
    await page.goto('/dashboards/outcomes');
    await expectShell(page);
    await expect(
      page.getByRole('heading', { name: 'You do not have access to this page' }),
    ).toBeVisible();
  });
});
