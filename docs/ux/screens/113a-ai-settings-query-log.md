# 113a AI settings and query log

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 13 batch. Build phase P13. Review-added screen (plan Phase 13 and `ai-features` rule: per-feature kill switch, AI query log, evaluation thresholds; no screen existed). Settings > AI (`/admin/ai`, tabs `/admin/ai/features`, `/admin/ai/log`, `/admin/ai/accuracy`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the settings layout of 102. Planned Stitch states, to be generated in a later session:

| State                           | Planned image                                                          |
| ------------------------------- | ---------------------------------------------------------------------- |
| features and switches           | `design/stitch/113a-ai-settings-query-log/default--desktop--light.png` |
| turn on: data sent confirmation | `turn-on-dialog--desktop--light.png`                                   |
| query log                       | `query-log--desktop--light.png`                                        |
| accuracy against thresholds     | `accuracy--desktop--light.png`                                         |

## Purpose

Give the company one place to decide which AI features are on, see exactly what data each feature sends to the model, review how AI is used (who asked, which records were used, what came out) without exposing what people typed, and check that each feature still meets its accuracy threshold.

## Roles

Organization Admin (switches and settings; reads the query log); Finance Admin (reads features and accuracy; must confirm turning on finance features: matching, extraction, anomaly flags, outlook); Auditor (reads everything, including the query log). Other roles: none. Super Admin sees only the platform's provider configuration status.

## Entry points

Settings navigation "AI"; 11a menu "How answers work" (read-only summary for everyone, linking here for admins); 17c paused-kind banner; 102 company settings "AI features" card; weekly finance digest "AI accuracy below threshold".

## Content and actions

Tab Features: table, one row per feature: feature, where it appears, status (On, Off), who can use it (all roles within scope by default; can be narrowed to roles), data sent (link), last changed by and when, switch.

- Ask BudgetFlow in the app (11a): On.
- Ask in Slack and Teams (61f): Off ("Needs the chat app, 61e").
- Spending outlook and nudges (16b): On.
- Suggested allocations (22d): On.
- Policy assistant explanations (69a): On.
- Transaction matching suggestions (80f): On.
- Receipt and quote extraction (121a): On.
- Anomaly flags (17c): On.
- Phase 15 and 16 rows appear when built: leadership summary drafts (11b), variance commentary drafts (11b), event planning copilot (45b), what-if narrative (31a), connector for AI assistants (92c, key `ai.mcp`).

Settings card: questions per person per hour (50); conversation history kept (30 days; 7-90); nudge minimum gap (USD 500.00 and 10% of authorized); nudge frequency (once per 14 days per budget); "Show AI flags to approvers" (on). Provider card (read-only): "Model provider configured by the platform; model id and version" with the current values; "Provider keys are held in the server environment and never shown."

Turn on dialog: what the feature does, what it can never do ("It can't approve, reject, move money or change settings."), the fields sent to the model (for example matching: merchant, memo, dates, amounts, record ids; never card numbers or contact details), who will see it, Turn on. Finance features show "Needs confirmation by a Finance Admin" and stay Pending until Marco Bianchi confirms.

Tab Query log: filters (feature, channel, outcome, person, date); table: time, person, feature, channel (web, mobile, Slack, Teams, system), records used (count; ids link only if the viewer may read them), outcome (Answered, Suggested, Accepted, Dismissed, Refused - out of scope, Refused - action, Discarded - unreliable, Failed), model id and version, latency. Sample rows: 10:42 Anand Kumar, Ask (web), 3 records, Answered, 1.8 s; 10:15 system, Matching, 24 records, Suggested; 09:58 Kavya Shah, Ask (Slack), 0 records, Refused - out of scope. No question or answer text. Sub-tab "Reported answers": answers people reported with "Include my question and the answer" on (11a), with text, kept 90 days, status (New, Reviewed) and a note.

Tab Accuracy: per feature, the latest evaluation run (fixture set, run date, environment: fake provider in CI, live provider when configured), metric and threshold (matching precision of High suggestions 0.95; extraction field accuracy for totals and dates 0.95; anomaly flag precision 0.80 per kind; ask: answers citing only permitted records 1.00 and refusals on out-of-scope questions 1.00), result with Pass or Below threshold; production acceptance rate last 30 days (accepted or helpful out of shown).

## Data and permissions

New P13 `ai.ts` contract: feature switches stored as `feature_flags` keys (`ai.ask`, `ai.ask_chat`, `ai.outlook`, `ai.allocation_suggestions`, `ai.policy_explain`, `ai.matching`, `ai.extraction`, `ai.anomaly_flags`) plus AI settings in `tenant_settings.settings`; `ai_query_log` per the phase handoff (actor, feature, channel, fact ids, model id and version, latency, outcome; no raw question, answer or personal data); reported answers in a separate table with 90-day retention. `tenant.settings.manage` (Organization Admin) to change switches and settings; a new `ai.confirm_finance` action for Finance Admin (integrator adds); `audit.read` (Auditor) and `tenant.settings.manage` to read the log. Switching a feature off takes effect on the next request; the API refuses calls to a disabled feature.

The route guards and the sidebar entries use different permissions on purpose; they are not to be
"aligned".

- The route guards use `tenant.read`, because that is what the server asks for.
  `AiSettingsService.viewInTx` and `AiEvaluationsService.accuracy` both assert `tenant.read` at
  tenant scope, so every authenticated member of the tenant may read the Features and Accuracy tabs.
  Only the controls behind them are narrower: switches and settings assert `tenant.settings.manage`,
  running an evaluation asserts the same, confirming a finance feature asserts `ai.confirm_finance`,
  and the Query log tab asserts `audit.read` or `tenant.settings.manage`
  (`AiQueryLogService.assertCanRead`).
- The sidebar has two entries for this one screen, because its audiences hold different permissions
  and nav items carry a single permission each. "AI settings" (`/admin/ai/features`) uses
  `tenant.settings.manage`, the action behind the switches, so it appears for the Organization Admin
  who sets them. "AI accuracy" (`/admin/ai/accuracy`) uses `audit.read`, which carries the Finance
  Admin, Finance Controller, Auditor and CEO to the Accuracy tab and, from its tabs, to the query
  log. Both entries are stricter than the guard on purpose.
- Loosening either entry to `tenant.read` would put an Admin entry in front of every signed-in role,
  including `employee`, `event-organizer` and the owner roles, for whom the Roles section above
  reads "Other roles: none". Tightening the guards to match the nav would revoke reading that the
  server intends to grant, and would send the Finance Admin and the Auditor to a 403 on a screen the
  spec gives them.
- Worth raising with the backend rather than papering over here: the read gate on the Features and
  Accuracy tabs (`tenant.read`) is looser than this spec's Roles section intends. If it tightens to
  `audit.read` or `tenant.settings.manage`, the guards and both nav entries can converge and this
  note can go.

## States

| State            | Behaviour                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Features         | as above                                                                                                                                    |
| Turn on dialog   | data sent and limits; Turn on                                                                                                               |
| Pending finance  | warning tag "Waiting for Finance Admin confirmation" on the row; feature stays off                                                          |
| Turn off dialog  | "People will stop seeing suggestions immediately. Suggestions already accepted are not changed."                                            |
| Below threshold  | error-tone row in Accuracy and a banner on Features: "Anomaly flags: Unusual vendor at 0.62, below 0.80; new flags of this kind are paused" |
| Provider not set | banner "No model provider is configured. AI features cannot be turned on." (switches disabled)                                              |
| Query log empty  | "No AI activity in this period"                                                                                                             |
| Read only        | Finance Admin and Auditor see values without controls (except Finance Admin's Confirm)                                                      |
| Validation       | "History must be 7-90 days", "Questions per hour must be 10-200"                                                                            |
| Loading / error  | `sat-ghost`; error banner with Retry                                                                                                        |

## Budget safety and audit

No AI feature can post to the ledger, approve, reject or change rules and limits, whatever its switch; this page cannot change that. Switch changes, finance confirmations and setting changes are audited with old and new values. The query log is append-only and kept 13 months (retention settings in 111 can lengthen it, never shorten it below 13 months).

## Responsive and accessibility

Desktop and tablet; mobile read-only. Switches have visible On and Off text and the feature name in their accessible name; the query log is a standard table with sortable time.

## Satori components

`sat-header-bar`, `sat-navigation-tabs`, `mat-table` with `satTableWithRowStates`, `sat-status-tag` (status, outcome, pass or below), `sat-tag` (AI), `sat-banner`, `sat-empty-state`, `sat-ghost`; Angular Material slide toggles, dialog (turn on, turn off), form fields, snackbar.

## Related screens and navigation

011a assistant, 061f chat questions, 16b, 17c, 22d, 69a, 80f, 121a (AI surfaces), 061e chat app setup, 102 company settings, 105 feature flags, 111 data retention, 113 audit and compliance settings, 088 audit log.

## Decisions taken

- Each AI feature has its own switch, and finance-affecting features (matching, extraction, anomaly flags, outlook) need a Finance Admin's confirmation to turn on. Recommended so the people accountable for the numbers agree before AI touches them.
- Features start off in a new deployment; the seed turns them on for the local stack and the demo environment.
- The query log records who used which feature on which records and the outcome, but never what people typed or what the model wrote; only answers people chose to report include text.
- The provider and keys are platform configuration (environment), shown read-only here, never entered in the app.
- A feature or flag kind below its accuracy threshold is shown in the error tone and, for anomaly flags, paused automatically.
