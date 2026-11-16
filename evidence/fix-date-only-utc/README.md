# Fix: date-only fields shown a day early east of UTC

Follow-up from `evidence/gap-b4-reclaim/README.md` ("the date-only `'UTC'` formatting in 33 other feature files").

## The bug

Angular's `DatePipe` / `formatDate` parse an ISO date-only string (`YYYY-MM-DD`) as **local midnight**
(`createDate` in `@angular/common`). Formatting it with the `'UTC'` timezone then shows the UTC calendar day of
that instant:

| Browser zone     | `'2026-11-01' \| date: 'd MMM y' : 'UTC'` | After the fix |
| ---------------- | ----------------------------------------- | ------------- |
| UTC              | 1 Nov 2026                                | 1 Nov 2026    |
| America/New_York | 1 Nov 2026 (local midnight is 05:00 UTC)  | 1 Nov 2026    |
| Europe/Berlin    | 31 Oct 2026                               | 1 Nov 2026    |
| Asia/Kolkata     | 31 Oct 2026                               | 1 Nov 2026    |

So the bug hits viewers **east** of UTC (the follow-up note said west; it is the other way round). With a
`'MMM y'` format a 1 January date read as the previous December.

## The fix

- Every `| date: '…' : 'UTC'` call site in `libs/web` (83 of them in 37 files) was checked against its contract field
  type in `libs/contracts`. All but two format an `IsoDate` field, or a local `YYYY-MM-DD` signal such as the
  cost-center "as of" picker. Those call sites now drop the `'UTC'` argument, so the date is parsed and
  formatted in the same local zone. This matches the reclaim screens.
- Kept on `'UTC'`, because they are `IsoDateTime` timestamps: `e.occurredAt` in the fiscal calendar
  log (labelled "UTC" on screen) and `d.submittedAt` in tax recoverability.
- Left alone because they are already correct:
  - the `bfDate` pipe (`libs/web/ui/src/lib/date-time.ts`), which parses with `new Date()`, so a date-only
    string is UTC midnight and `bfDate: 'UTC'` gives the right day;
  - the `Intl` `timeZone: 'UTC'` helpers in tie-out and employee benefits, which build the date in UTC.
- No new pipe: dropping the argument keeps each call site as simple as the reclaim reference.

## Functional proof

Journey `apps/web-e2e/src/dates/calendar-dates.spec.ts` (finance controller) runs in `Asia/Kolkata` and
`America/New_York` with Playwright `timezoneId`. It checks the browser's UTC offset first, then the seeded
November 2026 period (period page and period list) and the FY2026 calendar (year summary, chip, November row).

| Scenario                             | Expected                         | Before the fix (old `libs/web`)             | After              |
| ------------------------------------ | -------------------------------- | ------------------------------------------- | ------------------ |
| Browser offset, Kolkata / New York   | −330 / +300 minutes              | pass                                        | pass (3 viewports) |
| Nov 2026 period, Kolkata             | "1 Nov – 30 Nov 2026"            | **fail**: "31 Oct – 29 Nov 2026"            | pass (3 viewports) |
| FY2026 calendar, Kolkata             | "runs 1 Jan 2026 to 31 Dec 2026" | **fail**: "runs 31 Dec 2025 to 30 Dec 2026" | pass (3 viewports) |
| Nov 2026 period and FY2026, New York | same text                        | pass (west of UTC was never affected)       | pass (3 viewports) |

- `functional/journey-before-fix.txt`: the run against the unfixed web bundle (desktop): 2 failed, 4 passed.
- `functional/before-fix-kolkata-fiscal-calendar.png`: the unfixed calendar in Kolkata.
- `functional/journey-after-fix.txt`: the run with the fix, desktop, tablet and mobile: 18 passed.

No API, contract, ledger or invariant change, so there are no new API scenarios and
`docs/testing/invariant-scenarios.md` is unchanged.

## Gates and visual baselines

`gate-summary.txt` (`scripts/gate.sh --evidence evidence/fix-date-only-utc`, all modes). The visual suite runs
in UTC, where local and UTC formatting agree, so no baseline changed and none was updated.
