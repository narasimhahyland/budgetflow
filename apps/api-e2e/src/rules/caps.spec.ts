// Gap A2: the employee annual benefit cap and the annual gift cap are enforced on submission and on
// approval through the rules engine (R-31 blocks above the employee cap, R-32 warns from 80% of it,
// R-33 blocks above the annual gift cap). Usage comes from the ledger: a request's live consumption
// (pre-encumbered + encumbered + actual), split evenly between its recipients and non-employees.
// Every scenario names freshly created recipients, so no other scenario's spend counts against them.
import { expect, test, type APIRequestContext } from '@playwright/test';
import { PolicyConfigsBundle, RequestDetail, RequestList } from '@bf/contracts';
import { TENANTS } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract } from '../support/contract';
import { asAppRole, asOwner } from '../support/db';
import {
  decideTask,
  directorTree,
  ENTITIES,
  getRequest,
  spendingRequest,
  taskOf,
  usd,
} from '../support/p5';

const CAP = 30_000; // USD 300.00, the shipped employee annual cap (screen 071)
const GIFT_CAP = 15_000; // USD 150.00, the shipped annual gift cap (screen 073)

/** A fictional employee in the Hyland tenant, standing in for an HR feed (no API creates people). */
async function freshEmployee(label: string): Promise<{ id: string; name: string }> {
  const id = randomUUID();
  const name = `Cap ${label} ${id.slice(0, 6)}`;
  await asAppRole(
    TENANTS.acme,
    (c) =>
      c.query(
        `insert into people (id, tenant_id, display_name, email, employing_entity_id) values ($1, $2, $3, $4, $5)`,
        [id, TENANTS.acme, name, `cap-${id.slice(0, 8)}@example.test`, ENTITIES.us],
      ),
    { commit: true },
  );
  return { id, name };
}

async function teamBudget(request: APIRequestContext) {
  return (await directorTree(request, { teamMinor: 5_000_000 })).team;
}

interface Ask {
  amountMinor: number;
  recipients: string[];
  spendType?: string;
  nonEmployeeCount?: number;
}

function ask(request: APIRequestContext, budgetId: string, a: Ask, title?: string) {
  return spendingRequest(request, 'budget-owner', budgetId, usd(a.amountMinor), {
    spendType: a.spendType ?? 'team_lunch',
    benefitRecipientIds: a.recipients,
    ...(a.nonEmployeeCount ? { nonEmployeeCount: a.nonEmployeeCount } : {}),
    ...(title ? { title } : {}),
  });
}

const fact = (d: RequestDetail, label: string) =>
  d.policyCheck?.facts.find((f) => f.label === label)?.value;

test.describe('employee annual benefit cap', () => {
  // Table: [what, prior spend for the recipient, the request, expected outcome, decisive rule].
  const cases: {
    name: string;
    prior: number[];
    amountMinor: number;
    outcome: 'warn' | 'block' | 'pass';
    left: string;
  }[] = [
    {
      name: 'exactly at the cap in one request',
      prior: [],
      amountMinor: CAP,
      outcome: 'warn',
      left: 'USD 0.00',
    },
    {
      name: 'one minor unit above the cap',
      prior: [],
      amountMinor: CAP + 1,
      outcome: 'block',
      left: '',
    },
    {
      name: 'reaching the cap across requests',
      prior: [20_000],
      amountMinor: 10_000,
      outcome: 'warn',
      left: 'USD 0.00',
    },
    {
      name: 'one unit past the cap across requests',
      prior: [20_000, 10_000],
      amountMinor: 1,
      outcome: 'block',
      left: '',
    },
    {
      name: 'below the warning threshold',
      prior: [],
      amountMinor: 23_999,
      outcome: 'pass',
      left: 'USD 60.01',
    },
    {
      name: 'exactly at the warning threshold (80%)',
      prior: [],
      amountMinor: 24_000,
      outcome: 'warn',
      left: 'USD 60.00',
    },
  ];

  for (const c of cases) {
    test(c.name, async ({ request }) => {
      const team = await teamBudget(request);
      const person = await freshEmployee('emp');
      for (const p of c.prior) {
        await expectContract(
          await ask(request, team.id, { amountMinor: p, recipients: [person.id] }),
          201,
          RequestDetail,
        );
      }
      const title = `Cap check ${randomUUID().slice(0, 8)}`;
      const res = await ask(
        request,
        team.id,
        { amountMinor: c.amountMinor, recipients: [person.id] },
        title,
      );

      if (c.outcome === 'block') {
        expect(res.status()).toBe(409);
        const problem = await res.json();
        expect(problem.code).toBe('POLICY_BLOCKED');
        expect(problem.params).toMatchObject({
          stage: 'submit',
          ruleCode: 'R-31',
          ruleVersion: 1,
          employeeCapRemainingMinor: -1,
          employeeYtdBenefitMinor: CAP + 1,
          capPersonId: person.id,
        });
        expect(problem.detail).toContain('annual employee benefit cap');
        // A refused command leaves nothing behind: no request, no audit entry, no ledger line.
        const mine = await expectContract(
          await request.get(`/api/requests?q=${encodeURIComponent(title)}`, {
            headers: await as('budget-owner'),
          }),
          200,
          RequestList,
        );
        expect(mine.items).toHaveLength(0);
        return;
      }

      const d = await expectContract(res, 201, RequestDetail);
      expect(d.status).toBe('pending_approval');
      expect(d.benefitRecipients).toEqual([{ personId: person.id, displayName: person.name }]);
      const check = d.policyCheck!;
      expect(check.stage).toBe('submit');
      expect(check.capPersonName).toBe(person.name);
      expect(fact(d, 'Employee annual cap left')).toBe(c.left);
      const r32 = check.matches.find((m) => m.ruleCode === 'R-32');
      if (c.outcome === 'warn') {
        expect(check.effect).toBe('warn');
        expect(r32, 'R-32 warns from 80% of the cap').toMatchObject({
          version: 1,
          effect: 'warn',
          decisive: true,
        });
        expect(check.explanation).toBe(r32!.explanation);
        expect(check.outcomeLabel).toBe('Allowed with a warning');
      } else {
        expect(r32, 'below 80% R-32 does not match').toBeUndefined();
      }
      expect(check.matches.some((m) => m.ruleCode === 'R-31')).toBe(false);
    });
  }

  test('the amount is split between recipients and non-employees', async ({ request }) => {
    const team = await teamBudget(request);
    const [a, b, c] = [
      await freshEmployee('a'),
      await freshEmployee('b'),
      await freshEmployee('c'),
    ];
    // Two employees at exactly the cap each: allowed.
    await expectContract(
      await ask(request, team.id, { amountMinor: 2 * CAP, recipients: [a.id, b.id] }),
      201,
      RequestDetail,
    );
    // One employee and one guest: the guest's half counts for nobody, so 2 × cap + 2 puts the employee one unit over.
    const res = await ask(request, team.id, {
      amountMinor: 2 * CAP + 2,
      recipients: [c.id],
      nonEmployeeCount: 1,
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).params).toMatchObject({
      ruleCode: 'R-31',
      employeeYtdBenefitMinor: CAP + 1,
    });
    const ok = await expectContract(
      await ask(request, team.id, {
        amountMinor: 2 * CAP,
        recipients: [c.id],
        nonEmployeeCount: 1,
      }),
      201,
      RequestDetail,
    );
    expect(fact(ok, 'People outside the company')).toBe('1');
    expect(fact(ok, 'Employee benefit this year')).toBe('USD 300.00');
  });

  test('concurrent requests for one recipient cannot jointly pass the cap', async ({ request }) => {
    const [one, two] = [await teamBudget(request), await teamBudget(request)];
    const p = await freshEmployee('race');
    // Tokens first (one at a time), then both submissions in flight together.
    const headers = [await mutate('budget-owner'), await mutate('budget-owner')];
    const results = await Promise.all(
      [one, two].map((b, i) =>
        request.post('/api/requests', {
          headers: headers[i],
          data: {
            kind: 'spending',
            budgetId: b.id,
            amount: usd(CAP),
            spendType: 'team_lunch',
            title: `Cap race ${i + 1}`,
            purpose: 'Two submissions for one recipient at the same time',
            benefitRecipientIds: [p.id],
          },
        }),
      ),
    );
    expect(results.map((r) => r.status()).sort()).toEqual([201, 409]);
  });

  test('withdrawing a request gives its share of the cap back (usage is read from the ledger)', async ({
    request,
  }) => {
    const team = await teamBudget(request);
    const p = await freshEmployee('withdraw');
    const first = await expectContract(
      await ask(request, team.id, { amountMinor: CAP, recipients: [p.id] }),
      201,
      RequestDetail,
    );
    expect((await ask(request, team.id, { amountMinor: 1, recipients: [p.id] })).status()).toBe(
      409,
    );
    await expectContract(
      await request.post(`/api/requests/${first.id}/withdraw`, {
        headers: await mutate('budget-owner'),
        data: {},
      }),
      200,
      RequestDetail,
    );
    const again = await expectContract(
      await ask(request, team.id, { amountMinor: CAP, recipients: [p.id] }),
      201,
      RequestDetail,
    );
    expect(fact(again, 'Employee annual cap left')).toBe('USD 0.00');
  });

  test('spend outside the cap categories is not counted', async ({ request }) => {
    const team = await teamBudget(request);
    const p = await freshEmployee('travel');
    const d = await expectContract(
      await ask(request, team.id, {
        amountMinor: 3 * CAP,
        recipients: [p.id],
        spendType: 'travel',
      }),
      201,
      RequestDetail,
    );
    expect(d.policyCheck!.matches.map((m) => m.ruleCode)).not.toContain('R-31');
    expect(fact(d, 'Employee benefit this year')).toBeUndefined();
    await expectContract(
      await ask(request, team.id, { amountMinor: CAP, recipients: [p.id] }),
      201,
      RequestDetail,
    );
  });

  test('approval re-checks the cap on the approved amount', async ({ request }) => {
    const team = await teamBudget(request);
    const p = await freshEmployee('approval');
    const r = await expectContract(
      await ask(request, team.id, { amountMinor: 25_000, recipients: [p.id] }),
      201,
      RequestDetail,
    );
    const policies = async () =>
      expectContract(
        await request.get('/api/rules/policies', { headers: await as('finance-admin') }),
        200,
        PolicyConfigsBundle,
      );
    const original = (await policies()).spendingLimits.employeeCap;
    const saveCap = async (annualCapUsdMinor: number) =>
      request.put('/api/rules/policies', {
        headers: await mutate('finance-admin'),
        data: {
          section: 'employee_cap',
          payload: { employeeCap: { ...original, annualCapUsdMinor } },
          reason: 'A2 scenario: cap lowered between submission and approval',
        },
      });
    const task = await taskOf(request, 'department-head', 'request', r.id);
    try {
      expect((await saveCap(20_000)).status()).toBe(200);
      const refused = await decideTask(request, 'department-head', task, { decision: 'approve' });
      expect(refused.status()).toBe(409);
      expect(await refused.json()).toMatchObject({
        code: 'POLICY_BLOCKED',
        params: { stage: 'approve', ruleCode: 'R-31', employeeCapRemainingMinor: -5_000 },
      });
      expect((await getRequest(request, 'budget-owner', r.id)).status).toBe('pending_approval');
    } finally {
      expect((await saveCap(original.annualCapUsdMinor)).status()).toBe(200);
    }
    expect(
      (await decideTask(request, 'department-head', task, { decision: 'approve' })).status(),
    ).toBe(200);
    const approved = await getRequest(request, 'budget-owner', r.id);
    expect(approved.status).toBe('approved');
    expect(approved.policyCheck).toMatchObject({ stage: 'approve', effect: 'warn' });
    // Each decision is recorded with its rule versions and fact values.
    const runs = await asOwner((c) =>
      c.query<{
        effect: string;
        stage: string;
        left: string;
        rules: { ruleCode: string; version: number }[];
      }>(
        `select effect, facts->>'stage' as stage, facts->>'employee_cap_remaining_minor' as left, matched_rules as rules
         from rule_executions where subject_type = 'request' and subject_id = $1 order by created_at, id`,
        [r.id],
      ),
    );
    expect(runs.rows.map((x) => [x.stage, x.effect, Number(x.left)])).toEqual([
      ['submit', 'warn', 5_000],
      ['approve', 'warn', 5_000],
    ]);
    expect(runs.rows[0].rules).toEqual(
      expect.arrayContaining([expect.objectContaining({ ruleCode: 'R-32', version: 1 })]),
    );
  });
});

test.describe('caps on the other ways money is approved', () => {
  test('accepting a counter-offer is checked against the cap like an approval', async ({
    request,
  }) => {
    const team = await teamBudget(request);
    const p = await freshEmployee('offer');
    const r = await expectContract(
      await ask(request, team.id, { amountMinor: 25_000, recipients: [p.id] }),
      201,
      RequestDetail,
    );
    const task = await taskOf(request, 'department-head', 'request', r.id);
    expect(
      (
        await decideTask(request, 'department-head', task, {
          decision: 'request_changes',
          comment: 'Smaller lunch, please.',
          counterOfferAmount: usd(20_000),
        })
      ).status(),
    ).toBe(200);
    // Sending it back released its pre-encumbrance, so another lunch for the same person fits now.
    await expectContract(
      await ask(request, team.id, { amountMinor: 15_000, recipients: [p.id] }),
      201,
      RequestDetail,
    );
    const accept = await request.post(`/api/requests/${r.id}/accept-offer`, {
      headers: await mutate('budget-owner'),
      data: {},
    });
    expect(accept.status()).toBe(409);
    expect(await accept.json()).toMatchObject({
      code: 'POLICY_BLOCKED',
      params: { stage: 'approve', ruleCode: 'R-31', employeeCapRemainingMinor: -5_000 },
    });
    expect((await getRequest(request, 'budget-owner', r.id)).status).toBe('changes_requested');
  });

  test('event funding cannot name benefit recipients', async ({ request }) => {
    const team = await teamBudget(request);
    const p = await freshEmployee('event');
    const res = await spendingRequest(request, 'budget-owner', team.id, usd(10_000), {
      kind: 'additional_fund',
      eventId: randomUUID(),
      benefitRecipientIds: [p.id],
    });
    expect(res.status()).toBe(422);
    expect((await res.json()).params).toMatchObject({ field: 'benefitRecipientIds' });
  });
});

test.describe('annual gift cap', () => {
  const cases = [
    {
      name: 'exactly at the annual gift cap',
      prior: [] as number[],
      amountMinor: GIFT_CAP,
      blocked: false,
    },
    {
      name: 'one minor unit above the annual gift cap',
      prior: [] as number[],
      amountMinor: GIFT_CAP + 1,
      blocked: true,
    },
    {
      name: 'the annual gift cap across gifts',
      prior: [7_500, 7_500],
      amountMinor: 1,
      blocked: true,
    },
  ];
  for (const c of cases) {
    test(c.name, async ({ request }) => {
      const team = await teamBudget(request);
      const p = await freshEmployee('gift');
      for (const prior of c.prior) {
        await expectContract(
          await ask(request, team.id, {
            amountMinor: prior,
            recipients: [p.id],
            spendType: 'gifts',
          }),
          201,
          RequestDetail,
        );
      }
      const res = await ask(request, team.id, {
        amountMinor: c.amountMinor,
        recipients: [p.id],
        spendType: 'gifts',
      });
      if (c.blocked) {
        expect(res.status()).toBe(409);
        const problem = await res.json();
        expect(problem).toMatchObject({
          code: 'POLICY_BLOCKED',
          params: {
            ruleCode: 'R-33',
            ruleVersion: 1,
            giftAnnualCapRemainingMinor: -1,
            capPersonId: p.id,
          },
        });
        expect(problem.detail).toContain('annual gift cap');
        return;
      }
      const d = await expectContract(res, 201, RequestDetail);
      expect(fact(d, 'Annual gift cap left')).toBe('USD 0.00');
      expect(fact(d, 'Gift value per recipient')).toBe('USD 150.00');
      // The per-recipient gift rule still applies alongside the annual cap.
      expect(d.policyCheck!.matches.map((m) => m.ruleCode)).toContain('R-24');
      expect(d.policyCheck!.matches.map((m) => m.ruleCode)).not.toContain('R-33');
    });
  }
});

test('requests outside the caps carry the requester total and intercompany facts', async ({
  request,
}) => {
  const { team } = await directorTree(request, { teamEntity: ENTITIES.india });
  const p = await freshEmployee('ic');
  const d = await expectContract(
    await spendingRequest(request, 'budget-owner', team.id, usd(12_345), {
      spendType: 'team_lunch',
      benefitRecipientIds: [p.id],
      alcoholAmount: usd(2_000),
    }),
    201,
    RequestDetail,
  );
  expect(fact(d, 'Crosses legal entities')).toBe('yes');
  expect(fact(d, 'Alcohol amount')).toBe('USD 20.00');
  expect(d.alcoholAmount).toEqual(usd(2_000));
  const recent = Number(
    (
      await asOwner((c) =>
        c.query(
          `select facts->>'requester_recent_total_minor' as v from rule_executions where subject_id = $1`,
          [d.id],
        ),
      )
    ).rows[0].v,
  );
  expect(recent, 'the recent total includes this request').toBeGreaterThanOrEqual(12_345);

  const bad = await spendingRequest(request, 'budget-owner', team.id, usd(100), {
    benefitRecipientIds: [randomUUID()],
  });
  expect(bad.status()).toBe(422);
  expect((await bad.json()).params).toMatchObject({ field: 'benefitRecipientIds' });
});
