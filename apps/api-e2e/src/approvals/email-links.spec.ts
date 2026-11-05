// Actionable approval email (061a): the worker emails the approver through Mailpit with signed,
// single-use, expiring Approve and Reject links bound to the approver and request version. Approve works
// once; Reject needs a reason; a used, decided, expired or tampered link changes nothing. Decisions from
// email go through the same approval engine and are audited with channel "email".
import { expect, test } from '@playwright/test';
import { DecisionResponse, EmailActionPreview, RequestDetail } from '@bf/contracts';
import { expectContract, expectProblem } from '../support/contract';
import { asOwner } from '../support/db';
import {
  auditFor,
  directorTree,
  emailTokens,
  getRequest,
  spendingRequest,
  usd,
  waitForMail,
} from '../support/p5';

const preview = (request: import('@playwright/test').APIRequestContext, token: string) =>
  request.get(`/api/approvals/email-actions/${encodeURIComponent(token)}`);
const execute = (
  request: import('@playwright/test').APIRequestContext,
  data: Record<string, string>,
) => request.post('/api/approvals/email-actions', { data });

test.describe('actionable approval email links', () => {
  test('approve from email once; the second use and the sibling reject link change nothing', async ({
    request,
  }) => {
    const { team } = await directorTree(request);
    const r = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(200_000)),
      201,
      RequestDetail,
    );
    const mail = await waitForMail('department.head@example.test', r.ref);
    expect(mail.subject).toContain('Approve USD 2,000.00');
    expect(mail.text).toContain('These links work once and expire on');
    expect(mail.text).toContain('after approval');
    const tokens = emailTokens(mail);

    const p = await expectContract(await preview(request, tokens.approve), 200, EmailActionPreview);
    expect(p).toMatchObject({
      state: 'valid',
      action: 'approve',
      ref: r.ref,
      amount: usd(200_000),
      approverName: 'Lena Fischer',
    });

    const done = await expectContract(
      await execute(request, { token: tokens.approve }),
      200,
      DecisionResponse,
    );
    expect(done).toMatchObject({
      decision: 'approve',
      subjectStatus: 'approved',
      approvedAmount: usd(200_000),
    });
    await expectProblem(
      await execute(request, { token: tokens.approve }),
      409,
      'APPROVAL_LINK_USED',
    );
    expect(
      (await expectContract(await preview(request, tokens.approve), 200, EmailActionPreview)).state,
    ).toBe('used');
    expect(
      (await expectContract(await preview(request, tokens.reject), 200, EmailActionPreview)).state,
    ).toBe('decided');
    await expectProblem(
      await execute(request, { token: tokens.reject, reason: 'Too late' }),
      409,
      'APPROVAL_NOT_PENDING',
    );

    const audit = await auditFor(request, r.id);
    const approved = audit.filter((a) => a.action === 'request.approved');
    expect(approved).toHaveLength(1);
    expect(approved[0].changes['channel']?.to).toBe('email');
    expect((await getRequest(request, 'budget-owner', r.id)).route?.steps[0]).toMatchObject({
      status: 'approved',
      channel: 'email',
    });
    await waitForMail('budget.owner@example.test', `Your request ${r.ref} was approved`);
  });

  test('reject from email needs a reason; tampered and expired links are refused', async ({
    request,
  }) => {
    const { team } = await directorTree(request);
    const r = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(30_000)),
      201,
      RequestDetail,
    );
    const tokens = emailTokens(await waitForMail('department.head@example.test', r.ref));
    expect(
      (await expectContract(await preview(request, tokens.reject), 200, EmailActionPreview)).action,
    ).toBe('reject');
    await expectProblem(await execute(request, { token: tokens.reject }), 422, 'REASON_REQUIRED');
    const rejected = await expectContract(
      await execute(request, {
        token: tokens.reject,
        reasonCode: 'REJ-POLICY',
        reason: 'Team lunches come from the team budget.',
      }),
      200,
      DecisionResponse,
    );
    expect(rejected.subjectStatus).toBe('rejected');
    expect((await getRequest(request, 'budget-owner', r.id)).decisionReason).toBe(
      'Team lunches come from the team budget.',
    );

    const tampered = `${tokens.approve.slice(0, -2)}${tokens.approve.endsWith('AA') ? 'BB' : 'AA'}`;
    await expectProblem(await preview(request, tampered), 404, 'APPROVAL_LINK_INVALID');
    await expectProblem(await execute(request, { token: tampered }), 404, 'APPROVAL_LINK_INVALID');

    const r2 = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(40_000)),
      201,
      RequestDetail,
    );
    const t2 = emailTokens(await waitForMail('department.head@example.test', r2.ref));
    const tokenId = t2.approve.split('.')[2];
    await asOwner((c) =>
      c.query(
        `update approval_action_tokens set expires_at = now() - interval '1 minute' where id = $1`,
        [tokenId],
      ),
    );
    expect(
      (await expectContract(await preview(request, t2.approve), 200, EmailActionPreview)).state,
    ).toBe('expired');
    await expectProblem(
      await execute(request, { token: t2.approve }),
      410,
      'APPROVAL_LINK_EXPIRED',
    );
    expect((await getRequest(request, 'budget-owner', r2.id)).status).toBe('pending_approval');
  });
});
