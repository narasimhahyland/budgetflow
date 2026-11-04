# 067 Rule list

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 7 batch A. Build phase P7. Rules and policies > Rules.

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Planned exports: `design/stitch/067-rule-list/default--desktop--light.png`, `priority-order--desktop--light.png` (reorder mode).

## Purpose

List every rule with its status, version, priority and scope so finance can find, compare, reorder and retire rules, and see at a glance which run first when several match.

## Roles

Finance Admin, Organization Admin (full); Finance Controller, Auditor (read).

## Entry points

066 tabs and "Most matched rules"; breadcrumb from 069; search.

## Content and actions

Header: "Rules", search, filters (status, outcome type, scope, owner of the rule, effective on date), Export, "Create rule".

Table (dense, `satTableWithRowStates`): priority, rule id and name, outcome type tag (Block, Freeze, Require approval, Warn, Auto-approve, Notify), status tag (Draft neutral, Scheduled info, Active success, Expired neutral, Retired neutral), active version and draft version ("v3 active, v4 draft"), scope (org units, entities, request kinds), matches in 30 days, effective from and to, last published by. Row opens 069.

Sample rows: 10 R-03 "Block blocked vendors" (Block, Active v2, all entities); 20 R-05 "Freeze when budget frozen" (Freeze, Active v1); 30 R-12 "Over-threshold approvals" (Require approval, Active v3, draft v4); 40 R-07 "Event spend above USD 5,000.00 needs Finance Controller" (Require approval, Active v1); 50 R-14 "Per-person meal limit warning" (Warn, Active v2); 60 R-19 "Auto-approve wellbeing under USD 25.00" (Auto-approve, Active v1, expires 31 Dec 2026).

Precedence note above the table: "When rules disagree: block > freeze > required approvals (combined) > warn > auto-approve. Ties go to the lower priority number, then the rule id."

Reorder mode: "Change priority" turns on drag handles (`satDragDropList`) and number fields; Save order creates a new version of each moved rule (dialog lists them).

Row actions: Duplicate, Simulate (077), Version history (078), Retire (reason required; active rules only).

## Data and permissions

Rule versions with priority, status, scope and match counts. Reordering and retiring create new immutable versions; `rule:edit` for drafts and order, `rule:publish` to activate. Retired rules stay readable.

## States

| State          | Behaviour                                                                  |
| -------------- | -------------------------------------------------------------------------- |
| Default        | as above                                                                   |
| Reorder        | drag handles, unsaved-changes bar with Save order and Cancel               |
| Conflict       | row with an error tag "Conflicts with R-07" linking to 069                 |
| Empty filter   | "No rules match these filters" with Reset filters                          |
| Retire confirm | dialog with reason; warns if the rule matched requests in the last 30 days |

## Budget safety and audit

Outcome tags use the precedence colours consistently (block error, freeze info with lock, approval primary, warn warning, auto-approve success). Reorder, retire and duplicate are audited with versions.

## Responsive and accessibility

Tablet: hide scope and last-published columns behind a row expander. Mobile: read-only list. Drag reorder has a keyboard alternative (move up/down buttons and number fields).

## Related screens and navigation

066, 068, 069, 077, 078.

## Assumptions and open questions

- Priority numbers in steps of 10 (assumed) so new rules can slot between.
