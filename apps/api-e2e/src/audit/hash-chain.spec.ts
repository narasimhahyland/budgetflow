// Invariant 19: exactly one hash-chained audit event per successful mutation, none on rejection; audit rows
// are immutable; verification finds the first tampered row and a chain cut short of its head (sandbox
// tenant only, restored afterwards).
import { expect, test } from '@playwright/test';
import { AuditEventList, AuditVerification, Journal } from '@bf/contracts';
import { SEED } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { asAppRole, asOwner, pgError } from '../support/db';
import { allocate, allocateOk, createChild, createRoot } from '../support/factory';

async function events(request: Parameters<typeof createRoot>[0], resourceId: string) {
  return (
    await expectContract(
      await request.get(`/api/audit/events?resourceId=${resourceId}`, {
        headers: await as('auditor'),
      }),
      200,
      AuditEventList,
    )
  ).items;
}

test.describe('audit trail', () => {
  test('one event per successful mutation with actor and changes; none for a rejected command', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 10_000 });
    const created = await events(request, root.id);
    expect(created.map((e) => e.action)).toEqual(['budget.created']);
    expect(created[0]).toMatchObject({
      resourceType: 'budget',
      actorPersonId: '40000000-0000-4000-8000-000000000003',
    });
    expect(created[0].changes).toMatchObject({
      originalAmount: { from: null, to: { amountMinor: 10_000, currency: 'USD' } },
    });

    const child = await createChild(request, root.id, { currency: 'USD' });
    await allocateOk(request, root.id, child.id, { amountMinor: 4_000, currency: 'USD' });
    await expectProblem(
      await allocate(request, root.id, child.id, { amountMinor: 6_001, currency: 'USD' }),
      409,
      'OVER_ALLOCATION',
    );
    const after = await events(request, root.id);
    expect(after.map((e) => e.action)).toEqual(['budget.created', 'budget.allocated']);
    expect(after[1].changes).toMatchObject({ allocatedOut: { from: 0, to: 4_000 } });
    expect(after[1].prevHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("the tenant's chain verifies, and only audit roles may read it", async ({ request }) => {
    const v = await expectContract(
      await request.get('/api/audit/verification', { headers: await as('auditor') }),
      200,
      AuditVerification,
    );
    expect(v).toMatchObject({ valid: true, firstBrokenSeq: null });
    expect(v.checked).toBeGreaterThan(0);
    await expectProblem(
      await request.get('/api/audit/events', { headers: await as('regional-manager') }),
      403,
      'FORBIDDEN',
    );
  });

  test('the database rejects UPDATE and DELETE on audit rows for the application role', async () => {
    for (const sql of [`update audit_events set reason = 'edited'`, `delete from audit_events`]) {
      const e = await pgError(asAppRole(SEED.tenants.acme, (c) => c.query(sql)));
      expect(e?.code, sql).toBe('42501');
    }
  });

  test('exactly one event per successful mutation across command types, none for rejections or replays', async ({
    request,
  }) => {
    const checked = async () =>
      (
        await expectContract(
          await request.get('/api/audit/verification', { headers: await as('auditor') }),
          200,
          AuditVerification,
        )
      ).checked;
    const before = await checked();
    const root = await createRoot(request, { amountMinor: 20_000 }); // +1
    const child = await createChild(request, root.id, { currency: 'USD' }); // +1
    const key = randomUUID();
    await allocateOk(request, root.id, child.id, { amountMinor: 5_000, currency: 'USD' }); // +1
    const first = await allocate(
      request,
      root.id,
      child.id,
      { amountMinor: 1_000, currency: 'USD' },
      { key },
    ); // +1
    const replay = await allocate(
      request,
      root.id,
      child.id,
      { amountMinor: 1_000, currency: 'USD' },
      { key },
    );
    expect([first.status(), replay.status(), replay.headers()['idempotent-replayed']]).toEqual([
      201,
      201,
      'true',
    ]);
    await expectProblem(
      await allocate(request, root.id, child.id, { amountMinor: 14_001, currency: 'USD' }),
      409,
      'OVER_ALLOCATION',
    );
    const journal = async (debitMinor: number, creditMinor: number) =>
      request.post('/api/ledger/journals', {
        headers: await mutate('finance-admin'),
        data: {
          transactionCurrency: 'USD',
          reasonCode: 'ADJ-OPENING',
          reason: 'Opening encumbrance',
          lines: [
            { budgetId: root.id, account: 'encumbered', side: 'debit', amountMinor: debitMinor },
            {
              budgetId: null,
              account: 'obligations',
              side: 'credit',
              amountMinor: creditMinor,
              legalEntityId: SEED.legalEntities.acmeUs,
            },
          ],
        },
      });
    const manual = await expectContract(await journal(1_000, 1_000), 201, Journal); // +1
    await expectProblem(await journal(1_000, 999), 422, 'JOURNAL_UNBALANCED');
    const reverse = async () =>
      request.post(`/api/ledger/journals/${manual.id}/reversals`, {
        headers: await mutate('finance-admin'),
        data: { reasonCode: 'REV-ERROR', reason: 'Posted twice' },
      });
    expect((await reverse()).status()).toBe(201); // +1
    await expectProblem(await reverse(), 409, 'ALREADY_REVERSED');
    expect((await checked()) - before).toBe(6);
  });

  test('deleting the newest event fails verification against the chain head', async ({
    request,
  }) => {
    const verify = async () =>
      expectContract(
        await request.get('/api/audit/verification', { headers: await as('sandbox-admin') }),
        200,
        AuditVerification,
      );
    const before = await verify();
    expect(before.valid).toBe(true);
    const newest = await asOwner(
      async (c) =>
        (
          await c.query(
            `select row_to_json(a)::text as row, id, seq::int as seq from audit_events a where tenant_id = $1 order by seq desc limit 1`,
            [SEED.tenants.sandbox],
          )
        ).rows[0] as { row: string; id: string; seq: number },
    );
    await asOwner(async (c) => {
      await c.query('begin');
      await c.query('alter table audit_events disable trigger audit_events_append_only');
      await c.query('delete from audit_events where id = $1', [newest.id]);
      await c.query('alter table audit_events enable trigger audit_events_append_only');
      await c.query('commit');
    });
    try {
      expect(await verify()).toMatchObject({
        valid: false,
        checked: newest.seq - 1,
        firstBrokenSeq: newest.seq,
        reason: `the chain ends at ${newest.seq - 1} but its head records ${newest.seq}`,
      });
    } finally {
      await asOwner((c) =>
        c.query(
          `insert into audit_events select * from json_populate_record(null::audit_events, $1::json)`,
          [newest.row],
        ),
      );
    }
    expect(await verify()).toMatchObject({ valid: true, checked: before.checked });
  });

  test('tampering with one stored event breaks verification at that event', async ({ request }) => {
    const verify = async () =>
      expectContract(
        await request.get('/api/audit/verification', { headers: await as('sandbox-admin') }),
        200,
        AuditVerification,
      );
    expect((await verify()).valid).toBe(true);
    const target = await asOwner(
      async (c) =>
        (
          await c.query(
            `select id, seq::int as seq, reason from audit_events where tenant_id = $1 order by seq limit 1 offset 1`,
            [SEED.tenants.sandbox],
          )
        ).rows[0],
    );
    const setReason = (reason: string | null) =>
      asOwner(async (c) => {
        await c.query('begin');
        await c.query('alter table audit_events disable trigger audit_events_append_only');
        await c.query('update audit_events set reason = $2 where id = $1', [target.id, reason]);
        await c.query('alter table audit_events enable trigger audit_events_append_only');
        await c.query('commit');
      });
    await setReason('tampered by scenario');
    try {
      const broken = await verify();
      expect(broken).toMatchObject({
        valid: false,
        firstBrokenSeq: target.seq,
        reason: 'content does not match its hash',
      });
    } finally {
      await setReason(target.reason);
    }
    expect((await verify()).valid).toBe(true);
  });
});
