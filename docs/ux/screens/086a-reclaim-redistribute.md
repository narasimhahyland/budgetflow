# 086a Reclaim and redistribute unused budget

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 11 batch. Build phase P11. Finance > Year-end > Reclaim campaigns (`/finance/reclaim`, campaign `/finance/reclaim/:campaignId`); owners answer at `/reclaim/:noticeId`.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the reduce and transfer dialogs of 026 and 025. Planned Stitch states, to be generated in a later session:

| State                         | Planned image                                                         |
| ----------------------------- | --------------------------------------------------------------------- |
| campaign with owner responses | `design/stitch/086a-reclaim-redistribute/default--desktop--light.png` |
| new campaign criteria         | `new-campaign--desktop--light.png`                                    |
| owner notice and response     | `owner-response--mobile--light.png`                                   |
| redistribute released money   | `redistribute--desktop--light.png`                                    |
| confirm with impact preview   | `confirm-dialog--desktop--light.png`                                  |

## Purpose

Turn money that will go unused into money that gets used: find budgets forecast to end the year with a lot left, ask their owners to release it or explain their plans, and move what is released to budgets that need it within the same legal entity, through audited reductions and allocations, before it lapses.

## Roles

Finance Admin (runs campaigns, redistributes); budget owners (respond for their budgets); parent budget owners (approve reclaims from budgets whose owner did not respond); CEO (read, can start campaigns); Finance Controller and Auditor (read).

## Entry points

086 unused report "Add to reclaim campaign"; 87b year-end setup "Reclaim before year end"; Finance > Year-end; owners: task in 123, digest, email, Slack or Teams "Respond by 13 Nov".

## Content and actions

Campaigns list: name, started, respond by, candidates, released, redistributed, status (Draft, Collecting responses, Redistributing, Completed).

New campaign: name ("Q4 FY2026 reclaim"); criteria: forecast unused above 20% of authorized and above USD 1,000.00, fewer than 90 days left, exclude budgets on "Carry full" or "Carry with approval" with a pending carry request, exclude frozen and set-to-zero budgets; response window (5 business days, respond by 13 Nov); proposed amount rule ("forecast amount that would lapse"); preview of candidates; Send notices.

Campaign page (sample, started 6 Nov):

| Budget          | Owner          | Forecast unused | Proposed | Response                                                                         | Released |
| --------------- | -------------- | --------------- | -------- | -------------------------------------------------------------------------------- | -------- |
| India Wellbeing | Meera Iyer     | 4,200.00        | 4,200.00 | Release part: keep USD 1,200.00 for the Wellbeing week (1-5 Dec, quote selected) | 3,000.00 |
| US Wellbeing    | Jordan Lee     | 3,000.00        | 3,000.00 | Release all                                                                      | 3,000.00 |
| Europe Events   | Sophie Laurent | 1,600.00        | 1,600.00 | No response yet (due 13 Nov)                                                     | -        |

- Released pool by legal entity: IN01 USD 3,000.00; US01 USD 3,000.00.
- After the deadline, no-response rows show "Reclaim without response" which sends the proposal to the parent owner (Sophie Laurent is also the Europe Region owner, so it goes to Daniel Brooks) for approval.

Owner notice (phone-friendly page): budget, available under its rules, forecast unused, proposed amount, "Why: USD 4,200.00 is forecast to lapse on 31 Dec under Lapse to parent"; choices: Release USD 4,200.00, Release a different amount, Keep it (reason and plan required, for example a committed event or selected quote); Submit.

Redistribute (per entity pool): candidate targets with their need (forecast over, pace ahead, pending additional-fund or over-budget requests, funding gaps on events) and a proposed allocation; samples IN01: Bengaluru Events +USD 1,500.00 (Diwali per-head over limit), Hyderabad Events +USD 1,000.00 (townhall funding gap USD 1,800.00), remainder USD 500.00 to India Region; US01: Westlake Team Activities +USD 2,000.00 (forecast USD 1,800.00 over), remainder USD 1,000.00 to United States Region. Pending requests that the new money covers are linked so the owner can resubmit or approve them.

Confirm dialog: reductions (source, amount, destination "Reallocation"), allocations (target, amount), remainders to parents, floor check per source (cannot go below committed + actual + children), reason code "Year-end reclaim" and typed reason, notifications, Confirm.

## Data and permissions

New P11 `close.ts` data: campaigns (criteria, window, status), notices (budget, proposed, response, kept amount, reason, responded by), and redistribution plans. Execution posts through the existing reduce and allocate commands (P4) as reductions with destination "reallocation" and allocations, in one idempotent command per entity with ordered locks; floors use `validateReduction`. Finance Admin needs `budget.control` at tenant scope; owners answer with `budget.control` on their budget; reclaims without a response need the parent owner's approval (`budget.control` on the parent). Redistribution targets must share the source's legal entity; cross-entity money returns to the common parent instead.

## States

| State           | Behaviour                                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| No candidates   | success empty state "No budget meets the criteria"                                                                                     |
| Collecting      | as above; reminders 2 days and 1 day before the deadline                                                                               |
| Owner keeps     | row shows the reason and plan; nothing reclaimed                                                                                       |
| No response     | after the deadline: "Reclaim without response" sends to the parent owner; never automatic                                              |
| Below floor     | proposed amount above what the floor allows: error line "At most USD 2,650.00 can be reclaimed (floor: committed + actual + children)" |
| Redistribute    | as above; Confirm disabled until each pool is fully assigned (targets or parent remainder)                                             |
| Confirm dialog  | as above                                                                                                                               |
| Completed       | success banner with journals per entity; owners notified                                                                               |
| Loading / error | `sat-ghost`; failed execution posts nothing for that entity and shows the API detail                                                   |

## Budget safety and audit

Reclaims are reductions with a destination and reason code, floored at committed + actual + children, never edits; pending requests are not counted in the floor but are listed (as in 026). Redistribution is allocation within the same entity. Every notice, response, approval and posting is audited; the campaign keeps the full trail.

## Responsive and accessibility

Campaign and redistribute pages: desktop and tablet. Owner notice: phone-first. Choices are a radio group with amounts in their labels; required reasons are announced.

## Satori components

`sat-header-bar`, `mat-table` with `satTableWithRowStates` and `sat-selection-bar`, `sat-status-tag` (response states), `sat-banner`, `sat-rich-tooltip` (floor and need explanations), `satImportantButton` (Confirm), `sat-empty-state`, `sat-ghost`; Angular Material dialog (confirm with reason code and typed reason), radio group, form fields, stepper (new campaign), snackbar; `bf-money`.

## Related screens and navigation

086 unused and expired, 87b year-end run, 87c rollover policies, 026 reduce, 024 allocate, 025 transfer, 057 additional funds, 058 over-budget, 013 health, 123 tasks.

## Decisions taken

- Reclaim is a campaign with a 5-business-day owner response window; nothing is reclaimed automatically. Recommended because owners often have committed plans that the forecast has not caught up with.
- Owners can release all, part, or keep the money with a reason and plan; reclaiming without a response needs the parent owner's approval.
- Redistribution stays within the same legal entity; cross-entity money returns to the common parent, so no intercompany effect is created by a reallocation.
- Released money first covers pending requests and funding gaps the campaign lists, then any remainder returns to the parent.
