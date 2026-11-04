# 046 Event details

Status: proposed - awaiting user review. Light theme only. UX core set part 2 (todo `ux-core-screens`). Build phase P5.

## Design

| State                          | Image                                                         | Stitch screen                      |
| ------------------------------ | ------------------------------------------------------------- | ---------------------------------- |
| overview (funding in progress) | `design/stitch/046-event-details/default--desktop--light.png` | `2d10af9311554a02a97a191fc6818830` |

## Purpose

One place for a cross-location event's money: funding cap, who funds it, what is committed and spent, how cost splits by location and legal entity, and where it is in its lifecycle.

## Roles

Event Organizer (owner), Location and Regional Managers of contributing budgets, Finance Controller; employees see a reduced view of events they attend (115).

## Entry points

Events list (044), 045 create event (after submit), co-funding board (046a), approval inbox, search.

## Content and actions

Header with status tag, date, venue, organizer; actions Request contribution (056a), Request additional funds (057), Edit event, overflow (close event, clone). KPI cards: funding cap, funded (progress), approved commitments, pending requests, actual, "Available under this event's rules" (tooltip). Tabs: Overview, Participants (047), Budget and funding, Commitments, Documents, Activity. Overview: funding sources table (home budget plus each Inter-Director Budget Contribution Request with status), cost split by location and legal entity, lifecycle stepper (Draft, Submitted, Approved, Funding, Committed, In progress, Reconciled, Closed), intercompany info banner, key details.

## Data and permissions

`event:read` for organizer, contributors and finance; actions gated by `PolicyService.can` per action. Amounts in USD; per-head estimate = cap / participants.

## States

| State              | Behaviour                                                                      |
| ------------------ | ------------------------------------------------------------------------------ |
| Loading            | `sat-ghost` KPI cards and table rows                                           |
| Funding gap        | funded below cap: warning tone on "Funded" and a "Request contribution" prompt |
| Over cap (blocked) | new commitments blocked; error banner explains                                 |
| Closed             | read-only, surplus returned to sources shown in Budget and funding             |
| Forbidden          | `sat-403-error-state`                                                          |

## Budget safety and audit

Funding sources distinguish approved (success) and pending (warning); committed and actual use the ledger bucket swatches. Every edit, contribution and commitment is audited (Activity tab).

## Responsive and accessibility

Tablet: KPI cards wrap 3 by 2, right column moves below. Mobile: KPI carousel, tabs become a select. Stepper is an ordered list with the current step announced.

## Related screens and navigation

044, 045, 046a, 047, 051 commitments, 052 documents, 053 reconciliation, 056a, 057, 088.

## Assumptions and open questions

- Does the funding cap equal the sum of approved sources, or is it set first and then funded? Designed as cap first, funding towards it.
