// Phase 13 journeys for the surfaces where a person acts on an AI suggestion (080f, 022d, 017c, 121a).
// Each one proves the same rule from a different angle: the suggestion proposes, the person applies it
// through the normal authorized command, and only then is the decision recorded against the suggestion.
import { expect, test, type APIRequestContext } from '@playwright/test';
import { SEED } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { expectShell } from '../support/auth';
import { authFile } from '../support/roles';
import { apiAs, setAiFeature } from './support';
import { AI_LIVE, AI_LIVE_REASON } from './live';

test.skip(!AI_LIVE, AI_LIVE_REASON);

const uniq = () => randomUUID().slice(0, 8).toUpperCase();

/**
 * A spend line of this journey's own. The seeded unmatched lines carry event codes that the event
 * reconciliation journeys need to stay unmatched, so matching one of those here would quietly break
 * them: the subject has to be a line this test created.
 */
async function importSpendLine(
  api: APIRequestContext,
  ref: string,
): Promise<{ actualId: string; merchant: string }> {
  // A merchant of its own, so the queue row this journey works on cannot be confused with another.
  const merchant = `Journey Print ${ref}`;
  const csv = [
    'source_ref,transaction_date,amount,currency,legal_entity,cost_center,gl_account,merchant,memo',
    `${ref},2026-11-04,320.00,USD,HYL-US,CC-US-NYC-300,6100,${merchant},Offsite name badges`,
  ].join('\n');
  const uploaded = await api.post('/api/actuals/imports', {
    data: { source: 'erp', fileName: `ai-journey-${ref}.csv`, content: csv },
    headers: { 'idempotency-key': randomUUID() },
  });
  expect(uploaded.status(), 'import the journey\u2019s own spend line').toBe(201);
  const batch = (await uploaded.json()) as { id: string };
  const posted = await api.post(`/api/actuals/imports/${batch.id}/post`, {
    headers: { 'idempotency-key': randomUUID() },
  });
  expect(posted.status(), 'post the import').toBe(200);

  const found = (await (await api.get(`/api/actuals?status=all&q=${ref}`)).json()) as {
    items: { id: string; sourceRef: string; status: string }[];
  };
  const line = found.items.find((i) => i.sourceRef === ref);
  expect(line, 'the imported line is in the queue').toBeDefined();
  expect(line!.status, 'it starts unmatched').toBe('unmatched');
  return { actualId: line!.id, merchant };
}

// Accepting a suggestion is a one-shot human decision: the API refuses a second decision on the same
// suggestion. A retry would therefore run against state the first attempt already changed, so these
// journeys do not retry — a failure here is a real failure on a freshly seeded stack.
test.describe('AI matching suggestions (080f)', () => {
  test.describe.configure({ retries: 0 });
  test.use({ storageState: authFile('finance-controller') });
  test.beforeAll(async () => {
    // These journeys run on desktop only, and so does their setup.
    if (test.info().project.name === 'desktop') await setAiFeature('matching', true);
  });

  test('ranks unmatched lines without matching anything, then matches through the normal command and records the decision', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
    const api = await apiAs('finance-controller');
    const ref = `AIJ-${uniq()}`;
    const line = await importSpendLine(api, ref);

    await page.goto('/finance/actuals/suggestions');
    await expectShell(page);
    await expect(page.getByRole('heading', { name: 'Matching suggestions' })).toBeVisible();

    await page.getByTestId('run-matching').click();
    const queue = page.getByRole('table', { name: 'AI matching suggestions' });
    // Header, the two seeded unmatched lines, and the one this journey imported.
    await expect(queue.getByRole('row')).toHaveCount(4);
    // Ranking alone matches nothing: every line is still open and waiting for a person.
    await expect(page.getByTestId('kpi-accepted')).toContainText('0');

    const beforeAccepted = (await (
      await api.get('/api/ai/matching-suggestions?status=accepted')
    ).json()) as { items: unknown[] };
    expect(beforeAccepted.items).toHaveLength(0);

    // First the seeded Hack Week travel line, chosen by its memo and never by position. Its top
    // suggestion is wrong, and the normal match command refuses it: a suggestion is not permission.
    // Nothing changes, so the line is left exactly as the seed had it.
    const wrongRow = page.getByRole('row', { name: /Hack Week team travel/ });
    await expect(wrongRow).toContainText('INR');
    await wrongRow.getByRole('button', { name: 'Hack Week team travel' }).click();

    const detail = page.getByTestId('match-detail');
    await expect(detail).toBeVisible();
    await expect(detail.getByTestId('match-apply-note')).toContainText(
      'normal actuals match command',
    );
    await expect(detail.getByTestId('fx-note')).toContainText('FX never consumes budget');
    await expect(detail.getByTestId('figures-caption')).toContainText('read from the ledger');
    await expect(detail.getByTestId('ai-provenance')).toContainText('claude');

    await detail.getByTestId('accept-suggestion').click();
    await expect(detail.getByTestId('match-error')).toContainText(
      'above the commitment plus its tolerance',
    );
    const stillOpen = (await (
      await api.get('/api/ai/matching-suggestions?status=accepted')
    ).json()) as { items: unknown[] };
    expect(stillOpen.items, 'a refused command records no acceptance').toHaveLength(0);
    await detail.getByRole('button', { name: 'Close' }).click();

    // Then this journey's own line, which the match command accepts.
    await page.getByTestId('run-matching').click();
    const row = page.getByRole('row', { name: new RegExp(line.merchant) });
    await expect(row).toContainText('USD 320.00');
    await row.getByRole('button', { name: line.merchant }).click();
    await expect(page.getByTestId('match-detail')).toBeVisible();

    await page.getByTestId('match-detail').getByTestId('accept-suggestion').click();
    await expect(page.getByText(/recorded as accepted by/)).toBeVisible();

    // The spend line really moved through the match command, and the acceptance is recorded with
    // the person who made it and the audit entry the command wrote.
    const accepted = (await (
      await api.get('/api/ai/matching-suggestions?status=accepted')
    ).json()) as { items: { status: string; actualId: string; memo: string | null }[] };
    expect(accepted.items).toHaveLength(1);
    expect(accepted.items[0]).toMatchObject({ status: 'accepted', actualId: line.actualId });
    const after = (await (await api.get(`/api/actuals?status=all&q=${ref}`)).json()) as {
      items: { id: string; status: string }[];
    };
    expect(
      after.items.find((a) => a.id === line.actualId)?.status,
      'the line was matched by the normal command',
    ).toBe('matched');

    // The query log carries the human decision with the record it was applied to.
    const log = (await (
      await api.get('/api/ai/query-log?feature=matching&outcome=accepted')
    ).json()) as {
      items: { appliedResourceType: string | null; auditEventId: string | null }[];
    };
    expect(log.items.length).toBeGreaterThan(0);
    expect(log.items[0].appliedResourceType).toBe('actual');
    expect(log.items[0].auditEventId).not.toBeNull();
  });

  test('refuses an acceptance that was never applied, straight from the API the screen uses', async () => {
    const api = await apiAs('finance-controller');
    await api.post('/api/ai/matching-suggestions/run', {
      data: {},
      headers: { 'idempotency-key': crypto.randomUUID() },
    });
    const list = (await (await api.get('/api/ai/matching-suggestions?status=open')).json()) as {
      items: { id: string; actualId: string; memo: string | null }[];
    };
    // The seeded Hack Week travel line, named outright: never "whichever suggestion is first". The
    // match command refuses its suggested target, so no journey can have accepted it.
    const suggestion = list.items.find((i) => i.memo === 'Hack Week team travel');
    expect(suggestion, 'the Hack Week travel suggestion is open').toBeDefined();
    if (!suggestion) throw new Error('unreachable: asserted above');
    // Recording an acceptance without running the match command is refused: an AI suggestion is
    // never itself the change.
    const res = await api.post(`/api/ai/suggestions/${suggestion.id}/decision`, {
      data: {
        decision: 'accepted',
        appliedResourceType: 'actual',
        appliedResourceId: suggestion.actualId,
      },
      headers: { 'idempotency-key': crypto.randomUUID() },
    });
    expect(res.status()).toBe(409);
    expect((await res.json()) as { code: string }).toMatchObject({
      code: 'AI_SUGGESTION_NOT_APPLIED',
    });
  });
});

test.describe('Suggested allocations (022d)', () => {
  test.describe.configure({ retries: 0 });
  test.use({ storageState: authFile('regional-manager') });
  test.beforeAll(async () => {
    // These journeys run on desktop only, and so does their setup.
    if (test.info().project.name === 'desktop') await setAiFeature('allocation_suggestions', true);
  });

  test('suggests a split the owner can change, then posts it through the normal allocation command', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
    await page.goto(`/budgets/${SEED.budgets.india}/suggest-split`);
    await expectShell(page);
    await expect(page.getByRole('heading', { name: 'Suggested allocations' })).toBeVisible();

    // The weights are the model's proposal, with its reason in the AI-labelled prose block.
    await expect(page.getByTestId('weight-headcount')).toHaveText('50%');
    await expect(page.getByTestId('ai-prose')).toContainText("last year's use");
    await expect(page.getByTestId('rounding-note')).toContainText('remainder goes to the largest');

    // The child driven by headcount is left out by design, with the reason shown.
    await expect(page.getByTestId('excluded')).toContainText('Hyderabad Events');
    await expect(page.getByTestId('excluded')).toContainText('Driven by headcount');

    const row = page.getByTestId(`split-row-${SEED.budgets.bengaluru}`);
    await expect(row).toContainText('From suggestion');

    // The owner lowers the line: the suggestion loses its tag and the draft total follows.
    await page.getByTestId(`amount-${SEED.budgets.bengaluru}`).fill('1000');
    await expect(row).toContainText('Edited by you');
    await expect(page.getByTestId('draft-total')).toHaveText('USD 1,000.00');

    // Checking runs the real allocation command as a dry run: still nothing posted.
    await page.getByTestId('check-split').click();
    const preview = page.getByTestId('split-preview');
    await expect(preview).toContainText('Nothing has been posted yet');

    await page.getByTestId('submit-split').click();
    await expect(page.getByText(/as one change, and recorded your acceptance/)).toBeVisible();

    // The acceptance only exists because the allocation command ran, and names the budget it changed.
    // Read as the auditor: the owner who made the decision cannot read the query log themselves.
    const auditApi = await apiAs('auditor');
    const log = (await (
      await auditApi.get('/api/ai/query-log?feature=allocation_suggestions&outcome=accepted')
    ).json()) as {
      items: { appliedResourceType: string | null; appliedResourceId: string | null }[];
    };
    expect(log.items.length).toBeGreaterThan(0);
    expect(log.items[0]).toMatchObject({
      appliedResourceType: 'budget',
      appliedResourceId: SEED.budgets.india,
    });
  });
});

test.describe('Anomaly flags (017c)', () => {
  test.describe.configure({ retries: 0 });
  test.use({ storageState: authFile('finance-controller') });
  test.beforeAll(async () => {
    // These journeys run on desktop only, and so does their setup.
    if (test.info().project.name === 'desktop') await setAiFeature('anomaly_flags', true);
  });

  test('raises an advisory flag with evidence from the records and clears it with a reason', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
    await page.goto('/finance/anomalies');
    await expectShell(page);
    await page.getByTestId('run-scan').click();

    // The seeded pair on Bengaluru Events, by its refs: other journeys raise their own
    // requests, and any two of them close together can be flagged as a possible split too.
    const subject = () =>
      page
        .getByRole('row', { name: /Possible split/ })
        .filter({ hasText: 'REQ-00001 and REQ-00007' });
    const row = subject();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Possible split' }).click();

    const detail = page.getByTestId('flag-detail');
    await expect(detail.getByTestId('advisory-only')).toHaveText('Does not block approval');
    await expect(detail.getByTestId('ai-prose')).toContainText('together come to');
    // The evidence is deterministic and comes from the records, not from the model.
    await expect(detail.getByTestId('flag-evidence')).toContainText('Days apart');
    await expect(detail.getByTestId('flag-evidence')).toContainText('Combined');
    await expect(detail.getByTestId('figures-caption')).toContainText('read from the ledger');

    // Clearing needs a reason code and a note; both feed the evaluation set.
    await expect(detail.getByTestId('clear-flag')).toBeDisabled();
    await detail.getByTestId('clear-note').fill('Two separate catering orders for two teams');
    await detail.getByTestId('clear-flag').click();
    await expect(page.getByText('Flag cleared with your reason.')).toBeVisible();

    await page.getByTestId('flag-status-resolved').click();
    await expect(subject()).toBeVisible();
  });
});

test.describe('Receipt extraction (121a)', () => {
  test.describe.configure({ retries: 0 });
  test.use({ storageState: authFile('finance-admin') });
  test.beforeAll(async () => {
    // These journeys run on desktop only, and so does their setup.
    if (test.info().project.name === 'desktop') await setAiFeature('extraction', true);
  });

  test('prefills the details from the verified receipt and records only what the person confirms', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
    await page.goto(`/documents/extraction?documentId=${SEED.p13.receiptCafeMocha}&kind=receipt`);
    await expectShell(page);

    const fields = page.getByTestId('extracted-fields');
    await expect(fields).toBeVisible();
    await expect(page.getByTestId('field-merchant')).toHaveValue('Cafe Mocha, Indiranagar');
    await expect(page.getByTestId('field-receiptDate')).toHaveValue('2026-10-18');
    // Card numbers, signatures and contact details are dropped by the extractor, never stored.
    await expect(page.getByTestId('dropped-fields')).toContainText('card number');

    // Confirming is blocked until the person says they checked the details.
    await expect(page.getByTestId('confirm-fields')).toBeDisabled();
    await page.getByTestId('confirm-checked').click();
    await page.getByTestId('confirm-fields').click();

    await expect(page.getByText('Details confirmed and recorded against this file.')).toBeVisible();
    const confirmed = page.getByTestId('confirmed-fields');
    await expect(confirmed).toContainText('Cafe Mocha, Indiranagar');
  });
});
