# 001 Sign-in (covers 002 single sign-on)

Status: proposed - awaiting user review. Light theme only. Build phase P2 (already implemented as the Keycloak login theme; this design is the reference for its next revision).

## Design

| State   | Image                                                   | Stitch screen                      |
| ------- | ------------------------------------------------------- | ---------------------------------- |
| default | `design/stitch/001-sign-in/default--desktop--light.png` | `d6d327facf79447c8dbad4dd443ab76b` |

## Purpose

One page for every way in: Hyland single sign-on first, email and password as the fallback. 002 single sign-on is the primary button on this page; the identity provider's own pages are not BudgetFlow screens.

## Roles

All roles.

## Entry points

Any app URL without a session; sign-out (000a user menu); session expiry.

## Content and actions

Split layout: violet brand panel (logo, "Budget delegation and control for Hyland", three value lines). White card: "Hyland" label, title "Sign in to BudgetFlow", filled "Continue with Hyland single sign-on", divider, Work email, Password with show/hide, "Keep me signed in", "Forgot password?" (004), outlined "Sign in". Footer: "Need access? Ask your BudgetFlow administrator."

## Data and permissions

Keycloak OIDC with PKCE; the page is the Keycloak login theme. No tenant or organization selector (one company). MFA is optional per user: the hint about a verification code shows only when the user has TOTP set up, then 003 follows.

## States

| State             | Behaviour                                                                        |
| ----------------- | -------------------------------------------------------------------------------- |
| Wrong credentials | error banner in the card "Email or password is incorrect"; fields keep the email |
| Locked out        | error banner with the unlock time; Sign in disabled                              |
| SSO unavailable   | info banner "Single sign-on is unavailable. Sign in with your password."         |
| Loading           | buttons show a progress indicator; no layout shift                               |

## Responsive and accessibility

Below 900px the brand panel collapses to a header strip and the card fills the width. Labels are visible (not placeholders); errors are announced; the SSO button is the first focus stop.

## Related screens and navigation

002 single sign-on (same page), 003 MFA verification, 004 forgot password, 000a shell after sign-in.

## Assumptions and open questions

- Stitch added a "Hyland Enterprise Tenant" chip, an "Enterprise Governance & Identity Gate" tag and footer badges; ignore them (no tenant chip, no certification claims).
- The implemented Phase 2 Keycloak theme stays the reference until this design is approved; then the theme is aligned to it.
