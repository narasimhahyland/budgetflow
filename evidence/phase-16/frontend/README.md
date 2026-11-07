# Phase 16 — ecosystem, frontend

The five surfaces that face outside BudgetFlow, built on the Phase 16 contract merged in
`0019_p16_ecosystem`: the BI connector (092a), the connector for AI assistants (092c), no-code
automations (092b), the partner marketplace (092d) and embeddable widgets (102d).

Native app wrappers (115a) are deferred by product decision and were not built; `apps/mobile` does
not exist and the Phase 8 PWA routes continue to serve mobile.

Stack: local Docker Compose, compose project `bf-p16-ui`, web on 4500, API on 3300, deterministic
seed (`scripts/stack.sh reset`).

## Screens and their states

| Screen                             | Route                             | States proved                                                                                                                  |
| ---------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 092a BI connector (administration) | `/admin/integrations/bi`          | loading, error with retry, forbidden, read-only ("needs report access"), connector off, dataset on/off, field reference        |
| 092a My BI connections             | `/me/bi-connections`              | loading, error, empty, connect form, token shown once, active, expiring soon, expired, revoked                                 |
| 092c Connector for AI assistants   | `/admin/integrations/assistants`  | loading, error, forbidden, connector off, AI feature switch off (degraded), tools on/off, consent, revoked                     |
| 092c My connected AI assistants    | `/me/ai-assistants`               | loading, error, empty, consent, token shown once, revoked                                                                      |
| 092b No-code automations           | `/admin/integrations/automations` | loading, error, forbidden, no platform allowed, platform allowed / not allowed, triggers not delivered, consent, revoked       |
| 092b My automations                | `/me/automations`                 | loading, error, empty, consent, token shown once, revoked                                                                      |
| 092d Marketplace partners          | `/admin/integrations/partners`    | loading, error, empty, read-only, enabled, paused, no approved vendor (Enable disabled with the reason), sync result           |
| 092d Marketplace browse            | `/marketplace`                    | loading, error, no offers, filtered-to-nothing, offer cards, bookings empty, waiting for partner, quoted, declined, cancelled  |
| 092d Offer detail                  | `/marketplace/offers/:offerId`    | loading, error, not found, read-only, booking form, group outside the partner's capacity, quote requested                      |
| 102d Embeddable widgets            | `/admin/widgets`                  | loading, error, empty, read-only, active, paused, no allowed site, invalid address, refused embeds listed, embed snippet       |
| 102d Widget embed frame            | `/embed/:widgetId`                | loading, site not allowed, widget paused, widget removed, no team budget, team budget, upcoming events, BudgetFlow unavailable |

Every screen is responsive at 1440 (desktop), 834 (tablet) and 412 (mobile); light theme only.

## How the security rules are presented

**Token secrecy.** A connection token exists on screen once, in the create response, inside the
`bf-one-time-secret` panel the project already uses for API keys: "Copy this connection token now.
You will not see it again. BudgetFlow stores only a hash of it." The panel will not close until the
person confirms they stored it. Every connection list carries a standing note saying the same thing,
and the list itself renders only what the contract returns — label, client, grants, made, last used,
expires, status, calls in 7 days. `EcosystemConnectionView` carries no token and no prefix, so there
is nothing to render and no reveal endpoint is implied. The journey asserts the token string is
absent from the page after the panel is dismissed and absent from the API's own connection payload.

> The backend stores a `tokenPrefix` but does not expose it. The brief expected the UI to show a
> prefix; it cannot, because the contract has no field for it. Showing a created and last-used
> indicator instead is what the merged API actually supports. An additive `tokenPrefix` on
> `EcosystemConnectionView` would let the UI identify a connection by its prefix as well.

**Revoked and degraded states.** `CONNECTION_STATUS_TONES` gives revoked and expired an important
tone, never a success one, the row is dimmed, the Revoke action disappears (the API refuses a second
revoke with 409), and each row states the consequence: "Calls from this tool fail with 'Access
revoked'. The token can never be used again." A paused partner and a paused widget are dimmed the
same way. The assistant connector shows "Not working" when the connector is on but the `ai.mcp`
feature switch of 113a is off, rather than reporting a healthy connector.

**Widget origins.** The widgets screen opens with the rule, not a hint: a widget never carries an
identity, the viewer signs in themselves, the embedding page cannot name a person, a team or a
budget, no key or token is placed in it, and the allowed-site list decides where the frame may
render and nothing else does. The list is rendered as addresses, never prose. An empty list is
refused by the form with "At least one site is required. With none, the widget is embeddable
nowhere," and a wildcard is refused with the reason. Each widget shows the exact
`Content-Security-Policy: frame-ancestors …` it is served with. Refused embeds are listed per widget
with the address and the attempt count, with an explicit "Allow this site" action so a missing entry
is added deliberately. The embed frame itself, asked for from a site that is not on the list, says
so and states that no data has been read.

**The assistant is read-only.** The 092c page leads with a "Read-only by design" panel carrying the
API's own `neverDoes` lines plus two more: there is no tool that approves, submits, applies a
control, creates anything or moves money; and a lookup outside what the person can see answers "Not
found in budgets you can see", the same answer a record that does not exist gets. Every tool row
carries a Read-only tag. The page offers no action the connector cannot perform — there is no draft,
no approve, no apply. The journey asserts the tag on every tool row the API returns and that the
screen never offers to approve, submit or freeze.

**Marketplace content is sample data.** Both the administration screen and the browse screen open
with "These partners are sample data … nothing here is a commercial arrangement with a real
company." A booking request is described everywhere as a request for a quote that becomes a
commitment only through selection on the event and the usual approval route; BudgetFlow processes no
payments and partner invoices go through the actuals review.

## Journeys

`apps/web-e2e/src/ecosystem/ecosystem.spec.ts`, 12 journeys:

| Journey                                                                            | Role              |
| ---------------------------------------------------------------------------------- | ----------------- |
| the connector states what it can read and what it can never do                     | integration-admin |
| a connection token is shown once, and a revoked connection does not look healthy   | analyst           |
| the connector is presented as read-only and offers no action it cannot perform     | integration-admin |
| the consent a person gives says the assistant cannot change anything               | integration-admin |
| platforms carry their allowed state and triggers say they are not delivered yet    | integration-admin |
| a partner without an approved vendor cannot be enabled, and says why               | integration-admin |
| syncing a partner says what it moved and that nothing reached the ledger           | integration-admin |
| an organizer asks a partner for a price and gets a quote, not a commitment         | event-organizer   |
| the allowed-site list is presented as the boundary it is                           | integration-admin |
| a site that is not on the list is refused, listed with its address, and never free | integration-admin |
| the embed frame refuses a host that is not on the list, and says why               | integration-admin |
| an admin of another company gets nothing from this company's widget                | globex-admin      |

The cross-tenant journey signs `globex-admin` in through the real sign-in page and opens an Acme
widget's embed route: the answer is "This widget no longer exists", not "you may not see this",
which would confirm it exists. The journey also asserts the widget's name and any figure are absent
from the page.

Subjects are created by the journey and then referred to by id, never found by a mutable status, and
the widget journey deletes the widget it made.

## Verification

| Check                      | Result                                                                         |
| -------------------------- | ------------------------------------------------------------------------------ |
| `scripts/gate.sh` (all)    | see `gate-summary.txt`                                                         |
| Phase 16 journeys, desktop | 12 passed                                                                      |
| Full visual suite          | 679 passed, twice in a row with no reseed between the runs (`visual-runs.txt`) |
| `scripts/secret-scan.sh`   | clean on every commit (pre-commit hook) and on the final tree                  |

**Visual baselines.** 51 new baselines for the Phase 16 screens at three viewports. 123 existing
baselines changed, all of them the navigation rail gaining its Phase 16 entries; the before/after
pair in `baseline-review/` shows the only difference on an unrelated screen. The 16 known-red
`080e-period-close` states of issue #73 passed in both full runs; seven of their tablet baselines are
among the 123 that changed, for the navigation rail alone, so they will conflict with the fix on
`fix/080e-period-close-visual` and the integrator should take that branch's content with this
branch's rail.

**One visual state was rewritten after review.** The embed state first asked for a real widget from
a host that is not on its list. That is refused _and recorded_, and the widget administration screen
then showed the refusal, so the baselines passed once and failed on the next run with a different
attempt count. The state now asks for a widget that does not exist, which is refused before anything
is written. The origin refusal keeps its journey and its screenshot in `screens/`.

**Two defects were found by opening the regenerated baselines.** The embed refusal said the same
sentence twice (the headline and the API's detail), and the widget list paired a view count with a
masked timestamp that rendered as a large blank block. Both were fixed and the baselines regenerated.

## Paths

- `screens/` — one full screenshot per surface from the running stack, as the role named in the file
- `baseline-review/` — a before/after pair showing what changed on an unrelated screen
- `gate-summary.txt` — `scripts/gate.sh` output
- `visual-runs.txt` — the two consecutive full visual runs
- `journeys.txt` — the Phase 16 journey run

## Not built

- **Native iOS and Android wrappers (115a).** Deferred by product decision; the spec is marked
  deferred and `apps/mobile` does not exist.
- **A live widget inside the embed frame.** The content endpoint decides from the `Origin` header,
  and a browser sends no `Origin` on a same-origin GET — the web container proxies `/api`, so the
  app's own calls carry none and are refused. Verified against the running API: no `Origin` → 403, an
  allowed origin → 200, a disallowed origin → 403. The frame therefore renders its refusal state in
  the app today. Every other state is implemented and will render as soon as the API accepts a
  first-party request from its own embed route, which is a backend change and outside this task.
- **Signing in from inside the frame.** 102d describes a pop-up sign-in for a signed-out viewer; the
  embed route keeps the ordinary guards instead, so the viewer's identity always comes from their own
  session. The pop-up flow is not built.
- **Trigger delivery for automations (092b).** The backend reports `deliveryAvailable: false` for
  every trigger. The UI lists the catalogue and says plainly that nothing is delivered yet.
