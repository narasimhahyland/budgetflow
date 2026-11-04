# Evidence

One folder per phase or wave (`evidence/<phase-id>/`), assembled by `/phase-review`:

- `README.md` — gate review: scope, gate table, acceptance checklist (each item proven functionally), core acceptance scenario (every wave gate from Wave 2), visual QA, reviews, known issues, open questions
- `gate-summary.txt` — `scripts/gate.sh ... --evidence` output
- `<change>/functional/` — `/functional-check`: outcome table (scenario, role, expected, actual, result), `api/` responses with tokens redacted, `screens/` of key states, `logs/` excerpts
- `acceptance/` — the core acceptance scenario run with per-step outcomes
- `visual-qa/` — `/visual-qa`: `report.md`, `report.json`, `screens/<NNN-slug>--<state>--<viewport>--<theme>.png`, `design-parity/`, `before-after/`, `exploratory.md`
- `perf/` — autocannon results when a gate asks

Traces, videos, HAR files, saved auth state and raw logs stay in `tmp/evidence/` (gitignored). They contain tokens, and this repository is public.
