# 073a Vendor controls

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 7 batch B. Build phase P7. Rules and policies > Vendors.

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Planned exports: `design/stitch/073a-vendor-controls/default--desktop--light.png`, `block-dialog--desktop--light.png`.

## Purpose

Mark vendors as preferred, approved or blocked (with a reason and dates), recommend preferred venues per location, and decide what happens when someone requests or spends with a blocked or unknown vendor.

## Roles

Finance Admin (edit), Finance Controller and Auditor (read); requesters see the result as hints and blocks.

## Entry points

066 tabs; 106c vendor master (P3) "Controls"; 074a exceptions for blocked vendors.

## Content and actions

Header: search, filters (status, location, category), "Add control". Policy card: "Unknown vendors: Warn and ask for a quote" (options Allow, Warn, Require Finance Controller approval, Block).

Table: vendor (from 106c), categories, locations, status tag (Preferred success with star, Approved neutral, Blocked error), reason, from, until, requests last 90 days, actual spend last 90 days (USD). Samples: Lakeview Convention Centre (Preferred venue, Bengaluru); Spice Route Caterers (Preferred, Bengaluru, Hyderabad); Brightline AV (Approved); Northside Print (Approved, Westlake); Party Palace Rentals (Blocked: "Repeated late cancellations", from 1 Oct 2026).

Block dialog: vendor, reason code and typed reason, effective from, optional until, effect preview ("2 open commitments stay valid; new requests and new commitments are blocked; post-spend actuals are flagged in 074a"). Footer: Cancel, Block vendor.

## Data and permissions

Vendor controls are rule parameters over the vendor master (106c); compiled to R-03 "Block blocked vendors" and R-27 "Prefer preferred venues" (hint only). `vendor:control` for Finance Admin.

## States

| State                                | Behaviour                                     |
| ------------------------------------ | --------------------------------------------- |
| Default                              | as above                                      |
| Blocked vendor with open commitments | info line in the dialog; commitments complete |
| Validation                           | reason required for blocks; until after from  |
| Empty                                | "No vendor controls yet"                      |

## Budget safety and audit

Blocking never cancels existing commitments (they complete, consistent with freeze); it blocks new ones. Each change is audited with reason.

## Responsive and accessibility

Tablet: hide 90-day columns. Mobile: read-only list. Status uses icon plus text.

## Related screens and navigation

066, 106c vendor master, 051 commitments, 074a exceptions, 117 and 118 (vendor hints).

## Assumptions and open questions

- Unknown vendor default "Warn and ask for a quote" (assumed).
