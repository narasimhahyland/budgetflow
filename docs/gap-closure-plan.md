# Gap closure plan

The 20 phases are on `main` with evidence, but a review of the build plan against the code on
11 November 2026 found scope the plan lists that is not built, and proof thinner than the plan asks.
This page turns that into work packages. Each package is its own branch, worktree and pull request,
proven by `/functional-check` like any phase; screens also pass `/visual-qa`.

Every gap below was checked in the code (routes, contracts, services, specs) before it was listed.
Items the plan or [`handoff.md`](handoff.md) already defers (translations, entitlements, white-label,
dark theme, accessibility, isolated Testcontainers runs, native wrappers, the demo environment 102c,
SoD and access reviews, and the handoff's section 5) are not repeated here.

## Decisions (taken 12 November 2026)

| #   | Question                                                                                         | Decision                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | The plan's undefined "17-step core workflow", "16 critical scenarios" and "four required tables" | **Dropped.** The criteria are the full ten-step acceptance scenario (A3) and the feature-catalog traceability table (A4).                                                                                                                      |
| D2  | Designs for the 19 gap screens (none has an approved Stitch design)                              | **Build from the written specs** in `docs/ux/screens/` with the shared Satori components, as screen 112 was. `/visual-qa` still applies.                                                                                                       |
| D3  | Tax and benefit-in-kind rules (B3)                                                               | **Fictional seed rules**: configurable rates and thresholds in the seed, so the mechanism is complete; finance enters real ones later.                                                                                                         |
| D4  | Navan access (B1)                                                                                | **Build against the mock now**, to the public API shapes, with polling as the baseline; live mode behind an env flag, verified later against a test tenant.                                                                                    |
| D5  | Web Push keys (B8)                                                                               | Follow the Phase 18 pattern: a development key pair locally, refusal to start in production without real keys (`secretOrDev`).                                                                                                                 |
| D6  | Order                                                                                            | **A4 last in Tier A**; then **B2 dashboards, B3 tax and benefits, B1 Navan** in parallel (three sessions); then B5 finance exports (needs B3), B4, B7, B8, B9, B10, B6; Tier C alongside. At most three heavy sessions at once on one machine. |

## Tier A — make what is claimed true (do first)

| Package                                    | What                                                                                                                                                                                                                                                                                                                                                                                                                      | Areas                                                                            | Size |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---- |
| **A1** Report file exports                 | Reports promise "export only (CSV, XLSX, PDF)", but `POST /reports/:id/exports` only records a row and the button reads "Record an export"; scheduled deliveries carry no attachment. Produce the files through `DocumentStore`, with formula neutralisation and the export audit event, and attach them to scheduled deliveries.                                                                                         | `libs/api/reports`, worker, `libs/web/features/reports`, contracts (additive)    | M    |
| **A2** Employee and gift caps — **done**   | Per-employee annual caps and the annual gift cap are saved as policy but never enforced; "employees nearest cap" is a fixture. Add the facts the rules need (employee year-to-date benefit, gift value, alcohol amount, non-employee count, intercompany flag, requester's recent total) and enforce them on requests.                                                                                                    | `libs/domain` rules evaluator, `libs/api/rules`, `libs/api/spend`; invariant map | M    |
| **A3** Full acceptance scenario — **done** | `wave-2-core.spec.ts` covers less than the plan's ten steps. Add, through the UI: the CEO creating the budget, the headcount true-up, the attendee split by employing entity, the intercompany block or recharge, the actionable-email decision, set to zero through its dialog, the INR file import, the unmatched queue, surplus return at close, the audit-trail view, FX shown separately. Expect it to find defects. | `apps/web-e2e/src/acceptance/`                                                   | M    |
| **A4** Catalog traceability                | Phase 17 traced every route (112/112), not the plan's ~120 feature-catalog rows. Map each row to a passing check, a package below or a recorded deferral.                                                                                                                                                                                                                                                                 | `evidence/phase-17/`, `docs/testing/`                                            | S    |

A1, A2 and A3 touch different files and can run in parallel; A4 closes after the others report.

**A1 is done.** Exports render the screen's own run (filters and scope) into CSV, XLSX or PDF in the
`DocumentStore` under `tenants/<id>/report-exports/`, download through a five-minute signed link,
neutralise CSV formulas, audit each export and each link, and scheduled emails carry the files to
recipients who can see the scope. Proof: `apps/api-e2e/src/reports/exports.spec.ts` (invariant 99)
and the report-frame download journey; evidence in `evidence/gap-a1-report-exports/`.

**A3 done.** All ten steps run as one story through the UI with API assertions
(`Core acceptance scenario, end to end` in `wave-2-core.spec.ts`), passing from a fresh seed. It
found and fixed two event-money defects (reconciliation missed actuals matched to the event's
commitment; event detail showed no actual spend and its cap available again after close) and
two smaller UI ones. It recorded three findings for a decision: the event attendee search is
scoped to the organizer's region; the host entity's GL tie-out differs by the recharged share;
utilization carries no FX column. Evidence: [`evidence/gap-a3-acceptance/`](../evidence/gap-a3-acceptance/README.md).

**A2 done.** Per-employee annual caps and the annual gift cap are enforced on submission,
approval and counter-offer acceptance by rules R-31 (block above the employee cap), R-32 (warn from
80%) and R-33 (block above the annual gift cap), with usage read from the ledger; "employees nearest
cap" is computed from live spend. Building it showed the rules engine had never run on a real
request; it now does, and every decision is recorded with its rule versions and facts. Proof:
`apps/api-e2e/src/rules/caps.spec.ts` (invariants 100–102) and the policy-check journey; evidence in
[`evidence/gap-a2-caps/`](../evidence/gap-a2-caps/README.md).

## Tier B — build what is missing

| Package                             | What                                                                                                                                                                                                                                                                              | Depends on      | Size |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ---- |
| **B1** Navan live integration (16a) | The plan's Phase 16a: the real Navan Expense API in place of the placeholder adapter, inbound actuals in 93-day windows, outbound event-code options, and controls disabling options at the point of spend. Mock provider moved to the real shapes; live mode behind an env flag. | D4              | L    |
| **B2** Dashboards                   | 012 finance controller, 017 alerts, 017a exceptions, 018 pending approvals, 018a approval performance (cycle time, bottlenecks), 018b product analytics, 088a one-click evidence pack. Split in two.                                                                              | D2              | L    |
| **B3** Tax and benefits             | 080g tax-aware consumption (recoverable vs non-recoverable GST/VAT) and 080h the employee benefit ledger with benefit-in-kind thresholds. The tables exist, unused. Ledger-heavy: `/ledger-change`.                                                                               | D2, D3          | L    |
| **B4** Reclaim and burn rate        | 086a reclaim-and-redistribute campaigns, and burn-rate alerts.                                                                                                                                                                                                                    | D2              | M    |
| **B5** Finance exports              | 094b: intercompany recharges, chargeback and reclass journals, payroll benefit data.                                                                                                                                                                                              | B3 for benefits | M    |
| **B6** Developer portal             | 101a public API docs and sandbox (only `/api/openapi.json` exists). The sandbox overlaps the deferred demo environment, so scope it first.                                                                                                                                        | D2              | M    |
| **B7** Integration completeness     | Apply an Adaptive Planning import (plan to root budgets; today preview only), Outlook and Google RSVP sync, vendor master from the ERP (both read and reported only), Workday `runBudgetCheck`, 117a hand-off to a prefilled expense.                                             | —               | M–L  |
| **B8** Installable app and push     | 059a's installable mobile web app (web manifest, service worker) and real push delivery (today a row is recorded, nothing is sent).                                                                                                                                               | D5              | M    |
| **B9** AI jobs                      | The nightly outlook and anomaly scans (today on demand only) and 113a's reported-answers tab.                                                                                                                                                                                     | —               | S–M  |
| **B10** Experience                  | Onboarding wizard (005, 008, 010), 104 permission matrix, 124 profile and preferences, global search, 106 categories and custom fields (read-only today), 116a team budget card, 113 integrity-checks tab. Split by area.                                                         | D2              | L    |

**B2 part 1 done** (012, 017, 017a). The finance controller dashboard shows the close checklist per
entity, the queues that block the close, the ledger check, feeds and the FX effect; alerts are derived
on every read from the health checks, owner thresholds and controls, and acknowledging or snoozing is
per person; the exceptions dashboard counts control exceptions by type and age and links each to its
queue. Proof: `apps/api-e2e/src/dashboards/dashboards.spec.ts` (invariants 103–105) and the
dashboards journeys; evidence in [`evidence/gap-b2-dashboards/`](../evidence/gap-b2-dashboards/README.md).
Part 2 (018, 018a, 018b, 088a) follows.

## Tier C — prove what is built but thinly covered

- Connector scenarios for Odoo, Workday (HCM and Financials), NetSuite, Brex, Coupa and Google
  Calendar: each has a definition and no API scenario (Navan comes with B1).
- The board pack's constant-currency variance: no scenario or journey.
- The approval routing workflow builder (070): no journey.
- Intercompany markup and the tax approver, cancellation fees, period and seasonal phasing, cascade:
  one API scenario each, no journey.
- Migrations: tested from empty and from the previous migration only; the plan asks for an upgrade
  from each earlier schema.
- Performance at the plan's scale (50,000 budgets, 500,000 ledger entries); Phase 17 measured about
  20,000 lines.

## Carried defects

#82 (blank renders), the AI-caption id wrap (in progress in its own session), the board pack's zeros
(the seed closes a period without close snapshots), the monospace style stylelint misses, and the
"Nadia Farouk" fallback name.

## How to run it

- One package per worktree (`scripts/worktree.sh new <scope>`), each with its own stack and ports.
  At most three or four at once on one machine: every package runs the full gate, and heavy runs
  disturb each other (handoff section 7).
- Shared surfaces (`libs/contracts`, `libs/api/db`, `infra/`) change only inside a package that owns
  them, one migration at a time, numbered from `0022`.
- Each package updates the invariant map and its evidence, and this page, when it merges.
