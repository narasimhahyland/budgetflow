# 103 User and role management

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 2 gaps batch. Build phase P2. Settings > Users and roles.

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Planned exports: `design/stitch/103-user-role-management/default--desktop--light.png`, `edit-user--desktop--light.png` (drawer), `invite--desktop--light.png` (dialog).

## Purpose

Find any user, see their roles, scope and sign-in status, invite people, change roles and scopes safely, and deactivate leavers, with segregation-of-duties warnings and a full audit trail.

## Roles

Organization Admin (edit); Auditor (read).

## Entry points

Settings navigation; 008 after setup; 039 employee profile "Manage access".

## Content and actions

Header: search (name, email), filters (role, status, location, MFA), "Invite user" (filled), Export.

Table: name and email, roles (tags; "+2" overflow), scope (org units or budgets for owner roles; "Company-wide"; "Self"), status (Active success, Invited info, Deactivated neutral), MFA (Enrolled, Not enrolled), last sign-in, source (SSO group, Manual). Samples: Olivia Grant (CEO, company-wide); Marco Bianchi (Finance Admin); Priya Raman (Finance Controller); Meera Iyer (Regional Manager, India Region); Anand Kumar (Location Manager, Bengaluru Events); Kavya Shah (Employee, self); Hannah Cole (Auditor).

Edit user drawer: profile (from the identity provider, read-only), roles (checkbox list of the 14 with descriptions), scope per owner role (org unit or budget picker), "What this person can do" summary (from 104), segregation warnings, Deactivate (reason required; open approvals and delegations listed with where they go). Footer: Cancel, Save.

Invite dialog: email, name, roles, scope, message; note "SSO users are added automatically from group mappings (008); invite only people outside those groups".

## Data and permissions

Users, role assignments and scopes (`users.manage`); identity attributes come from Keycloak and SCIM later (P12). Deactivation hands open approval tasks to the next authority and ends delegations. Nobody can remove the last Organization Admin or Finance Admin.

## States

| State               | Behaviour                                                                            |
| ------------------- | ------------------------------------------------------------------------------------ |
| Default             | as above                                                                             |
| Segregation warning | Finance Admin plus Auditor on one person: warning container, reason required to save |
| Last admin          | removing the last Organization Admin: error container; Save disabled with the reason |
| Deactivate confirm  | lists 3 open approvals moving to Daniel Brooks and 1 delegation ending               |
| Empty search        | "No users match" with Reset filters                                                  |
| Success             | snackbars "Invitation sent to ..." and "Roles updated for Meera Iyer"                |

## Budget safety and audit

Role and scope changes take effect at the user's next request (tokens refresh) and are audited with old and new values and the reason when a warning was overridden.

## Responsive and accessibility

Tablet: hide source and last sign-in columns. Mobile: read-only list. Role checkboxes have descriptions linked by `aria-describedby`.

## Related screens and navigation

008, 039, 062 delegations, 104, 102, 103a bulk owner invites (P14).

## Assumptions and open questions

- Who may assign the CEO and Finance Admin roles: Organization Admin alone (assumed) or with Finance Admin confirmation?
