# 114 System health dashboard

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 14 batch. Build phase P14. Admin > System health (`/admin/health`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the tiles of 092. Planned Stitch states, to be generated in a later session:

| State                       | Planned image                                                           |
| --------------------------- | ----------------------------------------------------------------------- |
| all healthy                 | `design/stitch/114-system-health-dashboard/default--desktop--light.png` |
| degraded (queue backlog)    | `degraded--desktop--light.png`                                          |
| nightly job failed          | `job-failed--desktop--light.png`                                        |
| schedule maintenance notice | `maintenance--desktop--light.png`                                       |

## Purpose

Let the platform operator and the Organization Admin see at a glance whether BudgetFlow is working: each service, the background job queues, the nightly checks and jobs, response times and storage, and announce planned maintenance to users, without showing any company financial data.

## Roles

Super Admin (platform operator; full page, no financial data); Organization Admin (read; schedules maintenance notices with Super Admin); Finance Controller and Auditor reach the integrity rows from 113.

## Entry points

Admin > System health; 102 "System" section (Super Admin); alerts to the operator ("Worker queue backlog"); 113 nightly jobs; 092 "Integration health".

## Content and actions

Header: overall status tag (All systems working), environment (Production), version 1.14.0, data region, last refresh with Refresh.

Service tiles (status, response time, last check): API (healthy, p95 180 ms), Worker (healthy), Database (healthy, connections 34 of 200), Identity provider (healthy), Document store (healthy, 14.6 GB used), Email delivery (healthy, bounces 0.2%), Slack app (healthy), Microsoft Teams app (not enabled), AI provider (healthy, p95 1.9 s), Integrations (1 needs attention, link to 092).

Queues (table): queue, waiting, running, failed (last 24 hours), oldest waiting. Samples: email 0 waiting; notifications 3; integration-sync 1 running, 2 failed (link to 100); ai-outlook 0; digests 0; outbox lag 2 s.

Nightly jobs (table): job, schedule, last run, duration, result: retention run 01:00 (Clean), audit chain verification 01:30 (Verified), ledger rebuild check 02:00 (Clean), demo reset 02:00 (demo deployment, Success), AI outlooks 03:00 (Success), digest send 07:00 (Sent 1,180).

Charts (last 24 hours; "View as table"): requests per minute and error rate; p95 response time.

Maintenance notice: "Schedule a notice": message, start and end (shown in each person's timezone), "Show in the app from" (default 24 hours before); preview of the shell banner; Cancel notice.

## Data and permissions

Reads the existing `health.ts` contract (extended in P14 `admin.ts` with service checks, pg-boss queue statistics, outbox lag, job run history and request metrics) and the integrity run status without amounts. Super Admin access needs no break-glass grant because no financial data is returned: integrity results show counts and statuses only. Organization Admin reads the same page; maintenance notices need Super Admin or Organization Admin and are shown in the 000a shell as an info banner.

## States

| State           | Behaviour                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| All healthy     | success status tag                                                                                         |
| Degraded        | warning tag on the tile and header "Worker queue backlog: oldest job waiting 14 minutes"                   |
| Down            | error tile "Document store not responding since 10:12"; header "Partial outage"                            |
| Job failed      | error row "Ledger rebuild check failed at 02:04: drift detected; Finance Controller notified" (no amounts) |
| Maintenance set | info banner preview and a scheduled-notice card with Cancel                                                |
| Read only       | Organization Admin sees all tiles; queue retry actions are in 100 for Integration Admin                    |
| Loading / error | `sat-ghost` tiles; "Health data unavailable" with Retry                                                    |

## Budget safety and audit

The page shows no budgets, amounts or people's financial data, so the platform operator can monitor without break-glass access. Integrity failures link to the people who can act (Finance Controller, Auditor) rather than showing details. Maintenance notices are audited.

## Responsive and accessibility

Desktop, tablet and mobile (operators check from phones): tiles stack, tables become cards. Status is icon and text; charts have tables.

## Satori components

`sat-header-bar`, `sat-interactive-card` (service tiles), `sat-status-tag`, `mat-table`, `sat-banner`, `sat-ghost`, `sat-500-error-state`; charts from `libs/web/ui/charts`; Angular Material dialog (maintenance notice), datepicker and time fields, snackbar.

## Related screens and navigation

092 integrations, 099 sync status, 100 errors and retry, 113 audit and compliance, 102c demo environment, 105 feature flags (maintenance flag), 109 notifications delivery, 000a shell banner.

## Decisions taken

- Health data never includes financial amounts, so the platform operator can monitor without break-glass. Recommended to keep the separation between running the platform and seeing the company's money.
- Integrity check failures show status and counts and notify the Finance Controller and Auditor, who see the details in 113 and 17a.
- Maintenance notices appear in the app 24 hours ahead by default, in each person's timezone.
- The page works on mobile because operators often check health away from a desk.
