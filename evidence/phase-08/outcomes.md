# Phase 8 — Channels: Slack, Microsoft Teams, actionable email and the phone app

Everything below was proven against the isolated Phase 8 stack (`bf-p8-channels`, offset +80) with the
deterministic seed, through the real API over HTTP with real Keycloak tokens, and through Playwright
journeys against the running web app.

## Business outcomes

| # | Outcome | Proven by | Result |
| - | ------- | --------- | ------ |
| 1 | An approver decides a request from a Slack card and the money moves exactly as it would in the web app | `api-e2e/channels/chat-webhooks.spec.ts` — signed callback approves, request becomes approved, route step records channel `slack` | pass |
| 2 | The same works from a Microsoft Teams Adaptive Card, and rejecting needs a reason code and a reason | `api-e2e/channels/chat-webhooks.spec.ts` — Adaptive Card 1.5 payload, 422 `REASON_REQUIRED` without a reason, rejection carries the text back to the requester | pass |
| 3 | A forged or stale callback changes nothing | `api-e2e/channels/chat-webhooks.spec.ts` — timestamps 6 minutes old and 6 minutes ahead are 401 `CHAT_TIMESTAMP_EXPIRED`; a signature over a different body, with the wrong secret, or with the other provider's secret is 401 `CHAT_SIGNATURE_INVALID`; the request stays pending with no audit entry | pass |
| 4 | Somebody whose chat account is not linked is asked to connect instead of deciding | `api-e2e/channels/chat-webhooks.spec.ts` — `not_linked` with `CHAT_ACCOUNT_NOT_LINKED` and a connect URL | pass |
| 5 | The card never decides; the server does | `api-e2e/channels/chat-webhooks.spec.ts` — a linked person holding no task is 403 `APPROVAL_NOT_ASSIGNED`, one who cannot see the request is 404, and a card opened by anyone else is read-only with no amounts at all when out of scope | pass |
| 6 | Large amounts cannot be approved with one tap in chat | `api-e2e/channels/chat-webhooks.spec.ts` — USD 30,000 returns `step_up` with `DOA_OR_STEP_UP_REQUIRED`, stays pending, and is then decided in BudgetFlow | pass |
| 7 | A retried chat interaction decides once | `api-e2e/channels/chat-webhooks.spec.ts` — the identical payload posted twice leaves exactly one `request.approved` audit entry and one approved step | pass |
| 8 | `/budgetflow balance` and the quick request stay inside the asker's scope and respect budget controls | `api-e2e/channels/chat-commands.spec.ts` — Bengaluru yes, United States no; a quick request pre-encumbers like any other; a frozen budget is 409 `BUDGET_FROZEN` | pass |
| 9 | A chat identity binds to a person only on an exact verified-email match | `api-e2e/channels/chat-commands.spec.ts` — mismatch is 422 `CHAT_LINK_EMAIL_MISMATCH`, a tampered token is 404 `CHAT_LINK_INVALID`, the matching email links | pass |
| 10 | Only the Integration Admin administers the workspace apps | `api-e2e/channels/chat-commands.spec.ts` — the console shows installations, links and the delivery log; a budget owner is 403 | pass |
| 11 | A mention never widens who can see an item | `api-e2e/channels/discussions.spec.ts` — 422 `MENTION_NO_ACCESS` writes nothing; a valid mention creates the approver's in-app notification | pass |
| 12 | Comments are editable for 15 minutes and removal leaves a tombstone | `api-e2e/channels/discussions.spec.ts` — 409 `COMMENT_EDIT_WINDOW_EXPIRED` after the window, 403 for somebody else's comment, removal empties the body while `comment.created` keeps the original text | pass |
| 13 | Read-only roles read the discussion but cannot post | `api-e2e/channels/discussions.spec.ts` — auditor gets `canComment: false` and 403 on post | pass |
| 14 | Following is explicit, and approvers follow their own work automatically | `api-e2e/channels/discussions.spec.ts` — approver `source: owner`, finance controller `source: manual`, unfollow removes it from the list | pass |
| 15 | People choose channels but never switch off an approval assigned to them | `api-e2e/channels/notifications.spec.ts` — 422 `NOTIFICATION_REQUIRED` for in-app and email on required rows | pass |
| 16 | Quiet hours may be extended, never shortened | `api-e2e/channels/notifications.spec.ts` — 22:00–07:00, a later start and an earlier end are 422 `QUIET_HOURS_INVALID`; 19:00–08:30 is accepted | pass |
| 17 | Every push device registration and removal is audited | `api-e2e/channels/notifications.spec.ts` — `channel.push_device_added` and `channel.push_device_removed` | pass |
| 18 | A decision taken on the phone is audited as the mobile channel | `api-e2e/channels/notifications.spec.ts` | pass |
| 19 | A digest renders inside the recipient's own scope, publishes a new version and sends | `api-e2e/channels/notifications.spec.ts` — scoped preview for Rahul Menon in Email, Slack and Teams form, version bump, test email received in Mailpit; a budget owner editing a template is 403 | pass |
| 20 | An approver can work entirely from a phone | `web-e2e/channels/channels.spec.ts` (mobile project, Pixel 7) — waiting list, decision detail with the DoA reason, reject-sheet validation, one-tap approve, balance under this budget's rules, offline receipt queue, alerts | pass |
| 21 | The notification, settings, discussion and following screens work end to end | `web-e2e/channels/channels.spec.ts` — All/Tasks/Mentions tabs, required rows, test notification, mention picker showing who cannot see the budget, Following list | pass |
| 22 | Integration Admin and Finance Admin manage channels and digests from the web app | `web-e2e/channels/channels.spec.ts` — Slack and Teams setup, account linking, Slack and Teams card previews, digest editing | pass |

## Checks run

| Check | Command | Result |
| ----- | ------- | ------ |
| Phase 8 API scenarios | `playwright test -c apps/api-e2e/playwright.config.ts src/channels/` | 24 passed |
| Phase 8 journeys (desktop, tablet, mobile) | `playwright test -c apps/web-e2e/playwright.config.ts src/channels/` | 17 passed, 6 skipped by project |
| Static gates | `scripts/gate.sh static --affected` | secrets, lint, styles, satori, typecheck, build, openapi, db all pass |
| Visual regression (pinned image) | `npm run e2e:visual` | 275 of 275 states pass; see `visual-qa/report.md` |

Invariants 39, 40 and 41 in `docs/testing/invariant-scenarios.md` map to these scenarios.

## Notes

- The full `scripts/gate.sh` matrix is left to CI on the pull request: the local machine ran three
  sibling worktree stacks at once, and concurrent restarts of the shared Docker project repeatedly
  interrupted long local runs. Every mode was run locally at least once and is recorded above.
- A full `scripts/stack.sh reset` must complete its seed before visual baselines are captured; an
  earlier pass captured several screens before the Phase 5 and 6 seed data existed and produced
  baselines with the wrong budget balances. The committed baselines come from a fully seeded stack
  and were verified twice.
