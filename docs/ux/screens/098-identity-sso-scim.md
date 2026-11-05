# 098 Identity and SSO integration (SCIM)

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 12 batch. Build phase P12. Admin > Integrations > Identity (`/integrations/identity`), in the connector frame of 092.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the connector frame of 092 and the group mapping of 008. Planned Stitch states, to be generated in a later session:

| State                  | Planned image                                                     |
| ---------------------- | ----------------------------------------------------------------- |
| SSO and SCIM overview  | `design/stitch/098-identity-sso-scim/default--desktop--light.png` |
| SCIM token shown once  | `token-once--desktop--light.png`                                  |
| provisioning log       | `log--desktop--light.png`                                         |
| deprovisioning preview | `deprovision--desktop--light.png`                                 |

## Purpose

Show how people sign in (single sign-on through the company identity provider) and let the identity provider create, update and deactivate BudgetFlow users and group-based roles automatically through SCIM, so joiners get access on day one and leavers lose it the same day, with their open approvals handed over.

## Roles

Integration Admin (SCIM token, settings); Organization Admin (group-to-role mapping, deprovisioning rules; owns 008 and 103); Auditor (read).

## Entry points

092 Identity tile; 008 role and permission setup "Group mapping"; 103 user management "Provisioned by SCIM" tags.

## Content and actions

SSO card (read-only here; configured in Keycloak): "Sign-in through the Hyland identity provider (OIDC); MFA optional per user"; status Connected; last successful sign-in 10:41.

SCIM card:

- Endpoint URL (copy) and authentication "Bearer token"; "Generate token" (shows the token once with Copy and "I have stored it"); token list with created by, created at, last used, Revoke. One active token plus one overlap token during rotation.
- Provisioning: users (create, update, deactivate), groups (membership drives roles through the 008 group mapping, for example group "bf-finance-admins" to Finance Admin).
- Matching: by work email, then employee id.
- Deprovisioning rule: deactivation hands open approval tasks to the next authority, ends delegations given or received, and keeps budget ownership pending reassignment (owner flagged on 103 and 017 alerts); nothing is deleted.

Provisioning log (table): time, operation (Create, Update, Deactivate, Group change), person, result (Applied, Rejected with reason), source id. Sample: 4 Nov 07:12 Deactivate "Tom Reilly", Applied: 2 approval tasks handed to Jordan Lee; 1 delegation ended; 1 budget flagged for a new owner.

Deprovisioning preview (when a deactivation affects owners or approvers): what will happen, with "Apply" automatic by default and an option "Hold deactivations of budget owners for Organization Admin review".

## Data and permissions

SCIM 2.0 endpoints in `libs/api/integrations` call the same user and role services as 103 and 008 (`users.manage` semantics), with the token as a hashed secret (`api_keys`-style storage; shown once). Group-to-role mapping is 008's. `integration.manage` for tokens; `users.manage` (Organization Admin) for mapping and deprovisioning rules. Super Admin is never provisioned through SCIM.

## States

| State              | Behaviour                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| SCIM off           | card with "Generate token" and the endpoint                                                         |
| Token shown once   | warning tone "Copy this token now. You won't see it again." with Copy; Done only after the checkbox |
| Overview           | as above                                                                                            |
| Rejected operation | log row with reason ("Group 'bf-ceo' maps to CEO; only one CEO allowed") linking 008                |
| Held deactivation  | warning "Deactivation of Tom Reilly waits for review: he owns US Wellbeing"                         |
| Token revoked      | provider calls fail with 401 and appear in 100                                                      |
| Loading / error    | `sat-ghost`; error banner with Retry                                                                |

## Budget safety and audit

Deactivation never deletes data or moves money; open approvals move to the next authority by the DoA rules, and budget ownership gaps are flagged. Token generation and revocation, mapping changes and every provisioning operation are audited (tokens never logged).

## Responsive and accessibility

Desktop and tablet; mobile read-only. The one-time token uses a monospace field with a Copy button that announces "Copied".

## Satori components

Connector frame from 092; `satCardSurfaceContainerLowest`, `mat-table` with `satTableWithRowStates`, `sat-status-tag`, `sat-banner`, `sat-ghost`; Angular Material dialog (token once, deprovision preview), checkbox, snackbar.

## Related screens and navigation

008 role and permission setup, 103 user and role management, 093 HR integration, 062 delegations, 017 alerts (owner gaps), 001 sign-in, 100 errors.

## Decisions taken

- SCIM creates, updates and deactivates users and drives roles only through the 008 group mapping; nothing is ever deleted. Recommended so audit history stays intact.
- Deactivation hands open approvals to the next authority and ends delegations automatically; budget ownership is flagged for reassignment rather than moved silently.
- An option can hold deactivations of budget owners for Organization Admin review; off by default so leavers lose access on time.
- SCIM tokens are shown once, stored hashed, and can overlap during rotation.
