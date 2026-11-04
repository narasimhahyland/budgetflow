# 120 View approved allocations

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 5 employee batch. Build phase P5. Employee shell, reached from My budgets and My requests.

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Planned exports: `design/stitch/120-approved-allocations/default--desktop--light.png`, `empty--desktop--light.png`.

## Purpose

Show the employee what has been approved for them, how much of it they have used (receipts matched), what is still open to spend or claim, and by when.

## Roles

Employee; any role for their own approvals.

## Entry points

116 "Approved for you"; 119 approved request "See all approvals"; 115.

## Content and actions

Sample: Kavya Shah, FY2026.

- Header: "Approved for you", year filter (FY2026), Export (CSV, PDF).
- Summary strip: approved this year USD 412.40; used USD 288.40 (receipts matched); open USD 124.00; receipts due 2.
- Table: request, budget, approved on, approved amount (USD; transaction currency below), used, open, receipt status tag (Receipt due warning, Matched success, Not needed neutral), use by date, action (Upload receipt, View).
  - REQ-2026-0118 Yoga class, Wellbeing allowance, USD 17.96 (INR 1,500.00), used USD 17.96, Matched.
  - REQ-2026-0131 Online course, Learning stipend, USD 120.00, used USD 0.00, open USD 120.00, Receipt due by 30 Nov.
  - REQ-2026-0139 Team dinner (organizer), Team lunch, USD 274.44 (INR 22,915.74), used USD 270.44, open USD 4.00, "USD 4.00 returns to the budget when the receipt is matched".
- Info line: "Unused approved money returns to the budget after the use-by date."

## Data and permissions

Approved and partially approved requests of the viewer with matched actuals and documents (requests and actuals APIs, scoped to the requester). Read-only except Upload receipt.

## States

| State           | Behaviour                                                               |
| --------------- | ----------------------------------------------------------------------- |
| Default         | as above                                                                |
| Empty           | "Nothing approved yet this year" with "Request funds"                   |
| Expired         | rows past their use-by date show "Expired: USD 4.00 returned" (neutral) |
| Loading / error | skeleton rows; error banner with Retry                                  |

## Budget safety and audit

Approved, used (actual) and open (encumbered) amounts keep their design-system swatches; transaction currency shown under USD. No posting from this page.

## Responsive and accessibility

Mobile: cards per approval with the receipt status first. Table has a caption and right-aligned amounts.

## Related screens and navigation

116, 119, 121, 055, 115.

## Assumptions and open questions

- Use-by date per approval: 30 days after the date needed (assumed), configurable in 076.
