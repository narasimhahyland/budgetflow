# 029 Revise budget (increase request)

Status: proposed - awaiting user review. Light theme only. UX Phase 4-7 track, batch 1. Build phase P4. Dialog over 021 budget details.

## Design

| State            | Image                                                                  | Stitch screen                      |
| ---------------- | ---------------------------------------------------------------------- | ---------------------------------- |
| increase-request | `design/stitch/029-revise-budget/increase-request--desktop--light.png` | `9f1caca0d4d446a8b6d2be9070232974` |

## Purpose

Ask for more authorized budget, choosing where it comes from, and see who approves before submitting. Decreases use 026 reduce budget; revisions always create a new immutable version.

## Roles

Budget owner requests; parent owner (or CEO / Finance Admin above thresholds) approves within DoA.

## Entry points

021 header "Request increase"; 024 blocked state "Request an increase"; threshold alert email.

## Content and actions

Two-column dialog. Left: current authorized (read-only), New authorized (USD) with the increase amount, "Funded from" radios (parent's available, contingency reserve 029a, new money needing a plan revision), Reason code, Reason, attach file, warning line when the budget is above a threshold. Right "Approval route": steps with approver, DoA limit and check, skipped steps greyed with the reason; note that approval creates the next version and the increase cannot be spent before. Footer: Cancel, Submit increase request.

## Data and permissions

`budget:request-increase`. Route built by the rules engine and DoA table (P5 router; P4 uses parent owner, then Finance above USD 10,000.00). Funding source availability re-checked at approval.

## States

Validation (new amount above current, reason required). Funding source short: error on that radio "Parent has USD 1,200.00 available". Pending: budget header shows "Increase pending USD 2,500.00" (warning tone); pending increases never count as available. Approved: new version (030), snackbar.

## Budget safety and audit

Approved increase posts an allocation from the chosen source (or a plan revision for new money). Audit entries for the request, each decision and the resulting version.

## Responsive and accessibility

Mobile: single column, route below the form. Route steps are an ordered list.

## Related screens and navigation

021, 024, 026, 029a, 030, 057 (event additional funds), 059.

## Assumptions and open questions

- "New money" requires Finance Admin plus CEO; confirm thresholds.
