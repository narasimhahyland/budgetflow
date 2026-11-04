# 032 Budget calendar and fiscal-period view

Status: proposed - awaiting user review. Light theme only. UX Phase 4-7 track, batch 1. Build phase P4.

## Design

| State   | Image                                                           | Stitch screen                      |
| ------- | --------------------------------------------------------------- | ---------------------------------- |
| default | `design/stitch/032-budget-calendar/default--desktop--light.png` | `041fd15b9d9f4137a416f3ccb4956fe8` |

## Purpose

See phased allotments per fiscal period, which periods are open or closed, and upcoming events on one timeline.

## Roles

CEO, Finance Admin, owners within scope; FC, AUD, AN read.

## Entry points

Budgets > Calendar; 021 "Phasing"; 108 fiscal calendar links.

## Content and actions

Month / Quarter toggle. Period status strip (Closed with lock, Soft-closed warning, Open success, current period outlined). Grid: budgets as rows, periods as columns, allotments right-aligned; closed periods greyed; current period highlighted; event markers on the budget rows. Right card for the selected period: allotted, committed, actual, available in period, closing date, "Edit phasing" (032a). Note: unused allotment rolls into the next open period (per budget setting).

## Data and permissions

Periods and statuses from the fiscal calendar engine (P3, 108); allotments from phasing (032a). Read-only here.

## States

No phasing set: rows show "Even (default)" allotments with an info tag. Loading skeleton; error banner.

## Budget safety and audit

Closed and locked periods never accept postings (invariant); the grid shows them locked. Read-only.

## Responsive and accessibility

Tablet: quarter view by default; mobile: one period at a time with a period picker. Grid is a table with period headers; markers have text labels.

## Related screens and navigation

032a, 108, 021, 046 (event markers).

## Assumptions and open questions

- Should event markers show only approved events? Assumed approved and in progress.
