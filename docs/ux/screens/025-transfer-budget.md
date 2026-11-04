# 025 Transfer budget

Status: proposed - awaiting user review. Light theme only. UX Phase 4-7 track, batch 1. Build phase P4. Dialog over 021 budget details.

## Design

| State                        | Image                                                          | Stitch screen                      |
| ---------------------------- | -------------------------------------------------------------- | ---------------------------------- |
| dialog                       | `design/stitch/025-transfer-budget/dialog--desktop--light.png` | `cb857fe8c5294acda41110d4b9270de6` |
| blocked (destination frozen) | `blocked--desktop--light.png`                                  | `36c074e880654a17a6cb251f8a2f9222` |

## Purpose

Move authorized budget sideways between two budgets (usually siblings), with the impact and the approval route visible before submitting.

## Roles

Owner of the source budget requests; the common parent's owner approves within DoA. Finance Admin can transfer directly within DoA.

## Entry points

021 header "Transfer"; 023 detail panel; 019 row menu.

## Content and actions

Two-column dialog. Left: From card with "Available under this budget's rules" (tooltip), To select with each option's available, Amount (USD, helper with the maximum), Effective date, Reason code, Reason. Right "Impact preview": before/after for both budgets; checks (same parent and who approves; within DoA); ledger and audit note. Footer: Cancel, "Request transfer of USD 1,500.00".

## Data and permissions

`budget:transfer` on the source. Route: same parent, parent owner approves; different parents, both parent owners approve (and Finance above threshold). Amount capped by the source's available under its rules; checked again under lock at approval.

## States

| State             | Behaviour                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Validation        | amount, destination, reason code and reason required                                                                                                   |
| Over available    | field error "Up to USD 1,988.00"; submit disabled                                                                                                      |
| Blocked           | destination frozen, set to zero or closed: error banner, error outline, dashes in After, submit disabled with "Choose another destination to continue" |
| Pending / success | snackbar "Transfer sent to Arjun Mehta"; both budgets show the pending transfer                                                                        |

## Budget safety and audit

Frozen destinations cannot receive money; a frozen source cannot send. On approval one balanced transfer journal (source authorized down, destination up) and one audit entry with reason code and text.

## Responsive and accessibility

Mobile: full-screen dialog, impact preview below the form, sticky footer. Impact table has a text summary for screen readers.

## Related screens and navigation

021, 023, 026, 027, 059 (approver), 089 allocation history.

## Assumptions and open questions

- Decided 2026-11-05: sibling transfers need the parent owner's approval unless the requester owns both budgets.
- Stitch shortened names in the impact table ("BLR Events"); use full names.
