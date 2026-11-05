# 122a Gamified participation

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 15 batch. Build phase P15. Events > Participation (`/participation`); badges on organizer profiles (122b) and a leaderboard card on 043 events dashboard and 115 employee home.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the participation figures of 15b. Planned Stitch states, to be generated in a later session:

| State                              | Planned image                                                           |
| ---------------------------------- | ----------------------------------------------------------------------- |
| location leaderboard and challenge | `design/stitch/122a-gamified-participation/default--desktop--light.png` |
| organizer badges                   | `badges--desktop--light.png`                                            |
| leaderboard card on employee home  | `home-card--mobile--light.png`                                          |
| small locations not ranked         | `small-groups--desktop--light.png`                                      |

## Purpose

Raise turnout with friendly competition between offices and teams and visible credit for volunteer organizers, ranking only participation (who takes part), never spending, so nobody is encouraged to spend more to climb a table.

## Roles

All employees (see the leaderboard and challenges for their company); Event Organizers (earn badges); Organization Admin (People Ops: runs challenges, sets badge rules); owners see their locations' positions.

## Entry points

Events > Participation; 043 events dashboard leaderboard card; 115 employee home "Your office this month"; 15b participation "Leaderboard"; 122b organizer profile badges; monthly digest (64a) "Your office's turnout".

## Content and actions

Header: title, period (This quarter, This month, FY2026), note "Ranked by turnout: the share of eligible people who took part. Spending never counts."

Location leaderboard (offices with at least 5 eligible people): rank, office, turnout (attended at least one event), events held, attendance rate of people who said Going, change since last period. Samples: 1 Bengaluru 71.9% (+4.2), 2 Hyderabad 67.7% (+6.0, "Most improved"), 3 Westlake 65.0%, 4 London 62.9%.

Team leaderboard tab (within an office; teams with at least 5 people): team, turnout, events, change.

Challenge card (Organization Admin creates): "November challenge: every Bengaluru team holds one activity", progress "23 of 31 teams", ends 30 Nov; completed teams listed by name; no prizes with money (recognition via 120a is separate).

Organizer badges (rules set by People Ops): First event, 5 events organised, Great feedback (average pulse at least 4.5 over 3 events), Inclusive host (hybrid option offered, 47d), Early planner (invitations at least 3 weeks ahead). Earned badges show on 122b with dates; organizers can hide them.

## Data and permissions

New P15 read endpoints in `reports.ts` computing turnout from attendance (47e: Attended and Walk-in) over eligible headcount (HR snapshot), per office and team, with the same minimum group size as 15b (5); challenges and badge rules as P15 data (Organization Admin, `tenant.settings.manage`). Badges are computed from completed events (54a pulse, 47a invitation timing, 47d options). No spend data is read for ranking. Individual employees are never ranked; organizers' badges are visible to signed-in colleagues unless hidden.

## States

| State           | Behaviour                                                                               |
| --------------- | --------------------------------------------------------------------------------------- |
| Default         | leaderboard and challenge                                                               |
| Small groups    | offices or teams under 5 eligible people listed as "Not ranked (fewer than 5 people)"   |
| Challenge done  | success banner "All Bengaluru teams held an activity in November"                       |
| Badge earned    | snackbar for the organizer "You earned Great feedback" with "Hide badge" in the profile |
| No data         | "Turnout appears once organizers mark attendance" with a link to 47e                    |
| Loading / error | `sat-ghost`; error banner with Retry                                                    |

## Budget safety and audit

No money is shown or ranked: positions depend on turnout only, so the page cannot reward spending. Challenges and badge rule changes are audited; badge awards are computed, not audited individually.

## Responsive and accessibility

Mobile: leaderboard as a list with rank, office and turnout in each row; the home card shows the user's office position. Ranks are numbers with text, not medals only; changes say "up 4.2 points".

## Satori components

`sat-interactive-card` (challenge, home card), `sat-navigation-tabs` (offices, teams), `mat-table`, `sat-status-tag` ("Most improved", "Not ranked"), `sat-avatar` (organizers), `sat-banner`, `sat-empty-state`, `sat-ghost`; Angular Material dialog (create challenge, badge rules), snackbar.

## Related screens and navigation

015b participation and reach, 043 events dashboard, 115 employee home, 122b organizer recognition, 120a recognition awards, 047e attendance, 054a survey, 047d remote participation, 064a digests.

## Decisions taken

- Rankings use turnout (share of eligible people who took part), never spend or cost per head. Recommended so the game rewards inclusion, not spending.
- Offices and teams are ranked; individual employees are never ranked.
- Groups under 5 people are not ranked, matching the participation suppression rule.
- Challenges carry no money prizes; monetary recognition stays in 120a with its controls.
- Organizers can hide their badges.
