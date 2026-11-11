| Endpoint                                                           | Role               | Requests | Req/s | p50 ms | p90 ms | p97.5 ms | p99 ms | Non-2xx |
| ------------------------------------------------------------------ | ------------------ | -------- | ----- | ------ | ------ | -------- | ------ | ------- |
| Budget list (`/api/budgets`)                                       | finance-controller | 10851    | 723.4 | 13     | 16     | 21       | 25     | 0       |
| Budget summary (`/api/budgets/summary`)                            | finance-controller | 11376    | 758.4 | 12     | 15     | 18       | 20     | 0       |
| Approval inbox (`/api/approvals/inbox`)                            | department-head    | 14833    | 988.9 | 9      | 11     | 14       | 15     | 0       |
| Budget health dashboard (`/api/dashboards/health`)                 | finance-controller | 8311     | 554.1 | 17     | 20     | 24       | 26     | 0       |
| Report run: budget vs actual (`/api/reports/budget-vs-actual/run`) | finance-controller | 11487    | 765.8 | 12     | 14     | 17       | 18     | 0       |
| Events (`/api/events`)                                             | finance-controller | 6612     | 440.8 | 21     | 27     | 31       | 34     | 0       |
| Actuals (`/api/actuals`)                                           | finance-controller | 11063    | 737.5 | 13     | 16     | 19       | 22     | 0       |
| Audit log (`/api/audit/events`)                                    | auditor            | 11365    | 757.7 | 12     | 16     | 20       | 23     | 0       |
| Audit hash-chain verification (`/api/audit/verification`)          | auditor            | 8107     | 540.5 | 18     | 21     | 25       | 28     | 0       |
