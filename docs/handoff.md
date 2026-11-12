# Handoff: state of play

Written 2026-11-08 against `main` at `b5e6e99`; sections 1, 2.1, 2.3, 3, 6 and 8 refreshed on
2026-11-11 against `67783ad0` (Phase 20), for whoever picks this repository up next. If you
are starting cold, read section 1 for where the build is and section 2 for what to do about it; the
rest is reference.

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
| 6    | 14–16  | Administration, extended product, ecosystem        | **Complete** — all six halves merged; see the caveats below          |
| 7    | 17–20  | Quality pass, security review, evidence, docs      | **Complete**; unbuilt plan scope in `gap-closure-plan.md`            |

### Wave 7 so far

| Phase | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 17    | **Merged** ([#101](https://github.com/narasimhahyland/budgetflow/pull/101)): 112 of 112 routed screens reached by a functional check, migration checks on throwaway Postgres, performance on the seed and on 10,000 actuals posted through the API, data integrity at volume, exploratory checks. Its seven exploratory findings are fixed on `main` ([#102](https://github.com/narasimhahyland/budgetflow/pull/102)). Isolated Testcontainers runs are deferred by decision. |
| 18    | **Merged**: allowed-network bypass ([#98](https://github.com/narasimhahyland/budgetflow/pull/98)), break-glass access (screen 112, with the real-date fix in [#104](https://github.com/narasimhahyland/budgetflow/pull/104)), the rest of the review ([#105](https://github.com/narasimhahyland/budgetflow/pull/105)). Evidence: `evidence/phase-18/`.                                                                                                                        |
| 19    | **Done**: `scripts/gate.sh all` on `main` at `30d64422` from a fresh seed, every mode passes (627 API scenarios, 590 journeys, the ten-step acceptance scenario, 941 visual with 3 flaky). `evidence/phase-19/`.                                                                                                                                                                                                                                                              |
| 20    | **Done**: docs refreshed and the final report in `evidence/phase-20/README.md`.                                                                                                                                                                                                                                                                                                                                                                                               |

Treat the worktrees under `../budget-delegation-and-control-worktrees/` as occupied until you have
checked otherwise — see [operational traps](#7-the-operational-traps). Confirm a worktree is idle
before removing it with `scripts/worktree.sh remove`.

---

## 2. What to do next, in order

**Start with [`gap-closure-plan.md`](gap-closure-plan.md)**: the plan scope that is not built, as
work packages with the decisions they need. The blocks below are what came before it.

2.1 is done. 2.2 is the visual-suite work, owned by its own track and nearly finished. 2.3 is the rest
of Wave 7. 2.4 records decisions already taken, so they are not re-opened.

### 2.1 Close out Wave 6 — done

Both items are closed: `evidence/phase-15/frontend/` is committed
([#95](https://github.com/narasimhahyland/budgetflow/pull/95)) and the README status table shows
Phases 14 to 16 as `yes`.

### 2.2 Visual-suite hygiene

**Read this before touching a baseline.** This used to be a list of five items. It is really one
problem with a required order of work, and the order matters more than the list: fix the causes of
nondeterminism first, re-record once at the end, then keep the number visible. Re-recording first
freezes whatever drift has not been fixed yet, which is how the suite reached its present state.

#### What the suite actually looks like

Measured 2026-11-08 with `npm run visual:headroom`, a zero-allowance run of the whole project:

| Reading                                        | Count            |
| ---------------------------------------------- | ---------------- |
| States in the project                          | 788              |
| Matching their baseline exactly                | 275              |
| **Differing from their baseline**              | **513**          |
| Of those, using 70% or more of their allowance | **198**          |
| Failing the gate                               | 0 before Stage 1 |

**All 513 pass.** The cause is not per-screen data: for `074-over-budget-policy` the expected and
actual images are pixel-identical in the content area and differ only in the **navigation rail**,
which `libs/web/shell/src/lib/nav.ts` now renders with **65 entries** where these baselines were
recorded against fewer, so every icon below the insertion point shifts down. Dozens of unrelated
tablet states differ by an identical pixel count, which is the signature of shared chrome rather
than data. Every state inspected so far is rail-only; that is not the same as all 513 proven, so
treat a non-rail difference as a finding rather than an assumption.

How it got here: each Wave 6 merge re-recorded only the states that **breached** their allowance —
23 for Phase 16, 37 for Phase 14 (`8b2459c`) — and left every state that differed **within**
tolerance untouched. Nothing was hidden; the gate simply never asked.

The reading is identical with the server clock pinned and with it real, so this is independent of
issue [#86](https://github.com/narasimhahyland/budgetflow/issues/86).

**The consequence is that the suite has almost no headroom.** With 198 states above 70% of their
allowance and one shared cause, any change costing a few hundred pixels tips an arbitrary handful
red — which is exactly the "`main` went red on a different state each run" symptom already recorded
in [section 7](#7-the-operational-traps). Until the re-record pass happens, expect unrelated states
to fail and do not treat such a failure as evidence that the change under test broke something.

#### Step 1 — fix the causes of nondeterminism

Nothing should be re-recorded until these are closed, because each one would otherwise be baked into
the new baseline.

| Cause                                                                                                                                                                                                                                                | State                                                                                                                                                                           | Done when                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **The server and the browser disagreed about "now".** `freezeTime` froze only the browser clock, so every server-computed age, countdown and overdue flag drifted against a fixed baseline.                                                          | **Stage 1 done** — `libs/api/core/src/lib/clock.ts` and `FIXED_NOW`, derived from `freezeTime` by `scripts/stack.sh` so the two cannot diverge. Six baselines corrected. PR #89 | Both clocks read the same instant. Because both are now pinned, real time passing `freezeTime` no longer matters |
| **Stage 2 of the same fix is outstanding.** 31 further copies of the `today` one-liner in `libs/api`, eight of them exported as `todayUtc` from eight modules, so most of the product still reads wall-clock time.                                   | `evidence/visual-determinism/stage-2-scope.md` lists every site, with the three API scenarios and the SQL `now()` question                                                      | One definition of today across the API, each site decided rather than re-pointed blindly                         |
| **The seed anchors to real time while the API is pinned.** `libs/seed/src/lib/extended.ts` uses `daysAgo`, `momentsAgo` and `quarterKey` deliberately, so fixtures stay inside "this quarter" and "the last 30 days" windows as real time passes.    | `apps/api/src/seed/extended.ts`, and a second `daysAgo` of its own in `apps/api/src/seed/rules.ts`                                                                              | The seed reads the same pinned clock as the API. They agree today and diverge at a quarter or window boundary    |
| **Blank-render flake**, issue [#82](https://github.com/narasimhahyland/budgetflow/issues/82). About one state per full run fails its readiness wait and saves a blank page — the app never bootstrapped. Different state each time, passes on retry. | `gh issue view 82`                                                                                                                                                              | The blank render is explained rather than retried. The project runs `trace: 'off'`, so step one is a trace       |
| **`113a` query-log baselines depend on cross-suite data.** The rows exist only because the AI screens run earlier in the same suite, so the state is meaningless in a filtered run.                                                                  | `apps/web-e2e/visual/screens.json`                                                                                                                                              | The state seeds or drives its own rows, so it passes when run alone                                              |
| **Screen 090 carries a redundant mask** over the global `[data-testid=relative-time]` one.                                                                                                                                                           | `apps/web-e2e/visual/screens.json`                                                                                                                                              | The two are collapsed; nothing visible changes                                                                   |

#### Step 2 — then one deliberate re-record pass

Not before step 1. Conditions, each of which has been got wrong at least once here:

- The **whole project**, never a grepped subset: a scoped run cannot see shared-component drift, and
  shared-component drift is the entire problem.
- On a **fresh deterministic seed** and the **pinned clock**, in the pinned Playwright image, with
  the rail at its final entry count.
- **Open the images and look at them.** 513 baselines currently pass while differing; a green run
  proves nothing about whether the picture is right.
- **Classify before recording**, by [section 7](#7-the-operational-traps)'s table: same commit
  passing on re-run is a flake, identical pixel counts across runs is a real change, differing counts
  are nondeterminism where re-recording is the wrong fix.
- The **38 held-back baselines** (`evidence/stale-rail/remaining.txt`) are a subset of the 513 — the
  ones that also differ _behind_ the rail — and each still needs its own look, because that is how
  `086-unused-expired` carried a wrong breadcrumb for two phases. Resolve them inside this pass
  rather than as separate work.

#### Step 3 — then keep the number visible

The reason 513 went unnoticed is that `npm run visual:headroom` is informational by construction: a
separate command, never part of `scripts/gate.sh`, exit code discarded. That is the right design for
a gate and the wrong design for a trend. **Publish the differing-state count and the number above
70% on every CI run** without gating on them, so a jump is noticeable the week it happens rather
than a wave later. Keep it out of the gate: it is a measurement, not a pass condition.

### 2.3 Wave 7 — phases 17 to 20

| Phase                    | State and what is left                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **17 — quality pass**    | Done, on `main` (`evidence/phase-17/`). Every item done or deferred: **isolated Testcontainers runs (`API_E2E_ISOLATED`) deferred by the user** (scenarios stay serial on one stack); accessibility is not in this phase (AGENTS.md defers it).                                                                                                                                                                                                         |
| **18 — security review** | Done, on `main`. Six findings fixed (allowed-network bypass; public development secrets now refused in production; operator reads; CSV formulas; legal-hold reads; CI traces opt in with `BF_CI_TRACES=1`) and break-glass built. Still open: the `multer` bump (unreachable, needs approval for `package.json`), and `infra/.env.example` entries for `TRUSTED_PROXY_CIDRS`, the five secrets and `BF_ALLOW_DEV_SECRETS`, which only the user can add. |
| **19 — local evidence**  | **Done** (`evidence/phase-19/`). It ran after the re-record landed: `scripts/gate.sh` in all modes on `main` from a fresh seed, the extended core acceptance scenario (`apps/web-e2e/src/acceptance/`), and `evidence/phase-19/` with the run, the outcome table and the gate summary.                                                                                                                                                                  |
| **20 — docs and report** | Docs refreshed against the build (this page's sections 1, 2.1, 2.3, 3, 6 and 8; README; `docs/architecture/`; the screen inventory). The final report is `evidence/phase-20/README.md`.                                                                                                                                                                                                                                                                 |

### 2.4 Decisions the user has taken

**All four were decided on 2026-11-09.** They are recorded here with what each one commits the build
to, so they are not re-opened as questions. The detail behind them is in
[section 6](#6-known-gaps-worth-a-decision).

| Question                                                             | Decision                                                                             | What it commits the build to                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Wire a real AI provider?**                                         | **Yes — Bedrock, with an offline recorded provider for tests (revised 2026-11-12).** | Amazon Bedrock is in the product (`AI_PROVIDER=bedrock`, credentials from the environment; [#119](https://github.com/narasimhahyland/budgetflow/pull/119)). The default, and what the local stack, functional runs and CI use, is `AI_PROVIDER=recorded`: committed, scrubbed recordings, no live call and no token. Every AI scenario, eval and journey runs on it.                    |
| **Purge `ai_conversation_turns`, or stop promising a window?**       | **Make it a real purge.**                                                            | **This is the only one of the four that is work.** `conversationHistoryDays` (default 30, range 7–90) is today a read-side SQL filter in `libs/api/ai/src/lib/features/ask.service.ts` line 403, and nothing deletes a row. It becomes an actual deletion, so screen `113a` means what it says. Accepted cost: history the evaluation sets might have wanted is gone once it is purged. |
| **Sign off the twelve retention periods, or keep them provisional?** | **Ship as provisional.**                                                             | `signoff_status` stays `'provisional'` on every seeded category. The product therefore states a retention position that **finance and legal have not approved**, and says so on its own screen. This is accepted deliberately, not pending; it needs no further chasing unless those functions ask.                                                                                     |
| **May a read-only role edit a summary draft's text?**                | **Yes — keep it as built.**                                                          | `editSection` and `regenerate` keep `assertDraft` plus the `report.read` reader check, so anyone who can read summaries can rewrite an unapproved draft. Collaborative editing is the intent. Note the asymmetry is now deliberate: `draft` and `approve` still require `audit.read` through `assertAuthor`. Do not "fix" this to match them.                                           |

The one piece of work this block created, the AI conversation purge, is done: rows past each
tenant's window are deleted by a sweep, not filtered on read
([#91](https://github.com/narasimhahyland/budgetflow/pull/91), `evidence/ai-conversation-purge/`,
invariant 95).

---

## 3. Current technical state

| Thing                       | Value                                    | Where it is defined                                                     |
| --------------------------- | ---------------------------------------- | ----------------------------------------------------------------------- |
| `main`                      | `67783ad0`                               | `git log origin/main`                                                   |
| Last migration              | `0021_p18_break_glass`, journal `idx` 21 | `libs/api/db/migrations/meta/_journal.json`                             |
| **Next free migration**     | **`0022`**                               | same                                                                    |
| Tables after `0021`         | 164                                      | `meta/0021_snapshot.json`                                               |
| Highest seed id prefix      | `93` (Phase 16, ecosystem)               | `libs/seed/src/lib/ecosystem.ts`                                        |
| **Next free seed prefix**   | **`94`**                                 | prefix table at the end of `docs/architecture/phase-handoff.md`         |
| Highest invariant row       | 98 (Phase 18)                            | `docs/testing/invariant-scenarios.md`                                   |
| **Next free invariant row** | **99**                                   | same                                                                    |
| Visual baselines            | 786 images before the re-record          | `apps/web-e2e/src/__screenshots__/visual-light/`, `visual/screens.json` |

Every figure here moves. Re-derive rather than quote:
`tail libs/api/db/migrations/meta/_journal.json`, the prefix table at the end of
`phase-handoff.md`, the last row of `invariant-scenarios.md`, and
`find apps/web-e2e/src/__screenshots__ -name '*.png' | wc -l`. The baseline count in particular
moves with every re-record, and Wave 6 added 159 images in three passes.

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

## 4. Deferred by decision

None of these is an oversight, and none should be rebuilt or re-argued without a new decision. Each
reason is the one on record.

**This list was audited on 2026-11-08, because it had a provenance problem.** Most of it was
harvested from one sentence in `phase-handoff.md` — Phase 14's "Not in this half:" — and that
sentence mixes four different things: items genuinely deferred, items out of scope by nature, items
with no deferral reasoning at all, and at least one item **scheduled in another phase** ("AI
retention categories — Phase 13 owns the AI area"). Flattening it into "deferred by decision"
turned "we did not build this in this half" into "nobody should build this", which is how
break-glass came to be listed here while `authorization.md` charters it into Phase 18 and
`security.mdc` requires it. Break-glass has been moved to [section 2.3](#23-wave-7--phases-17-to-20).
Before adding a row here, check whether anything else schedules the item.

| Deferred                                                           | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dark theme**                                                     | Light theme only, [ADR 0004](adr/0004-light-theme-only.md). Visual checks capture light only, so a dark theme means a second baseline set as well as the styling work.                                                                                                                                                                                                                                                                                                                                                             |
| **Internationalisation, translation files**                        | App copy is plain English in the templates. There are no app translation files to keep in sync, and money, numbers and dates go through the Angular formatters.                                                                                                                                                                                                                                                                                                                                                                    |
| **Accessibility checks**                                           | Deferred outright. [`AGENTS.md`](../AGENTS.md) golden rule 8 is the only source and it governs: "Deferred: dark theme (visual checks capture light only) and accessibility checks". **Not Phase 17 work** — an earlier version of this page called it "natural Phase 17 work" and that was wrong. Note for anyone checking: `.cursor/rules/` says nothing about accessibility at all (`testing-visual.mdc` defers the dark theme, not this), so the deferral rests on `AGENTS.md` alone. Do not re-open it without a new decision. |
| **Native app wrappers (115a)**                                     | The Phase 8 PWA routes (`/m/approvals`, `/m/balance`, `/m/receipt`, `/m/alerts`) already serve phone users, so deferring costs no user-facing capability. Wrappers are app-store packaging over the same routes, not new product surface. The spec is kept, not deleted, so the design survives if they are picked up.                                                                                                                                                                                                             |
| **Entitlements and plan gating (105a)**                            | Genuinely deferred — `phase-handoff.md` says "105a is deferred" in those words, and nothing else schedules it. Feature flags exist and are enforced; commercial plan tiers are a separate concept nothing currently needs. Caveat for whoever lifts it: the `entitlements` table already exists and Phase 14's own intent line reads "Entitlements gate features", so the groundwork is further along than the deferral suggests.                                                                                                  |
| **Segregation-of-duties rules, access reviews (113 tabs 2 and 3)** | **Unbuilt and unscheduled rather than decided.** `phase-handoff.md` lists it under Phase 14's "Not in this half" with no deferral reasoning, and nothing else schedules it. The authorization model and audit trail it would build on are complete; the campaigns are not. Treat it as needing a decision, not as settled.                                                                                                                                                                                                         |
| **Demo environment (102c)**                                        | **Out of scope by nature rather than deferred**, which is a different thing: a separate deployment, not an application screen. Nothing to build here even if the deferral were lifted.                                                                                                                                                                                                                                                                                                                                             |

---

## 5. Blocked or unbuilt, with the blocker named

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

## 6. Known gaps, and the decision taken on each

These are stated plainly here because they are easy to miss and awkward to discover late. **All four
were decided on 2026-11-09** — each section ends with the decision, so read the decision before
acting on the description above it. [Section 2.4](#24-decisions-the-user-has-taken) is the summary.

### The AI layer calls Bedrock in the product and recordings in tests

`AI_PROVIDER` is `z.enum(['recorded', 'bedrock'])` in `libs/api/core/src/lib/config.ts`, default
`recorded`. `bedrock` calls Amazon Bedrock with credentials from the server environment
(`docs/ai-harness/bedrock.md`). `recorded` answers offline from committed, scrubbed recordings
(`libs/api/ai/src/lib/provider/recordings/`); the local stack, functional runs and CI use it, so no
model token exists in the repository, the Compose defaults or CI. The guards (scoped retrieval,
minimization, schema check, figure guard, query log, a person confirming every action) are the same
for both.

**Decided 2026-11-09: keep the fake. Revised 2026-11-12:** keep Bedrock in the product (#119) and add
back an offline test provider, so the AI layer stays tested without live calls or tokens. The
guardrail and extraction evals, the figure-guard and schema-discard scenarios and the accuracy
thresholds that #119 removed are restored (`evidence/ai-offline-tests/`). Live answers are only
exercised when someone starts a stack with `AI_PROVIDER=bedrock` and credentials.

### AI conversation text is retained indefinitely, not for 30 days

`ai_conversation_turns` stores question and answer text. The settings carry
`conversationHistoryDays` (default 30, range 7–90) and `113a` presents it as a retention window. It
is enforced in `ask.service.ts` as a **read-side filter** — `lastAskedAt > now() - interval` — and
nothing ever deletes a row. The text is hidden, not purged. Phase 14's twelve retention categories
do not cover the AI area at all (Phase 13 owns it), so no sweep picks it up either. Either the
window becomes a real purge or the wording stops promising one.

**Decided 2026-11-09: make it a real purge. Done** in
[#91](https://github.com/narasimhahyland/budgetflow/pull/91): a sweep deletes conversations past the
window with their turns, so `113a`'s wording is now true of the data (invariant 95).

### All twelve retention periods are provisional

`retention_policies.signoff_status` defaults to `'provisional'` and every seeded category ships that
way, pending finance and legal sign-off. Nine are periods finance and legal can still change; three
are locked statements of policy (ledger journals and the audit log are never deleted; attendee needs
go 30 days after the event closes). **This is not an approved legal position** — it is a stated
default waiting for two functions to confirm it.

**Decided 2026-11-09: ship as provisional.** `signoff_status` stays `'provisional'`. The product
states a position finance and legal have not approved and is explicit about that on screen. Accepted
deliberately — it is not awaiting anybody.

### A read-only role can rewrite a leadership summary draft

In `libs/api/extended/src/lib/narratives.service.ts`, `draft` and `approve` call `assertAuthor`,
which requires `audit.read`: leadership and finance author the company summary. `editSection` and
`regenerate` do not. They are guarded by `assertDraft`, a status check that only refuses an already
approved summary, plus the `report.read` reader check every read runs. So anyone who can read
summaries can rewrite an unapproved one's text, or regenerate it. Whether that is collaborative
editing or a gap is a product decision, not a bug report — but it is not what
[#85](https://github.com/narasimhahyland/budgetflow/pull/85) assumed when it tightened the buttons.

**Decided 2026-11-09: keep it as built.** Collaborative editing is the intent, so `editSection` and
`regenerate` keep the `report.read` reader check. The asymmetry with `draft` and `approve`, which
require `audit.read`, is now deliberate — do not tighten it to match them.

---

## 7. The operational traps

The most valuable section. Each of these cost real time to learn. The first one cost the most.

### Git merge state in a worktree can be silently reverted

**Read this before you merge anything in an agent worktree.** Four separate agents stalled trying to
merge `main` into `feat/p14-admin-ui`, and this was why. A merge would run and report its conflicts;
moments later the working tree would be clean again with `MERGE_HEAD` gone, as though
`git merge --abort` had fired. No hook and no process was ever found responsible. Each agent lost
its progress to this and appeared, from the outside, to simply stop.

**The workaround that succeeded: do the merge, the conflict resolution, the commit and the push
inside a single uninterruptible shell invocation.** Do not split a merge across tool calls. Do not
leave a merge in progress, or a staged change, sitting between calls. The same caution applies to
generating and committing visual baselines, which is the other long operation that leaves the tree
dirty for a while.

This reframes the "infrastructure stalls" recorded elsewhere on this page: at least some of those
agents were not failing, they were having their work undone mid-operation. Worth knowing, because
the natural response to a stall is to retry it the same way — which fails the same way.

### A stalled agent is indistinguishable from a working one

Phase 16's frontend PR sat green and unmerged for nearly five hours because its agent ended its turn
without reporting. Nothing was wrong and nothing said so. **Poll the PR and the branch directly**
(`gh pr checks <n>`, `gh pr view <n> --json mergeable,mergeStateStatus`, `git rev-parse <branch>`)
rather than waiting on a completion notification that may never come. This is the mirror image of
the trap below: a quiet agent is not necessarily finished, and a finished agent does not necessarily
say so.

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
commits over a clean working tree that exists nowhere else. Some of those seven were the reverted
merge state above rather than infrastructure, which only strengthens the habit: a commit that was
pushed cannot be undone underneath you.

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

### A UI phase that adds navigation entries invalidates baselines across the whole suite

The rail renders on every screenshot, so adding one entry to `libs/web/shell/src/lib/nav.ts` moves
every state that any affected role can reach — nothing to do with the screen under test. Across
Wave 6: Phase 15 added six entries and re-recorded six baselines, then five more; Phase 16 added
five and re-recorded 23 (`36c32ad`); Phase 14 added five and re-recorded 37 (`8b2459c`), because by
then it was merging on top of both.

**The damage is not confined to the rail.** Those successive merges took the shell from 47 to 65
entries, and a taller rail narrows the content column — so nineteen of those 37 states had entirely
unchanged page content that simply reflowed: table columns redistributed, a form grid wrapped a
field, a banner re-wrapped. Masking the rail would not have saved them. Expect to re-record states
that have nothing to do with navigation, and do not treat a diff outside the rail as evidence that
something else broke.

**Budget a re-record pass into any phase that touches the rail, and run the full visual project** —
a grepped subset tells you only that the states you thought of still pass, and the ones you did not
think of are precisely the problem. The spec that has to move with it is
`apps/web-e2e/src/shell/role-navigation.spec.ts`, which asserts each role's rail in order.

### A visual baseline can be wrong while the check is green

The gate compares against `maxDiffPixelRatio` 0.002. A baseline that is wrong by less than that
passes forever and silently spends the screen's whole allowance on an unrelated difference.

- **248** of the 410 desktop and tablet baselines carried a navigation rail from before `11ea17e`
  added two nav items — roughly **two thirds of each one's allowance**, on something that had nothing
  to do with the screen under test. They all passed. Then any small change tipped whichever one
  happened to be closest, and `main` went red on a different state each run.
  [PR #81](https://github.com/narasimhahyland/budgetflow/pull/81) re-recorded 208 of them; 38 are
  deliberately held back (see [loose ends](#8-open-issues-and-loose-ends)).
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

### Gate an action on the permission, never on the data

A screen that infers a right from the shape of the data will eventually offer someone a button the
API refuses on the press. Phase 15 shipped exactly that: the leadership summaries list offered
Draft whenever a closed period had no summary yet, on the assumption that a role who cannot draft
cannot read the close calendar either — but an analyst can, so an analyst got the button. The
detail page's `canApprove` had the same gap, weighing the summary's state but not the reader's
right. `978c20b` ([#85](https://github.com/narasimhahyland/budgetflow/pull/85)) fixed both by asking
`session.can('audit.read')`, the action the endpoint actually asserts.

It also turned `main` red, which is the second lesson: the analyst journey asserted the button was
absent, and that was only true while some other test had already drafted a summary for the waiting
period. Gating on data makes the answer depend on what else is running.

Phase 14 — the most permission-dense group in the product — was checked against this before merge
and came back clean: every consumer of `GET /api/me/features` gates on `on && allowed`, and three
capabilities correctly returned `on: true, allowed: false` for an analyst. A pending two-person
change renders "Off is still in force" and hides the request buttons rather than showing the
requested value as applied. That is the shape to copy.

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

## 8. Open issues and loose ends

Open issues: [`gh issue list`](https://github.com/narasimhahyland/budgetflow/issues).

| #                                                             | Issue                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | State                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [82](https://github.com/narasimhahyland/budgetflow/issues/82) | **Blank-render flake.** About one visual state per run fails its readiness wait and saves a **blank page** — the app never bootstrapped. Different state every time, passes on retry.                                                                                                                                                                                                                                                                                                                     | Open. Not urgent (self-heals with `retries: 1`) but one unlucky retry from a red `main` on an unrelated change. The project runs with `trace: 'off'`, so there is no trace to read; the hypothesis is a silent Keycloak re-auth that does not complete. |
| [86](https://github.com/narasimhahyland/budgetflow/issues/86) | **Calendar drift.** Baselines changed with the real clock, not with the code. **Fixed:** stages 1 to 3 are merged ([#89](https://github.com/narasimhahyland/budgetflow/pull/89), [#92](https://github.com/narasimhahyland/budgetflow/pull/92), [#104](https://github.com/narasimhahyland/budgetflow/pull/104)): the API and the database (`app_now()`) follow `BF_FIXED_NOW`, and the seed follows the clock each timestamp is compared with. Baselines are re-recorded once on that basis (section 2.2). |

Loose ends without a ticket (the Phase 15 evidence pack, the README status table and the 87/16a
wording in `phase-handoff.md` were fixed and are no longer listed):

| Loose end                                                                                                                                                                                                                                                                                                                                                                                                   | Where it is written down                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **38 stale-rail baselines held back** — and they are a subset of a much larger set: 513 of 788 states differ from their baselines while passing. Each of the 38 still needs its own look, because they differ _behind_ the rail as well as in it. Handle them inside the re-record pass, not separately: [2.2](#22-visual-suite-hygiene).                                                                   | `evidence/stale-rail/remaining.txt`; `npm run visual:headroom` names them every run |
| ~~**`086-unused-expired` computes "days left" from the real date.**~~ Fixed by #86 Stage 1 ([PR #89](https://github.com/narasimhahyland/budgetflow/pull/89)): the figure now comes from the pinned clock, so it no longer falls by one a day. Masking it was the original suggestion and was never possible — the countdown is a generic numeric metric in the shared report frame, with no per-key handle. | commit `8a54717`; `evidence/visual-determinism/086-root-cause.md`                   |
| **Screen 090 carries a redundant mask.** The global mask already covers `[data-testid=relative-time]`, and `090-approval-history` masks the whole first cell (`table[aria-label="Approval decisions"] tbody td:first-child`) on top of it. Collapsing the two changes nothing visible.                                                                                                                      | `apps/web-e2e/visual/screens.json`                                                  |
| **`113a` depends on cross-suite data.** Its query-log state needs rows other screens' AI calls create.                                                                                                                                                                                                                                                                                                      | `apps/web-e2e/visual/screens.json`                                                  |
| **A monospace `font-family` slipped past stylelint.** `frontend-satori-styling.mdc` forbids it, but stylelint only enforces the ban in `.scss`, so an inline component style in `libs/web/features/ai/src/lib/ai-output.ts` was never checked.                                                                                                                                                              | issue #70's closing comment                                                         |
| **The default board pack (016a) renders all zeros.** The seed closes the period without writing `period_close_snapshots` rows, so the "latest closed period" view is empty. It is the seed, not the report — switch to the current open period and the figures are real. Fixing it moves the `016a-board-pack--default--*` baselines.                                                                       | `docs/architecture/phase-handoff.md`, "Known follow-ups from Phase 11"              |

---

## 9. Where things live

| Path                                                                    | What you will find                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/architecture/`](architecture/)                                   | Domain model, ledger, state machines, authorization matrix, API conventions. **`phase-handoff.md` is the single most useful file in the repository** — what each phase delivers, what it deliberately left, the seed prefix table and the phase map |
| [`docs/adr/`](adr/)                                                     | Six decisions with their consequences (monorepo, ledger, RLS, light theme, images, single company)                                                                                                                                                  |
| [`docs/ux/`](ux/)                                                       | `screen-inventory.md` (124 specified screens plus review additions), per-screen specs in `screens/`, design system, Stitch exports, design preview                                                                                                  |
| [`docs/testing/invariant-scenarios.md`](testing/invariant-scenarios.md) | Every invariant mapped to the API scenario that proves it. 94 rows; **add yours and keep the numbering contiguous**                                                                                                                                 |
| [`docs/local-access.md`](local-access.md)                               | Per-role Keycloak usernames, scenario-only users, service credentials, ports and their `BF_*_PORT` variables                                                                                                                                        |
| [`docs/ai-harness/README.md`](ai-harness/README.md)                     | How the agent harness builds this repository — skills, subagents, hooks, worktrees                                                                                                                                                                  |
| [`evidence/`](../evidence/)                                             | Per-phase proof. `evidence/README.md` explains the layout; named folders (`gate-reseed`, `stale-rail`, `fix-080e`, `guard-worktrees`, `nav-overlap`) hold investigations rather than phases, and several are better reading than the phase packs    |

Three pages are published outside the repository — a leadership overview, a capabilities page and the
clickable design preview. The [README](../README.md#documentation) links all three; the preview is
built from the approved Stitch exports and is described in [`docs/ux/preview.md`](ux/preview.md).
