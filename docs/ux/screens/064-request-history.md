# 064 Request history

Status: proposed - awaiting user review. Light theme only. UX Phase 4-7 track, batch 2. Build phase P5. "History" tab of 060.

## Design

| State   | Image                                                           | Stitch screen                      |
| ------- | --------------------------------------------------------------- | ---------------------------------- |
| default | `design/stitch/064-request-history/default--desktop--light.png` | `405ecb282a2945ceb61a536cecb3ca57` |

## Purpose

The full life of one request: drafts, submissions, rule evaluations, decisions, requested changes and resubmissions, with the channel each action came from.

## Roles

Requester and approvers on the request; auditors read.

## Entry points

060 tab History; 055 row menu; audit log links.

## Content and actions

Header with ID, title, status and amount. Tabs: Details (060), History, Documents. Timeline newest first: actor, action, time, channel chip (Web, Email; Slack, Teams and Mobile from P8), DoA chip on decisions, quoted comments. Side card "Compare versions" (field-by-field for resubmissions). Export history (PDF).

## Data and permissions

Built from the request's audit entries and approval actions; read-only. Export is audited.

## States

Single version: compare card hidden. Loading skeleton; error banner.

## Budget safety and audit

Each entry links to its audit record; rule evaluations show rule versions and facts (from the decision record).

## Responsive and accessibility

Mobile: timeline only; compare opens as a sheet. Timeline is an ordered list; channel chips have text.

## Related screens and navigation

055, 060, 061, 061a, 065 (P7), 088.

## Assumptions and open questions

- Known render issue: Stitch drew a sidebar with invented items and a "Verify ledger" card; the shell is 000a and there is no ledger card on this page.
