# Leadership demo runbook (CFO and CEO, about 35 minutes)

One local run, one story: the finance office funds a new year, delegates it down the organization, and
each role does its part while the controls hold. Nine acts, one per core capability.

All people, entities and figures are fictional and come from the seed in [`libs/seed`](../../libs/seed/).
Sign-in details: [`docs/local-access.md`](../local-access.md). Every step below was clicked through on the
local stack with the deterministic seed, in this order, on 17 November 2026 (`main` at `1dc2c191`).

## Before the day

1. **Start and reset the stack** (drops this checkout's volumes only, then reseeds). If another
   BudgetFlow stack is running, export different `BF_*_PORT` values first and use the addresses
   `scripts/stack.sh urls` prints.
   ```bash
   source ~/.nvm/nvm.sh && nvm use 24
   ```
   ```bash
   scripts/stack.sh up && scripts/stack.sh reset
   ```
   ```bash
   scripts/stack.sh urls
   ```
2. **Reset again on the morning.** The demo changes data, and Acts 1–6 assume a fresh seed. The clock is
   pinned to 16 Nov 2026, 09:00 UTC, so countdowns and the delegation window stay consistent.
3. **One browser profile (or private window) per person**, signed in before the audience arrives:
   Priya, Morgan, Ananya, Jordan, Rahul, Kavya, Daniel, Grace, Taylor. Keycloak keeps one session per
   browser. The password is in `docs/local-access.md`; use autofill, don't type it on screen.
4. **Screen:** 1440 px wide, light theme, zoom 100%.
5. **AI provider.** By default the stack answers AI questions from the offline recorded provider: fixed
   wording, figures read from the ledger, no credentials needed. To use Amazon Bedrock with live
   wording, follow [`docs/runbooks/demo-ai-features.md`](../runbooks/demo-ai-features.md). Every AI
   feature is on in the seed. Leave the switches as they are.

## The cast

| Person (sign-in)                                 | Role               | Plays                                 |
| ------------------------------------------------ | ------------------ | ------------------------------------- |
| Priya Raman (`finance.admin@example.test`)       | finance-admin      | CFO's office: plan, budgets, rules    |
| Morgan Lee (`ceo@example.test`)                  | ceo                | CEO: the numbers                      |
| Ananya Iyer (`regional.manager@example.test`)    | regional-manager   | India owner, giving director          |
| Jordan Smith (`budget.owner@example.test`)       | budget-owner       | United States owner                   |
| Rahul Menon (`location.manager@example.test`)    | location-manager   | Bengaluru approver, Ananya's delegate |
| Kavya Rao (`event.organizer@example.test`)       | event-organizer    | Runs the Diwali event                 |
| Daniel Weber (`finance.controller@example.test`) | finance-controller | Actuals and matching                  |
| Grace Kim (`auditor@example.test`)               | auditor            | Audit trail, ledger check, AI log     |
| Taylor Brooks (`org.admin@example.test`)         | org-admin          | AI settings                           |

There is no CFO role; the finance-admin holds every finance and budget power, so Priya plays the CFO's office.

## Timeline

| Act | Capability                                                   | Who                   | Min |
| --- | ------------------------------------------------------------ | --------------------- | --- |
| 1   | Hierarchical allocation and delegation                       | Priya, Ananya, Jordan | 8   |
| 2   | Approvals within delegation-of-authority limits              | Priya, Rahul, Kavya   | 4   |
| 3   | Rules engine                                                 | Priya                 | 3   |
| 4   | Event co-funding: Inter-Director Budget Contribution Request | Kavya, Ananya, Daniel | 5   |
| 5   | Freeze, reduce, set to zero                                  | Priya                 | 4   |
| 6   | Actuals and matching                                         | Daniel                | 3   |
| 7   | Ledger and hash-chained audit trail                          | Priya, Grace          | 3   |
| 8   | Reporting                                                    | Morgan                | 3   |
| 9   | AI that suggests, people decide                              | Rahul, Grace, Taylor  | 4   |

---

## Act 1. Fund FY2027 and delegate it down (Priya, Ananya, Jordan)

Message: budget starts as an approved plan, every dollar traces back to it, and nobody gives away more than they hold.

| #   | Do                                                                                                                                                                                                                                                                                                              | Show / say                                                                                                                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.1 | Priya: **Budgets > Plans and versions** (`/budgets/plans`). Set **Fiscal year** to **FY2027**. **Import plan**: label `FY2027 original plan`, **Kind Original** (the default is Forecast, which never funds anything), paste the CSV below, **Validate**, **Create draft version**.                             | Row-level validation before anything is saved. CSV: `code,name,amount,legalEntity` then `EX-2027,Employee Experience FY2027,120000.00,HYL-US`. Ignore the empty seeded "FY2027 plan (draft)".                |
| 1.2 | Select the new version, click **Approve**.                                                                                                                                                                                                                                                                      | As the first plan of the year it becomes **Controlling** at once; root authorized still shows "not created". (A later revision that adds money needs a second finance admin and the CEO, never the drafter.) |
| 1.3 | **Budget list > Create budget** (`/budgets/new`): name `Employee Experience FY2027`, **Parent budget: No parent**, code `EX-2027`, legal entity **HYL-US**, plan version **FY2027 original plan**, amount **120000**, **Create budget**. Back on **Plans and versions** (FY2027), open the version.             | The tie-out: plan USD 120,000.00 = root authorized, difference USD 0.00.                                                                                                                                     |
| 1.4 | From the root, create three children (`/budgets/new` with the root as parent): **India Region FY2027** (owner Ananya, HYL-IN, cost center CC-IN-BLR-200, 30000), **United States Region FY2027** (Jordan, HYL-US, CC-US-NYC-300, 40000), **Europe Region FY2027** (Lena Fischer, HYL-DE, CC-EU-BER-400, 30000). | Creating a child allocates to it in one balanced journal. Legal entity on every budget. USD 20,000.00 stays unallocated.                                                                                     |
| 1.5 | **Allocation workspace** (`/budgets/allocate`). It opens on FY2026: set **Parent budget** to **Employee Experience FY2027**. Change India's new amount to **60000**.                                                                                                                                            | Hard block: "Exceeds parent available", 108.3% allocated, and "Blocked: over allocation … Nothing posts until it fits." Discard.                                                                             |
| 1.6 | Ananya: create **Bengaluru Events FY2027** under India Region FY2027 (owner Rahul Menon, HYL-IN, CC-IN-BLR-200, 12000). Open **Budget hierarchy** on India Region FY2027.                                                                                                                                       | Owners re-delegate within what they hold: India USD 30,000.00 authorized, USD 12,000.00 allocated, USD 18,000.00 available.                                                                                  |
| 1.7 | Jordan: paste Ananya's India Region FY2027 address (`/budgets/<id>`) into his browser.                                                                                                                                                                                                                          | "We could not find this budget": director A cannot see director B's budget, not even that it exists.                                                                                                         |

## Act 2. Approvals within delegation-of-authority limits (Priya, Rahul, Kavya)

Message: approval authority comes from the DoA matrix, not from owning the budget.

| #   | Do                                                                                                                                                                     | Show / say                                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | Priya: **Finance > Delegation of authority** (`/finance/doa`).                                                                                                         | Role or person × spend type × legal entity × limit, versioned and approved by Morgan. Use **Check a limit**: exactly at the limit passes.       |
| 2.2 | Rahul: **Approval inbox** (`/approvals`). Open **REQ-00002 Team lunch: Platform squad** (USD 216.00). Tick **I have no conflict of interest**, **Approve USD 216.00**. | Ledger impact before deciding, and "Why you" with his DoA limit (USD 1,000.00). Other choices: Approve part, Reject, Request changes, Escalate. |
| 2.3 | Rahul: **Delegated to me** tab.                                                                                                                                        | IDC-00002 sits there "For Ananya Iyer": a time-boxed delegation, capped at the delegator's own limit.                                           |
| 2.4 | Kavya: **My requests** (`/requests`), open _Team lunch: Platform squad_, **History** tab.                                                                              | "Rahul Menon: Approved the request … Within DoA USD 1,000.00", from the audit trail. Self-approval is blocked by design.                        |

## Act 3. Rules engine (Priya)

Message: policy is data, versioned, and explains every decision.

| #   | Do                                                                                                                                                                | Show / say                                                                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 | **Admin > Rules and policies** (`/admin/rules`).                                                                                                                  | Active rules, a draft that conflicts with an active rule (blocked from publishing), decisions by week.                                                                          |
| 3.2 | **Test a request** (`/admin/rules/simulate`): amount **300**, Employee events, Bengaluru, **10** people, tick **Alcohol is included**, **See what would happen**. | "Needs approval", decided by R-26 (alcohol only at approved events), parent budget owner as approver, and every other rule that matched, in priority order. Nothing is created. |

## Act 4. Event co-funding through an Inter-Director Budget Contribution Request (Kavya, Ananya, Daniel)

Message: cross-location events are co-funded through a controlled, audited request, never free-form sharing.

| #   | Do                                                                                                                                                                                          | Show / say                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1 | Kavya: **Events** (`/events`), open **Diwali celebration 2026** (EV-2026-DIWALI, Bengaluru and Hyderabad, 20 Nov). Then **Events > Co-funding board** (`/events/cofunding-board`).          | Estimate USD 4,800.00, funding cap with tolerance, own funds USD 3,000.00, IDC-00001 approved in part (USD 900.00 of 1,200.00), IDC-00002 USD 720.00 pending, IDC-00003 from Europe earmarked. |
| 4.2 | Ananya: **Approval inbox**, open **IDC-00002**, **Open full details**. Choose **Contribute part**, amount **500**, reason code **TRF-COFUND**, tick no conflict, **Contribute USD 500.00**. | The giving director decides: in full, in part, or decline. Never automatic. Result: "Earmarked", approved USD 500.00 held on India's budget; the event gap is now USD 160.00.                  |
| 4.3 | Daniel: **Finance > Intercompany recharges** (`/finance/recharges`).                                                                                                                        | IDC-00003 crosses legal entities (Europe to India), so it is recharged with a 5% markup: USD 240.00 + USD 12.00.                                                                               |

## Act 5. Freeze, reduce, set to zero (Priya)

Message: leadership can stop money instantly without breaking commitments already made.

| #   | Do                                                                                                                               | Show / say                                                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.1 | Open **United States Region FY2027**. **Reduce** by **5000**, reason code **RED-COST-SAVING**, a reason, confirm.                | A destination is required (parent by default); the floor (held + committed + actual + children) cannot be cut. Status becomes "Reduced", total USD 35,000.00.                                                          |
| 5.2 | Open the seeded **Bengaluru Events** (FY2026, from the Budget list) and click **Set to zero**. Read the dialog, then **Cancel**. | The impact preview: authorized USD 12,000.00, actual USD 1,685.89, commitments and holds USD 7,232.40, floor USD 8,918.29, money cut USD 3,081.71. Confirming needs a reason code, a reason and the typed budget code. |
| 5.3 | Open **Europe Region FY2027**. **More actions** (three dots) > **Freeze**, pick a reason code, a note, confirm.                  | Frozen banner with its lock treatment; new requests and allocations are rejected with a reason.                                                                                                                        |
| 5.4 | **Budget list** (`/budgets/list`, FY2026).                                                                                       | Seeded **US Recognition** is frozen and **Europe Wellbeing** is set to zero. History is never deleted.                                                                                                                 |

## Act 6. Actuals and matching (Daniel)

Message: spend comes from the ERP, matches to commitments at the locked plan rate, and blocks close until it is clean.

| #   | Do                                                                                                                                                                                                                                                          | Show / say                                                                                                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.1 | **Finance > Actuals and matching** (`/finance/actuals?file=erp-actuals-2026-11.csv`).                                                                                                                                                                       | The posted November ERP file: 9 lines, 3 auto-matched, 3 partially matched, 3 unmatched. INR lines convert at the locked plan rate (83.2500); FX never consumes budget.                                                                                           |
| 6.2 | **Event close** tab (`/finance/actuals/events`), open **New York Team Offsite** (NYC-OFFSITE-26).                                                                                                                                                           | Blocked: one unmatched actual (USD 640.00). An event cannot close with unmatched spend.                                                                                                                                                                           |
| 6.3 | **Matching suggestions** (`/finance/actuals/suggestions`). Click **Rank unmatched lines**, open **Northside Print**. Under the alternatives, click **Choose** on **New York Events**, then **Match this line and record my decision**. Back on Event close. | AI ranks targets with reasons; a person picks. After Act 1 it may rank United States Region FY2027 first (same cost center); matching that is refused ("outside FY2027"), which shows the command, not the AI, decides. NYC-OFFSITE-26 is now **Ready to close**. |

## Act 7. Ledger and hash-chained audit trail (Priya, Grace)

Message: money only moves by balanced postings, every change is audited, and both are checked.

| #   | Do                                                                                                                             | Show / say                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.1 | Priya: **United States Region FY2027**, **Ledger** tab.                                                                        | The allocation and the reduction as journal lines with bucket, amounts and journal id. Lines are never edited; corrections are reversals.                                                      |
| 7.2 | Grace: **Audit log** (`/audit-log`), **Verify chain**.                                                                         | "Chain verified: N immutable entries". Today's actions are at the top with actor, action and reason. Append-only and hash-chained.                                                             |
| 7.3 | Grace: **Finance overview** (`/dashboards/finance`), **Ledger integrity** card, **Run check now**; reload after a few seconds. | On a fresh reset it reads "No ledger check has run yet". After the run: "Clean … Cached balances equal the rebuild for 16 budgets", audit chain verified. The nightly run uses the same check. |
| 7.4 | Grace: **Admin > System health** (`/admin/health`).                                                                            | The "Ledger rebuild and audit chain check" job now shows its last run as Clean.                                                                                                                |

## Act 8. Reporting (Morgan)

Message: one place for the numbers, each one built from the ledger.

| #   | Do                                                  | Show / say                                                                                            |
| --- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 8.1 | **Home** (`/`).                                     | Where the year stands: authorized, committed, actual, available, and the budgets that need attention. |
| 8.2 | **Reports > Utilization** (`/reports/utilization`). | Pending, held, committed, actual and available per budget; each figure opens its ledger lines.        |
| 8.3 | **Board and FP&A pack** (`/reports/board-pack`).    | Figures as of the latest closed period, with toggled pages; **Generate PDF and XLSX** for the board.  |

## Act 9. AI that suggests, people decide (Rahul, Grace, Taylor)

Message: AI explains inside the asker's own permissions, never acts, and every call is logged. (Act 6.3 showed an AI suggestion that a person accepted.)

| #   | Do                                                                                        | Show / say                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9.1 | Rahul: **Ask BudgetFlow** (`/ask`). Ask "How much is left in Bengaluru Events?"           | Labeled as written by the model, plus a figures table read from the ledger (not written by the model) and the records it used.                        |
| 9.2 | Ask "Move USD 5,000 from Bengaluru Events to New York Events".                            | "BudgetFlow AI does not act. I can't move money." It points to the screen where a person does it.                                                     |
| 9.3 | Ask "How much is left in the Berlin budget?"                                              | "Outside what you can see": it answers only from records Rahul can open, and does not confirm the budget exists.                                      |
| 9.4 | Grace: **AI query log** (`/admin/ai/log`).                                                | One row per question: who, scope, records, outcome (answered, refused as action, refused as out of scope), model id, latency. No question text.       |
| 9.5 | Taylor: **AI settings** (`/admin/ai/features`). Show the page only; do not flip switches. | Each feature has a per-tenant switch and lists exactly which fields it sends to the model. No switch can let AI approve, move money or change a rule. |

---

## Feature coverage

| Core capability                                                  | Act         |
| ---------------------------------------------------------------- | ----------- |
| Plan, tie-out, hierarchical allocation and delegation            | 1           |
| Approvals within DoA limits, delegation, approval hygiene        | 2           |
| Rules engine and simulation                                      | 3           |
| Events, Inter-Director Budget Contribution Request, intercompany | 4           |
| Freeze, reduce, set to zero with impact preview                  | 5           |
| Actuals, plan-rate FX, matching, event close blocker             | 6           |
| Ledger, hash-chained audit, rebuild check                        | 7           |
| Reporting and board pack                                         | 8           |
| AI assist with sources, refusals, log and settings               | 9 (and 6.3) |

## When something goes wrong

| Symptom                                     | Fix                                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Page will not load or shows an error banner | Use Retry in the banner; then `scripts/stack.sh status` and `scripts/stack.sh logs api`. |
| Signed in as the wrong person               | Sign out from the user menu, or use that person's browser profile.                       |
| An approval or notification is missing      | The worker delivers it; reload after a few seconds (`scripts/stack.sh logs worker`).     |
| Demo data is messed up                      | `scripts/stack.sh reset` and start again from Act 1.                                     |

## Do not claim

- That AI ever acts. It only suggests; a person decides through the normal command path.
- That AI wording is live, unless Bedrock is configured. The default recorded provider gives fixed wording.
- That everything in the build plan is built: the open gaps are listed in [`docs/gap-closure-plan.md`](../gap-closure-plan.md).
- That the dark theme or accessibility checks are done; both are deferred.
