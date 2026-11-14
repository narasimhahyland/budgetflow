# Fix: notification feed paging (screen 123)

`GET /api/notifications` loaded the newest 200 rows for a person, filtered tab, area, unread and
period in memory, and always returned `nextCursor: null`. Older notifications could not be reached,
and the unread, mentions and following counts were wrong once a person had more than 200.

## What changed

- `libs/api/channels/src/lib/channels.service.ts` (`listNotifications`): tab, area, unread and period
  filter in the SQL `WHERE`; keyset paging newest first on `(created_at, id)` (fetch `limit + 1` to
  know whether a next page exists); counts from one `count(*) filter (...)` aggregate over the
  person's rows in the 90-day window. `nextCursor` is opaque base64url of
  `<created_at UTC to the microsecond>|<id>`; a cursor that does not decode is 400
  `VALIDATION_FAILED` on `cursor`. The response contract is unchanged; the existing
  `(tenant_id, recipient_person_id, created_at)` index serves the query, so there is no migration.
- `libs/web/features/mobile/src/lib/notifications.page.ts`: "Show older notifications" under the
  list loads the next page and appends it; changing a filter starts again from page one; marking
  read or unread updates already loaded older rows.

## Functional outcomes

Stack: `scripts/stack.sh up && scripts/stack.sh reset` on this worktree's ports (API 39000, web
39200), deterministic seed. Roles: department head (API scenario), budget owner (comment author),
finance controller (journey), regional manager (scope check).

| Scenario                                                                   | Expected                                                        | Actual                    | Result |
| -------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------- | ------ |
| 220 real @mentions + 40 test notifications for one person, All paged by 50 | every row in the window once, newest first, full pages but last | equals the database count | pass   |
| Counts on every page                                                       | unread, mentions, following equal the database totals           | equal on every page       | pass   |
| Mentions tab paged by 37; Following tab                                    | only that type, as many as its count                            | as expected               | pass   |
| Area `approvals` paged by 7, area `discussion` paged by 45                 | only that area, equal to the database count per area            | as expected               | pass   |
| Unread only paged by 60 after marking every third mention read             | equals the unread count, none of the marked rows                | as expected               | pass   |
| Mentions + discussion + unread combined, paged by 25                       | equals the database count; all 146 unread new mentions included | as expected               | pass   |
| Tampered cursor                                                            | 400 `VALIDATION_FAILED`                                         | 400 `VALIDATION_FAILED`   | pass   |
| Another person's feed                                                      | shares no rows                                                  | no shared rows            | pass   |
| Journey: finance controller with 75 notifications opens `/notifications`   | 50 rows, unread badge = API total, "Show older notifications"   | 50 rows, badge 75, button | pass   |
| Journey: click "Show older notifications" until it is gone                 | all 75 rows, button hidden, badge unchanged                     | 75 rows, button hidden    | pass   |
| Existing channels scenarios (26) and the existing notifications journey    | unchanged behaviour                                             | pass                      | pass   |

Proof: `apps/api-e2e/src/channels/notification-paging.spec.ts` (invariant 126 in
`docs/testing/invariant-scenarios.md`) and "notifications feed paging (123)" in
`apps/web-e2e/src/channels/channels.spec.ts`. Every API response in the scenario is validated
against `NotificationsFeed` from `libs/contracts`. The scenario cannot pass on the old code: that
code returned at most 200 rows and no cursor, and the person has more than 260.

Screenshots: [`functional/01-first-page-show-older.png`](functional/01-first-page-show-older.png)
(the first page ends with "Show older notifications") and
[`functional/02-older-page-loaded.png`](functional/02-older-page-loaded.png) (75 rows, button gone).

## Gates

`scripts/gate.sh all --evidence evidence/fix-notification-feed-paging`: every step passed
([`gate-summary.txt`](gate-summary.txt)), including functional-api, functional-e2e and visual.
Visual baselines are unchanged: seeded feeds fit on one page, so the new button does not render in
any baseline state.
