# 071a Policy templates and threshold table

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 7 batch A. Build phase P7. Rules and policies > Templates and thresholds.

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Planned exports: `design/stitch/071a-policy-templates-thresholds/default--desktop--light.png` (threshold table), `templates--desktop--light.png`.

## Purpose

Let finance express the common policy without building rules by hand: an approval threshold table by amount band (plus a remaining-budget threshold) and a library of policy templates with parameters, each generating ordinary versioned rules.

## Roles

Finance Admin (edit and publish), Finance Controller and Auditor (read).

## Entry points

066 tabs and empty state; 068 "From a policy template" and "From the threshold table".

## Content and actions

Tab "Threshold table" (default): one table per request family (Events and engagement selected; also Gifts and entertainment, Contributions). Rows are amount bands in USD with the approvers added:

| Band (USD)            | Approvers added                 |
| --------------------- | ------------------------------- |
| up to 500.00          | Budget owner                    |
| 500.01 to 5,000.00    | Budget owner, then parent owner |
| 5,000.01 to 25,000.00 | plus Finance Controller         |
| above 25,000.00       | plus CEO                        |

Plus "Remaining budget after the request below 10%: add the parent owner". Band edges are editable inline; gaps or overlaps are flagged. Footer: "Generates rules R-12 (v4 draft)"; Simulate (077), Publish. Values are fictional samples.

Tab "Templates": cards with name, what it does, parameters and "Used by" rules: Per-head engagement limits; Festival and celebrations; Offsite; Gifts and entertainment cap; Alcohol at events; Blocked and preferred vendors; Split and duplicate request detection (same requester, vendor or event within 7 days, amounts together above a band edge); Post-spend re-check. Actions: Use template (068), View rules created from it.

## Data and permissions

Templates are parameterised rule definitions shipped with the product; the threshold table compiles to one rule per family (`Require approval` actions with conditions on amount in reporting currency and remaining percent). Publishing follows 069 (immutable versions, effective dates). `rule:edit`, `rule:publish`.

## States

| State      | Behaviour                                                                                |
| ---------- | ---------------------------------------------------------------------------------------- |
| Default    | threshold table                                                                          |
| Validation | gap ("No band covers USD 5,000.01 to 5,000.99") or overlap: error rows; Publish disabled |
| Changed    | unsaved-changes bar; "3 bands changed"                                                   |
| Templates  | card grid                                                                                |
| Read only  | Finance Controller and Auditor                                                           |

## Budget safety and audit

Bands compare in USD at the locked plan rate for local-currency requests. Every publish is an audited rule version; decisions name the band that applied.

## Responsive and accessibility

Tablet fine; mobile read-only. The band table is a real table with header cells; inline edit fields have labels.

## Related screens and navigation

066, 068, 069, 070, 072a, 073a, 074a, 077.

## Assumptions and open questions

- Band values are fictional; production thresholds are a Hyland finance decision.
