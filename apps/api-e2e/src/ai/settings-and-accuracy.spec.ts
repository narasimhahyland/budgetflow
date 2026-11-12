// 113a: the per-tenant kill switch, the Finance Admin confirmation that finance-affecting features
// need, who may read the AI query log, and the evaluation sets that measure each feature against its
// published threshold instead of asserting quality by hand.
import { expect, test } from '@playwright/test';
import { AI_FEATURES, AiAccuracyView, AiSettings, AiSettingsView } from '@bf/contracts';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { AI_LIVE, AI_LIVE_REASON } from './support';

test.skip(!AI_LIVE, AI_LIVE_REASON);

test('a finance-affecting feature turned on by the Org Admin stays off until Finance confirms', async ({
  request,
}) => {
  // Start from off so the scenario is repeatable.
  await expectContract(
    await request.post('/api/ai/features/matching/switch', {
      headers: await mutate('org-admin', randomUUID()),
      data: { enabled: false },
    }),
    201,
    AiSettingsView,
  );

  const pending = await expectContract(
    await request.post('/api/ai/features/matching/switch', {
      headers: await mutate('org-admin', randomUUID()),
      data: { enabled: true },
    }),
    201,
    AiSettingsView,
  );
  const row = pending.features.find((f) => f.feature === 'matching')!;
  expect(row.needsFinanceConfirmation).toBe(true);
  expect(row.pendingFinanceConfirmation).toBe(true);
  expect(row.enabled, 'the switch alone does not turn a finance feature on').toBe(false);

  // The Organization Admin cannot confirm it themselves.
  const self = await request.post('/api/ai/features/matching/finance-confirmation', {
    headers: await mutate('org-admin', randomUUID()),
  });
  expect([403, 404]).toContain(self.status());

  const confirmed = await expectContract(
    await request.post('/api/ai/features/matching/finance-confirmation', {
      headers: await mutate('finance-admin', randomUUID()),
    }),
    201,
    AiSettingsView,
  );
  const after = confirmed.features.find((f) => f.feature === 'matching')!;
  expect(after.enabled).toBe(true);
  expect(after.pendingFinanceConfirmation).toBe(false);
});

test('the turn-on dialog can show exactly what a feature sends, and never a credential field', async ({
  request,
}) => {
  const view = await expectContract(
    await request.get('/api/ai/settings', { headers: await as('finance-admin') }),
    200,
    AiSettingsView,
  );
  // The dialog shows every feature in the catalog, so a phase that adds one cannot add it silently.
  expect(view.features.length).toBe(AI_FEATURES.length);
  for (const feature of view.features) {
    expect(feature.dataSent.length, `${feature.feature} lists the fields it sends`).toBeGreaterThan(
      0,
    );
    for (const field of feature.dataSent)
      expect(field).not.toMatch(/email|phone|address|card|token|secret|password/i);
    expect(feature.neverDoes.join(' ')).toContain('cannot approve');
  }
  expect(view.provider.configured).toBe(true);
  expect(view.provider.note).toContain('never shown');
  expect(JSON.stringify(view.provider), 'the provider card never carries a credential').not.toMatch(
    /sk-|Bearer |password/i,
  );
});

test('an employee cannot read the AI query log; an auditor can', async ({ request }) => {
  const refused = await request.get('/api/ai/query-log', { headers: await as('employee') });
  expect([403, 404]).toContain(refused.status());
  const allowed = await request.get('/api/ai/query-log', { headers: await as('auditor') });
  expect(allowed.status()).toBe(200);
});

test('every AI feature meets its published accuracy threshold against Amazon Bedrock', async ({
  request,
}) => {
  const run = await expectContract(
    await request.post('/api/ai/evaluations/run', {
      headers: await as('org-admin'),
      data: {},
    }),
    200,
    AiAccuracyView,
  );
  expect(
    run.results.length,
    'every feature has at least one evaluation set',
  ).toBeGreaterThanOrEqual(10);
  for (const result of run.results) {
    expect(result.provider).toBe('bedrock');
    expect(result.cases, `${result.feature}/${result.metric} has fixtures`).toBeGreaterThan(0);
    expect(
      result.resultBps,
      `${result.feature}/${result.metric}${result.kind ? `/${result.kind}` : ''} failed: ${result.failures.join(', ')}`,
    ).toBeGreaterThanOrEqual(result.thresholdBps);
  }
  expect(run.allPassed).toBe(true);

  // The thresholds published in 113a are the ones that were measured.
  const byMetric = new Map(run.results.map((r) => [`${r.feature}|${r.metric}|${r.kind ?? ''}`, r]));
  expect(byMetric.get('matching|high_confidence_precision|')?.thresholdBps).toBe(9_500);
  expect(byMetric.get('anomaly_flags|flag_precision|possible_split')?.thresholdBps).toBe(8_000);
  expect(byMetric.get('ask|cites_only_permitted_records|')?.thresholdBps).toBe(10_000);
  expect(byMetric.get('ask|refuses_out_of_scope|')?.thresholdBps).toBe(10_000);
});

test('the accuracy view is readable by finance and ordered deterministically', async ({
  request,
}) => {
  const view = await expectContract(
    await request.get('/api/ai/accuracy', { headers: await as('finance-admin') }),
    200,
    AiAccuracyView,
  );
  const keys = view.results.map((r) => `${r.feature}|${r.metric}|${r.kind ?? ''}`);
  expect(keys, 'ordered by feature, then metric, then kind').toEqual(
    [...view.results]
      .sort(
        (a, b) =>
          a.feature.localeCompare(b.feature) ||
          a.metric.localeCompare(b.metric) ||
          (a.kind ?? '').localeCompare(b.kind ?? ''),
      )
      .map((r) => `${r.feature}|${r.metric}|${r.kind ?? ''}`),
  );
  expect(new Set(keys).size, 'one latest result per metric').toBe(keys.length);
});

test('AI settings are validated and audited', async ({ request }) => {
  const current = await expectContract(
    await request.get('/api/ai/settings', { headers: await as('org-admin') }),
    200,
    AiSettingsView,
  );
  const invalid: AiSettings = { ...current.settings, conversationHistoryDays: 200 };
  await expectProblem(
    await request.put('/api/ai/settings', {
      headers: await mutate('org-admin', randomUUID()),
      data: invalid,
    }),
    400,
    'VALIDATION_FAILED',
  );

  const updated = await expectContract(
    await request.put('/api/ai/settings', {
      headers: await mutate('org-admin', randomUUID()),
      data: { ...current.settings, nudgeFrequencyDays: 21 },
    }),
    200,
    AiSettingsView,
  );
  expect(updated.settings.nudgeFrequencyDays).toBe(21);

  await expectContract(
    await request.put('/api/ai/settings', {
      headers: await mutate('org-admin', randomUUID()),
      data: current.settings,
    }),
    200,
    AiSettingsView,
  );
});
