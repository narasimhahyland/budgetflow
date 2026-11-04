# 032a Period phasing editor

Status: proposed - awaiting user review. Light theme only. UX Phase 4-7 track, batch 1. Build phase P4.

## Design

| State                   | Image                                                              | Stitch screen                      |
| ----------------------- | ------------------------------------------------------------------ | ---------------------------------- |
| validation (over total) | `design/stitch/032a-period-phasing/validation--desktop--light.png` | `681fcf4b422540a6905c2df0feea927f` |

## Purpose

Decide when a budget's money becomes available across the fiscal year: even, seasonal profile or manual amounts per period.

## Roles

Budget owner and Finance Admin.

## Entry points

021 menu "Phasing"; 032 "Edit phasing"; 020 create budget (phasing step).

## Content and actions

Method segmented control (Even, Seasonal with a profile select, Manual). Column chart of 12 periods; editable row of period amounts; closed periods locked (read-only, lock icon); totals row against authorized; toggle "Unused allotment rolls into the next period"; info line that phasing never changes the authorized amount. Footer: Cancel, Reset to seasonal, Save phasing.

## Data and permissions

`budget:phase`. Period list from the fiscal calendar (P3). Saved as period allotments on a new budget version.

## States

| State           | Behaviour                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| Default (valid) | total equals authorized with a success check; Save enabled                                              |
| Over or under   | error banner and red total "USD 10,400.00 of USD 10,000.00"; offending field outlined; Save disabled    |
| Below committed | a period cannot go below what is already committed in it ("Oct cannot go below committed USD 1,850.00") |

## Budget safety and audit

Allotments limit what can be committed per period when the control basis is phased. Saving creates a version and an audit entry.

## Responsive and accessibility

Tablet: two rows of six fields; mobile: vertical list. Each field labelled with its period; chart has a table alternative.

## Related screens and navigation

032, 021, 030, 108.

## Assumptions and open questions

- Only the validation state was exported; the valid state is the same layout with a success total.
- Known render issue: Stitch drew a violet sidebar with invented items (Delegations, Ledger verification) and a policy-code badge; the shell is 000a.
