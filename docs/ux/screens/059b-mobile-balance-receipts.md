# 059b Mobile balance check and camera receipts

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 8 batch. Build phase P8. Review-added screen (catalog section H: installable mobile web app "balance, camera receipts"). Installable mobile web app, tabs "Balance" (`/m/balance`) and "Receipt" (`/m/receipt`), feature lib `libs/web/features/mobile`.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a mobile variant), the frame of 59a and the upload rules of 121. Planned Stitch states, to be generated in a later session:

| State                         | Planned image                                                           |
| ----------------------------- | ----------------------------------------------------------------------- |
| my budgets (owner)            | `design/stitch/059b-mobile-balance-receipts/balance--mobile--light.png` |
| budget detail sheet           | `budget-sheet--mobile--light.png`                                       |
| budgets I can use (employee)  | `employee-balance--mobile--light.png`                                   |
| receipt camera capture        | `receipt-capture--mobile--light.png`                                    |
| receipt review before upload  | `receipt-review--mobile--light.png`                                     |
| receipt saved offline, queued | `queued-offline--mobile--light.png`                                     |

## Purpose

Answer "how much do I have left?" in two taps from a phone, and let organizers and employees photograph a receipt at the till and attach it to the approved request, so evidence arrives the same day instead of at month end.

## Roles

Budget owners (Location Manager, Regional Manager, Department Head, Budget Owner) see budgets they own or co-own; event organizers and employees see the budgets they can request from (as 116) and their own approved requests; everyone can upload receipts for requests they made or events they organize.

## Entry points

Bottom tabs Balance and Receipt (59a frame); push "Upload your receipt for REQ-2026-0145" (59c); task on 123 mobile; Slack or Teams balance reply "Open in app" (61d).

## Content and actions

Balance, owner view (sample Anand Kumar, Location Manager Bengaluru):

- Header line "Amounts in USD. As of 10:42 IST."
- Budget cards: name, status tag, "Available under this budget's rules" as the large figure, a stacked bar (actual, committed, pending hatched, available) and one line of figures.
  - Bengaluru Events, Active: available USD 7,450.00 of USD 10,000.00; committed USD 2,140.00; actual USD 410.00; pending USD 0.00; utilization 25.5%.
  - Bengaluru Diwali celebration (event EVT-2026-0112), Funded: available USD 1,200.00 of the USD 9,000.00 cap.
  - Bengaluru Wellbeing, Frozen (info tone, lock icon): "New requests paused since 2 Nov. Existing commitments continue."
- Tap a card: bottom sheet with the full breakdown (authorized, allocated to children, pending, committed, actual, available), the 80% alert threshold marker, last five movements (date, description, amount, bucket) and actions "Request funds" (opens 117 in the mobile layout) and "Open full details" (021).

Balance, employee view (sample Kavya Shah, Bengaluru): "Budgets you can use": Wellbeing allowance "USD 77.84 left of USD 119.76 this year"; Team lunch Q4 (approved request REQ-2026-0145, USD 57.49, "Receipt needed").

Receipt:

- Capture screen: large "Take photo" button (rear camera), "Choose a file" link, hint "PDF, PNG or JPEG up to 10 MB. Photos are compressed on your phone."
- Review screen: photo preview with Rotate and "Add another page" (up to 5 pages, kept as one document); "For" select prefilled with approved requests that still need a receipt (REQ-2026-0145 Team lunch Q4, approved USD 57.49); amount and currency (INR 4,560.00, shown as USD 54.61 at the FY2026 plan rate); receipt date; merchant; comparison line "USD 2.88 less than approved. The rest returns to the budget when finance matches the receipt." Footer: Cancel, "Upload receipt".
- Queue list (only when something is waiting): receipts saved on the phone with status (Waiting for connection, Uploading 60%, Failed with Retry).

## Data and permissions

Balances come from the budget read API (`getBudget` with the balance summary, P4) scoped by `PolicyService.can(budget.read)`; the employee view uses the 116 available-budgets API (P5). Figures are never computed in the browser. Receipts use the documents flow of 121 (declare, upload to the signed URL, server-side verify of size and file signature) through `DocumentStore`; uploaders must own the request or organize the event. Offline receipts are kept in the browser's storage on this device only (no BudgetFlow server copy until upload) and deleted after a successful upload, on sign-out, or after 7 days.

## States

| State                 | Behaviour                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Balance default       | as above                                                                                                                    |
| Budget sheet          | as above; sheet expands to full height on drag                                                                              |
| Frozen / set to zero  | frozen: info tone with lock icon, Request funds disabled with "New requests are paused"; zero: important tone, same rule    |
| Employee view         | as above; no owner breakdown                                                                                                |
| Balance empty         | `sat-empty-state` "No budgets to show" with "Ask your manager about team budgets"                                           |
| Capture               | camera opens; denied camera permission shows "Allow camera access in your browser settings, or choose a file"               |
| Review                | as above; Upload disabled until "For" and amount are set                                                                    |
| Above approved        | soft warning "Receipt is USD 6.20 more than approved. Your approver will be asked to accept the difference."                |
| Uploading / verifying | progress bar, then "Checking the file"                                                                                      |
| Queued offline        | info banner "Saved on this phone. It uploads when you're back online." Queue list visible                                   |
| Failed                | error container "This file is not a valid image" or "File is larger than 10 MB after compression"; Retake or choose another |
| Success               | snackbar "Receipt added to REQ-2026-0145"; the receipt task disappears from 123                                             |
| Loading / error       | `sat-ghost` cards; error card with Retry                                                                                    |

## Budget safety and audit

Company-wide Available is not shown here: phones show "Available under this budget's rules", the figure that governs the owner's own requests, with the label written out. Pending (hatched warning) and committed or actual (solid) keep their swatches. Receipts never post money: finance matching (080b) turns them into actuals. One audit entry per verified upload, recorded with channel "mobile"; queued uploads are audited when they reach the server, not when captured.

## Responsive and accessibility

Phone only (412 px design); tablets and desktops use 021, 116 and 121. Large figures use tabular numerals; the stacked bar has a text equivalent ("Actual USD 410.00, committed USD 2,140.00, available USD 7,450.00"). The camera button has a visible text label; the review form announces the comparison line when the amount changes.

## Satori components

`sat-interactive-card` (budget cards), `sat-status-tag` (Active, Frozen, Set to zero, Receipt needed), `sat-banner` (frozen, offline, soft warning), `sat-upload-field` (file choice fallback), `satImportantButton` (Upload receipt), `sat-empty-state`, `sat-ghost`; Angular Material bottom sheet, form fields, select, datepicker, progress bar, snackbar; stacked bar from `libs/web/ui/charts` with Satori dataviz tokens; `bf-money` for amounts; `bf-mobile-tab-bar` from 59a.

## Related screens and navigation

59a mobile approvals (frame), 021 budget details, 116 available budgets, 117 submit spending request, 119 request status, 121 upload receipt (desktop), 121a receipt extraction (P13), 080b unmatched actuals, 61d chat balance check.

## Decisions taken

- Phones show the per-budget "Available under this budget's rules" only; the company-wide figure stays on dashboards (011). Recommended because owners act on their own budget's rules from a phone.
- Receipts may be captured offline and queued (they move no money); approvals may not (59a).
- Multi-page receipts are kept as one document with up to 5 images rather than converted to PDF on the phone.
- Photos are compressed on the device to stay under the 10 MB limit of 121, so most phone photos upload without an error.
- Queued receipts expire from the phone after 7 days so evidence does not linger on lost devices.
