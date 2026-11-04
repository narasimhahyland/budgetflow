# 029a Contingency reserve release

Status: proposed - awaiting user review. Light theme only. UX Phase 4-7 track, batch 1. Build phase P4.

## Design

| State                     | Image                                                                        | Stitch screen                      |
| ------------------------- | ---------------------------------------------------------------------------- | ---------------------------------- |
| default (decision drawer) | `design/stitch/029a-contingency-reserve-release/default--desktop--light.png` | `28f76453b5544c969fbc1008c0679e4c` |

## Purpose

Hold a central contingency reserve and release from it only through an approved request.

## Roles

Finance Admin owns the reserve; owners request releases (029 "Funded from: contingency reserve"); CEO approves above USD 1,000.00, Finance Admin below, within DoA.

## Entry points

019 row "Corporate contingency reserve"; 029 funding option; approval inbox (059).

## Content and actions

Header with "Contingency" tag and owner. KPI cards: reserve, released, pending release (warning), available with a stacked bar. Table "Release requests" with status tabs. Right drawer for the selected request: amount and target, impact on reserve and target available, policy line (CEO above USD 1,000.00), DoA check, reason code and comment, Approve release, Approve part, Reject.

## Data and permissions

Reserve is a budget of type contingency. Release requests pre-encumber the reserve (pending reduces available); approval posts an allocation from the reserve to the target. `contingency:release` decisions within DoA; no self-approval.

## States

Empty: "No release requests" with an explanation of how owners request. Reserve exhausted: requests above available are blocked at submit. Approve part: amount field with the remainder released back. Reject: reason code and text required.

## Budget safety and audit

Pending releases are held, never double-counted. Each decision audited; approver cannot be the requester or the target budget's owner.

## Responsive and accessibility

Mobile: drawer becomes a full page. KPI bar has a text alternative.

## Related screens and navigation

029, 059, 061, 019, 088.

## Assumptions and open questions

- Is the reserve inside the program total or outside it? Assumed outside (separate root under Hyland).
- Stitch added a policy code ("POL-FIN-08") and reason code label; ignore invented codes.
