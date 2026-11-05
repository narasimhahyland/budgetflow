# 099b Event-code and card-limit push

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 12 batch. Build phase P12. Review-added screen (catalog section E: "event-code master pushed to card, expense and ERP tools" and "push approved commitments into card limits"). Admin > Integrations > Pushes (`/integrations/pushes`, tabs Event codes and Card limits).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the sync table of 099. Planned Stitch states, to be generated in a later session:

| State                        | Planned image                                                               |
| ---------------------------- | --------------------------------------------------------------------------- |
| event codes by target system | `design/stitch/099b-event-code-card-limit-push/default--desktop--light.png` |
| card limits by commitment    | `card-limits--desktop--light.png`                                           |
| failed push with retry       | `failed--desktop--light.png`                                                |

## Purpose

Show, for every event code and every approved card commitment, whether the outside systems have it: event codes in the card, expense and ERP tools (so spend gets tagged at the source and auto-matches), and card limits on organizers' cards (so approved money is spendable for exactly the approved amount), with retry when a push fails.

## Roles

Integration Admin (retry, resend, retire); Finance Admin and Finance Controller (read); event organizers see their event's push status on 046 ("Event code available in Concur and Ramp").

## Entry points

092 "Pushes"; 096 card-limit push settings; 046 event details status line; 051 commitment "Card limit" chip; 100 errors for push failures.

## Content and actions

Tab Event codes (filters: status, target, event status):

| Event code    | Event                        | Status of event | ERPNext | Concur  | Ramp    | Last change    |
| ------------- | ---------------------------- | --------------- | ------- | ------- | ------- | -------------- |
| EVT-2026-0112 | Bengaluru Diwali celebration | Funded          | Pushed  | Pushed  | Pushed  | 2 Nov, created |
| EVT-2026-0105 | Hyderabad townhall           | Approved        | Pushed  | Pushed  | Failed  | 4 Nov, created |
| EVT-2026-0087 | Offsite 2026                 | Closed          | Retired | Retired | Retired | 5 Nov, retired |

- Lifecycle: an event code is pushed when the event is Approved, updated when its name or cost center changes, and retired (made inactive, never deleted) when the event closes or is cancelled, after a 30-day grace period for late receipts.
- Row actions: Retry failed, Resend to all, View payload (fields sent: code, name, cost center, legal entity, valid from and to).

Tab Card limits (shown when card-limit push is on, 096):

| Commitment                | Event         | Card holder | Approved amount | Limit on card   | Valid until | Spent           | Status                      |
| ------------------------- | ------------- | ----------- | --------------- | --------------- | ----------- | --------------- | --------------------------- |
| PO-2026-0233 Diwali decor | EVT-2026-0112 | Rahul Verma | USD 1,800.00    | INR 1,50,300.00 | 21 Nov      | INR 96,400.00   | Live                        |
| PO-2026-0251 Catering     | EVT-2026-0105 | Lakshmi Rao | USD 3,600.00    | -               | -           | -               | Waiting for approval        |
| PO-2026-0244 AV equipment | EVT-2026-0087 | Rahul Verma | USD 2,400.00    | closed          | -           | INR 1,68,670.00 | Closed (released remainder) |

- Row actions: Retry, Close limit now (Finance Admin, with reason), View history (create, update, close with timestamps).

## Data and permissions

Push records per item and target come from the outbox (`outbox_messages`) and connector push logs in `integrations.ts`: item type (event code or card limit), target connector, payload hash, status (Queued, Pushed, Failed, Retired, Live, Closed), attempts, last error. Pushes are idempotent per item version and target; retries use backoff and end in the dead letter (100) after the configured attempts. `integration.read` to view; `integration.manage` to retry and resend; closing a card limit early needs Finance Admin. Card limits equal the approved commitment converted at the locked plan rate into the card currency (USD 1,800.00 = INR 1,50,300.00).

## States

| State           | Behaviour                                                                     |
| --------------- | ----------------------------------------------------------------------------- |
| Event codes     | as above                                                                      |
| Card limits     | as above; tab hidden with a note when card-limit push is off                  |
| Failed          | error tag with the provider message ("Ramp: duplicate external id") and Retry |
| Grace period    | info tag "Retires on 5 Dec" for closed events                                 |
| Empty           | "No event codes pushed yet. Codes are pushed when events are approved."       |
| Loading / error | `sat-ghost`; error banner with Retry                                          |

## Budget safety and audit

Card limits never exceed the approved commitment; controls stop new limits but leave approved ones (096). Event codes are retired, never deleted, so late transactions still carry a known code and land in the unmatched queue for the owning budget. Retries, resends and early closes are audited.

## Responsive and accessibility

Desktop and tablet; mobile read-only with failed items first. Status tags use icon and text; the target columns have headers with the system name.

## Satori components

`sat-header-bar`, `sat-navigation-tabs`, `mat-table` with `satTableWithRowStates` and `satRowPrimaryAction`, `sat-status-tag`, `sat-banner`, `sat-empty-state`, `sat-ghost`; Angular Material side sheet (history, payload), dialog (close limit with reason), snackbar; `bf-money`.

## Related screens and navigation

096 card integration, 094 ERP, 095 expense, 046 event details, 051 commitments, 054 close event, 080b unmatched queue, 099 sync status, 100 errors and retry.

## Decisions taken

- Event codes are pushed when an event is Approved and retired 30 days after it closes or is cancelled, never deleted. Recommended so receipts that arrive late are still tagged and routed to the owning budget.
- One screen shows every push target per item, so "does Concur know this event code?" has a single answer.
- Closing a card limit early is a Finance Admin action with a reason; organizers cannot change limits.
