# 053a Intercompany recharge schedule

Status: proposed - awaiting user review. Light theme only. UX Phase 4-7 track, batch 2. Build phase P5.

## Design

| State                         | Image                                                                           | Stitch screen                      |
| ----------------------------- | ------------------------------------------------------------------------------- | ---------------------------------- |
| default (tax approval drawer) | `design/stitch/053a-intercompany-recharge-schedule/default--desktop--light.png` | `e7c0f4d720c74787b259eaaca6846d9e` |

## Purpose

List recharges created by cross-entity event shares and contributions, let the tax approver confirm the treatment, and track export to the ERP.

## Roles

Finance Admin and Finance Controller; the tax approver role decides treatment.

## Entry points

Finance > Intercompany recharges; 049 intercompany banner; 053 reconciliation blockers.

## Content and actions

Policy card (entity pairs and mode: at cost or with markup; tax approver). Status tabs (awaiting tax approval, approved, exported). Table: Recharge, Event, From entity -> To entity, Basis, Amount, Markup, Tax treatment, Period, Status. Drawer: lines per cost center, journal preview per entity (debits and credits), tax approver decision (Approve tax treatment, Request changes) with reason; warning that the event cannot close until approved.

## Data and permissions

Recharges generated from 049 splits and 056a contributions per the intercompany policy (P1 model). `recharge:approve-tax` for the tax approver; export file to ERP in P12.

## States

Policy "block": no recharge; the share or contribution is rejected upstream. Request changes: recharge returns to the organizer and Finance Admin with the comment. Empty tab: "Nothing awaiting tax approval".

## Budget safety and audit

Recharges post intercompany journals that balance per entity; FX handled at the plan rate in USD. Each decision audited.

## Responsive and accessibility

Desktop and tablet; on tablet the drawer becomes a full page. Arrows between entities have text ("to").

## Related screens and navigation

049, 053, 054, 056a, 080c.

## Assumptions and open questions

- Known render issue: the table is cramped next to the drawer (long cells wrap); the build should collapse Basis and Tax treatment into the drawer when it is open.
- Entity names in the sample (Hyland India Pvt Ltd, Hyland Software Inc, Hyland UK Ltd) are placeholders consistent with earlier designs.
