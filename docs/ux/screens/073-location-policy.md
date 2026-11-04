# 073 Location-policy configuration

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 7 batch B. Build phase P7. Rules and policies > Locations.

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Planned exports: `design/stitch/073-location-policy/default--desktop--light.png` (location matrix).

## Purpose

Show and edit, per office location, the policy values that differ by place (per-person limits, allowed categories, local evidence rules), with the USD value that budgets use and the local currency for reference.

## Roles

Finance Admin, Organization Admin (edit); Finance Controller, Auditor, Regional Managers (read for their region).

## Entry points

066 tabs; 071 location overrides; 037 location management (P3) "Policy".

## Content and actions

Matrix: rows are locations (Bengaluru, Hyderabad, Westlake, London), columns are policy values:

| Location  | Team events per person | Team meals per person | Alcohol at events | Receipt above | Local currency |
| --------- | ---------------------- | --------------------- | ----------------- | ------------- | -------------- |
| Bengaluru | USD 40.00              | USD 9.58 (INR 800.00) | Not allowed       | USD 6.00      | INR            |
| Hyderabad | USD 40.00              | USD 9.58 (INR 800.00) | Not allowed       | USD 6.00      | INR            |
| Westlake  | USD 40.00              | USD 25.00             | Approved events   | USD 25.00     | USD            |
| London    | USD 50.00              | USD 19.05 (GBP 15.00) | Approved events   | USD 25.00     | GBP            |

Cells inherit from the company default unless overridden (override marker and "Reset to default"). Selecting a cell opens a side panel: value in USD, local equivalent at the FY2026 plan rate (read-only), effective dates, the rule it feeds, last change. Header actions: Simulate (077), Publish.

## Data and permissions

Location values are parameters of the rules in 071, 072 and 072a; budgets are USD, so limits are stored in USD and local amounts are display only. Regional Managers read their region. `rule:edit`, `rule:publish`.

## States

| State      | Behaviour                                                 |
| ---------- | --------------------------------------------------------- |
| Default    | as above                                                  |
| Override   | cell with an "Overridden" tag and the default shown below |
| Validation | value above zero; effective date not in the past          |
| Read only  | Regional Managers see their rows only                     |

## Budget safety and audit

USD is the controlling value; local equivalents never drive checks. Overrides and resets are audited as rule versions.

## Responsive and accessibility

Tablet: matrix scrolls with the location column pinned. Mobile: one card per location. Override markers are text, not colour.

## Related screens and navigation

066, 071, 072, 072a, 037 location management, 107 exchange rates.

## Assumptions and open questions

- Plan rates used for the reference column: INR 83.50 per USD, GBP 0.7874 per USD (USD 1.27 per GBP), fictional.
