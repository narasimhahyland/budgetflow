# 090 Approval history

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 7 batch B. Build phase P7. Insights > Reports and audit > Approval history; approvers see their own under 059 "Completed".

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Planned exports: `design/stitch/090-approval-history/default--desktop--light.png` (with a decision drawer).

## Purpose

Give auditors and finance a searchable record of every approval decision: who decided, with what authority, on which channel, under which rule versions and DoA matrix, how long it took, and whether delegation or escalation was involved.

## Roles

Auditor, Finance Admin, Finance Controller (all); approvers (their own decisions).

## Entry points

Sidebar Audit log area and reports; 059 Completed tab; 078 "Decisions made with this version"; 088 audit entries.

## Content and actions

Filters: period, decision (Approved, Partially approved, Rejected, Changes requested, Escalated), approver, request kind, budget, channel (app, email; Slack and Teams in Phase 8), delegated only, escalated only, above SLA. Export (CSV, XLSX, PDF).

Table: decided at, request, requester, budget, amount (USD; transaction currency below), decision tag, approver (with "on behalf of" for delegates), DoA limit at decision, channel, time to decide, rule versions (chips: R-12 v3, R-07 v1), SLA tag (Within SLA, Breached).

Decision drawer: request summary, the full chain with each step's decision, DoA check, hygiene checks, the explanation shown at the time (matched rules with fact values), comments, audit entry id with "View in audit log" (088).

Summary strip: decisions 1,284 in the period; median time to decide 5 h 40 min; escalations 3%; decisions by email 22%.

## Data and permissions

Read model over decisions (rule versions, facts, DoA version and limit, channel, timestamps). Auditors and finance see all; approvers see their own. `approval:read`.

## States

| State           | Behaviour                                             |
| --------------- | ----------------------------------------------------- |
| Default         | as above                                              |
| Empty           | "No decisions match these filters" with Reset filters |
| Large export    | runs as a job; snackbar when ready                    |
| Loading / error | skeleton rows; error banner                           |

## Budget safety and audit

Read-only; decision tags use the request status tones (approved success, rejected important, changes requested warning). Exports are audited.

## Responsive and accessibility

Tablet: hide rule-version and channel columns behind the drawer. Mobile: list of decisions. Times are written out ("5 hours 40 minutes") for screen readers.

## Related screens and navigation

059, 062, 063, 064, 078, 088, 018a approval performance (P10).

## Assumptions and open questions

- Approvers see only their own decisions here (assumed); their team's decisions are in 018a (P10).

## Built in Phase 7, with these parts still open

- Rule versions per decision are not shown: routing does not consult the rules engine yet, so no
  decision records which rule versions shaped its route. The column returns as soon as it does.
- No export, no column sorting, no decision drawer and no date-range filter; the list covers every
  decision on record and each row links to the request, whose history tab holds the chain.
- A partial approval shows the amount asked for; the amount granted needs a contract field.
- Filters are not kept in the address, so a filtered view cannot be bookmarked or shared.
