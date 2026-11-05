# 102b Program branding

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 14 batch. Build phase P14. Settings > Program branding (`/admin/branding`, email templates `/admin/branding/emails/:templateId`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the settings layout of 102. Planned Stitch states, to be generated in a later session:

| State                              | Planned image                                                     |
| ---------------------------------- | ----------------------------------------------------------------- |
| programs and logo                  | `design/stitch/102b-program-branding/default--desktop--light.png` |
| email template editor with preview | `email-editor--desktop--light.png`                                |
| employee view preview              | `employee-preview--desktop--light.png`                            |
| invalid logo file                  | `logo-error--desktop--light.png`                                  |

## Purpose

Let employees recognise the programs they take part in by name instead of by budget code ("Team Spirit" rather than "Bengaluru Events FY2026"), with the company logo and friendly wording in the emails they receive, while the BudgetFlow look (Satori theme, colours, fonts) and every financial message stay consistent and correct.

## Roles

Organization Admin (edit and publish); Finance Admin (read); Event Organizers see program names when they create events; employees see the result.

## Entry points

Settings > Program branding; 010a guide step "Program branding"; 102 company card "Logo"; 020b program templates "Display name and description"; 047a invitation preview "Edit email wording".

## Content and actions

Company logo card: current logo (PNG or JPEG, at least 256 px, up to 1 MB, transparent PNG recommended), Replace, Remove; where it appears: emails, employee pages (115, 116, 116a), invitations (47a), sign-in page; "The sidebar keeps the company name 'Hyland' as text."

Programs table (one row per program template, 020b): template, display name, short description for employees, icon (from the Material Icons set), employee pages that use it, last changed. Samples:

- Per-head engagement: "Team Spirit", "Money for team activities, chosen by your team.", icon `groups`.
- Festival: "Celebrate Together", "Festival celebrations at your office.", icon `celebration`.
- Wellbeing: "Feel Good", "Wellbeing activities and sessions.", icon `spa`.
- Recognition: "Thank You", "Recognition awards from managers and peers.", icon `emoji_events` (used in P15, 120a).

Employee view preview (side panel): how a 116a team budget card and a 47a invitation look with the names and logo.

Email templates (employee-facing): event invitation, RSVP reminder, request approved, request returned for changes, receipt needed, team budget reminder, survey invitation. Editor: subject, greeting line, intro paragraph, closing line, footer; placeholders as chips ({{first_name}}, {{program_name}}, {{event_name}}, {{event_date}}, {{amount}}, {{link}}); live preview with sample data (Kavya Shah, Bengaluru Diwali celebration, USD 57.49); "Send a test to me"; Save draft, Publish. Fixed blocks are shown greyed and cannot be edited: amounts and statuses, decision buttons, legal and security text.

Approval and finance emails (061a approvals, controls, escalations, security): only the logo and footer apply; their bodies are fixed.

## Data and permissions

New P14 `admin.ts` contract: branding settings in `tenant_settings.settings` (logo document id, footer), program display fields on program templates (020b), email template versions (template key, fields, status Draft or Published, version, published by and when). Logos are stored through `DocumentStore` (MinIO locally) after the 121 checks (size and file signature); only PNG and JPEG are accepted. `tenant.settings.manage` (Organization Admin) to edit and publish; `tenant.read` to read. Published templates apply to emails rendered after publishing; emails already queued keep their version. Placeholders are filled server-side with escaped values.

## States

| State               | Behaviour                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| Default             | logo, programs, templates                                                                        |
| Logo uploading      | progress, then "Checking the file"                                                               |
| Logo error          | error container "Use a PNG or JPEG of at least 256 px and up to 1 MB"                            |
| Template draft      | info tag "Draft, not sent yet"; Publish enabled                                                  |
| Unknown placeholder | inline error "{{firstname}} isn't a placeholder. Did you mean {{first_name}}?"; Publish disabled |
| Too long            | "Subject: 80 characters at most"                                                                 |
| Test sent           | snackbar "Test email sent to you" (Mailpit in the local stack)                                   |
| Published           | success tag "Published v3, 4 Nov, Taylor Brooks"; version history with View                      |
| Read only           | Finance Admin and others: no edit controls                                                       |
| Loading / error     | `sat-ghost`; error banner with Retry                                                             |

## Budget safety and audit

Branding never changes amounts, statuses or decision content: those blocks are fixed in every template and always come from BudgetFlow. Program display names never replace the budget name in finance views (owners and finance still see "Bengaluru Events"). Logo changes, program names and template publishes are audited with old and new values.

## Responsive and accessibility

Desktop and tablet editing; mobile read-only. Logos need alternative text (defaults to "Hyland logo"); templates are checked for a plain-text version, which is sent alongside HTML.

## Satori components

`sat-header-bar`, `sat-upload-field` (logo), `mat-table` with `satTableWithRowStates`, `sat-status-tag` (template status), `satInlineChip` (placeholders), `sat-banner`, `sat-ghost`; Angular Material form fields, side sheet (employee preview), select (icon), dialog (version view), snackbar.

## Related screens and navigation

102 company settings, 020b program templates, 115 employee home, 116 available budgets, 116a team budget card, 047a invitations, 054a survey, 061a approval email, 109 notification settings, 010a setup guide.

## Decisions taken

- Branding covers the logo, program names and descriptions, and employee email wording only; there are no custom colours or fonts. Recommended so Satori stays the single visual language and contrast stays correct.
- Program display names are for employee-facing pages and emails; finance and owner views keep budget names, so reports always match the ledger.
- Amounts, statuses, decision buttons and security text are fixed blocks in every template.
- Logos are PNG or JPEG only (no SVG), because SVG files can carry scripts.
- The sidebar keeps "Hyland" as text; the logo appears in emails, employee pages and the sign-in page.
