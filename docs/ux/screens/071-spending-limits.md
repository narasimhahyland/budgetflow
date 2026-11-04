# 071 Spending-limit configuration

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 7 batch A. Build phase P7. Rules and policies > Limits.

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Planned exports: `design/stitch/071-spending-limits/default--desktop--light.png`, `per-employee-cap--desktop--light.png`.

## Purpose

Set the money limits that requests are checked against: per request, per person per event, per event, per category, and the per-employee annual cap, by location where they differ, with the outcome when a limit is passed.

## Roles

Finance Admin (edit), Organization Admin (edit), Finance Controller and Auditor (read).

## Entry points

066 tabs; 069 when a rule uses a limit fact; 117 and 118 rule lines ("Team meals: up to USD 9.58 per person").

## Content and actions

Tabs: Request and event limits, Per-employee annual cap.

Request and event limits table: limit name, applies to (category or request kind), measure (per request, per person per event, per event, per period), location (all or a city), amount (USD; local currency shown for reference at the plan rate), outcome when passed (Block, Require approval, Warn), effective dates, status. Samples: Team meals per person, Bengaluru, USD 9.58 (INR 800.00), Warn; Team events per person, all locations, USD 40.00, Require parent owner approval; Single event total, all, USD 50,000.00, Block ("Larger events need a budget revision"); Offsite per person, Europe, USD 150.00 (EUR 138.89), Require approval.

Per-employee annual cap tab: cap per employee per fiscal year across engagement categories (USD 300.00), included categories (team events, meals, wellbeing; learning has its own stipend), outcome when passed (Warn at 80%, Block at 100%), exceptions (approved by Finance Admin); table of employees nearest the cap (name, location, used, left) for monitoring, with names visible to finance only.

Add or edit limit: drawer with the same fields; "Preview impact" counts requests from the last 90 days that would have been warned or blocked.

## Data and permissions

Limits are rule parameters (facts: amount per person using planned attendance, period totals per employee); changes create new rule versions through the same publish flow as 069. `rule:edit`, `rule:publish`.

## States

| State          | Behaviour                                                                    |
| -------------- | ---------------------------------------------------------------------------- |
| Default        | as above                                                                     |
| Validation     | amount above zero; overlapping limit for the same scope shows which one wins |
| Impact preview | "Would have warned 14 and blocked 2 of 611 requests in the last 90 days"     |
| Empty          | "No limits yet" with "Add limit"                                             |
| Read only      | Finance Controller and Auditor                                               |

## Budget safety and audit

Warn (warning container) versus block (error container) versus approval (primary) shown on each row. Limit changes are audited as rule versions; decisions record the limit value used.

## Responsive and accessibility

Tablet: drawer overlays. Mobile: read-only list. Amounts keep ISO codes; local equivalents are labelled "for reference".

## Related screens and navigation

066, 069, 072, 072a, 073, 117, 118.

## Assumptions and open questions

- Per-employee annual cap USD 300.00 is a fictional placeholder; confirm which categories count toward it.
