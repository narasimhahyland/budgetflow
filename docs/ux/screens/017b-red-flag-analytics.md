# 017b Red-flag analytics

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 15 batch. Build phase P15. Insights > Dashboards > Red flags (`/dashboards/red-flags`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the chart language of 011. Planned Stitch states, to be generated in a later session:

| State                       | Planned image                                                       |
| --------------------------- | ------------------------------------------------------------------- |
| overview of four patterns   | `design/stitch/017b-red-flag-analytics/default--desktop--light.png` |
| just-under-threshold detail | `threshold--desktop--light.png`                                     |
| requester-approver pairs    | `pairs--desktop--light.png`                                         |
| audit sample created        | `sample--desktop--light.png`                                        |

## Purpose

Give the Finance Controller and auditors population-level signals of control gaming and weak approvals (amounts clustered just under approval thresholds, unusually round amounts, the same requester and approver pairing again and again, approvals given within seconds) to choose audit samples and tighten rules, as a complement to the per-request AI flags of 17c.

## Roles

Finance Controller and Auditor (full); Finance Admin (read). No owner, requester or approver access, and no notifications to the people involved.

## Entry points

Insights > Dashboards; 017a exceptions "Patterns"; 17c anomaly flags "See patterns"; 113 access review "Approval patterns of this person"; quarterly audit planning.

## Content and actions

Header bar: title, period (FY2026 to date), Export (CSV, XLSX, PDF), "Pattern settings". Four pattern cards with a signal count and trend, each opening a detail view:

- Just under threshold: requests within 5% below an approval threshold. Histogram of request amounts as a share of the nearest threshold, with the threshold line; expected share 4%, observed 11% for USD 5,000.00 (Events, IN01). Table: requester, budget, requests in the band, share of their requests, total. Sample: Rahul Verma, 6 of 14 requests between USD 4,750.00 and USD 4,999.99.
- Round amounts: share of requests and actuals in exact hundreds compared with the company baseline (18% vs 7%), by requester and vendor.
- Repeated requester-approver pairs: pairs where one approver decided at least 80% of a requester's 10 or more requests; with delegation-of-authority route context ("expected: only approver in the route" vs "other approvers available").
- Approvals within seconds: decisions above USD 1,000.00 made less than 10 seconds after opening, by approver, channel and time of day; sample: 14 approvals by one approver in 9 seconds on average, all from email.

Detail actions: drill down to the requests (060), "Create audit sample" (choose random or top N; saves a named sample with the requests and the criteria; Export), "Suggest a rule change" (opens 077 rule simulation prefilled, for example a split-detection window), Mark as reviewed (note).

Pattern settings (Finance Controller): band width (5%), round-amount unit (USD 100.00), pair concentration (80%, minimum 10 requests), fast approval (10 seconds, above USD 1,000.00), minimum sample size per entity (10).

## Data and permissions

New P15 `reports.ts` endpoints computing deterministic statistics over requests, approval tasks and actions (open and decision timestamps, channel), actuals and rule thresholds (P7 rules, delegation-of-authority routes); no model is involved. Audit samples are saved (criteria, request ids, creator) and exportable. `integrity.read` (Finance Controller, Auditor, Finance Admin) to view; creating samples and changing settings needs Finance Controller or Auditor. People appear by name because audit sampling needs it; the page is limited to these roles.

## States

| State             | Behaviour                                                                    |
| ----------------- | ---------------------------------------------------------------------------- |
| Overview          | four cards                                                                   |
| Detail            | chart, table, actions                                                        |
| Below sample size | entities with fewer than 10 requests listed as "Too few requests to compare" |
| Sample created    | success tag with the sample name and Export                                  |
| Reviewed          | neutral tag "Reviewed by Hannah Cole, 5 Nov" with the note                   |
| No signals        | success empty state "No patterns above the thresholds in this period"        |
| Loading / error   | `sat-ghost`; error banner with Retry                                         |

## Budget safety and audit

Signals are statistics for audit planning and never block, flag or change any request, approval or budget. Creating samples, marking reviewed and changing settings are audited; exports are audited.

## Responsive and accessibility

Desktop and tablet; mobile read-only overview. Histograms and bars have tables; thresholds are stated in text next to charts.

## Satori components

`sat-header-bar`, `sat-interactive-card` (pattern cards), `mat-table` with `satTableWithRowStates`, `sat-status-tag`, `sat-banner`, `sat-empty-state`, `sat-ghost`; histogram, bar and line charts from `libs/web/ui/charts`; Angular Material dialog (create sample, settings), snackbar.

## Related screens and navigation

017a exceptions dashboard, 17c anomaly flags, 074a post-spend exceptions, 077 rule simulation, 070a delegation-of-authority admin, 018a approval performance, 113 audit and compliance, 088 audit log.

## Decisions taken

- Red flags are deterministic statistics with visible thresholds, not AI. Recommended so audit can explain exactly why a pattern appears.
- They inform audit sampling and rule changes; nobody is notified or blocked, and there is no "accused" list.
- Entities with fewer than 10 requests are not compared, to avoid noise from small numbers.
- Only the Finance Controller, Auditor and Finance Admin can see the page, because it names people.
