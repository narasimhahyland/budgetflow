# p2-shell-auth — gate review

- Commit: see `gate-summary.txt` on `feat/p2-shell-auth`, reviewed 2026-11-04
- Scope: plan todo `p2-shell-auth` — Keycloak realm with seeded users for all 14 roles in the single Hyland tenant, OIDC sign-in with PKCE, SSO (Hyland SSO broker and SSO session reuse), MFA (TOTP), forgot password, Satori shell with the company name only (no tenant or organization switcher), role-aware navigation, guards, unauthorized/forbidden/error states, money/number/date formatting (currency code, lakh/crore for INR, user timezone), product analytics pipeline. Screens: 000a shell; 001-004 rendered by Keycloak with the BudgetFlow theme. Also: ADR 0006 (Nov 2026 product decisions) and the harness seed wording.
- Result: **passed with follow-ups** — every gate passes (`gate-summary.txt`), 110 API scenarios and 92 journeys (plus 14 sign-ins) green, visual QA ends with no blocking findings, both reviewers' blockers fixed. Screens 5, 8, 10, 102-104 and 124 are not built: they have no Stitch design (see Follow-ups).

## Gates

| Gate                                                  | Result                                                                                    | Evidence                                          |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Secret scan                                           | PASS                                                                                      | gate-summary.txt                                  |
| Lint (ESLint with module boundaries, satori-lint)     | PASS                                                                                      | gate-summary.txt                                  |
| Styles (stylelint, Satori adoption, tokens only)      | PASS                                                                                      | gate-summary.txt                                  |
| Satori design system check (sdsc)                     | PASS                                                                                      | gate-summary.txt                                  |
| Typecheck                                             | PASS                                                                                      | gate-summary.txt                                  |
| Build (api, worker, web)                              | PASS (web initial bundle 1.95 MB is over the 1.5 MB warning budget, under the 3 MB error) | gate-summary.txt                                  |
| OpenAPI drift, migration check                        | PASS (no migration in this phase)                                                         | gate-summary.txt                                  |
| Local stack reset and deterministic seed              | PASS                                                                                      | gate-summary.txt                                  |
| Functional API scenarios (apps/api-e2e)               | PASS (110 scenarios: 56 Phase 1 + 54 Phase 2)                                             | gate-summary.txt, shell-auth/functional/README.md |
| Functional journeys (apps/web-e2e)                    | PASS (92 journeys on desktop, tablet, mobile after 14 real sign-ins)                      | gate-summary.txt, shell-auth/functional/README.md |
| Visual regression (pinned Playwright image)           | PASS (33 baselines)                                                                       | gate-summary.txt, visual-qa/report.md             |
| Harness validation (`sh scripts/validate-harness.sh`) | PASS                                                                                      | command output in the PR                          |

## Acceptance checklist (plan's P2 gate, as amended by the binding decisions)

| Criterion                                                                      | Proven by                                                                                      | Role(s)                                         | Result            | Evidence                            |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------- | ----------------------------------- |
| Login with deep-link return; wrong password refused                            | web-e2e `auth/sign-in.spec.ts`                                                                 | auditor, department-head                        | PASS              | shell-auth/functional/screens/01-02 |
| SSO: Hyland SSO broker; SSO session reused in a new tab                        | web-e2e `auth/sso.spec.ts`, `auth/sign-in.spec.ts`                                             | employee, analyst                               | PASS              | shell-auth/functional/screens/05-06 |
| MFA: code required in the browser and for tokens                               | web-e2e `auth/mfa.spec.ts`; api-e2e `identity/me.spec.ts`                                      | mfa-user                                        | PASS              | screens/03-04, api/10               |
| Forgot password through Mailpit                                                | web-e2e `auth/forgot-password.spec.ts`                                                         | reset-user                                      | PASS              | screens/07                          |
| Sign-out ends the session                                                      | web-e2e `auth/sign-in.spec.ts`                                                                 | budget-owner                                    | PASS              | shell-auth/functional/README.md     |
| Tenant/org switching                                                           | not built — binding decision: one company, no switchers (ADR 0006); journeys assert none exist | all 14                                          | PASS (as decided) | `shell/role-navigation.spec.ts`     |
| Unauthorized blocked: no token, tampered token, ended session                  | api-e2e `identity/me.spec.ts`; web-e2e `shell/states.spec.ts`                                  | various                                         | PASS              | api/06                              |
| Role-aware navigation for all 14 roles, cross-checked with API permissions     | web-e2e `shell/role-navigation.spec.ts`; api-e2e `identity/me.spec.ts`                         | all 14                                          | PASS              | api/02-04                           |
| Forbidden in place, not found, server error, not a member, platform operator   | web-e2e `shell/states.spec.ts`                                                                 | employee, finance-controller, super-admin       | PASS              | visual-qa/iter-5/screens            |
| Money formatting incl. lakh/crore; user timezone                               | web-e2e `shell/formatting.spec.ts` (independent Intl formatting of API minor units)            | regional-manager, department-head, budget-owner | PASS              | screens/08                          |
| Analytics events emitted and stored per tenant                                 | web-e2e `shell/analytics.spec.ts`; api-e2e `identity/analytics.spec.ts`                        | integration-admin, analyst, employee            | PASS              | api/07-09                           |
| Tenant and role scope with real tokens (cross-tenant and out-of-scope refused) | api-e2e `identity/role-scope.spec.ts`, `identity/tenant-isolation.spec.ts`, `scope/*`          | all 14, globex-admin                            | PASS              | api/05                              |
| Onboarding wizard (screens 5, 8, 10)                                           | not built — no Stitch design yet                                                               | –                                               | follow-up         | –                                   |

## Invariant coverage

Rows 17 and 18 in `docs/testing/invariant-scenarios.md` now also cite the Phase 2 scenarios; all 13 rows that had passing scenarios still pass (full suite 110/110). No new invariants.

## Visual QA

| Item                                                       | Result                                                                                        | Evidence                                             |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Screens x states captured                                  | 2 screens, 11 states x desktop, tablet, mobile x light (dark deferred)                        | visual-qa/report.md                                  |
| Loop iterations                                            | 5 of 5; stop reason: no blocking findings                                                     | visual-qa/report.md                                  |
| Blocking findings in final iteration                       | 0                                                                                             | visual-qa/iter-5/report.json                         |
| Console errors / failed requests / overflow / layout shift | none                                                                                          | visual-qa/iter-5/report.json                         |
| Design parity                                              | 4 states compared; deviations accepted and explained                                          | visual-qa/report.md, visual-qa/iter-5/design-parity/ |
| Budget-safety visual rules                                 | budget vs reporting currency distinct (secondary "Reporting USD" line); status tags with text | visual-qa/inspection.md                              |
| Exploratory pass                                           | scripted sessions plus journeys                                                               | visual-qa/report.md                                  |
| Before/after of fixes                                      | 6 pairs                                                                                       | visual-qa/before-after/                              |

## Reviews

| Reviewer                  | Verdict                                                                 | Blockers fixed                                                                                                                                                     | Remaining (non-blocking)                                                                                                                                                                                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ux-reviewer               | blocking (1) → fixed in iteration 5                                     | placeholder card padding; also 404 title, drawer tooltip, employee card                                                                                            | Keycloak default copy (title case, MFA heading without instructions, PatternFly focus colour); rail avatar shows one initial; account menu shows role while Home shows job title; INR Home not in baselines; longest menu (Finance Controller) not captured open on mobile; 000a designs still "proposed" |
| domain-invariant-reviewer | pass with findings (110/110 scenarios)                                  | analytics property allowlist (route templates only), batch fits the body limit (was a 500), future timestamps limited to 5 minutes, reverse forged-header scenario | per-user rate limit on analytics; `platformOperator` derived from "no tenant.read" (an expired-grants member would be flagged); fiscal years on `/api/me` without a policy decision (documented as non-financial settings); oversized bodies still map to 500 in the shared problem filter                |
| security review           | not run — the Security Review subagent runs only on an explicit request | –                                                                                                                                                                  | recommended before release for the OIDC code (`libs/web/data-access/src/lib/auth.service.ts`) and realm settings                                                                                                                                                                                          |

## Follow-ups

- Screens without designs: first-time setup (5, 8, 10), tenant settings (102), users and roles (103), permission matrix (104), profile and preferences (124); global search; notifications data (P5/P8).
- Keycloak theme messages (sentence case, MFA instructions, focus colour) and the brand panel copy.
- Lazy-load feature routes; the Satori icon sprite keeps the initial bundle near 1.9 MB.
- MFA is enforced for users enrolled in TOTP (the seeded MFA user); enforcing it per role (finance, admin, auditor) is a realm policy decision.
- Analytics: per-user rate limit; `AnalyticsService.track` calls from P4-P6 commands; KPI read model and dashboard (P10).
