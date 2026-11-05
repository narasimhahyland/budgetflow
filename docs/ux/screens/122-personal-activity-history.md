# 122 Personal activity history

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 14 batch. Build phase P14. User menu > My activity (`/me/activity`); mobile app avatar menu > My activity.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the timeline of 064 request history. Planned Stitch states, to be generated in a later session:

| State              | Planned image                                                             |
| ------------------ | ------------------------------------------------------------------------- |
| activity timeline  | `design/stitch/122-personal-activity-history/default--desktop--light.png` |
| yearly totals card | `totals--desktop--light.png`                                              |
| sign-ins           | `sign-ins--desktop--light.png`                                            |
| empty (new joiner) | `empty--desktop--light.png`                                               |
| mobile             | `default--mobile--light.png`                                              |

## Purpose

Give every person one place to see what they did in BudgetFlow and what happened to their items (requests, approvals they gave, events they joined or organised, receipts, delegations, exports), how much of their yearly per-person benefits they have used, and their recent sign-ins, so they can answer their own questions and spot anything that was not them.

## Roles

Every signed-in role, for themselves only. Nobody can open another person's activity page; auditors use the audit log (088).

## Entry points

User menu "My activity"; 124 profile "See my activity"; 115 employee home "My activity"; 59c "Recent notifications" link; security email "New sign-in" links to the Sign-ins tab.

## Content and actions

Header: "My activity", period filter (Last 30 days, This year, Custom), type chips (Requests, Approvals, Events, Receipts, Delegations, Exports, Comments), search, "Download my activity" (CSV).

Yearly totals card (sample Kavya Shah, FY2026):

- Requests: 7 submitted, 6 approved, USD 412.50 approved in total.
- Events: 6 attended, 1 organised (Bengaluru Diwali celebration helper).
- Per-person benefits: "USD 220.00 of your USD 500.00 yearly per-person cap used" (from the per-employee cap policy and the benefit ledger, 80h), with "What counts" tooltip.
- Recognition received (from P15, 120a): appears when built.

Timeline (newest first; each entry: time, what happened, item link, amount in USD with transaction currency, channel):

- 4 Nov 10:42: "You submitted REQ-2026-0433 Team lunch, USD 180.00" (web).
- 4 Nov 11:05: "Anand Kumar approved REQ-2026-0433" (Slack).
- 3 Nov 18:20: "You uploaded a receipt for REQ-2026-0145 (INR 4,560.00 = USD 54.61)" (mobile).
- 2 Nov 09:00: "You said Going to Bengaluru Diwali celebration" (email link).
- 28 Oct 16:12: "You exported Available budgets (CSV)".
- Approvers also see their decisions (sample Meera Iyer): "You approved REQ-2026-0418, USD 6,000.00 (your limit USD 10,000.00)"; "Anand Kumar approved REQ-2026-0470 for you as your delegate".

Tab Sign-ins: last 20 sign-ins (time, method SSO or local, device and browser, approximate city), "Not you? Tell your administrator" (opens a message to the Organization Admin with the sign-in details).

## Data and permissions

New P14 read endpoint (`/api/me/activity`) assembling the person's own audit entries (actor = me), events on items they own (decisions on their requests, controls on budgets they own), event participation, notifications sent to them and sign-in events from the identity provider. Scope is always self; the endpoint takes no person parameter. Per-person totals read the employee benefit ledger (80h) and cap policy (072). The CSV download contains the same rows, generated in the background for large ranges, with a link valid for 7 days (091 rule).

## States

| State           | Behaviour                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| Default         | totals and timeline                                                                                      |
| Filtered        | chips and period applied; count "48 entries"                                                             |
| Empty           | new joiner: "Nothing here yet. Your requests, events and approvals will show here." with "Request funds" |
| No cap policy   | per-person line hidden                                                                                   |
| Near cap        | warning tone "USD 460.00 of USD 500.00 used"                                                             |
| Download ready  | snackbar "Your activity file is ready" with Download                                                     |
| Sign-ins        | list; unusual sign-in (new country) in the warning tone                                                  |
| Loading / error | `sat-ghost` rows; error banner with Retry                                                                |

## Budget safety and audit

Read-only. Approved, pending and rejected stay distinct by tag; actions taken by a delegate on someone's behalf are always labelled as such. Downloading one's activity is itself recorded in the activity (and audited as an export).

## Responsive and accessibility

Mobile: totals as a scroller of small cards; the timeline as a list grouped by day. Each entry is one sentence with the time and channel in text; status tags carry icon and words.

## Satori components

`sat-header-bar`, `satInteractiveTag` (type filters), `sat-interactive-card` (totals), `sat-status-tag`, `sat-navigation-tabs` (Activity, Sign-ins), `sat-rich-tooltip` (cap explanation), `sat-empty-state`, `sat-ghost`; Angular Material list, date range picker, snackbar; `bf-money`.

## Related screens and navigation

124 profile and preferences, 115 employee home, 119 request status, 064 request history, 090 approval history, 062 delegations, 080h employee benefit ledger, 072 category policy (per-person cap), 123 notifications and tasks, 088 audit log, 120a recognition (P15).

## Decisions taken

- The page is strictly self-service: nobody can open another person's activity; oversight uses the audit log. Recommended so the page can show everything about a person to that person without new access risks.
- People see their own per-person benefit cap usage, because they are the ones who can avoid going over it.
- Actions a delegate took for someone appear in both people's activity, labelled.
- Recent sign-ins are listed with a "Not you?" path to the Organization Admin.
- People can download their own activity as CSV.
