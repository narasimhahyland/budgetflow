# 102d Embeddable balance and events widgets

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 16 batch. Build phase P16. Settings > Widgets (`/admin/widgets`); the widgets render at `/embed/team-budget` and `/embed/events` inside intranet and HR portal pages.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the 116a card. Planned Stitch states, to be generated in a later session:

| State                              | Planned image                                                       |
| ---------------------------------- | ------------------------------------------------------------------- |
| widget settings and embed code     | `design/stitch/102d-embeddable-widgets/default--desktop--light.png` |
| team budget widget (embedded)      | `team-budget-widget--desktop--light.png`                            |
| events widget with RSVP (embedded) | `events-widget--desktop--light.png`                                 |
| not signed in                      | `signed-out--desktop--light.png`                                    |

## Purpose

Meet employees where they already are: show "Your team's budget" and upcoming events inside the company intranet or HR portal, for each viewer with their own sign-in and scope, so people discover the money and events available to them without opening BudgetFlow.

## Roles

Organization Admin (configure widgets and allowed sites); Integration Admin (co-manages allowed sites); every employee viewing a page with a widget (sees only their own data).

## Entry points

Settings > Widgets; 116a "Show this on the intranet" (admins); 092 hub "Widgets"; intranet and HR portal pages where the embed code is placed.

## Content and actions

Widgets list (settings): name, type (Team budget, Upcoming events), allowed sites, show amounts (on or off), status, views in 30 days, clicks to BudgetFlow.

Widget editor:

- Type: Team budget (the 116a card content) or Upcoming events (the viewer's invitations and open events for their location).
- Display: show amounts (on; off shows "Your team has budget for activities" without figures), number of events (3), program branding (102b).
- Allowed sites (required): the exact addresses of the intranet or portal that may show the widget, for example "https://intranet.example.test".
- Embed code: an iframe snippet with Copy; preview of the widget as a sample employee.

Team budget widget (embedded, sample Kavya Shah): "Team Spirit: USD 420.00 left this quarter for Bengaluru Platform team", bar, "Request funds" and "Open BudgetFlow" (open in a new tab).

Events widget: next three events with date and RSVP status; Going and Can't go buttons (47a) for open invitations; "See all events".

Signed out: "Sign in to see your team's budget" button (opens sign-in in a pop-up and returns).

## Data and permissions

New P16 embed routes in the Angular app (minimal frame, no shell) served with a `frame-ancestors` policy limited to the allowed sites; each viewer signs in with company single sign-on and the widget calls the same 116a and 47a endpoints with the viewer's token, so `PolicyService` scope applies; no shared tokens or API keys are placed in pages. Widget settings are P16 `admin.ts` data; `tenant.settings.manage` (Organization Admin) or `integration.manage` to change. RSVP from the events widget uses the 47a endpoint with an idempotency key.

## States

| State            | Behaviour                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| Settings         | widgets list and editor                                                                         |
| Signed out       | sign-in button in the widget                                                                    |
| No team budget   | team budget widget shows "No shared team budget" in a neutral line (no hint at others' budgets) |
| Amounts hidden   | text without figures                                                                            |
| Frozen or zero   | same treatments as 116a (lock and info tone; important tone)                                    |
| Site not allowed | the browser blocks the frame; settings show "Blocked on 3 sites not in the list" with addresses |
| RSVP saved       | inline "You're going" confirmation                                                              |
| Loading / error  | ghost line; "BudgetFlow is unavailable" with a link                                             |

## Budget safety and audit

Widgets are read-only apart from RSVP, which moves no money (per-head costs change only on final attendance). Each viewer sees only their own team's "Available under this budget's rules" and invitations. Widget and allowed-site changes are audited; RSVPs are recorded as in 47a.

## Responsive and accessibility

Widgets adapt from 280 px to 600 px wide; the iframe has a title ("BudgetFlow: your team's budget"); text and bar values are readable without the BudgetFlow page styles of the host.

## Satori components

Settings: `sat-header-bar`, `mat-table` with `satTableWithRowStates`, `sat-status-tag`, `sat-banner`, `sat-ghost`; Angular Material form fields, slide toggles, dialog, snackbar. Widgets: `sat-interactive-card`, `sat-status-tag`, `satImportantButton`; `bf-money` and the budget bar from `libs/web/ui`.

## Related screens and navigation

116a team budget card, 047a invitations and RSVP, 115 employee home, 102b program branding, 092 integrations hub, 112 security settings.

## Decisions taken

- Widgets are iframes in which each viewer signs in with company single sign-on; no API keys or shared tokens are embedded in intranet pages. Recommended so a widget can never show one person's data to another.
- Only listed sites may display widgets.
- Amounts can be hidden per widget for pages where figures are not wanted.
- RSVP is allowed from the events widget because it moves no money; everything else opens BudgetFlow.
