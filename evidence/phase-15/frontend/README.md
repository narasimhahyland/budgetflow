# Phase 15 — extended product, frontend

The Angular screens for the Phase 15 backend in `0018_p15_extended`, merged in #84, with #85 gating
summary drafting on `audit.read` rather than on what data happens to exist. This pack was assembled
after the merge, on 2026-11-10, against `main` at `b2141ae`; it closes the gap noted in
`docs/handoff.md` section 2.1, where 14 and 16 had frontend packs and 15 did not.

Stack: local Docker Compose, compose project `bf-wave-6-closeout`, web on 44200, API on 43000,
Keycloak on 48080, deterministic seed (`scripts/stack.sh reset`).

## Screens and their states

| Screen                              | Route                               | Role             | States captured (desktop)                     |
| ----------------------------------- | ----------------------------------- | ---------------- | --------------------------------------------- |
| 031a What-if scenarios              | `/budgets/scenarios`                | finance-admin    | list, editor, compare-empty                   |
| 011b Leadership summary commentary  | `/insights/summaries`               | finance-admin    | list-empty, commentary                        |
| 015c Outcome linkage                | `/dashboards/outcomes`              | ceo              | default, no-retention                         |
| 120a Recognition awards             | `/recognition`                      | location-manager | feed, give                                    |
| 120b Wellbeing and learning wallets | `/wallets`                          | event-organizer  | my-wallets, claim-needs-receipt, review-queue |
| 122a Gamified participation         | `/participation`                    | employee         | offices, teams                                |
| 122b Organizer recognition          | `/recognition/organizers/:personId` | employee         | profile                                       |

15 states, all in [`screens/`](screens/), captured with `scripts/visual/capture.mjs` and inspected.
The capture tool reported no blocking findings for any of them; tablet and mobile are covered by the
journeys and the visual suite below.

## What the journeys prove

[`journeys.txt`](journeys.txt): **71 passed** — the 57 Phase 15 journey runs across desktop, tablet and
mobile, plus the 14 role sign-ins they depend on — run with
`npx playwright test -c apps/web-e2e/playwright.config.ts src/extended/` on a fresh seed.

| Rule the screens must keep                                                                                | Journey                        |
| --------------------------------------------------------------------------------------------------------- | ------------------------------ |
| A scenario is a projection, never a decision; a moved baseline refuses promotion before the dialog        | `extended/scenarios.spec.ts`   |
| Scenarios are private; an employee is refused the screen                                                  | `extended/scenarios.spec.ts`   |
| Summary text cites only BudgetFlow figures, never a raw token; approval waits until every section is read | `extended/narratives.spec.ts`  |
| A read-only analyst reads summaries without a drafting action                                             | `extended/narratives.spec.ts`  |
| Outcome figures never expose an individual: a withheld figure reads "fewer than N"                        | `extended/outcomes.spec.ts`    |
| Retention cohorts stay with roles that read people company-wide; an employee is refused                   | `extended/outcomes.spec.ts`    |
| Recognition spends a budget, a thank-you note does not; a frozen budget refuses its award type by name    | `extended/recognition.spec.ts` |
| The giver is never offered as their own recipient                                                         | `extended/recognition.spec.ts` |
| Organizer recognition guards small feedback groups                                                        | `extended/recognition.spec.ts` |
| A wallet claim over its allowance is refused with the amount it is over by                                | `extended/wallets.spec.ts`     |
| The reviewer queue shows only what is waiting, with its pre-encumbrance explained                         | `extended/wallets.spec.ts`     |

## Gate

[`gate-summary.txt`](gate-summary.txt), from `scripts/gate.sh lint typecheck build functional-api
functional-e2e visual --evidence evidence/phase-15/frontend` on 2026-11-10:

- **PASS**: secrets, lint, styles, Satori, typecheck, build, OpenAPI, database, stack,
  `functional-api`, `functional-e2e`.
- **FAIL: visual, 53 of 788.** Not this phase and not this change. Overnight the day of the month went
  from 9 to 10, one digit to two, so every masked timestamp built from a real-time instant grew by one
  character's width and shifted what followed it (the mask hides glyphs, not their width — issue
  #70). The same 53 fail on `main` today. The real-date fix is in progress separately, and no baseline
  was re-recorded to turn this green: today's values would move again tomorrow. One Phase 15 state is
  among the 53, `015c-outcome-linkage no-retention › tablet`, by 37,353 pixels on both attempts: the
  subtitle ends with a masked as-of date, which is now one character wider and no longer fits on the
  subtitle line, so it wraps and moves the rest of the page down about 30 px. Same cause, amplified
  by a wrap. The other 44 Phase 15 visual checks (15 states, three viewports) pass.

Two earlier gate runs for this pack were discarded and are not evidence: one shared a Docker stack
with another session, which reseeded it mid-run; the other ran its visual stage against the wrong
stack, because `scripts/visual/pw-docker.sh` forwards `BASE_URL` but not `BF_WEB_PORT` into the
pinned Playwright container. This run set `BASE_URL` and was confirmed against its own Keycloak.

## Open limitation found while assembling this pack

**A wallet programme that requires receipts cannot be claimed against.** The claim form says so
plainly — "Attaching a receipt to a wallet claim is not available yet, so this claim cannot be
submitted" — and the journey asserts that refusal. The refusal is correct and honest; the gap is that
receipt attachment for wallet claims was never built. Programmes without a receipt rule work end to
end.
