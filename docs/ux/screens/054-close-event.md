# 054 Close event

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 6 batch. Build phase P6. Dialog over 053 event reconciliation.

## Design

Not generated yet: the Stitch daily screen-generation limit was reached on 2026-11-05 (see the review log). Build from this spec with the financial confirmation dialog pattern (000, 026, 028). Planned exports:

| State               | Planned image                                              |
| ------------------- | ---------------------------------------------------------- |
| confirmation dialog | `design/stitch/054-close-event/dialog--desktop--light.png` |
| closed (success)    | `closed--desktop--light.png`                               |

## Purpose

Close a fully reconciled event: confirm the final cost, return the surplus to each contributor by share, settle earmarks, and make the event read-only, with one audited action.

## Roles

Owning budget owner (Location Manager) or Finance Controller. Organizer and contributors are notified.

## Entry points

053 "Close event" (enabled only when nothing blocks).

## Content and actions

Sample (after the 053 blockers are resolved): Offsite 2026, EVT-2026-0087; funded USD 24,000.00; final spent USD 20,452.40; surplus USD 3,547.60.

Two-column dialog (fits 1280 x 1024 without inner scrolling):

- Left, final position: funded, spent (matched actuals), released commitments, fees consumed, FX effect (separate, "not part of spend"), surplus. A checklist with three ticks: all actuals matched, no open commitments, every cross-entity contribution recharged.
- Left, surplus returns table (by funding share, largest remainder): Bengaluru Events (own funds) USD 2,217.25; Hyderabad Events USD 739.08 (IDBCR-2026-0042, earmark released); Westlake Team Activities USD 591.27 (IDBCR-2026-0045, earmark released, recharge RCH-2026-0012 approved); total USD 3,547.60.
- Right: what happens ("Event becomes read-only", "Surplus returns to each budget's available", "Late actuals for EVT-2026-0087 go to the unmatched queue and post to the owning budget"), required reason (typed, 5+ characters), confirmation checkbox "I confirm the final cost of USD 20,452.40", notify contributors checkbox (on).
- Footer: Cancel, "Close event and return USD 3,547.60".

## Data and permissions

`POST /api/actuals/events/{eventId}/close` with a reason and an idempotency key; the server re-checks `canCloseEvent` under lock and returns the reconciliation with surplus return journal ids. `event:close` on the owning budget (owner or Finance Controller). Surplus by share uses `surplusReturns` (largest remainder in minor units).

## States

| State             | Behaviour                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| Confirmation      | as above; primary disabled until reason and confirmation are given                                                    |
| Validation        | reason required; confirmation required                                                                                |
| Blocked on submit | something changed since the page loaded (a new unmatched actual): error banner listing the blocker; dialog stays open |
| Submitting        | primary shows progress; dialog cannot be dismissed twice (idempotent)                                                 |
| Closed (success)  | snackbar "Offsite 2026 closed. USD 3,547.60 returned to 3 budgets"; 053 shows Closed with journal links per return    |
| Error             | error banner with Retry; nothing posted                                                                               |

## Budget safety and audit

One settlement journal per contributor (earmark released or transfer returned for the surplus share) and the event moves to Closed (`eventMachine` reconciling -> closed). One audit entry with the reason, the final cost and every return; contributors and the organizer are notified. Closing never edits earlier postings; corrections after close are reversals in an open period.

## Responsive and accessibility

Mobile: full-screen dialog, single column, sticky footer with the primary action. Returns table has a caption; the primary button names the amount.

## Related screens and navigation

053 event reconciliation, 046 event details (read-only after close), 046a co-funding board, 089 allocation history (journals), 088 audit log.

## Assumptions and open questions

- Late actuals after close: post to the owning budget through the unmatched queue (assumed) rather than reopening the event.
