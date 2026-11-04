# 116 Available budgets (My budgets)

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 5 employee batch. Build phase P5. Employee shell, sidebar "My budgets".

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Build from this spec with the 115 employee dashboard cards. Planned exports: `design/stitch/116-available-budgets/default--desktop--light.png`, `paused--desktop--light.png` (a frozen budget), `empty--desktop--light.png`.

## Purpose

Show an employee every budget they may request from, what they can still request under their own limit and period, who approves, and which budgets are paused, without exposing the parent budget's totals.

## Roles

Employee (primary); Event Organizer and every other role in "my view" (everyone is also an employee).

## Entry points

Employee sidebar "My budgets"; 115 "View all allowances"; notifications ("Your learning stipend resets on 1 Jan").

## Content and actions

Sample: Kavya Shah, Employee, Bengaluru. Amounts in USD; INR shown at the FY2026 locked plan rate (USD 1 = INR 83.50).

- Header: "My budgets", subtitle "What you can request this year", actions "Request funds" (filled) and "Upload receipt" (outlined).
- Filter chips: All (4), Can request (3), Paused (1).
- One card per budget (grid of three on desktop):
  - Team lunch (Bengaluru Events): "USD 143.71 left of USD 239.52 this quarter" (INR 12,000.00 left), progress bar, per-person limit "USD 9.58 per person per meal", approver "Anand Kumar approves", "1 request pending" link, Request button.
  - Wellbeing allowance (Employee Experience): "USD 77.84 left of USD 119.76 this year", "Approved automatically up to USD 25.00", Request button.
  - Learning stipend (India Region): "USD 300.00 left of USD 300.00 this year", "Meera Iyer approves", Request button.
  - Team offsite fund (Bengaluru Events): info tone with lock icon, "Requests paused: budget frozen on 28 Oct 2026 (Q4 reforecast)", "Existing approved requests still complete", Request button disabled with the reason written below it.
- Info line: "Your limits come from company policy. Ask your manager if a limit looks wrong."

## Data and permissions

`GET /api/requests/requestable-budgets` (requestable budgets with `blockedReason`, `requestedThisYear`, `pendingCount`, `approverHint`; `available` only when the viewer may read the budget) plus per-person limits from rules. Employees never see the budget's authorized or available totals, only their own remaining limit.

## States

| State           | Behaviour                                                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Default         | cards as above                                                                                                                                |
| Paused          | frozen budget card (info, lock) or set-to-zero card (important tone, "Requests closed: budget set to zero"); Request disabled with the reason |
| Limit used up   | card shows "Nothing left this quarter; resets on 1 Jan 2027"; Request disabled with the reason                                                |
| Empty           | "You have no budgets to request from yet" with "Ask your manager" help text                                                                   |
| Loading / error | skeleton cards; error banner with Retry                                                                                                       |

## Budget safety and audit

Frozen (info, lock icon) versus set to zero (important tone) versus limit used up (neutral) are visually distinct; pending requests show as a count with a warning tag, never subtracted silently. Read-only page; no audit entries.

## Responsive and accessibility

Tablet two cards per row; mobile one per row with Request as a full-width button. Progress bars have text equivalents ("USD 143.71 left of USD 239.52").

## Related screens and navigation

115 employee dashboard, 117 submit spending request, 118 request event funding, 119 request status, 120 approved allocations.

## Assumptions and open questions

- Show the approver's name to employees (assumed yes) or only the role?
