# Phase 18 — security review

Finding 1: branch `feat/p18-security` (PR #98, merged). The rest of the review: branch `feat/p18-review`, against `main` at `fe51d7a4`. Break-glass (screen 112) is in [`break-glass/`](break-glass/) on `fix/clock-stage-3` and reaches `main` with that branch.

Run against the eight BudgetFlow-specific checks in `.cursor/skills/security-review-handoff/SKILL.md`.
That skill wraps Cursor's `/review-security`, which is not available in this environment, so the
checks were run directly against the code, the scenarios and the configuration, and every finding was
confirmed by reading the code and, where it can be, by an API scenario.

## Pre-checks

| Check                             | Result                                                                                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sh scripts/secret-scan.sh --all` | Clean, 3,835 files — [`secret-scan.txt`](secret-scan.txt)                                                                                          |
| `npm audit --omit=dev`            | 2 high, one issue: `multer` 2.0.0–2.4.0 denial of service, through `@nestjs/platform-express` — [`npm-audit-runtime.json`](npm-audit-runtime.json) |

**`multer` is not reachable from BudgetFlow's code.** No controller uses a file interceptor, which is
the only way Nest hands a request to `multer`; uploads go through the `DocumentStore` path instead.
A fix is available, and the dependency should be bumped before anyone adds an upload interceptor, but
that changes `package.json` and the lockfile, a shared surface that needs the user's approval.
**Status: documented, bump recommended.**

## Unauthenticated routes

18 routes are marked `@Public()`, so the session guard does not run on them. Each was read to see what
authenticates it instead.

| Routes                                                                               | Authenticated by                                                             | Verdict                     |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | --------------------------- |
| 5 ecosystem: BI feed, AI-assistant tools list and call, automation balance and draft | connection token (`identify`, kind-checked), then `PolicyService` per record | sound                       |
| 4 public API: meta, budgets, events, actuals import                                  | API key                                                                      | sound, **except finding 1** |
| SCIM user provisioning                                                               | API key with the SCIM kind                                                   | sound, **except finding 1** |
| Integration webhook, chat webhook                                                    | HMAC signature and a timestamp window, before any logic                      | sound                       |
| Email approval action (GET and POST)                                                 | signed, single-use, expiring link; only while pending                        | sound                       |
| Sign-in configuration, 3 health routes                                               | public by design; return status only                                         | sound                       |

## Finding 1 — API key and SCIM allowed networks can be bypassed (fixed on this branch)

**Severity: high.** An API key or SCIM token can be restricted to named networks (`allowedCidrs`),
which exists to contain a leaked key. The caller's address was taken from the first entry of the
`X-Forwarded-For` header, which any client can set, and no trusted proxy was configured. A leaked key
restricted to a company network could therefore be used from anywhere by sending one of that
network's addresses in the header. SCIM tokens are affected the same way, and SCIM creates and
deactivates people.

Three further defects in the same path:

- **Every direct request to a restricted key failed.** Without the header there was no address at
  all, so the check refused it — safe, but the feature did not work.
- **The range check compared whole octets only.** A `/20` behaved as a `/16`, admitting addresses the
  key's owner had excluded; IPv6 ranges could not match correctly.
- **Allowed-network entries were not validated.** `"office network"` or `10.0.0.0/99` was stored.

No scenario tested allowed networks at all, which is why none of this was caught.

**Demonstrated against the unfixed code** with `apps/api-e2e/src/integrations/api-key-network.spec.ts`:

| Test                                                                            | Expected                     | Unfixed |
| ------------------------------------------------------------------------------- | ---------------------------- | ------- |
| Key restricted to `203.0.113.0/24`; caller sends `X-Forwarded-For: 203.0.113.9` | 403 `API_KEY_IP_NOT_ALLOWED` | **200** |
| Key allowing every address; direct request, no header                           | 200                          | **403** |
| Allowed-network entry `office network`                                          | 422 `VALIDATION_FAILED`      | **201** |

**Fix.** `libs/api/core/src/lib/client-ip.ts`: the caller's address is the connection's own peer
address, and `X-Forwarded-For` is believed only when that peer is a configured trusted proxy, read
from the right so a forged hop cannot be prepended. Ranges are matched bit by bit with Node's
`net.BlockList`, IPv4 and IPv6. `TRUSTED_PROXY_CIDRS` (optional, empty by default, validated at
startup) names the proxies; empty means the header is ignored. Invalid allowed-network entries are
refused with 422 when a key is made.

Not proven over HTTP: the `/20` precision fix. From the host every request reaches the API from one
gateway address, so a scenario cannot originate from inside and outside a `/20` at will.

**Deployment note.** A deployment behind a reverse proxy must set `TRUSTED_PROXY_CIDRS` to that proxy,
or restricted keys will see the proxy's address. The variable belongs in `infra/.env.example`, which is
a shared surface and blocked to this session; the user is adding it.

## Verification of the fix

The same scenario that failed against the unfixed code passes against the fix: the spoofed header is
refused (403 `API_KEY_IP_NOT_ALLOWED`), a direct request is judged by its own address (200), and an
invalid entry is refused (422).

[`gate-summary.txt`](gate-summary.txt), `scripts/gate.sh static functional-api functional-e2e` on
`6e1bef38`: every static step, the stack and `functional-api` pass. **`functional-e2e` failed on one
journey file, unrelated to this change:** `shell/home-overview.spec.ts`, three CEO tests. The page
showed "See all 77" on one attempt and "See all 80" on another while the journey expected 50 — a count
that changes between attempts of the same test is nondeterminism, not a regression. The journey takes
its expected count from the first health response the page receives, while the page can render from a
later one, by which time journeys running in parallel have created more budgets. This change touches
only how API keys resolve the caller's address. PR #97, merged to `main` after this branch was cut, already
makes that journey concurrency-safe; this PR's CI tests the merge with `main`, so it runs the fixed journey.

## The eight checks

| #   | Check                                                                    | How it was checked                                                                                                                                                                                                                                                                        | Result                                                                                 |
| --- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | No tokens, keys, `.env`, HAR or trace files; `.npmrc`; CI token handling | tracked-file search; `.npmrc`; every workflow: the token is checked without echo, jobs skip without it, `permissions: contents: read`, actions pinned, no `pull_request_target`                                                                                                           | clean, except **finding 6** (traces)                                                   |
| 2   | No internal URLs, ticket keys or names                                   | search of every tracked file for internal domains, ticket prefixes and personal names                                                                                                                                                                                                     | clean (only the owner's public GitHub handle and Pages site)                           |
| 3   | One authorization point; no endpoint skips it                            | **every authenticated GET endpoint** (187) called as the platform operator and as an employee, with real ids harvested from all-seeing roles ([`authz-probe-operator-before.tsv`](authz-probe-operator-before.tsv), [`authz-probe-employee-before.tsv`](authz-probe-employee-before.tsv)) | **findings 2 and 4**; a sweep scenario now keeps every endpoint closed to the operator |
| 4   | Tenant isolation by RLS, not only filters                                | Phase 17 migration scenario (RLS enabled and forced on every tenant table); every database call outside `withTenant` read                                                                                                                                                                 | clean: only the scheduled sweeps list tenants, then work per tenant                    |
| 5   | Money in minor units; no over-allocation under concurrency               | `budgets/concurrent-allocation`, `budgets/idempotency` and the over-allocation boundary scenarios (full API suite)                                                                                                                                                                        | clean                                                                                  |
| 6   | Ledger and audit append-only; hash chain not bypassable                  | `ledger/reversal` and `audit/hash-chain` (the database refuses UPDATE, DELETE, TRUNCATE as the app role; tampering is found)                                                                                                                                                              | clean                                                                                  |
| 7   | Input validated; no unsafe HTML; uploads limited; CSV safe               | no `innerHTML` or `bypassSecurityTrust*` anywhere; uploads: type allowlist, declared and actual size, leading bytes sniffed; every CSV writer read                                                                                                                                        | **finding 3** (CSV formulas)                                                           |
| 8   | Hooks fail open only on internal errors; no secret logged                | `node .cursor/hooks/test-hooks.mjs` (108/108), `sh scripts/validate-harness.sh` (OK), hooks read for logging                                                                                                                                                                              | clean                                                                                  |
| —   | Secrets in the running product (beyond the checklist)                    | every secret the API and worker read, and what happens when it is unset                                                                                                                                                                                                                   | **finding 5**                                                                          |

## Finding 2 — the platform operator read two kinds of tenant data (fixed)

**Severity: medium.** A platform operator without a break-glass grant holds no tenant permission, so
every endpoint should refuse it. Of 187 authenticated GET endpoints, 26 answered 200; 24 of those
returned nothing (scope filtering worked) and two returned data:

- `GET /api/events/templates`: the company's event templates with per-attendee cost estimates and
  tolerances. The endpoint filtered rows but never asked the policy whether the caller may read the tenant.
- `GET /api/org/headcount`: the company's headcount (460 over 17 lines) in the snapshot summary,
  although the operator's own scope was empty.

**Fix.** Both require `tenant.read`, so the operator gets 404, as everywhere else.
**Proof.** `apps/api-e2e/src/scope/operator-isolation.spec.ts`: a sweep calls every parameter-free GET
endpoint in the contract registry as the operator and fails on any that answers with data, so the
next endpoint that forgets its check is caught; plus a test per endpoint.

## Finding 3 — CSV exports ran formulas (fixed)

**Severity: medium.** Three exports quoted cells but did not neutralise formulas, so a cell starting
with `=`, `+`, `-` or `@` runs when the file is opened in a spreadsheet: the tie-out export (the
difference explanation), the accrual journal export (the commitment description, which comes from a
request a requester typed) and the budgets list and hierarchy exports (budget names). The audit log
and co-funding board exports already neutralised them.

**Fix.** `libs/api/actuals/src/lib/csv.ts` and the web `downloadCsv`: a text cell starting with one of
those characters, a tab or a carriage return gets a leading apostrophe; numbers, negative amounts
included, stay numbers. **Proof.** `actuals/accruals.spec.ts` exports a description starting with
`=HYPERLINK(` and `actuals/tieout.spec.ts` an explanation starting with `+`; both arrive as text.

## Finding 4 — every member could read legal holds (fixed, user decision)

**Severity: low to medium.** `GET /api/admin/retention/holds` was gated on `tenant.read`, which every
member holds, so an employee could read which records are frozen pending a review, and why. The
retention screen spec (111) names Organization Admin, Finance Admin, Finance Controller and Auditor.
**Decision (user):** only they read holds. **Fix.** The endpoint accepts any of `tenant.settings.manage`,
`master_data.manage`, `retention.confirm` or `legal_hold.manage`; no policy change. Retention policies
stay readable by every member. **Proof.** `admin/retention.spec.ts`: the four roles read, employee,
budget owner, analyst, CEO and integration admin get 403.

Other administration reads open to every member (company settings, feature flags, retention policies,
system health, maintenance notices, the setup checklist, finance reference data) were reviewed and
left as built: they are the Phase 14 design (administration reads on `tenant.read`) and carry no
financial or personal data beyond reference data members need to fill in forms.

## Finding 5 — signing and encryption secrets fell back to public values (fixed, user decision)

**Severity: high.** Five secrets fell back to values written in this public repository whenever they
were not set, in any environment, at most with a log warning:

| Secret                                         | What a forger gets                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| `CHAT_LINK_SECRET`                             | link their chat account to anyone, then approve in chat as that person |
| `SLACK_SIGNING_SECRET`, `TEAMS_WEBHOOK_SECRET` | send webhooks that verify                                              |
| `APPROVAL_LINK_SECRET`                         | forge one-click email approval links                                   |
| `INTEGRATIONS_SECRET_KEY`                      | decrypt every stored integration credential from a database copy       |

**Decision (user):** refuse to start. **Fix.** `secretOrDev` in `libs/api/core/src/lib/secrets.ts`:
the configured secret (16 characters or more); the development value only outside production or with
`BF_ALLOW_DEV_SECRETS=true`, with one warning per secret; otherwise an error naming the variable.
The API and worker resolve all five at startup. The local stack opts in (`infra/compose.yaml`, API
and worker). **Proof.** `apps/api-e2e/src/security/dev-secrets.spec.ts` starts the built API and worker
bundles: production without secrets refuses and names the variable; one missing secret is enough;
real secrets, or the opt-in, pass the check and Nest starts.

**Deployment note.** A deployment sets all five to random values and never sets
`BF_ALLOW_DEV_SECRETS`. They belong in `infra/.env.example` as empty placeholders with a comment, which
is a shared surface blocked to this session; the user is adding them with `TRUSTED_PROXY_CIDRS`.

## Finding 6 — CI uploaded traces in public artifacts (fixed, user decision)

**Severity: low.** Journeys kept a trace on failure, and CI uploads the Playwright report, which embeds
them. This repository is public, so anyone can download artifacts. The traces held short-lived tokens
from the throwaway CI Keycloak and the placeholder test password (already public in
`infra/.env.example`). **Decision (user):** no traces in CI by default, with an opt-in, because the first step on #82 (the
blank-render flake) is capturing a trace. **Fix.** `apps/web-e2e/playwright.config.ts` records traces
locally as before; in CI only when the run sets `BF_CI_TRACES=1`, and then for failing tests only.
Screenshots and logs still upload.

## Verification of the review

[`gate-summary-review.txt`](gate-summary-review.txt): `scripts/gate.sh static functional-api functional-e2e`
on this branch merged with `main` (real-date fix and break-glass), fresh seed: every step passes,
including the full API suite (with the new operator sweep, startup secret check and legal-hold
scenarios) and every journey. Visual was not run: the project-wide re-record is in progress, and
this change moves no baseline.

## Still open

- `multer` bump (pre-checks, above): needs the user's approval for `package.json` and the lockfile.
- `infra/.env.example`: `TRUSTED_PROXY_CIDRS`, the five secrets and `BF_ALLOW_DEV_SECRETS` (local
  stack only), added by the user.
