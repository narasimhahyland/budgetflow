# Gap B3: tax-aware consumption and the employee benefit ledger

Package B3 of [`docs/gap-closure-plan.md`](../../docs/gap-closure-plan.md): screens 080g (recoverable vs
non-recoverable GST/VAT) and 080h (employee benefit ledger with benefit-in-kind thresholds).

Decisions that apply:

- **D2:** both screens are built from the written specs. There is no approved Stitch design.
- **D3:** tax rates and thresholds are configurable, with fictional seeded values, marked on screen
  as placeholders for the tax approver and not tax advice.

## What it does

- **Requests.** A request's amount is net of tax, with an optional `tax` amount. On submission the
  tax splits by the published rule in force: legal entity × spend category × attendee type, and
  mixed attendance in proportion to employees present. The commitment pre-encumbers the net plus
  only the non-recoverable tax. The split is written once as append-only commitment tax lines.
  Approval, partial approval, an accepted counter-offer, resubmission and the route preview all use
  that same basis.
- **Actuals.** Imports accept `tax_amount`, `tax_category`, `employees_present` and
  `others_present`. A taxed line uses its gross less the recoverable tax. Reversals and refunds
  without a tax column take their original's split. Duplicate detection compares gross amounts.
- **Versions.** Rule sets and thresholds are versioned. Finance drafts and submits; the tax approver
  (Finance Controller, new `tax.publish`) publishes from today or later, or returns with comments.
  Published versions never change: database triggers enforce this. Every step is audited with the
  rule diff.
- **Benefit ledger.** Entries come from three sources:
  - at event close, each attended employee's final cost per attendee;
  - on approval or an accepted counter-offer, the shares of a request that names recipients;
  - entries finance records.

  Entries are append-only; a reversal is a negating entry. A request released before any spend
  reverses its entries.

- **Thresholds.** Each threshold is evaluated on its own tax year in its own currency at the locked
  plan rate:
  - exactly at the limit is Approaching; one minor unit above is Over;
  - the reportable amount is the whole amount (UK annual functions), or the excess plus any
    occasions beyond the allowance (Germany per event);
  - company caps are never reportable.
- **Permissions.** New actions: `tax.read`, `tax.publish`, `benefits.read`, `benefits.manage`
  ([authorization matrix](../../docs/architecture/authorization.md)).
- **Screens.**
  - `/finance/tax-recoverability`: the rules in force by entity, an upcoming version, the draft
    editor with changes highlighted, the tax approver's publish and return, and the preview calculator.
  - `/finance/employee-benefits`: the ledger with filters, the person drawer and the thresholds tab.
  - The request detail gains a Tax card.

Posting design (lines, buckets, the currency triplet, corrections): [`posting-design.md`](posting-design.md).
Migration `0023_b3_tax_benefits` (A2 holds `0022`).

## Invariants and proof

| Row | Invariant                                                                                                                  | Scenario                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 103 | Recoverable tax never uses budget on a commitment; exactly at available and one minor unit above                           | `apps/api-e2e/src/tax/tax-consumption.spec.ts` |
| 104 | Actuals use gross less recoverable tax; exact match and one unit over; reversals; duplicates; rebuild check clean          | same file                                      |
| 105 | Versioned rules and thresholds, tax approver, immutability, role scope, RLS                                                | same file and `benefit-ledger.spec.ts`         |
| 106 | Benefit ledger per employee and tax year, the BIK flag at the limit and one unit above, event close, reversals, role scope | `apps/api-e2e/src/tax/benefit-ledger.spec.ts`  |

Outcome table: [`functional/outcomes.md`](functional/outcomes.md). It records 20 API scenarios and
3 journeys, all passing. API samples are in [`api/`](api/); they hold no tokens and only fictional
seed people.

## Review

An independent domain-invariant review read the diff: 3 high, 4 medium and 3 low findings, and no
invariant weakened. All high and medium findings are fixed, each with a scenario:

- the counter-offer split was scaled twice;
- a reversal listed before its original in the same file did not take the original's split;
- duplicate detection ran on the consumable amount instead of the gross;
- unknown attendance was treated as employees;
- benefits were not recorded on accepted counter-offers;
- a resubmitted amount kept a stale tax;
- the route preview ignored tax.

Two lows are fixed: event-close shares now convert at the plan rate, and the reversal lookup is
limited to the line's source. One low stays as designed: a source records a benefit for a person
once, so after a reversal it cannot be recorded again from the same source; finance records a
corrected entry by hand.

## Gates

[`gate-summary.txt`](gate-summary.txt) is `scripts/gate.sh` in all modes. Static and
`functional-api` passed. That run's `functional-e2e` failed because the role-navigation journey did
not yet list the two new Finance pages. After that fix, `functional-e2e` passes in full
([`gate-summary-functional-e2e-rerun.txt`](gate-summary-functional-e2e-rerun.txt)), and static
passes on the final tree ([`gate-summary-static-final.txt`](gate-summary-static-final.txt)). `visual` failed
as follows:

- **`101-api-keys` (default, create-form, desktop): pre-existing and date-dependent.** The seed sets
  the key's expiry from the real clock (`realNow()` in `apps/api/src/seed/integrations.ts`). The
  masked expiry's width moves the columns a few pixels from the 11 Nov baseline. It is outside B3's
  scope and its baseline is not re-recorded here.
- **All other visual failures** passed on a re-run: `080h` forbidden (a budget-owner session that
  expired during a 44-minute run on a loaded machine), plus 20 flaky retries across other screens.
  Re-run: `080g`, `080h`, `069`, `105` all pass.

Visual QA: [`visual-qa/report.md`](visual-qa/report.md), with no blocking findings after three
iterations. Visual baselines updated: 24 added for the new screens 080g and 080h; no existing
baseline changed.

## Left open

- **For B5:** the payroll export tab and its export batches. The ledger already shows the reportable
  amounts B5 will export.
- **Follow-ups:**
  - CSV, XLSX and PDF export of the two screens;
  - employees seeing their own benefits (122);
  - A2's per-employee cap (071) reading the benefit ledger instead of live request consumption;
  - tax on event commitments (today tax is recorded on spending requests and imported actuals).
