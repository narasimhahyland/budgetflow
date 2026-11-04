# 061 Approval decision

Status: proposed - awaiting user review. Light theme only. UX core set part 2 (todo `ux-core-screens`). Build phase P5. Dialog over 060 request details.

## Design

| State                           | Image                                                                  | Stitch screen                      |
| ------------------------------- | ---------------------------------------------------------------------- | ---------------------------------- |
| approve part (within DoA)       | `design/stitch/061-approval-decision/approve-part--desktop--light.png` | `6ad82b20f691476b90d0b66fd3ea9114` |
| outside delegation of authority | `outside-doa--desktop--light.png`                                      | `7ebc14825373495c904e4617a2bcce54` |

## Purpose

Record a decision (approve, approve part, reject, request changes) with the checks an approver must see first: DoA cover, no conflict of interest, budget impact and rules.

## Roles

The current step's approver (CEO, Finance Admin, Finance Controller, owners) within DoA; delegates within the delegator's limit.

## Entry points

060 decision buttons; 059 inbox quick actions open the same dialog.

## Content and actions

Left: segmented decision (Approve, Approve part, Reject, Request changes); approved amount (USD, for approve part); reason code (required except plain approve); comment to requester; "I have no conflict of interest" checkbox (required). Right "Check before you decide": DoA line, not requester or budget owner line, budget available before and after, rules line, audit note. Footer: Cancel and the primary action labelled with the amount.

## Data and permissions

`request:decide`; server re-checks DoA, self-approval and budget availability under lock at submit; idempotency key per decision.

## States

| State                          | Behaviour                                                                                                            |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Outside DoA                    | error line and banner; approve hidden; "Approve part" (up to the limit) and "Escalate to Finance Controller" offered |
| Reject (not exported)          | reason code and comment required; important-tone primary                                                             |
| Request changes (not exported) | comment required; request returns to requester                                                                       |
| Budget changed since opening   | warning banner with refreshed numbers; confirm again                                                                 |
| Success                        | snackbar, inbox moves to the next item                                                                               |

## Budget safety and audit

Approval moves the amount from pending to approved commitment; partial approval releases the difference. One audit entry with decision, amount, reason code, comment, DoA limit used and conflict-of-interest attestation.

## Responsive and accessibility

Mobile: full-screen dialog, checks above the form. Segmented control is a radio group; the checklist uses icons plus text (never colour alone).

## Related screens and navigation

059, 060, 061a, 062 delegated, 063 escalated, 088.

## Assumptions and open questions

- Can an approver approve part and also escalate the rest? Designed as approve part only.
