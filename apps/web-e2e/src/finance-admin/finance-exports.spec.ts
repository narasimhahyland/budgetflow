// Gap B5 journeys (094b): the Finance Admin creates and downloads each finance export through the UI:
// the seeded Germany-to-India intercompany recharge (checked by its journal), a chargeback posted for
// the journey, and the UK payroll benefits (the seeded reportable benefit of GBP 168.00). Each file is
// balanced or totalled per person; once exported, the payroll items are not offered again. The Integration Admin sees the
// delivery list but no files. Seeded data is fictional.
import { expect, test, type Page } from '@playwright/test';
import { SEED, userById } from '@bf/seed';
import { readFile } from 'node:fs/promises';
import { allocate, api, createRoot } from '../budgets/api';
import { authFile } from '../support/roles';
import { desktopOnly, suffix } from '../spend/api';

const INDIA = SEED.legalEntities.acmeIndia;
/** The seeded Diwali celebration, whose Germany contribution carries the seeded recharge. */
const DIWALI = '73000000-0000-4000-8000-000000000001';

/** A categorized India budget with spend charged in and out through payables clearing. */
async function indiaChargeback() {
  const tag = suffix();
  const root = await createRoot({ amountMinor: 50_000_000, name: `B5 journey root ${tag}` });
  const b = await api<{ id: string }>('ceo', 'post', '/api/budgets', {
    name: `B5 journey chargeback ${tag}`,
    parentId: root.id,
    legalEntityId: INDIA,
    costCenterId: '31000000-0000-4000-8000-000000000003',
    categoryCode: 'employee_events',
    currency: 'USD',
    fiscalYearId: SEED.fiscalYears.acmeFy2026,
    ownerPersonId: userById('budget-owner').personId,
  });
  await allocate(root.id, b.id, 500_000, 'ceo');
  await api('finance-admin', 'post', '/api/ledger/journals', {
    transactionCurrency: 'USD',
    reasonCode: 'ADJ-CHARGEBACK',
    reason: `B5 journey offsite charged to Hyderabad ${tag}`,
    lines: [
      { budgetId: b.id, account: 'actual', side: 'debit', amountMinor: 25_000 },
      {
        budgetId: null,
        account: 'obligations',
        side: 'credit',
        amountMinor: 25_000,
        legalEntityId: INDIA,
      },
    ],
  });
  return tag;
}

async function openNewExport(page: Page) {
  await page.getByRole('button', { name: 'New export' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New export' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function choose(page: Page, label: string, option: string) {
  const dialog = page.getByRole('dialog', { name: 'New export' });
  await dialog.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

/** Downloads one file from a row's menu and returns its text. */
async function downloadFrom(page: Page, number: string, item: 'Download CSV' | 'Download XLSX') {
  await page.getByRole('button', { name: `Actions for ${number}` }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: item }).click(),
  ]);
  return { name: download.suggestedFilename(), path: await download.path() };
}

async function createFromDialog(page: Page): Promise<string> {
  const dialog = page.getByRole('dialog', { name: 'New export' });
  await dialog.getByRole('button', { name: 'Create and send' }).click();
  await expect(dialog).toBeHidden();
  const snack = page.getByText(/EXP-\d{4}-\d{4} created:/);
  await expect(snack).toBeVisible();
  return /EXP-\d{4}-\d{4}/.exec((await snack.textContent()) ?? '')![0];
}

const csvLines = async (path: string) => (await readFile(path, 'utf8')).trimEnd().split('\r\n');

test.describe('finance and payroll exports (094b)', () => {
  test.use({ storageState: authFile('finance-admin') });

  test('Finance creates and downloads the recharge, chargeback and payroll exports', async ({
    page,
  }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    const tag = await indiaChargeback();
    await page.goto('/finance/exports');
    await expect(page.getByRole('heading', { name: 'Finance exports', level: 1 })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Exports for November 2026', exact: true }),
    ).toBeVisible();

    // 1. Intercompany recharges: the seeded Diwali event's HYL-DE to HYL-IN recharge, balanced. Other
    // journeys may add their own Germany recharges, so the file is checked by the seeded journal.
    const seeded = await api<{ items: { journalId: string | null }[] }>(
      'finance-admin',
      'get',
      `/api/recharges?eventId=${DIWALI}`,
    );
    expect(seeded.items).toHaveLength(1);
    const journalId = seeded.items[0].journalId!;
    let dialog = await openNewExport(page);
    await choose(page, 'Legal entity', 'HYL-DE');
    await expect(dialog.getByTestId('export-balance')).toContainText('Debits equal credits');
    await expect(
      dialog.getByRole('table', { name: 'Preview lines' }).getByRole('row', {
        name: /^HYL-DE Nov 2026 1300 Intercompany receivable .* Intercompany recharge HYL-DE to HYL-IN with markup USD 12\.00 USD 252\.00/,
      }),
    ).not.toHaveCount(0);
    const recharge = await createFromDialog(page);
    const row = page.getByRole('row').filter({ hasText: recharge });
    await expect(row).toContainText('Intercompany recharges');
    await expect(row.getByText('Sent', { exact: true })).toBeVisible();
    const csv = await downloadFrom(page, recharge, 'Download CSV');
    expect(csv.name).toBe(`${recharge}-intercompany-recharges-2026-11.csv`);
    const lines = await csvLines(csv.path);
    const header = lines[0].split(',');
    // Exact header, except debit and credit, whose headers name the currency (`debit (USD)`).
    const col = (name: string) => header.findIndex((h) => h === name || h.startsWith(`${name} (`));
    const pair = lines.map((l) => l.split(',')).filter((r) => r[col('journal_id')] === journalId);
    expect(pair.map((r) => [r[col('legal_entity')], r[col('account')]]).sort()).toEqual([
      ['HYL-DE', '1300'],
      ['HYL-IN', '2300'],
    ]);
    // The pair nets to zero: the debit on one side is the credit on the other.
    expect(pair.find((r) => r[col('account')] === '1300')![col('debit')]).toBe('252.00');
    expect(pair.find((r) => r[col('account')] === '2300')![col('credit')]).toBe('252.00');
    const total = lines[lines.length - 1].split(',');
    expect(total[0]).toBe('Total');
    expect(total[col('debit')]).toBe(total[col('credit')]);
    const xlsx = await downloadFrom(page, recharge, 'Download XLSX');
    expect(xlsx.name).toBe(`${recharge}-intercompany-recharges-2026-11.xlsx`);
    expect((await readFile(xlsx.path)).subarray(0, 2).toString('latin1')).toBe('PK');

    // 2. Chargeback and reclass: the journey's own chargeback in HYL-IN, mapped to GL 6100.
    dialog = await openNewExport(page);
    await choose(page, 'Type', 'Chargeback and reclass');
    await choose(page, 'Legal entity', 'HYL-IN');
    await expect(dialog.getByTestId('export-balance')).toContainText('Debits equal credits');
    await expect(
      dialog
        .getByRole('table', { name: 'Preview lines' })
        .getByRole('row')
        .filter({ hasText: tag }),
    ).toHaveCount(2);
    const chargeback = await createFromDialog(page);
    const cbCsv = await downloadFrom(page, chargeback, 'Download CSV');
    expect(cbCsv.name).toBe(`${chargeback}-chargeback-reclass-2026-11.csv`);
    const cbLines = (await csvLines(cbCsv.path)).filter((l) => l.includes(tag));
    expect(cbLines).toHaveLength(2);
    expect(cbLines.some((l) => l.includes(',6100,') && l.includes('CC-IN-HYD-210'))).toBe(true);

    // 3. Payroll benefits for HYL-UK: totals per person, the seeded GBP 168.00 for Oliver Hayes.
    dialog = await openNewExport(page);
    await choose(page, 'Type', 'Payroll benefits');
    await expect(
      dialog.getByText('Choose the legal entity whose payroll receives the export.'),
    ).toBeVisible();
    await choose(page, 'Legal entity', 'HYL-UK');
    await expect(dialog.getByTestId('export-balance')).toContainText('Oliver Hayes');
    await expect(dialog.getByTestId('export-balance')).toContainText('GBP 168.00');
    const payroll = await createFromDialog(page);
    const payRow = page.getByRole('row').filter({ hasText: payroll });
    await expect(payRow).toContainText('Payroll benefits');
    await expect(payRow).toContainText('reportable');
    const payCsv = await downloadFrom(page, payroll, 'Download CSV');
    const oliver = (await csvLines(payCsv.path)).find((l) => l.includes('Oliver Hayes'));
    expect(oliver).toContain('UK annual staff functions,2026-04-06,2027-04-05,168.00,GBP,no');
    // Exported once: HYL-UK payroll has nothing new; sending again is a duplicate and needs a reason.
    dialog = await openNewExport(page);
    await choose(page, 'Type', 'Payroll benefits');
    await choose(page, 'Legal entity', 'HYL-UK');
    await expect(dialog.getByTestId('export-nothing')).toContainText(
      'No new items for November 2026 in HYL-UK.',
    );
    await expect(dialog.getByRole('button', { name: 'Create and send' })).toBeDisabled();
    await dialog.getByRole('switch', { name: 'Include items already exported' }).click();
    await expect(dialog.getByTestId('export-reexport')).toContainText(`${payroll} was sent on`);
    await expect(dialog.getByRole('button', { name: 'Create and send' })).toBeDisabled();
    await dialog
      .getByRole('textbox', { name: 'Reason for sending again' })
      .fill('Payroll lost the file');
    await expect(dialog.getByRole('button', { name: 'Create and send' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    // Mark posted: the recharge export carries the ERP document number.
    await page.getByRole('button', { name: `Actions for ${recharge}` }).click();
    await page.getByRole('menuitem', { name: 'Mark posted' }).click();
    const post = page.getByRole('dialog', { name: `Mark ${recharge} posted` });
    await post.getByRole('textbox', { name: 'ERP document number' }).fill('JV-2026-11-0099');
    await post.getByRole('button', { name: 'Mark posted' }).click();
    await expect(row.getByText('Posted', { exact: true })).toBeVisible();
    await expect(row).toContainText('JV-2026-11-0099');
  });
});

test.describe('finance exports for the integration admin (094b)', () => {
  test.use({ storageState: authFile('integration-admin') });

  test('the delivery list is visible without lines, files or New export', async ({ page }) => {
    await page.goto('/finance/exports');
    await expect(page.getByRole('heading', { name: 'Finance exports', level: 1 })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Exports for November 2026', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'New export' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Actions for / })).toHaveCount(0);
  });
});
