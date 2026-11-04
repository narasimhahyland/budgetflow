# 027 Freeze budget

Status: proposed - awaiting user review. Light theme only. UX core set (todo `ux-core-screens`). Dialog over 021 budget details.

Revised 2026-11-04 to the single-company decisions: Hyland only (static label, no tenant or organization switcher, no reporting-currency chip), budgets in USD (transactions may show INR or EUR with the USD amount), Export instead of Share. Two-column dialog so the footer stays visible.

## Design

| State       | Image                                                        | Stitch screen                      |
| ----------- | ------------------------------------------------------------ | ---------------------------------- |
| dialog open | `design/stitch/027-freeze-budget/dialog--desktop--light.png` | `203cdea287f94b5abf909f6fbae67699` |

Set to zero has its own design in [028](028-set-to-zero.md) (023 shows the same dialog in its `set-to-zero-dialog` state). Reduce is [026](026-reduce-budget.md): an amount field, the floor and a destination for the cut money.

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
