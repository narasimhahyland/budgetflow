// Invariant 86: wallet money is ledger money. A claim pre-encumbers its programme budget, approval
// encumbers it and payment turns it into an actual, all in integer minor units with one audit entry
// each. The wallet allowance is a cap on top of the budget, never a way past the budget's controls.
import { expect, test } from '@playwright/test';
import {
  Wallet,
  WalletClaim,
  WalletOverview,
  WalletProgram,
  type BudgetDetail,
} from '@bf/contracts';
import { P13_IDS, userById } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { allocateOk, createChild, createRoot } from '../support/factory';
import { auditFor, buckets, reason, usd } from './support';

/** A programme funded by a budget this scenario owns, so no other scenario's balances move. */
async function programme(
  request: import('@playwright/test').APIRequestContext,
  opts: { fundingMinor: number; allowanceMinor: number; reviewer?: 'location-manager' },
): Promise<{ program: WalletProgram; funding: BudgetDetail }> {
  const root = await createRoot(request, { amountMinor: opts.fundingMinor * 2 });
  const funding = await createChild(request, root.id, { currency: 'USD' });
  await allocateOk(request, root.id, funding.id, usd(opts.fundingMinor));
  const program = await expectContract(
    await request.put('/api/wallets/programs', {
      headers: await mutate('org-admin'),
      data: {
        key: `wb_${randomUUID().replace(/-/g, '').slice(0, 10)}`,
        name: `Wellbeing ${randomUUID().slice(0, 6)}`,
        kind: 'wellbeing',
        fundingBudgetId: funding.id,
        yearlyAllowanceMinor: opts.allowanceMinor,
        categories: ['Gym and fitness', 'Wellbeing classes'],
        reviewerPersonId: userById(opts.reviewer ?? 'location-manager').personId!,
        reason: reason('setting up a wellbeing programme'),
      },
    }),
    200,
    WalletProgram,
  );
  return { program, funding };
}

async function myWallet(
  request: import('@playwright/test').APIRequestContext,
  programId: string,
  user: 'employee' | 'event-organizer' = 'employee',
): Promise<Wallet> {
  const body = await expectContract(
    await request.get('/api/wallets', { headers: await as(user) }),
    200,
    WalletOverview,
  );
  const wallet = body.wallets.find((w) => w.programId === programId);
  expect(wallet, 'the employee has a wallet for this programme').toBeTruthy();
  return wallet!;
}

async function claim(
  request: import('@playwright/test').APIRequestContext,
  walletId: string,
  amountMinor: number,
  opts: { as?: 'employee' | 'event-organizer'; category?: string; receipt?: boolean } = {},
) {
  return request.post('/api/wallets/claims', {
    headers: await mutate(opts.as ?? 'employee'),
    data: {
      walletId,
      category: opts.category ?? 'Gym and fitness',
      merchant: 'Fitness First Indiranagar',
      amountMinor,
      currency: 'USD',
      claimDate: new Date().toISOString().slice(0, 10),
      // A seeded receipt file stands in for the upload the employee does in the UI. It is read-only
      // reference data, so no scenario can consume or change it.
      ...(opts.receipt === false ? {} : { documentId: P13_IDS.receiptCafeMocha }),
    },
  });
}

test.describe('wallet claims move through the ledger like any other spend', () => {
  test('submit pre-encumbers, approve encumbers and payment becomes an actual', async ({
    request,
  }) => {
    const { program, funding } = await programme(request, {
      fundingMinor: 200_000,
      allowanceMinor: 30_000,
    });
    // The programme set-up itself moves nothing: an allowance is capacity, not a posting.
    const afterSetup = await buckets(request, funding.id);
    expect(afterSetup.preEncumbered).toBe(0);
    expect(afterSetup.encumbered).toBe(0);
    expect(afterSetup.actual).toBe(0);

    const wallet = await myWallet(request, program.id);
    const submitted = await expectContract(
      await claim(request, wallet.id, 12_000),
      201,
      WalletClaim,
    );
    expect(submitted.status).toBe('submitted');
    expect(submitted.commitmentId).toBeTruthy();
    expect(submitted.journalIds.length).toBeGreaterThan(0);
    expect((await buckets(request, funding.id)).preEncumbered).toBe(12_000);

    const approved = await expectContract(
      await request.post(`/api/wallets/claims/${submitted.id}/decision`, {
        headers: await mutate('location-manager'),
        data: { decision: 'approve', reason: reason('receipt and category check out') },
      }),
      201,
      WalletClaim,
    );
    expect(approved.status).toBe('approved');
    const afterApproval = await buckets(request, funding.id);
    expect(afterApproval.preEncumbered).toBe(0);
    expect(afterApproval.encumbered).toBe(12_000);

    const paid = await expectContract(
      await request.post(`/api/wallets/claims/${submitted.id}/pay`, {
        headers: await mutate('finance-admin'),
        data: { via: 'expense', reason: reason('paid with the November expense run') },
      }),
      201,
      WalletClaim,
    );
    expect(paid.status).toBe('paid');
    const afterPayment = await buckets(request, funding.id);
    expect(afterPayment.encumbered).toBe(0);
    expect(afterPayment.actual).toBe(12_000);

    // Exactly one audit entry per state change, and each one names the journals it posted.
    const entries = await auditFor(request, 'wallet_claim', submitted.id);
    expect(entries.map((e) => e.action).sort()).toEqual([
      'wallet_claim.approved',
      'wallet_claim.paid',
      'wallet_claim.submitted',
    ]);
  });

  test('a returned claim releases the pre-encumbrance in full', async ({ request }) => {
    const { program, funding } = await programme(request, {
      fundingMinor: 200_000,
      allowanceMinor: 30_000,
    });
    const wallet = await myWallet(request, program.id);
    const submitted = await expectContract(
      await claim(request, wallet.id, 9_000),
      201,
      WalletClaim,
    );
    expect((await buckets(request, funding.id)).preEncumbered).toBe(9_000);
    const returned = await expectContract(
      await request.post(`/api/wallets/claims/${submitted.id}/decision`, {
        headers: await mutate('location-manager'),
        data: { decision: 'return', reason: reason('the receipt is for a different person') },
      }),
      201,
      WalletClaim,
    );
    expect(returned.status).toBe('returned');
    const after = await buckets(request, funding.id);
    expect(after.preEncumbered).toBe(0);
    expect(after.encumbered).toBe(0);
    expect(after.actual).toBe(0);
    // The released allowance is available again, to the minor unit.
    expect((await myWallet(request, program.id)).balance.amountMinor).toBe(30_000);
  });

  test('a claim one minor unit over the wallet balance is refused and posts nothing', async ({
    request,
  }) => {
    const { program, funding } = await programme(request, {
      fundingMinor: 200_000,
      allowanceMinor: 30_000,
    });
    const wallet = await myWallet(request, program.id);
    const exact = await expectContract(await claim(request, wallet.id, 30_000), 201, WalletClaim);
    expect(exact.status).toBe('submitted');
    expect((await myWallet(request, program.id)).balance.amountMinor).toBe(0);

    const over = await claim(request, wallet.id, 1);
    await expectProblem(over, 422, 'WALLET_BALANCE_EXCEEDED');
    expect((await buckets(request, funding.id)).preEncumbered).toBe(30_000);
  });

  test('a claim that fits the wallet but not the budget is refused by the budget', async ({
    request,
  }) => {
    // The allowance is deliberately larger than the money behind it: the budget is the real limit,
    // so a wallet can never be a side channel that spends past it.
    const { program, funding } = await programme(request, {
      fundingMinor: 5_000,
      allowanceMinor: 50_000,
    });
    const wallet = await myWallet(request, program.id);
    expect(wallet.balance.amountMinor).toBe(50_000);
    const refused = await claim(request, wallet.id, 20_000);
    await expectProblem(refused, 409, 'INSUFFICIENT_AVAILABLE');
    const after = await buckets(request, funding.id);
    expect(after.preEncumbered).toBe(0);
    expect(after.actual).toBe(0);
  });

  test('a frozen programme budget refuses new claims by name and keeps submitted ones', async ({
    request,
  }) => {
    const { program, funding } = await programme(request, {
      fundingMinor: 200_000,
      allowanceMinor: 30_000,
    });
    const wallet = await myWallet(request, program.id);
    const inFlight = await expectContract(await claim(request, wallet.id, 8_000), 201, WalletClaim);

    await expectContract(
      await request.post(`/api/budgets/${funding.id}/freeze`, {
        headers: await mutate('finance-admin'),
        data: { reasonCode: 'cost_reduction', reason: reason('pausing the wellbeing programme') },
      }),
      200,
      (await import('@bf/contracts')).ControlResult,
    );

    await expectProblem(await claim(request, wallet.id, 5_000), 409, 'BUDGET_FROZEN');
    // The claim that was already in flight still completes: controls stop new activity, not work in
    // progress.
    const approved = await expectContract(
      await request.post(`/api/wallets/claims/${inFlight.id}/decision`, {
        headers: await mutate('location-manager'),
        data: { decision: 'approve', reason: reason('approved before the freeze took effect') },
      }),
      201,
      WalletClaim,
    );
    expect(approved.status).toBe('approved');
    expect((await buckets(request, funding.id)).encumbered).toBe(8_000);
  });

  test('a claim needs its receipt and an allowed category', async ({ request }) => {
    const { program } = await programme(request, {
      fundingMinor: 200_000,
      allowanceMinor: 30_000,
    });
    const wallet = await myWallet(request, program.id);
    await expectProblem(
      await claim(request, wallet.id, 5_000, { category: 'Conference tickets' }),
      422,
      'WALLET_CATEGORY_NOT_ALLOWED',
    );
    // Every programme requires a receipt, so a claim without one is refused rather than queued.
    await expectProblem(
      await claim(request, wallet.id, 5_000, { receipt: false }),
      422,
      'WALLET_RECEIPT_REQUIRED',
    );
  });

  test('nobody reviews their own claim, and an outsider sees none of them', async ({ request }) => {
    const { program } = await programme(request, {
      fundingMinor: 200_000,
      allowanceMinor: 30_000,
    });
    const wallet = await myWallet(request, program.id);
    const submitted = await expectContract(
      await claim(request, wallet.id, 6_000),
      201,
      WalletClaim,
    );
    await expectProblem(
      await request.post(`/api/wallets/claims/${submitted.id}/decision`, {
        headers: await mutate('employee'),
        data: { decision: 'approve', reason: reason('approving my own claim') },
      }),
      403,
      'FORBIDDEN',
    );
    const outsider = await request.get(`/api/wallets/claims?programId=${program.id}`, {
      headers: await as('event-organizer'),
    });
    const body = (await outsider.json()) as { items: { id: string }[] };
    expect(body.items.map((c) => c.id)).not.toContain(submitted.id);
  });

  test('an employee sees only their own wallets', async ({ request }) => {
    const { program } = await programme(request, {
      fundingMinor: 200_000,
      allowanceMinor: 30_000,
    });
    const body = await expectContract(
      await request.get('/api/wallets', { headers: await as('employee') }),
      200,
      WalletOverview,
    );
    const mine = userById('employee').personId;
    expect(body.wallets.every((w) => w.personId === mine)).toBe(true);
    expect(body.claims.every((c) => c.personId === mine)).toBe(true);
    expect(body.wallets.some((w) => w.programId === program.id)).toBe(true);
  });
});
