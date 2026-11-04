# 059a Mobile web approvals (installable app)

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 8 batch. Build phase P8. Installable mobile web app, tab "Approve" (`/m/approvals`, `/m/approvals/:taskId`), feature lib `libs/web/features/mobile`.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000 design system, 000a shell, mobile variant) and the decision content of 061. Planned Stitch states, to be generated in a later session:

| State                                 | Planned image                                                        |
| ------------------------------------- | -------------------------------------------------------------------- |
| approvals list                        | `design/stitch/059a-mobile-web-approvals/default--mobile--light.png` |
| approval detail with sticky actions   | `detail--mobile--light.png`                                          |
| reject bottom sheet (reason required) | `reject-sheet--mobile--light.png`                                    |
| above my limit (Approve hidden)       | `outside-doa--mobile--light.png`                                     |
| install prompt                        | `install--mobile--light.png`                                         |
| offline (read-only)                   | `offline--mobile--light.png`                                         |

## Purpose

Let approvers who travel or rarely open a laptop decide requests from their phone with the same facts and the same rules as the web app: amount, requester, budget impact after approval, the rule that routed it and their own approval limit. The mobile app is the same BudgetFlow web app, installable to the home screen, with a phone-first layout.

## Roles

Anyone with an open approval task: Location Manager, Regional Manager, Department Head, Budget Owner, Finance Controller, CEO, and delegates acting for them (062). Escalation approvers see escalated items here too (063).

## Entry points

Push notification "Approval needed" (59c); approval email (061a) and Slack or Teams cards (061b, 061c) opened on a phone; home-screen icon; mobile browser on any BudgetFlow approval link (redirects to `/m/approvals/:taskId` on small screens).

## Content and actions

App frame (mobile only): top bar with the BudgetFlow logo, "Hyland" and the avatar (opens 59c settings and Sign out); bottom tab bar with four tabs: Approve (badge count), Balance (59b), Receipt (59b camera), Alerts (123 on mobile).

Approvals list (sample approver Meera Iyer, Regional Manager India, approval limit USD 10,000.00):

- Segmented control: Waiting (3), Delegated to me (0), Done today.
- Cards, newest due first: request id and title, requester, budget, amount in USD with the transaction currency below, SLA tag.
  - REQ-2026-0418 Diwali celebration catering, Rahul Verma, Bengaluru Events, USD 6,000.00 (INR 5,01,000.00), "Due today" (warning tag).
  - REQ-2026-0421 Team lunch, Suresh Menon, Hyderabad Events, USD 180.00 (INR 15,030.00), "Due in 2 days".
  - REQ-2026-0430 Annual day venue, Anand Kumar, Bengaluru Events, USD 12,500.00, "Above your limit" (neutral tag).
- Pull to refresh; no bulk approve on mobile.

Approval detail (REQ-2026-0418):

- Summary: title, amount (USD 6,000.00; INR 5,01,000.00 at the FY2026 plan rate, USD 1 = INR 83.50), requester, charge to Bengaluru Events, event Bengaluru Diwali celebration (14 Nov 2026), needed by, justification, attachments (open in the viewer).
- Budget impact card: "Available under this budget's rules" before USD 7,450.00 and after USD 1,450.00; stacked bar (actual, committed, this request hatched, available); soft warning "This crosses the 80% alert threshold of Bengaluru Events".
- Why you: "Routed to you by R-12 v3 (amount above USD 5,000.00). Your limit: USD 10,000.00 for Events in IN01."
- Approval route as a vertical list (Anand Kumar approved, you now, Finance Controller only above USD 25,000.00).
- Discussion preview: last two comments (60a) with "View all".
- Sticky action bar: Reject (outlined), "Approve USD 6,000.00" (`satImportantButton`); overflow "Approve part or request changes" opens the full decision screen (061) in the mobile layout.

Reject opens a bottom sheet: reason code (required), "Reason for Rahul" (required, 500 characters), "Reject request" in the error tone, Cancel.

Install prompt: shown once after the second visit on a supported browser: "Add BudgetFlow to your home screen for push alerts and one-tap approvals", Install, Not now. On iOS the sheet explains the browser menu steps instead of an Install button.

## Data and permissions

Same approval API as the web decision screen (061): the task, request, budget impact preview, matched rules with facts and route come from the P5 approvals contract; decisions post to the same decision endpoint with channel `mobile` (`approval_channel` enum) and an idempotency key. `PolicyService.can(request.approve)` plus the approver's DoA limit for spend type, amount and legal entity decide whether Approve appears; self-approval and beneficiary checks run server-side. The budget impact is recomputed at decision time; if it changed since the list loaded, the app shows the new figures and asks again. Web app manifest and service worker make the app installable; the service worker caches the app shell and the last approvals list for offline reading only.

## States

| State           | Behaviour                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default list    | as above                                                                                                                                                                  |
| Detail          | as above; sticky actions stay above the tab bar                                                                                                                           |
| Reject sheet    | reason code and reason required; inline errors "Choose a reason code" and "Tell Rahul why"                                                                                |
| Above my limit  | Approve hidden (as 061 outside DoA); error banner "USD 12,500.00 is above your USD 10,000.00 limit" with "Escalate to Daniel Brooks" and Reject; "Approve part" opens 061 |
| Hard block      | budget frozen or set to zero since submission: error banner with the control, Approve disabled with the reason                                                            |
| Request changed | warning banner "The amount changed to USD 6,400.00 since you opened it" with Review again                                                                                 |
| Already decided | info card "Approved by Anand Kumar (delegate) at 10:42"; actions removed                                                                                                  |
| Offline         | top banner "You're offline. You can read waiting approvals; decisions need a connection." Actions disabled with that reason                                               |
| Install prompt  | bottom sheet as above; dismissed for 30 days by Not now                                                                                                                   |
| Loading         | `sat-ghost` cards                                                                                                                                                         |
| Empty           | `sat-empty-state` "You're all caught up" with "Set up a delegate" (opens 062 in the mobile layout)                                                                        |
| Error           | inline error card with Retry; a failed decision keeps the sheet open with the API problem detail                                                                          |
| Success         | snackbar "Approved REQ-2026-0418"; the next waiting card opens; badge count updates                                                                                       |

## Budget safety and audit

Pending (warning, hatched) and approved (solid) stay distinct in the impact bar; soft warnings never block, hard blocks always disable Approve with the reason written out. Decisions are never queued offline: the budget is checked at the moment of approval. Each decision writes the same audit entry as the web app with channel "mobile" and the device family (for example "Android, Chrome").

## Responsive and accessibility

Designed at 412 px; at tablet width (834) the web app layout (059) is used instead. Touch targets at least 48 px; the sticky action bar respects the safe area. Approve and Reject buttons carry the request id in their accessible names ("Approve REQ-2026-0418, USD 6,000.00"). Bottom sheet traps focus and closes with the back gesture.

## Satori components

`sat-interactive-card` (request cards), `sat-status-tag` (SLA and status), `sat-banner` (offline, soft warning, hard block, above limit), `satImportantButton` (Approve), `sat-rich-tooltip` replaced by an inline "Why you" section on touch, `sat-empty-state`, `sat-ghost`, `sat-403-error-state`; Angular Material bottom sheet (reject, install), button toggle group (segmented control), snackbar. Custom `bf-mobile-tab-bar` in `libs/web/ui` (neither Satori nor Material has a bottom navigation bar), built on `--mat-sys-*` tokens with Material Icons.

## Related screens and navigation

059 approval inbox (desktop), 061 approval decision, 062 delegated approval, 063 escalated approval, 060a comments, 061a email, 061b Slack card, 061c Teams card, 59b balance and receipts, 59c notification settings, 123 notifications. Back from the detail returns to the list with the scroll position kept.

## Decisions taken

- The mobile app is the existing Angular app with dedicated `/m/*` routes and a bottom tab bar (Approve, Balance, Receipt, Alerts), not a separate code base; recommended because Satori stays the single UI and native shells (P16) can wrap the same routes.
- Mobile offers Approve and Reject directly; partial approval and request changes open the full decision screen (061), matching the email decision of 2026-11-05.
- No bulk approve on mobile: each decision shows its own budget impact.
- Decisions are never queued offline; reading is allowed offline. Money decisions need a live budget check.
- The install prompt appears after the second visit, not the first, to avoid prompting people who only follow one link.
