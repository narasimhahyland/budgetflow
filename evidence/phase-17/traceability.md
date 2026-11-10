# Phase 17 — traceability: which built features does a functional check reach?

Status: **audit in progress.** Against `main` at `b2141ae`.

The plan's Phase 17 asks for "every feature traced to a passing functional check". This page records
how that was measured, what it found, and what is being done about each gap.

## Two directions, two answers

**From the screen inventory** (`docs/ux/screen-inventory.md`, 227 screens): a first pass matched each
screen number against the visual suite (`screens.json` ids) and against journey files that cite the
number. Result in [`screen-coverage.tsv`](screen-coverage.tsv): 54 both, 90 visual only, 17 journey
only, 3 deferred, **63 neither**. That last figure overstates the gap — many screens are tested
without their number being cited, and some inventory entries are served inside another screen (the
approval inbox's "Delegated to me" and "Escalated" tabs, for instance). The spec files' `Status:`
lines record design status, not build status, and most are stale, so they cannot settle it either.
Seven of the 63 are known unbuilt (`017b`, `043a`, `044a`, `045b`, `047c`, `047d`, `080i`; handoff
section 5).

**From the routes the web app serves**, which is decisive: every feature route was matched against
every path a journey or visual state opens ([`visited-paths.json`](visited-paths.json), 158 distinct
paths). **Of 122 feature routes, 11 are never opened by URL.** One is the sign-in callback, exercised
by every sign-in. Of the other ten:

| Route                             | Feature lib | Any spec mentions it?       | Assessment   |
| --------------------------------- | ----------- | --------------------------- | ------------ |
| `finance/actuals/matched`         | accounting  | no                          | **untested** |
| `finance/actuals/rules`           | accounting  | no                          | **untested** |
| `events/all`                      | events      | no                          | **untested** |
| `events/:eventId/people/:section` | events      | no                          | **untested** |
| `settings/notifications`          | mobile      | no                          | **untested** |
| `admin/org`                       | org         | no                          | **untested** |
| `finance/actuals/queue`           | accounting  | weak ("queue", "Unmatched") | to confirm   |
| `finance/actuals/events/:eventId` | accounting  | 2 specs                     | to confirm   |
| `delegations`                     | approvals   | 3 specs                     | to confirm   |
| `org/people/:personId`            | org         | 1 spec                      | to confirm   |

The six untested routes are built features no functional check reaches. Closing them is Phase 17
work: a journey per route, asserting the business outcome the screen exists for.
