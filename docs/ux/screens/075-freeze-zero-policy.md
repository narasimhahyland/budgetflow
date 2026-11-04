# 075 Freeze and zero-budget policy

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 7 batch B. Build phase P7. Rules and policies > Freeze and zero.

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Planned exports: `design/stitch/075-freeze-zero-policy/default--desktop--light.png`.

## Purpose

Set the company rules behind the freeze (027), reduce (026) and set-to-zero (028) controls: who may use them, which reason codes apply, what happens to pending requests and commitments, automatic freeze triggers, and who is told.

## Roles

Finance Admin (edit), Finance Controller, CEO and Auditor (read).

## Entry points

066 tabs; 027, 026 and 028 dialogs ("Policy" link for finance).

## Content and actions

Three cards, one per control, plus triggers:

- Freeze: who may freeze (parent owner, Finance Admin, Finance Controller, CEO); reason codes allowed (from 106b); pending requests are **held** (they stay pending and cannot be approved until unfrozen); approved commitments complete; new requests blocked; owner and requesters notified.
- Reduce: who may reduce; floor = approved commitments + actual + child allocations; **pending requests are excluded from the floor and listed in the impact preview** (product answer 2026-11-05); destinations allowed (parent, contingency reserve, unallocated pool).
- Set to zero: who may (Finance Admin, CEO; parent owner with Finance Controller approval); pending requests are **cancelled and returned to requesters with the reason**; commitments complete; children cascade only if chosen; typed reason and confirmation required.
- Automatic triggers: freeze at 100% utilization for budgets in Hard mode (off by default); freeze when the owner leaves the company until a new owner is set (on); notify parent owner at 90% (on).

Footer: Publish (rule versions R-05 freeze, R-06 zero, R-29 triggers).

## Data and permissions

Parameters feed the control commands (P4) and rules; the dialogs read them to show allowed reason codes and effects. `rule:edit`, `rule:publish`.

## States

| State      | Behaviour                                               |
| ---------- | ------------------------------------------------------- |
| Default    | as above                                                |
| Validation | at least one role per control; at least one reason code |
| Trigger on | info line "Applies to 18 budgets in Hard mode"          |
| Read only  | Finance Controller, CEO, Auditor                        |

## Budget safety and audit

Frozen (info, lock) versus set to zero (important) tones repeated on the cards; what happens to pending requests is stated in words for each control. Changes are audited rule versions.

## Responsive and accessibility

Tablet fine; mobile read-only.

## Related screens and navigation

026, 027, 028, 066, 106b reason codes.

## Assumptions and open questions

- Automatic freeze at 100% for Hard-mode budgets: off by default (assumed); confirm.
