// Screen 011b. A drafted summary is a draft: the model writes the sentences, BudgetFlow fills in
// every number from its own records, and nobody can approve the text until they have opened each
// section. The journey proves the page never leaks a raw {{figure:…}} token, that each figure shows
// the value the API attached to it, and that approval is refused while a section is unread.
import { expect, test } from '@playwright/test';
import { expectShell } from '../support/auth';
import { authFile } from '../support/roles';
import { getJson, money, postJson, type Money } from './support';
import { AI_LIVE, AI_LIVE_REASON } from '../ai/live';

test.skip(!AI_LIVE, AI_LIVE_REASON);

interface SummaryFigure {
  token: string;
  label: string;
  value: Money | null;
  numericValue: number | null;
  unit: 'money' | 'percent_bps' | 'count' | 'rating_milli';
}
interface SummarySection {
  key: string;
  title: string;
  text: string;
  figures: SummaryFigure[];
  reviewed: boolean;
}
interface LeadershipSummary {
  id: string;
  periodLabel: string;
  periodState: 'closed' | 'open';
  status: string;
  sections: SummarySection[];
  approvedByName: string | null;
}
interface ClosePeriod {
  id: string;
  label: string;
  status: string;
}

/** The text `bf-summary-text` renders in place of a token, in the unit the ledger produced. */
function renderedFigure(figure: SummaryFigure): string {
  if (figure.unit === 'money' && figure.value)
    return money(figure.value.amountMinor, figure.value.currency);
  const n = figure.numericValue ?? 0;
  if (figure.unit === 'percent_bps') return `${(n / 100).toFixed(1)}%`;
  if (figure.unit === 'rating_milli') return `${(n / 1000).toFixed(1)} of 5`;
  return String(n);
}

/** Drafts a summary of its own for a closed period, so no other suite's summary is touched. */
async function draftOwnSummary(): Promise<LeadershipSummary> {
  const periods = await getJson<{ items: ClosePeriod[] }>('finance-admin', '/api/close/periods');
  const closed = periods.items.filter((p) => p.status === 'closed' || p.status === 'locked');
  expect(closed.length, 'the seed has a closed period to summarise').toBeGreaterThan(0);
  return postJson<LeadershipSummary>('finance-admin', '/api/insights/summaries', {
    periodId: closed[0].id,
  });
}

test.describe('a drafted leadership summary stays a draft until a person reads it (011b)', () => {
  test.use({ storageState: authFile('finance-admin') });

  test('every number in the text is a BudgetFlow figure, never a raw token', async ({ page }) => {
    const summary = await draftOwnSummary();
    expect(summary.status).toBe('ai_draft');
    expect(summary.periodState).toBe('closed');

    await page.goto(`/insights/summaries/${summary.id}`);
    await expectShell(page);
    await expect(page.getByRole('heading', { name: summary.periodLabel })).toBeVisible();

    // A token that reaches the screen renders as nothing and the sentence silently loses its
    // number, so the page is checked for the marker itself.
    await expect(page.locator('body')).not.toContainText('{{figure:');
    await expect(page.locator('body')).not.toContainText('figure not available');

    const figures = summary.sections.flatMap((s) => s.figures);
    expect(figures.length, 'the draft quotes at least one ledger figure').toBeGreaterThan(0);
    for (const section of summary.sections)
      for (const figure of section.figures)
        await expect(
          page.getByTestId(`section-text-${section.key}`),
          `${section.key} must render ${figure.token} as its ledger value`,
        ).toContainText(renderedFigure(figure));

    await expect(page.getByTestId('summary-status')).toContainText('AI draft: not reviewed');
  });

  test('approval waits until the author has opened every section, then freezes the text', async ({
    page,
  }) => {
    const summary = await draftOwnSummary();
    expect(summary.sections.every((s) => !s.reviewed)).toBe(true);

    await page.goto(`/insights/summaries/${summary.id}`);
    await expect(page.getByTestId('summary-unreviewed')).toContainText('Not reviewed yet');
    await expect(page.getByTestId('approve-summary')).toBeDisabled();

    for (const section of summary.sections) {
      await expect(page.getByTestId(`section-unread-${section.key}`)).toBeVisible();
      await page.getByTestId(`mark-read-${section.key}`).click();
      await expect(page.getByTestId(`section-read-${section.key}`)).toBeVisible();
    }

    await expect(page.getByTestId('approve-summary')).toBeEnabled();
    await page.getByTestId('approve-summary').click();
    await page.getByTestId('approve-attest').click();
    await page.getByTestId('approve-confirm').click();

    await expect(page.getByTestId('summary-approved')).toContainText('This text is frozen');
    const approved = await getJson<LeadershipSummary>(
      'finance-admin',
      `/api/insights/summaries/${summary.id}`,
    );
    expect(approved.status).toBe('approved');
    expect(approved.approvedByName).toBeTruthy();

    // An approved summary is immutable, so the editing controls are gone rather than disabled.
    await expect(page.getByTestId(`edit-${summary.sections[0].key}`)).toHaveCount(0);
    await expect(page.getByTestId('approve-summary')).toHaveCount(0);
  });
});

test.describe('a read-only analyst reads summaries but does not draft or approve them', () => {
  test.use({ storageState: authFile('analyst') });

  test('the analyst gets the list without a drafting action', async ({ page }) => {
    const list = await getJson<{ items: LeadershipSummary[] }>(
      'analyst',
      '/api/insights/summaries',
    );

    await page.goto('/insights/summaries');
    await expectShell(page);
    await expect(page.getByRole('heading', { name: 'Leadership summaries' })).toBeVisible();
    await expect(page.getByTestId('summaries-note')).toContainText('A drafted summary is a draft');

    // The rows the API returned are on screen, so the absent button below means the page withheld
    // it rather than that nothing had loaded yet.
    for (const s of list.items) await expect(page.getByTestId(`summary-${s.id}`)).toBeVisible();

    // Drafting is audit.read, which the analyst does not hold. The button follows the permission
    // and not the close calendar, so it stays absent however many periods are waiting for a
    // summary — a drafting test running beside this one cannot change the answer.
    await expect(page.getByTestId('draft-summary')).toHaveCount(0);
  });
});
