# 045 Create event budget

Status: proposed - awaiting user review. Light theme only. Start screen 6 (todo `ux-s06-event-budget`). Satori variant of the original Stitch screen `1c7d06225b4c4c82be03e67309c838a0` (unchanged). Covers spec screens 45 (create event) and 48 (event budget request) as one wizard.

Revised 2026-11-04 to the single-company decisions: Hyland only (static label, no tenant or organization switcher, no reporting-currency chip), budgets in USD (transactions may show INR or EUR with the USD amount), Export instead of Share.

## Design

| State                                  | Image                                                               | Stitch screen                      |
| -------------------------------------- | ------------------------------------------------------------------- | ---------------------------------- |
| default (step 3 budget and cost split) | `design/stitch/045-create-event-budget/default--desktop--light.png` | `44052774e7324680bfd662ec670afc89` |
| validation                             | `validation--desktop--light.png`                                    | `a33ff3c74600487aaea43f7d635970ec` |

## Purpose

Let an event organizer create an event and its budget in one flow: details, locations and participants, cost lines with a per-head check, cost split by location, team or legal entity, funding sources, then submit for approval.

## Roles

- Primary: Event Organizer.
- Secondary: Location Manager, Regional Manager (create for their scope); co-organizers (edit).

## Entry points

Events > New event; Request event funding from the employee dashboard (118); clone from an existing event.

## Content and actions

- Stepper (Material): 1 Event details, 2 Locations and participants, 3 Budget and cost split, 4 Funding, 5 Review and submit. Draft saved automatically.
- Step 3: event summary line; editable cost lines (category, description, quantity, unit cost, amount); total estimate in budget and reporting currency; per-head amount against the policy limit; cost split by location, team or legal entity with attendees, share and funding budget.
- Right summary: total, tolerance, funding cap, funding sources with available after, approvals needed.
- Footer: Back, Save draft, Continue.

## Data

Event (name, type, dates, locations, expected attendance, co-organizers); cost lines; split basis; funding budgets with available amounts and status; per-head policy limit from rules; legal entity of each location.

## Permissions

Event creation needs `event:create` in scope. Selecting a funding budget does not commit it; owners of other budgets approve their share (or an Inter-Director Budget Contribution Request is raised).

## States

| State        | Treatment                                                                                                                                                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loading      | `sat-ghost` in the step body                                                                                                                                                                                                 |
| Validation   | Error banner listing issues with anchors; field errors; soft warning for per head near the limit (can proceed); hard block when a funding budget is frozen, with Request contribution; Continue disabled with reason (image) |
| Blocked      | All funding sources frozen or zero: banner explaining the event cannot be funded, with Request contribution                                                                                                                  |
| Error        | Save failed: banner with retry; nothing lost                                                                                                                                                                                 |
| Success      | Submitted: confirmation page with request id, approval chain and next steps                                                                                                                                                  |
| Confirmation | Review step asks to confirm before submit; cancelling a draft asks to confirm                                                                                                                                                |

## Budget safety

Per-head soft warning (warning) vs frozen source hard block (error, Continue disabled); frozen tag with lock icon on the source; amounts with currency codes and reporting equivalent.

## Audit

Submit creates the event and the funding requests with audit entries; drafts are not audited.

## Responsive

Tablet: summary panel below the step. Mobile: vertical stepper, cost lines as cards, summary as a collapsible footer.

## Accessibility

Stepper announces step position; error banner links move focus to fields; per-head status uses text, not color alone.

## Related screens

046 event details, 047 locations and participants, 049 cross-location cost allocation, 049a co-funding board, 056a Inter-Director Budget Contribution Request, 057 additional-fund request.

## Navigation

Breadcrumb Home / Events / New event; each step is a route so browser back moves between steps.

## Assumptions

Funding cap = own funds + contributions within estimate + tolerance; per-head limit comes from the rules engine for the event type and location.

## Open questions

- Should tolerance be per event type or per organization?
- Stitch render notes: the sidebar ends above the page bottom in the render (shell must fill the height).
