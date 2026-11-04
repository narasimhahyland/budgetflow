# 072a Gifts, entertainment and alcohol policy

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 7 batch B. Build phase P7. Rules and policies > Gifts and entertainment.

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Planned exports: `design/stitch/072a-gifts-entertainment-alcohol/default--desktop--light.png`, `validation--desktop--light.png`.

## Purpose

Set the rules for gifts, client entertainment and alcohol in one place: caps per person, no cash or cash equivalents, client attendees charged to the entertainment GL, and when alcohol is allowed, so requests are checked before spend and actuals again after.

## Roles

Finance Admin (edit), Finance Controller and Auditor (read).

## Entry points

066 tabs; 071a template "Gifts and entertainment cap" and "Alcohol at events"; 074a exceptions linking to the rule that raised them.

## Content and actions

Three sections on one page, each with an on/off switch, parameters and the generated rule ids:

- Gifts: cap per recipient per gift USD 75.00 (by location override table: London GBP 50.00 = USD 63.50 at the plan rate); annual cap per recipient USD 150.00; cash, gift cards and vouchers not allowed (hard block); outcome above the cap: require Finance Controller approval; recipient type (employee, client) required.
- Client entertainment: cap per attendee USD 120.00; client attendees are listed by name and company on the request; their share posts to GL 6440 Client entertainment, employees' share to 6420 Staff welfare (from 106a); outcome above the cap: require Finance Controller.
- Alcohol: not allowed by default; allowed at approved events with a cap of USD 20.00 per attendee when the event has "Alcohol approved" set by the parent owner; never on per-employee allowances; post-spend re-check matches merchant category and receipt lines (074a).

Footer: Simulate (077), Publish (69 publish dialog). Explanation preview shows what a requester sees ("Gifts are capped at USD 75.00 per recipient; gift cards are not allowed").

## Data and permissions

Parameters compile to rules R-24 (gifts), R-25 (entertainment), R-26 (alcohol); attendee type is a fact on requests and actuals; GL split uses 106a mappings. `rule:edit`, `rule:publish`.

## States

| State       | Behaviour                                                                                     |
| ----------- | --------------------------------------------------------------------------------------------- |
| Default     | as above                                                                                      |
| Validation  | caps above zero; annual cap at least the per-gift cap; location override must name a currency |
| Section off | parameters greyed with "Not enforced"; warning that post-spend re-check also stops            |
| Unsaved     | changes bar                                                                                   |

## Budget safety and audit

Cash equivalents are hard blocks (error container); caps above which approval is needed are approvals, not blocks. Each publish is an audited rule version; decisions record caps and attendee facts.

## Responsive and accessibility

Tablet fine; mobile read-only. Switches have visible labels and state text.

## Related screens and navigation

066, 069, 071, 072, 074a, 106a, 077.

## Assumptions and open questions

- Benefit-in-kind thresholds for UK and Germany are Phase 11 (employee benefit ledger); this page only links to them later.
