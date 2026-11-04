# 004 Forgot password

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 2 gaps batch. Build phase P2 (Keycloak login theme `budgetflow`, like 001 and 003).

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Build in the Keycloak theme with the 001 sign-in layout. Planned exports: `design/stitch/004-forgot-password/default--desktop--light.png`, `email-sent--desktop--light.png`, `sso-user--desktop--light.png`.

## Purpose

Let a user with a BudgetFlow password reset it safely by email, and send single sign-on users to their company identity provider instead.

## Roles

Any user with a local BudgetFlow account (seeded test users locally); SSO users are redirected.

## Entry points

001 "Forgot password?" link; expired-password prompt.

## Content and actions

Same frame as 001: BudgetFlow logo, "Hyland" label, centered card.

- Default: title "Reset your password", text "Enter the email you sign in with. We will send a link that works once and expires in 30 minutes.", email field, "Send reset link" (filled), "Back to sign in" link.
- Email sent: "Check your email" with "If an account exists for k.shah@example.test, a link is on its way." (same message whether or not the account exists), "Resend in 60 s", "Back to sign in".
- SSO user: info box "Your company manages your password. Use 'Continue with Hyland single sign-on' and reset it there." with the SSO button.
- New password page (from the email link): new password and confirm, password rules listed (length 12+, not a recent password), "Set new password"; then sign-in with MFA if enrolled.

## Data and permissions

Keycloak reset-credentials flow (`resetPasswordAllowed`); no BudgetFlow API involved. Rate limited by Keycloak brute-force protection. Messages never reveal whether an account exists.

## States

| State          | Behaviour                                                        |
| -------------- | ---------------------------------------------------------------- |
| Default        | as above                                                         |
| Validation     | email format; password rules shown live on the new-password page |
| Email sent     | as above                                                         |
| Link expired   | "This link has expired" with "Send a new link"                   |
| Too many tries | "Too many attempts. Try again in 15 minutes."                    |

## Budget safety and audit

Not a financial screen. Keycloak records reset events; BudgetFlow's audit log records the next sign-in.

## Responsive and accessibility

Card full width on mobile; email field with `autocomplete="email"`; errors announced; focus moves to the message after sending.

## Related screens and navigation

001 sign-in, 003 MFA verification, 124 profile and preferences.

## Assumptions and open questions

- Production users sign in with SSO, so this page mainly serves local and test accounts (assumed).
