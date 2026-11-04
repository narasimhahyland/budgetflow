# 061e Slack and Teams app setup and account linking

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 8 batch. Build phase P8. Review-added screen (needed so 061b-61d work: per-company app consent and per-person account links). Admin > Channels (`/admin/channels`); account-link page `/link/chat` (no app shell). From P12 also listed as tiles on the integrations dashboard (092).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the slim page frame of the 061a reject page for `/link/chat`. Planned Stitch states, to be generated in a later session:

| State                                      | Planned image                                                           |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| Slack connected, Teams waiting for consent | `design/stitch/061e-chat-app-setup-linking/default--desktop--light.png` |
| Slack needs attention (token revoked)      | `needs-attention--desktop--light.png`                                   |
| disconnect confirmation                    | `disconnect-dialog--desktop--light.png`                                 |
| account-link page (confirm)                | `link-page--mobile--light.png`                                          |
| account-link email mismatch                | `link-mismatch--mobile--light.png`                                      |

## Purpose

Connect BudgetFlow to the company's Slack workspace and Microsoft Teams tenant, choose which chat features are on, and bind each person's chat account to their BudgetFlow identity, so a decision made in chat is provably made by the right approver.

## Roles

Integration Admin (connect, configure, disconnect, unlink people); Organization Admin and Finance Admin (read). Every user links their own account on the link page.

## Entry points

Admin > Channels; 092 integrations dashboard tiles (P12); "Connect your BudgetFlow account" cards in Slack and Teams (061b-61d); 59c "Connect Slack" or "Connect Teams".

## Content and actions

Channels page:

- Slack card: status tag Connected; workspace "Hyland"; connected by Nadia Farouk (Integration Admin, fictional) on 2 Nov 2026; feature toggles: Approval cards, Balance and quick request, Alerts, Scheduled report posts (allowed channels: #finance-reports, #india-leads; "Add channel"); "214 of 260 approvers linked" with "Remind unlinked approvers" (sends a direct message with the Connect button); delivery health for the last 24 hours (1,148 messages sent, 3 retried, 0 failed); Disconnect.
- Microsoft Teams card: status tag "Waiting for admin consent"; steps: 1 "Grant consent in Microsoft Entra" (button opens the admin consent page), 2 "Approve the BudgetFlow app in the Teams admin center" (button "Download app package"), 3 "Check status"; feature toggles disabled until connected.
- Linked people table (tabs Slack, Teams): person, role, chat account (@meera.iyer), linked on, last used, Unlink (row action); filter "Approvers not linked".
- Credentials line: "Bot token and signing secret are kept in the server's secret store." No secret value is ever shown or editable here.

Account-link page (`/link/chat`, opened from a chat Connect button, signs in with BudgetFlow SSO first):

- Card: "Connect Slack to BudgetFlow"; "Slack account: @meera.iyer (meera.iyer@example.test)"; "BudgetFlow: Meera Iyer, Regional Manager, India"; note "Approvals you make in Slack will be recorded as yours."; buttons Connect and Cancel.
- Success: "Connected. You can close this tab and return to Slack." The original chat card refreshes with its actions.

## Data and permissions

New P8 data (`channels.ts` contract): chat installations (provider, workspace or tenant id, status, features, allowed channels, installed by, installed at; credentials as secret-store references only) and chat account links (person, provider, provider user id, verified email, linked at, last used). `integration.manage` to connect, configure, disconnect and unlink; `tenant.read` to view. Linking requires an authenticated BudgetFlow session and an exact match between the chat account's verified email and the person's email; otherwise `CHAT_LINK_EMAIL_MISMATCH`. Slack install uses OAuth v2 with bot scopes for direct messages, commands and user email lookup; Teams uses Entra admin consent and an org-approved app package. Disconnecting stops chat delivery immediately; pending approvals fall back to email (061a) and in-app.

## States

| State               | Behaviour                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Not connected       | card with "Connect Slack" (or the Teams steps) and a one-line description of each feature                                           |
| Connecting          | returning from Slack OAuth: "Finishing setup" spinner, then Connected                                                               |
| Waiting for consent | Teams steps as above; "Check status" re-reads the consent                                                                           |
| Connected           | as above                                                                                                                            |
| Needs attention     | error banner "Slack revoked BudgetFlow's access on 4 Nov 09:12. Approval cards are paused; approvers get email instead." Reconnect  |
| Disconnect dialog   | lists the effect (open cards stop working, 12 pending approvals move to email), typed confirmation "DISCONNECT"                     |
| Unlink person       | confirmation "Meera Iyer will need to connect again before deciding from Slack"                                                     |
| Link page           | as above                                                                                                                            |
| Link mismatch       | error card "Your Slack email (m.iyer@example.test) doesn't match your BudgetFlow email. Ask your administrator to fix one of them." |
| Link success        | as above                                                                                                                            |
| Read-only viewer    | toggles and actions disabled with "Only Integration Admins can change channels"                                                     |
| Loading / error     | `sat-ghost` cards; error banner with Retry                                                                                          |

## Budget safety and audit

Connect, disconnect, feature changes, allowed channel changes, link and unlink are audited (who, when, provider, before and after). Linking is the control that makes chat decisions attributable, so it always needs a fresh BudgetFlow sign-in. No secret values appear in the UI, the audit log or the repository.

## Responsive and accessibility

Channels page: desktop and tablet; mobile read-only. Link page: phone-first single card (most people link from Slack or Teams mobile). Status tags use icon and text; the typed confirmation field has a visible label.

## Satori components

`sat-header-bar`, `satCardSurfaceContainerLowest` cards, `sat-status-tag` (Connected, Waiting for admin consent, Needs attention, Not connected), `sat-banner`, `mat-table` with `satTableWithRowStates` (linked people), `sat-navigation-tabs` (Slack, Teams), `satImportantButton` (Connect), `sat-ghost`; Angular Material slide toggles, dialog (disconnect with typed confirmation), chips (allowed channels), snackbar.

## Related screens and navigation

061b, 061c, 61d chat surfaces, 59c notification channels, 091 scheduled report posts, 092 integrations dashboard (P12), 088 audit log, 103 user and role management.

## Decisions taken

- Integration Admin owns chat setup (same role as other integrations); Organization Admin and Finance Admin read. Recommended so one role controls every external connection.
- Each person links once through a BudgetFlow sign-in with an exact email match; no silent auto-linking by email alone, because chat decisions must be bound to the right approver.
- Scheduled report posts only go to channels the Integration Admin has allowed.
- When chat access breaks or is disconnected, approvals fall back to email and in-app automatically.
