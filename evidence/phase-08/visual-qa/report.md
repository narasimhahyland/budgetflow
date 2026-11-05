# Phase 8 visual QA — channels, discussions and the phone app

Light theme only (dark theme deferred). Every screenshot below is the visual-regression baseline
produced inside the pinned Playwright image (`mcr.microsoft.com/playwright:v1.64.1-noble`) against the
isolated Phase 8 stack with the deterministic seed, at desktop (1440x900), tablet (834x1112) and
mobile (412x915).

## Result

| Check                                                      | Result                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------- |
| `npm run e2e:visual` (all 275 screen states, pinned image)  | 275 passed, 0 failed                                                  |
| Reproducibility (regenerate, then verify against the stack) | 275 passed again with no pixel drift                                  |
| Horizontal overflow, console errors, failed requests        | none on any Phase 8 route at all three viewports                      |
| Blocking findings                                           | none outstanding (3 found and fixed, below)                           |

Baselines were regenerated with `npm run e2e:update-snapshots` because Phase 8 changes the shared
shell (new Channels, Digests, Notifications and Following entries) and adds the Discussion and Follow
bar to budget, event and request details, which changes the height of those full-page captures.
36 baselines are new (the Phase 8 screens), 89 were updated for those two reasons.

## Blocking findings found and fixed

1. **Layout shift on budget, event and request details.** The Discussion and Follow bar grew taller
   once its thread loaded, pushing the whole page down and making every full-page capture of those
   screens non-deterministic. The bar now renders a disabled Follow button while the thread loads, so
   it occupies its final height from first paint.
2. **Approve rendered as a destructive action.** The Slack and Teams card preview and the phone
   approval detail used `satImportantButton` on the filled Approve button, painting the primary,
   non-destructive action in the loud red reserved for Reject elsewhere in the product (see
   `libs/web/ui/src/lib/decision-form.ts`). Approve is now the plain filled primary button; Reject
   keeps the important treatment.
3. **Overflow on notification channels (059c).** The channel rows ran past the right edge of the
   Channels card, clipping "Send a test notification" and "Unlink". `.bf-list__item` is content-box
   with 20px side padding, so `width: 100%` overran by exactly 40px; the row is now border-box.

A non-blocking follow-up: the same content-box `width: 100%` on `.bf-list__item`
(`libs/web/ui/src/styles/page-layout.scss`) will clip any list row whose content reaches the card
edge. It is fixed locally on the Phase 8 screen rather than globally, because changing it would shift
baselines across every phase.

## Screens

| Screen | State | Viewports |
| --- | --- | --- |
| 059a Mobile web approvals | default | desktop, tablet, mobile |
| 059b Mobile balance check | balance | desktop, tablet, mobile |
| 059b Mobile receipt capture | receipt | desktop, tablet, mobile |
| 059c Notification channels and push | default | desktop, tablet, mobile |
| 060a Comments, mentions and follow | following | desktop, tablet, mobile |
| 061b Slack approval card (Block Kit) | default | desktop, tablet, mobile |
| 061c Teams approval card (Adaptive Card 1.5) | default | desktop, tablet, mobile |
| 061d Chat balance, quick request and alerts | app-home | desktop, tablet, mobile |
| 061e Slack and Teams app setup and linking | default | desktop, tablet, mobile |
| 064a Role-based digest templates | default | desktop, tablet, mobile |
| 123 Notifications and tasks | default, tasks | desktop, tablet, mobile |

Files are `screens/<id>--<state>--<viewport>--light.png`.

## Note on the standalone capture script

`scripts/visual/capture.mjs` could not be used for this pack: it freezes the clock at the
`freezeTime` in `apps/web-e2e/visual/screens.json` (2026-11-16), which is far enough ahead of a
freshly issued Keycloak token that the SPA treats the session as expired and redirects to the sign-in
page, so every capture times out waiting for its ready selector. The overflow, console-error and
failed-request checks it would have run were done separately against the same stack with the same
roles and viewports and came back clean.
