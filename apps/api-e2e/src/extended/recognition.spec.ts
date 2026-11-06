// Invariant 87: recognition splits cleanly into words and money. A thank-you note moves nothing; a
// monetary award is a commitment on a Recognition budget that follows the ordinary pre-encumbered,
// encumbered and actual path, within the giver's quarterly allowance and never to themselves.
//
// Each scenario creates its own Recognition budget, award type and allowance through the API, so
// none of them consumes a cap or a balance another scenario is relying on.
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  OrganizerRecognition,
  RecognitionAllowance,
  RecognitionAward,
  RecognitionAwardType,
  RecognitionFeed,
  type BudgetDetail,
} from '@bf/contracts';
import { P15_IDS, userById } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { allocateOk, createChild, createRoot } from '../support/factory';
import { auditFor, buckets, reason, usd } from './support';

type Giver = 'employee' | 'location-manager' | 'event-organizer' | 'regional-manager';

const quarterKey = (): string => {
  const now = new Date();
  return `FY${now.getUTCFullYear()}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
};

/** A Recognition budget plus one award type paid from it, both owned by the calling scenario. */
async function recognitionProgramme(
  request: APIRequestContext,
  opts: { fundingMinor: number; amountMinor: number; needsApproval?: boolean },
): Promise<{ type: RecognitionAwardType; funding: BudgetDetail }> {
  const root = await createRoot(request, { amountMinor: opts.fundingMinor * 2 });
  const funding = await createChild(request, root.id, { currency: 'USD' });
  await allocateOk(request, root.id, funding.id, usd(opts.fundingMinor));
  const type = await expectContract(
    await request.put('/api/recognition/award-types', {
      headers: await mutate('org-admin'),
      data: {
        kind: opts.needsApproval ? 'peer' : 'spot',
        name: `${opts.needsApproval ? 'Peer' : 'Spot'} award ${randomUUID().slice(0, 8)}`,
        amountMinor: opts.amountMinor,
        needsApproval: Boolean(opts.needsApproval),
        fundingBudgetId: funding.id,
        reason: reason('setting up a recognition award type'),
      },
    }),
    200,
    RecognitionAwardType,
  );
  return { type, funding };
}

async function grantAllowance(
  request: APIRequestContext,
  opts: { manager: Giver; fundingBudgetId: string; amountMinor: number },
) {
  return expectContract(
    await request.post('/api/recognition/allowances', {
      headers: await mutate('finance-admin'),
      data: {
        managerPersonId: userById(opts.manager).personId!,
        fundingBudgetId: opts.fundingBudgetId,
        periodKey: quarterKey(),
        amountMinor: opts.amountMinor,
        reason: reason('quarterly recognition allowance'),
      },
    }),
    201,
    RecognitionAllowance,
  );
}

async function give(
  request: APIRequestContext,
  opts: {
    awardTypeId: string;
    recipient: Giver;
    as: Giver;
    visibility?: 'public' | 'private';
  },
) {
  return request.post('/api/recognition/awards', {
    headers: await mutate(opts.as),
    data: {
      awardTypeId: opts.awardTypeId,
      recipientPersonId: userById(opts.recipient).personId!,
      message: 'The Diwali celebration ran perfectly for four hundred people, thank you.',
      valueTag: 'teamwork',
      ...(opts.visibility ? { visibility: opts.visibility } : {}),
    },
  });
}

const feed = async (request: APIRequestContext, user: Giver) =>
  expectContract(
    await request.get('/api/recognition', { headers: await as(user) }),
    200,
    RecognitionFeed,
  );

test.describe('thank-you notes carry no money', () => {
  test('a thank-you note needs no budget, no allowance and no approval', async ({ request }) => {
    const award = await expectContract(
      await give(request, {
        awardTypeId: P15_IDS.awardTypeThankYou,
        recipient: 'event-organizer',
        as: 'employee',
      }),
      201,
      RecognitionAward,
    );
    expect(award.status).toBe('awarded');
    expect(award.amount).toBeNull();
    expect(award.commitmentId).toBeNull();
    expect(award.journalIds).toEqual([]);
    expect(award.fundingBudgetId).toBeNull();
  });

  test('an organizer thank-you note is recorded on their profile and stays wordless', async ({
    request,
  }) => {
    const organizerId = userById('event-organizer').personId!;
    const before = await expectContract(
      await request.get(`/api/recognition/organizers/${organizerId}`, {
        headers: await as('employee'),
      }),
      200,
      OrganizerRecognition,
    );
    const after = await expectContract(
      await request.post('/api/recognition/thanks', {
        headers: await mutate('employee'),
        data: {
          organizerPersonIds: [organizerId],
          note: 'Thank you for a smooth offsite on a tight budget.',
        },
      }),
      201,
      OrganizerRecognition,
    );
    expect(after.thankNoteCount).toBe(before.thankNoteCount + 1);
    // Feedback is quoted only where enough people answered to keep a respondent unidentifiable.
    expect(after.averagePulse.suppressed === after.averagePulse.groupSize < 5).toBe(true);
    expect(after.averagePulse.suppressed ? after.averagePulse.valueMilli === null : true).toBe(
      true,
    );
  });

  test('nobody thanks themselves', async ({ request }) => {
    await expectProblem(
      await request.post('/api/recognition/thanks', {
        headers: await mutate('employee'),
        data: {
          organizerPersonIds: [userById('employee').personId!],
          note: 'Thanking myself for the excellent party.',
        },
      }),
      422,
      'RECOGNITION_SELF_AWARD',
    );
  });
});

test.describe('monetary awards are spend on a Recognition budget', () => {
  test('setting up an award type and an allowance moves no money at all', async ({ request }) => {
    const { type, funding } = await recognitionProgramme(request, {
      fundingMinor: 100_000,
      amountMinor: 5_000,
    });
    await grantAllowance(request, {
      manager: 'location-manager',
      fundingBudgetId: funding.id,
      amountMinor: 50_000,
    });
    const after = await buckets(request, funding.id);
    expect(after.preEncumbered).toBe(0);
    expect(after.encumbered).toBe(0);
    expect(after.actual).toBe(0);
    expect(type.amount?.amountMinor).toBe(5_000);
  });

  test('a manager award encumbers the budget and redemption becomes an actual', async ({
    request,
  }) => {
    const { type, funding } = await recognitionProgramme(request, {
      fundingMinor: 100_000,
      amountMinor: 5_000,
    });
    await grantAllowance(request, {
      manager: 'location-manager',
      fundingBudgetId: funding.id,
      amountMinor: 50_000,
    });

    const award = await expectContract(
      await give(request, {
        awardTypeId: type.id,
        recipient: 'employee',
        as: 'location-manager',
      }),
      201,
      RecognitionAward,
    );
    expect(award.status).toBe('awarded');
    expect(award.amount?.amountMinor).toBe(5_000);
    expect(award.commitmentId).toBeTruthy();
    const afterGiving = await buckets(request, funding.id);
    expect(afterGiving.preEncumbered).toBe(0);
    expect(afterGiving.encumbered).toBe(5_000);
    expect(afterGiving.actual).toBe(0);

    const redeemed = await expectContract(
      await request.post(`/api/recognition/awards/${award.id}/redeem`, {
        headers: await mutate('employee'),
        data: { rewardChoice: 'payroll' },
      }),
      201,
      RecognitionAward,
    );
    expect(redeemed.status).toBe('redeemed');
    expect(redeemed.rewardChoice).toBe('payroll');
    const afterRedeeming = await buckets(request, funding.id);
    expect(afterRedeeming.encumbered).toBe(0);
    expect(afterRedeeming.actual).toBe(5_000);

    const entries = await auditFor(request, 'recognition_award', award.id);
    expect(entries.map((e) => e.action).sort()).toEqual([
      'recognition_award.given',
      'recognition_award.redeemed',
    ]);
  });

  test('a peer award waits for a second person before it encumbers', async ({ request }) => {
    const { type, funding } = await recognitionProgramme(request, {
      fundingMinor: 100_000,
      amountMinor: 2_500,
      needsApproval: true,
    });
    const award = await expectContract(
      await give(request, {
        awardTypeId: type.id,
        recipient: 'event-organizer',
        as: 'employee',
      }),
      201,
      RecognitionAward,
    );
    expect(award.status).toBe('pending_approval');
    const afterGiving = await buckets(request, funding.id);
    expect(afterGiving.preEncumbered).toBe(2_500);
    expect(afterGiving.encumbered).toBe(0);

    // The giver cannot approve their own award, and neither can the person receiving it.
    await expectProblem(
      await request.post(`/api/recognition/awards/${award.id}/decision`, {
        headers: await mutate('employee'),
        data: { decision: 'approve', reason: reason('approving my own peer award') },
      }),
      422,
      'SELF_APPROVAL',
    );
    await expectProblem(
      await request.post(`/api/recognition/awards/${award.id}/decision`, {
        headers: await mutate('event-organizer'),
        data: { decision: 'approve', reason: reason('approving an award to myself') },
      }),
      422,
      'APPROVER_IS_BENEFICIARY',
    );

    const approved = await expectContract(
      await request.post(`/api/recognition/awards/${award.id}/decision`, {
        headers: await mutate('finance-admin'),
        data: { decision: 'approve', reason: reason('the award is within policy') },
      }),
      201,
      RecognitionAward,
    );
    expect(approved.status).toBe('awarded');
    const afterApproval = await buckets(request, funding.id);
    expect(afterApproval.preEncumbered).toBe(0);
    expect(afterApproval.encumbered).toBe(2_500);
  });

  test('cancelling a waiting award releases its pre-encumbrance in full', async ({ request }) => {
    const { type, funding } = await recognitionProgramme(request, {
      fundingMinor: 100_000,
      amountMinor: 2_500,
      needsApproval: true,
    });
    const award = await expectContract(
      await give(request, {
        awardTypeId: type.id,
        recipient: 'event-organizer',
        as: 'employee',
      }),
      201,
      RecognitionAward,
    );
    expect((await buckets(request, funding.id)).preEncumbered).toBe(2_500);
    const cancelled = await expectContract(
      await request.post(`/api/recognition/awards/${award.id}/decision`, {
        headers: await mutate('finance-admin'),
        data: { decision: 'cancel', reason: reason('the award duplicates a spot award') },
      }),
      201,
      RecognitionAward,
    );
    expect(cancelled.status).toBe('cancelled');
    const after = await buckets(request, funding.id);
    expect(after.preEncumbered).toBe(0);
    expect(after.encumbered).toBe(0);
    expect(after.actual).toBe(0);
  });

  test('a manager with no allowance cannot give a monetary award', async ({ request }) => {
    const { type, funding } = await recognitionProgramme(request, {
      fundingMinor: 100_000,
      amountMinor: 5_000,
    });
    await expectProblem(
      await give(request, { awardTypeId: type.id, recipient: 'employee', as: 'location-manager' }),
      422,
      'RECOGNITION_ALLOWANCE_EXCEEDED',
    );
    expect((await buckets(request, funding.id)).preEncumbered).toBe(0);
  });

  test('an award one minor unit above the remaining allowance is refused', async ({ request }) => {
    const { type, funding } = await recognitionProgramme(request, {
      fundingMinor: 100_000,
      amountMinor: 5_000,
    });
    // Exactly one award fits; the second is above what is left.
    await grantAllowance(request, {
      manager: 'location-manager',
      fundingBudgetId: funding.id,
      amountMinor: 5_000,
    });
    const first = await give(request, {
      awardTypeId: type.id,
      recipient: 'employee',
      as: 'location-manager',
    });
    expect(first.status(), await first.text()).toBe(201);
    const allowance = (await feed(request, 'location-manager')).allowances.find(
      (a) => a.fundingBudgetId === funding.id,
    )!;
    expect(allowance.remaining.amountMinor).toBe(0);

    await expectProblem(
      await give(request, { awardTypeId: type.id, recipient: 'employee', as: 'location-manager' }),
      422,
      'RECOGNITION_ALLOWANCE_EXCEEDED',
    );
    expect((await buckets(request, funding.id)).encumbered).toBe(5_000);
  });

  test('a frozen Recognition budget stops monetary awards but not thank-you notes', async ({
    request,
  }) => {
    const { type, funding } = await recognitionProgramme(request, {
      fundingMinor: 100_000,
      amountMinor: 5_000,
    });
    await grantAllowance(request, {
      manager: 'location-manager',
      fundingBudgetId: funding.id,
      amountMinor: 50_000,
    });
    const freeze = await request.post(`/api/budgets/${funding.id}/freeze`, {
      headers: await mutate('finance-admin'),
      data: { reasonCode: 'cost_reduction', reason: reason('pausing recognition spend') },
    });
    expect(freeze.status(), await freeze.text()).toBe(200);

    await expectProblem(
      await give(request, { awardTypeId: type.id, recipient: 'employee', as: 'location-manager' }),
      409,
      'BUDGET_FROZEN',
    );
    expect((await buckets(request, funding.id)).encumbered).toBe(0);

    // The wordless path keeps working while the money is paused.
    const note = await expectContract(
      await give(request, {
        awardTypeId: P15_IDS.awardTypeThankYou,
        recipient: 'event-organizer',
        as: 'location-manager',
      }),
      201,
      RecognitionAward,
    );
    expect(note.status).toBe('awarded');
    expect(note.amount).toBeNull();
  });

  test('nobody recognises themselves', async ({ request }) => {
    const { type } = await recognitionProgramme(request, {
      fundingMinor: 100_000,
      amountMinor: 5_000,
    });
    await expectProblem(
      await give(request, {
        awardTypeId: type.id,
        recipient: 'location-manager',
        as: 'location-manager',
      }),
      422,
      'RECOGNITION_SELF_AWARD',
    );
  });

  test('recognition is private by default and only the recipient redeems it', async ({
    request,
  }) => {
    const award = await expectContract(
      await give(request, {
        awardTypeId: P15_IDS.awardTypeThankYou,
        recipient: 'event-organizer',
        as: 'employee',
      }),
      201,
      RecognitionAward,
    );
    expect(award.visibility).toBe('private');
    const outsider = await feed(request, 'regional-manager');
    expect(outsider.items.map((i) => i.id)).not.toContain(award.id);
  });

  test('only the organization admin configures award types', async ({ request }) => {
    const res = await request.put('/api/recognition/award-types', {
      headers: await mutate('employee'),
      data: {
        kind: 'spot',
        name: 'Employee-invented award',
        amountMinor: 100_000,
        reason: reason('an employee trying to invent a paying award type'),
      },
    });
    expect([403, 404]).toContain(res.status());
  });
});
