# Gap B5: finance and payroll exports

Package B5 of [`docs/gap-closure-plan.md`](../../docs/gap-closure-plan.md): screen 094b
(`/finance/exports`) with exports for intercompany recharges, chargeback and reclass journals, and
payroll benefit data. Before this package only the accruals export (080d) existed and 094b had no
endpoint.

Decisions that apply:

- **D2:** the screen is built from the written spec
  ([`094b-finance-payroll-exports.md`](../../docs/ux/screens/094b-finance-payroll-exports.md)); there is
  no approved Stitch design. What was decided while building is in the spec's "As built" section.

## What it does

- **Sources.**
  - Intercompany recharges: the balanced due-from / due-to journal of each recharge whose tax
    approval is done (053a approved, scheduled, exported or posted).
  - Chargeback and reclass: manual journals and reversals that touch posted actual spend.
  - Payroll benefits: each person's reportable benefit-in-kind amount per threshold and tax year,
    from the B3 benefit ledger as of the month end, then only what became reportable since the last
    export.
- **Balance.** GL lines map to ERP accounts:
  - actual spend uses the line's GL account, else the entity's category mapping, else its "other"
    mapping;
  - counter accounts use fixed codes: 1300, 2300, 2000, 7900 and 2100;
  - budget-control buckets never reach the GL.

  An export is created only when debits equal credits in the reporting currency (payroll: totals per
  person instead).

- **Exactly once.** Each export line records its source. A unique index on first sends
  (`finance_export_lines_once`) means a ledger line is exported once. Re-sending needs a reason and
  is a duplicate send in the batch, its lines and the file. Export lines are append-only.
- **Never moves money.** Exports read posted journals and the benefit ledger. Recharges move to
  Exported and then Posted on 053a; nothing posts to the ledger.
- **Files.** Each export produces a CSV and an XLSX in the `DocumentStore` under
  `tenants/<id>/finance-exports/`. They download through five-minute signed links, and every CSV
  cell goes through `csvCell`, which neutralises formulas.
- **Audit.** `finance_export.created`, `finance_export.resent` (with the reason),
  `finance_export.downloaded` (one per link handed out) and `finance_export.marked_posted`.
- **Scope.**
  - `finance_export.read`: Finance Admin, Finance Controller, Auditor, Integration Admin.
  - Lines and files also need `actuals.read`, or `benefits.read` for payroll, so the Integration
    Admin sees the list but no lines or files.
  - `finance_export.manage` (Finance Admin) creates exports and marks them posted.
  - The platform operator without a grant is refused (404).

Not built (recorded in the gap plan): delivery by ERP connector (the target is a file; Acknowledged
and Failed are reserved for it), accruals and prepaid releases as types on this screen (accruals keep
their 080d export), and a read-only mobile list.

## Gates

`scripts/gate.sh` (all modes), 12-13 November, on a machine running seven local stacks:
[`gate-summary.txt`](gate-summary.txt).

| Mode                                                         | Result                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| secrets, lint, styles, satori, typecheck, build, openapi, db | PASS                                                                                                                                                                                                                                                                                                              |
| functional-api                                               | 651 passed, 2 failed in the full run; both were 60-second timeouts in specs B5 does not touch (`close/period-close.spec.ts` reopen, `integrations/navan.spec.ts` read-only scope). Re-run on a fresh stack: both pass, with `finance/finance-exports.spec.ts` and `scope/operator-isolation.spec.ts` (30 passed). |
| functional-e2e                                               | First run: 601 passed, 6 flaky, 1 failed (this package's journey picked rows by account code while other journeys had added Germany recharges). Fixed to check the seeded recharge by its journal; re-run `scripts/gate.sh functional-e2e visual`: PASS.                                                          |
| visual                                                       | First run failed broadly under load; re-runs: every non-AI screen passes (094b 9/9); AI screens differ because this stack has no Bedrock credentials; 101-api-keys is pre-existing. Details in [`visual-rerun.txt`](visual-rerun.txt).                                                                            |

## Functional outcome

Commands: `scripts/stack.sh up && scripts/stack.sh reset`, then
`npx playwright test -c apps/api-e2e/playwright.config.ts finance/finance-exports.spec.ts` and
`npx playwright test -c apps/web-e2e/playwright.config.ts finance-admin/finance-exports.spec.ts`.
Roles: finance-admin, finance-controller, auditor, integration-admin, budget-owner, employee,
super-admin.

| Scenario                               | Expected                                                                                                                                                                             | Actual                                            | Result |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | ------ |
| Recharge export vs the ledger          | lines equal the posted journal's lines; due from (HYL-DE, 1300) and due to (HYL-IN, 2300) net to zero in reporting and transaction currency; debits = credits                        | as expected (seeded pair USD 252.00 / USD 252.00) | pass   |
| Exactly once                           | second create 409 `FINANCE_EXPORT_NOTHING_TO_EXPORT`; re-send without reason 422 `FINANCE_EXPORT_REASON_REQUIRED`; with reason: duplicate batch, every line and CSV row flagged      | as expected                                       | pass   |
| Idempotency                            | same key replays the first batch with `Idempotent-Replayed`                                                                                                                          | as expected                                       | pass   |
| 053a status                            | recharge approved → exported on export → posted on Mark posted                                                                                                                       | as expected                                       | pass   |
| Chargeback and reclass vs the ledger   | each journal balances; every line equals the ledger line by line; GL 6100 with the budget's cost center                                                                              | as expected                                       | pass   |
| Exports never move money               | budgets read the same before and after an export                                                                                                                                     | as expected                                       | pass   |
| Not balanced                           | actual offset only by a BudgetFlow-only account: preview names debit and credit totals; create 422 `FINANCE_EXPORT_NOT_BALANCED`                                                     | as expected                                       | pass   |
| CSV formulas                           | a reason starting `=HYPERLINK(` is written with a leading apostrophe                                                                                                                 | as expected                                       | pass   |
| Payroll vs the benefit ledger          | per-person totals equal the ledger's reportable amounts (Oliver Hayes GBP 168.00, tax year 2026-04-06 to 2027-04-05); then nothing new; a GBP 12.00 benefit offers only the increase | as expected                                       | pass   |
| Mark posted                            | once; second 409 `FINANCE_EXPORT_ALREADY_POSTED`                                                                                                                                     | as expected                                       | pass   |
| Audit                                  | created, resent (with reason), downloaded (one per link), marked_posted                                                                                                              | as expected                                       | pass   |
| Scope                                  | FC and AUD read with no create or Mark posted (403); IA list only, lines, files and preview 403; budget owner, employee and operator refused                                         | as expected                                       | pass   |
| Operator sweep                         | every parameter-free GET closed to the operator                                                                                                                                      | as expected                                       | pass   |
| Journey: create and download each file | recharge CSV and XLSX, chargeback CSV, payroll CSV via the UI; payroll then offers nothing new and a re-send needs a reason; Mark posted shows the document number                   | as expected                                       | pass   |
| Journey: integration admin             | list visible, no New export, no row actions                                                                                                                                          | as expected                                       | pass   |
| Role navigation                        | Finance exports in the nav for FA, FC, AUD and IA; matches `/api/me` permissions                                                                                                     | as expected                                       | pass   |

Two scenarios export seeded items (the Diwali recharge and the UK payroll), so they expect a freshly
seeded stack, as `scripts/gate.sh` provides between suites.

- API samples (tokens redacted): [`api/`](api/): previews for recharges and payroll, the month's
  list, the integration admin's 403 and the operator's 404.
- Screenshots: [`functional/screens/`](functional/screens/): the populated list after the journey,
  the payroll lines dialog, and the integration admin's view.
- Invariants 122-125 in [`docs/testing/invariant-scenarios.md`](../../docs/testing/invariant-scenarios.md).

## Visual

[`visual-qa/report.md`](visual-qa/report.md): five iterations, stopped with no blocking findings. The
ux-reviewer verdict was "pass with non-blocking findings", and three of those findings were fixed in
iteration 5. Nine baselines were added for 094b.

The full visual suite in the first gate run failed broadly: 739 failed and 258 passed over 6.7 hours,
with browser crashes and 15-second waits failing on every screen while seven stacks shared the
machine. The re-runs ([`visual-rerun.txt`](visual-rerun.txt)) pass every non-AI screen, 094b included.
The AI screens differ because this worktree's stack has no Bedrock credentials, so the seed skips
their data, and `101-api-keys` fails on main too. After merging main (B4 and B8 added navigation items), a tablet visual run passes every screen
except `113a` (AI data): the "Finance exports" item no longer changes any baseline outside 094b, so the
interim `092` tablet baseline update was dropped in favour of main's.

## Migration and shared surfaces

- Migration `0025_b5_finance_exports` adds `finance_export_batches` and `finance_export_lines`, with
  RLS forced, a tenant isolation policy and append-only lines. 0024 is B2 part 2's, which is not yet
  on main; after merging main (0024, 0026, 0028, 0029) it sits at journal index 28.
- Contracts (additive): `domains/finance-exports.ts`, and problem codes `FINANCE_EXPORT_*` in
  `common.ts`. OpenAPI is regenerated.
- Policy: `finance_export.read` and `finance_export.manage`, with their rows in
  `docs/architecture/authorization.md`.

## Follow-ups

- ERP connector delivery with acknowledgements and failures (094 Push tab, 100).
- Accruals, reversals and prepaid releases as export types here, replacing 080d's separate export.
- 080h shows tax-year dates one day early in browsers ahead of UTC (`date: … : 'UTC'` on date-only
  values); fixed here for 094b only.
- The benefit ledger's `exported` flag (080h) could read the payroll export lines.
