# Clickable design preview: verification on the published site

- Site: https://narasimhahyland.github.io/budgetflow/ (Pages branch commit `a98d519`, built from `bd381c5`)
- Checked: 2026-11-04 17:52 UTC, Playwright (Chromium) at 1440 x 900, browser cache cleared and disabled
- Result: pass. 31/31 pages HTTP 200 with the navigation bar, 0 HTTP errors, 0 page errors, 0 broken thumbnails, guided flow 17/17 steps, 15/15 click checks

## Guided flow (Start the guided flow, then Next on every step)

000a Application shell, 011 Executive dashboard, 023 Budget hierarchy, 023 Set to zero dialog, 022 Allocation workspace, 022 Warning and block, 045 Create event budget, 045 Validation, 059 Approval inbox, 069 Rule builder, 088 Audit log, 115 Employee dashboard, 020 Create budget, 021 Budget details, 027 Freeze dialog, 024a Per-head allocation, 003 MFA verification.

## Click checks

| Check | Page type | Expected page | Result |
| --- | --- | --- | --- |
| Sidebar "Budget hierarchy" on the shell | image + hotspots | 023 default | pass |
| Notification bell on the shell | image + hotspots | 000a notifications open | pass |
| "Review" in the notifications panel | image + hotspots | 059 default | pass |
| "Open approval inbox" on the executive dashboard | HTML | 059 default | pass |
| "Approve" in the approval inbox | HTML | 059 empty | pass |
| Sidebar "Approval inbox" on the budget hierarchy | HTML | 059 default | pass |
| "Allocate budget" on the budget hierarchy | HTML | 022 default | pass |
| "Add Row" in the allocation workspace | image + hotspots | 022 warning and block | pass |
| "Bengaluru Events" table row | HTML | 021 default | pass |
| "Create event" on budget details | HTML | 045 default | pass |
| "Continue to funding" on create event budget | image + hotspots | 045 validation | pass |
| "Set to zero" in the hierarchy inspector | HTML | 023 set to zero dialog | pass |
| "Cancel" in the set to zero dialog | HTML | 023 default | pass |
| State switcher "Set to zero dialog" | navigation bar | 023 set to zero dialog | pass |
| Sidebar "Reports" (not designed yet) | HTML | index with notice "Reports is not designed yet" | pass |

The first run on the published site (floating bar over the page) failed "Approve" and the dialog "Cancel" because the bar covered them; the bar now sits below the design frame and both pass.

## Screenshots

- `01-index.png`: index with areas, thumbnails, states and "Start the guided flow"
- `02-shell-notifications-hotspots.png`: shell with the notifications state open and its links highlighted (L)
- `03-set-to-zero-dialog.png`: set to zero dialog (Stitch HTML) with the navigation bar at step 4 of 17
- `04-not-designed-yet-toast.png`: index after clicking a link with no design yet
