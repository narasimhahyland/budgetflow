# Phase 17: exploratory checks

An agent-driven pass through the product on this worktree's Compose stack (deterministic seed, real
Keycloak sign-ins per role), on 10 Nov 2026. Each step went through the UI as the role that does it,
then the numbers on screen were compared with what the API reports and what the ledger holds. Console
errors and failed requests were collected on every screen. The stack was reseeded afterwards.

## Charters

| #   | Charter                                                | Roles                                 | Result                 |
| --- | ------------------------------------------------------ | ------------------------------------- | ---------------------- |
| 1   | An owner requests from their own budget                | regional-manager, CEO                 | routing right; F1      |
| 2   | Allocate over, at and one cent past available          | regional-manager                      | controls right; F2, F3 |
| 3   | Freeze and set to zero, then try to spend              | regional-manager, location-manager    | controls right; F4, F5 |
| 4   | The approver decides from the inbox                    | CEO                                   | **F7**                 |
| 5   | Forbidden, not-found and integrity states              | employee, finance-controller, auditor | right; F8              |
| 6   | Actuals import, FX at plan rate, contribution requests | finance-controller, event-organizer   | right                  |

## What held

- **Hard control.** Allocating USD 12,000.00 against USD 11,869.75 available is blocked in the dialog
  (important-tone banner, disabled button). Allocating exactly 11,869.75 posts: India's allocated out
  rose by exactly 1,186,975 minor units and available under its rules went to 0, while the company-wide
  figure did not move. One minor unit more through the API: 409 `OVER_ALLOCATION`. A request against
  the exhausted budget: 409 `INSUFFICIENT_AVAILABLE`.
- **No self-approval.** Ananya Iyer's request on her own budget skipped her ("People cannot approve
  their own requests") and routed to Morgan Lee, next owner up within the DoA limit; the approval
  email went to Morgan.
- **Freeze.** The dialog shows the impact and needs a reason code and note; the budget then shows an
  info banner, requesters see it as Paused, and an increase request is refused (409, plain English).
- **Set to zero.** The dialog shows authorized, actual, commitments and holds, the floor
  (8,702.29 = 1,685.89 + 7,016.40 + 0), the money cut (15,167.46), the destination, the pending
  requests that will be cancelled, a reason code, a reason and a typed confirmation. After it:
  authorized equals the floor, the parent's allocated out fell by exactly the cut, pending requests
  went to 0 and both requesters were emailed, held, encumbered and actual were untouched, and a new
  request is refused with 409 `BUDGET_SET_TO_ZERO`.
- **Integrity after all of it.** Ledger rebuild check clean (no drift, no unbalanced journal); audit
  chain valid at 87 events, and the auditor's banner shows that same 87.
- **Scope.** An employee opening another director's budget and a non-existent budget id sees the
  same "no access" page, so the id is not confirmed.
- **FX.** Imported EUR 4,600.00 converts at the locked 0.92 to USD 5,000.00 and INR 18,940.00 at
  83.25 to USD 227.51; the page says FX never consumes budget.
- No console errors or failed requests on any screen except the expected 404 for the missing budget
  and the expected 409s.

## Findings

Ranked by impact. None lets money move wrongly: the API enforced every control. They are cases
where a screen tells someone something wrong or offers what the API will refuse.

| #      | Severity | Where                                | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------ | -------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **F7** | Medium   | Approval inbox, budget ledger impact | "Company-wide Available" for India showed USD 28,135.46 while the budget page and the health dashboard showed 18,846.21. `libs/api/approvals/src/lib/budget-impact.ts:84` computes `authorized − pending − encumbered − actual` of the budget alone; the other screens also deduct holds and the children's commitments and actuals (here 586.96 + 8,702.29 = 9,289.25). An approver sees the figure overstated on any budget with earmarks or spending children ([`c4-ceo-inbox.png`](screens/c4-ceo-inbox.png)). |
| F1     | Low      | My budgets (`requestableBudgets`)    | Each card says "<owner> approves", even to the owner: Ananya Iyer is told she approves requests on her own budgets, while the real route skips her. `approverHint` in `libs/api/spend/src/lib/requests.service.ts` names the owner without excluding the requester ([`c1-rm-my-budgets.png`](screens/c1-rm-my-budgets.png)).                                                                                                                                                                                       |
| F5     | Low      | Budget details, frozen budget        | "Request increase" stays enabled on a frozen budget; the owner fills the form and only then gets the 409. The frontend rule asks for blocked actions to be disabled with the reason ([`c3-frozen-increase.png`](screens/c3-frozen-increase.png)).                                                                                                                                                                                                                                                                  |
| F3     | Low      | My budgets                           | A hard-mode budget with USD 0.00 available still counts under "Can request" with an active Request button; the refusal comes at submit. `blockedCode` covers frozen and set to zero, not exhausted.                                                                                                                                                                                                                                                                                                                |
| F4     | Low      | Budget details header                | The "Frozen" status tag carries the generic info icon; the budget-safety visual rules ask for a lock icon on frozen, which the freeze dialog and My budgets do use ([`c3-frozen-increase.png`](screens/c3-frozen-increase.png)).                                                                                                                                                                                                                                                                                   |
| F2     | Low      | `OVER_ALLOCATION` problem detail     | "Only 0 USD minor units are available to allocate; 1 were requested." The UI shows the API's `detail` when it refuses, so a race would show "minor units" to a person; details must be plain English with formatted amounts.                                                                                                                                                                                                                                                                                       |
| F8     | Cosmetic | Not-found state (`bf-load-state`)    | A missing budget reads "this budget not found": the heading is built from the lower-case `what` text ([`c5-missing-budget.png`](screens/c5-missing-budget.png)).                                                                                                                                                                                                                                                                                                                                                   |

Observation, not a defect: owner threshold alerts fire on each new crossing, so an owner can receive
the same "reached 50%" email more than once. The seed sends Bengaluru's owner two identical ones
(51.2%) because utilization dips back under 50% when a request is declined or sent back and then
crosses again, and setting a budget to zero re-sends it (70.6%) because the cut raises utilization.
Hysteresis or a once-per-threshold rule would quieten it; that is a product decision.

## How it was run

A small Playwright driver opened each screen with the role's saved sign-in, performed the steps, and
printed headings, banners, buttons (with disabled state), console errors and failed requests, then
saved a full-page screenshot; an API helper read the same records with that role's token. Both are
throwaway scripts kept out of the repository (`tmp/scripts/`). Screenshots: [`screens/`](screens/).
