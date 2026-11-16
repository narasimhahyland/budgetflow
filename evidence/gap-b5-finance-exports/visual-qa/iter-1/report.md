# Visual capture report

- Base: http://localhost:41200
- Matrix: desktop, tablet, mobile x light
- Captures: 9; blocking findings: 2; warnings: 0

| Screen                       | State      | Viewport | Theme | Blocking | Warnings | Screenshot                                                           |
| ---------------------------- | ---------- | -------- | ----- | -------- | -------- | -------------------------------------------------------------------- |
| 094b-finance-payroll-exports | default    | desktop  | light | 1        | 0        | screens/094b-finance-payroll-exports--default--desktop--light.png    |
| 094b-finance-payroll-exports | default    | tablet   | light | 0        | 0        | screens/094b-finance-payroll-exports--default--tablet--light.png     |
| 094b-finance-payroll-exports | default    | mobile   | light | 0        | 0        | screens/094b-finance-payroll-exports--default--mobile--light.png     |
| 094b-finance-payroll-exports | new-export | desktop  | light | 1        | 0        | screens/094b-finance-payroll-exports--new-export--desktop--light.png |
| 094b-finance-payroll-exports | new-export | tablet   | light | 0        | 0        | screens/094b-finance-payroll-exports--new-export--tablet--light.png  |
| 094b-finance-payroll-exports | new-export | mobile   | light | 0        | 0        | screens/094b-finance-payroll-exports--new-export--mobile--light.png  |
| 094b-finance-payroll-exports | forbidden  | desktop  | light | 0        | 0        | screens/094b-finance-payroll-exports--forbidden--desktop--light.png  |
| 094b-finance-payroll-exports | forbidden  | tablet   | light | 0        | 0        | screens/094b-finance-payroll-exports--forbidden--tablet--light.png   |
| 094b-finance-payroll-exports | forbidden  | mobile   | light | 0        | 0        | screens/094b-finance-payroll-exports--forbidden--mobile--light.png   |

## Blocking findings

- `094b-finance-payroll-exports--default--desktop--light.png` **layout-shift**: cumulative layout shift 0.291 (> 0.25)
- `094b-finance-payroll-exports--new-export--desktop--light.png` **layout-shift**: cumulative layout shift 0.291 (> 0.25)
