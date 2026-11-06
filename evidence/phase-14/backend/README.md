# Phase 14 — Experience and administration (backend half)

Branch `feat/p14-admin-backend`, base `origin/main` (`2a94730`). Local stack
`bf-p14-admin` (API 3190, Keycloak 8270, Postgres 5622), deterministic seed.
Angular screens are **not** in this change; a frontend agent builds them against these endpoints.

## Outcome

| Area                                      | Outcome                                                                                                                            | Where                                |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Feature flags (105)                       | Flags by area with pilot rollout, dependency checks, money-affecting confirmation and history; `/api/me/features` per person       | `api-scenarios.log`, scenarios 1-7   |
| Data retention and legal holds (111)      | Provisional periods per category, preview before any deletion, two-person legal holds, append-only run reports, nightly worker job | `api-scenarios.log`, scenarios 8-16  |
| User and role administration (103, 103a)  | People with their roles, grants that cannot create authority, revocation effective immediately, bulk owner invites behind a flag   | `api-scenarios.log`, scenarios 17-23 |
| Company settings (102b, 109, 110, 112)    | Branding, notification defaults and quiet hours, upload rules from a safe list, session limits                                     | `api-scenarios.log`, scenarios 24-28 |
| System health and maintenance (114)       | Services, queues, outbox lag and nightly jobs with no financial data; maintenance notices for the shell banner                     | `api-scenarios.log`, scenarios 29-30 |
| Guided setup (10a) and own activity (122) | Checklist computed from the data that exists; a person's own timeline and totals, with no person parameter                         | `api-scenarios.log`, scenarios 31-32 |

## Gates

| Gate                                                                         | Result                                                     |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `scripts/gate.sh static` (lint, typecheck, build, OpenAPI drift, migrations) | PASS — `gate-static.log`                                   |
| `api-e2e:functional-api` (whole suite, clean reseeded stack)                 | PASS — 447 scenarios, `functional-api-full.log`            |
| `api-e2e:functional-api` (Phase 14 only)                                     | PASS — 32 scenarios, `api-scenarios.log`                   |
| `functional-e2e`, `visual`                                                   | Not run locally (no web change in this half); CI runs them |

## The three guardrails, and proof they are not vacuous

Each guardrail was deliberately weakened, the scenario re-run against the rebuilt API, and the
guardrail then restored. The failing runs are kept here.

| Guardrail                                                              | Weakening                                                     | Result                                               |
| ---------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------- |
| A legal hold beats retention (`applyLegalHolds` in `libs/domain`)      | `holdsCovering` replaced by an empty list                     | Scenario fails — `mutation-legal-hold.log`           |
| A flag never grants an action (`policy.assert` beside `assertEnabled`) | `users.manage` assertion removed from the bulk-invite command | Scenario fails — `mutation-flag-authorization.log`   |
| Administration cannot create authority (`assessRoleGrant`)             | `needsConfirmation` forced to `false`                         | Scenario fails — `mutation-privilege-escalation.log` |

## Placeholders that still need finance and legal sign-off

Every row in `retention_policies` carries `signoff_status = 'provisional'`. The periods below are
product defaults, not an approved legal position, and the API says so in `RetentionPolicyList.note`:

financial records and evidence 8 years after the fiscal year closes (7-year minimum), event records
8 years, attendee needs 30 days, survey responses 24 months, event photos 12 months, product
analytics 25 months, notifications 12 months, webhook deliveries 90 days, leaver anonymisation
90 days after the person left.

## Notes

- Destructive retention runs happen in the Initech Sandbox tenant, on analytics events the scenario
  records itself, and the scenario restores the periods and releases its holds afterwards.
- The flag dependency scenario disconnects and reconnects the Teams app itself rather than trusting
  the state another scenario leaves behind.
- Raw Playwright traces stay in `tmp/`; only these summaries are committed.
