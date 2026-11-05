// Discussion, @mentions and follow (060a). A comment thread hangs off a budget, event or request and
// never widens who can see it: a person can only be mentioned when PolicyService would let them read the
// item, the author may edit for 15 minutes, removal leaves a tombstone while the original text stays in
// the audit log, and read-only roles can read but not post.
import { expect, test } from '@playwright/test';
import { CommentView, DiscussionThread, FollowState, RequestDetail } from '@bf/contracts';
import { userById } from '@bf/seed';
import { expectContract, expectProblem } from '../support/contract';
import { as } from '../support/auth';
import { asOwner } from '../support/db';
import {
  auditEvents,
  comment,
  deleteComment,
  discussion,
  follow,
  patchComment,
} from '../support/p8';
import { directorTree, spendingRequest, usd } from '../support/p5';

test.describe('discussion, mentions and follow', () => {
  test('a mention only reaches people who can already read the item', async ({ request }) => {
    const { team } = await directorTree(request);
    const r = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(50_000)),
      201,
      RequestDetail,
    );

    const thread = await expectContract(
      await discussion(request, 'budget-owner', 'request', r.id),
      200,
      DiscussionThread,
    );
    expect(thread).toMatchObject({ itemType: 'request', itemId: r.id, canComment: true });
    expect(thread.comments).toHaveLength(0);

    const lena = userById('department-head').personId!;
    const candidate = thread.mentionCandidates.find((c) => c.personId === lena);
    expect(candidate, 'the approver is offered as a mention candidate').toBeTruthy();
    expect(candidate?.hasAccess).toBe(true);

    const posted = await expectContract(
      await comment(request, 'budget-owner', 'request', r.id, {
        body: 'Quote attached. @Lena Fischer can you look before Friday?',
        mentionedPersonIds: [lena],
      }),
      201,
      CommentView,
    );
    expect(posted).toMatchObject({
      authorName: 'Jordan Smith',
      canEdit: true,
      canDelete: true,
      editedAt: null,
      removedAt: null,
    });
    expect(posted.mentions.map((m) => m.personId)).toEqual([lena]);

    // The mentioned approver gets an in-app notification on the Mentions tab.
    const feed = await (
      await request.get('/api/notifications?tab=mentions&limit=50', {
        headers: await as('department-head'),
      })
    ).json();
    expect(
      feed.items.some(
        (n: { itemId: string; type: string }) =>
          n.itemId === r.id && n.type === 'discussion.mentioned',
      ),
    ).toBe(true);

    // An employee with no access to this budget cannot be mentioned into the thread.
    const employee = userById('employee').personId!;
    const blocked = thread.mentionCandidates.find((c) => c.personId === employee);
    if (blocked) expect(blocked.hasAccess).toBe(false);
    await expectProblem(
      await comment(request, 'budget-owner', 'request', r.id, {
        body: 'Looping in someone who should not see this.',
        mentionedPersonIds: [employee],
      }),
      422,
      'MENTION_NO_ACCESS',
    );

    // Nothing was written: the thread still has exactly the one comment.
    const after = await expectContract(
      await discussion(request, 'budget-owner', 'request', r.id),
      200,
      DiscussionThread,
    );
    expect(after.comments).toHaveLength(1);
    expect(after.commentCount).toBe(1);
  });

  test('the author may edit for 15 minutes; after that the comment is frozen', async ({
    request,
  }) => {
    const { team } = await directorTree(request);
    const r = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(35_000)),
      201,
      RequestDetail,
    );
    const posted = await expectContract(
      await comment(request, 'budget-owner', 'request', r.id, {
        body: 'Booked for 20 people.',
      }),
      201,
      CommentView,
    );

    const edited = await expectContract(
      await patchComment(request, 'budget-owner', posted.id, { body: 'Booked for 24 people.' }),
      200,
      CommentView,
    );
    expect(edited.body).toBe('Booked for 24 people.');
    expect(edited.editedAt).not.toBeNull();

    // The original text survives in the audit log even though the comment now reads differently.
    const edits = (await auditEvents(request, r.id)).filter((a) => a.action === 'comment.edited');
    expect(edits).toHaveLength(1);
    expect(edits[0].changes['body']).toMatchObject({
      from: 'Booked for 20 people.',
      to: 'Booked for 24 people.',
    });

    // Somebody else's comment is never editable, whatever the window says.
    await expectProblem(
      await patchComment(request, 'department-head', posted.id, { body: 'Rewritten by Lena.' }),
      403,
      'FORBIDDEN',
    );

    // Age the comment past the window.
    await asOwner((c) =>
      c.query(`update comments set created_at = now() - interval '16 minutes' where id = $1`, [
        posted.id,
      ]),
    );
    await expectProblem(
      await patchComment(request, 'budget-owner', posted.id, { body: 'Too late.' }),
      409,
      'COMMENT_EDIT_WINDOW_EXPIRED',
    );
    const frozen = await expectContract(
      await discussion(request, 'budget-owner', 'request', r.id),
      200,
      DiscussionThread,
    );
    expect(frozen.comments[0].body).toBe('Booked for 24 people.');
    expect(frozen.comments[0].canEdit).toBe(false);
  });

  test('removing a comment leaves a tombstone and keeps the text in the audit log', async ({
    request,
  }) => {
    const { team } = await directorTree(request);
    const r = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(25_000)),
      201,
      RequestDetail,
    );
    const posted = await expectContract(
      await comment(request, 'budget-owner', 'request', r.id, {
        body: 'Wrong thread, sorry.',
      }),
      201,
      CommentView,
    );

    const removed = await expectContract(
      await deleteComment(request, 'budget-owner', posted.id),
      200,
      CommentView,
    );
    expect(removed.body).toBe('');
    expect(removed.removedAt).not.toBeNull();
    expect(removed.removedByName).toBe('Jordan Smith');

    const thread = await expectContract(
      await discussion(request, 'budget-owner', 'request', r.id),
      200,
      DiscussionThread,
    );
    expect(thread.comments[0]).toMatchObject({ body: '', canEdit: false });
    await expectProblem(
      await patchComment(request, 'budget-owner', posted.id, { body: 'Undo' }),
      409,
      'CONFLICT',
    );

    const audit = await auditEvents(request, r.id);
    expect(audit.filter((a) => a.action === 'comment.removed')).toHaveLength(1);
    expect(audit.find((a) => a.action === 'comment.created')?.changes['body']?.to).toBe(
      'Wrong thread, sorry.',
    );
  });

  test('read-only roles read the discussion but cannot post', async ({ request }) => {
    const { team } = await directorTree(request);
    const r = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(20_000)),
      201,
      RequestDetail,
    );
    await expectContract(
      await comment(request, 'budget-owner', 'request', r.id, { body: 'For the record.' }),
      201,
      CommentView,
    );

    const auditorView = await expectContract(
      await discussion(request, 'auditor', 'request', r.id),
      200,
      DiscussionThread,
    );
    expect(auditorView.canComment).toBe(false);
    expect(auditorView.readOnlyReason).toContain('Auditors');
    expect(auditorView.comments).toHaveLength(1);
    await expectProblem(
      await comment(request, 'auditor', 'request', r.id, { body: 'Adding a note.' }),
      403,
      'FORBIDDEN',
    );
  });

  test('following a request puts it on the Following list and unfollowing takes it off', async ({
    request,
  }) => {
    const { team } = await directorTree(request);
    const r = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(15_000)),
      201,
      RequestDetail,
    );

    // The approver follows the request automatically; nobody has to opt in to their own queue.
    const approver = await expectContract(
      await discussion(request, 'department-head', 'request', r.id),
      200,
      DiscussionThread,
    );
    expect(approver.follow).toMatchObject({ following: true, source: 'owner' });

    // The finance controller is not in the route, so following is a deliberate choice.
    const followed = await expectContract(
      await follow(request, 'finance-controller', 'request', r.id, {
        following: true,
        level: 'money_decisions',
      }),
      200,
      FollowState,
    );
    expect(followed).toMatchObject({
      following: true,
      level: 'money_decisions',
      source: 'manual',
    });

    const list = await (
      await request.get('/api/me/following?itemType=request', {
        headers: await as('finance-controller'),
      })
    ).json();
    const entry = list.items.find((i: { itemId: string }) => i.itemId === r.id);
    expect(entry).toMatchObject({ level: 'money_decisions', source: 'manual', ref: r.ref });

    const off = await expectContract(
      await follow(request, 'finance-controller', 'request', r.id, { following: false }),
      200,
      FollowState,
    );
    expect(off.following).toBe(false);
    const after = await (
      await request.get('/api/me/following?itemType=request', {
        headers: await as('finance-controller'),
      })
    ).json();
    expect(after.items.some((i: { itemId: string }) => i.itemId === r.id)).toBe(false);
  });

  test('a director cannot read the discussion of another director\u2019s request', async ({
    request,
  }) => {
    const { team } = await directorTree(request);
    const r = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(10_000)),
      201,
      RequestDetail,
    );
    await expectProblem(await discussion(request, 'employee', 'request', r.id), 404, 'NOT_FOUND');
    await expectProblem(
      await comment(request, 'employee', 'request', r.id, { body: 'Hello?' }),
      404,
      'NOT_FOUND',
    );
  });
});
