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

| #   | Question                                                                                                                         | Decision                                                                                                                                                                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | The plan's undefined "17-step core workflow", "16 critical scenarios" and "four required tables"                                 | **Dropped.** The criteria are the full ten-step acceptance scenario (A3) and the feature-catalog traceability table (A4).                                                                                                                                                                                                              |
| D2  | Designs for the 19 gap screens (none has an approved Stitch design)                                                              | **Build from the written specs** in `docs/ux/screens/` with the shared Satori components, as screen 112 was. `/visual-qa` still applies.                                                                                                                                                                                               |
| D3  | Tax and benefit-in-kind rules (B3)                                                                                               | **Fictional seed rules**: configurable rates and thresholds in the seed, so the mechanism is complete; finance enters real ones later.                                                                                                                                                                                                 |
| D4  | Navan access (B1)                                                                                                                | **Build against the mock now**, to the public API shapes, with polling as the baseline; live mode behind an env flag, verified later against a test tenant.                                                                                                                                                                            |
| D5  | Web Push keys (B8)                                                                                                               | Follow the Phase 18 pattern: a development key pair locally, refusal to start in production without real keys (`secretOrDev`).                                                                                                                                                                                                         |
| D6  | Order                                                                                                                            | **A4 last in Tier A**; then **B2 dashboards, B3 tax and benefits, B1 Navan** in parallel (three sessions); then B5 finance exports (needs B3), B4, B7, B8, B9, B10, B6; Tier C alongside. At most three heavy sessions at once on one machine.                                                                                         |
| D7  | AI provider after [#119](https://github.com/narasimhahyland/budgetflow/pull/119) moved AI to Amazon Bedrock and removed the fake | **Keep Bedrock in the product and add back an offline recorded provider for tests** (`AI_PROVIDER=recorded`, the default for the stack, functional runs and CI; `bedrock` selected explicitly). Restores the guardrail and extraction evals and the figure-guard and schema-discard scenarios. **Done**: `evidence/ai-offline-tests/`. |

## Tier A — make what is claimed true (do first)

| Package                                    | What                                                                                                                                                                                                                                                                                                                                                                                                                      | Areas                                                                            | Size |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---- |
| **A1** Report file exports — **done**      | Reports promise "export only (CSV, XLSX, PDF)", but `POST /reports/:id/exports` only records a row and the button reads "Record an export"; scheduled deliveries carry no attachment. Produce the files through `DocumentStore`, with formula neutralisation and the export audit event, and attach them to scheduled deliveries.                                                                                         | `libs/api/reports`, worker, `libs/web/features/reports`, contracts (additive)    | M    |
| **A2** Employee and gift caps — **done**   | Per-employee annual caps and the annual gift cap are saved as policy but never enforced; "employees nearest cap" is a fixture. Add the facts the rules need (employee year-to-date benefit, gift value, alcohol amount, non-employee count, intercompany flag, requester's recent total) and enforce them on requests.                                                                                                    | `libs/domain` rules evaluator, `libs/api/rules`, `libs/api/spend`; invariant map | M    |
| **A3** Full acceptance scenario — **done** | `wave-2-core.spec.ts` covers less than the plan's ten steps. Add, through the UI: the CEO creating the budget, the headcount true-up, the attendee split by employing entity, the intercompany block or recharge, the actionable-email decision, set to zero through its dialog, the INR file import, the unmatched queue, surplus return at close, the audit-trail view, FX shown separately. Expect it to find defects. | `apps/web-e2e/src/acceptance/`                                                   | M    |
| **A4** Catalog traceability — **done**     | Phase 17 traced every route (112/112), not the plan's ~120 feature-catalog rows. Map each row to a passing check, a package below or a recorded deferral.                                                                                                                                                                                                                                                                 | `evidence/phase-17/`, `docs/testing/`                                            | S    |

A1, A2 and A3 touch different files and can run in parallel; A4 closes after the others report.

**A4 is done:** all 119 catalog features mapped in
[`evidence/gap-a4-traceability/`](../evidence/gap-a4-traceability/README.md): 72 proven, 14 built but
unproven (now in Tier C), 19 gaps (17 in packages below, 2 new ones added to B10), 14 deferred.

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

| Package                                        | What                                                                                                                                                                                                                                                                                                                                                                | Depends on      | Size |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ---- |
| **B1** Navan live integration (16a) — **done** | The plan's Phase 16a: the real Navan Expense API in place of the placeholder adapter, inbound actuals in 93-day windows, outbound event-code options, and controls disabling options at the point of spend. Mock provider moved to the real shapes; live mode behind an env flag.                                                                                   | D4              | L    |
| **B2** Dashboards — **done**                   | 012 finance controller, 017 alerts, 017a exceptions, 018 pending approvals, 018a approval performance (cycle time, bottlenecks), 018b product analytics, 088a one-click evidence pack. Split in two.                                                                                                                                                                | D2              | L    |
| **B3** Tax and benefits — **done**             | 080g tax-aware consumption (recoverable vs non-recoverable GST/VAT) and 080h the employee benefit ledger with benefit-in-kind thresholds. The tables exist, unused. Ledger-heavy: `/ledger-change`.                                                                                                                                                                 | D2, D3          | L    |
| **B4** Reclaim and burn rate — **done**        | 086a reclaim-and-redistribute campaigns, and burn-rate alerts.                                                                                                                                                                                                                                                                                                      | D2              | M    |
| **B5** Finance exports                         | 094b: intercompany recharges, chargeback and reclass journals, payroll benefit data.                                                                                                                                                                                                                                                                                | B3 for benefits | M    |
| **B6** Developer portal                        | 101a public API docs and sandbox (only `/api/openapi.json` exists). The sandbox overlaps the deferred demo environment, so scope it first.                                                                                                                                                                                                                          | D2              | M    |
| **B7** Integration completeness                | Apply an Adaptive Planning import (plan to root budgets; today preview only), Outlook and Google RSVP sync, vendor master from the ERP (both read and reported only), Workday `runBudgetCheck`, 117a hand-off to a prefilled expense.                                                                                                                               | —               | M–L  |
| **B8** Installable app and push                | 059a's installable mobile web app (web manifest, service worker) and real push delivery (today a row is recorded, nothing is sent).                                                                                                                                                                                                                                 | D5              | M    |
| **B9** AI jobs                                 | The nightly outlook and anomaly scans (today on demand only) and 113a's reported-answers tab.                                                                                                                                                                                                                                                                       | —               | S–M  |
| **B10** Experience                             | "Load sample data" on the setup checklist; a role suggested from the job title on bulk invites; a program logo in branding (found by A4); onboarding wizard (005, 008, 010), 104 permission matrix, 124 profile and preferences, global search, 106 categories and custom fields (read-only today), 116a team budget card, 113 integrity-checks tab. Split by area. | D2              | L    |

**B1 done.** Navan runs on its documented paths and shapes against the mock provider (D4): OAuth
client credentials without a scope parameter, a worker-cached token, the EU region header, 93-day
modified-date windows, cursor paging and 429 backoff; pulls become actuals review batches with
receipts in the `DocumentStore`; event codes and cost centers are Navan field options switched off
while their budget does not accept spend; coding is written back by batch PATCH; spend above the
remaining budget becomes an `over_budget` exception. Live calls need `NAVAN_LIVE_ENABLED=true`.
Design and values to confirm before live use: [`navan-integration.md`](architecture/navan-integration.md).
Proof: `apps/api-e2e/src/integrations/navan.spec.ts` (invariants 106-108) and the Navan journeys;
evidence in [`evidence/gap-b1-navan/`](../evidence/gap-b1-navan/README.md).

**B2 done.** 012 finance controller (close checklist per entity, blocking queues, ledger check,
feeds, FX effect), 017 alerts (derived on every read from health checks, owner thresholds and
controls; acknowledge and snooze per person), 017a exceptions (by type and age, each linked to its
queue), 018 pending approvals (held versus not yet held, SLA, a four-hourly nudge that decides
nothing), 018a approval performance (names only for finance, aggregates for analysts, own figures for
approvers), 018b product analytics (`GET /api/analytics/kpis`, counts only, against the plan targets)
and 088a evidence packs (new action `evidence.generate`, migration 0024, worker-built ZIP with a
SHA-256 manifest and a verified audit chain). Proof: `apps/api-e2e/src/dashboards/` (invariants
103–105 and 113–115) and the dashboards journeys; evidence in
[`evidence/gap-b2-dashboards/`](../evidence/gap-b2-dashboards/README.md). Not built: the Export and
Schedule menus of these dashboards, sidebar entries, and the evidence-pack entry on event and budget
details.

**B3 done.** Tax-aware consumption (080g): a request's amount is net of tax, and on submission its
GST/VAT splits by the published rule in force (legal entity × spend category × attendee type, mixed
attendance in proportion to employees present). The commitment uses the net plus only the
non-recoverable tax; recoverable tax is recorded on append-only tax lines and never uses budget.
Actual imports take optional `tax_amount`, `tax_category`, `employees_present` and `others_present`
columns, and a taxed line uses its gross less the recoverable tax. Rule sets and benefit thresholds
are versioned: finance drafts, the tax approver (Finance Controller, new `tax.publish`) publishes
from an effective date, and published versions never change. The employee benefit ledger (080h)
writes each attended employee's final cost per attendee at event close, the shares of approved
requests that name recipients, and entries finance records. Entries are append-only, reversed by
negating rows, and evaluated against each threshold in its own tax year (whole amount or excess
reportable; company caps never reportable). Seeded rates and thresholds are fictional (D3); screens
are built from the specs (D2). Migration `0023`. Proof: `apps/api-e2e/src/tax/` (invariants
109-112) and the `finance-admin/tax-benefits` journeys. Evidence:
[`evidence/gap-b3-tax-benefits/`](../evidence/gap-b3-tax-benefits/README.md). Left for B5: the
payroll export tab and batches (the ledger shows the reportable amounts B5 exports). Left as
follow-ups: the screens' CSV/XLSX/PDF export, employees seeing their own benefits (122), and the
071 cap reading the benefit ledger instead of live request consumption.

**B4 done.** Reclaim campaigns (086a, built from the spec, D2): finance (or the CEO) previews and
starts a campaign; every budget forecast to lapse above the criteria gets a notice; its owner
releases all, part, or keeps it with a reason and plan, never above the floor (allocated out, held,
encumbered and actual as they stand when the owner answers). Reminders go out 2 days and 1 day before
the response date. After the deadline finance can send an unanswered notice to the nearest ancestor
owner who is not its owner; nothing is reclaimed automatically. A Finance Admin redistributes each
legal entity's pool through a confirm dialog with the floor check per source: reductions with a
destination to targets in the same entity and tree, the rest back to each source's parent, in one
idempotent command under ordered locks with one audit entry. Burn-rate alerts: the worker compares
actual spend with the amount phased to date and tells owners at 110% and 125%, once per budget,
period and level, through the existing notifications. The year-end page links to the campaigns.
Migrations `0026` and `0028`; new actions `reclaim.read`, `reclaim.manage`, `reclaim.redistribute`,
`burn_rate.run`. Proof: `apps/api-e2e/src/close/reclaim.spec.ts` and `burn-rate.spec.ts`
(invariants 116-121) and the reclaim journeys. Evidence:
[`evidence/gap-b4-reclaim/`](../evidence/gap-b4-reclaim/README.md) and
[`evidence/gap-b4-followups/`](../evidence/gap-b4-followups/README.md) (#127, #129). Not built: the
Stitch images for 086a, an entry from the 086 unused report (it renders through the shared report
frame), and a burn-rate panel on the budget page (alerts reach owners only as notifications).

## What next (13 November 2026)

Done and merged: A1-A4, B1, B2 (#117, #130), B3, B4 (#127, #129), D7 offline AI tests (#126), the
date-only fix (#128). Open, in the D6 order:

1. **B5 finance exports**: built in its own worktree, no PR yet; its session waits for a decision.
   It claims migration `0025` and must start its invariant rows at **122** (121 is B4's on `main`).
2. **B7 integration completeness**: in its own worktree, no PR yet; waits for a decision. Migration
   `0027`, invariant rows 130-136.
3. **B8 installable app and push**, **B9 AI jobs**, **B10 experience** (split by area), then **B6
   developer portal** (scope the sandbox first). Not started. The next free migration number is
   `0029`; the next free invariant row after B5 is 126 (B7 holds 130-136).
4. **Bugs** below, which are small and can run alongside: the notification feed paging first, since
   it shows wrong counts to real users.
5. **Tier C** proof gaps, alongside.

## Tier C — prove what is built but thinly covered

- Features A4 found built but with no test naming them: program templates (020b), the per-head
  limit on actual attendance, the event photo gallery, card-limit push when enabled, an INR
  per-head rate, forecast at completion per event, asking questions in Slack and Teams, quote
  extraction, the fairness and participation-reach reports (only a generic tie-out loop), posting
  scheduled reports to channels, chart table alternatives and the keyboard grid.
- Red-flag analytics (017b) is blocked on a schema change to approval tasks (handoff section 5)
  and has no package: it needs a decision.
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

## Bugs and carried defects

Checked against `main` on 13 November 2026.

| Bug                                                           | Where                                                            | Effect                                                                                                                                                                                                                                                       | Status    |
| ------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| Notification feed ignores its cursor                          | `ChannelsService` list (`GET /api/notifications`)                | Loaded the newest 200 rows and filtered them in memory with `nextCursor` always null. Now filters, a (created_at, id) cursor and the counts run in SQL, and the feed has "Show older notifications" (invariant 126, `channels/notification-paging.spec.ts`). | Fixed     |
| API and worker database sessions are not pinned               | `withTenant` (no `app.fixed_now`); the worker has no `FIXED_NOW` | On a pinned stack, rows they write get today's real date while the API reasons as of the pinned day (B2's finding). Test stacks only.                                                                                                                        | Open      |
| Reclaim notices keep the owner from when the campaign started | `ReclaimService.respond`                                         | After a budget changes owner, the new owner cannot answer and the old one is refused, until finance escalates after the deadline.                                                                                                                            | Open, low |
| A reclaim pool's remainder can leave its legal entity         | `ReclaimService` pool legs to each source's parent               | When a source's parent is in another legal entity, the remainder moves across entities without intercompany handling (the same as the existing reduce to parent).                                                                                            | Open, low |
| A burn-rate run accepts any as-of date                        | `BurnRateService.request`                                        | A back- or forward-dated run uses up the once-per-period alert for that period.                                                                                                                                                                              | Open, low |
| One set-to-zero source fails a whole reclaim pool             | `ControlsService.reclaimInTx`                                    | A source set to zero after releasing makes the pool's execution fail for every source, instead of skipping that source.                                                                                                                                      | Open, low |
| #82 blank renders                                             | visual suite                                                     | About one state per run renders blank, fails its readiness wait and passes on retry.                                                                                                                                                                         | Open      |
| Board pack zeros                                              | seed                                                             | The seed closes a period without close snapshots.                                                                                                                                                                                                            | Open      |
| Monospace style                                               | stylelint                                                        | A monospace style stylelint does not catch.                                                                                                                                                                                                                  | Open      |
| "Nadia Farouk" fallback name                                  | `ChannelsService` chat installations                             | A hard-coded installer name when none is recorded.                                                                                                                                                                                                           | Open      |

Fixed since the last revision: the AI-caption id wrap (#114), the seeded API key's real-clock expiry
(#123), date-only fields a day early west of UTC (#128).

## How to run it

- One package per worktree (`scripts/worktree.sh new <scope>`), each with its own stack and ports.
  At most three or four at once on one machine: every package runs the full gate, and heavy runs
  disturb each other (handoff section 7).
- Shared surfaces (`libs/contracts`, `libs/api/db`, `infra/`) change only inside a package that owns
  them, one migration at a time. Taken: `0022`-`0028` (`0025` B5, `0027` B7 unmerged); next `0029`.
- Each package updates the invariant map and its evidence, and this page, when it merges.
