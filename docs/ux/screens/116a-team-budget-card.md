# 116a "Your team's budget" card

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 14 batch. Build phase P14. Card on the employee home (115), at the top of 116 available budgets and on the mobile Balance tab (59b); owners preview it from 021 ("What your team sees").

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the cards of 115. Planned Stitch states, to be generated in a later session:

| State                           | Planned image                                                     |
| ------------------------------- | ----------------------------------------------------------------- |
| card with money left and events | `design/stitch/116a-team-budget-card/default--desktop--light.png` |
| used up this quarter            | `used-up--desktop--light.png`                                     |
| paused (frozen)                 | `frozen--desktop--light.png`                                      |
| owner setting and preview (021) | `owner-preview--desktop--light.png`                               |
| mobile                          | `default--mobile--light.png`                                      |

## Purpose

Tell every employee that their team has money for activities, how much is left and what is coming up, so engagement budgets get used for what they are meant for, without exposing who spent what or the totals of the budgets above the team.

## Roles

Employees (and every role in "my view") for the teams and locations they belong to; Event Organizers see the same card plus "Plan an event"; the budget owner decides whether the budget is shown to the team and previews the card.

## Entry points

115 employee home (first card); 116 available budgets (top); 59b mobile Balance tab; 47a invitation emails ("Your team's budget: Team Spirit"); 102b program names; 021 owner preview.

## Content and actions

Card (sample Kavya Shah, Bengaluru Platform team):

- Header: program name and icon from branding ("Team Spirit", `groups`), team "Bengaluru Platform team", who manages it "Managed by Anand Kumar".
- Amount: "USD 420.00 left this quarter" (large), "of USD 1,350.00 (30 people x USD 15.00 a month)".
- Bar: used (spent and committed together, "USD 840.00 used"), waiting for approval (hatched, "USD 90.00 waiting"), left; text equivalents below.
- Period line: "Unused money returns to Bengaluru Events on 31 Dec" (from the rollover policy) or "Resets on 1 Jan".
- Upcoming (up to 2): "Team lunch, Fri 13 Nov, you're going" (RSVP status), "Bowling night, 27 Nov, reply by 20 Nov" with RSVP buttons Going and Can't go (47a).
- Actions: "Request funds" (117, prefilled with this budget), "Suggest an activity" (44a; shown once Phase 15 polls and ideas exist), "Ask Anand" (opens a comment to the owner, 60a).
- Several teams (matrix membership): one card per team, stacked; at most three, then "See all in Available budgets".

Owner setting (021 budget details, settings tab): "Show to team members" (on by default for budgets from the per-head engagement, festival and wellbeing templates; off for others), audience (people in the budget's location or team org unit; or a chosen team), preview of the card as a team member sees it.

## Data and permissions

New P14 read endpoint in `admin.ts` (or `budgets.ts`, integrator decides) returning, for the signed-in person, the budgets marked visible to their team or location (membership from P3 people, teams and locations): program display name, team name, owner name, "Available under this budget's rules", used (encumbered plus actual), pending, period and per-head formula when driven by headcount, rollover wording, and their upcoming invitations. It returns no line items, requesters or parent budgets. Employees do not hold `budget.read`; this projection is the only budget data they receive beyond 116. The owner's "Show to team members" setting needs `budget.control` on the budget.

## States

| State           | Behaviour                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Default         | card as above                                                                                                                  |
| Used up         | "Your team has used this quarter's budget. It refills on 1 Jan." Request funds hidden; events still listed                     |
| Low             | warning-tone amount when less than 10% is left: "USD 60.00 left this quarter"                                                  |
| Frozen          | info tone with lock: "Paused by Anand Kumar on 2 Nov. Plans already approved go ahead." Request funds disabled with the reason |
| Set to zero     | important tone: "No team budget for the rest of FY2026." Request funds hidden                                                  |
| No events       | "Nothing planned yet." with "Suggest an activity" (when available)                                                             |
| Not shared      | no card (nothing hidden is hinted at)                                                                                          |
| Several teams   | stacked cards                                                                                                                  |
| Loading / error | `sat-ghost` card; card-level error with Retry                                                                                  |

## Budget safety and audit

Employees see the team's "Available under this budget's rules", used and waiting amounts only, never the parent's totals or who spent what. Pending stays hatched and separate from used; frozen (lock, info) and zero (important) keep their distinct treatments. Read-only for employees; the owner's visibility setting change is audited.

## Responsive and accessibility

Mobile first: full-width card, Request funds full width, RSVP buttons at least 48 px. The bar has a text equivalent ("USD 840.00 used, USD 90.00 waiting for approval, USD 420.00 left"); the card is a region with the program name as its heading.

## Satori components

`sat-interactive-card`, `sat-status-tag` (frozen, zero, RSVP status), `sat-banner` (frozen), `satImportantButton` (Request funds), `sat-avatar` (owner), `sat-ghost`; Angular Material button toggle (RSVP), slide toggle (owner setting), snackbar; `bf-money`, budget bar from `libs/web/ui`.

## Related screens and navigation

115 employee home, 116 available budgets, 117 submit spending request, 047a invitations and RSVP, 044a polls and idea board (P15), 021 budget details, 022a per-head driver, 087c rollover policies, 102b program branding, 59b mobile balance, 060a comments.

## Decisions taken

- Employees see what is left in their team's budget, how much is used and waiting, and the period, but no line items, requesters or parent totals. Recommended because people use money they know exists, while spending details stay with owners. This answers the 115 open question.
- Owners choose whether a budget is shown; engagement, festival and wellbeing budgets are shown by default.
- The card states what happens to unused money (returns to the parent or resets) from the budget's rollover policy.
- Budgets the person cannot see produce no card and no hint.
