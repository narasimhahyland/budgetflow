# Phase 18 — security review

Branch `feat/p18-security`, against `main` at `c68d1dae`. **In progress.**

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
