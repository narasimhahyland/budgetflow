| Endpoint                                                           | Role               | Requests | Req/s | p50 ms | p90 ms | p97.5 ms | p99 ms | Non-2xx |
| ------------------------------------------------------------------ | ------------------ | -------- | ----- | ------ | ------ | -------- | ------ | ------- |
| Budget list (`/api/budgets`)                                       | finance-controller | 9510     | 634   | 15     | 19     | 23       | 29     | 0       |
| Budget summary (`/api/budgets/summary`)                            | finance-controller | 9220     | 614.7 | 15     | 20     | 25       | 30     | 0       |
| Approval inbox (`/api/approvals/inbox`)                            | department-head    | 11439    | 762.6 | 12     | 16     | 19       | 23     | 0       |
| Budget health dashboard (`/api/dashboards/health`)                 | finance-controller | 2647     | 176.5 | 54     | 65     | 84       | 99     | 0       |
| Report run: budget vs actual (`/api/reports/budget-vs-actual/run`) | finance-controller | 3028     | 201.9 | 47     | 57     | 70       | 81     | 0       |
| Events (`/api/events`)                                             | finance-controller | 5958     | 397.2 | 24     | 30     | 35       | 38     | 0       |
| Actuals (`/api/actuals`)                                           | finance-controller | 7574     | 504.9 | 18     | 24     | 31       | 34     | 0       |
| Audit log (`/api/audit/events`)                                    | auditor            | 10448    | 696.5 | 13     | 17     | 20       | 24     | 0       |
| Audit hash-chain verification (`/api/audit/verification`)          | auditor            | 5045     | 336.3 | 28     | 35     | 41       | 49     | 0       |
