# 069 Rule builder

Status: proposed - awaiting user review. Light theme only. Start screen 8 (todo `ux-s08-rules-builder`). Satori variant of the original Stitch screen `d330a473e27a4a6e85137a7c1739b368` (unchanged). The simulation panel also covers 077 rule simulation and testing.

## Design
| State | Image | Stitch screen |
| --- | --- | --- |
| default (draft v4) | `design/stitch/069-rule-builder/default--desktop--light.png` | `bbb72843f67d43a087e8308adcf569d7` |
| conflict and simulation | `conflict-simulation--desktop--light.png` | `1ca57659dc784b79a69e2df2134f8cf5` |

## Purpose
Let finance define a rule as data (conditions over typed facts, then actions), see how users will have it explained, detect conflicts with active rules, simulate it against a test request with no side effects, and publish a new immutable version.

## Roles
- Primary: Finance Controller, Finance Admin, Organization Admin.
- Secondary: Auditor and Read-only Analyst (read only).

## Entry points
Rules and policies > rule list (067) > a rule; Create rule (068) opens this screen with an empty draft.

## Content and actions
- Header: rule id and name, version tags (Draft vN, Active vN in production), Simulate, Version history, Publish.
- WHEN: condition rows (fact, operator, value or chips) in AND/OR groups; facts include amount in budget and reporting currency, remaining percent, category, location, legal entity, seniority, employee count, requester role.
- THEN: actions (require approvals in sequence or parallel, block, freeze, warn, notify, auto-approve, require documents or finance review).
- Scope and settings: priority, effective dates, org scope, explanation text shown to users.
- Right column: explanation preview, conflict check against active rules, impact over the last 30 days (or the simulation panel).

## Data
Rule versions (immutable once active), condition AST, actions, priority, effective dates, scope; conflict results and simulation results from the API (same evaluator as production, no writes).

## Permissions
`rule:edit` to change drafts, `rule:publish` to publish; publishing is blocked while conflicts are unresolved.

## States
| State | Treatment |
| --- | --- |
| Loading | `sat-ghost` blocks |
| Empty | New rule: one empty condition row and guidance text |
| Validation | Incomplete condition or action: field errors; Publish disabled with reason |
| Conflict | Error-tone conflict card naming the other rule, its priority and the precedence order (block > freeze > approvals > warn > auto-approve), with Narrow scope and View rule; Publish disabled (image) |
| Simulation | Test inputs and result (outcome tag, matched rules with fact values), "Simulation only - no data changed" (image) |
| Success | Snackbar "R-12 v4 published, effective 1 Dec 2026" |
| Confirmation | Publish dialog summarising scope, effective date and impact |
| Error | Publish failed: banner with API detail |

## Audit
Publishing writes an audit entry with the full rule version; every later decision records the rule versions and facts that produced it.

## Responsive
Tablet: right column below the builder. Mobile: read only (view rule and explanation).

## Accessibility
Condition rows are labelled groups; AND/OR is a toggle button with text; outcome tags carry text.

## Related screens
066 rules dashboard, 067 rule list, 068 create rule, 077 rule simulation, 078 rule version history, 059 approval inbox (explanations shown to approvers).

## Navigation
Breadcrumb Home / Rules and policies / R-12; Version history opens 078.

## Open questions
- Should simulation be allowed against a sample of last month's real requests (read only) in addition to a single test request?
- Stitch render notes: the default shows a few illustrative rule ids in the conflict list (#102, #104, #105).
