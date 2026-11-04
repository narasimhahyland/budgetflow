# 102 Tenant settings (company settings)

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 2 gaps batch. Build phase P2. Settings > Company.

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Planned exports: `design/stitch/102-tenant-settings/default--desktop--light.png`.

## Purpose

Keep the few company-wide settings in one place, showing clearly which are fixed for the single company (name, reporting currency) and which an Organization Admin may change.

## Roles

Organization Admin (edit); Finance Admin (read, plus links to finance settings); Super Admin (system section only); Auditor (read).

## Entry points

Sidebar Settings > Company; 005 after setup; 010.

## Content and actions

Settings layout: left settings navigation (Company, Users and roles 103, Permissions 104, Legal entities 102a, Fiscal calendar 108, Exchange rates 107, Reason codes 106b, Vendors 106c, Notifications 109 later), right content.

Company section cards:

- Company: name "Hyland" (read-only, "One company; contact your administrator to change"), logo slot "Program branding arrives in Phase 14 (102b)".
- Money and formats: reporting currency USD (locked, "All budgets are held in USD; transactions may arrive in INR, EUR or GBP and convert at the locked plan rate"), default date format, default number format with lakh and crore grouping for INR display, default timezone; "Users can override formats and timezone in their profile (124)".
- Sign-in and security: identity provider "Hyland single sign-on" (status Connected), local accounts allowed for test users (on), MFA "Optional per user" (decision; read-only explanation), session timeout 30 minutes idle.
- Support: support contact email, help link.
- System (Super Admin only): environment, version, data region (read-only).

Footer for editable cards: Save changes (per card), Cancel.

## Data and permissions

Tenant settings (`tenant.settings.manage` for OA; `tenant.read` for others). Locked values are not part of the update payload. Changes write audit entries.

## States

| State      | Behaviour                                           |
| ---------- | --------------------------------------------------- |
| Default    | as above                                            |
| Validation | support email format; session timeout 5-240 minutes |
| Unsaved    | card shows "Unsaved changes" with Save and Cancel   |
| Read only  | non-OA roles see values without edit controls       |
| Success    | snackbar "Company settings saved"                   |

## Budget safety and audit

No financial effect. Every change is audited with old and new values; the reporting currency cannot change.

## Responsive and accessibility

Tablet: settings navigation becomes a select. Mobile: read-only. Locked fields say "Locked" in text with a lock icon.

## Related screens and navigation

005, 010, 103, 104, 102a, 107, 108, 124.

## Assumptions and open questions

- Session idle timeout default 30 minutes (assumed).
