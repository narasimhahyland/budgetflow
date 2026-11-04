# 008 Role and permission setup

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 2 gaps batch. Build phase P2. Step 5 of the 005 setup wizard (the ongoing version is 103).

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Planned exports: `design/stitch/008-role-permission-setup/default--desktop--light.png`, `group-mapping--desktop--light.png`.

## Purpose

Give the first people their roles: map identity-provider groups to BudgetFlow roles where possible, assign the key named roles (CEO, Finance Admin, Finance Controller, Auditor), and see what each role can do before inviting anyone.

## Roles

Organization Admin.

## Entry points

005 step 5; 010 checklist "Assign roles".

## Content and actions

- Role cards (14): name, one-line description, scope type (tenant-wide, own subtree, self), people assigned, "What this role can do" (opens 104 filtered to the role). Owner roles note: "Scope is the budgets or org units they own; set when budgets are assigned."
- Named roles panel: CEO (Olivia Grant), Finance Admin (Marco Bianchi), Finance Controller (Priya Raman), Auditor (Hannah Cole), Integration Admin (empty, "Assign later"), each with a people picker.
- Group mapping tab: identity-provider group to role table (sample: "bf-finance-admins" -> Finance Admin; "bf-auditors" -> Auditor; "all-employees" -> Employee), "Add mapping", preview "12 people would get Finance Controller" before saving.
- Footer: Back, "Save and continue".

## Data and permissions

Users and role assignments (`users.manage`, OA); roles are defined in code (`ROLE_GRANTS`) and cannot be created or edited here; only assignments and scopes change. Group mappings apply at sign-in through Keycloak claims.

## States

| State           | Behaviour                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Default         | as above                                                                                                                              |
| Validation      | at least one Finance Admin and one Organization Admin; the same person cannot be both Finance Admin and Auditor (segregation warning) |
| Mapping preview | counts per mapping before saving                                                                                                      |
| Saved           | snackbar; 010 ticks "Assign roles"                                                                                                    |

## Budget safety and audit

Segregation of duties warnings (warning container, can proceed with a reason) for conflicting role pairs. Each assignment and mapping change is audited.

## Responsive and accessibility

Desktop and tablet. Role cards have headings; pickers have labels.

## Related screens and navigation

005, 010, 103 user and role management, 104 permission matrix.

## Assumptions and open questions

- Segregation pairs to warn on: Finance Admin with Auditor, and Organization Admin with Finance Admin (assumed).
