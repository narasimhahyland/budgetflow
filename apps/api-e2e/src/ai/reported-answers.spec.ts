// Gap B9, 113a Query log > Reported answers (and 011a "Report a problem"). A person reports only
// their own answers; text is kept only when they include it, and only for 90 days; the audit
// trail records the report without the text. Reading follows the query log (audit or AI
// administration), marking reviewed needs AI administration, and tenants never see each other's.
import { expect, test, type APIRequestContext } from '@playwright/test';
import { AiReportedAnswer, AiReportedAnswerList, AskAnswer } from '@bf/contracts';
import { SEED, type SeedUserId } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { asOwner } from '../support/db';
import { auditEvents } from '../support/p8';

async function ask(request: APIRequestContext, user: SeedUserId): Promise<AskAnswer> {
  return expectContract(
    await request.post('/api/ai/ask', {
      headers: await as(user),
      data: { question: `How much is left in my budget? (${randomUUID().slice(0, 6)})` },
    }),
    200,
    AskAnswer,
  );
}

async function report(
  request: APIRequestContext,
  user: SeedUserId,
  turnId: string,
  includeText: boolean,
) {
  return request.post('/api/ai/reported-answers', {
    headers: await mutate(user),
    data: { turnId, reason: 'wrong_figure', note: 'The figure looks off.', includeText },
  });
}

const list = async (request: APIRequestContext, user: SeedUserId) =>
  expectContract(
    await request.get('/api/ai/reported-answers', { headers: await as(user) }),
    200,
    AiReportedAnswerList,
  );

test('a person reports their own answer; text is kept only when they include it', async ({
  request,
}) => {
  const withText = await ask(request, 'budget-owner');
  const created = await expectContract(
    await report(request, 'budget-owner', withText.turnId, true),
    201,
    AiReportedAnswer,
  );
  expect(created).toMatchObject({ status: 'new', includesText: true, reason: 'wrong_figure' });
  expect(created.question).toContain('How much is left in my budget?');
  expect(created.answer).toBe(withText.answer);
  expect(created.queryLogId).toBe(withText.provenance.queryLogId);
  const days = (Date.parse(created.textExpiresAt) - Date.parse(created.reportedAt)) / 86_400_000;
  expect(days).toBe(90);

  const withoutText = await ask(request, 'budget-owner');
  const bare = await expectContract(
    await report(request, 'budget-owner', withoutText.turnId, false),
    201,
    AiReportedAnswer,
  );
  expect(bare).toMatchObject({ includesText: false, question: null, answer: null });

  // One report per answer.
  await expectProblem(
    await report(request, 'budget-owner', withText.turnId, true),
    409,
    'AI_ANSWER_ALREADY_REPORTED',
  );
  // Someone else's answer cannot be reported, and its existence is not revealed.
  await expectProblem(await report(request, 'employee', withText.turnId, true), 404, 'NOT_FOUND');

  // The audit entry records the report, never the question or the answer.
  const audit = await auditEvents(request, created.id);
  expect(audit.map((e) => e.action)).toEqual(['ai.answer.reported']);
  expect(JSON.stringify(audit)).not.toContain('How much is left');
});

test('reading reported answers follows the query log; reviewing needs AI administration', async ({
  request,
}) => {
  const turn = await ask(request, 'department-head');
  const created = await expectContract(
    await report(request, 'department-head', turn.turnId, true),
    201,
    AiReportedAnswer,
  );

  // The reporter themself, and an employee, cannot read the tab.
  for (const user of ['employee', 'department-head'] as const)
    await expectProblem(
      await request.get('/api/ai/reported-answers', { headers: await as(user) }),
      403,
      'FORBIDDEN',
    );

  // The auditor reads it, text included, but cannot mark it reviewed.
  const auditorView = await list(request, 'auditor');
  expect(auditorView.canReview).toBe(false);
  expect(auditorView.items.find((r) => r.id === created.id)?.question).toBe(created.question);
  await expectProblem(
    await request.post(`/api/ai/reported-answers/${created.id}/review`, {
      headers: await mutate('auditor'),
      data: { note: 'Looked at it.' },
    }),
    403,
    'FORBIDDEN',
  );

  // The Organization Admin reviews it once, with a note.
  const adminView = await list(request, 'org-admin');
  expect(adminView.canReview).toBe(true);
  const reviewed = await expectContract(
    await request.post(`/api/ai/reported-answers/${created.id}/review`, {
      headers: await mutate('org-admin'),
      data: { note: 'Figure matches the ledger; the question meant a different budget.' },
    }),
    200,
    AiReportedAnswer,
  );
  expect(reviewed).toMatchObject({ status: 'reviewed', reviewedByName: 'Taylor Brooks' });
  await expectProblem(
    await request.post(`/api/ai/reported-answers/${created.id}/review`, {
      headers: await mutate('org-admin'),
      data: { note: 'Again.' },
    }),
    409,
    'AI_REPORT_ALREADY_REVIEWED',
  );
  await expectProblem(
    await request.post(`/api/ai/reported-answers/${created.id}/review`, {
      headers: await mutate('org-admin'),
      data: { note: '' },
    }),
    400,
    'VALIDATION_FAILED',
  );
  const audit = await auditEvents(request, created.id);
  expect(audit.map((e) => e.action).sort()).toEqual(['ai.answer.reported', 'ai.answer.reviewed']);

  // The status filter narrows in SQL; counts cover the whole tenant.
  const onlyNew = await expectContract(
    await request.get('/api/ai/reported-answers?status=new', { headers: await as('org-admin') }),
    200,
    AiReportedAnswerList,
  );
  expect(onlyNew.items.every((r) => r.status === 'new')).toBe(true);
  expect(onlyNew.items.some((r) => r.id === created.id)).toBe(false);

  // Globex sees none of Hyland's reports, and a forged tenant header is refused.
  const globex = await list(request, 'globex-admin');
  expect(globex.items.some((r) => r.id === created.id)).toBe(false);
  const forged = await request.get('/api/ai/reported-answers', {
    headers: await as('org-admin', {}, SEED.tenants.globex),
  });
  expect(forged.status()).toBe(403);
});

test('the nightly job removes report text after 90 days and keeps the report', async ({
  request,
}) => {
  const turn = await ask(request, 'budget-owner');
  const created = await expectContract(
    await report(request, 'budget-owner', turn.turnId, true),
    201,
    AiReportedAnswer,
  );
  // Age the scenario's own report past its 90 days, then let the nightly job run.
  await asOwner((c) =>
    c.query(
      `update ai_reported_answers set text_expires_at = '2026-01-01T00:00:00Z' where id = $1`,
      [created.id],
    ),
  );
  await asOwner((c) =>
    c.query(
      `insert into outbox_messages (tenant_id, topic, payload) values ($1, 'ai.scan_nightly', '{}')`,
      [SEED.tenants.acme],
    ),
  );
  await expect
    .poll(
      async () => (await list(request, 'auditor')).items.find((r) => r.id === created.id)?.question,
      { timeout: 60_000, intervals: [500, 1000, 2000] },
    )
    .toBeNull();
  const after = (await list(request, 'auditor')).items.find((r) => r.id === created.id)!;
  expect(after).toMatchObject({
    includesText: true,
    answer: null,
    reason: 'wrong_figure',
    status: 'new',
  });
});
