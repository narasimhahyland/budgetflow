# Gap closure plan

The 20 phases are on `main` with evidence, but a review of the build plan against the code on
11 November 2026 found scope the plan lists that is not built, and proof thinner than the plan asks.
This page turns that into work packages. Each package is its own branch, worktree and pull request,
proven by `/functional-check` like any phase; screens also pass `/visual-qa`.

Every gap below was checked in the code (routes, contracts, services, specs) before it was listed.
Items the plan or [`handoff.md`](handoff.md) already defers (translations, entitlements, white-label,
dark theme, accessibility, isolated Testcontainers runs, native wrappers, the demo environment 102c,
SoD and access reviews, and the handoff's section 5) are not repeated here.

## Decisions needed first

| #   | Decision                                                                                                                                                                                                                                                                        | Why it blocks                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| D1  | The plan names a **"17-step core workflow"** (Phase 19), **"16 critical scenarios"** (Phase 17) and **"four required tables"** (Phase 20) but never defines them. Define them, or drop them in favour of the 10-step acceptance scenario and the catalog traceability (A3, A4). | Phases 17, 19 and 20 cannot be shown complete against criteria nobody wrote down |
| D2  | **Designs for new screens.** None of the 19 gap screens has an approved Stitch design. Design and approve first (the UX rule), or build from the written specs in `docs/ux/screens/` as screen 112 was.                                                                         | Every screen package (B2–B10) starts with this                                   |
| D3  | **Tax and benefit rules (B3).** Which rules: recoverable GST/VAT per entity and category, benefit-in-kind thresholds per country. Fictional seed rules are fine for the build; real rates need finance.                                                                         | The ledger postings depend on them                                               |
| D4  | **Navan access (B1).** The plan's open questions (webhooks, a pre-approval hook, Booking API, edition-gated endpoints, deactivating options) need Navan's documentation and ideally a test tenant. Credentials come from you, never the repository.                             | 16a says the questions are answered before the build                             |
| D5  | **Push delivery (B8)** needs Web Push keys (VAPID), which are secrets: they belong in env, like the five Phase 18 secrets.                                                                                                                                                      | Real delivery cannot be proven without them                                      |
| D6  | **Order.** The tiers below are a recommendation.                                                                                                                                                                                                                                | —                                                                                |

## Tier A — make what is claimed true (do first)

| Package                         | What                                                                                                                                                                                                                                                                                                                                                                                                                      | Areas                                                                            | Size |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---- |
| **A1** Report file exports      | Reports promise "export only (CSV, XLSX, PDF)", but `POST /reports/:id/exports` only records a row and the button reads "Record an export"; scheduled deliveries carry no attachment. Produce the files through `DocumentStore`, with formula neutralisation and the export audit event, and attach them to scheduled deliveries.                                                                                         | `libs/api/reports`, worker, `libs/web/features/reports`, contracts (additive)    | M    |
| **A2** Employee and gift caps   | Per-employee annual caps and the annual gift cap are saved as policy but never enforced; "employees nearest cap" is a fixture. Add the facts the rules need (employee year-to-date benefit, gift value, alcohol amount, non-employee count, intercompany flag, requester's recent total) and enforce them on requests.                                                                                                    | `libs/domain` rules evaluator, `libs/api/rules`, `libs/api/spend`; invariant map | M    |
| **A3** Full acceptance scenario | `wave-2-core.spec.ts` covers less than the plan's ten steps. Add, through the UI: the CEO creating the budget, the headcount true-up, the attendee split by employing entity, the intercompany block or recharge, the actionable-email decision, set to zero through its dialog, the INR file import, the unmatched queue, surplus return at close, the audit-trail view, FX shown separately. Expect it to find defects. | `apps/web-e2e/src/acceptance/`                                                   | M    |
| **A4** Catalog traceability     | Phase 17 traced every route (112/112), not the plan's ~120 feature-catalog rows. Map each row to a passing check, a package below or a recorded deferral.                                                                                                                                                                                                                                                                 | `evidence/phase-17/`, `docs/testing/`                                            | S    |

A1, A2 and A3 touch different files and can run in parallel; A4 closes after the others report.

**A1 is done.** Exports render the screen's own run (filters and scope) into CSV, XLSX or PDF in the
`DocumentStore` under `tenants/<id>/report-exports/`, download through a five-minute signed link,
neutralise CSV formulas, audit each export and each link, and scheduled emails carry the files to
recipients who can see the scope. Proof: `apps/api-e2e/src/reports/exports.spec.ts` (invariant 99)
and the report-frame download journey; evidence in `evidence/gap-a1-report-exports/`.

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
