# 059 Approval inbox

Status: proposed - awaiting user review. Light theme only. Start screen 7 (todo `ux-s07-approval-inbox`). Satori variant of the original Stitch screen `fd6e8e45e8ec4ef6ad99d499b6bbd284` (unchanged). The detail pane also covers 060 request details and 061 decision; 062 delegated and 063 escalated are tabs here.

Revised 2026-11-04 to the single-company decisions: Hyland only (static label, no tenant or organization switcher, no reporting-currency chip), budgets in USD (transactions may show INR or EUR with the USD amount), Export instead of Share.

## Design

| State                    | Image                                                          | Stitch screen                      |
| ------------------------ | -------------------------------------------------------------- | ---------------------------------- |
| default (assigned to me) | `design/stitch/059-approval-inbox/default--desktop--light.png` | `fb5ca09447544df782f6087edfad7cfd` |
| delegated and escalated  | `delegated-escalated--desktop--light.png`                      | `300efc538e3543b689bf90291f245abb` |
| empty                    | `empty--desktop--light.png`                                    | `bb51d8a8b32446cc94c76e063666e6c9` |

## Purpose

One place for approvers to see what is waiting, understand the budget impact and the rule that routed it, and decide (approve, partially approve, reject, request info) within their delegation-of-authority limit.

## Roles

- Primary: anyone in an approval chain (Location Manager, Regional Manager, Department Head, Budget Owner, Finance Controller, CEO).
- Secondary: delegates and substitutes; Auditor (read only via 090 approval history).

## Entry points

Sidebar Requests > Approval inbox (badge count); notification and email links; executive dashboard pending card.

## Content and actions

- Tabs: Assigned to me, Delegated to me, Escalated, Completed. Filter chips (type, budget, amount, SLA) and saved filters.
- List (dense, selectable, bulk actions for low-risk items): id, title, requester and budget, amount, SLA tag, status.
- Detail: amount in request and budget currency at plan rate; budget impact card (available before, after; over-budget warning); rule explanation (which rule, which facts); approval chain with DoA limit of each step; attachments; comment; actions Request info, Reject, Partially approve, Approve.
- Delegated: banner "acting as delegate for ... until ...", effective limit = lower of both DoA limits, "On behalf of" chip next to Approve, hygiene checks (not the requester, not a beneficiary or attendee, within limit). Escalated items show why (above limit, SLA breach) and who holds them now.

## Data

Request, budget impact preview from the API, matched rules with fact values, chain with approver, DoA limit and state, delegation records, SLA timers, attachments.

## Permissions

The API decides authority: Approve is enabled only when the viewer's DoA covers action, amount and legal entity; self-approval and beneficiary approval are blocked server-side and shown as failed hygiene checks.

## States

| State        | Treatment                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Loading      | `sat-ghost` list rows and detail                                                                                               |
| Empty        | "You are all caught up" with View completed and Set up a delegate (image)                                                      |
| Over budget  | Warning or error banner in the impact card depending on control mode; approval may need over-budget approval or a contribution |
| Blocked      | Above limit: Approve disabled with reason and the escalation target (image)                                                    |
| Error        | Decision failed: banner with API detail; item stays selected                                                                   |
| Success      | Snackbar "Approved REQ-2026-0142"; list moves to the next item; focus returns to the list                                      |
| Confirmation | Reject and partial approval require a reason; partial approval asks for the amount                                             |

## Budget safety

Pending (warning) vs approved (success) tags; impact shows available before and after; over-budget is never silently allowed.

## Audit

Each decision writes an audit entry with the approver, delegation used (both names), rule versions and facts, before and after status, and the reason.

## Responsive

Tablet: list and detail as two routes. Mobile: list of cards; detail full screen with sticky action bar.

## Accessibility

List is a listbox with keyboard selection; J/K to move, A to approve only after focus is in the detail; decisions require explicit confirmation for screen readers.

## Related screens

018 pending approvals dashboard, 060 request details, 061 approval decision, 062 delegated, 063 escalated, 090 approval history, 061a actionable approval email.

## Navigation

Breadcrumb Home / Requests / Approval inbox; selected item in the URL.

## Open questions

- Bulk approve: allow only under a configurable amount?
- Stitch render notes: the default render lists sample requests outside the employee-experience domain and states the Bengaluru allocation as USD 15,000; the seed value is USD 10,000.
