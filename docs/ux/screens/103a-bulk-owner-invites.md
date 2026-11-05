# 103a Bulk owner invites

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 14 batch. Build phase P14. Settings > Users and roles > Invite owners (`/admin/users/invite-owners`, tracking `/admin/users/invitations`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the table and drawer of 103. Planned Stitch states, to be generated in a later session:

| State                             | Planned image                                                       |
| --------------------------------- | ------------------------------------------------------------------- |
| choose people (directory filters) | `design/stitch/103a-bulk-owner-invites/default--desktop--light.png` |
| suggested roles and budgets       | `suggestions--desktop--light.png`                                   |
| review and send                   | `review--desktop--light.png`                                        |
| invitation tracking               | `tracking--desktop--light.png`                                      |
| title rules                       | `title-rules--desktop--light.png`                                   |

## Purpose

Activate dozens or hundreds of budget owners in one pass: pick the managers from the directory or a file, accept a suggested role, scope and budget for each based on job title and what they manage, send one friendly invitation, and track who has signed in and made their first allocation, instead of setting up owners one by one in 103.

## Roles

Organization Admin (invite, edit title rules, resend, revoke); Finance Admin (read tracking; confirms Finance roles if any are suggested); invited people receive the email.

## Entry points

103 header "Invite owners"; 010a step 12 "Invite owners"; 023 hierarchy "Owners missing: 6" link; 18b product analytics "Owner activation" drill-in.

## Content and actions

Step 1, choose people: source tabs "From the directory" (filters: job title contains, location, department, "manages people", "not yet in BudgetFlow") and "Upload a file" (CSV with email, optional role and budget; template download). Selected list with count: "38 people selected".

Step 2, suggested roles (one row per person): person and job title, suggested role (select), suggested scope or budget (picker), reason, status. Samples:

- Anand Kumar, "Location manager, Bengaluru": Location Manager, budget Bengaluru Events. Reason: "Title rule 'Location manager' -> Location Manager; manages the Bengaluru location."
- Meera Iyer, "Regional manager, India": Regional Manager, budget India Region. Reason: "Title rule 'Regional manager'; budget India Region has no owner."
- Lakshmi Rao, "Employee experience coordinator": Event Organizer, scope Hyderabad. Reason: "Title rule 'experience coordinator'."
- Tom Reilly, "Senior engineer": no suggestion; "No title rule matches. Choose a role or remove." (warning tone).
- Daniel Brooks, already Department Head in BudgetFlow: "Already active, skipped" (neutral).

Bulk actions on selected rows: set role, set scope, remove. Title rules (side panel, editable list in priority order): "contains 'Location manager' -> Location Manager, scope: their location's events budget", "contains 'Regional manager' -> Regional Manager, scope: their region", "contains 'Director' -> Department Head", "contains 'experience coordinator' -> Event Organizer"; Test against the directory ("Matches 31 people").

Step 3, message: email from the branded template (102b) "You're a budget owner in BudgetFlow", personal note (optional, 500 characters), send now or on a date, reminder after 3 days (on), preview.

Step 4, review: counts by role (Location Manager 18, Regional Manager 3, Department Head 6, Event Organizer 9), budgets that will get an owner (21), segregation warnings from 103, skipped people (2 already active, 1 without email), Send invitations.

Tracking (tab "Invitations"): person, role, budget, sent, status (Invited, Signed in, First allocation made, Expired, Revoked), reminders sent, actions Resend, Revoke, Copy link. Funnel strip: Invited 38, Signed in 21, First allocation 9.

## Data and permissions

New P14 `admin.ts` endpoints over the 103 user and role assignment model: suggestions computed server-side from title rules (ordered contains rules on job title, plus what the person manages from reporting lines and org units, P3) and budgets without an owner; title rules stored per company. Invitations are role assignments in the Invited state plus an email; Hyland users accept by signing in through SSO, which activates the roles. Only people in the Hyland directory can be invited (no external emails); at most 500 per batch. `users.manage` (Organization Admin). Invitation links expire after 14 days. Activation milestones read from the product analytics pipeline (18b).

## States

| State               | Behaviour                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| Choose              | directory filters or file upload                                                                                |
| File errors         | rows with problems listed ("Row 7: email not in the directory"); valid rows continue, invalid ones are excluded |
| Suggestions         | as above; rows without a suggestion block Send until resolved or removed                                        |
| No budgets yet      | banner "Owners need a budget to own. Create budgets first (020 or 023a)." Owner roles disabled                  |
| Segregation warning | warning container as in 103; reason required to keep the role                                                   |
| Sending             | progress "Sending 38 invitations"                                                                               |
| Sent                | success banner and the tracking tab                                                                             |
| Expired             | neutral tag with Resend                                                                                         |
| Revoke dialog       | "The invitation link stops working; no roles are granted." confirmation                                         |
| Loading / error     | `sat-ghost`; error banner with Retry                                                                            |

## Budget safety and audit

Inviting an owner grants visibility and delegation rights over the assigned budget only after the person signs in; it never grants approval authority, which comes from the delegation-of-authority matrix (104a, 70a). Every invitation, role assignment, revocation and title-rule change is audited with who and when.

## Responsive and accessibility

Desktop and tablet; mobile shows tracking read-only. The wizard uses a stepper with step names announced; suggestion reasons are visible text, not tooltips only.

## Satori components

`sat-header-bar`, `sat-navigation-tabs` (directory or file; tracking), `mat-table` with `satTableWithRowStates` and `sat-selection-bar`, `sat-status-tag`, `sat-upload-area` (CSV), `sat-banner`, `sat-empty-state`, `sat-ghost`, `satImportantButton` (Send invitations); Angular Material stepper, select, side sheet (title rules), dialog, snackbar.

## Related screens and navigation

103 user and role management, 104 permission matrix, 104a delegation-of-authority matrix, 038 employee directory, 019 budget list, 023 hierarchy, 010a setup guide, 102b branding (email), 18b product analytics.

## Decisions taken

- Roles are suggested from job titles by transparent, editable title rules plus what the person manages, not by AI. Recommended because access grants must be explainable and predictable.
- Invited people activate by signing in with company single sign-on; there are no passwords to send and no external emails.
- Invalid file rows are excluded and listed while valid rows continue, because invitations are independent of each other (unlike the all-or-nothing headcount import).
- Tracking follows each owner to the first allocation, the activation milestone.
- An invitation never grants approval authority; that stays in the delegation-of-authority matrix.
