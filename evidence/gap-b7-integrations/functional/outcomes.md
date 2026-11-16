# Gap B7 functional outcomes

Stack `bf-gap-b7` (local Compose, deterministic seed, API clock pinned to the visual `freezeTime`),
mock providers from `infra/mock-providers/server.mjs`. Roles: integration-admin, finance-admin,
finance-admin-2, ceo, budget-owner, department-head, event-organizer, employee, analyst, auditor
(audit reads).

Commands:

```bash
npx playwright test -c apps/api-e2e/playwright.config.ts src/integrations
npx playwright test -c apps/web-e2e/playwright.config.ts src/integrations/applied-imports.spec.ts --project=desktop
npm run e2e:visual -- --grep "094a-adaptive-planning|060-request-details|065-rejected|094-erp|061-"
```

## API scenarios

| Scenario                                                                                            | Expected                                                                                                                                                                          | Actual      | Result |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ |
| Plan import with an unmapped level, a three-decimal amount and a duplicate level                    | 422 `PLAN_IMPORT_BLOCKED`, one error per row, no plan version, a failed run with 3 failed                                                                                         | as expected | pass   |
| Plan in EUR; plan for FY2031                                                                        | refused as a whole with the reason                                                                                                                                                | as expected | pass   |
| New-year plan (FY2027)                                                                              | preview unblocked, no floors; one Draft version with EX-2027 and EX-RESERVE-2027 at the plan amounts; one `plan_version.imported` audit entry naming the external version and run | as expected | pass   |
| Replay with the same key; same version with a new key                                               | `Idempotent-Replayed`, same version; 409 `IMPORT_ALREADY_UPLOADED`                                                                                                                | as expected | pass   |
| Apply before approval; approve (second Finance Admin, CEO for new money); apply                     | 409 first; roots created or adjusted with authorized equal to the plan amounts                                                                                                    | as expected | pass   |
| FY2026 plan effective in closed September 2026                                                      | `late: true`, posts in the open period; run summary and audit name it; roots unchanged by the draft                                                                               | as expected | pass   |
| FY2026 plan cutting a root below its floor                                                          | 422 `PLAN_IMPORT_BLOCKED` "cannot drop below"                                                                                                                                     | as expected | pass   |
| Integration Admin imports a plan                                                                    | 403                                                                                                                                                                               | 403         | pass   |
| ERPNext suppliers, first run                                                                        | read 6, applied 2 (1 created as Unknown, 1 linked by name), 1 duplicate, 3 refused with reasons in the retry queue; audit `vendor.imported` / `vendor.linked`                     | as expected | pass   |
| ERPNext suppliers, second run                                                                       | applied 0, 3 duplicates, 3 refused                                                                                                                                                | as expected | pass   |
| Outlook responses on a capacity-1 event with waitlist                                               | 3 RSVPs changed (Going, Waitlisted, Can't go with promotion), 1 stale answer unchanged, 2 refused; 3 audit entries with channel `outlook`                                         | as expected | pass   |
| Same responses again                                                                                | applied 0, 4 unchanged, no new audit entries                                                                                                                                      | as expected | pass   |
| A newer answer after RSVPs close                                                                    | run failed, refused "RSVPs for … are closed"                                                                                                                                      | as expected | pass   |
| Workday budget check: off, malformed setting, ERPNext setting                                       | none; 422; 422                                                                                                                                                                    | as expected | pass   |
| Warn mode, USD 3,000 against USD 2,500 left                                                         | failed, not blocking, remaining USD 2,500.00                                                                                                                                      | as expected | pass   |
| Block mode approve                                                                                  | 409 `EXTERNAL_BUDGET_CHECK_FAILED`, no approval audit                                                                                                                             | as expected | pass   |
| USD 30 request                                                                                      | passed; approval audit records `Workday Financials: passed`                                                                                                                       | as expected | pass   |
| Workday unreachable in Block mode                                                                   | unavailable, approval refused                                                                                                                                                     | as expected | pass   |
| Hand-off before approval                                                                            | `not_approved`; 422 `EXPENSE_HANDOFF_NOT_AVAILABLE`                                                                                                                               | as expected | pass   |
| Hand-off after approval                                                                             | ready; fields from the request, expense type "Meals - team"; approver `not_allowed`; created once; replay; 409 `EXPENSE_HANDOFF_EXISTS`; one audit entry                          | as expected | pass   |
| Concur reports the draft Paid at USD 56.00                                                          | status paid, claimed 5,600, difference −149, history; second sync applies nothing; one audit entry                                                                                | as expected | pass   |
| Concur refuses the draft                                                                            | 422 `EXPENSE_TOOL_REJECTED`, nothing recorded, still ready                                                                                                                        | as expected | pass   |
| Odoo, Workday Financials, NetSuite, Brex, Coupa (invoices and orders), Workday HCM, Google Calendar | connect in Mock mode, test passes, inbound run through the common path, a repeat applies nothing                                                                                  | as expected | pass   |

## Journeys

| Journey                                                                                 | Expected                                                                                                     | Result |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------ |
| Finance Admin previews and imports the Adaptive plan on the Plan tab                    | rows shown, "Draft plan version … created", button disabled, API shows one draft                             | pass   |
| Requester creates the Concur draft from the request page; approver sees the status only | fields listed before sending, status "Draft created in Concur" with the draft id, no Create for the approver | pass   |
| Pending request                                                                         | no Expense card                                                                                              | pass   |

The gate runs are summarised in the evidence README.
