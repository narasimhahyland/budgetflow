# 124 Profile and preferences

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 2 gaps batch. Build phase P2. User menu > Profile and preferences.

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Planned exports: `design/stitch/124-profile-preferences/default--desktop--light.png`, `mfa-setup--desktop--light.png`.

## Purpose

Let every user see who BudgetFlow thinks they are (roles, scope, approval limit), set how money, numbers, dates and times are shown to them, choose optional notifications, and turn optional MFA on or off.

## Roles

All roles (own profile only).

## Entry points

User menu "Profile and preferences" (000a); 003 "Set up MFA later"; notification emails "Manage notification settings".

## Content and actions

Sections (single column of cards):

- Profile: name, email, job title, location, manager (from the identity provider; read-only, "Change these in Hyland's HR system").
- Access: roles and scope (read-only tags), approval limit from the DoA matrix ("You can approve up to USD 10,000.00 for all spend types"), active delegations given or received (link to 062).
- Formats: timezone (Asia/Kolkata), date format (12 Dec 2026), number format, INR display with lakh and crore grouping (on: "INR 8,30,000.00"), preview line "USD 30,000.00 - INR 8,30,000.00 - 12 Dec 2026, 14:30 IST". No language or theme setting (English and light theme only).
- Notifications: optional notifications by event and channel (in-app, email); required ones (decisions on my requests, approvals assigned to me, escalations) shown checked and disabled with "Required".
- Security: MFA "Optional" with status (Not enrolled) and "Set up authenticator app" (opens the Keycloak TOTP setup; state shows the QR code step); if enrolled, "Remove MFA" with confirmation; "Sign out of other sessions".

## Data and permissions

Preferences stored per user (`tenant.read`, own record); identity attributes from Keycloak; DoA from `lookupDoa`. MFA setup runs in Keycloak (TOTP, 6 digits, 30 seconds).

## States

| State          | Behaviour                                                     |
| -------------- | ------------------------------------------------------------- |
| Default        | as above                                                      |
| MFA setup      | QR code, manual key, 6-digit code field, "Verify and turn on" |
| MFA wrong code | field error "That code did not match. Try the next one."      |
| Saved          | snackbar "Preferences saved"; preview updates immediately     |
| Error          | error banner with Retry                                       |

## Budget safety and audit

Formatting changes display only; stored amounts never change. MFA enrolment and removal are recorded by Keycloak and in the BudgetFlow audit log.

## Responsive and accessibility

Mobile: cards stack; QR code with the manual key as text. Required notifications explain why they are disabled.

## Related screens and navigation

000a shell user menu, 003 MFA verification, 062 delegations, 102 company settings, 109 notification settings (P14).

## Assumptions and open questions

- Should MFA become required for finance roles later? Current decision: optional for everyone.
