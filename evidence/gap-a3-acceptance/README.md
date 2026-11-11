# Gap A3: the full core acceptance scenario

Package A3 of [`docs/gap-closure-plan.md`](../../docs/gap-closure-plan.md). The plan's ten-step core
acceptance scenario now runs as one story in
[`apps/web-e2e/src/acceptance/wave-2-core.spec.ts`](../../apps/web-e2e/src/acceptance/wave-2-core.spec.ts)
(`Core acceptance scenario, end to end`). Each step runs through the UI as the role that does it in
real life, and API assertions check every number.

The earlier per-step checks stay in the same file (`Wave 2 core acceptance`). The read-only ones
still run on every viewport.

Verified on an isolated stack: compose project `bf-gap-a3`, web 54200, API 53000, Keycloak 58080,
Mailpit 58025. The deterministic seed was reset before the run.

## How it stays independent

- The scenario creates its own program (`ACC-<tag>`) and everything under it. The only seeded data
  it reads are ids (fiscal year, legal entities, cost centers, people) and the locked FY2026 plan
  rates.
- The HR snapshots that drive the per-head driver are dated 1 March and 1 April 2026. They are
  older than the seeded 31 October and 1 November snapshots, so every "latest snapshot" view other
  suites read stays on the seed. The driver needs dates inside FY2026, because it multiplies by the
  months left in the year.
- Actuals and the GL tie-out use December 2026 for HYL-IN. No other suite touches that month. The
  GL file is built from the matched December lines the API reports, so a Playwright retry still
  ties.
- Selectors are by role, label, text or test id. There are no fixed sleeps; email waits poll
  Mailpit.

## Outcome table

Run: `npx playwright test -c apps/web-e2e/playwright.config.ts src/acceptance --project=desktop
--project=tablet --project=mobile` on a freshly reset seed.

Result: **46 passed, 0 failed, 0 flaky, 28 skipped.** The skipped tests are the desktop-only
mutating tests on tablet and mobile. The run log is in `tmp/evidence/gap-a3/acceptance-fresh.log`
and is not committed.

| Step | Scenario (roles)                                                                                                                                                                                                                                                                                                    | Expected                                                                                                                                                                                                                                       | Actual                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Result |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1    | finance-admin imports a "Current (revision)" plan line `ACC-<tag>`, USD 100,000.00, HYL-US. finance-admin-2 approves, then the CEO approves. The CEO creates the root at `/budgets/new` from that version. The CEO checks `/finance/rates`.                                                                         | The version is `approved` only after the second sign-off. The root is authorized USD 100,000.00. INR 83.25 and EUR 0.92 plan rates are locked for FY2026.                                                                                      | First sign-off notice: "needs one more sign-off". Then "Approved". Root authorized `10000000` USD. `plan-INR` "83.2500 (locked)", `plan-EUR` "0.9200 (locked)". API `locked: true`.                                                                                                                                                                                                                                                                                                      | PASS   |
| 2    | The CEO creates India (HYL-IN, owner Ananya), United States (HYL-US, Jordan) and Europe (HYL-DE, Lena) with initial allocations of 40,000, 30,000 and 20,000.                                                                                                                                                       | Each child is authorized exactly. The root's allocated out is the sum.                                                                                                                                                                         | 4,000,000 / 3,000,000 / 2,000,000 minor. Root allocated out 9,500,000, including the UK helper budget at 500,000. Root available 500,000.                                                                                                                                                                                                                                                                                                                                                | PASS   |
| 3    | Ananya funds Hyderabad per head (USD 20.00 a person a month, employees) from finance-admin's HR file of 40 people. finance-admin imports 45. Ananya applies the true-up.                                                                                                                                            | 40 × 20.00 × 10 months = USD 8,000.00. True-up delta: 5 × 20.00 × 9 months = USD 900.00.                                                                                                                                                       | Target USD 8,000.00, driver `per_head`. Delta USD 900.00. Button "Apply true-up". Authorized 890,000. India allocated out 890,000.                                                                                                                                                                                                                                                                                                                                                       | PASS   |
| 4    | Ananya creates "Acceptance summit" on India: Bengaluru and Hyderabad, a USD 10,000.00 estimate and USD 6,000.00 own funds. She submits it.                                                                                                                                                                          | The event is `submitted`, in HYL-IN, at both locations, with a USD 10,000.00 estimate and an own-funds request.                                                                                                                                | As expected. US and Europe attendees are added through the participants API (see finding 1).                                                                                                                                                                                                                                                                                                                                                                                             | PASS   |
| 5    | Ananya opens the Summary, then "Split by: Employing entity".                                                                                                                                                                                                                                                        | Four attendees share the cost evenly: Bengaluru 2, New York 1, Berlin 1. HYL-US and HYL-DE rows are marked intercompany.                                                                                                                       | API `splits.byLocation` and `byEntity` sum to the same total, at an even share each. Rows show the amounts and the "Intercompany" tag.                                                                                                                                                                                                                                                                                                                                                   | PASS   |
| 6    | Ananya asks the UK (HYL-UK) budget, then US for 2,000, then Europe for 2,000. Jordan contributes in full. Lena contributes 1,500 of 2,000. Ananya asks Europe again for 1,000 and Lena declines. Daniel (tax approver) approves the US recharge.                                                                    | UK→IN is offered but disabled, and the API refuses it with 409 `INTERCOMPANY_BLOCKED`. The earmarks are held. DE→IN is recharged with a 5% markup at once. US→IN is recharged at cost after tax approval.                                      | UK option disabled: "Blocked by the intercompany policy." API returns 409. Statuses: `earmarked` 200,000 / `earmarked` 150,000 / `rejected`. Held: US 200,000, Europe 150,000. Recharges: DE `approved` total 157,500; US `pending_tax_approval` 200,000, then `approved`.                                                                                                                                                                                                               | PASS   |
| 7    | The CEO approves the own-funds request in the inbox. Ananya asks for USD 500.00 more. The CEO approves it from the email link. Ananya commits USD 9,000.00.                                                                                                                                                         | Hygiene checks pass: not the requester, not a beneficiary, not attending, within DoA. The requester holds no task. The email link works once. The event is funded with a USD 10,000.00 cap.                                                    | Requester `myTaskId: null`. All four checks pass, within the DoA limit. Approve stays disabled until the conflict attestation. The email subject is "Approve USD 500.00". The second click on the link shows "Open in BudgetFlow". Event `funded`, cap 1,000,000. Committed 900,000, available 100,000.                                                                                                                                                                                  | PASS   |
| 8    | finance-admin opens "Set to zero" on India.                                                                                                                                                                                                                                                                         | The dialog shows the API's floor and cut. Confirm stays disabled until the budget name is typed. After it, the status is `set_to_zero`, available is 0, the cut returns to the parent and encumbrances are unchanged.                          | Floor USD 15,400.00 (Hyderabad 8,900 + India's event funding 6,500). Cut USD 24,600.00. Destination "Return to parent", reason code RED-REPRIORITIZE, typed reason, confirmation text. Root available +2,460,000. Encumbered unchanged.                                                                                                                                                                                                                                                  | PASS   |
| 9    | Ananya tries a new request on India. She starts and completes the event. finance-controller uploads an INR corporate-card file and an INR expense-report file, matches the taxi line from the unmatched queue to the commitment as the final invoice, and checks the event reconciliation. Ananya closes the event. | The new request is blocked in the form and refused with 409 `BUDGET_SET_TO_ZERO`. INR converts at 83.25. The queue clears. USD 8,000.00 is spent at the plan rate, with FX shown separately. The surplus of USD 2,000.00 returns 65 / 20 / 15. | `impact-blocked` shows; Submit is disabled; the API returns 409. INR 416,250.00 → USD 5,000.00, 166,500.00 → 2,000.00, 83,250.00 → 1,000.00. KPIs 1 partial / 1 partial + 1 unmatched. Queue matched. Reconciliation: 3 matched, 0 unmatched, USD 8,000.00 at the plan rate, FX effect non-zero under "FX effect (separate)", "Never consumes budget". Returned: India 130,000, US 40,000, Europe 30,000. Held 0 on the givers. Event funding: actual 800,000, committed 0, available 0. | PASS   |
| 10   | The auditor opens `/audit-log?resource=<event>`. The CEO runs utilization by location and by team (`department`, the nearest team or department). finance-controller runs the HYL-IN December GL tie-out. finance-admin signs it off.                                                                               | Every audit row the API returns is listed and the chain verifies. Utilization matches the API row for row and ties to the ledger. The tie-out difference is exactly the share recharged to other entities.                                     | Event audit includes `event.created`, `submitted`, `participants_added`, `closed`. India's audit includes `budget.set_to_zero`. "Chain verified". Utilization rows match, with Hyderabad authorized 890,000. Tie-out GL USD 8,000.00 against BudgetFlow 5,200.00, a difference of 2,800.00 (35%), explained and "Signed off by Priya Raman".                                                                                                                                             | PASS   |

Screenshots of each key state are in [`functional/screens/`](functional/screens/), one or more per
step.

## Defects found and fixed in this package

| #   | Defect                                                                                                                                                                                                                                                                                                | Fix                                                                                                                                                                          | Proof                                                                                                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Event reconciliation counted only actuals that carried the event code. A receipt matched by hand from the queue to the event's own commitment was left out: the event showed USD 7,000.00 spent while the ledger had consumed USD 8,000.00.                                                           | `libs/api/actuals/src/lib/events.service.ts` now also counts actuals matched to the event's commitments, directly or through a split.                                        | API scenario `actuals/event-close.spec.ts` › "an actual without the event code, matched to the event's commitment, counts as the event's spend"; acceptance step 9.                                           |
| F2  | Event detail hard-coded `funding.actual` to 0, and computed "available" from active sources only. A closed event showed USD 0.00 actual and its whole cap available again.                                                                                                                            | `libs/api/events/src/lib/events.service.ts`: actual is what the commitments consumed, committed is drawn but not yet spent, and available is the cap minus everything drawn. | `actuals/event-close.spec.ts` (closed event: actual 90,000, committed 0, available 0); acceptance steps 7 and 9. The seeded events in the visual suite have nothing consumed, so their figures are unchanged. |
| F3  | The blocked-home banner on an event repeated "Existing commitments … can complete" after a domain message that already says it.                                                                                                                                                                       | `event-detail.page.html` adds the sentence only when the reason lacks it.                                                                                                    | Acceptance step 9 asserts the sentence appears once.                                                                                                                                                          |
| F4  | The first of the two plan sign-offs gave no feedback, and the Approve button stayed as though nothing had happened.                                                                                                                                                                                   | `plans.page.ts` shows "Your approval … is recorded. It needs one more sign-off…" or "Approved: … can now fund root budgets."                                                 | Acceptance step 1.                                                                                                                                                                                            |
| F5  | `scripts/visual/pw-docker.sh` forwarded only `BF_E2E_*`. Inside the container, a worktree stack's API and Keycloak URLs fell back to the default ports, which belong to another checkout's stack.                                                                                                     | The script also forwards `BF_*_PORT`.                                                                                                                                        | The gate's visual step in this package ran against `bf-gap-a3`.                                                                                                                                               |
| F6  | The anomaly journey (`ai/suggestions.spec.ts`) took whichever row read "Possible split". The scenario's own-funds request (6,000) and additional-funds request (500) are one person's, on one budget, within a week, so they rightly raise a second advisory flag, and the selector matched two rows. | The journey selects the seeded pair, REQ-00001 and REQ-00007, by its refs.                                                                                                   | Passes with the acceptance spec run before it on one stack (`--workers=1`).                                                                                                                                   |

`docs/testing/invariant-scenarios.md` row 16 now names these scenarios.

## Findings recorded, not fixed

1. **Event attendees outside the organizer's region cannot be added in the UI.**
   - The wizard and the Participants tab search the people directory, and the directory is scoped
     to the organizer's org subtree.
   - A regional manager or department head finds nobody outside their region. The event-organizer
     role (`self` scope) finds nobody at all.
   - `POST /api/events/:id/participants` accepts any tenant person, so the UI and the API disagree.
   - Changing directory visibility is an authorization decision: a scoped "event attendee" search
     returning name, location and employing entity only. So it is left for a decision.
   - The scenario adds the US and Europe attendees through the participants endpoint.
2. **A co-funded actual's contributor shares sit on the contributors' legal entities.**
   - The host entity's GL tie-out therefore differs from its GL by the recharged share. Here that is
     35%, explained and signed off.
   - A recharge-aware tie-out column, or a recharge journal on the host GL account, would let it tie
     without an explanation. That needs a finance decision on the recharge accounting.
3. **Utilization has no FX column.**
   - Consumption is at the locked plan rate, which is correct.
   - FX is shown separately on the import review (the plan-rate table), the queue drawer
     (`fx-effect`), the event reconciliation ("FX effect (separate)") and the board pack's FX
     bridge.
   - An FX tile on utilization would be a new feature and would move its visual baselines.
4. **Two smaller gaps:**
   - The utilization "Group by" offers `department`, which already groups by the nearest team or
     department, but the label says "Department".
   - The GL tie-out period picker lists only the months of 2026.
5. **Gap list against the brief:** INR and EUR plan rates cannot be locked in step 1, because the seed
   locks every fiscal year and only finance admins hold `fx.manage`. The step asserts the locked
   state. The intercompany policy has no UI, so step 6 uses the seeded policy:
   - UK→IN block
   - DE→IN recharge with a 5% markup
   - tenant-wide recharge at cost with tax approver Daniel Weber

## Gates

[`gate-summary.txt`](gate-summary.txt) is the output of `scripts/gate.sh all --evidence
evidence/gap-a3-acceptance` on this branch.

Every step passes:

| Step                                                                         | Result                                          |
| ---------------------------------------------------------------------------- | ----------------------------------------------- |
| Secret scan, lint, styles, Satori check, typecheck, build, OpenAPI drift, db | pass                                            |
| `functional-api`                                                             | **630 passed**, 0 failed                        |
| `functional-e2e`, all three viewports, after the reseed                      | **630 passed**, 190 skipped by design, 0 failed |
| `visual` in the pinned image against `bf-gap-a3`, after the reseed           | **943 passed**, 1 flaky, 0 failed               |

The flaky state is `011a-ai-assistant-panel` `action-redirect` on tablet, which passed on retry.

On the gate run before the anomaly-journey fix (F6), `functional-e2e` failed on that journey and
`visual` failed three AI states. The rest of this section classifies those visual failures.

On that earlier run, three visual states failed, all on tablet:

- `011a-ai-assistant-panel` `refused-out-of-scope`
- `011a-ai-assistant-panel` `action-redirect`
- `069a-policy-assistant` `is-allowed`

This is the carried AI-caption defect, not this change:

- The masked query-log id in the AI provenance caption measures differently depending on its random
  characters, so the closing text wraps or not.
- The pixel counts differ between attempts (40,192 against 40,209; 2,631 against 2,665).
- A re-run of those states alone, twice each: each `011a` state passed once and failed once.
  `069a` failed both times, by a different number of pixels each time.
- Per the handoff's classification, nondeterministic rendering is not re-recorded.
- The carried defects list in `docs/gap-closure-plan.md` names it, and its fix is in a separate
  session.
- This package changes no AI screen.
