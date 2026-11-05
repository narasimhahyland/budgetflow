# 112 Security settings

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 14 batch. Build phase P14. Settings > Security (`/admin/security`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the settings layout of 102. Planned Stitch states, to be generated in a later session:

| State                        | Planned image                                                     |
| ---------------------------- | ----------------------------------------------------------------- |
| sign-in and sessions         | `design/stitch/112-security-settings/default--desktop--light.png` |
| break-glass grants           | `break-glass--desktop--light.png`                                 |
| break-glass request approval | `break-glass-approve--desktop--light.png`                         |
| security events              | `events--desktop--light.png`                                      |

## Purpose

Show and control how people sign in and stay signed in, review recent security events, and govern the rare cases when the platform operator needs to see company financial data (break-glass), all in one place, with the company decisions (single sign-on, MFA optional per user) stated plainly.

## Roles

Organization Admin (edit sessions, approve break-glass); Super Admin (requests break-glass; reads platform items); Finance Admin and Auditor (read; Auditor sees all break-glass history).

## Entry points

Settings > Security; 102 company "Sign-in and security" card (moved here in P14); 103 "Sign out everywhere" for a user; 101 "API keys expiring"; notifications "Break-glass access requested".

## Content and actions

Tab Sign-in and sessions:

- Identity provider: "Hyland single sign-on", status Connected, last metadata refresh; link to 098 (SCIM).
- Local accounts: "Allowed for test and service users only" (on), count 6.
- Multi-factor authentication: "Optional per user (company decision)", read-only, with "People turn MFA on in their profile (124). 41% of finance users and 18% of all users have it on."
- Sessions: idle timeout 30 minutes (5-240), maximum session 12 hours (1-24), "Sign out everyone now" (typed confirmation; used after an incident).
- Mobile and native apps: biometric unlock allowed (on, from P16), signed-in devices are listed per user in 103.

Tab Break-glass access:

- Explanation: "The platform operator cannot see Hyland's financial data. In an emergency they can request time-limited access, which an Organization Admin must approve. Everything they do is audited."
- Active and past grants: requested by (Sam Rivera, Super Admin), reason, scope (read-only; budgets and ledger), requested, approved by, starts, ends (at most 4 hours), status (Requested, Active, Expired, Revoked), actions taken count (link to 088 filtered).
- Request approval (Organization Admin): reason, scope, duration; Approve or Decline (reason); Revoke on an active grant.

Tab Security events (last 7 days): failed sign-ins 14 (by user, with lockouts 1), break-glass sessions 0, API keys expiring in 14 days 2 (101), webhook endpoints disabled 0 (101), role changes to admin roles 1 (103). Export (CSV).

## Data and permissions

Identity settings come from Keycloak (realm settings: session idle and maximum lifetimes) through the P14 `admin.ts` contract; MFA stays per user (P2 decision) and is shown read-only. Break-glass uses `break_glass_grants` (requester, approver, reason, scope, starts, ends, status); while active, the Super Admin's requests carry the grant and every read is audited with it; access ends automatically at the end time. `tenant.settings.manage` (Organization Admin) to change sessions and approve grants; Super Admin requests grants; `audit.read` to read security events. The approver can never be the requester.

## States

| State                 | Behaviour                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Default               | sign-in and sessions                                                                                                        |
| Unsaved               | "Unsaved changes" with Save and Cancel                                                                                      |
| Sign out everyone     | dialog "Everyone, including you, will need to sign in again." typed "SIGN OUT"                                              |
| Break-glass requested | warning banner for Organization Admins "Sam Rivera requests 2 hours of read access: investigate a sync error" with Review   |
| Break-glass active    | error-tone banner on this page and in the shell for Organization Admins "Break-glass access active until 14:30" with Revoke |
| Validation            | "Idle timeout must be 5-240 minutes", "Maximum session must be 1-24 hours"                                                  |
| Read only             | Finance Admin and Auditor: no controls                                                                                      |
| Loading / error       | `sat-ghost`; error banner with Retry                                                                                        |

## Budget safety and audit

Break-glass access is read-only and can never approve, post or change money. Every grant request, approval, decline, revocation and every action taken under a grant is audited; session and sign-in setting changes are audited with old and new values.

## Responsive and accessibility

Desktop and tablet; mobile read-only, except break-glass Approve and Decline which work on mobile (time-critical). Status words accompany every tone.

## Satori components

`sat-header-bar`, `sat-navigation-tabs`, `mat-table` with `satTableWithRowStates`, `sat-status-tag` (grant status), `sat-banner` (requested, active), `sat-ghost`; Angular Material form fields (number), slide toggles, dialog (approve, sign out everyone), snackbar.

## Related screens and navigation

102 company settings, 103 users and roles, 124 profile (MFA), 098 identity and SCIM, 101 API keys, 088 audit log, 113 audit and compliance, 114 system health, 115a native apps (biometrics, P16).

## Decisions taken

- MFA stays optional per user, shown read-only here with adoption figures. Recommended to honour the company decision while making adoption visible.
- Break-glass access is read-only, at most 4 hours, approved by an Organization Admin who is not the requester, and fully audited, with a visible banner while active.
- Idle timeout 30 minutes and maximum session 12 hours by default.
- Local accounts are limited to test and service users; everyone else signs in through company single sign-on.
