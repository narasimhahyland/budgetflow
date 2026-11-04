# 108 Fiscal calendar (fiscal-period settings, with 108a calendar variants)

Status: proposed - awaiting user review. Light theme only. UX core set part 2 (todo `ux-core-screens`). Build phase P3.

## Design

| State                    | Image                                                           | Stitch screen                      |
| ------------------------ | --------------------------------------------------------------- | ---------------------------------- |
| FY2026 periods, Oct open | `design/stitch/108-fiscal-calendar/default--desktop--light.png` | `fb67fdf9f9f24425ae1f568e1ca6a0cb` |

## Purpose

Define fiscal years and periods (calendar months, 4-4-5 or 52/53-week) and control which periods accept postings.

## Roles

Finance Admin and Finance Controller (edit and close); Auditor (read).

## Entry points

Settings > Finance > Fiscal calendar; 080c sign-off; period close (80e, P11).

## Content and actions

Add fiscal year. FY card with calendar variant segmented control and date range. Periods table: period, start, end, status (Locked, Open, Future), closed by, actions (View audit, Close period). Warning banner on what closing means. Right: plan rate and year-end card (plan rates locked date, rollover policy, next year draft) and recent audited changes.

## Data and permissions

`fiscal:manage`; closing a period blocks postings dated in it; corrections become reversals in the next open period; variant cannot change once a year has postings.

## States

| State                              | Behaviour                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| Close period dialog (not exported) | lists blockers (unmatched actuals, unsigned tie-outs) and needs a typed confirmation |
| Reopen (not exported)              | FC plus FA, reason code, audited                                                     |
| New year draft                     | periods generated from the variant for review                                        |

## Budget safety and audit

Locked uses a neutral tag with a lock icon (not the info tone reserved for frozen budgets). Every close and reopen is audited.

## Responsive and accessibility

Mobile read-only list of periods with status. Status tags use icon plus text.

## Related screens and navigation

107, 080c, 080e, 087b year-end run.

## Assumptions and open questions

- One calendar for all entities (as designed) or per entity? The plan allows variants per tenant; assumed one per company for now.

## Implementation

Built in Phase 3 at `/finance/periods`. Deviations from this design: `evidence/phase-03/visual-qa/design-parity/design-parity.md`.
