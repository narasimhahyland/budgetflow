# Phase 12 — webhook fan-out delivered events that predated the endpoint

## What was wrong

`WebhooksService.fanOutFromOutbox` selected every endpoint subscribed to the event type and gave each
one a pending delivery. Nothing compared the outbox message against the endpoint, so an endpoint
registered today received whatever was still unpublished in the outbox — events raised before it
existed and that its owner was never authorised to see.

It surfaced as visual-test instability because `seedIntegrations` runs after `seedBudgets`: the four
`budget.*` events the seeded endpoint subscribes to are all created before the endpoint is. Whether
its delivery log held rows or not depended purely on whether the worker drained the outbox before or
after the endpoint appeared, which is why two resets on the same commit gave 4 deliveries and then 0.

## The fix

`fanOutFromOutbox` takes the outbox row's `created_at` and skips endpoints created after it
(`lte(webhookEndpoints.createdAt, messageCreatedAt)`); the worker passes `m.createdAt` from the row
it is draining.

No migration. Both timestamps already exist and both are assigned by the same Postgres `now()`, so
the comparison orders two database timestamps rather than two machine clocks. `outbox_messages` has
no monotonic sequence to prefer over them; adding one would have meant a new column on the outbox
plus a watermark column on `webhook_endpoints` for data that is already there.

## Scenario

`apps/api-e2e/src/integrations/outbound-webhooks.spec.ts` — "an endpoint receives events from after
it was registered, never the backlog before it": freeze budget A, register the endpoint, freeze
budget B. The endpoint must receive B and never A.

| Check                                             | Expected                            | Actual                              | Result |
| ------------------------------------------------- | ----------------------------------- | ----------------------------------- | ------ |
| Event raised after registration is delivered      | receiver gets `budget.frozen` for B | receiver gets `budget.frozen` for B | pass   |
| Event raised before registration is not delivered | receiver has no delivery for A      | no delivery for A                   | pass   |
| Delivery log subjects                             | only B                              | only B                              | pass   |
| Full `src/integrations` suite                     | 61 passed                           | 61 passed                           | pass   |

The negative is not a timeout. The drain publishes a tenant's outbox in `created_at` order and sends
each delivery in turn, so A's message was already offered to the fan-out by the time B's delivery
reached the receiver. Its absence is a decision, not a message still in flight.

## The scenario is not vacuous

Run under a forced backlog: the worker is paused for both freezes and the registration, then released,
so both messages drain with the endpoint already present. This is the exact race, made deterministic.

```
# with the fix
worker paused (outbox cannot drain) / worker unpaused
  ✓ an endpoint receives events from after it was registered, never the backlog before it (5.9s)
  1 passed

# with lte(webhookEndpoints.createdAt, messageCreatedAt) removed, api+worker rebuilt and restarted
worker paused / worker unpaused
  ✘ an endpoint receives events from after it was registered, never the backlog before it (6.0s)
    expect(later!.body?.data).toMatchObject({ budgetId: b.id })
    - "budgetId": "be7c7634-62ad-44d8-924b-04587d4daecf"   <- B, expected
    + "budgetId": "e4a2e20c-3f3c-4756-96ae-8b0234d8f83a"   <- A, the backlog event it should never see
  1 failed
```

The first delivery the endpoint received without the fix was budget A's freeze — the event raised
before it was registered.

## The delivery log is deterministic across reseeds

`scripts/stack.sh reset` three times on this commit, counting after the worker settled
(`tmp/delivery-count.sh`):

| Reset | Deliveries to the seeded endpoint | `budget.*` outbox events | Events predating the endpoint |
| ----- | --------------------------------- | ------------------------ | ----------------------------- |
| 1     | 0                                 | 4                        | 4                             |
| 2     | 0                                 | 4                        | 4                             |
| 3     | 0                                 | 4                        | 4                             |

0 is the correct answer, not a lucky drain: all four seeded `budget.*` events are created before the
seeded endpoint, so none of them are its to receive. The previous 4-or-0 coin flip is gone.

## Sibling outbox consumers

Checked every consumer of the drain.

- `notifications` (email), `contributions` (budget control), `spend` (budget alerts),
  `reports` (scheduled delivery) — each job carries the business id it acts on and resolves a single
  subject. No subscriber set, no backlog exposure.
- `integrations` SCIM and connector pushes do not consume the outbox: SCIM is inbound from the
  identity provider, and a push targets a connection the user or a schedule picked.
- `channels` (Phase 8) `deliverChannelJob` is the one relative: it resolves the tenant's currently
  connected chat installations and the recipient's account links at delivery time, so a Slack
  installation connected while a message sits queued would carry that message. It is a different
  shape and much narrower — the job is addressed to one recipient who already holds the in-app
  notification, so nothing reaches a party who was not already entitled to it, and the exposure
  window is one drain interval rather than the whole backlog. Fixing it would need a watermark on
  `chat_installations`, which is not the same small change. Reported, not fixed.

## Observations, not fixed here

- Every fanned-out event leaves two `webhook_deliveries` rows: the `pending` row the fan-out writes
  and the attempt row `deliver()` writes. The `pending` row is never resolved, so the delivery list
  shows a stale queued row beside each sent one. Pre-existing Phase 12 behaviour, out of scope.
- With the fan-out correct, the seeded endpoint's delivery log is legitimately empty, so screen 101
  now shows its empty state. If the demo wants a populated log, the seed should insert delivery rows
  directly — deterministic — rather than depending on the fan-out seeing seed-time events.

## Commands

```
scripts/gate.sh static --affected
npx playwright test --config apps/api-e2e/playwright.config.ts src/integrations
scripts/stack.sh reset                       # x3, counting deliveries after each
```

Stack on shifted ports (api 3100, postgres 5532, keycloak 8180, mocks 4110) so the `bf-demo` stack
on the default ports was left running throughout.
