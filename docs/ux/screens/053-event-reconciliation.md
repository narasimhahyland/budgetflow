# 053 Event budget reconciliation

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 6 batch. Build phase P6. Route in the Phase 6 build: Finance > Actuals and matching > Event reconciliation (`/finance/actuals/events` list, `/finance/actuals/events/:eventId` detail); also the "Reconciliation" tab of 046 once the event is completed.

## Design

Not generated yet: the Stitch daily screen-generation limit was reached on 2026-11-05 before this batch started (see the review log). Build from this spec with the shared components (000, 000a) and the visual language of 051 and 080a-080c. Planned exports:

| State                    | Planned image                                                        |
| ------------------------ | -------------------------------------------------------------------- |
| blocked (three blockers) | `design/stitch/053-event-reconciliation/default--desktop--light.png` |
| ready to close           | `ready--desktop--light.png`                                          |
| events list              | `list--desktop--light.png`                                           |

## Purpose

Show, for one completed event, whether every cost is matched, every commitment settled and every cross-entity contribution recharged, what the event really cost in USD (with FX shown separately), and how much surplus goes back to each contributor, so the event can be closed (054) with confidence.

## Roles

Event organizer (reads, resolves what they own), owning budget owner (Location Manager) and contributing owners (read their share), Finance Controller and Finance Admin (resolve and close). Auditors read.

## Entry points

046 event details when the event is Completed or Reconciling ("Start reconciliation"); Finance > Actuals and matching > Event reconciliation (list); 080b and 085a links filtered by event code; notifications "Offsite 2026 is ready to reconcile".

## Content and actions

Sample: Offsite 2026, event code EVT-2026-0087, Bengaluru, 22-24 Oct 2026, organizer Rahul Verma, owning budget Bengaluru Events (Anand Kumar), legal entity IN01, status Reconciling.

- Header: event name, code, status tag (Reconciling, warning tone), dates, owning budget and entity. Actions: "Close event" (`satImportantButton`, disabled until nothing blocks; the reason is written next to it: "Resolve 3 blockers to close"), Export (CSV, XLSX, PDF).
- KPI cards: Funded USD 24,000.00 (own funds plus approved contributions); Spent USD 19,840.00 (matched actuals at the locked plan rate); Unmatched USD 612.40 (2 lines); Open commitments USD 380.00 (1); Projected surplus USD 3,167.60; FX effect +USD 46.20 shown on its own card, labelled "Not part of spend".
- Blockers panel (error container per blocker, each with a count and a fix link):
  - "2 unmatched actuals tagged EVT-2026-0087" -> 080b filtered by the event code.
  - "Westlake contribution needs its intercompany recharge" (IDBCR-2026-0045, US01 -> IN01, recharge RCH-2026-0012 awaiting tax approval) -> 053a.
  - "1 commitment still open past its service end" (PO-2026-0244, USD 380.00 encumbered) -> Release or Cancel with fee (dialogs from 085a) inline.
- Actuals: matched 46 lines, unmatched 2, excluded 1; by transaction currency (INR 16,56,640.00 = USD 19,840.00 at the FY2026 locked plan rate); FX effect line.
- Commitments table: reference, description, vendor, service end, amount, consumed, encumbered left, fees, non-refundable deposit, status tag (Consumed, Partially consumed, Released, Cancelled), row actions for open ones.
- Contributions table: contributor budget and director, mode (Earmark, Transfer), approved, still held, cross-entity flag, recharge status, surplus share. Sample: Bengaluru Events own funds USD 15,000.00; Hyderabad Events USD 5,000.00 (IDBCR-2026-0042, earmark, same entity); Westlake Team Activities USD 4,000.00 (IDBCR-2026-0045, earmark, cross-entity, recharge awaiting tax approval).
- Surplus return preview: "Returned by share when the event closes (largest remainder)": Bengaluru Events USD 1,979.75 (62.5%), Hyderabad Events USD 659.92 (20.8%), Westlake Team Activities USD 527.93 (16.7%); total USD 3,167.60; marked "Projected" (hatched) while blockers remain.

Events list (entry): table of events Completed or Reconciling with event code, owning budget, unmatched actuals, open commitments, recharge status and a "Ready to close" or "Blocked" tag; filter by status and owning budget.

## Data and permissions

`GET /api/actuals/events/{eventId}/reconciliation` returns actuals, commitments, contributions, spent, surplus, blockers (`EVENT_HAS_UNMATCHED_ACTUALS`, `EVENT_MISSING_RECHARGE`, `EVENT_HAS_OPEN_COMMITMENTS`), `canClose` and `surplusReturns`. Read with `event:read`; resolving actions use their own permissions (`actuals:match`, commitment release, recharge tax approval). Contributors see each other's amounts (product answer 2026-11-05). All amounts are USD from the ledger; the browser never computes surplus.

## States

| State             | Behaviour                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Blocked (default) | blockers panel in error tone; Close event disabled with the written reason; surplus marked Projected                                  |
| Ready to close    | success banner "Everything is matched, settled and recharged"; blockers panel replaced by a checklist with three ticks; Close enabled |
| Not completed     | event still In progress: info banner "Reconciliation starts when the event is completed" and no Close action                          |
| Closed            | read-only; status Closed (neutral); surplus returns show their journal links; Close action hidden                                     |
| Loading           | `sat-ghost` in the KPI cards and tables                                                                                               |
| Error             | `sat-500-error-state` with Retry; partial failure (contributions unavailable) as an inline error banner                               |
| Forbidden         | `sat-403-error-state` for users without event read access                                                                             |
| Empty list        | "No events waiting for reconciliation" with a link to the event list (044)                                                            |

## Budget safety and audit

Matched actual, open encumbrance, held earmarks and projected surplus each keep their own swatch (design-system section 10); projected values are hatched until final. FX effect never counts as spend or surplus. Hard blocks (error container, action disabled with reason) for the close guard (`canCloseEvent`); nothing on this page posts money except the inline release/cancel actions, each audited.

## Responsive and accessibility

Tablet: KPI cards wrap to two rows; tables scroll horizontally with the first column pinned. Mobile: blockers first, then KPIs as a list, tables as cards. Blocker items are headings with links; the disabled Close button has its reason as visible text.

## Related screens and navigation

046 event details, 046a co-funding board, 051 commitments, 053a intercompany recharge schedule, 054 close event, 080b unmatched queue, 085a commitment hygiene, 088 audit log.

## Assumptions and open questions

- Surplus returns by funding share (largest remainder), including the owning budget's own funds; confirm owners do not want own funds consumed first.
- Who may close: the owning budget owner or Finance Controller (assumed); the organizer can resolve blockers but not close.
