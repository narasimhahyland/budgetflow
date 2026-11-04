// Phase 6 scenario support. Commitments, events and earmarks are created by Phase 5; until its API is
// merged, these fixtures post them with the libs/domain posting builders (balanced journals, cached
// balances, open periods) as the owner role in one transaction. Actuals themselves always go through
// the actuals API.
import { expect, type APIRequestContext } from '@playwright/test';
import {
  ActualDetail,
  ActualList,
  CommitmentHygieneList,
  ImportBatch,
  type BudgetDetail,
} from '@bf/contracts';
import {
  postCommitmentMovement,
  resolvePostingPeriod,
  type BucketBalances,
  type CommitmentPosting,
  type ConsumingBucket,
  type CurrencyCode,
  type FxRate,
  type JournalDraft,
  type PeriodRef,
} from '@bf/domain';
import { SEED, userById, type SeedUserId } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { as, mutate } from '../support/auth';
import { expectContract } from '../support/contract';
import { asOwner } from '../support/db';
import { allocateOk, createChild, createRoot } from '../support/factory';

export const ACME = SEED.tenants.acme;
export const INDIA = SEED.legalEntities.acmeIndia;
export const US = SEED.legalEntities.acmeUs;
export const CC = SEED.costCenters;
export const uniq = () => randomUUID().slice(0, 8).toUpperCase();

/** A USD budget in the India (or another) entity with money to spend, owned by `owner`. */
export async function spendBudget(
  request: APIRequestContext,
  opts: { amountMinor?: number; legalEntityId?: string; owner?: SeedUserId } = {},
): Promise<BudgetDetail> {
  const root = await createRoot(request, { amountMinor: (opts.amountMinor ?? 5_000_000) * 2 });
  const child = await createChild(request, root.id, {
    currency: 'USD',
    legalEntityId: opts.legalEntityId ?? INDIA,
    owner: opts.owner,
  });
  await allocateOk(request, root.id, child.id, {
    amountMinor: opts.amountMinor ?? 5_000_000,
    currency: 'USD',
  });
  return child;
}

async function inTx<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  return asOwner(async (c) => {
    await c.query('begin');
    try {
      await c.query(`select set_config('app.tenant_id', $1, true)`, [ACME]);
      const out = await fn(c);
      await c.query('commit');
      return out;
    } catch (e) {
      await c.query('rollback').catch(() => undefined);
      throw e;
    }
  });
}

const NORMAL: Record<string, 1 | -1> = {
  authorized: -1,
  allocated_out: 1,
  held: 1,
  pre_encumbered: 1,
  encumbered: 1,
  actual: 1,
  accrued: 1,
};

async function postDraft(c: Client, draft: JournalDraft, idemKey: string): Promise<string> {
  const journalId = randomUUID();
  const periods = new Map<string, { id: string; late: boolean; original: string | null }>();
  for (const le of new Set(draft.lines.map((l) => l.legalEntityId))) {
    const rows = (
      await c.query(
        `select p.id, p.start_date::text as "startDate", p.end_date::text as "endDate", p.status
           from fiscal_periods p join legal_entities e on e.fiscal_calendar_id = p.fiscal_calendar_id where e.id = $1`,
        [le],
      )
    ).rows as PeriodRef[];
    const r = resolvePostingPeriod(rows, draft.accountingDate, { allowSoftClosed: false });
    if (!r.ok) throw new Error(r.error.message);
    periods.set(le, {
      id: r.value.period.id,
      late: r.value.late,
      original: r.value.originalPeriodId ?? null,
    });
  }
  const head = periods.get(draft.lines[0].legalEntityId)!;
  await c.query(
    `insert into ledger_journals (id, tenant_id, journal_type, transaction_currency, reporting_currency, accounting_date,
       fiscal_period_id, late, original_period_id, command, idempotency_key)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'test.fixture',$10)`,
    [
      journalId,
      ACME,
      draft.type,
      draft.transactionCurrency,
      draft.reportingCurrency,
      draft.accountingDate,
      head.id,
      head.late,
      head.original,
      idemKey,
    ],
  );
  for (const [i, l] of draft.lines.entries()) {
    const p = periods.get(l.legalEntityId)!;
    await c.query(
      `insert into ledger_lines (tenant_id, journal_id, line_no, budget_id, account, legal_entity_id, cost_center_id, gl_account_id,
         event_code, fiscal_period_id, accounting_date, late, transaction_currency, transaction_amount_minor, budget_currency,
         budget_amount_minor, reporting_currency, reporting_amount_minor, budget_rate_type, budget_rate, budget_rate_ids,
         reporting_rate_type, reporting_rate, reporting_rate_ids, commitment_id, event_id, contribution_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
      [
        ACME,
        journalId,
        i + 1,
        l.budgetId,
        l.account,
        l.legalEntityId,
        l.costCenterId ?? null,
        l.glAccountId ?? null,
        l.eventCode ?? null,
        p.id,
        draft.accountingDate,
        p.late,
        l.transaction.currency,
        l.transaction.amountMinor,
        l.budget?.currency ?? null,
        l.budget?.amountMinor ?? null,
        l.reporting.currency,
        l.reporting.amountMinor,
        l.budgetRate?.type ?? null,
        l.budgetRate?.value ?? null,
        l.budgetRate?.rateIds ?? null,
        l.reportingRate.type,
        l.reportingRate.value,
        l.reportingRate.rateIds,
        l.commitmentId ?? null,
        l.eventId ?? null,
        l.contributionId ?? null,
      ],
    );
    if (l.budgetId && l.budget) {
      await c.query(
        `insert into ledger_balances (tenant_id, budget_id, fiscal_period_id, bucket, budget_amount_minor, reporting_amount_minor, line_count)
         values ($1,$2,$3,$4,$5,$6,1)
         on conflict (budget_id, fiscal_period_id, bucket) do update set
           budget_amount_minor = ledger_balances.budget_amount_minor + excluded.budget_amount_minor,
           reporting_amount_minor = ledger_balances.reporting_amount_minor + excluded.reporting_amount_minor,
           line_count = ledger_balances.line_count + 1, updated_at = now()`,
        [ACME, l.budgetId, p.id, l.account, l.budget.amountMinor, l.reporting.amountMinor],
      );
    }
  }
  return journalId;
}

async function postingBudget(c: Client, budgetId: string) {
  const b = (await c.query(`select * from budgets where id = $1`, [budgetId])).rows[0];
  const rates: FxRate[] = (
    await c.query(
      `select id, base_currency, quote_currency, rate::text as rate from exchange_rates where rate_type = 'plan' and locked and fiscal_year_id = $1`,
      [b.fiscal_year_id],
    )
  ).rows.map((r) => ({
    id: r.id,
    type: 'plan' as const,
    base: r.base_currency,
    quote: r.quote_currency,
    value: r.rate,
  }));
  const balRows = (
    await c.query(
      `select bucket, sum(budget_amount_minor)::text as v from ledger_balances where budget_id = $1 group by bucket`,
      [budgetId],
    )
  ).rows;
  const balances = {
    authorized: 0,
    allocated_out: 0,
    held: 0,
    pre_encumbered: 0,
    encumbered: 0,
    actual: 0,
    accrued: 0,
  } as BucketBalances;
  for (const r of balRows)
    if (r.bucket in balances)
      balances[r.bucket as keyof BucketBalances] = NORMAL[r.bucket] * Number(r.v);
  return {
    ref: {
      id: b.id as string,
      currency: b.currency as CurrencyCode,
      legalEntityId: b.legal_entity_id as string,
      costCenterId: (b.cost_center_id as string | null) ?? null,
      balances,
      control: {
        // Enum arrays come back from pg as '{a,b}' text.
        basis: String(b.control_basis)
          .replace(/[{}]/g, '')
          .split(',')
          .filter((x) => x && x !== 'accrued') as ConsumingBucket[],
        mode: b.control_mode,
        toleranceBps: b.tolerance_bps,
      },
    },
    rates,
  };
}

async function move(
  c: Client,
  budgetId: string,
  kind: CommitmentPosting,
  amount: { amountMinor: number; currency: string },
  prov: Record<string, string | null>,
  date: string,
) {
  const { ref, rates } = await postingBudget(c, budgetId);
  const r = postCommitmentMovement(
    {
      kind,
      budget: ref,
      amount: { amountMinor: amount.amountMinor, currency: amount.currency as CurrencyCode },
      provenance: prov,
    },
    { reportingCurrency: 'USD', rates, accountingDate: date },
  );
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return postDraft(c, r.value, `test:${kind}:${randomUUID()}`);
}

export interface TestCommitment {
  id: string;
  reference: string;
  budgetId: string;
}

/** An encumbered commitment (pre-encumbered then approved), like Phase 5 creates on approval. */
export async function createCommitment(opts: {
  budgetId: string;
  amountMinor: number;
  currency?: string;
  eventId?: string | null;
  costCenterId?: string | null;
  vendorId?: string | null;
  glAccountId?: string | null;
  description?: string;
  serviceStart?: string;
  serviceEnd?: string;
  nonRefundableDepositMinor?: number;
}): Promise<TestCommitment> {
  const id = randomUUID();
  await inTx(async (c) => {
    const b = (
      await c.query(`select legal_entity_id, currency from budgets where id = $1`, [opts.budgetId])
    ).rows[0];
    const currency = opts.currency ?? b.currency;
    await c.query(
      `insert into commitments (id, tenant_id, budget_id, event_id, status, vendor_id, legal_entity_id, cost_center_id, gl_account_id,
         description, service_start, service_end, amount_minor, currency, non_refundable_deposit_minor)
       values ($1,$2,$3,$4,'pre_encumbered',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        id,
        ACME,
        opts.budgetId,
        opts.eventId ?? null,
        opts.vendorId ?? null,
        b.legal_entity_id,
        opts.costCenterId ?? null,
        opts.glAccountId ?? null,
        opts.description ?? 'Scenario commitment',
        opts.serviceStart ?? '2026-11-10',
        opts.serviceEnd ?? '2026-11-12',
        opts.amountMinor,
        currency,
        opts.nonRefundableDepositMinor ?? 0,
      ],
    );
    const amount = { amountMinor: opts.amountMinor, currency };
    await move(
      c,
      opts.budgetId,
      'pre_encumber',
      amount,
      { commitmentId: id, eventId: opts.eventId ?? null },
      '2026-11-02',
    );
    await move(
      c,
      opts.budgetId,
      'encumber',
      amount,
      { commitmentId: id, eventId: opts.eventId ?? null },
      '2026-11-02',
    );
    await c.query(`update commitments set status = 'encumbered' where id = $1`, [id]);
  });
  return { id, reference: `CMT-${id.slice(-8).toUpperCase()}`, budgetId: opts.budgetId };
}

/** An event in the given status with a unique event code. */
export async function createEvent(opts: {
  legalEntityId?: string;
  budgetId?: string | null;
  status?: string;
  costCenterId?: string | null;
}) {
  const id = randomUUID();
  const eventCode = `SC-${uniq()}`;
  await inTx((c) =>
    c.query(
      `insert into events (id, tenant_id, name, event_type, status, organizer_person_id, legal_entity_id, cost_center_id, event_code, budget_id, currency)
       values ($1,$2,$3,'team_building',$4,$5,$6,$7,$8,$9,'USD')`,
      [
        id,
        ACME,
        `Scenario event ${eventCode}`,
        opts.status ?? 'completed',
        userById('location-manager').personId,
        opts.legalEntityId ?? INDIA,
        opts.costCenterId ?? null,
        eventCode,
        opts.budgetId ?? null,
      ],
    ),
  );
  return { id, eventCode };
}

/** An approved Inter-Director Budget Contribution Request earmarked (held) on the giver's budget. */
export async function createEarmark(opts: {
  eventId: string;
  giverBudgetId: string;
  amountMinor: number;
  withRecharge?: boolean;
  fromLegalEntityId?: string;
  toLegalEntityId?: string;
}) {
  const id = randomUUID();
  await inTx(async (c) => {
    const b = (await c.query(`select currency from budgets where id = $1`, [opts.giverBudgetId]))
      .rows[0];
    await c.query(
      `insert into contribution_requests (id, tenant_id, event_id, requester_person_id, giver_budget_id, requested_minor, approved_minor, currency, mode, status, purpose)
       values ($1,$2,$3,$4,$5,$6,$6,$7,'earmark','earmarked','Scenario Inter-Director Budget Contribution Request')`,
      [
        id,
        ACME,
        opts.eventId,
        userById('location-manager').personId,
        opts.giverBudgetId,
        opts.amountMinor,
        b.currency,
      ],
    );
    await move(
      c,
      opts.giverBudgetId,
      'hold',
      { amountMinor: opts.amountMinor, currency: b.currency },
      { contributionId: id, eventId: opts.eventId },
      '2026-11-02',
    );
    if (opts.withRecharge)
      await addRecharge(
        {
          contributionId: id,
          eventId: opts.eventId,
          from: opts.fromLegalEntityId!,
          to: opts.toLegalEntityId!,
          amountMinor: opts.amountMinor,
        },
        c,
      );
  });
  return { id };
}

export async function addRecharge(
  o: { contributionId: string; eventId: string; from: string; to: string; amountMinor: number },
  client?: Client,
) {
  const run = (c: Client) =>
    c.query(
      `insert into recharge_schedules (tenant_id, contribution_request_id, event_id, from_legal_entity_id, to_legal_entity_id, mode, amount_minor, currency, status)
       values ($1,$2,$3,$4,$5,'recharge_at_cost',$6,'USD','approved')`,
      [ACME, o.contributionId, o.eventId, o.from, o.to, o.amountMinor],
    );
  if (client) await run(client);
  else await inTx(run);
}

/** Vendor and GL account ids from the Phase 3 seed. */
export async function refs() {
  return asOwner(async (c) => {
    const vendors = new Map<string, string>(
      (await c.query(`select id, name from vendors where tenant_id = $1`, [ACME])).rows.map((r) => [
        r.name,
        r.id,
      ]),
    );
    const gl = new Map<string, string>(
      (
        await c.query(
          `select g.id, e.code || '|' || g.code as k from gl_accounts g join legal_entities e on e.id = g.legal_entity_id where g.tenant_id = $1`,
          [ACME],
        )
      ).rows.map((r) => [r.k, r.id]),
    );
    return {
      vendor: (n: string) => vendors.get(n)!,
      gl: (entity: string, code: string) => gl.get(`${entity}|${code}`)!,
    };
  });
}

export const HEADER =
  'source_ref,transaction_date,amount,currency,legal_entity,cost_center,gl_account,event_code,vendor,memo,reference,original_ref,kind';

export function csv(rows: string[]): string {
  return [HEADER, ...rows].join('\n');
}

export async function upload(
  request: APIRequestContext,
  content: string,
  opts: { source?: string; user?: SeedUserId; fileName?: string } = {},
) {
  return expectContract(
    await request.post('/api/actuals/imports', {
      headers: await mutate(opts.user ?? 'finance-controller'),
      data: {
        source: opts.source ?? 'erp',
        fileName: opts.fileName ?? `scenario-${uniq()}.csv`,
        content,
      },
    }),
    201,
    ImportBatch,
  );
}

export async function post(
  request: APIRequestContext,
  batchId: string,
  user: SeedUserId = 'finance-controller',
) {
  return expectContract(
    await request.post(`/api/actuals/imports/${batchId}/post`, { headers: await mutate(user) }),
    200,
    ImportBatch,
  );
}

export async function importAndPost(
  request: APIRequestContext,
  content: string,
  opts: { source?: string } = {},
) {
  const batch = await upload(request, content, opts);
  return post(request, batch.id);
}

export async function actualByRef(request: APIRequestContext, ref: string) {
  const list = await expectContract(
    await request.get(`/api/actuals?status=all&q=${encodeURIComponent(ref)}`, {
      headers: await as('finance-controller'),
    }),
    200,
    ActualList,
  );
  const line = list.items.find((i) => i.sourceRef === ref);
  expect(line, `actual ${ref}`).toBeTruthy();
  return expectContract(
    await request.get(`/api/actuals/${line!.id}`, { headers: await as('finance-controller') }),
    200,
    ActualDetail,
  );
}

export async function commitmentState(
  request: APIRequestContext,
  budgetId: string,
  commitmentId: string,
) {
  const list = await expectContract(
    await request.get(`/api/actuals/commitments?status=all&budgetId=${budgetId}`, {
      headers: await as('finance-controller'),
    }),
    200,
    CommitmentHygieneList,
  );
  const c = list.items.find((i) => i.id === commitmentId);
  expect(c, `commitment ${commitmentId}`).toBeTruthy();
  return c!;
}

/** Budget bucket balances in the budget currency. */
export async function buckets(request: APIRequestContext, budgetId: string) {
  const res = await request.get(`/api/budgets/${budgetId}`, { headers: await as('finance-admin') });
  const b = (await res.json()) as BudgetDetail;
  return b;
}
