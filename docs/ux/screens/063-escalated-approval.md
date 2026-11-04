# 063 Escalated approval

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 7 batch A. Build phase P7. Extends 059 (tab "Escalated").

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Planned exports: `design/stitch/063-escalated-approval/default--desktop--light.png` (above the original approver's limit), `sla-breach--desktop--light.png`.

## Purpose

Give the escalation approver (Finance Controller, CEO, or the next authority in the chain) everything needed to decide an item that left its normal path: why it escalated, who had it and for how long, the authority check, and the budget impact.

## Roles

Escalation approvers: next authority by DoA (Department Head, Finance Controller, CEO). Requesters and the skipped approver see the escalation in 060 and 064.

## Entry points

059 "Escalated" tab (count badge); notifications and email "Escalated to you"; 018 pending approvals dashboard (P10).

## Content and actions

Two samples, one per state:

- Above limit (default): REQ-2026-0455 "Europe offsite venue deposit", Sophie Laurent's Europe Region, EUR 9,800.00 = USD 10,584.00 at the FY2026 plan rate. Escalation banner (warning): "Escalated because USD 10,584.00 is above Sophie Laurent's limit of USD 10,000.00. You can approve up to USD 100,000.00."
- SLA breach: REQ-2026-0449 "US volunteer day supplies", USD 1,450.00; banner: "Escalated after 2 business days without a decision by Jordan Lee (due 3 Nov, 17:00)". Jordan can still decide until the escalation approver acts; both see "Also with Priya Raman".

Content: escalation timeline (submitted, routed to Sophie Laurent, escalated at 09:12 with the reason, now with Priya Raman, SLA for this step: 1 business day); request card; budget impact (available before and after, soft warning or hard block per control mode); rule explanation and DoA check rows (original approver: limit, result; you: limit, result); hygiene checks. Actions: Return to original approver (with note, only for SLA escalations), Request changes, Reject, Approve.

## Data and permissions

Escalation records from the approvals API with reason (`above_limit`, `sla_breach`, `approver_unavailable`), from-approver, to-approver, timestamps and the SLA policy (076). The worker escalates idempotently; Approve is enabled only when the viewer's DoA covers the amount, spend type and legal entity.

## States

| State             | Behaviour                                                                                             |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| Above limit       | as above                                                                                              |
| SLA breach        | as above; "Return to Jordan Lee" available                                                            |
| Still above       | amount above the escalation approver's limit too: Approve disabled, "Escalates to Olivia Grant (CEO)" |
| Decided elsewhere | the original approver decided first: banner "Jordan Lee approved at 10:05"; actions hidden            |
| Empty tab         | "No escalated approvals"                                                                              |
| Success           | snackbar "Approved REQ-2026-0455 as escalation approver"                                              |

## Budget safety and audit

Escalation reason and both DoA checks are written into the decision's audit entry with the rule versions. Escalated items never bypass hygiene checks. SLA timers display as text plus icon (warning when due today, error when overdue).

## Responsive and accessibility

Mobile: timeline collapses to the latest three events with "Show all". Overdue state uses icon and text, not colour alone.

## Related screens and navigation

059, 060, 061, 062, 064 request history, 070 approval routing, 076 notification and escalation policy, 090 approval history.

## Assumptions and open questions

- On SLA escalation, should the original approver keep the right to decide (as designed) or lose it?
