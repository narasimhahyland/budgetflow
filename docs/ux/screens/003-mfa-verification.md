# 003 MFA verification

Status: proposed - awaiting user review. Light theme only. UX core set (todo `ux-core-screens`). New screen.

Revised 2026-11-04 to the single-company decisions: Hyland only (static label, no tenant or organization switcher, no reporting-currency chip), budgets in USD (transactions may show INR or EUR with the USD amount), Export instead of Share. Stitch labels the corner tag 'Hyland Enterprise Tenant'; show 'Hyland' only.

## Design

| State                         | Image                                                            | Stitch screen                      |
| ----------------------------- | ---------------------------------------------------------------- | ---------------------------------- |
| default with wrong-code error | `design/stitch/003-mfa-verification/default--desktop--light.png` | `4f02e6692a534801adbb11c20496102c` |

## Purpose

Second step of sign-in: the user enters the TOTP code from their authenticator app, as required by the tenant's Keycloak realm policy.

## Roles

All users of tenants that require MFA (default for every role; mandatory for finance, admin and auditor roles).

## Entry points

After 001 sign-in or 002 SSO when the realm requires TOTP; after "Trust this browser" expires.

## Content and actions

Split layout: violet brand panel left, card right. Back link with the account email; six digit boxes (auto-advance, paste fills all); "Trust this browser for 30 days"; Verify; "Use a recovery code". Error banner under the card for a wrong code with attempts left and lockout time.

## Data and permissions

Rendered by Keycloak with a BudgetFlow theme (no app data). Lockout and attempt counts come from the realm brute-force settings.

## States

| State              | Treatment                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Default            | Empty boxes, Verify disabled until 6 digits                                                                         |
| Validation / error | Wrong code: error banner with attempts left (image); expired code: same banner with "Codes change every 30 seconds" |
| Locked             | Error banner "Too many attempts. Try again in 5 minutes." and boxes disabled                                        |
| Loading            | Verify shows a progress indicator                                                                                   |
| Success            | Redirect to the page the user asked for                                                                             |

## Audit

Keycloak records login, MFA success and failure events; BudgetFlow audit gets a "Login - MFA verified" entry on first API call (088 sample row).

## Responsive

Mobile: brand panel collapses to a top logo; card full width; numeric keypad (`inputmode="numeric"`, `autocomplete="one-time-code"`).

## Accessibility

One labelled input group ("Verification code, 6 digits"); errors announced with `role="alert"`; no time limit on the page itself.

## Related screens and navigation

001 sign-in, 002 SSO, 004 forgot password, 000a shell (destination).

## Open questions

- Should "Trust this browser" be allowed for finance and admin roles, or disabled by policy?
- 001 sign-in has no exported design: Stitch timed out twice (see review log). It reuses this split layout with SSO first, then email and password.
- Stitch render notes: trust badges and the "TLS 1.3" footer in the render are illustrative, not product copy.
