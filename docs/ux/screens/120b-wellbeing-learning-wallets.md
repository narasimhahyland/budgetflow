# 120b Wellbeing and learning wallets

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 15 batch. Build phase P15. Employee experience > My wallets (`/wallets`, claim `/wallets/:walletId/claim`); program admin in Settings > Wallet programs (`/admin/wallets`); claim review queue for program reviewers (`/wallets/review`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a), the 121 upload flow and the 116a card. Planned Stitch states, to be generated in a later session:

| State              | Planned image                                                               |
| ------------------ | --------------------------------------------------------------------------- |
| my wallets         | `design/stitch/120b-wellbeing-learning-wallets/default--desktop--light.png` |
| claim with receipt | `claim--mobile--light.png`                                                  |
| reviewer queue     | `review--desktop--light.png`                                                |
| program settings   | `program--desktop--light.png`                                               |

## Purpose

Replace hand-tracked allowances with per-person wallets: each eligible employee sees how much of their yearly wellbeing or learning stipend is left, claims with a receipt or books through a partner, and People Ops reviews claims in one queue, while the money stays inside a program budget on the ledger and taxable portions are reported.

## Roles

Employees (own wallets and claims); program reviewers (People Ops, chosen per program: approve or return claims); Organization Admin and Finance Admin (programs); owners of the funding budgets (see spend); Finance Controller (read).

## Entry points

115 employee home wallet card; 116 available budgets; 59b mobile Receipt tab "Claim from a wallet"; 121a receipt extraction (prefills the claim); 92d marketplace "Pay from my wallet"; Settings > Wallet programs.

## Content and actions

My wallets (sample Kavya Shah):

- Feel Good wellbeing (program name from 102b): USD 180.00 left of USD 300.00 for 2026; "Unused money lapses on 31 Dec"; allowed: gym and fitness, mental health apps, wellbeing classes.
- Learning: USD 1,000.00 left of USD 1,000.00; allowed: courses, books, conference tickets; "Ask your manager before booking conferences".
- History: claims with date, merchant, amount (transaction currency and USD), status (Submitted, Approved, Paid, Returned).
- Actions: Claim, "Book through a partner" (92d, wallet-eligible offers).

Claim: wallet, category, amount and currency (INR 2,500.00 = USD 29.94), date, merchant, receipt (121 upload with 121a extraction), note; check line "USD 150.06 left after this claim". Submit.

Reviewer queue (Lakshmi Rao, People Ops reviewer for India): claims with person, wallet, category, amount, receipt thumbnail, flags (category mismatch, receipt reused from 17c); Approve, Return (reason), bulk approve for claims within balance with a matching receipt and category.

Program settings: name and icon (102b), funding budget (for example India Wellbeing), yearly amount per eligible person (USD 300.00), eligibility (employment types; contractors excluded by default), proration for joiners (monthly), categories, receipt required (always), payout (expense hand-off 117a or payroll 94b), lapse or carry (rollover policy 087c), taxable flag per entity (80h), reviewer per location.

## Data and permissions

New P15 `wallets` table (per the phase handoff): program, person, year, allowance, prorated allowance, consumed, status. Wallet programs are funded by a program budget: the budget's authorized amount covers the sum of allowances (per-head driver, 22a), each claim pre-encumbers on submission, encumbers on approval and becomes actual when paid through 117a or payroll (94b). Claims go to the program reviewer; with "Auto-approve within policy" on (105), claims within balance, category and with a verified receipt are approved automatically. Leavers' wallets close at deactivation; pending claims stay reviewable. Taxable programs update the employee benefit ledger (80h). Employees see only their own wallets.

## States

| State           | Behaviour                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------ |
| Default         | wallet cards and history                                                                   |
| Over balance    | error "This claim is USD 20.00 more than your USD 180.00 balance"; Submit disabled         |
| Wrong category  | warning "Course fees belong in Learning, not Feel Good" with "Move to Learning"            |
| Returned        | important tag with the reviewer's reason and "Fix and resubmit"                            |
| Approved / paid | success tags; paid shows "Added to your expense report" or "November payroll"              |
| Lapsing soon    | info banner in December "USD 180.00 lapses on 31 Dec"                                      |
| Frozen funding  | info banner "Claims are paused while India Wellbeing is frozen; submitted claims continue" |
| Not eligible    | no wallet card; 116 says "Wallets are for employees; contractors are not eligible"         |
| Loading / error | `sat-ghost`; error banner with Retry                                                       |

## Budget safety and audit

Wallet money never sits outside the ledger: allowances are capacity inside a program budget, and claims follow pre-encumbered, encumbered and actual like any spend, with freeze and zero controls applying to new claims. No cash advances. Claims, approvals, returns and program changes are audited; taxable amounts are reported through the benefit ledger.

## Responsive and accessibility

Mobile first for claims (camera receipt through 59b). Balances are stated in text ("USD 180.00 left of USD 300.00"); category chips have text labels.

## Satori components

`sat-interactive-card` (wallet cards), `sat-status-tag`, `sat-category-tag` (categories), `sat-upload-area` (receipt), `sat-banner`, `mat-table` with `sat-selection-bar` (reviewer queue), `sat-empty-state`, `sat-ghost`, `satImportantButton` (Submit claim); Angular Material form fields, select, dialog (return reason), snackbar; `bf-money`.

## Related screens and navigation

115 employee home, 116 available budgets, 121 upload receipt, 121a extraction, 59b mobile receipts, 117a expense hand-off, 094b payroll exports, 022a per-head driver, 087c rollover policies, 080h benefit ledger, 92d partner marketplace, 102b branding, 105 feature flags.

## Decisions taken

- Wallets are allowances inside a program budget, so every claim is a normal commitment and actual on the ledger. Recommended so stipends are controlled and reported like other spend.
- Every claim needs a receipt; there are no cash advances.
- Claims are reviewed by a program reviewer; automatic approval applies only when the company turns on "Auto-approve within policy" (off by default).
- Unused allowances lapse at year end by default (the program's rollover policy can carry them), and joiners are prorated monthly.
- Contractors are not eligible by default, matching the per-head eligibility rules.
