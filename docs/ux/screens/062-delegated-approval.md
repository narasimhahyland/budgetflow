# 062 Delegated approval

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 7 batch A. Build phase P7. Extends 059 (tab "Delegated to me") and adds delegation management (user menu "Delegations").

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Planned exports: `design/stitch/062-delegated-approval/default--desktop--light.png` (deciding as delegate), `above-limit--desktop--light.png`, `delegations--desktop--light.png` (my delegations), `new-delegation--desktop--light.png` (dialog).

## Purpose

Let a delegate decide approvals on someone else's behalf within a time-boxed, audited delegation whose limit never exceeds either person's authority, and let approvers set up, see and end their delegations.

## Roles

Delegates (any approver), delegators (approvers with a DoA limit). Finance Admin sees all delegations; Auditor reads.

## Entry points

059 "Delegated to me" tab; notifications "Meera Iyer delegated her approvals to you"; user menu "Delegations"; 059 empty state "Set up a delegate".

## Content and actions

Deciding as delegate (sample: Anand Kumar acting for Meera Iyer, 10-15 Nov 2026):

- Banner (info): "Acting for Meera Iyer until 15 Nov 2026, 18:00. Your limit as delegate: USD 2,500.00 (the lower of her USD 10,000.00 and your USD 2,500.00)."
- Request card as in 059/060: REQ-2026-0461 "Hyderabad townhall catering", Lakshmi Rao, Hyderabad Events, INR 1,50,300.00 = USD 1,800.00; budget impact; rule explanation; chain with the step "India Region owner: Meera Iyer (delegated to Anand Kumar)".
- Hygiene checks list: not the requester, not a beneficiary or attendee, within the delegated limit, delegation active.
- Actions: Request changes, Reject, "Approve on behalf of Meera Iyer" (the button names the delegator).

My delegations (page): tabs Given, Received. Table: delegate or delegator, scope (all approvals or selected budgets and spend types), limit cap, from, until, status (Active success, Scheduled info, Ended neutral, Revoked important), actions End now, Edit dates. "New delegation" dialog: delegate (people picker, own DoA limit shown), scope, optional cap (cannot exceed own limit), from and until (required, maximum 30 days), reason, note "Requests above the delegate's limit go to the next authority, not to you."

## Data and permissions

Delegations from the approvals API (list given and received; create with dates, scope and cap); effective limit = min(delegator limit, delegate limit, cap) computed server-side (`delegatedLimit`). A delegate can never approve their own request or one they benefit from. Ending a delegation returns open items to the delegator.

## States

| State               | Behaviour                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default             | as above                                                                                                                                                                  |
| Above limit         | request USD 3,200.00: error container "Above your delegated limit of USD 2,500.00"; Approve disabled; "Goes to Daniel Brooks (next authority)"                            |
| Hygiene failed      | the delegate is an attendee: error item in the checks list; Approve disabled with the reason                                                                              |
| Delegation ended    | banner "This delegation ended at 18:00; the item returned to Meera Iyer"; actions hidden                                                                                  |
| Validation (dialog) | dates required, until after from, at most 30 days; cap above own limit rejected; cannot delegate to yourself or to someone who reports approvals to you in the same chain |
| Empty               | Given: "You have not delegated your approvals"; Received: "Nobody has delegated approvals to you"                                                                         |
| Success             | snackbars "Approved on behalf of Meera Iyer" and "Delegation to Anand Kumar starts 10 Nov 2026"                                                                           |

## Budget safety and audit

Each decision records both people ("Anand Kumar on behalf of Meera Iyer"), the delegation id and the effective limit. Creating, editing and ending a delegation are audited; delegators are notified of every decision made for them.

## Responsive and accessibility

Mobile: banner stays pinned above the actions; the approve button keeps the delegator's name. Dialog fields have visible labels and date-range errors read as text.

## Related screens and navigation

059 approval inbox, 060 request details, 061 approval decision, 063 escalated approval, 070a DoA matrix admin, 076 notification and escalation policy, 090 approval history.

## Assumptions and open questions

- Maximum delegation length 30 days (assumed); longer absences need a DoA change in 070a.
- Can a delegate re-delegate? Assumed no.
