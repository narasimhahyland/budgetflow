# Installable app and Web Push (B8)

Screens 059a (installable mobile web app) and 059c (push settings). Decision D5 in
[`gap-closure-plan.md`](../gap-closure-plan.md).

## Installable app

- `apps/web/public/manifest.webmanifest` (start URL `/m/approvals`, standalone, 192, 512 and maskable icons)
  and `apps/web/public/sw.js`, registered from `apps/web/src/main.ts` in production builds only.
- The service worker caches the **app shell only**: `index.html`, the hashed bundles, fonts, icons and the
  manifest. It never intercepts `/api/*`, `/health`, the sign-in service or any other origin, so budgets,
  balances and approvals always come from the network and are never shown from an earlier visit.
- Started with no connection, the shell loads and the sign-in-problem page says "You're offline". It
  retries when the connection comes back and returns to the page that was asked for. A page that was
  already open shows the shell's offline banner ("figures ... are not updating") and the mobile approval
  actions are disabled. Decisions are never queued offline.
- The install prompt (`InstallPrompt` in `libs/web/data-access`) is offered from the second visit, never
  when already installed, and "Not now" hides it for 30 days. On iOS it explains the Share menu steps.
- nginx serves `sw.js` with `Cache-Control: no-cache`, so a release replaces the worker promptly. Bump
  `SHELL_VERSION` in `sw.js` when its caching rules change.

## Web Push delivery

- Notifications that reach a person's push channel become one `channel_deliveries` row per registered
  device (`status = queued`, `push_subscription_id`). They are written in the same transaction as the
  notification, together with an outbox message on `channels.push.send`.
- The worker sends each delivery (`ChannelsService.sendPushDelivery`) with RFC 8291 `aes128gcm`
  encryption and an RFC 8292 VAPID JWT, implemented on `node:crypto` in
  `libs/api/channels/src/lib/web-push.ts` (no extra dependency). Outcomes:
  - 2xx: `sent`.
  - 404 or 410: `gone`. The subscription is deleted and the removal is audited
    (`channel.push_device_removed` by `system:worker`).
  - 429, 5xx or unreachable: `retried`. pg-boss retries 3 times with exponential backoff and jitter
    (`PUSH_RETRY_DELAY_SECONDS`, default 2), then marks the delivery `dead_letter` and moves the job to
    `integrity.dead-letter`.
  - Anything else (bad keys, a host not allowed, other 4xx): `failed`, never retried.
- The delivery row is locked while it is sent. A delivery that is no longer `queued` or `retried` is
  skipped, so a re-run job sends nothing.
- Lock-screen privacy: unless the person turned on "Show amounts in push notifications", the title and
  body leave out the job's amount and any `<ISO code> <number>` figure. The stored payload is exactly what
  was sent.
- Integration admins and auditors see push deliveries in the channel delivery log
  (`GET /api/channels/deliveries?channel=push`). Each person sees only their own.

## Configuration

| Variable                   | Meaning                                                                                                                                                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VAPID_PRIVATE_KEY`        | Base64url P-256 private key (32 bytes); the public key is derived from it. Required in production (`secretOrDev`). Locally, a public development key is used when `BF_ALLOW_DEV_SECRETS=true`. Never commit a real key. |
| `VAPID_SUBJECT`            | Contact for the push services (`mailto:` or `https:`).                                                                                                                                                                  |
| `PUSH_ALLOWED_HOSTS`       | Push service hosts the worker may call (`*.` matches subdomains). The default lists the Chrome, Firefox, Safari and Edge services; Compose adds `mock-providers`. Registration rejects other hosts.                     |
| `PUSH_TTL_SECONDS`         | How long a push service keeps an undelivered message (default one day).                                                                                                                                                 |
| `PUSH_RETRY_DELAY_SECONDS` | Base retry delay of the worker queue (default 2).                                                                                                                                                                       |

Changing `VAPID_PRIVATE_KEY` invalidates every existing subscription: browsers must subscribe again.

`apps/api-e2e/src/security/dev-secrets.spec.ts` proves that the API and the worker refuse to start in production
without `VAPID_PRIVATE_KEY` and name the variable.

## Not built yet

- Quiet hours and the per-type Push column of the notification matrix do not gate sending yet.
- The offline read-only copy of the last approvals list (059a) is not built. Tokens are kept in memory,
  so an offline start has no session to read with. The shell says it is offline instead.
