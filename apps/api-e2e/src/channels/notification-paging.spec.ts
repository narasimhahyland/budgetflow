// Notification feed paging (123). A person with more notifications than one page can reach every one
// of them: the feed filters by tab, area and unread in SQL, pages newest first on a stable
// (created_at, id) cursor with no gaps or duplicates, and the tab counts are totals over the person's
// whole 90-day window, not over the page that happens to be loaded.
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  CommentView,
  MarkNotificationsResponse,
  NotificationsFeed,
  RequestDetail,
  TestChannelResponse,
  type NotificationItem,
} from '@bf/contracts';
import { userById } from '@bf/seed';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { asOwner } from '../support/db';
import { comment } from '../support/p8';
import { directorTree, spendingRequest, usd } from '../support/p5';

const MENTIONS = 220;
const TESTS = 40;
const recipient = userById('department-head');

/** Walks every page of one feed view; fails loudly on a runaway cursor. */
async function allPages(
  request: APIRequestContext,
  query: Record<string, string>,
): Promise<{ items: NotificationItem[]; pages: NotificationsFeed[] }> {
  const pages: NotificationsFeed[] = [];
  let cursor: string | null = null;
  do {
    const params: URLSearchParams = new URLSearchParams({
      ...query,
      ...(cursor ? { cursor } : {}),
    });
    const page: NotificationsFeed = await expectContract(
      await request.get(`/api/notifications?${params}`, { headers: await as('department-head') }),
      200,
      NotificationsFeed,
    );
    pages.push(page);
    cursor = page.nextCursor;
    expect(pages.length, 'the cursor ends').toBeLessThan(100);
  } while (cursor);
  return { items: pages.flatMap((p) => p.items), pages };
}

/** Ground truth straight from the table: the person's rows in the 90-day window. */
async function dbCount(where = 'true'): Promise<number> {
  return asOwner(async (c) => {
    const r = await c.query<{ n: string }>(
      `select count(*) as n from notifications
        where tenant_id = $1 and recipient_person_id = $2
          and created_at >= now() - interval '90 days' and (${where})`,
      [recipient.tenantId, recipient.personId],
    );
    return Number(r.rows[0].n);
  });
}

function expectNewestFirstNoDuplicates(items: NotificationItem[]): void {
  expect(new Set(items.map((i) => i.id)).size, 'no duplicates across pages').toBe(items.length);
  for (let i = 1; i < items.length; i++) {
    const a = items[i - 1];
    const b = items[i];
    // createdAt is shown to the millisecond; the database orders by microseconds, then id.
    expect(a.createdAt >= b.createdAt, `item ${i} is not newer than item ${i - 1}`).toBe(true);
  }
}

test.describe('notification feed paging', () => {
  test('a person with hundreds of notifications pages through all of them with exact counts', async ({
    request,
  }) => {
    test.setTimeout(240_000);

    // 220 real @mentions on one request, with 40 test notifications (area approvals) between them,
    // so the two areas interleave across every page boundary.
    const { team } = await directorTree(request);
    const r = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(25_000)),
      201,
      RequestDetail,
    );
    const commentIds = new Set<string>();
    let tests = 0;
    for (let i = 0; i < MENTIONS; i++) {
      const posted = await expectContract(
        await comment(request, 'budget-owner', 'request', r.id, {
          body: `Paging check ${i + 1}: @Lena Fischer please look.`,
          mentionedPersonIds: [recipient.personId],
        }),
        201,
        CommentView,
      );
      commentIds.add(posted.id);
      if (i % 5 === 4 && tests < TESTS) {
        tests++;
        await expectContract(
          await request.post('/api/me/notification-settings/test', {
            headers: await mutate('department-head'),
            data: { channel: 'in_app' },
          }),
          200,
          TestChannelResponse,
        );
      }
    }
    expect(tests).toBe(TESTS);
    const total = await dbCount();
    expect(total, 'the person now has more than one maximum page').toBeGreaterThan(MENTIONS + 30);

    // Mark every third new mention read through the real command.
    const mentions = await allPages(request, { tab: 'mentions', limit: '200' });
    const ours = mentions.items.filter((n) => n.commentId && commentIds.has(n.commentId));
    expect(ours).toHaveLength(MENTIONS);
    const readIds = new Set(ours.filter((_, i) => i % 3 === 0).map((n) => n.id));
    const toMark = [...readIds];
    for (let i = 0; i < toMark.length; i += 200) {
      const marked = await expectContract(
        await request.post('/api/notifications/mark', {
          headers: await mutate('department-head'),
          data: { ids: toMark.slice(i, i + 200), read: true },
        }),
        200,
        MarkNotificationsResponse,
      );
      expect(marked.updated).toBe(toMark.slice(i, i + 200).length);
    }

    // All: every row in the window, newest first, no gaps or duplicates, counts are totals.
    const all = await allPages(request, { limit: '50' });
    expect(all.pages.length).toBeGreaterThan(5);
    expect(all.items).toHaveLength(total);
    expectNewestFirstNoDuplicates(all.items);
    for (const p of all.pages.slice(0, -1)) expect(p.items).toHaveLength(50);
    const counts = {
      unread: await dbCount('read_at is null'),
      mentions: await dbCount(`type = 'discussion.mentioned'`),
      following: await dbCount(`type = 'discussion.followed_activity'`),
    };
    for (const p of all.pages) expect(p.counts).toMatchObject(counts);
    expect(counts.mentions).toBeGreaterThanOrEqual(MENTIONS);
    for (const id of commentIds) {
      expect(
        all.items.some((n) => n.commentId === id),
        `mention on comment ${id}`,
      ).toBe(true);
    }

    // Mentions tab: only mentions, all of them, and as many as the Mentions count says.
    const ment = await allPages(request, { tab: 'mentions', limit: '37' });
    expectNewestFirstNoDuplicates(ment.items);
    expect(ment.items).toHaveLength(counts.mentions);
    expect(ment.items.every((n) => n.type === 'discussion.mentioned')).toBe(true);

    // Following tab: only followed activity, matching its count.
    const fol = await allPages(request, { tab: 'following' });
    expect(fol.items).toHaveLength(counts.following);
    expect(fol.items.every((n) => n.type === 'discussion.followed_activity')).toBe(true);

    // Area filter holds on every page.
    const approvals = await allPages(request, { area: 'approvals', limit: '7' });
    expectNewestFirstNoDuplicates(approvals.items);
    expect(approvals.items).toHaveLength(await dbCount(`area = 'approvals'`));
    expect(approvals.items.length).toBeGreaterThanOrEqual(TESTS);
    expect(approvals.items.every((n) => n.area === 'approvals')).toBe(true);
    const discussion = await allPages(request, { area: 'discussion', limit: '45' });
    expect(discussion.items).toHaveLength(await dbCount(`area = 'discussion'`));
    expect(discussion.items.every((n) => n.area === 'discussion')).toBe(true);

    // Unread only: exactly the unread count, none of the rows just marked read.
    const unread = await allPages(request, { unreadOnly: 'true', limit: '60' });
    expectNewestFirstNoDuplicates(unread.items);
    expect(unread.items).toHaveLength(counts.unread);
    expect(unread.items.every((n) => n.readAt === null)).toBe(true);
    expect(unread.items.some((n) => readIds.has(n.id))).toBe(false);

    // Filters combine: unread mentions in the discussion area.
    const combo = await allPages(request, {
      tab: 'mentions',
      area: 'discussion',
      unreadOnly: 'true',
      limit: '25',
    });
    expect(combo.items).toHaveLength(
      await dbCount(`type = 'discussion.mentioned' and area = 'discussion' and read_at is null`),
    );
    expect(combo.items.filter((n) => n.commentId && commentIds.has(n.commentId))).toHaveLength(
      MENTIONS - readIds.size,
    );

    // A tampered cursor is a validation problem on the cursor field, never a 500 or an empty page.
    await expectProblem(
      await request.get('/api/notifications?cursor=bm90LWEtY3Vyc29y', {
        headers: await as('department-head'),
      }),
      400,
      'VALIDATION_FAILED',
    );

    // Paging never widens scope: another person's feed has none of these rows.
    const other = await allPages(request, { limit: '200' });
    const otherPerson = await expectContract(
      await request.get('/api/notifications?limit=200', { headers: await as('regional-manager') }),
      200,
      NotificationsFeed,
    );
    const mine = new Set(other.items.map((n) => n.id));
    expect(otherPerson.items.some((n) => mine.has(n.id))).toBe(false);
  });
});
