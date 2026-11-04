# State machines

Every lifecycle is a pure machine in `libs/domain` (`defineMachine`); an illegal event returns `INVALID_TRANSITION` with the allowed events. Guards that depend on balances or related records are separate domain functions, listed under each machine. The UI may show a subset of states; the machines are complete.

## Budget (15 states) — `budgetMachine`

```mermaid
stateDiagram-v2
  [*] --> draft
  draft --> submitted: submit
  submitted --> pending_approval: route_for_approval
  submitted --> approved: approve
  pending_approval --> approved: approve
  submitted --> draft: reject
  pending_approval --> draft: reject
  draft --> active: activate
  approved --> active: activate
  active --> partially_allocated: mark_partially_allocated
  partially_allocated --> fully_allocated: mark_fully_allocated
  partially_allocated --> active: mark_unallocated
  active --> frozen: freeze
  frozen --> active: unfreeze
  active --> reduced: reduce
  active --> set_to_zero: set_to_zero
  set_to_zero --> active: restore
  active --> exhausted: exhaust
  exhausted --> active: replenish
  active --> revised: revise
  revised --> active: approve_revision / reject_revision
  active --> expired: expire
  expired --> closed: close
  active --> closed: close
  draft --> cancelled: cancel
  approved --> cancelled: cancel
```

Operating states (active, partially allocated, fully allocated, reduced) accept freeze, reduce, set to zero, exhaust, expire, close and revise; frozen and exhausted budgets can still be reduced, set to zero, expired and closed. Phase 1 creates budgets directly as `active`; Phase 4 adds the draft, submit and approve flow.

- `acceptsNewActivity(status)`: new requests, allocations and contributions are refused for frozen (`BUDGET_FROZEN`), set to zero (`BUDGET_SET_TO_ZERO`), exhausted, expired, closed, cancelled, and not-yet-active budgets. Phase 1 applies it to allocations.
- `allowsCommitmentCompletion(status)`: existing commitments complete under every control.
- `allocationBadge(authorized, allocatedOut)`: partially and fully allocated as computed badges.
- Reduce and set to zero: `previewReduction` / `validateReduction` (reason code, typed reason, destination, confirmed preview, floor = allocated out kept by children + held + encumbered + actual; pending requests listed but not floored; set to zero can cascade). Implemented in Phase 4 (`ControlsService`); every change publishes `budget.control_changed`.

## Commitment — `commitmentMachine`

```mermaid
stateDiagram-v2
  state "Pre-encumbered" as pre_encumbered
  state "Partially consumed" as partially_consumed
  state "Carried forward" as carried_forward
  [*] --> pre_encumbered: request submitted
  pre_encumbered --> encumbered: approve
  pre_encumbered --> released: reject / withdraw
  encumbered --> partially_consumed: match_partial
  partially_consumed --> partially_consumed: match_partial
  encumbered --> consumed: match_full
  partially_consumed --> consumed: match_full
  partially_consumed --> released: release
  encumbered --> released: release
  encumbered --> cancelled: cancel_with_fees
  encumbered --> expired: expire
  encumbered --> carried_forward: carry_forward
```

Each transition posts a paired movement (`postCommitmentMovement`, see [ledger.md](ledger.md)).

## Event — `eventMachine`

```mermaid
stateDiagram-v2
  [*] --> draft
  draft --> submitted: submit
  submitted --> approved: approve
  submitted --> draft: reject
  approved --> funded: fund
  funded --> in_progress: start
  in_progress --> completed: complete
  completed --> reconciling: reconcile
  reconciling --> closed: close
  draft --> cancelled: cancel
  submitted --> cancelled: cancel
  approved --> cancelled: cancel
  funded --> cancelled: cancel
  in_progress --> cancelled: cancel (fees consumed)
```

Guards: `checkFundingCap` (own funds + contributions within estimate + tolerance), `canCloseEvent` (no unmatched actuals, no cross-entity contribution without its recharge), `surplusReturns` (by share, largest remainder).

## Request — `requestMachine`

```mermaid
stateDiagram-v2
  [*] --> draft
  draft --> submitted: submit
  submitted --> pending_approval: route
  pending_approval --> approved: approve
  pending_approval --> partially_approved: approve_partial
  pending_approval --> rejected: reject
  pending_approval --> changes_requested: request_changes
  changes_requested --> submitted: resubmit
  draft --> withdrawn: withdraw
  pending_approval --> withdrawn: withdraw
  approved --> cancelled: cancel
  partially_approved --> cancelled: cancel
```

Kinds: budget, spending, additional-fund, over-budget, exception. Approvers must pass `checkAuthority` (DoA limit for spend type and entity at the locked plan rate) and `checkApprovalHygiene` (no self-approval, not a beneficiary or attendee); delegates are capped by `delegatedLimit`.

## Inter-Director Budget Contribution Request — `contributionMachine`

```mermaid
stateDiagram-v2
  [*] --> draft
  draft --> submitted: submit
  submitted --> pending_approval: route
  pending_approval --> approved_full: approve_full
  pending_approval --> approved_partial: approve_partial
  pending_approval --> rejected: reject (reason)
  pending_approval --> changes_requested: request_changes (reason)
  changes_requested --> submitted: resubmit
  draft --> withdrawn: withdraw
  approved_full --> earmarked: earmark (default)
  approved_partial --> earmarked: earmark
  approved_full --> transferred: transfer
  approved_partial --> transferred: transfer
  earmarked --> settled: settle at event close
  transferred --> settled: settle
  earmarked --> cancelled: cancel
```

The giving director decides (`decideContribution`): approve full, approve a different amount (more than zero, less than requested, within the giver's available), request changes or reject with a reason. Never automatic. Cross-entity contributions go through `resolveIntercompany` (block, recharge at cost, recharge with markup, tax approver).

## Accounting period — `periodMachine`

```mermaid
stateDiagram-v2
  [*] --> open
  open --> soft_closed: soft_close
  open --> closed: close
  soft_closed --> closed: close
  soft_closed --> open: reopen
  closed --> open: reopen
  closed --> locked: lock
  locked --> closed: unlock
```

Reopen and unlock are privileged, reasoned and audited (Phase 11). Posting rules: [ledger.md](ledger.md#periods).

## Forecast snapshot — `forecastMachine`

```mermaid
stateDiagram-v2
  [*] --> draft
  draft --> submitted: submit
  submitted --> commentary_required: require_commentary (variance above threshold)
  commentary_required --> submitted: submit with commentary
  submitted --> accepted: accept
  accepted --> superseded: supersede
```

Methods: run rate, committed + pipeline, owner input (Phase 11).

## Intercompany recharge — `rechargeMachine`

```mermaid
stateDiagram-v2
  [*] --> proposed
  proposed --> pending_tax_approval: request_tax_approval
  proposed --> approved: approve
  pending_tax_approval --> approved: approve
  proposed --> blocked: block
  pending_tax_approval --> blocked: block
  approved --> scheduled: schedule
  scheduled --> exported: export
  scheduled --> posted: post
  exported --> posted: post
  proposed --> cancelled: cancel
  scheduled --> cancelled: cancel
```

Posting: `postIntercompanyRecharge` (due from on the charging entity, due to on the charged entity; nets to zero at group level). Export to ERP is Phase 12.
