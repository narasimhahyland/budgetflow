# Gap B8: installable app and real Web Push

Package B8 of [`gap-closure-plan.md`](../../docs/gap-closure-plan.md), screens 059a (installable mobile web
app) and 059c (push settings), decision D5. Built and checked on the local stack
`bf-inspiring-ptolemy-87b0e8` (ports 33xxx) with the deterministic seed and the pinned clock (2026-11-16).
Design: [`docs/architecture/web-push.md`](../../docs/architecture/web-push.md).

## What was built

- **Web Push delivery.** Before B8, `ChannelsService.deliverChannelJob` recorded a `push` row and sent
  nothing. Now each registered device gets a `queued` delivery (migration `0029` adds
  `channel_deliveries.push_subscription_id`) and an outbox message. The worker queue `channels.push.send`
  then:
  - encrypts the message to the device (RFC 8291 `aes128gcm`);
  - signs it with a VAPID JWT for the push service's origin (RFC 8292), both on `node:crypto` (no new
    dependency);
  - posts it with TTL and Urgency.
- **Outcomes.**
  - 2xx: `sent`.
  - 404 or 410: `gone`; the subscription is removed and the removal audited.
  - 429, 5xx or unreachable: `retried` with exponential backoff and jitter, then `dead_letter`, and the
    job goes to `integrity.dead-letter`.
  - Other 4xx or bad keys: `failed`.
  - A settled delivery is skipped under a row lock, so a re-run sends once.
- **Privacy.** The lock-screen rule (`showAmountsInPush`) is kept: by default the title and body name
  the request and the person, not the amount.
- **Safety.** Endpoints must be on `PUSH_ALLOWED_HOSTS`: registration is 422 `OUTBOUND_HOST_NOT_ALLOWED`
  otherwise, and plain http works on the local stack only. A push test with no device is 409
  `PUSH_DEVICE_NOT_REGISTERED`.
- **Keys (D5).** Locally a public development VAPID key is used (`BF_ALLOW_DEV_SECRETS=true`).
  Production refuses to start without `VAPID_PRIVATE_KEY`. No key is committed.
- **Installable app.**
  - `manifest.webmanifest` with 192, 512 and maskable icons.
  - `sw.js` caches the app shell only, never `/api`.
  - Offline start: the shell loads and says "You're offline", with no amount on screen.
  - Connection lost on an open page: a banner says its figures stopped updating, and mobile decisions
    are disabled.
  - The install prompt shows from the second visit, and "Not now" hides it for 30 days; iOS gets the
    Share-menu steps.
  - 059c "Turn on" makes a real `PushManager` subscription with the API's VAPID key
    (`GET /api/me/push-devices/vapid-key`) and sends a test push.
- **Mock push service.** `infra/mock-providers/server.mjs` adds `POST /push/v1/<ok|gone|missing|down>/<id>`.
  It verifies the VAPID JWT and refuses a bad one, records the encrypted body, and
  `/_control/push/received` returns what arrived.

## Outcome table

`scripts/gate.sh all` passed in every mode on commit `e7379dcb`
([`gate-summary.txt`](gate-summary.txt)). The full API suite had 725 passed and 1 skipped (that skip
was already there). Journeys had 692 passed (218 skipped by project scoping). Visual had 1055 passed.
The run lines are in [`functional/gate-runs.txt`](functional/gate-runs.txt). Roles: department head
(approver), regional manager (device owner), budget owner (requester), auditor (audit and no-device
case).

After the gate, the first and third installable journeys were found to wait for approval cards that a
fresh seed does not have. They now wait for the page heading. The fixed journeys passed twice in a row
from a fresh `scripts/stack.sh reset`. The change is test-only and the gate was not re-run.

| Scenario (spec)                                        | Expected                                                                                                             | Actual                                                                                                                                                          | Result |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Approval push, amounts hidden (`push-delivery`)        | one encrypted, VAPID-signed message per assignment; ref shown, no amount                                             | mock answered 201, `vapidValid: true` with the API's key, `aes128gcm`, `urgency: high`; decrypted title has the ref and no `USD`/`550`                          | pass   |
| Approval push, amounts shown after opt-in              | the amount is in the message                                                                                         | decrypted title contains `USD 660.00`; delivery payload `showAmounts: true`                                                                                     | pass   |
| Gone subscription, 410 and 404 (`push-delivery`)       | one attempt, device removed, removal audited with the reason                                                         | delivery `gone`, 1 attempt, 1 arrival; device absent from settings; one `channel.push_device_removed` with the 410 / 404                                        | pass   |
| Failing push service (`push-delivery`)                 | retries with backoff, then the dead letter; device kept                                                              | 4 arrivals with growing gaps; delivery `dead_letter`, 4 attempts, 503; one `integrity.dead-letter` job                                                          | pass   |
| Worker re-run (`push-delivery`)                        | a redelivered job for a sent delivery sends nothing                                                                  | second `channels.push.send` job completed; still 1 arrival; delivery `sent`, 1 attempt                                                                          | pass   |
| No device, host not allowed, re-subscribe              | 409, 422, same device id                                                                                             | 409 `PUSH_DEVICE_NOT_REGISTERED`, 422 `OUTBOUND_HOST_NOT_ALLOWED`, same id                                                                                      | pass   |
| Production without `VAPID_PRIVATE_KEY` (`dev-secrets`) | API and worker refuse to start and name the variable                                                                 | both print `VAPID_PRIVATE_KEY is not set`; with real secrets or the local opt-in both start                                                                     | pass   |
| Installable (journey, mobile)                          | manifest with 192 and 512 PNG icons; `sw.js` controls the page                                                       | as expected                                                                                                                                                     | pass   |
| Offline (journey, mobile)                              | cache holds the shell and no `/api`; open page labelled and decisions disabled; offline start says so with no amount | cache has `/index.html` and bundles, no `/api/`; banner and disabled Approve/Reject; "You're offline" with no currency on screen; back online it signs in again | pass   |
| Push display (journey, mobile)                         | the worker shows the message with its title, body, tag and same-origin URL                                           | `showNotification` received exactly the delivered fields                                                                                                        | pass   |
| Visual 059a install and offline (new baselines)        | inspected at 412, 834, 1440                                                                                          | inspected; "Not now" wrapping fixed before the baseline was kept                                                                                                | pass   |

Screenshots: [`offline-start.png`](functional/screenshots/offline-start.png),
[`offline-open-page.png`](functional/screenshots/offline-open-page.png),
[`059a install`](functional/screenshots/059a-mobile-web-approvals--install--mobile.png),
[`059a offline preview`](functional/screenshots/059a-mobile-web-approvals--offline--mobile.png).
Invariant rows 129 and 137-141 are in
[`invariant-scenarios.md`](../../docs/testing/invariant-scenarios.md).

## Shared surfaces touched (additive)

- `libs/contracts`:
  - delivery status adds `gone` and `dead_letter`;
  - `pushSubscriptionId` on the delivery log and its query;
  - `PushVapidKey` and its endpoint;
  - `TestChannelResponse.status` adds `queued`;
  - problem code `PUSH_DEVICE_NOT_REGISTERED`;
  - regenerated `openapi.json`.
- `libs/api/db`: migration `0029` and journal idx 27.
- `infra/compose.yaml`: `VAPID_PRIVATE_KEY` and `PUSH_ALLOWED_HOSTS` on the API and the worker.
- `infra/docker/nginx.conf`: `sw.js` with `no-cache`, and the manifest type.
- `infra/mock-providers/server.mjs`: the push routes.
- `apps/web-e2e/playwright.config.ts`: `serviceWorkers: 'block'` for every journey except the
  installable-app ones, so earlier journeys and baselines load exactly as before.
- `apps/web-e2e/visual/screens.json`: 059a `install` and `offline` states. Visual baselines updated: new
  059a install and offline states (6 new PNGs, no existing baseline changed).

## Not built, and limits

- Quiet hours and the matrix's per-type Push column do not gate sending yet. Push followed neither
  before B8.
- 059a's offline read-only copy of the last approvals list is not built. Tokens live in memory only, so
  an offline start has no session to read with; the shell says it is offline instead.
- Headless Chromium refuses notification permission and cannot subscribe to a real push service. So:
  - the push journey delivers a real push event to the real service worker through CDP and records
    `showNotification`;
  - turning push on from the 059c page in a real browser is not covered by a journey;
  - the end-to-end send is proven by the API scenarios against the mock push service.
- `infra/.env.example` could not be edited from this session (permission settings deny it). Compose
  defaults `BF_VAPID_PRIVATE_KEY` to empty, which selects the development key locally.
- `npm audit --omit=dev`: 2 high findings in `multer`. They were there before this change, which adds no
  dependency.
