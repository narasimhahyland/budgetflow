# Gap A4 — feature-catalog traceability

Phase 17 traced every routed screen to a functional check (112 of 112). The build plan's definition of
done asks more: every feature in its catalog traced to a passing check. This maps all **119 catalog
features** (sections A to M of the product and finance review the plan's "Feature catalog coverage"
draws on) against `main` at `7cfc7a11`, 12 November 2026.

How it was built: a read-only pass over every API scenario (`apps/api-e2e/src/`) and journey
(`apps/web-e2e/src/`), the invariant map, the gap plan and the handoff's deferrals. A feature is
**PROVEN** only when a test _title_ names the behaviour (file names alone do not count); a feature with
several parts takes the status of its weakest part. Three findings were re-checked in the code before
publishing (no logo in branding, no job-title role suggestion, card-limit push tested only off).

| Status         | Count | Meaning                                                        |
| -------------- | ----- | -------------------------------------------------------------- |
| PROVEN         | 72    | A passing API scenario or journey names it                     |
| BUILT-UNPROVEN | 14    | The code exists; no test title covers it (added to Tier C)     |
| GAP            | 19    | Not built: 17 in a gap-plan package, 2 newly added to B10      |
| DEFERRED       | 14    | Deferred by the plan or by decision (handoff sections 4 and 5) |

Paths: `api/` is `apps/api-e2e/src/`, `web/` is `apps/web-e2e/src/`. Packages are from
[`docs/gap-closure-plan.md`](../../docs/gap-closure-plan.md); §4 and §5 are sections of
[`docs/handoff.md`](../../docs/handoff.md).

| #   | Feature                                          | Status         | Evidence                                                                |
| --- | ------------------------------------------------ | -------------- | ----------------------------------------------------------------------- |
| A1  | Program templates                                | BUILT-UNPROVEN | templates page (020b), visual only                                      |
| A2  | Per-head driver allocation                       | PROVEN         | api/budgets/per-head-grid; web/budgets/budgets                          |
| A3  | HR headcount import and refresh                  | PROVEN         | api/org/imports; web/org/people-headcount                               |
| A4  | Contingency reserve with release approval        | PROVEN         | api/budgets/transfers-requests; api/budgets/p4-plan-baseline            |
| A5  | Plan spreadsheet import with column mapping      | PROVEN         | api/budgets/planning; web/budgets/budgets                               |
| A6  | Allocation grid, paste from Excel, one change    | PROVEN         | api/budgets/per-head-grid; web/budgets/budgets                          |
| A7  | Roll forward or clone budget tree                | PROVEN         | api/budgets/planning                                                    |
| A8  | Period phasing                                   | PROVEN         | api/budgets/planning (no journey; Tier C)                               |
| A9  | Plan versions                                    | PROVEN         | api/budgets/planning; api/ledger/original-budget                        |
| A10 | What-if scenarios, compare and promote           | PROVEN         | api/extended/scenarios; web/extended/scenarios                          |
| B1  | Freeze, reduce, set to zero with impact          | PROVEN         | api/budgets/controls; api/requests/controls                             |
| B2  | Reduction destination, floor, cascade            | PROVEN         | api/budgets/controls; api/budgets/concurrent-controls                   |
| B3  | Standard reason codes                            | PROVEN         | api/budgets/controls; api/finance/master-data                           |
| B4  | DoA matrix, versioned                            | PROVEN         | api/finance/doa; api/rules/workflows-authority                          |
| B5  | Approval hygiene                                 | PROVEN         | api/approvals/hygiene; web/approvals/delegations                        |
| B6  | Per-head limits on planned and actual attendance | BUILT-UNPROVEN | planned in api/budgets/planning; actual-attendance check untested       |
| B7  | Owner alert thresholds                           | PROVEN         | api/budgets/planning; api/actuals/utilization-thresholds                |
| B8  | Per-employee annual cap                          | PROVEN         | api/rules/caps; web/rules/caps (A2)                                     |
| B9  | Gifts, entertainment and alcohol policy          | PROVEN         | api/rules/caps; api/org/effective-dating                                |
| B10 | Vendor controls with ERP vendor master           | GAP B7         | lists in api/finance/master-data; ERP master is B7                      |
| B11 | Post-spend re-check, exception queue             | PROVEN         | api/rules/workflows-authority; api/integrations/navan                   |
| B12 | Split and duplicate request detection            | PROVEN         | api/ai/suggestions-are-drafts; web/ai/suggestions                       |
| B13 | Red-flag analytics                               | DEFERRED       | §5 (017b, needs a schema change)                                        |
| C1  | Cross-location event with cost split             | PROVEN         | web/spend/events; web/acceptance/wave-2-core                            |
| C2  | Funding cap, surplus returned per contributor    | PROVEN         | api/events/funding-cap; api/actuals/event-close                         |
| C3  | Invitations and RSVP, capacity, waitlist         | PROVEN         | api/events/event-depth; web/spend/event-depth                           |
| C4  | Attendee needs                                   | PROVEN         | api/events/event-depth; web/spend/event-depth                           |
| C5  | Per-head cost from attendance                    | PROVEN         | api/events/event-depth; web/spend/event-depth                           |
| C6  | Vendor quotes to commitment                      | PROVEN         | api/events/event-depth                                                  |
| C7  | Event checklist, tasks, agenda                   | PROVEN         | web/spend/event-depth                                                   |
| C8  | Event templates, recurring, clone                | PROVEN         | api/events/event-depth; web/spend/event-depth                           |
| C9  | Calendar invites with RSVP sync                  | GAP B7         | Outlook and Google RSVP sync                                            |
| C10 | Post-event survey and photo gallery              | BUILT-UNPROVEN | survey in api/events/event-depth; gallery untested                      |
| C11 | Event ROI scorecard                              | PROVEN         | api/events/event-depth; web/spend/event-depth                           |
| C12 | QR or mobile check-in                            | DEFERRED       | §5 (047c)                                                               |
| C13 | Polls and idea board                             | DEFERRED       | §5 (044a)                                                               |
| C14 | Holiday and festival overlay                     | DEFERRED       | §5 (043a)                                                               |
| C15 | Remote and hybrid participation                  | DEFERRED       | §5 (047d)                                                               |
| D1  | Inter-Director Budget Contribution Request       | PROVEN         | api/contributions/partial-approval; web/spend/events                    |
| D2  | Live co-funding board                            | PROVEN         | api/events/scope; web/spend/events                                      |
| D3  | Legal entity and cost center everywhere          | PROVEN         | api/finance/master-data; api/scope/tenant-references                    |
| D4  | Intercompany policy with tax approver            | PROVEN         | api/contributions/intercompany (no journey; Tier C)                     |
| D5  | Split by employing entity and cost center        | PROVEN         | web/acceptance/wave-2-core (step 5)                                     |
| D6  | Intercompany recharge export to ERP              | GAP B5         | finance exports                                                         |
| D7  | Chargeback and reclass journals                  | GAP B5         | finance exports                                                         |
| D8  | Request changes or counter-offer                 | PROVEN         | web/spend/requests; api/rules/caps                                      |
| E1  | Spend buckets, control basis, modes              | PROVEN         | api/ledger/available; api/actuals/over-tolerance                        |
| E2  | Chart of accounts and dimension mapping          | PROVEN         | api/org/effective-dating; api/finance/master-data                       |
| E3  | Actuals import, auto-match, queue, refunds       | PROVEN         | api/actuals/import-auto-match; api/actuals/refunds-reversals            |
| E4  | GL tie-out with monthly sign-off                 | PROVEN         | api/actuals/tieout; web/accounting/tieout                               |
| E5  | Cross-source de-duplication                      | PROVEN         | api/integrations/duplicates-and-pushes; web/integrations/integrations   |
| E6  | Event-code master push                           | PROVEN         | api/integrations/duplicates-and-pushes; api/integrations/navan          |
| E7  | Push commitments into card limits                | BUILT-UNPROVEN | only "off by default" and "refuses" titles                              |
| E8  | Commitment hygiene, fees, deposits               | PROVEN         | api/actuals/prepaids-hygiene; web/accounting/actuals                    |
| E9  | Accrual proposals, auto-reverse                  | PROVEN         | api/actuals/accruals                                                    |
| E10 | Prepaids by service period                       | PROVEN         | api/actuals/prepaids-hygiene                                            |
| E11 | Tax-aware consumption (GST/VAT)                  | PROVEN         | api/tax/tax-consumption; web/finance-admin/tax-benefits (B3)            |
| E12 | Benefit-in-kind thresholds with payroll export   | GAP B5         | thresholds proven in api/tax/benefit-ledger; payroll export is B5       |
| E13 | Withholding tax on commitments                   | DEFERRED       | §5 (080i)                                                               |
| F1  | Currency triplet, plan-rate allocation check     | PROVEN         | api/ledger/fx-triplet; api/budgets/over-allocation                      |
| F2  | Rate types and source                            | PROVEN         | api/finance/fx-rates                                                    |
| F3  | Local-currency per-head rates, lakh formatting   | BUILT-UNPROVEN | lakh in web/shell/formatting; INR per-head rate untested                |
| F4  | Fiscal calendar engine                           | PROVEN         | api/finance/fiscal-calendars; web/finance-admin/finance-setup           |
| F5  | Constant-currency variance, FX separate          | BUILT-UNPROVEN | FX separate in api/actuals/fx-plan-rate; constant currency untested     |
| F6  | Period close, lock, snapshots, late items        | PROVEN         | api/close/period-close; api/ledger/closed-period                        |
| G1  | Forecast methods, forecast at completion         | BUILT-UNPROVEN | methods in api/close/forecast-cycle; at-completion untested             |
| G2  | Reforecast cycles with commentary thresholds     | PROVEN         | api/close/forecast-cycle; web/reports/forecast-board-pack               |
| G3  | Adaptive Planning import and export              | GAP B7         | preview only (api/integrations/retries-and-planning)                    |
| G4  | Rollover policies                                | PROVEN         | api/close/year-end; web/close/year-end                                  |
| G5  | Year-end run with burn-rate alerts               | GAP B4         | run proven in api/close/year-end; burn-rate alerts are B4               |
| G6  | Reclaim and redistribute                         | GAP B4         | 086a                                                                    |
| H1  | Hierarchy routing with rule explanation          | PROVEN         | api/approvals/doa-routing; api/rules/workflows-authority                |
| H2  | Actionable approval email                        | PROVEN         | api/approvals/email-links; web/spend/approvals                          |
| H3  | Approval card with remaining budget              | PROVEN         | web/spend/approvals; api/quality/exploratory-findings                   |
| H4  | Slack app                                        | PROVEN         | api/channels/chat-commands; api/channels/chat-webhooks                  |
| H5  | Teams app                                        | PROVEN         | api/channels/chat-webhooks; web/channels/channels                       |
| H6  | Installable mobile web app with push             | GAP B8         | mobile routes proven in web/channels/channels; manifest and push are B8 |
| H7  | Role-based digests                               | PROVEN         | api/channels/notifications                                              |
| H8  | Comments and @mentions                           | PROVEN         | api/channels/discussions                                                |
| H9  | Follow or watch                                  | PROVEN         | api/channels/discussions                                                |
| H10 | Native iOS and Android apps                      | DEFERRED       | §4 (115a)                                                               |
| I1  | "Your team's budget" card                        | GAP B10        | 116a                                                                    |
| I2  | Hand-off to prefilled expense                    | GAP B7         | 117a                                                                    |
| I3  | Recognition awards                               | PROVEN         | api/extended/recognition; web/extended/recognition                      |
| I4  | Per-person wallets                               | PROVEN         | api/extended/wallets; web/extended/wallets                              |
| I5  | Gamified participation                           | DEFERRED       | leaderboard proven (api/extended/outcomes); badges in §5                |
| I6  | Organizer recognition                            | PROVEN         | api/extended/recognition; web/extended/recognition                      |
| J1  | Plain-language questions in app, Slack, Teams    | BUILT-UNPROVEN | app in api/ai/scoped-retrieval, web/ai/ask; chat asking untested        |
| J2  | Spend prediction with nudges                     | GAP B9         | on-demand outlook proven; nightly scan is B9                            |
| J3  | Suggested allocations                            | PROVEN         | api/ai/suggestions-are-drafts; web/ai/suggestions                       |
| J4  | Policy assistant                                 | PROVEN         | web/ai/settings                                                         |
| J5  | AI transaction matching                          | PROVEN         | api/ai/suggestion-decisions; web/ai/suggestions                         |
| J6  | Receipt and quote extraction                     | BUILT-UNPROVEN | receipt proven; quote extraction untested                               |
| J7  | Anomaly flags                                    | PROVEN         | api/ai/suggestions-are-drafts; web/ai/suggestions                       |
| J8  | Drafted leadership summary and commentary        | PROVEN         | api/extended/narratives; web/extended/narratives                        |
| J9  | Event planning copilot                           | DEFERRED       | §5 (045b)                                                               |
| K1  | Utilization by location and team; audit trail    | PROVEN         | api/reports/reconciliation; api/audit/hash-chain                        |
| K2  | Product telemetry                                | GAP B2         | intake proven (api/identity/analytics); dashboard 018b is B2 part 2     |
| K3  | Fairness view, spend per head                    | BUILT-UNPROVEN | only a generic report tie-out loop                                      |
| K4  | Participation and reach                          | BUILT-UNPROVEN | only a generic report tie-out loop                                      |
| K5  | Approval performance                             | GAP B2         | 018a, B2 part 2                                                         |
| K6  | Board and FP&A pack                              | BUILT-UNPROVEN | api/reports/board-pack; constant currency untested                      |
| K7  | Scheduled reports to Slack and Teams             | BUILT-UNPROVEN | channel setup proven; a posted message untested                         |
| K8  | One-click evidence pack                          | GAP B2         | 088a, B2 part 2                                                         |
| K9  | Outcome linkage                                  | PROVEN         | api/extended/outcomes; web/extended/outcomes                            |
| K10 | BI connector                                     | PROVEN         | api/ecosystem/bi-connector; web/ecosystem/ecosystem                     |
| L1  | Setup checklist with "load sample data"          | GAP B10        | checklist proven; sample data not built (added to B10)                  |
| L2  | Demo tenant and rules sandbox                    | DEFERRED       | §4 (102c); rules simulation proven in api/rules/rules-engine            |
| L3  | Bulk invites with role from job title            | GAP B10 (new)  | invites proven; no role suggested from the job title (added to B10)     |
| L4  | Plans and entitlements                           | DEFERRED       | plan's multi-customer backlog; §4 (105a)                                |
| L5  | Program branding (logo, name, email)             | GAP B10 (new)  | name, footer, accent proven; no logo (added to B10)                     |
| L6  | Translations                                     | DEFERRED       | plan (out of scope); §4                                                 |
| L7  | Chart table alternatives, keyboard grid          | BUILT-UNPROVEN | built; accessibility checks deferred (§4)                               |
| L8  | White-label for resellers                        | DEFERRED       | plan's multi-customer backlog                                           |
| M1  | Public API, webhooks, docs, sandbox              | GAP B6         | API and webhooks proven; docs and sandbox are B6                        |
| M2  | No-code connectors                               | DEFERRED       | actions proven (api/ecosystem/automations); trigger delivery in §5      |
| M3  | Assistant connector (MCP)                        | PROVEN         | api/ecosystem/assistant-connector; web/ecosystem/ecosystem              |
| M4  | Embeddable widgets                               | PROVEN         | api/ecosystem/widgets; web/ecosystem/ecosystem                          |
| M5  | Partner marketplace                              | PROVEN         | api/ecosystem/marketplace; web/ecosystem/ecosystem                      |

Counts move as packages merge. K2, K5 and K8 (dashboards 018b, 018a and the evidence pack 088a) are
built, but B2 part 2 is **not on `main`**: its PR #121 was stacked on #117 and merged into #117's
leftover branch after #117 had already merged, so its five commits (and migration `0024`) are being
reopened to `main`. B4, B5 and B7 are in progress.

Notes:

- B13 (red-flag analytics) is blocked rather than deferred: handoff §5 says it needs a schema change
  to approval tasks. It has no package; it needs a decision.
- The AI rows (J1–J9) reflect `main` before the Bedrock switch's offline-test restoration; the AI
  session is restoring the recorded provider and its coverage.
