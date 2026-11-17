# Gap B7: integration completeness

Package B7 of [`docs/gap-closure-plan.md`](../../docs/gap-closure-plan.md), with the Tier C
connector coverage. Integrations that only read and reported now apply what they read, each
through the same application service, policy check and audit a person would use. Providers are
named generically in fixtures; all data is fictional.

## What it does

- **Adaptive Planning import, applied (094a).** `POST /api/integrations/connections/{id}/plan-import`
  turns the planning system's version into a **Draft plan version** through the P4 plan import
  (`PlanningService.importPlanInTx`), so validation, the audit entry and the draft status are the
  same as a spreadsheet upload. Levels map to root budgets; a new year's roots copy the mapped root
  (EX-2026 becomes EX-2027), a same-year import is a revision floored at allocated out + held +
  encumbered + actual, and roots the plan does not mention are carried over unchanged. Any refused
  row (unmapped level, bad amount, duplicate level, other currency, unknown fiscal year, below the
  floor) refuses the whole import with each reason and records a failed sync run. A replay returns
  the first result; the same planning version under a new key is `IMPORT_ALREADY_UPLOADED`. Money
  moves only when the version is approved (new money: a second Finance Admin and the CEO) and
  applied on Plan versions. **Closed period:** a plan effective in a closed or locked period is
  flagged late, and the run and audit entry name the open period it posts in; a year with no open
  period is refused.
- **Vendor master from the ERP (094, 106c).** The ERPNext `suppliers` sync calls
  `ReferenceDataService.importVendors`: new suppliers enter as **Unknown** for review (never
  approved by the import), a supplier known by name is linked to its ERP id, one known by ERP id is
  a duplicate, and bad rows (no name, non-ISO country, a name linked to another ERP id) are refused
  into the retry queue. One audit entry per vendor created or linked.
- **Outlook and Google Calendar RSVP sync (097).** `calendar_responses` runs call
  `EventInvitationsService.applyCalendarResponses`: Accepted becomes Going (Waitlisted beyond
  capacity), Declined becomes Can't go (promoting the waitlist), Tentative is no response. The last
  answer wins by the provider's answer time, so an older or repeated answer changes nothing. Closed
  RSVPs refuse the answer. One `event.rsvp_recorded` audit entry per change, with the channel.
- **Workday Financials `runBudgetCheck` (094).** The connection setting `budgetCheck` (off by
  default; Warn or Block) makes `ApprovalsService.decide` ask the ERP before approving spend,
  through the `ExternalBudgetChecks` port (approvals does not depend on any connector). Warn shows
  the answer on the approval card (`GET /api/approvals/tasks/{id}/budget-checks`) and records it
  with the decision; Block refuses with `EXTERNAL_BUDGET_CHECK_FAILED` and the ERP's reason, also
  when the ERP cannot be reached. Setting changes are audited.
- **117a hand-off to a prefilled expense.** `GET|POST /api/requests/{id}/expense-handoff`: the
  requester of an approved spending request creates one Concur draft with the request's fields
  (reference, expense type from the category mapping, amount, date, cost center, event code,
  merchant); the employee submits it in Concur. A second attempt is `EXPENSE_HANDOFF_EXISTS`; the
  tool's refusal records nothing and the details stay available to copy. Progress (Submitted,
  Approved, Paid, the amount claimed) comes back with the Concur `expense_reports` sync, forward
  only, audited on the request. The hand-off moves no money.
- **Connector coverage (Tier C).** Odoo, Workday Financials, NetSuite, Brex, Coupa, Workday HCM and
  Google Calendar each have a contract scenario against the mock provider.

Permissions: two new actions held by the connector's service identity, `vendor.import` (also
Finance Admin) and `event.rsvp_sync` (no role) — [authorization matrix](../../docs/architecture/authorization.md).
Migration `0030_b7_expense_handoffs` (RLS forced), regenerated on `main` after B4 (`0026`, `0028`), B8 (`0029`) and B5 (`0025`). The snapshot is `meta/0029_snapshot.json`, by journal index.

Outbound calls: the plan read, the budget check and the draft creation run synchronously in the API
with timeouts and retries (`OutboundHttp`), like the existing preview, test-connection and push
calls; they are interactive and run outside any transaction. Sync runs and their failures are
recorded as before (status, counts, cursor, retry queue).

## Invariants and proof

| Row | Invariant                                                                                                                    | Scenario                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 130 | Plan import applied only as a Draft plan version; refused rows; replay; approval and apply create exactly the expected roots | `apps/api-e2e/src/integrations/applied-imports.spec.ts` |
| 131 | Nothing posts to a closed period through an import                                                                           | same file                                               |
| 132 | ERP suppliers enter the vendor master as Unknown; duplicates, links, refusals, audit, replay                                 | same file                                               |
| 133 | Calendar responses become RSVPs by the event rules; last answer wins; closed RSVPs                                           | same file and `connector-coverage.spec.ts`              |
| 134 | ERP budget check: off by default, Warn records, Block refuses                                                                | `budget-check-and-handoff.spec.ts`                      |
| 135 | Expense hand-off once per approved request, by its requester; status synced once                                             | same file                                               |
| 136 | Every connector definition has a contract scenario                                                                           | `connector-coverage.spec.ts`                            |

Outcome table: [`functional/outcomes.md`](functional/outcomes.md).

Screenshot: [`screens/094a-adaptive-planning--plan-import--mobile.png`](screens/094a-adaptive-planning--plan-import--mobile.png)
(the re-recorded baseline). The hand-off panel's states are asserted by the journeys; no separate
screenshot is kept.

## Review

An independent review of the diff found no high-severity issue, six medium and six low findings.
Fixed before the gate runs below:

- the plan import wrote two audit entries; it now writes one `plan_version.imported` entry that
  names the source, the external version and the sync run;
- plan amounts assumed two decimals; they now use the ISO 4217 exponent of the plan currency;
- floors and differences compared the root's budget currency with the plan's reporting currency;
  they now use the reporting view;
- replays called the provider (plan import) or the ERP (approval) before returning the stored
  result; both now answer a finished key first;
- the ERP check ran before authorization; only the assignee or an active delegate reaches the ERP;
- a partial approval was checked at the full amount; it is checked at the amount being approved;
- an unchanged calendar answer wrote a timestamp without an audit entry; it now writes nothing;
- the hand-off status sync guessed a currency and used floating point; it refuses an unknown
  currency and parses the amount as text;
- the hand-off now records the connection that created the draft and re-checks the request under
  its lock inside the command.

Not fixed, follow-ups: no unique index on plan version labels per year or on vendor ERP ids
(concurrent imports with different keys could each create one); the decision form does not disable
Approve in Block mode (the API refuses and the card says why); email and chat decisions skip the ERP
check; the hand-off sends no receipt.

## Gates

After merging `main` (B4, B8), on the final tree: static, `functional-api` and `functional-e2e`
**pass** ([`gate-summary-after-merge.txt`](gate-summary-after-merge.txt)). The runs below are from
before the merge.

- Static (lint, styles, Satori, typecheck, build, OpenAPI, db check): **pass**
  ([`gate-summary.txt`](gate-summary.txt)).
- `functional-api`: **pass** on the second run ([`gate-summary.txt`](gate-summary.txt)).
  The first run ([`gate-summary-first-run.txt`](gate-summary-first-run.txt)) failed the migrations
  scenario, which reads snapshots by journal index: the snapshot keeps index 24 while the SQL is
  `0027_b7_expense_handoffs` at the time (now `0030`).
- `functional-e2e`: **pass** ([`gate-summary-e2e-visual-final.txt`](gate-summary-e2e-visual-final.txt)).
  The earlier runs failed because the plan-import journey replaced the seeded Adaptive Planning
  credential while the hub journeys in other workers read it in "Needs attention"
  ([`gate-summary-functional-e2e-run3.txt`](gate-summary-functional-e2e-run3.txt)); the mock now
  serves the journey's plan to the seeded credential instead. The second full run's e2e failure
  was the Nx daemon timing out at a load average near 80.
- `visual`: **fail, none from this change** ([`gate-summary-e2e-visual-final.txt`](gate-summary-e2e-visual-final.txt)):
  899 passed, 96 failed. A re-run of the non-AI failures on a fresh reseed passed 91 of 98; what
  remains:
  - **AI screens** (011a, 015c, 016b, 017c, 022d, 061f, 069a, 080f, 113a, 121a): this worktree's
    stack has no Bedrock credentials, so AI answers are not produced (`AI_PROVIDER_NOT_CONFIGURED`).
  - **`101-api-keys` desktop:** the date-dependent expiry width noted by B1 and B3.
  - **`092-integrations-hub` read-only tablet:** the Navan row text from B1, whose PR re-recorded
    only the desktop baselines.
  - The other failures in the long run (062, 080h, 092b-d, 120a, 120b) were sign-in redirects after
    the session expired in the hour-long run; they passed on the re-run.
- Baselines re-recorded through `npm run e2e:update-snapshots` (pinned image): `094a-adaptive-planning
plan-import` mobile, because the Plan tab now shows the form and a role note to every reader.
