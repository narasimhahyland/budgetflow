# Visual QA: 080g tax recoverability, 080h employee benefit ledger

No approved Stitch design exists for either screen (Stitch quota, decision D2). Both were checked
against `docs/ux/screens/080g-tax-aware-consumption.md` and `080h-employee-benefit-ledger.md` and the
rules. There is no design-parity run.

States (light theme, desktop 1440, tablet 834, mobile 412):

- 080g: default (Finance Admin), calculator result, tax approver (Finance Controller), forbidden (employee).
- 080h: default ledger, person drawer, thresholds tab, forbidden (budget owner).

| Iteration | Captures | Automated blocking                     | Inspection blocking                    | Fixed                                                                                                                                        |
| --------- | -------- | -------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1         | 24       | 0                                      | 6 (`iter-1/inspection.md`)             | column spacing, "sales tax" wording, caption wrap, tax-code wrap, calculator entity default, thresholds table on tablet; plus two minor ones |
| 2         | 24       | 24 (sign-in state stale after a reset) | not inspected (`iter-2/inspection.md`) | re-ran the auth setup                                                                                                                        |
| 3         | 24       | 0                                      | 0 (`iter-3/inspection.md`)             | —                                                                                                                                            |

- Stop reason: no blocking findings (iteration 3).
- Fixes (before → after):
  - `before-after/080g-rules-tablet--before.png` → `--after.png`
  - `before-after/080h-thresholds-tablet--before.png` → `--after.png`
  - `before-after/080g-mobile--before.png` → `--after.png`
- Remaining non-blocking: on phones the Limit cell of the ledger splits the amount from "per head".
- Exploratory: the captures drive the calculator, the person drawer and the tabs as each role. The
  journeys in `apps/web-e2e/src/finance-admin/tax-benefits.spec.ts` click through them too.
- Baselines: 24 added for the two new screens with the `e2e:update-snapshots` command limited to
  them (`bash scripts/visual/pw-docker.sh npx playwright test -c apps/web-e2e/playwright.config.ts
--project=visual-light --update-snapshots -g "080g|080h"`, pinned image). Visual baselines updated:
  new screens 080g and 080h. No existing baseline changed.
