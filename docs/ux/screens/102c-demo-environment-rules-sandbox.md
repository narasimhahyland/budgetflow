# 102c Demo environment and rules sandbox

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 14 batch. Build phase P14. Settings > Demo and sandbox (`/admin/sandbox`) in the production app; Rules and policies > Sandbox (`/rules/sandbox`); the demo environment itself is a separate deployment with a persistent banner and a role picker on its sign-in page.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a), the rule views of 067 and 077. Planned Stitch states, to be generated in a later session:

| State                                   | Planned image                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| demo and sandbox overview (production)  | `design/stitch/102c-demo-environment-rules-sandbox/default--desktop--light.png` |
| demo sign-in role picker                | `demo-sign-in--desktop--light.png`                                              |
| demo banner and reset dialog            | `demo-reset--desktop--light.png`                                                |
| rules sandbox: changes and test results | `sandbox--desktop--light.png`                                                   |
| copy to drafts (conflict)               | `copy-conflict--desktop--light.png`                                             |

## Purpose

Give the company two safe places to try BudgetFlow without risk: a demo environment (a separate deployment with the fictional Hyland story, reset nightly or on demand) for demos, training and trying any feature as any role; and a rules sandbox inside the production app where finance can change several rules and thresholds together, test them against sample and recent requests, and bring only the changes they want back as drafts for the normal publishing path.

## Roles

Demo environment: Organization Admin (link, reset schedule; resets inside the demo); anyone given the demo address signs in with demo accounts. Rules sandbox: Finance Admin and Organization Admin (edit and run); Finance Controller and Auditor (read sandboxes and results).

## Entry points

Settings > Demo and sandbox; 010a "Explore with sample data"; 101a "Developer sandbox" (separate, for API keys; linked for clarity); Rules dashboard (066) "Try changes in the sandbox"; 069 rule builder "Open in sandbox".

## Content and actions

Overview (production), Demo environment card: address, status (Healthy), version (matches production 1.14.0), data "Fictional Hyland story: 3 regions, 14 budgets, 9 events, 120 requests", last reset (today 02:00 IST), next reset (02:00 IST nightly), demo accounts (one per role; names fictional; passwords are never shown here: the demo sign-in page has a role picker), "Open demo environment".

Inside the demo deployment:

- Persistent top banner (info tone): "Demo environment. Fictional data, reset every night at 02:00 IST. Do not enter real information." with "Reset now" for the demo Organization Admin.
- Sign-in page role picker: cards for CEO, Finance Admin, Finance Controller, Regional Manager India, Location Manager Bengaluru, Event Organizer, Employee, Auditor, each with the fictional person and what they can try ("Approve a co-funding request", "Set a region to zero").
- Reset dialog: "Everything done in the demo since the last reset will be removed and the story restored." typed confirmation "RESET".

Rules sandbox (production app):

- Sandbox list: name, owner, created, changes, last run, expires (30 days after last use). Sample: "Q1 FY2027 threshold changes", Marco Bianchi, 4 changes, last run 10:20.
- Sandbox workspace: left, copied rule set (rules, policy templates and threshold table at the time of copying, with live versions noted: "R-12 v3, copied 3 Nov"); changes are highlighted (for example "Team events approval threshold USD 5,000.00 -> USD 7,500.00", "Alcohol cap UK01 GBP 10.00 -> GBP 12.00 per person", new rule "Block vendors without a contract above USD 10,000.00", R-18 disabled).
- Test runs: "Sample requests" (create freely: requester, budget, amount, category, attendees, vendor) and "Recent requests" (last 90 days of real requests, read-only copies). Results table: request, live outcome, sandbox outcome, difference (for example "Live: Meera Iyer approves; Sandbox: auto-approved within policy"), with the rule explanation for each side. Summary: "Of 412 recent requests: 37 change route, 4 newly blocked, 0 newly allowed past a block."
- "Copy to drafts": choose changes to bring back; each becomes a new draft rule version in Group 7 (069, 078) for review, simulation (077) and publishing with the normal approvals.

## Data and permissions

Demo: a separate deployment of the same build with `DEMO_MODE` configuration, its own database and identity realm with demo accounts, seeded by `seed/demo.ts` (P14 handoff), reset by a scheduled job; no connection to production data, identity provider, integrations or chat apps; outbound email goes to a catch-all mailbox. Production shows only the demo's status through a health endpoint. Rules sandbox: new P14 `admin.ts` data (sandbox, copied rule versions, changes, test requests, run results) evaluated by the Phase 7 rules engine in simulation mode; recent requests are read through the asker's scope (Finance Admin: company-wide). Sandboxes never create requests, notifications, approvals or ledger entries. Copy to drafts calls the rule draft endpoints (`master_data.manage` or the Phase 7 rules action).

## States

| State               | Behaviour                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| Overview            | demo card and sandbox list                                                                                      |
| Demo resetting      | info banner in the demo "Resetting: about 2 minutes"; sign-in paused                                            |
| Demo reset failed   | production card error tag "Last reset failed at 02:00" with "Retry reset"; demo banner says data may be changed |
| Demo version behind | warning tag "Demo runs 1.13.2; production 1.14.0" with "Update demo"                                            |
| Sandbox empty       | "Copy the live rules to start" with Create sandbox                                                              |
| Sandbox changed     | highlighted changes; "Run tests" enabled                                                                        |
| Test results        | differences table and summary                                                                                   |
| Copy conflict       | warning "R-12 changed to v4 since you copied it" with Compare and "Rebase on v4"                                |
| Expired             | neutral tag "Expired: no use for 30 days"; read-only, can be duplicated                                         |
| Read only           | Finance Controller and Auditor see sandboxes and results without edit controls                                  |
| Loading / error     | `sat-ghost`; error banner with Retry                                                                            |

## Budget safety and audit

Neither the demo nor the sandbox can affect real money: the demo is a separate deployment and database, and the sandbox only simulates. Changes leave the sandbox only as draft rule versions that follow the normal versioning, simulation and publishing approvals. Creating and deleting sandboxes and copying to drafts are audited in production; demo resets are logged in the demo.

## Responsive and accessibility

Desktop and tablet; mobile read-only. The demo banner is a landmark region announced once per session; role picker cards are buttons with the role and person in the accessible name.

## Satori components

`sat-header-bar`, `sat-interactive-card` (demo card, role picker), `sat-banner` (demo banner), `sat-status-tag`, `mat-table` with `satTableWithRowStates`, `sat-empty-state`, `sat-ghost`, `sat-splitter` (rules and results); Angular Material dialog (reset, copy to drafts), form fields, snackbar.

## Related screens and navigation

066 rules dashboard, 067 rule list, 069 rule builder, 071a policy templates and thresholds, 077 rule simulation, 078 rule versions, 010a setup guide, 101a API sandbox, 114 system health.

## Decisions taken

- The demo environment is a separate deployment (not a second tenant) with its own database and demo accounts, reset nightly and on demand. Recommended so demos and training can never touch Hyland's data.
- The demo has no link to production identity, integrations or chat apps, and its emails go to a catch-all mailbox.
- The rules sandbox runs inside production because it needs the live rules and recent requests, but it only simulates and cannot create requests, notifications, approvals or postings.
- Changes leave the sandbox only as draft rule versions, so publishing keeps its approvals.
- Sandboxes expire after 30 days without use to avoid stale copies.
