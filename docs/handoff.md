# Handoff: state of play

Written 2026-11-07 against `main` at `23b36c3`, for whoever picks this repository up next.

[`README.md`](../README.md) says what BudgetFlow is and how to run it; [`AGENTS.md`](../AGENTS.md)
says how to work in it. Neither says **where the build actually is, what was deliberately not built,
or what has already cost someone a day to learn**. That is what this page is for. It will go stale —
every figure in it is derived from the repository (git log, `gh pr list`, `gh issue list`,
`evidence/`, the migration journal) and can be re-derived the same way.

---

## 1. Where the build stands

Delivery is 20 gated phases in 7 release waves. A phase counts as on `main` when its evidence pack is
committed under `evidence/<phase>/`, so this table comes from `evidence/`, not from the plan.

| Wave | Phases | What                                               | State                                                                |
| ---- | ------ | -------------------------------------------------- | -------------------------------------------------------------------- |
| 1    | 1–3    | Architecture, ledger, shell, identity, master data | **Complete**, evidence packs `phase-01`–`phase-03`                   |
| 2    | 4–6    | Budgets, events and co-funding, actuals            | **Complete**, packs `phase-04`–`phase-06` plus `wave-02`             |
| 3    | 7–9    | Rules and approvals, channels, event depth         | **Complete**, packs `phase-07`–`phase-09`                            |
| 4    | 10–11  | Reports and dashboards, close and forecast         | **Complete**, packs `phase-10`, `phase-11`                           |
| 5    | 12–13  | Integrations and public API, AI layer              | **Complete**, packs `phase-12`, `phase-13` (each backend + frontend) |
| 6    | 14–16  | Administration, extended product, ecosystem        | **Backends merged; three frontends in flight** — see below           |
| 7    | 17–20  | Quality pass, security review, evidence, docs      | **Not started.** No branch, no evidence folder, no issue             |

### Wave 6 in detail (the live edge of the build)

All three backend halves are merged with evidence packs (`evidence/phase-14/backend`,
`phase-15/backend`, `phase-16/backend` + `phase-16/gate`). The Angular halves are three separate
pull requests, all open at the time of writing:

| Phase | Frontend branch         | PR                                                           | CI at time of writing                                                    |
| ----- | ----------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| 14    | `feat/p14-admin-ui`     | [#69](https://github.com/narasimhahyland/budgetflow/pull/69) | Static green; **Functional and Visual failing**, mergeability unresolved |
| 15    | `feat/p15-extended-ui`  | none yet — branch pushed, PR not opened                      | —                                                                        |
| 16    | `feat/p16-ecosystem-ui` | [#80](https://github.com/narasimhahyland/budgetflow/pull/80) | **All checks green**, mergeable                                          |

Each is being worked by an agent in its own worktree (`p14-admin-ui`, `p15-extended-ui`,
`p16-ecosystem-ui`). Treat those three worktrees as occupied — see
[operational traps](#6-the-operational-traps).

**Update the README status table when these land.** It is correct as of this commit (Phase 16 shown
as backend only); the three rows move to a full `yes` once each frontend merges with its evidence
pack.

### What remains after Wave 6

Phase 17 (quality), 18 (security), 19 (local evidence), 20 (docs and final report). Two concrete
items are already parked for Phase 17 in
[`docs/architecture/phase-handoff.md`](architecture/phase-handoff.md): isolated Testcontainers runs
(`API_E2E_ISOLATED=1`) and the migration-from-previous-release check are wired as Nx dependencies but
no scenario uses them yet.

---

## 2. Current technical state

| Thing                       | Value                                    | Where it is defined                                                     |
| --------------------------- | ---------------------------------------- | ----------------------------------------------------------------------- |
| `main`                      | `23b36c3`                                | `git log origin/main`                                                   |
| Last migration              | `0019_p16_ecosystem`, journal `idx` 19   | `libs/api/db/migrations/meta/_journal.json`                             |
| **Next free migration**     | **`0020`**                               | same                                                                    |
| Tables after `0019`         | 164                                      | `meta/0019_snapshot.json`                                               |
| Highest seed id prefix      | `93` (Phase 16, ecosystem)               | `libs/seed/src/lib/ecosystem.ts`                                        |
| **Next free seed prefix**   | **`94`**                                 | prefix table at the end of `docs/architecture/phase-handoff.md`         |
| Highest invariant row       | 94 (Phase 16)                            | `docs/testing/invariant-scenarios.md`                                   |
| **Next free invariant row** | **95**                                   | same                                                                    |
| Visual baselines            | 615 images, 205 screen states, 629 tests | `apps/web-e2e/src/__screenshots__/visual-light/`, `visual/screens.json` |

### The seed prefix table is load-bearing

Prefixes are reserved in the table at the bottom of `phase-handoff.md`. **Claim yours there before you
write a fixture**, because two phases running in parallel will otherwise claim the same number and not
find out until merge.

That has happened twice:

- **`92` — the one that produced duplicate UUIDs.** Phases 15 and 16 ran in parallel and both claimed
  `92`, both issuing ordinals 1, 2, 3, 11 and 12. A marketplace partner and a wallet programme ended
  up with the same UUID. Phase 15 merged first and kept `92`; Phase 16 moved to `93` in merge
  `3d6bb32`, whose message is the best record of the clean-up.
- **`91` — double-claimed and left that way.** Phase 13 (AI documents) and Phase 14 (admin feature
  flags) both use `91000000` and overlap on ordinals 1–3. It was tolerated because the two sets land
  in different tables, so no row actually collides. Do not copy the pattern; it only looks harmless.

---

## 3. Deferred by decision

None of these is an oversight, and none should be rebuilt or re-argued without a new decision. Each
reason is the one on record.

| Deferred                                                           | Reason                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dark theme**                                                     | Light theme only, [ADR 0004](adr/0004-light-theme-only.md). Visual checks capture light only, so a dark theme means a second baseline set as well as the styling work.                                                                                                                                                 |
| **Internationalisation, translation files**                        | App copy is plain English in the templates. There are no app translation files to keep in sync, and money, numbers and dates go through the Angular formatters.                                                                                                                                                        |
| **Accessibility checks**                                           | Not part of the gates yet. A deliberate hole in the quality bar, and natural Phase 17 work.                                                                                                                                                                                                                            |
| **Native app wrappers (115a)**                                     | The Phase 8 PWA routes (`/m/approvals`, `/m/balance`, `/m/receipt`, `/m/alerts`) already serve phone users, so deferring costs no user-facing capability. Wrappers are app-store packaging over the same routes, not new product surface. The spec is kept, not deleted, so the design survives if they are picked up. |
| **Entitlements and plan gating (105a)**                            | Deferred with Phase 14. Feature flags exist and are enforced; commercial plan tiers are a separate concept nothing currently needs.                                                                                                                                                                                    |
| **Segregation-of-duties rules, access reviews (113 tabs 2 and 3)** | Deferred with Phase 14. The authorization model and audit trail they would build on are complete; the campaigns themselves are not.                                                                                                                                                                                    |
| **Break-glass request and approval (112)**                         | Deferred with Phase 14. The grant table exists; the request-and-approve flow on top of it does not.                                                                                                                                                                                                                    |
| **Demo environment (102c)**                                        | A separate deployment, not an application screen. Out of scope for the product build.                                                                                                                                                                                                                                  |

---

## 4. Blocked or unbuilt, with the blocker named

| Not built                                                                                                                                                   | Blocked by                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Red-flag analytics (017b)**                                                                                                                               | `approval_tasks` does not record approval **open** and **decision** timestamps, so the dwell-time figures the screen is about cannot be computed. Needs a Phase 7 schema change first.                                                                                                                            |
| Event planning copilot (045b), holiday overlay (043a), polls and idea board (044a), QR check-in (047c), remote participation (047d), withholding tax (080i) | Not blocked — simply not built. They are the remainder of the Phase 15 screen set; the backend half shipped without them.                                                                                                                                                                                         |
| Badges and challenges on 122a                                                                                                                               | The turnout ranking is complete; the badge rules were never specified in enough detail to build.                                                                                                                                                                                                                  |
| Cost per attendee on the outcomes view                                                                                                                      | Belongs to the ledger-backed event spending report (085). Returned as `null` rather than recomputed in the extended module.                                                                                                                                                                                       |
| Manager's quarterly organizer summary email (122b)                                                                                                          | Not built.                                                                                                                                                                                                                                                                                                        |
| Automation **trigger delivery** for no-code platforms (Phase 16)                                                                                            | The Phase 12 fan-out builds one payload per tenant-wide endpoint. Delivering those to a personal automation would hand records the connected person may not be allowed to see. The trigger catalogue is published with every entry marked `deliveryAvailable: false` until the fan-out learns per-person scoping. |
| `receipt_reused` and `unusual_vendor` anomaly kinds                                                                                                         | In the contract for the UI; the scan does not raise them. Needs document hashes and vendor categories.                                                                                                                                                                                                            |

---

## 5. Known gaps worth a decision

These are stated plainly here because they are easy to miss and awkward to discover late.

### The AI layer never calls a model

`AI_PROVIDER` is `z.enum(['fake'])` in `libs/api/core/src/lib/config.ts` — a **single-value enum**. No
model token exists anywhere in the repository or the Compose stack. The AI features are real and
genuinely guarded (retrieval scoped through `PolicyService`, data minimization with per-feature
allow-lists, a figure guard, an append-only query log, a person confirming every action), but every
answer comes from `FakeAiProvider` fixtures. That makes the tests reproducible; it also means
**nothing here has been exercised against a real model**, and the first live provider will be a real
integration project, not a config change.

### AI conversation text is retained indefinitely, not for 30 days

`ai_conversation_turns` stores question and answer text. The settings carry
`conversationHistoryDays` (default 30, range 7–90) and `113a` presents it as a retention window. It
is enforced in `ask.service.ts` as a **read-side filter** — `lastAskedAt > now() - interval` — and
nothing ever deletes a row. The text is hidden, not purged. Phase 14's twelve retention categories
do not cover the AI area at all (Phase 13 owns it), so no sweep picks it up either. Either the
window becomes a real purge or the wording stops promising one.

### All twelve retention periods are provisional

`retention_policies.signoff_status` defaults to `'provisional'` and every seeded category ships that
way, pending finance and legal sign-off. Nine are periods finance and legal can still change; three
are locked statements of policy (ledger journals and the audit log are never deleted; attendee needs
go 30 days after the event closes). **This is not an approved legal position** — it is a stated
default waiting for two functions to confirm it.

---

## 6. The operational traps

The most valuable section. Each of these cost real time to learn.

### A "stopped" subagent is usually still running

A stopped notification often means the **turn** ended, not the process. Before merging a worktree's
PR or dispatching another agent into it, establish that it is genuinely idle:

1. no process has that worktree as its working directory,
2. no Compose stack is up for its project name,
3. its branch head is unchanged across two checks several minutes apart.

Both failure modes have happened: merging underneath a live agent stranded its commits on a closed
branch ([PR #72](https://github.com/narasimhahyland/budgetflow/pull/72), closed because the same fix
landed through PR #68 while its author was still working), and two agents sent into one worktree
collided over the same files.

### Commit and push checkpoints constantly

Seven agents were stopped by infrastructure in a single day. In every case the work survived only
because it had been pushed. Push early, push often, and prefer a branch with scrappy checkpoint
commits over a clean working tree that exists nowhere else.

### Renumbering a migration means regenerating the snapshot

When two phases claim the same migration number, renaming the `.sql` and `meta/NNNN_snapshot.json`,
fixing `_journal.json` and re-chaining `prevId` is **not enough**. The snapshot has to be regenerated
on top of the new predecessor, or it silently omits the intervening phase's tables. Phase 16 hit this
moving `0018` to `0019`: the regenerated snapshot carries Phase 15's twelve tables and totals 164 —
a rename alone would have dropped them, with no error anywhere. The merge commit `3d6bb32` records
exactly what had to change.

### `scripts/worktree.sh new` keeps the default ports

`.cursor/setup-worktree.sh` copies `infra/.env.example` to a gitignored `.env` and appends a distinct
`COMPOSE_PROJECT_NAME`, so containers and volumes do not collide — but the `BF_*_PORT` values are the
defaults, so the **host ports do**. `bf-demo` holds the defaults (web 4200, API 3000, Keycloak 8080,
Mailpit 8025, MinIO 9000, mock providers 4010, Postgres 5432). Set your own before
`scripts/stack.sh up`.

A guard hook blocks reading or writing `.env` through file tools, deliberately, so do it in the shell
(`export BF_WEB_PORT=…`, or append to `.env` from the shell). Do not try to work around the hook; if
it blocks you, say so.

### A visual baseline can be wrong while the check is green

The gate compares against `maxDiffPixelRatio` 0.002. A baseline that is wrong by less than that
passes forever and silently spends the screen's whole allowance on an unrelated difference.

- **248** of the 410 desktop and tablet baselines carried a navigation rail from before `11ea17e`
  added two nav items — roughly **two thirds of each one's allowance**, on something that had nothing
  to do with the screen under test. They all passed. Then any small change tipped whichever one
  happened to be closest, and `main` went red on a different state each run.
  [PR #81](https://github.com/narasimhahyland/budgetflow/pull/81) re-recorded 208 of them; 38 are
  deliberately held back (see [loose ends](#7-open-issues-and-loose-ends)).
- `086-unused-expired` shipped the **wrong breadcrumb** ("Report" instead of "Unused and expired
  budget") for two phases, because the baseline was recorded one commit before the route title map
  changed it and the tolerance hid the difference ever since.

Two habits follow. Run `npm run visual:headroom` — it re-runs the visual project with the allowance
set to zero and reports how much of its real allowance each state is using, flagging anything at 70%
or more. It is **informational by construction**: a separate command, never part of
`scripts/gate.sh`, exit code discarded. And when you regenerate baselines, **open the images and look
at them**; a green run proves nothing about whether the picture is right.

### Classify a visual failure before you fix it

| Symptom                                | What it is                 | What to do                                                         |
| -------------------------------------- | -------------------------- | ------------------------------------------------------------------ |
| Same commit passes on re-run           | Flake                      | Find the race. Do not re-record.                                   |
| Identical pixel count on every run     | Deterministic difference   | Something really changed. Decide whether it is right, then record. |
| **Differing** pixel counts across runs | Nondeterministic rendering | **Re-recording is the wrong fix.** It will drift straight back.    |

The worked example is issue #70: `011a` differed by 36,667 pixels on one attempt and 36,633 on the
next. The cause was the eight-character query-log id in the shared provenance note measuring 52–58px
depending on which hex characters it started with, which decided whether the closing full stop
wrapped to a second line. Masking could not help — it hides the glyphs but not their advance width.
The fix was in the component.

### Cross-suite state dependency is the most common defect class here

API scenarios legitimately mutate seeded state, so a journey that runs after them reads data that has
moved. `scripts/gate.sh` now reseeds between `functional-api` and `functional-e2e` (`reseed-e2e`,
about 41s), which closed the biggest hole — `evidence/gate-reseed/README.md` has the before-and-after
table showing, for example, budget health going from 11 budgets to 482 after the API suite.

Within the visual suite it is **not** fully closed: some states still depend on data other screens
create. `113a`'s query-log rows are the live example (the rows are masked, but their presence is not).

The rule that prevents all of it: **select subjects by id or name, never by mutable status.** "The
first open exception" is a bug; `ACT-00318` is not.

### An assertion inside an `if (visible)` conditional verifies nothing

```ts
if (await thing.isVisible()) {
  await expect(thing).toHaveText('…'); // passes happily when `thing` never rendered
}
```

Several shipped that way. If the data should be there, assert it outright and let the test fail when
it is not.

### Background jobs mutate data mid-screenshot

The nightly ledger rebuild runs at `0 2 * * *` UTC. A CI run whose visual step spanned 02:00 got a
rebuild row halfway through and 16 `080e` states failed; the next run, 50 minutes later, was green on
the same baselines. The local Compose stack now sets all four wall-clock sweeps (nightly rebuild, SLA
sweep, report sweep, retention sweep) to `off` by default, and every scenario that needs that work
drives it through its API instead, which is the only way to time it. Keep it that way.

### Satori renders nothing for an unknown `svgIcon`, silently

Satori draws icons with `<mat-icon [svgIcon]>`, which renders **nothing at all** for a name that does
not exist — no error, no console warning, just an empty slot in the rail. `icon: 'checklist'` sat
there unnoticed; the valid name is `checklist_rtl`. Verify every name against
`node_modules/@hylandsoftware/satori-icons/icon-list.json` (493 names) and the companion
`deprecated-icons.json`. A journey now asserts that every navigation item renders a glyph
(`384ad69`), so the rail at least is covered.

### The app has a global `box-sizing: border-box` reset

`.bf-list__item` was content-box for several phases and overran its card; it was patched per-component
twice before being fixed globally. The reset is in place now. **Do not add per-component
`box-sizing` workarounds** — fix the shared stylesheet and re-record the baselines it moves.

---

## 7. Open issues and loose ends

Open issues: [`gh issue list`](https://github.com/narasimhahyland/budgetflow/issues).

| #                                                             | Issue                                                                                                                                                                                          | State                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [82](https://github.com/narasimhahyland/budgetflow/issues/82) | **Blank-render flake.** About one visual state per 629-test run fails its readiness wait and saves a **blank page** — the app never bootstrapped. Different state every time, passes on retry. | Open. Not urgent (self-heals with `retries: 1`) but one unlucky retry from a red `main` on an unrelated change. The project runs with `trace: 'off'`, so there is no trace to read; the hypothesis is a silent Keycloak re-auth that does not complete. |

Loose ends without a ticket:

| Loose end                                                                                                                                                                                                                                                                                                                             | Where it is written down                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **38 stale-rail baselines held back.** They show the old nav rail _and_ differ behind it, so re-recording would freeze a rendering nobody has explained. Each needs its own look.                                                                                                                                                     | `evidence/stale-rail/remaining.txt`, with each one's share of its allowance; `npm run visual:headroom` names them every run |
| **`086-unused-expired` computes "days left" from the real date.** Only the browser clock is frozen, so the figure falls by one each day and the state drifts towards its tolerance on its own. Masking it needs a handle on the report frame's cells that does not exist.                                                             | commit `8a54717`                                                                                                            |
| **`113a` depends on cross-suite data.** Its query-log state needs rows other screens' AI calls create.                                                                                                                                                                                                                                | `apps/web-e2e/visual/screens.json`                                                                                          |
| **A monospace `font-family` slipped past stylelint.** `frontend-satori-styling.mdc` forbids it, but stylelint only enforces the ban in `.scss`, so an inline component style in `libs/web/features/ai/src/lib/ai-output.ts` was never checked.                                                                                        | issue #70's closing comment                                                                                                 |
| **The default board pack (016a) renders all zeros.** The seed closes the period without writing `period_close_snapshots` rows, so the "latest closed period" view is empty. It is the seed, not the report — switch to the current open period and the figures are real. Fixing it moves the `016a-board-pack--default--*` baselines. | `docs/architecture/phase-handoff.md`, "Known follow-ups from Phase 11"                                                      |
| **`phase-handoff.md` says screens 87 and 16a "are not built".** They were built in Phase 11; baselines exist for both. That paragraph is stale.                                                                                                                                                                                       | `docs/architecture/phase-handoff.md`                                                                                        |

---

## 8. Where things live

| Path                                                                    | What you will find                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/architecture/`](architecture/)                                   | Domain model, ledger, state machines, authorization matrix, API conventions. **`phase-handoff.md` is the single most useful file in the repository** — what each phase delivers, what it deliberately left, the seed prefix table and the phase map |
| [`docs/adr/`](adr/)                                                     | Six decisions with their consequences (monorepo, ledger, RLS, light theme, images, single company)                                                                                                                                                  |
| [`docs/ux/`](ux/)                                                       | `screen-inventory.md` (124 specified screens plus review additions), per-screen specs in `screens/`, design system, Stitch exports, design preview                                                                                                  |
| [`docs/testing/invariant-scenarios.md`](testing/invariant-scenarios.md) | Every invariant mapped to the API scenario that proves it. 94 rows; **add yours and keep the numbering contiguous**                                                                                                                                 |
| [`docs/local-access.md`](local-access.md)                               | Per-role Keycloak usernames, scenario-only users, service credentials, ports and their `BF_*_PORT` variables                                                                                                                                        |
| [`docs/ai-harness/README.md`](ai-harness/README.md)                     | How the agent harness builds this repository — skills, subagents, hooks, worktrees                                                                                                                                                                  |
| [`evidence/`](../evidence/)                                             | Per-phase proof. `evidence/README.md` explains the layout; named folders (`gate-reseed`, `stale-rail`, `fix-080e`, `guard-worktrees`, `nav-overlap`) hold investigations rather than phases, and several are better reading than the phase packs    |

Published pages: [leadership overview](https://narasimhahyland.github.io/budgetflow/overview/),
[capabilities](https://narasimhahyland.github.io/budgetflow/capabilities/),
[clickable design preview](https://narasimhahyland.github.io/budgetflow/).
