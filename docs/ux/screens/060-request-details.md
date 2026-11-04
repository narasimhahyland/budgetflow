# 060 Request details

Status: proposed - awaiting user review. Light theme only. UX core set part 2 (todo `ux-core-screens`). Build phase P5. The 059 inbox detail pane shows the same content in a narrower layout.

## Design

| State                                 | Image                                                           | Stitch screen                      |
| ------------------------------------- | --------------------------------------------------------------- | ---------------------------------- |
| pending your approval (approver view) | `design/stitch/060-request-details/default--desktop--light.png` | `c48019a606044670979d258bdeb8f435` |

## Purpose

Everything an approver or requester needs about one request: what, how much, why, the route and who is next, the rules that applied, the activity, and the budget impact card.

## Roles

Requester (read, withdraw, respond to changes); current approver (decide); later approvers, budget owner and Finance Controller (read); Auditor (read).

## Entry points

059 inbox, 055 my requests, 061a email "see details", notifications, search.

## Content and actions

Header: title, status tag, ID, requester, submitted date, due. Actions for the current approver: Request changes, Reject, Approve (all open 061). Left: request details, attachments, approval route stepper with DoA chip, rules applied with "Why this route?", activity timeline. Right: budget impact card (authorized, approved commitments, pending incl. this, actual, available under this budget's rules before and after, bar, soft warning) and company-wide Available with the tooltip explaining the difference.

## Data and permissions

`request:read` for participants; decision buttons only when `PolicyService.can(request:decide)` and the user is the current step's approver with a covering DoA limit; never for the requester.

## States

| State                         | Behaviour                                                                |
| ----------------------------- | ------------------------------------------------------------------------ |
| Requester view (not exported) | no decision buttons; Withdraw while pending                              |
| Changes requested             | info banner with the approver's comment; requester can edit and resubmit |
| Approved / rejected           | final tag, decision card with reason code and comment                    |
| Escalated or delegated        | route shows the substitute or escalation step (062, 063 later)           |

## Budget safety and audit

Pending (warning) versus approved (success); company-wide Available and "Available under this budget's rules" are labelled distinctly. Every state change is in the activity timeline and the audit log.

## Responsive and accessibility

Mobile: budget impact card first (decision context), sticky decision bar at the bottom. Timeline is a list with times in the user's timezone.

## Related screens and navigation

055, 057, 059, 061, 061a, 088.

## Assumptions and open questions

- Stitch titled the right card "Budget Impact Analysis" in places; use "Budget impact".
