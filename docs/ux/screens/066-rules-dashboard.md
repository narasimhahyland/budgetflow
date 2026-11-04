# 066 Rules dashboard

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 7 batch A. Build phase P7. Landing page of sidebar "Rules and policies".

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Planned exports: `design/stitch/066-rules-dashboard/default--desktop--light.png`, `empty--desktop--light.png` (no rules published yet).

## Purpose

Give finance one view of how policy is working: what is active, what is waiting to be published, what conflicts, what the rules decided in the last 30 days, and where approvals and post-spend exceptions pile up.

## Roles

Finance Admin, Organization Admin (full); Finance Controller, Auditor, CEO (read).

## Entry points

Sidebar Rules and policies; links from 017 alerts and 074a.

## Content and actions

Header: "Rules and policies", Export (CSV, XLSX, PDF), "Create rule" (filled). Secondary navigation (`sat-navigation-tabs`): Overview, Rules (067), Templates and thresholds (071a), Routing (070), Delegation of authority (070a), Limits (071), Categories (072), Gifts and entertainment (072a), Locations (073), Vendors (073a), Over-budget (074), Freeze and zero (075), Notifications and SLA (076), Exceptions (074a).

- KPI cards: Active rules 24; Drafts awaiting publish 3; Conflicts 1 (error tone, links to the rule); Scheduled to start 2 (effective 1 Dec 2026); Post-spend exceptions open 7 (links to 074a); Approvals past SLA 4 (links to 059 escalated).
- "Decisions in the last 30 days" chart (stacked bars by week: auto-approved, approvals required, warned, blocked) with "View as table".
- "Most matched rules" table: rule, outcome type, matches, share of requests, last change.
- "Needs attention" list: conflict between R-12 v4 (draft) and R-07 (active); R-19 expires 31 Dec 2026; 2 delegations end this week; DoA matrix v2 draft waiting for CEO approval.

## Data and permissions

Read model over rule versions, decisions (rule versions and facts per decision), exceptions, escalations and delegations; no writes from this page. `rule:read`.

## States

| State           | Behaviour                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| Default         | as above                                                                                                       |
| Empty           | "No rules yet. Start from a policy template or the threshold table." with "Browse templates" and "Create rule" |
| Loading / error | skeleton cards; partial error banner per failed panel                                                          |
| Read only       | Finance Controller and Auditor: Create rule hidden; links open read-only views                                 |

## Budget safety and audit

Blocked versus warned versus approvals required versus auto-approved keep distinct tones (error, warning, primary, success) with labels. Read-only page; exports are audited.

## Responsive and accessibility

Tablet: KPIs in two rows; secondary navigation scrolls. Mobile: read-only KPIs and the attention list. Chart has a table alternative.

## Related screens and navigation

067-078, 070a, 071a-074a, 090, 059.

## Assumptions and open questions

- Fourteen secondary tabs is a lot; alternative is grouping into Policies (071-075), Approvals (070, 070a, 076) and Monitoring (074a, 077). Recommendation: group into those three menus.
