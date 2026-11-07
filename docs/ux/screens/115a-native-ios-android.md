# 115a Native iOS and Android layouts

Status: **deferred by product decision** - not built in Phase 16 and not scheduled. Spec only - image pending (Stitch quota). Light theme only. UX Phase 16 batch. Native shells in `apps/mobile` (Capacitor) wrapping the mobile web routes `/m/*` of 59a, 59b and 47c. This spec lists only what differs from the installable web app.

The wrappers are app-store packaging over the existing web experience, and the Phase 8 mobile routes
(`/m/approvals`, `/m/balance`, `/m/receipt`, `/m/alerts`) already serve phone users, so deferring them
costs no user-facing capability. The decision and the conditions any future wrapper has to meet are
recorded under "Native app wrappers: deferred by product decision" in
[phase-handoff.md](../../architecture/phase-handoff.md). This spec is kept, not deleted, so the design
survives if the wrappers are picked up later; `apps/mobile` does not exist in the repository today.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the 59a mobile frame, 59b and 47c; images show the iPhone and Android layouts where they differ. Planned Stitch states, to be generated in a later session:

| State                                  | Planned image                                                           |
| -------------------------------------- | ----------------------------------------------------------------------- |
| first launch and sign-in               | `design/stitch/115a-native-ios-android/first-launch--mobile--light.png` |
| biometric unlock                       | `biometric--mobile--light.png`                                          |
| push permission (after first approval) | `push-permission--mobile--light.png`                                    |
| tab bar with Check-in (organizer)      | `tabs-organizer--mobile--light.png`                                     |
| update required                        | `update-required--mobile--light.png`                                    |

## Purpose

Give approvers, organizers and employees store-installed apps with what the installable web app cannot do reliably: dependable push notifications, biometric unlock, deep links from email and chat straight into the app, a robust offline check-in at venues and native multi-page receipt capture, while keeping the same screens, rules and Satori UI as the web app.

## Roles

Approvers (CEO, Finance Controller, owners, delegates), Event Organizers, employees; the Organization Admin and Integration Admin see devices in 103 and 112.

## Entry points

App Store and Google Play ("BudgetFlow" published for Hyland); deep links from approval emails (061a), Slack and Teams cards (061b, 061c) and push notifications; invitations (47a) "Open in the app".

## Content and actions

What differs from the web app:

- Sign-in: company single sign-on in the system browser (not an embedded web view), returning to the app; then optional "Unlock with Face ID" (iOS) or "Unlock with fingerprint" (Android), asked once.
- Biometric unlock: required to reopen the app after 15 minutes in the background when turned on; falls back to SSO sign-in.
- Push: native notifications (APNs and FCM) with the 59c preferences; lock-screen text hides amounts by default ("Approval needed: REQ-2026-0418"); permission is asked after the first time the person opens an approval, not at first launch.
- Tab bar: Approve, Balance, Receipt, Alerts as in 59a, plus Check-in for organizers on event days (47c); Ask BudgetFlow (11a) and settings from the avatar menu.
- Deep links: universal links and app links open the matching `/m/*` screen; items the person cannot see open the 403 state.
- Offline check-in (47c): attendee list stored on the device for events the organizer runs in the next 24 hours, check-ins queued with time and synced; approvals stay online-only (59a decision).
- Receipt capture: native camera with edge detection and up to 5 pages (59b rule), compressed under 10 MB, then 121a extraction.
- No export or share actions: reports and exports stay in the web app.
- Version check: "Update BudgetFlow to continue" when the installed version is below the supported minimum; app store link.

## Data and permissions

`apps/mobile` loads the same Angular build (Capacitor) and calls the same APIs with the person's token kept in the iOS Keychain or Android Keystore; device registrations (platform, push token, app version, last seen) are stored per person (P16 `admin.ts`) and can be revoked by the person (124), the Organization Admin (103) or with "Sign out everyone" (112). Push payloads carry ids and short text, never amounts unless the person opted in. Decisions from the app post to the approval API with channel `mobile` and the device family, exactly like 59a. Supported versions: the current and previous major iOS and Android releases.

## States

| State            | Behaviour                                                                    |
| ---------------- | ---------------------------------------------------------------------------- |
| First launch     | welcome with "Sign in with Hyland single sign-on"                            |
| Biometric prompt | system prompt; failure falls back to SSO                                     |
| Push permission  | explanation sheet before the system prompt; "Not now" keeps email and in-app |
| Offline          | banner as in 59a; Check-in keeps working; approvals disabled with the reason |
| Sync pending     | "6 check-ins waiting to sync" on the Check-in tab                            |
| Update required  | blocking screen with the store link                                          |
| Device revoked   | signed out with "This device was signed out by your administrator"           |
| Deep link denied | 403 state with "Go to Home"                                                  |

## Budget safety and audit

Money decisions need a live connection and show the same budget impact and delegation-of-authority checks as 59a; only check-ins and receipts can be captured offline. Decisions are audited with channel "mobile" and the device family; device registrations and revocations are audited.

## Responsive and accessibility

Phone layouts at 390-430 px, respecting safe areas and the system text size; tablets use the web tablet layout in the app. Biometric and push prompts are skippable; all actions also work with screen readers (VoiceOver, TalkBack) through the web app's labels.

## Satori components

The same Satori components as 59a, 59b and 47c inside the Capacitor shell; custom `bf-mobile-tab-bar` (from 59a) gains the Check-in tab; native plugins (camera, biometrics, push, secure storage) are wrapped in `apps/mobile` with no UI kit of their own.

## Related screens and navigation

059a mobile approvals, 059b mobile balance and receipts, 059c notification channels, 047c check-in, 121a extraction, 011a assistant, 103 users (devices), 112 security, 124 profile.

## Decisions taken

- The native apps wrap the same Angular `/m/*` routes (Capacitor), so Satori stays the single UI and every rule is identical. Recommended to avoid a second code base with diverging controls.
- Sign-in uses the system browser with company single sign-on; biometric unlock is optional and only protects reopening the app.
- Push permission is requested after the first approval opened, and lock-screen text hides amounts by default.
- Only check-ins and receipts work offline; approvals stay online-only.
- No export or share actions in the native apps, keeping "Export only" a web feature.
