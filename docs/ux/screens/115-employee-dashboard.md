# 115 Employee dashboard

Status: proposed - awaiting user review. Light theme only. Start screen 10 (todo `ux-s10-employee-dashboard`). Satori variant of the original Stitch screen `f8f50cecf29748ec94a632a419436f18` (unchanged).

Revised 2026-11-04 to the single-company decisions: Hyland only (static label, no tenant or organization switcher, no reporting-currency chip), budgets in USD (transactions may show INR or EUR with the USD amount), Export instead of Share.

## Design

| State                             | Image                                                              | Stitch screen                      |
| --------------------------------- | ------------------------------------------------------------------ | ---------------------------------- |
| default                           | `design/stitch/115-employee-dashboard/default--desktop--light.png` | `74783c24dd1d4849903fe5c5bc159189` |
| blocked (frozen and zero budgets) | `blocked--desktop--light.png`                                      | `d71c1e3f197e4e8eb829f64c7bdd171f` |

## Purpose

Show an employee what they can still request, the status of their requests, upcoming events and tasks, with one-click access to request funds or upload a receipt.

## Roles

Primary: Employee. Secondary: any role in "my view" mode (everyone is also an employee).

## Entry points

Home for the Employee role; sidebar Home.

## Content and actions

- Employee shell (reduced navigation: Home, My budgets, Request funds, My requests, Events, Notifications).
- Greeting with Request funds (primary) and Upload receipt.
- Budgets available to me: one card per budget the employee may request from, showing what they can still request of the limit and period, with tags such as "Needs manager approval".
- My requests: id, description, amount, status tag, action (Details, Resubmit for rejected).
- Tasks (for example upload a receipt by a date) and Upcoming events with RSVP.

## Data

Per-employee request limits from rules (per person, per period), requests and statuses, tasks, event invitations.

## Permissions

Employees see only their own requests and the budgets they may request from; they never see budget totals of the parent.

## States

| State   | Treatment                                                                                                                                                                                     |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loading | `sat-ghost` cards and rows                                                                                                                                                                    |
| Empty   | New joiner with no budgets yet: empty state "No budgets available to you yet" with a link to the request policy                                                                               |
| Blocked | Frozen budget: info banner with who, until when and why; Frozen tag with lock; request action disabled with reason. Set-to-zero budget: important tag, "No funds available this year" (image) |
| Error   | Card-level error with Retry                                                                                                                                                                   |
| Success | After submitting a request: snackbar with the request id                                                                                                                                      |

## Budget safety

Frozen (lock, info) vs set to zero (important); pending (warning) vs approved (success) vs rejected (important).

## Audit

Read only; requests created from here are audited in their own flows.

## Responsive

Mobile is a first-class layout for employees: cards stacked, Request funds as a floating action, requests as a list.

## Accessibility

Cards are headings with landmarks; progress values have text equivalents.

## Related screens

116 available budgets, 117 submit spending request, 118 request event funding, 119 view request status, 121 upload receipt, 123 notifications and tasks.

## Navigation

Breadcrumb Home; cards link to 116, requests to 119.

## Open questions

- Should employees see the remaining amount of a team budget (shared lunch budget) or only their personal limit?
