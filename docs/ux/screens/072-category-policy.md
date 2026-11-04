# 072 Category-policy configuration

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 7 batch A. Build phase P7. Rules and policies > Categories.

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Planned exports: `design/stitch/072-category-policy/default--desktop--light.png` (category list with the detail panel).

## Purpose

Say per spend category whether it is allowed, what evidence it needs, which limits and approvals apply, and how it maps to the general ledger, so requests and post-spend checks treat categories consistently.

## Roles

Finance Admin, Organization Admin (edit); Finance Controller and Auditor (read).

## Entry points

066 tabs; 106 categories (P3 master data) "Policy"; 106a GL mapping links.

## Content and actions

Two panes. Left: categories with status (Allowed, Allowed with approval, Not allowed) and counts of rules. Right, selected category (sample "Team meals"):

- Allowed: yes; who may request (all employees, organizers).
- Evidence: receipt required above USD 25.00; itemised receipt; attendee list for 5+ people.
- Limits used (links to 071): per person USD 9.58 in Bengaluru, USD 25.00 in Westlake.
- Approvals: threshold table family "Events and engagement" (071a).
- GL mapping (read-only from 106a): employee attendees -> 6420 Staff welfare; client attendees -> 6440 Client entertainment (handled by 072a).
- Post-spend re-check: on (074a).
- Rules generated: R-14 v2, R-22 v1.

Other samples: Gifts (Allowed with approval; 072a), Alcohol (Not allowed except with the 072a exception), Wellbeing (Allowed; auto-approve under USD 25.00), Cash and gift cards (Not allowed).

## Data and permissions

Category policy compiles to rules and to document requirements on requests; categories come from 106. `rule:edit`, `rule:publish`.

## States

| State       | Behaviour                                                       |
| ----------- | --------------------------------------------------------------- |
| Default     | as above                                                        |
| Not allowed | requests in this category are blocked with the explanation text |
| Validation  | evidence threshold above zero; at least one requester group     |
| Unsaved     | changes bar with Publish (opens the 069 publish dialog)         |

## Budget safety and audit

Not allowed categories produce hard blocks with the reason; evidence requirements are checked again post-spend. Changes are audited as rule versions.

## Responsive and accessibility

Tablet: list collapses to a select. Mobile: read-only.

## Related screens and navigation

066, 069, 071, 072a, 074a, 106, 106a.

## Assumptions and open questions

- None beyond the design review.
