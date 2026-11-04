# 027 Freeze budget

Status: proposed - awaiting user review. Light theme only. UX core set (todo `ux-core-screens`). Dialog over 021 budget details.

## Design
| State | Image | Stitch screen |
| --- | --- | --- |
| dialog open | `design/stitch/027-freeze-budget/dialog--desktop--light.png` | `23bb5e488964466aad7f6100c0e00bec` |

Set to zero (028) uses the dialog in [023](023-budget-hierarchy.md) (`set-to-zero-dialog`). Reduce (026) uses the same pattern with an amount field, the floor and a destination for the cut money.

## Purpose
Stop new requests and allocations against a budget for a period while existing commitments can still be paid, with a reason code and typed reason, and show who is affected before confirming.

## Roles
Primary: parent budget owners (Regional Manager, Department Head), Finance Controller. Not available to the budget's own owner for their own budget unless policy allows.

## Entry points
Budget details (021) menu; hierarchy (023) detail panel; rules engine (automatic freeze shows the same banner without the dialog).

## Content and actions
Title with owner and currency; info banner (lock) explaining what is blocked and what continues, with the committed amount; Freeze until (date or until unfrozen); apply to child budgets toggle; reason code; typed reason; impact list (pending requests put on hold); notify toggle; audit note; Cancel and Freeze budget.

## Data and permissions
Impact preview from the API (pending requests, children, commitments); `budget:freeze` on the node through `PolicyService.can`.

## States
Validation (reason code and reason required; date in the future); loading on confirm; error banner with API detail; success snackbar "Bengaluru Events frozen until 30 Nov 2026" and the page shows the frozen banner and lock tag.

## Budget safety and audit
Frozen uses the info tone with a lock icon (never the important tone used for set to zero). One audit entry with reason code, typed reason, until date and affected requests; notifications to owner and requesters.

## Responsive and accessibility
Mobile: full-screen dialog with sticky footer. Focus moves to the dialog title, returns to the menu on close; Esc cancels.

## Related screens and navigation
021 budget details, 023 hierarchy, 026 reduce, 028 set to zero, 075 freeze and zero-budget policy, 088 audit log.

## Open questions
- Do pending requests stay on hold until unfreeze, or get rejected after a timeout?
