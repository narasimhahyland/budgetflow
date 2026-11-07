# Phase 14 — Experience and Administration, front end

Screens, journeys and visual baselines for the merged Phase 14 administration API
(`/api/admin/*`, `/api/me/features`, `/api/me/activity`). Branch `feat/p14-admin-ui`.

Local stack: Compose project `bf-p14-ui` (web 4440, API 3240, Keycloak 8320, Postgres 5672,
Mailpit 8265, MinIO 9240, mock providers 4240), deterministic seed, stack stopped after the runs.

## Screens delivered

| Screen                                  | Route                      | States covered                                                                                                                                                                                                |
| --------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 105 Feature flags                       | `/admin/features`          | loading, empty search, error, forbidden, read-only, default, pilot, switch form, waiting for a second person, decision form, change history                                                                   |
| 111 Data retention and legal holds      | `/admin/retention`         | loading, error, forbidden, read-only, default, locked category, waiting for a second person, place-hold form, hold in force / not in force / released, preview, typed-DELETE confirm, empty holds, empty runs |
| 103 Users and roles                     | `/admin/users`             | loading, empty search, error, forbidden, default, manage-roles panel, grant waiting for a second person, revoke form                                                                                          |
| 103a Invite budget owners               | `/admin/users/invitations` | loading, error, forbidden, capability off, capability shown but not allowed, draft list, empty tracking, sent                                                                                                 |
| 102b / 109 / 110 / 112 Company settings | `/admin/settings`          | loading, error, forbidden, read-only, default, branding form, notification form, document form, security form, success                                                                                        |
| 114 System health and maintenance       | `/admin/health`            | loading, error, forbidden, default, degraded service, empty queues, schedule form, cancel form, active maintenance banner                                                                                     |
| 010a Setup checklist                    | `/admin/setup`             | loading, error, forbidden, in progress, all done                                                                                                                                                              |
| 122 My activity                         | `/my/activity`             | loading, error, default, filtered, empty filter                                                                                                                                                               |

## How a waiting two-person change is shown

`bf-pending-change` (`libs/web/features/admin/src/lib/admin-ui.ts`) is the only way this product
renders `applied: false`. It always receives the value **in force today** and prints, in this order:
a `Waiting for a second person` tag, "**&lt;value in force&gt;** is still in force", "Requested:
&lt;summary&gt;. This has not taken effect.", and who asked, when and why. The row's own state cell
keeps showing the value in force and the edit action disappears while a change waits, so there is no
place on the screen where the requested value is displayed as the current one.

Proven by:

- `feature flags (105) … shows the state still in force next to the change waiting for a second person`
- `a money-affecting switch takes two people … the flag stays off and the request is recorded as waiting`
- `data retention … a shortened financial period waits, and the old one stays in force`
- `users and roles (103) … a grant beyond the requester's own authority waits, and the roles stay as they were`

The requester never sees a confirm button (the component compares the requester with the signed-in
person and the API refuses it as well); they get "Withdraw request" instead.

## How `on` versus `allowed` is handled

`GET /api/me/features` drives every capability decision. A capability is rendered only when
`on && allowed`:

- the users screen shows "Invite budget owners" only when both are true;
- the invitations screen shows the form only when both are true, and otherwise says which of the two
  is missing;
- the feature flags screen carries a "How you see these capabilities" table with three separate
  columns — _Shown to you_ (`on`), _Allowed for you_ (`allowed`) and _You can use it_ (both) — so a
  flag is never read as permission.

Proven by `a capability that is on is still not permission`: the Finance Admin switches bulk owner
invites on, the flag reads `On`, their own capability row reads "No — shown but not allowed", and
`/admin/users/invitations` refuses them.

## Retention: preview, then type DELETE

Previewing is open to administrators and the Finance Controller; applying needs `retention.confirm`,
so administrators see "Applying a run is irreversible, so only a Finance Controller can do it"
instead of a button the API would refuse. The apply panel leads with an `important` banner ("There
is no undo, no recycle bin and no way to restore them from BudgetFlow"), and the button stays
disabled until the word `DELETE` is typed exactly (`delete` is rejected by the UI and by the API).

`RetentionPolicy.automation` is a column of its own ("Applied nightly" vs "Stated policy only", with
"No job removes this today." under the latter) and `signoffStatus` is a second column, with the card
hint saying all twelve periods are provisional defaults pending finance and legal sign-off.

## Legal holds

Each hold states what is held, who placed it, who confirmed it, and whether it is **in force**:

- `pending_confirmation` → "Not in force yet" plus "Records in this scope are not protected yet. A
  second person who may manage legal holds has to confirm it, and it cannot be the person who placed
  it." The author is not offered the confirm button.
- `active` → "In force" plus "Nothing in this scope is deleted or anonymised while the hold is in force."
- `released` → "Released" plus "records in this scope can be removed again", with who released it and why.

## Gates and checks

| Check              | Command                                                            | Result                        |
| ------------------ | ------------------------------------------------------------------ | ----------------------------- |
| Static gate        | `scripts/gate.sh static`                                           | PASS (see `gate-summary.txt`) |
| Journeys           | `playwright test apps/web-e2e/src/admin` (desktop, tablet, mobile) | 65 passed (`journeys.log`)    |
| Visual, full suite | `npm run e2e:visual`                                               | 692 passed (`visual-run.log`) |

## Risks and follow-ups

- `011a-ai-assistant-panel` (Phase 13) was flaky on tablet and mobile: the per-call AI query-log id
  changed the width of the provenance line and rewrapped it, moving everything below. Fixed here by
  giving the id a fixed-width box in `libs/web/features/ai/src/lib/ai-output.ts` and by masking
  `[data-testid=ai-ids]` globally, which the component already asked for in a comment.
- `090-approval-history` baselines contained the seed's own insert timestamps, which move on every
  reseed; the decision column is now masked.
- `050-event-approval-workflow` on mobile captured at a varying scroll offset; the state now resets
  the scroll before the shot.
- `000a-app-shell placeholder` was removed: no navigation entry renders the placeholder page any
  more, `/admin/settings` was the last one and this phase implemented it.
- The two-person role grant cannot be completed through the UI: confirming needs the money authority
  the role grants, and only `users.manage` (Organization Admin) can open the users screen, which
  holds no financial authority. The screen states this; the backend owns the decision.
