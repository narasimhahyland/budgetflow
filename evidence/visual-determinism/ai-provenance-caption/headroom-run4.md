# Visual baseline headroom

Allowance: 0.002 of each image's pixels. Measured by comparing every state
with no allowance at all, so these are the differences the gate is currently tolerating.

81 state(s) match their baseline exactly. 2 differ.

## Using 70% or more of the allowance (2)

| State                                          | Pixels | Allowance | Used  |                                               |
| ---------------------------------------------- | ------ | --------- | ----- | --------------------------------------------- |
| 113a-ai-settings-query-log query-log › tablet  | 109343 | 7628      | 1433% | over the allowance, the gate fails this state |
| 113a-ai-settings-query-log query-log › desktop | 9904   | 12669     | 78%   | inside the allowance                          |

## Every state that differs (2)

| State                                          | Pixels | Allowance | Used  |                                               |
| ---------------------------------------------- | ------ | --------- | ----- | --------------------------------------------- |
| 113a-ai-settings-query-log query-log › tablet  | 109343 | 7628      | 1433% | over the allowance, the gate fails this state |
| 113a-ai-settings-query-log query-log › desktop | 9904   | 12669     | 78%   | inside the allowance                          |
