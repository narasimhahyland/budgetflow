# p3-org-master-data — gate review

- Commit: see `gate-summary.txt` (full gate on branch `feat/p3-org-master-data`, rebased on main after Phase 2 and the ledger hardening), reviewed 2026-11-04
- Scope: plan todo `p3-org-master-data` — org hierarchy with effective dating, legal entities, cost centers, fiscal calendar engine and period statuses, currencies and rate types with plan-rate lock, GL accounts and category-to-GL mapping, reason codes, vendor master, seeded DoA table, HR headcount import, scope-based visibility, CSV import. Screens 6, 7, 9, 22c, 33-42, 102a, 104a, 106, 106a-c, 107, 107a, 108, 108a (13 pages). Journeys in `apps/web-e2e/src/org` and `apps/web-e2e/src/finance-admin`.
- Result: passed with follow-ups — every gate mode is green and every P3 gate item is proven by API scenarios and journeys; 22c, 107 and 108 follow their proposed Stitch designs with documented deviations, and the other ten pages await designs.

## Gates

| Gate                                                                                  | Result                                                                            | Evidence                                              |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Secret scan                                                                           | PASS                                                                              | gate-summary.txt                                      |
| Lint (ESLint + satori-lint)                                                           | PASS                                                                              | gate-summary.txt                                      |
| Typecheck                                                                             | PASS                                                                              | gate-summary.txt                                      |
| Styles (stylelint)                                                                    | PASS                                                                              | gate-summary.txt                                      |
| Build (OpenAPI drift, migration check)                                                | PASS                                                                              | gate-summary.txt                                      |
| Satori design system check (sdsc)                                                     | PASS                                                                              | gate-summary.txt                                      |
| Functional API scenarios (apps/api-e2e)                                               | PASS (173 scenarios, 40 new)                                                      | gate-summary.txt, functional/api-scenarios-phase3.txt |
| Functional journeys (apps/web-e2e)                                                    | PASS (166 tests on desktop, tablet, mobile; 16 mutating ones run on desktop only) | gate-summary.txt, functional/journeys-phase3.txt      |
| Visual regression (pinned image)                                                      | PASS (33 baselines; app-shell refreshed for the new navigation)                   | gate-summary.txt                                      |
| Migration chain linear after rebase (`0002_ledger_hardening`, `0003_org_master_data`) | PASS                                                                              | `libs/api/db/migrations/meta/_journal.json`, db gate  |

## Acceptance checklist

| Criterion (plan phase gate P3)                    | Proven by                                                                                 | Role(s)                               | Result | Evidence                        |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------- | ------ | ------------------------------- |
| Hierarchy CRUD and effective dating               | api-e2e `org/effective-dating.spec.ts`; web-e2e `org/org-hierarchy.spec.ts`               | org-admin                             | PASS   | functional/README.md, api/05-08 |
| Scope visibility                                  | api-e2e `org/scope-visibility.spec.ts`; web-e2e `org/*`                                   | OA, FA, CEO, AUD, AN, RM, BO, DH, EMP | PASS   | api/01-04                       |
| Import interface                                  | api-e2e `org/imports.spec.ts`; web-e2e `org/people-headcount.spec.ts`                     | org-admin                             | PASS   | functional/README.md            |
| Fiscal calendar variants generate correct periods | api-e2e `finance/fiscal-calendars.spec.ts`; web-e2e `finance-admin/finance-setup.spec.ts` | FA, FC                                | PASS   | api/13                          |
| FX lookup by rate type and date                   | api-e2e `finance/fx-rates.spec.ts`; web-e2e `finance-admin/finance-setup.spec.ts`         | AN, FA                                | PASS   | api/09-12                       |
| HR headcount import                               | api-e2e `org/imports.spec.ts`; web-e2e `org/people-headcount.spec.ts`                     | OA, FA                                | PASS   | api/14-16                       |
| DoA seed                                          | api-e2e `finance/doa.spec.ts`; web-e2e `finance-admin/finance-setup.spec.ts`              | FA, FC, AUD, CEO                      | PASS   | api/17-20, db/doa-matrix.txt    |

## Invariant coverage

Rows 23-28 added to `docs/testing/invariant-scenarios.md` (effective dating, org scope, calendar engine, FX lookup and plan lock, headcount import, DoA resolution): 6 passing. Rows 7, 8 and 11 gained their Phase 3 parts; their later parts stay planned (P5, P6, P11).

## Seed (company Hyland; everything else fictional)

`db/seed-summary.txt`: 28 org units (company, business unit, 3 regions, 6 locations, 12 departments, 5 teams), 47 people, 4 legal entities (HYL-US USD, HYL-IN INR, HYL-DE EUR, HYL-UK GBP), 3 fiscal calendars (group Jan-Dec, India Apr-Mar, UK 4-4-5), 11 cost centers, 48 GL accounts and 88 mappings, 14 vendors, 16 reason codes, 27 exchange rates (plan, spot, month-end, monthly average), two headcount snapshots (216 and 460 people) and 16 DoA rows (`db/doa-matrix.txt`).

## Visual QA

| Item                                          | Result                                                                                                           | Evidence              |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------- |
| Screens x states captured                     | 14 x default at desktop, tablet, mobile x light (other states covered by journeys)                               | visual-qa/report.md   |
| Loop iterations                               | 2 of 5; stop reason: no blocking issues                                                                          | visual-qa/report.md   |
| Blocking findings in final iteration          | 0                                                                                                                | visual-qa/report.json |
| Console errors / failed requests              | 0 / 0                                                                                                            | visual-qa/report.json |
| Horizontal overflow / interpolation leftovers | none / none                                                                                                      | visual-qa/report.json |
| Design parity vs approved Stitch screens      | not applicable: no designs exist for Phase 3 screens                                                             | visual-qa/report.md   |
| Budget-safety visual rules                    | met (locked periods info tone, blocked vendors important tone, plan vs spot with the FX effect shown separately) | visual-qa/report.md   |

## Reviews

| Reviewer                  | Verdict                                                                                              | Blockers fixed | Remaining               |
| ------------------------- | ---------------------------------------------------------------------------------------------------- | -------------- | ----------------------- |
| ux-reviewer               | not run (this phase ran as a subagent without spawning reviewers)                                    | —              | run with visual-qa/     |
| domain-invariant-reviewer | not run (same reason)                                                                                | —              | run on the Phase 3 diff |
| security review           | not run; no auth, secrets, uploads, CI or infra changes beyond role-scoped reads and CSV text bodies | —              | optional                |

## Known issues and follow-ups

- Ten Phase 3 pages need Stitch designs; all 13 need design review (22c, 107 and 108 deviations in `visual-qa/design-parity/design-parity.md`); then add them to `apps/web-e2e/visual/screens.json` with seed-only lists.
- Phase 4: the seeded budget tree still holds the India and Europe region budgets in INR and EUR (Phase 1 data); move them to USD per the November 2026 decision when Phase 4 reseeds budgets. Per-head drivers read `GET /api/org/headcount` (latest snapshot by location and team, prorated in thousandths).
- Phase 5: enforce the seeded DoA matrix in approval routing (lookup logic and boundaries already proven); intercompany policy screens.
- Phase 6: actuals convert with `lookupExchangeRate`-equivalent selection (plan for control, actual rate stored for the FX effect).
- Org scope uses owned budgets' org units, scoped role grants and home units; `role_grants.scope_org_unit_id` is not yet set by the seed or an admin screen (Phase 7/14 user admin).
- The worktree guard hook treats files inside agent worktrees as outside the repository and blocks `rm`; scratch files were moved to the gitignored `tmp/` instead.

## Open UX questions

- 034 Organization chart: is the indented tree enough, or is a graphical chart wanted?
- 022c Headcount: should imports skip invalid rows (design) or stay all-or-nothing (current invariant 27)? Should team rows compare with a previous snapshot that was location-level only (they show the full count as change today)?

## Not in this pack

Traces, videos, auth state and raw logs: `tmp/gate/`, `dist/.playwright/` (local only).
