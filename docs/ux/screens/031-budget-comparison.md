# 031 Budget comparison view

Status: proposed - awaiting user review. Light theme only. UX Phase 4-7 track, batch 1. Build phase P4.

## Design

| State   | Image                                                             | Stitch screen                      |
| ------- | ----------------------------------------------------------------- | ---------------------------------- |
| default | `design/stitch/031-budget-comparison/default--desktop--light.png` | `bce493e9105747b5a59271325826990e` |

## Purpose

Compare two versions, two fiscal years or two budgets side by side and see where money moved.

## Roles

CEO, Finance Admin; owners within scope; FC, AUD, AN read.

## Entry points

023 "Compare versions"; 030 "Compare versions"; 011 drill-down.

## Content and actions

Header with Export menu. Tabs: Versions, Fiscal years, Budgets. Two selects with "vs"; toggle "Only show differences". Tree table: Budget, left (USD), right (USD), Change (signed, arrow), Change %, Why (reason or status tag). Decreases in important tone, increases in success tone, always with sign and arrow. Right summary: total authorized (unchanged or delta), budgets changed, moved between budgets, link to 089 allocation history.

## Data and permissions

Read-only; scope-filtered. Fiscal-year comparison maps budgets by roll-forward lineage (023a); unmatched budgets appear as added or removed rows.

## States

Nothing to compare (same selection): inline message. No differences with the toggle on: empty state "These versions match". Loading skeleton; error banner.

## Budget safety and audit

Read-only; exports audited. Set-to-zero rows keep their tag so a -100% change is never mistaken for a deletion.

## Responsive and accessibility

Tablet: Why column collapses into a row expander. Change cells carry sign and arrow, not color alone.

## Related screens and navigation

030, 089, 023, 023a.

## Assumptions and open questions

- Known render issue: Stitch drew a light sidebar with invented navigation items instead of the Hyland shell (000a); the content area is the design, the shell is 000a.
