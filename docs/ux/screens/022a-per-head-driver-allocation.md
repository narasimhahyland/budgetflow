# 022a Per-head driver allocation

Status: proposed - awaiting user review. Light theme only. UX core set (todo `ux-core-screens`). Review-added screen (Group 3).

Revised 2026-11-04 to the single-company decisions: Hyland only (static label, no tenant or organization switcher, no reporting-currency chip), budgets in USD (transactions may show INR or EUR with the USD amount), Export instead of Share. Per-head rate USD 15.00 per head per month.

## Design

| State                     | Image                                                                       | Stitch screen                      |
| ------------------------- | --------------------------------------------------------------------------- | ---------------------------------- |
| default (true-up pending) | `design/stitch/022a-per-head-driver-allocation/default--desktop--light.png` | `5eb3b463f414495289c6f113f30030ea` |

## Purpose

Allocate a budget as rate x eligible headcount from the HR import, show exactly how the eligible count was derived (exclusions, proration), and turn a headcount change into a reviewable true-up.

## Roles

Primary: Regional Manager, Location Manager (People Ops). Secondary: Finance Controller; Read-only Analyst (read only).

## Entry points

Allocation workspace (022) driver cell "Per head"; budget details (021) of a per-head budget; notification "New headcount snapshot".

## Content and actions

- Driver card: rate per eligible employee per period, basis (snapshot date and source), eligibility chips (included and excluded types), proration rule.
- Calculation table per location: headcount, excluded with breakdown, joiners and leavers prorated, eligible, amount in budget currency with reporting equivalent; formula line.
- Comparison: current allocation, calculated amount, true-up delta tag; DoA check.
- Actions: View headcount import (022c), Apply true-up (submits an allocation change).

## Data and permissions

HR headcount snapshot (from 022c), eligibility and proration rules, plan rate; `budget:allocate` on the parent; true-ups above the DoA limit go to approval.

## States

Loading; no snapshot yet (empty state with Import headcount); new snapshot available (info banner, as in the image); true-up pending approval (warning tag); snapshot import failed (error banner linking 022c); success snackbar after applying.

## Budget safety and audit

A true-up is an allocation change checked against parent available like any other; each applied true-up is one audit entry with the snapshot id and the formula.

## Responsive and accessibility

Tablet: comparison panel under the table. Mobile: read-only summary. The formula is also given as text for screen readers.

## Related screens and navigation

022 allocation workspace, 022c HR headcount import, 021 budget details. Breadcrumb Home / Budgets / India Region / Hyderabad Events / Per-head.

## Open questions

- Proration granularity: monthly (as designed) or daily?
- Should eligible headcount be rounded (521) or kept fractional (521.3) in the amount?
