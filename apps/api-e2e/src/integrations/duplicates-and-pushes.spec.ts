// Cross-source duplicate review (99a) and outbound pushes (99b, 096). The same spend arriving from
// two sources is held before matching so it cannot be counted twice; a card limit is never pushed
// unless the company setting is on, never exceeds the approved commitment, and a repeat push is
// the same limit, not a second one.
import { expect, test } from '@playwright/test';
import {
  ConnectionDetail,
  DuplicateGroupList,
  DuplicateGroupView,
  ImportBatch,
  PushItemList,
  PushItemView,
} from '@bf/contracts';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { CONNECTIONS, resetMock } from '../support/p12';

test.beforeEach(async () => {
  await resetMock();
});

test.describe('cross-source duplicates', () => {
  test('the same spend from two sources is held, then one line is kept as the record', async ({
    request,
  }) => {
    const ref = randomUUID().slice(0, 8).toUpperCase();
    const line = (source: string, id: string) =>
      [
        'source_ref,transaction_date,amount,currency,legal_entity,cost_center,gl_account,merchant,memo',
        `${id},2026-11-07,86.40,USD,HYL-US,CC-US-NYC-300,6100,Cafe Mocha,Team coffee`,
      ].join('\n');

    const card = await expectContract(
      await request.post('/api/actuals/imports', {
        headers: await mutate('finance-admin'),
        data: {
          source: 'card',
          fileName: `dup-card-${ref}.csv`,
          content: line('card', `CARD-${ref}`),
        },
      }),
      201,
      ImportBatch,
    );
    expect(card.summary.imported).toBe(1);

    const expense = await expectContract(
      await request.post('/api/actuals/imports', {
        headers: await mutate('finance-admin'),
        data: {
          source: 'expense',
          fileName: `dup-expense-${ref}.csv`,
          content: line('expense', `EXP-${ref}`),
        },
      }),
      201,
      ImportBatch,
    );
    expect(
      expense.summary.crossSourceDuplicates,
      'the second source is held as a possible duplicate before matching',
    ).toBe(1);

    const open = await expectContract(
      await request.get('/api/integrations/duplicates', {
        headers: await as('finance-controller'),
        params: { status: 'open' },
      }),
      200,
      DuplicateGroupList,
    );
    const group = open.items.find((g) => g.lines.some((l) => l.sourceRef === `EXP-${ref}`));
    expect(group, 'the duplicate group is on the review queue').toBeTruthy();
    expect(group!.lines.length).toBe(2);
    expect(group!.confidence).toBe('high');
    expect(group!.facts.join(' ')).toContain('Same amount');
    // Record precedence puts the line closest to the general ledger first (card before expense).
    expect(group!.lines[0].source).toBe('card');

    const resolved = await expectContract(
      await request.post(`/api/integrations/duplicates/${group!.flagId}/resolve`, {
        headers: await mutate('finance-controller'),
        data: {
          resolution: 'kept_one',
          keepActualId: group!.lines[0].actualId,
          reasonCode: 'DUP-ITEMIZATION',
          reason: 'The expense line itemises the card transaction.',
        },
      }),
      200,
      DuplicateGroupView,
    );
    expect(resolved.status).toBe('resolved');
    expect(resolved.keptActualId).toBe(group!.lines[0].actualId);
    const excluded = resolved.lines.find((l) => l.actualId !== resolved.keptActualId);
    expect(excluded!.matchStatus).toBe('excluded');

    // Resolving twice is refused, so a group cannot be decided two different ways.
    await expectProblem(
      await request.post(`/api/integrations/duplicates/${group!.flagId}/resolve`, {
        headers: await mutate('finance-controller'),
        data: {
          resolution: 'kept_both',
          reasonCode: 'DUP-NO',
          reason: 'Changed my mind.',
        },
      }),
      409,
      'DUPLICATE_ALREADY_RESOLVED',
    );
  });

  test('keeping one line needs to say which one stays', async ({ request }) => {
    const open = await expectContract(
      await request.get('/api/integrations/duplicates', {
        headers: await as('finance-controller'),
        params: { status: 'open' },
      }),
      200,
      DuplicateGroupList,
    );
    test.skip(open.items.length === 0, 'no open duplicate group to decide');
    await expectProblem(
      await request.post(`/api/integrations/duplicates/${open.items[0].flagId}/resolve`, {
        headers: await mutate('finance-controller'),
        data: { resolution: 'kept_one', reasonCode: 'DUP-X', reason: 'No line named.' },
      }),
      422,
      'VALIDATION_FAILED',
    );
  });

  test('a budget owner cannot resolve duplicates', async ({ request }) => {
    await expectProblem(
      await request.post(`/api/integrations/duplicates/${randomUUID()}/resolve`, {
        headers: await mutate('budget-owner'),
        data: { resolution: 'kept_both', reasonCode: 'DUP-X', reason: 'Not mine to decide.' },
      }),
      403,
      'FORBIDDEN',
    );
  });
});

test.describe('event-code and card-limit pushes', () => {
  test('card-limit push is off by default and refuses to create a limit', async ({ request }) => {
    const detail = await expectContract(
      await request.get(`/api/integrations/connections/${CONNECTIONS.ramp}`, {
        headers: await as('integration-admin'),
      }),
      200,
      ConnectionDetail,
    );
    expect(detail.settings['cardLimitPush']).toBe(false);

    await expectProblem(
      await request.post('/api/integrations/pushes', {
        headers: await mutate('integration-admin'),
        data: {
          connectionId: CONNECTIONS.ramp,
          kind: 'card_limit',
          commitmentId: randomUUID(),
        },
      }),
      409,
      'PUSH_NOT_ENABLED',
    );
  });

  test('an event code is pushed once, and pushing it again returns the same item', async ({
    request,
  }) => {
    const events = await request.get('/api/events', { headers: await as('finance-admin') });
    const body = (await events.json()) as { items?: { id: string; eventCode: string }[] };
    const event = body.items?.[0];
    test.skip(!event, 'no seeded event to push');

    const first = await expectContract(
      await request.post('/api/integrations/pushes', {
        headers: await mutate('integration-admin'),
        data: { connectionId: CONNECTIONS.erpnext, kind: 'event_code', eventId: event!.id },
      }),
      201,
      PushItemView,
    );
    expect(first.status).toBe('pushed');
    expect(first.externalId).toContain(event!.eventCode);

    const again = await expectContract(
      await request.post('/api/integrations/pushes', {
        headers: await mutate('integration-admin'),
        data: { connectionId: CONNECTIONS.erpnext, kind: 'event_code', eventId: event!.id },
      }),
      201,
      PushItemView,
    );
    expect(again.id, 'a repeat push is the same item, not a second one').toBe(first.id);

    const list = await expectContract(
      await request.get('/api/integrations/pushes', {
        headers: await as('integration-admin'),
        params: { connectionId: CONNECTIONS.erpnext },
      }),
      200,
      PushItemList,
    );
    expect(list.items.filter((i) => i.reference === event!.eventCode).length).toBe(1);
  });

  test('a connector that does not accept card limits refuses the push', async ({ request }) => {
    await expectProblem(
      await request.post('/api/integrations/pushes', {
        headers: await mutate('integration-admin'),
        data: {
          connectionId: CONNECTIONS.erpnext,
          kind: 'card_limit',
          commitmentId: randomUUID(),
        },
      }),
      422,
      'CONNECTOR_OBJECT_UNSUPPORTED',
    );
  });
});
