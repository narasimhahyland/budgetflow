# Visual baseline headroom

Allowance: 0.002 of each image's pixels. Measured by comparing every state
with no allowance at all, so these are the differences the gate is currently tolerating.

54 state(s) match their baseline exactly. 29 differ.

## Using 70% or more of the allowance (5)

| State                                                 | Pixels | Allowance | Used  |                                               |
| ----------------------------------------------------- | ------ | --------- | ----- | --------------------------------------------- |
| 011a-ai-assistant-panel refused-out-of-scope › tablet | 40328  | 1855      | 2174% | over the allowance, the gate fails this state |
| 011a-ai-assistant-panel action-redirect › tablet      | 36330  | 1855      | 1959% | over the allowance, the gate fails this state |
| 113a-ai-settings-query-log query-log › tablet         | 109343 | 7628      | 1433% | over the allowance, the gate fails this state |
| 069a-policy-assistant is-allowed › tablet             | 2767   | 1855      | 149%  | over the allowance, the gate fails this state |
| 113a-ai-settings-query-log query-log › desktop        | 9904   | 12669     | 78%   | inside the allowance                          |

## Every state that differs (29)

| State                                                  | Pixels | Allowance | Used  |                                               |
| ------------------------------------------------------ | ------ | --------- | ----- | --------------------------------------------- |
| 011a-ai-assistant-panel refused-out-of-scope › tablet  | 40328  | 1855      | 2174% | over the allowance, the gate fails this state |
| 011a-ai-assistant-panel action-redirect › tablet       | 36330  | 1855      | 1959% | over the allowance, the gate fails this state |
| 113a-ai-settings-query-log query-log › tablet          | 109343 | 7628      | 1433% | over the allowance, the gate fails this state |
| 069a-policy-assistant is-allowed › tablet              | 2767   | 1855      | 149%  | over the allowance, the gate fails this state |
| 113a-ai-settings-query-log query-log › desktop         | 9904   | 12669     | 78%   | inside the allowance                          |
| 121a-receipt-quote-extraction check-fields › mobile    | 404    | 1386      | 29%   | inside the allowance                          |
| 011a-ai-assistant-panel refused-out-of-scope › mobile  | 217    | 754       | 29%   | inside the allowance                          |
| 069a-policy-assistant is-allowed › mobile              | 216    | 754       | 29%   | inside the allowance                          |
| 121a-receipt-quote-extraction default › mobile         | 353    | 1306      | 27%   | inside the allowance                          |
| 121a-receipt-quote-extraction check-fields › tablet    | 472    | 2125      | 22%   | inside the allowance                          |
| 017c-anomaly-flags detail › mobile                     | 353    | 1641      | 22%   | inside the allowance                          |
| 011a-ai-assistant-panel action-redirect › mobile       | 149    | 754       | 20%   | inside the allowance                          |
| 121a-receipt-quote-extraction default › tablet         | 353    | 2063      | 17%   | inside the allowance                          |
| 121a-receipt-quote-extraction check-fields › desktop   | 489    | 3050      | 16%   | inside the allowance                          |
| 017c-anomaly-flags detail › tablet                     | 336    | 2472      | 14%   | inside the allowance                          |
| 121a-receipt-quote-extraction default › desktop        | 336    | 2624      | 13%   | inside the allowance                          |
| 022d-suggested-allocations checked › mobile            | 268    | 2098      | 13%   | inside the allowance                          |
| 022d-suggested-allocations default › mobile            | 251    | 2017      | 12%   | inside the allowance                          |
| 022d-suggested-allocations checked › tablet            | 336    | 2777      | 12%   | inside the allowance                          |
| 080f-transaction-matching-review detail › mobile       | 285    | 2515      | 11%   | inside the allowance                          |
| 022d-suggested-allocations default › tablet            | 302    | 2684      | 11%   | inside the allowance                          |
| 080f-transaction-matching-review detail › tablet       | 302    | 2987      | 10%   | inside the allowance                          |
| 011a-ai-assistant-panel refused-out-of-scope › desktop | 217    | 2592      | 8%    | inside the allowance                          |
| 017c-anomaly-flags detail › desktop                    | 302    | 3686      | 8%    | inside the allowance                          |
| 022d-suggested-allocations default › desktop           | 319    | 4041      | 8%    | inside the allowance                          |
| 080f-transaction-matching-review detail › desktop      | 353    | 4565      | 8%    | inside the allowance                          |
| 022d-suggested-allocations checked › desktop           | 285    | 4202      | 7%    | inside the allowance                          |
| 011a-ai-assistant-panel action-redirect › desktop      | 149    | 2592      | 6%    | inside the allowance                          |
| 069a-policy-assistant is-allowed › desktop             | 149    | 2592      | 6%    | inside the allowance                          |
