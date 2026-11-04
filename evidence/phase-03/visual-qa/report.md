# Phase 3 visual QA

Scope: the 13 Phase 3 pages (inventory screens 6, 7, 9, 22c, 33-42, 102a, 104a, 106, 106a-c, 107, 107a, 108, 108a) at desktop (1440x900), tablet (834x1112) and mobile (Pixel 7), light theme only (dark theme deferred), on the local stack with the deterministic seed, signed in as the role that owns each page. During the phase, proposed Stitch designs landed on main for 22c, 107 and 108; those three pages were reworked to follow them and compared side by side (`design-parity/design-parity.md`). The other ten pages have no design yet; they were built from `docs/ux/design-system.md` with Satori components first and Angular Material second and await design review.

## Iterations

| Iteration | Stack                                                                            | Captures | Automated checks                                                                        | Inspection findings            | Result |
| --------- | -------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------- | ------------------------------ | ------ |
| 1         | Phase 2 shell + Phase 3 (pre-merge integration)                                  | 42       | 0 console errors, 0 failed requests, no horizontal overflow, no interpolation leftovers | 7 (2 blocking, 5 minor, below) | fixed  |
| 2         | Same, after fixes; repeated on a freshly seeded stack after the rebase onto main | 42       | same, all clean                                                                         | none blocking                  | pass   |

Iteration 1 findings, all fixed in the commits named:

| Finding                                                                                                                                  | Severity | Fix                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Rate comparison card stayed blank for a missing rate (reading `value()` of a failed resource throws in Angular 22 and aborted rendering) | blocking | `valueOf` helper used for every resource read (fix(web): keep calendar selections across reloads and never read failed resources) |
| Calendar and fiscal-year selection jumped back to the default after any reload (create calendar, period status change)                   | blocking | `linkedSignal` keeps a still-valid previous selection (same commit)                                                               |
| Shell header showed "Home" on Phase 3 pages                                                                                              | minor    | routes carry `pageTitle` and `section` (fix(web): page titles in the shell header, ...)                                           |
| "All ..." and "None" options rendered blank in selects (Material treats `null` as no selection)                                          | minor    | string sentinels (same commit)                                                                                                    |
| Locked periods used the red important tone, which reads as an error for a normal finished state                                          | minor    | info tone, per the budget-safety visual rules (same commit)                                                                       |
| Calendar picker truncated the calendar name                                                                                              | minor    | wider picker (same commit)                                                                                                        |
| DoA page copy mentioned delivery phases                                                                                                  | minor    | plain product wording (same commit)                                                                                               |

Before images of iteration 1 were overwritten by the re-capture; the table above records each change.

## Screens (final iteration)

All files in `screens/` are named `<screen>--<viewport>--light.png`.

| Screen | Page                                   | Role               | Desktop | Tablet | Mobile |
| ------ | -------------------------------------- | ------------------ | ------- | ------ | ------ |
| 033    | Organization hierarchy                 | org-admin          | clean   | clean  | clean  |
| 033    | Organization hierarchy (subtree scope) | regional-manager   | clean   | clean  | clean  |
| 038    | People                                 | org-admin          | clean   | clean  | clean  |
| 039    | Person profile                         | org-admin          | clean   | clean  | clean  |
| 041    | Cost centers                           | finance-admin      | clean   | clean  | clean  |
| 022c   | Headcount                              | finance-admin      | clean   | clean  | clean  |
| 042    | Org import                             | org-admin          | clean   | clean  | clean  |
| 102a   | Legal entities                         | finance-admin      | clean   | clean  | clean  |
| 108    | Fiscal calendars and periods           | finance-controller | clean   | clean  | clean  |
| 107    | Exchange rates                         | finance-admin      | clean   | clean  | clean  |
| 106a   | GL accounts and mapping                | finance-admin      | clean   | clean  | clean  |
| 106b   | Reason codes                           | finance-admin      | clean   | clean  | clean  |
| 106c   | Vendors                                | finance-admin      | clean   | clean  | clean  |
| 104a   | Delegation of authority                | finance-controller | clean   | clean  | clean  |

States beyond the default (forbidden, not found, empty search, validation problems, success banners, refused backdating, plan vs spot) are exercised by the journeys in `apps/web-e2e/src/org` and `apps/web-e2e/src/finance-admin` (`../functional/journeys-phase3.txt`).

## Visual regression

The app-shell baselines were regenerated in the pinned Playwright image because the new navigation entries change the rail and drawer (commit test(visual): refresh app-shell baselines for the Phase 3 navigation). Phase 3 pages are not yet in `apps/web-e2e/visual/screens.json`: their lists grow with scenario data on the shared stack and they have no approved design; adding them is a follow-up once designs are approved and the captured lists are filtered to seed data.
