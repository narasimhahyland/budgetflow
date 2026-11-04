# 005 First-time organization setup

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 2 gaps batch. Build phase P2 (steps that need P3 data link to 006, 007 and 009).

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Planned exports: `design/stitch/005-first-time-setup/default--desktop--light.png` (step 1 company basics), `roles-step--desktop--light.png`.

## Purpose

Walk the first Organization Admin through the few company-wide settings BudgetFlow needs before anyone else signs in, in a fixed order, with sensible defaults and nothing that can be changed by accident later.

## Roles

Organization Admin (and Super Admin during provisioning). Finance Admin completes the finance steps.

## Entry points

First sign-in of the Organization Admin when setup is incomplete (redirect); 010 setup completion dashboard "Continue setup".

## Content and actions

Shell without the full sidebar (setup mode: logo, "Hyland", "Setup" title, user menu). Vertical stepper: 1 Company basics, 2 Legal entities (006), 3 Fiscal year and currency (007), 4 Organization import (009), 5 Roles and people (008), 6 Review.

Step 1 Company basics (default):

- Company name: Hyland (read-only; one company, no switcher).
- Reporting currency: USD (locked; "All budgets are held in USD").
- Default timezone (America/New_York) and default number and date format (examples shown: "USD 30,000.00", "INR 8,30,000.00", "12 Dec 2026"); users can override in 124.
- Sign-in: single sign-on with the company identity provider (configured in Keycloak) plus local accounts for test users; MFA optional per user.
- Support contact email for the help menu.
- Footer: "Save and continue".

Right column: "What happens next" (who is invited after setup, what each step unlocks) and progress "Step 1 of 6".

## Data and permissions

Tenant settings (`tenant.settings.manage`, OA); later steps call the P3 master-data and P2 user APIs. Locked values (company name, reporting currency) are shown, not editable. Each step saves on continue; the wizard can be left and resumed.

## States

| State        | Behaviour                                                        |
| ------------ | ---------------------------------------------------------------- |
| Default      | as above                                                         |
| Validation   | timezone and support email required                              |
| Resumed      | opens at the first incomplete step with completed steps ticked   |
| Finance step | steps 2-3 show "Waiting for Finance Admin" when assigned to them |
| Completed    | redirects to 010                                                 |

## Budget safety and audit

No money moves. Each saved step writes an audit entry (setting, old and new value).

## Responsive and accessibility

Desktop and tablet; mobile shows "Continue setup on a larger screen" with progress. Stepper items are links with state text ("Completed", "Current").

## Related screens and navigation

006, 007, 008, 009, 010, 102 tenant settings.

## Assumptions and open questions

- Default timezone for the company (America/New_York assumed); users set their own in 124.
