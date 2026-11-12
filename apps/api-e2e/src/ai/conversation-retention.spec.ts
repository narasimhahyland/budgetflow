// AI conversation history is purged, not hidden (113a, retention category `ai_conversations`).
// The invariants this file exists for:
//   * the window deletes rows rather than filtering them, so the question and answer text is
//     actually gone - this is the whole point: it used to be a read-side filter that kept the text
//     forever while the screen promised a window;
//   * the cutoff is the boundary it claims to be: a conversation either side of it is treated
//     differently, and the window runs from the conversation's last question rather than per turn,
//     so a thread someone is still using is never half-deleted;
//   * a legal hold beats the purge, matched on the asker's person, and the run records which hold
//     kept the record;
//   * one number governs both ends - the list reads the same period the sweep deletes by, so it can
//     never promise history the purge has removed.
// Destructive runs happen in the Initech Sandbox tenant, on conversations the scenario inserts
// itself, and the scenario restores the period and releases its hold afterwards.
import { expect, test } from '@playwright/test';
import { userById } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { asAppRole } from '../support/db';
import {
  activeHold,
  reason,
  releaseHold,
  retentionPolicy,
  runItem,
  SANDBOX,
  setRetentionPeriodOk,
  startRunOk,
} from '../admin/support';
const CATEGORY = 'ai_conversations';

/** The floor the category ships with, so the scenario sets a period it is allowed to set. */
const PERIOD_DAYS = 7;

const DAY_MS = 86_400_000;

type Seeded = { conversationId: string; turnId: string };

/**
 * Inserts a conversation with its last question `daysAgo` days ago, plus one turn carrying text.
 * Committed, because the purge has to find it in a later transaction.
 */
async function seedConversation(
  user: Parameters<typeof userById>[0],
  daysAgo: number,
  title: string,
): Promise<Seeded> {
  const person = userById(user);
  const conversationId = randomUUID();
  const turnId = randomUUID();
  const askedAt = new Date(Date.now() - daysAgo * DAY_MS).toISOString();
  await asAppRole(
    SANDBOX,
    async (c) => {
      await c.query(
        `insert into ai_conversations
           (id, tenant_id, person_id, actor_subject, title, channel, started_at, last_asked_at)
         values ($1, $2, $3, $4, $5, 'web', $6, $6)`,
        [conversationId, SANDBOX, person.personId, person.subject, title, askedAt],
      );
      await c.query(
        `insert into ai_conversation_turns
           (id, tenant_id, conversation_id, actor_subject, asked_at, question, answer, outcome)
         values ($1, $2, $3, $4, $5, $6, $7, 'answered')`,
        [
          turnId,
          SANDBOX,
          conversationId,
          person.subject,
          askedAt,
          `How much is left in ${title}?`,
          'Fictional answer recorded by the scenario.',
        ],
      );
    },
    { commit: true },
  );
  return { conversationId, turnId };
}

/** Counts the conversation and its turns straight from the database, past any read-side filter. */
async function rowsFor(seeded: Seeded): Promise<{ conversations: number; turns: number }> {
  return asAppRole(SANDBOX, async (c) => {
    const conv = await c.query('select 1 from ai_conversations where id = $1', [
      seeded.conversationId,
    ]);
    const turns = await c.query('select 1 from ai_conversation_turns where conversation_id = $1', [
      seeded.conversationId,
    ]);
    return { conversations: conv.rowCount ?? 0, turns: turns.rowCount ?? 0 };
  });
}

async function removeConversation(seeded: Seeded): Promise<void> {
  await asAppRole(
    SANDBOX,
    (c) => c.query('delete from ai_conversations where id = $1', [seeded.conversationId]),
    { commit: true },
  );
}

test.describe.configure({ mode: 'serial' });

test.describe('AI conversation retention (113a)', () => {
  let originalPeriod: number | null = null;

  test.beforeAll(async ({ request }) => {
    const policy = await retentionPolicy(request, CATEGORY, 'sandbox-admin', SANDBOX);
    originalPeriod = policy.periodDays;
  });

  test.afterAll(async ({ request }) => {
    if (originalPeriod === null) return;
    await setRetentionPeriodOk(request, {
      user: 'sandbox-admin',
      category: CATEGORY,
      periodDays: originalPeriod,
      reason: reason('restore the AI conversation period after the scenario'),
      tenant: SANDBOX,
    });
  });

  test('the category ships as a provisional default that deletes', async ({ request }) => {
    const policy = await retentionPolicy(request, CATEGORY, 'sandbox-admin', SANDBOX);
    expect(policy.action, 'the window deletes rather than anonymises or archives').toBe('delete');
    expect(policy.signoffStatus, 'like every period, pending finance and legal').toBe(
      'provisional',
    );
    expect(policy.locked, 'the period can be changed, unlike the accounting categories').toBe(
      false,
    );
  });

  test('a conversation past the window is deleted, and one inside it is kept', async ({
    request,
  }) => {
    const stale = await seedConversation('sandbox-auditor', PERIOD_DAYS + 3, 'Stale thread');
    const fresh = await seedConversation('sandbox-auditor', 2, 'Live thread');

    try {
      expect(await rowsFor(stale)).toEqual({ conversations: 1, turns: 1 });
      expect(await rowsFor(fresh)).toEqual({ conversations: 1, turns: 1 });

      await setRetentionPeriodOk(request, {
        user: 'sandbox-admin',
        category: CATEGORY,
        periodDays: PERIOD_DAYS,
        reason: reason('set the AI conversation window to its floor for the scenario'),
        tenant: SANDBOX,
      });

      // A preview names what would go without touching it.
      const preview = await startRunOk(request, {
        user: 'sandbox-admin',
        mode: 'dry_run',
        categories: [CATEGORY],
        reason: reason('preview the AI conversation purge'),
        tenant: SANDBOX,
      });
      expect(runItem(preview, CATEGORY).appliedCount, 'a preview never removes anything').toBe(0);
      expect(await rowsFor(stale), 'the stale conversation is still there after a preview').toEqual(
        { conversations: 1, turns: 1 },
      );

      // Applying is fenced on purpose: it repeats a named preview, types the word, and needs
      // `retention.confirm`, which the Finance Controller has and the administrator does not.
      const applied = await startRunOk(request, {
        user: 'sandbox-controller',
        mode: 'apply',
        categories: [CATEGORY],
        dryRunId: preview.id,
        confirmation: 'DELETE',
        reason: reason('purge AI conversations past the window'),
        tenant: SANDBOX,
      });
      expect(runItem(applied, CATEGORY).appliedCount).toBeGreaterThanOrEqual(1);

      // The point of the whole change: the row is gone, not filtered out of a response.
      expect(
        await rowsFor(stale),
        'the conversation past the window is deleted, and its turns go with it',
      ).toEqual({ conversations: 0, turns: 0 });
      expect(
        await rowsFor(fresh),
        'a conversation inside the window keeps its text, so the cutoff is a real boundary',
      ).toEqual({ conversations: 1, turns: 1 });
    } finally {
      await removeConversation(stale);
      await removeConversation(fresh);
    }
  });

  test('a legal hold on the asker keeps their conversation and the run says which hold', async ({
    request,
  }) => {
    const heldPerson = userById('sandbox-controller').personId!;
    const held = await seedConversation('sandbox-controller', PERIOD_DAYS + 5, 'Held thread');

    const holdId = await activeHold(request, {
      placedBy: 'sandbox-auditor',
      confirmedBy: 'sandbox-controller',
      scopeKind: 'person',
      scopeRefId: heldPerson,
      reason: reason('employment dispute: keep the AI history for this person'),
      tenant: SANDBOX,
    });

    try {
      await setRetentionPeriodOk(request, {
        user: 'sandbox-admin',
        category: CATEGORY,
        periodDays: PERIOD_DAYS,
        reason: reason('set the AI conversation window to its floor for the hold scenario'),
        tenant: SANDBOX,
      });

      const preview = await startRunOk(request, {
        user: 'sandbox-admin',
        mode: 'dry_run',
        categories: [CATEGORY],
        reason: reason('preview the purge while a hold is active'),
        tenant: SANDBOX,
      });
      const applied = await startRunOk(request, {
        user: 'sandbox-controller',
        mode: 'apply',
        categories: [CATEGORY],
        dryRunId: preview.id,
        confirmation: 'DELETE',
        reason: reason('purge AI conversations while a hold is active'),
        tenant: SANDBOX,
      });

      expect(await rowsFor(held), 'a hold beats the purge: the text is still there').toEqual({
        conversations: 1,
        turns: 1,
      });
      const item = runItem(applied, CATEGORY);
      expect(item.skippedHoldCount, 'the run counts what a hold kept').toBeGreaterThanOrEqual(1);
      expect(item.holdIds, 'and names the hold that kept it').toContain(holdId);
    } finally {
      await releaseHold(request, holdId, 'sandbox-auditor', SANDBOX);
      await removeConversation(held);
    }
  });
});
