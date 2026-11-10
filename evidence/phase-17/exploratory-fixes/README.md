# Phase 17: exploratory findings, fixed

The seven findings from the Phase 17 exploratory pass (`evidence/phase-17/exploratory/README.md` on
`feat/p17-quality`, PR #101), each fixed and proven on this worktree's Compose stack with the
deterministic seed.

| #   | Finding                                                                       | Fix                                                                                                                                                                                                                        | Proof                                                                                                        |
| --- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| F7  | Approval card's company-wide Available left out holds and children's spending | `libs/api/approvals/src/lib/budget-impact.ts` uses `companyAvailable` over the subtree in the reporting currency, the budget page's and dashboard's own calculation; contract description and the card's tooltip corrected | API: on a root with a pending child request the card shows 930.00, equal to the budget page (old: 980.00)    |
| F1  | My budgets told an owner they approve their own requests                      | `approverHint` says the next owner up approves when the reader owns the budget                                                                                                                                             | API: owner's root says so and names nobody; the child names its owner                                        |
| F3  | An exhausted hard-mode budget was offered as requestable                      | `requestableBudgets` marks it `INSUFFICIENT_AVAILABLE` with a plain reason (the domain's own spend check for one minor unit) and reports available under its rules                                                         | API: open at 380.00, marked once fully allocated; submitting agrees (409)                                    |
| F2  | Problem details said "minor units"                                            | `formatAmount` in `libs/domain` (integer arithmetic); over-allocation names formatted amounts; matching, year-end and forecast messages drop raw minor units                                                               | API: exact detail `Only USD 400.00 is available to allocate; USD 400.01 was asked for. …`; params unchanged  |
| F5  | Request increase stayed enabled on a frozen budget                            | Disabled on frozen and set-to-zero budgets, with a title and `aria-describedby` pointing at the banner text                                                                                                                | Journey `apps/web-e2e/src/budgets/blocked-actions.spec.ts`; [`f4f5-frozen-after.png`](f4f5-frozen-after.png) |
| F4  | Frozen status tag had the generic info icon                                   | `bf-budget-status` projects the `lock` icon for frozen                                                                                                                                                                     | [`f4f5-frozen-after.png`](f4f5-frozen-after.png)                                                             |
| F8  | "this budget not found"                                                       | All 17 feature `load-state` copies: "We could not find …", "We could not load …"                                                                                                                                           | Journey (heading `We could not find this budget`); [`f8-missing-after.png`](f8-missing-after.png)            |

The journey caught one bug in the F5 fix before it shipped: Satori's banner drops an `id` set on
`sat-banner-message`, so the button's description pointed at nothing. The id now sits on a span
inside the message.

## Checks

| Check                                 | Result                                                                                                                                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/gate.sh static --affected`   | all pass ([`gate-static.txt`](gate-static.txt))                                                                                                                                              |
| Full API suite                        | 604 passed; the one failure was this branch's new scenario setup (wrong role), fixed and re-run green ([`api-full-suite.txt`](api-full-suite.txt), [`api-scenarios.txt`](api-scenarios.txt)) |
| Full journey suite (`functional-e2e`) | 588 passed; the one failure was the new F5 journey catching the missing description, fixed; budget journeys re-run on all viewports: 40 passed ([`journeys.txt`](journeys.txt))              |
| Visual suite                          | 46 differences, all the known date-width drift the visual re-record track owns, none from this change (below)                                                                                |

## Visual differences are not from this change

The 46 failing states are the same screens the re-record classification on `fix/visual-rerecord`
lists as differing (date-dependent masked widths and the navigation rail). The screens this change
could move were re-run on a fresh seed and inspected: request details 060 differs only in the rail
and the masked header date ([`visual-060-approver-tablet-diff.png`](visual-060-approver-tablet-diff.png));
my requests 055 reflows because the masked "Updated" column changes width
([`visual-055-my-requests-desktop-diff.png`](visual-055-my-requests-desktop-diff.png)); budget health
013 is a dashboard this change does not touch. No baseline shows a frozen budget, a missing budget or
the impact card's company-wide figure in view, so no baseline needs updating for this change.
