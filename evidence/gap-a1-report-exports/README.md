# Gap A1 — report file exports

Package A1 of `docs/gap-closure-plan.md`: exports produce real CSV, XLSX and PDF files from the
screen's own run, through the `DocumentStore`, and scheduled emails carry them.

| Check                                            | Result                                                                                              | Evidence                              |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `scripts/gate.sh static functional`              | PASS (secrets, lint, styles, satori, typecheck, build, openapi, db, functional-api, functional-e2e) | `gate-summary.txt`                    |
| Visual regression (pinned image, `visual-light`) | 942 passed, 2 flaky unrelated (AI-caption id wrap)                                                  | `visual-qa/report.md`                 |
| Functional outcome table                         | 7 API scenarios, 2 journeys, all pass                                                               | `functional/README.md`                |
| Visual QA loop                                   | 2 iterations, no blocking findings; ux-reviewer pass                                                | `visual-qa/`                          |
| API samples (signature and credential redacted)  | export created, signed download link                                                                | `api/`                                |
| Invariant map                                    | row 99                                                                                              | `docs/testing/invariant-scenarios.md` |

Note: `scripts/gate.sh visual` was not used. This worktree has no `.env` (the guard hook blocks
creating one) and `scripts/visual/pw-docker.sh` forwards only `BF_E2E_*`, so the container would read
the default ports and test whichever stack owns them. The compare ran with the same image and flags
plus this stack's `BF_*_PORT` values.
