# Iteration 1 inspection (094b)

The first run of iteration 1 used the default base URL (another checkout's stack) and stale sign-in state;
it was re-run against this stack (`--base http://localhost:41200`) after the setup project. Findings of that run:

| Screen | State               | Viewport | Severity             | Finding                                                                                     | Screenshot                                                           |
| ------ | ------------------- | -------- | -------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 094b   | default, new-export | desktop  | blocking (automated) | layout shift 0.291: the header actions wrapped under the heading once "New export" appeared | screens/094b-finance-payroll-exports--default--desktop--light.png    |
| 094b   | default             | all      | blocking             | Period select empty until a month is chosen (value not bound to the list's month)           | screens/094b-finance-payroll-exports--default--desktop--light.png    |
| 094b   | new-export          | all      | blocking             | Floating labels of the dialog's fields clipped at the top; fields touching                  | screens/094b-finance-payroll-exports--new-export--desktop--light.png |
| 094b   | new-export          | all      | non-blocking         | Rate shows 12 decimals (1.000000000000)                                                     | same                                                                 |
| 094b   | new-export          | desktop  | non-blocking         | Column headers crowd (COST CENTER EVENT CODE, CREDIT TRANSACTION)                           | same                                                                 |
