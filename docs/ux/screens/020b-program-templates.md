# 020b Program templates

Status: proposed - awaiting user review. Light theme only. UX Phase 4-7 track, batch 1. Build phase P4.

## Design

| State   | Image                                                              | Stitch screen                      |
| ------- | ------------------------------------------------------------------ | ---------------------------------- |
| default | `design/stitch/020b-program-templates/default--desktop--light.png` | `aca9b85e799040048dfa58a5976f7df9` |

## Purpose

Reusable setups (driver, categories, controls, limits, phasing, rollover) so new budgets start consistent: per-head engagement, festival, offsite, wellbeing, recognition.

## Roles

Finance Admin and Organization Admin edit; owners pick a template in 020 create budget.

## Entry points

Budgets > Program templates; 020 "Start from template".

## Content and actions

Two panes. Left: template cards with short line and "Used by N budgets". Right: detail of the selected template with Duplicate, Edit, Apply to budgets. Sections: Allocation driver (per head, USD 15.00 per eligible employee per month, eligibility excludes contractors and interns, proration by days, true-up on each HR refresh), Categories, Controls (hard block, 0% tolerance, alerts 50/80/100%), Limits (USD 40.00 per person per event; alcohol not allowed), Phasing, Rollover. Note: changing a template never changes budgets already created from it.

## Data and permissions

`template:manage`. Templates are versioned; budgets store the template version they came from. Apply to budgets opens a selection of Draft budgets only.

## States

Empty: "No templates yet" with New template. Edit: same sections as form fields with validation (rate > 0, thresholds ascending). Loading and error as in 019.

## Budget safety and audit

Templates never move money. Each template version and each apply action is audited.

## Responsive and accessibility

Tablet and mobile: list first, detail as a full page. Cards are radio-style options with visible focus.

## Related screens and navigation

020 create budget, 022a per-head driver allocation, 021 controls drawer.

## Assumptions and open questions

- Decided 2026-11-05: the per-head rate is per month (USD 15.00 per eligible employee, prorated), as in 022a.
- Stitch added helper lines ("unencumbered balance repatriation"); the section labels are the design.
