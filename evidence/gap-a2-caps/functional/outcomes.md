# Gap A2 functional outcomes

Stack: this worktree's Compose stack, `scripts/stack.sh up && scripts/stack.sh reset` (deterministic seed).
Commands:

```bash
npx playwright test -c apps/api-e2e/playwright.config.ts src/rules/caps.spec.ts
npx playwright test -c apps/web-e2e/playwright.config.ts src/rules/caps.spec.ts --project=desktop
```

Roles: `budget-owner` (requester, Jordan), `department-head` (approver, Lena), `finance-admin` (policy).
Amounts are USD minor units. The cap is USD 300.00 (30,000) and the gift cap USD 150.00 (15,000).
Each scenario names freshly created fictional recipients.

| Scenario                                                                                              | Expected                                                                                                                                                                 | Actual      | Result |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | ------ |
| One request exactly at the cap (30,000)                                                               | 201, warn by R-32 v1 (decides), cap left USD 0.00                                                                                                                        | as expected | pass   |
| One minor unit above (30,001)                                                                         | 409 `POLICY_BLOCKED`, R-31 v1, remaining −1, no request left behind                                                                                                      | as expected | pass   |
| At the cap across requests (20,000 + 10,000)                                                          | 201, warn, cap left USD 0.00                                                                                                                                             | as expected | pass   |
| One unit past it across requests (+1)                                                                 | 409 `POLICY_BLOCKED` R-31                                                                                                                                                | as expected | pass   |
| Below 80% (23,999)                                                                                    | 201, R-32 does not match, cap left USD 60.01                                                                                                                             | as expected | pass   |
| Exactly 80% (24,000)                                                                                  | 201, warn by R-32                                                                                                                                                        | as expected | pass   |
| Split: two employees at 2 × cap; one employee and one guest at 2 × cap + 2                            | first allowed; second refused at 30,001; at 2 × cap allowed                                                                                                              | as expected | pass   |
| Two submissions for one recipient at the same time, each at the cap                                   | exactly one 201 and one 409 (repeated 5 times)                                                                                                                           | as expected | pass   |
| Withdraw a request at the cap                                                                         | the cap is free again (usage read from the ledger)                                                                                                                       | as expected | pass   |
| Travel (not a cap category) at 3 × cap                                                                | allowed, not counted towards the cap                                                                                                                                     | as expected | pass   |
| Approval after the cap was lowered to 20,000                                                          | 409 `POLICY_BLOCKED` at `approve`, request stays pending; after restoring, approval passes and two decisions are recorded (submit, approve) with R-32 v1 and their facts | as expected | pass   |
| Counter-offer accepted after another lunch used the room                                              | 409 `POLICY_BLOCKED` at `approve`, request stays `changes_requested`                                                                                                     | as expected | pass   |
| Event funding naming recipients                                                                       | 422 on `benefitRecipientIds`                                                                                                                                             | as expected | pass   |
| Gift exactly at the annual gift cap (15,000)                                                          | 201, gift cap left USD 0.00, value per recipient USD 150.00, R-24 still matches                                                                                          | as expected | pass   |
| Gift one minor unit above (15,001)                                                                    | 409 `POLICY_BLOCKED` R-33 v1, remaining −1                                                                                                                               | as expected | pass   |
| Gifts across the year (7,500 + 7,500 + 1)                                                             | 409 R-33                                                                                                                                                                 | as expected | pass   |
| Intercompany, alcohol, requester's recent total; unknown recipient                                    | crosses legal entities yes, alcohol USD 20.00, total includes this request; unknown recipient 422                                                                        | as expected | pass   |
| Journey: the request page shows the policy check, then Finance's nearest-cap list shows the recipient | outcome, R-32 explanation, cap facts (USD 50.00 left, 83%), matched rules with versions; the list row shows USD 250.00 used and USD 50.00 left                           | as expected | pass   |

The first full run of the functional gate found one defect in an intermediate version, which was fixed
and re-run. After the review, the consumption read was narrowed to the request's own commitments.
At submission that dropped the request's own pre-encumbrance, because the request row does not yet
carry its commitment id. Lines are now matched through `commitments.request_id`.
