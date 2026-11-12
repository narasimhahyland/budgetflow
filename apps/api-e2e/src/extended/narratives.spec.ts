// Invariant 84: drafted text suggests, people decide. Every figure a summary quotes is a reference
// to a reconciled read-model value, a draft is published by nobody until a person has read every
// section and approved it, and an owner's variance commentary cannot be submitted while the model
// has left an "[Explain]" note where it had no truthful reason to give.
import { expect, test } from '@playwright/test';
import {
  ClosePeriodList,
  LeadershipSummary,
  LeadershipSummaryList,
  VarianceCommentary,
} from '@bf/contracts';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { allocateOk, createChild, createRoot } from '../support/factory';
import { reason, usd } from './support';
import { AI_LIVE, AI_LIVE_REASON } from '../ai/support';

test.skip(!AI_LIVE, AI_LIVE_REASON);

async function periods(request: import('@playwright/test').APIRequestContext) {
  const body = await expectContract(
    await request.get('/api/close/periods', { headers: await as('finance-admin') }),
    200,
    ClosePeriodList,
  );
  return body.items;
}

/** The period a summary is drafted from, by state, so the scenarios do not hard-code a month. */
async function periodOf(
  request: import('@playwright/test').APIRequestContext,
  wanted: 'closed' | 'open',
) {
  const all = await periods(request);
  const found = all.find((p) =>
    wanted === 'closed' ? p.status === 'closed' || p.status === 'locked' : p.status === 'open',
  );
  expect(found, `the seed has a ${wanted} accounting period`).toBeTruthy();
  return found!;
}

async function draft(
  request: import('@playwright/test').APIRequestContext,
  periodId: string,
  opts: { allowOpenPeriod?: boolean; as?: 'finance-admin' | 'ceo' | 'analyst' } = {},
) {
  return request.post('/api/insights/summaries', {
    headers: await mutate(opts.as ?? 'finance-admin'),
    data: { periodId, ...(opts.allowOpenPeriod ? { allowOpenPeriod: true } : {}) },
  });
}

test.describe('drafted leadership summaries stay subordinate to a person', () => {
  test('a draft quotes only figures BudgetFlow produced, each with its source', async ({
    request,
  }) => {
    const period = await periodOf(request, 'closed');
    const summary = await expectContract(await draft(request, period.id), 201, LeadershipSummary);
    expect(summary.status).toBe('ai_draft');
    expect(summary.periodState).toBe('closed');
    expect(summary.sections.length).toBeGreaterThan(0);

    const headline = summary.sections.find((s) => s.key === 'headline')!;
    // Every number the reader will see is a reference the server resolved; the model wrote the words
    // between them and never a digit of its own beyond the period label it was given.
    expect(headline.figures.length).toBeGreaterThan(0);
    for (const figure of headline.figures) {
      expect(headline.text).toContain(`{{figure:${figure.token}}}`);
      expect(figure.source.id).toBeTruthy();
      expect(figure.value !== null || figure.numericValue !== null).toBe(true);
    }
    // Nothing is published by drafting: no section is reviewed and nobody has approved it.
    expect(summary.sections.every((s) => !s.reviewed)).toBe(true);
    expect(summary.approvedByName).toBeNull();
    expect(summary.provenance?.queryLogId).toBeTruthy();
  });

  test('approval is refused until the author has read every section', async ({ request }) => {
    const period = await periodOf(request, 'closed');
    const summary = await expectContract(await draft(request, period.id), 201, LeadershipSummary);

    const tooEarly = await request.post(`/api/insights/summaries/${summary.id}/approve`, {
      headers: await mutate('finance-admin'),
      data: { attested: true },
    });
    await expectProblem(tooEarly, 422, 'SUMMARY_SECTION_UNREVIEWED');

    for (const section of summary.sections) {
      await expectContract(
        await request.put(`/api/insights/summaries/${summary.id}/sections/${section.key}`, {
          headers: await mutate('finance-admin'),
          data: { text: section.text, markReviewed: true },
        }),
        200,
        LeadershipSummary,
      );
    }
    const approved = await expectContract(
      await request.post(`/api/insights/summaries/${summary.id}/approve`, {
        headers: await mutate('finance-admin'),
        data: { attested: true, note: reason('read and approved for the board pack') },
      }),
      201,
      LeadershipSummary,
    );
    expect(approved.status).toBe('approved');
    expect(approved.approvedByName).toBeTruthy();

    // An approved summary is immutable: editing it is refused, not silently ignored.
    await expectProblem(
      await request.put(`/api/insights/summaries/${summary.id}/sections/headline`, {
        headers: await mutate('finance-admin'),
        data: { text: 'Rewritten after approval' },
      }),
      409,
      'SUMMARY_ALREADY_APPROVED',
    );
  });

  test('an open-period draft is labelled and can never be approved', async ({ request }) => {
    const period = await periodOf(request, 'open');
    await expectProblem(await draft(request, period.id), 422, 'SUMMARY_PERIOD_NOT_CLOSED');

    const summary = await expectContract(
      await draft(request, period.id, { allowOpenPeriod: true }),
      201,
      LeadershipSummary,
    );
    expect(summary.periodState).toBe('open');
    for (const section of summary.sections)
      await request.put(`/api/insights/summaries/${summary.id}/sections/${section.key}`, {
        headers: await mutate('finance-admin'),
        data: { text: section.text, markReviewed: true },
      });
    await expectProblem(
      await request.post(`/api/insights/summaries/${summary.id}/approve`, {
        headers: await mutate('finance-admin'),
        data: { attested: true },
      }),
      422,
      'SUMMARY_PERIOD_NOT_CLOSED',
    );
  });

  test('regenerating a section takes its review with it', async ({ request }) => {
    const period = await periodOf(request, 'closed');
    const summary = await expectContract(await draft(request, period.id), 201, LeadershipSummary);
    await request.put(`/api/insights/summaries/${summary.id}/sections/headline`, {
      headers: await mutate('finance-admin'),
      data: { text: 'My own headline', markReviewed: true },
    });
    const regenerated = await expectContract(
      await request.post(`/api/insights/summaries/${summary.id}/sections/headline/regenerate`, {
        headers: await mutate('finance-admin'),
        data: {},
      }),
      201,
      LeadershipSummary,
    );
    const headline = regenerated.sections.find((s) => s.key === 'headline')!;
    expect(headline.text).not.toBe('My own headline');
    expect(headline.reviewed).toBe(false);
    expect(headline.edited).toBe(false);
  });

  test('a read-only analyst reads summaries but cannot draft or approve one', async ({
    request,
  }) => {
    const period = await periodOf(request, 'closed');
    const list = await expectContract(
      await request.get('/api/insights/summaries', { headers: await as('analyst') }),
      200,
      LeadershipSummaryList,
    );
    expect(Array.isArray(list.items)).toBe(true);
    const refused = await draft(request, period.id, { as: 'analyst' });
    expect(refused.status(), await refused.text()).toBe(403);
  });
});

test.describe('variance commentary belongs to the owner who signs it', () => {
  test('an unexplained variance leaves a placeholder that blocks submission', async ({
    request,
  }) => {
    // A budget whose forecast exceeds its authorized amount with no commitment behind the gap: the
    // drivers cannot explain it, so the draft must say so rather than invent a reason.
    const root = await createRoot(request, { amountMinor: 500_000 });
    const child = await createChild(request, root.id, { currency: 'USD', owner: 'budget-owner' });
    await allocateOk(request, root.id, child.id, usd(100_000));

    const commentary = await expectContract(
      await request.post('/api/insights/commentary', {
        headers: await mutate('budget-owner'),
        data: { budgetId: child.id },
      }),
      201,
      VarianceCommentary,
    );
    expect(commentary.status).toBe('draft');
    expect(commentary.draftedWithAi).toBe(true);
    expect(commentary.attested).toBe(false);

    // Nothing is committed against this budget, so none of its 100,000 variance has a driver and the
    // draft has to carry the note rather than a reason.
    expect(commentary.hasPlaceholder).toBe(true);
    expect(commentary.unexplained?.amountMinor).toBe(100_000);
    await expectProblem(
      await request.post(`/api/insights/commentary/${commentary.id}/submit`, {
        headers: await mutate('budget-owner'),
        data: { text: commentary.text, attested: true },
      }),
      422,
      'COMMENTARY_PLACEHOLDER_PRESENT',
    );

    // Replacing the note with the owner's own words is what makes it submittable.
    const submitted = await expectContract(
      await request.post(`/api/insights/commentary/${commentary.id}/submit`, {
        headers: await mutate('budget-owner'),
        data: {
          text: 'The team day ran larger than last year and I will cover the rest from December.',
          attested: true,
        },
      }),
      201,
      VarianceCommentary,
    );
    expect(submitted.status).toBe('submitted');
    expect(submitted.attested).toBe(true);
    expect(submitted.hasPlaceholder).toBe(false);

    await expectProblem(
      await request.post(`/api/insights/commentary/${commentary.id}/submit`, {
        headers: await mutate('budget-owner'),
        data: { text: 'Again', attested: true },
      }),
      409,
      'COMMENTARY_ALREADY_SUBMITTED',
    );
  });

  test('a text with an [Explain] note is always refused, whoever typed it', async ({ request }) => {
    const root = await createRoot(request, { amountMinor: 400_000 });
    const child = await createChild(request, root.id, { currency: 'USD', owner: 'budget-owner' });
    await allocateOk(request, root.id, child.id, usd(80_000));
    const commentary = await expectContract(
      await request.post('/api/insights/commentary', {
        headers: await mutate('budget-owner'),
        data: { budgetId: child.id },
      }),
      201,
      VarianceCommentary,
    );
    await expectProblem(
      await request.post(`/api/insights/commentary/${commentary.id}/submit`, {
        headers: await mutate('budget-owner'),
        data: {
          text: 'Mostly catering. [Explain: no driver found for 600.00 USD]',
          attested: true,
        },
      }),
      422,
      'COMMENTARY_PLACEHOLDER_PRESENT',
    );
  });

  test('an employee cannot draft commentary on a budget they do not forecast', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 300_000 });
    const child = await createChild(request, root.id, { currency: 'USD', owner: 'budget-owner' });
    await allocateOk(request, root.id, child.id, usd(50_000));
    const refused = await request.post('/api/insights/commentary', {
      headers: await mutate('employee'),
      data: { budgetId: child.id },
    });
    expect([403, 404]).toContain(refused.status());
  });
});
