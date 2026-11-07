# `080e-period-close-checklist blocked › desktop`: baseline against the failing CI render

Images in this directory:

- `080e-blocked-desktop-expected.png` — the committed baseline (unchanged since `44aa29f`).
- `080e-blocked-desktop-actual-ci42326322339.png` — what CI rendered on the run whose visual step
  ran 01:53:01 → 02:04:21 UTC, taken from that run's `visual-report` artifact.

What differs, reading the two images:

|                              | Baseline                                                                                                               | Failing render                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Blocking banner              | "**10** checks must pass or be acknowledged…", listing `HYL-DE audit chain verified` and `HYL-US audit chain verified` | "**8** checks…", both audit-chain entries gone    |
| `Audit chain verified`       | Failed · "No check has verified the audit chain yet." · 1 item                                                         | Passed · "81 audit entries verified." · 81 items  |
| `Nightly ledger check clean` | Failed · "No ledger rebuild check has run yet; run one before the close."                                              | Failed · "1 integrity flag(s) are open."          |
| Row order                    | Failing checks first, then alphabetical — Audit chain, GL tie-out, Nightly ledger                                      | Audit chain has moved down into the passing block |

All three differences follow from one fact: a `ledger_rebuild` row now exists. Both checks read the
tenant's latest one, the row carries `summary.auditChain.valid = true` with a `checked` count, and
the seeded integrity flag is then the reason the nightly check still fails.

The count in "81 audit entries verified" is itself evidence that this is not a state anything
recorded deliberately: locally the same rebuild reports 80, because the number is however many
audit entries existed at the moment the rebuild ran.

The left navigation rail also differs — the baseline predates the Phase 13 AI screens being added
to it. That difference alone stays inside the allowance, which is why the `080e` desktop states
that do not render the checklist kept passing; it is the kind of invisible drift
`npm run visual:headroom` now reports.
