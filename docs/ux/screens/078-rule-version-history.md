# 078 Rule version history

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 7 batch B. Build phase P7. Rules and policies > a rule > Version history.

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Planned exports: `design/stitch/078-rule-version-history/default--desktop--light.png` (versions with a diff).

## Purpose

Show every version of a rule (or route, threshold table, limit set or DoA matrix) with who published it, when it applied, what changed, and which decisions it produced, and allow going back by publishing an older version as a new one.

## Roles

Finance Admin (restore), Finance Controller, Auditor, Organization Admin (read).

## Entry points

069 "Version history"; 067 row action; 090 decision rows ("R-12 v3"); 088 audit entries.

## Content and actions

Left: version timeline (v4 Draft by Marco Bianchi; v3 Active from 1 Sep 2026, published by Marco Bianchi, approved by Priya Raman; v2 1 Mar-31 Aug 2026; v1 1 Jan-28 Feb 2026), each with effective dates, publisher and decision count. Right: compare two versions (selectors), diff in plain English and as condition rows (added success, removed important, changed warning old -> new): "Remaining after request below 10% (was 15%)"; "Adds Finance Controller above USD 5,000.00 (was USD 10,000.00)". Below: decisions made with the selected version (count, link to 090 filtered).

Actions: "Restore as new draft" (copies the selected version into a new draft v5; nothing changes until published), Export (PDF for audit).

## Data and permissions

Immutable versions with effective periods; decisions store the version ids that produced them. `rule:read`; restore needs `rule:edit`.

## States

| State           | Behaviour                                                   |
| --------------- | ----------------------------------------------------------- |
| Default         | as above                                                    |
| One version     | "Only one version so far"; compare disabled with the reason |
| Restore confirm | dialog: "Creates draft v5 from v2"                          |
| Loading / error | skeleton timeline; error banner                             |

## Budget safety and audit

History is read-only; restoring creates a draft, never reactivates silently. Exports are audited.

## Responsive and accessibility

Tablet: timeline above the diff. Mobile: timeline only. Diff markers carry text ("Added", "Removed", "Changed").

## Related screens and navigation

069, 067, 070, 070a, 071a, 077, 090, 088.

## Assumptions and open questions

- None beyond the design review.
