# 044a Date and activity polls, idea board

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 15 batch. Build phase P15. Event details (046) tab "Polls" (`/events/:eventId/polls`); team idea board (`/ideas`, per team or location); employee poll page `/polls/:pollId`.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the invitation pages of 47a. Planned Stitch states, to be generated in a later session:

| State                  | Planned image                                                     |
| ---------------------- | ----------------------------------------------------------------- |
| organizer poll results | `design/stitch/044a-polls-idea-board/default--desktop--light.png` |
| employee voting page   | `vote--mobile--light.png`                                         |
| idea board             | `ideas--desktop--light.png`                                       |
| idea moved to planned  | `idea-planned--desktop--light.png`                                |

## Purpose

Give employees a say and raise turnout: organizers ask which dates work and which activity people prefer before committing money, and teams keep a board of activity ideas that people vote on, so events are planned around what people want and when they can come.

## Roles

Event Organizers and co-organizers (create polls, manage the board for their team or location, plan ideas); employees (vote, post and vote on ideas); budget owners (see the board for their locations).

## Entry points

046 event tab "Polls" (Draft and Approved events); 045 wizard "Ask people first"; 116a "Suggest an activity"; 115 employee home "Open polls"; poll invitations by email, push and Slack or Teams (59c); idea board link in the team's invitations.

## Content and actions

Create poll (organizer): type Date (up to 5 options with times), Activity (up to 6 options, each with an estimated cost per head from 45b or templates), or both; audience (invitees of the event, a team, a location), closes at (default 5 days), "Show results to voters after they vote" (on).

Organizer results (sample Rahul Verma, "Bengaluru Platform team outing"):

- Dates: Fri 13 Nov 24 of 30 can attend (best); Thu 19 Nov 19; Fri 27 Nov 15. Organizer sees who can attend each date (to plan headcount).
- Activity: Cooking class 12 votes (USD 24.00 per head), Bowling 9 (USD 14.00), Volunteering day 6 (USD 6.00).
- Budget line: "Team Spirit: USD 420.00 left this quarter; cooking class for 24 = USD 576.00 (USD 156.00 more than left)." with "Request additional funds" (057) or "Choose another".
- Actions: "Use Fri 13 Nov" (sets the event date), "Use Cooking class" (sets the activity and estimate), Close poll, Remind non-voters.

Employee voting page: options as large buttons (dates multi-select "I can make it", activity single choice), Submit; then results if enabled; change vote until close.

Idea board (Bengaluru Platform team): columns New, Planned, Done, Not now. Idea card: title, short description, rough cost (Low, Medium, High), votes, comments, author. Samples: "Cricket match against the Hyderabad team" (31 votes, Medium), "Monthly board games evening" (18, Low), "Pottery workshop" (9, Medium). Actions: Post an idea, Upvote (one per person), Comment; organizers: "Plan this" (creates a draft event in 045 prefilled), "Not now" (reason shown to the author), Hide (inappropriate content; author notified).

## Data and permissions

New P15 polls and ideas data in `events.ts` (polls with options, audience, close time; votes per person; ideas with status, votes, comments). Audience scoping uses P3 teams and locations; employees see polls and boards for their own teams or locations only. Votes are visible as counts to everyone in the audience; for date polls the organizer also sees who can attend. Ideas and polls never create commitments; "Plan this" creates a Draft event that follows the normal approval and funding path. `event.manage` scope for organizers; employees act on their own votes and ideas.

## States

| State           | Behaviour                                                                          |
| --------------- | ---------------------------------------------------------------------------------- |
| Poll open       | results update live for the organizer; "Closes Fri 6 Nov 17:00"                    |
| Voted           | "Thanks, you can change your vote until Fri 17:00"; results if enabled             |
| Closed          | final results; voting disabled                                                     |
| Over budget     | warning line on the activity option above what is left, with the two actions above |
| No votes        | "No votes yet" with Remind                                                         |
| Idea planned    | success tag "Planned: Cricket match, 20 Nov" with a link to the event              |
| Not now         | neutral tag with the reason, visible to the author                                 |
| Hidden          | removed from the board; author sees "Hidden by the organizer: off-topic"           |
| Empty board     | "No ideas yet. What would your team enjoy?" with Post an idea                      |
| Loading / error | `sat-ghost`; error banner with Retry                                               |

## Budget safety and audit

Polls and ideas move no money; the budget line uses the team budget's "Available under this budget's rules" (116a) and points to the normal request paths when an option costs more. Creating and closing polls, planning or declining ideas and hiding content are audited; individual votes are not.

## Responsive and accessibility

Employee voting is mobile first (412 px, 48 px buttons). Results bars carry counts as text; the board columns become tabs on mobile.

## Satori components

`sat-interactive-card` (ideas, options), `sat-status-tag`, `sat-banner`, `sat-avatar` (authors), `sat-empty-state`, `sat-ghost`, `satImportantButton` (Submit vote); Angular Material button toggles, checkboxes, dialog (create poll, not now), snackbar; `bf-money`.

## Related screens and navigation

046 event details, 045 create event, 45b planning copilot, 047a invitations, 116a team budget card, 057 additional-fund request, 043a holiday overlay (date options), 115 employee home, 059c notification channels.

## Decisions taken

- Votes are shown to peers as counts only; for date polls the organizer also sees who can attend, because headcount drives cost. Recommended to keep voting honest while making planning possible.
- Ideas are posted with the author's name; voting on ideas is one upvote per person.
- Polls and ideas never create spend; "Plan this" creates a Draft event that goes through normal approval.
- "Not now" needs a reason the author can see, so people know their idea was considered.
- Each activity option shows its cost against what is left in the team's budget.
