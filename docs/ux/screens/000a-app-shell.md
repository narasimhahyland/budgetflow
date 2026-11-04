# 000a Application shell

Status: proposed - awaiting user review. Light theme only (dark deferred). Revised 2026-11-04 to the single-company decisions: Hyland only, no tenant or organization switcher, reporting currency fixed to USD (no currency chip).

## Design

| State                               | Image                                                      | Stitch screen                      |
| ----------------------------------- | ---------------------------------------------------------- | ---------------------------------- |
| default (Finance Controller)        | `design/stitch/000a-app-shell/default--desktop--light.png` | `edf7702d52a44bfbae279f1ade3a254d` |
| user menu open                      | `user-menu-open--desktop--light.png`                       | `6834454b968a4863985cb30640e34160` |
| notifications panel open            | `notifications-open--desktop--light.png`                   | `a5979502ac6941eeac8b71e494b94039` |
| global search open                  | `search-open--desktop--light.png`                          | `34ff0d0589694a7fb270532c29d0afc0` |
| Employee role, forbidden page (403) | `employee-forbidden--desktop--light.png`                   | `3b027019178b476784cbef64ee511f77` |
| mobile, navigation drawer open      | `nav-drawer-open--mobile--light.png`                       | `2d1be8286b204340a95668432b39cb6c` |

The earlier `switcher-open` state (tenant and organization switcher) is removed: there is one company and no switching.

## Purpose

The frame around every signed-in screen: navigation scoped to the user's role, the company name, global search, notifications and tasks, user menu, breadcrumbs, and the content slot.

## Roles

- Primary: every signed-in role (14 roles).
- Navigation differs by role: the API returns the menu the user may see. Finance Controller sees all groups; Employee sees Home, My budgets, Request funds, My requests, Events, Notifications.
- Super Admin sees platform administration only; financial data needs an audited break-glass grant.

## Entry points

Sign-in completion (Keycloak OIDC), any deep link.

## Regions and actions

- Sidebar (`sat-platform-nav`): logo, a static company label "Hyland" (business icon, not interactive, no chevron), grouped menu (Home; Budgets; Events with Co-funding board; Requests with Approval inbox count; Finance; Insights; Admin), collapse toggle, user row (`-user`). No `-switcher`.
- Header (`sat-app-header`): breadcrumbs (`sat-breadcrumbs`), global search (Ctrl K), fiscal-year chip, notifications bell with unread count, help, avatar menu. No reporting-currency chip: budgets and reports are always USD.
- User menu: name, role, office and timezone; Profile and preferences, Delegations, Notification settings, Help and shortcuts, Sign out. No organization, tenant or currency switching.
- Notifications panel: tabs All and Tasks, unread dots, inline "Review" on tasks, "Mark all as read", link to the notifications page (123). Amounts in USD.
- Global search: grouped results (Budgets, Events, People, Requests) limited to what the user may see, status tags, keyboard navigation (arrows, Enter, Esc).
- Skip to content link (`sat-skip-to-content`) first in tab order.

## Data

Current user (name, role, office, timezone, avatar initials), company name, active fiscal year, unread notification count, approval inbox count, search results from the API.

## Permissions

- Menu items, counts and search results come from the API for the current user; hiding is convenience, the API enforces (`PolicyService.can`).
- `tenant_id` and RLS stay in the data model with a single seeded tenant; nothing in the UI exposes tenants.
- Routes the user cannot open show the forbidden state inside the shell (`sat-403-error-state`) with "Go to Home" and "Request access".

## States

| State               | Behaviour                                                                |
| ------------------- | ------------------------------------------------------------------------ |
| Loading             | shell renders immediately; content slot shows `sat-ghost` skeletons      |
| Error               | page-level `sat-500-error-state` in the content slot; shell stays usable |
| Forbidden           | `sat-403-error-state` in the content slot (Employee example)             |
| Unauthenticated     | redirect to sign-in (001-003)                                            |
| Notifications empty | "You are all caught up" in the panel                                     |
| Search no results   | "No results" with a hint to check spelling or filters                    |
| Success             | snackbar at bottom center; focus returns to the trigger                  |

## Audit

Break-glass access by Super Admin is audited. Navigation itself is product analytics, not audit.

## Responsive

- Desktop: sidebar expanded (240px), collapsible to 72px icons.
- Tablet (834): sidebar collapsed to icons by default; expands as an overlay.
- Mobile (412): top app bar with menu, title, search icon, bell and avatar; navigation in a left drawer over a scrim (mobile image); breadcrumbs collapse to a back link; primary page action becomes full width.

## Accessibility

Landmarks (nav, banner, main); skip link; user menu, notifications and search are menus or dialogs with focus trap and Esc to close; counts announced ("7 approvals waiting"); Ctrl K documented in help.

## Related screens and navigation

All screens render inside the shell. Search results deep-link to budget details (021), event details (046), employee profile (039) and request details (060). Notifications link to the approval inbox (059) and notifications page (123).

## Assumptions and open questions

- Fiscal-year chip: switchable for Finance roles, display only for others (assumed).
- Should the sidebar group labels be shown for roles with few items? Hidden for Employee.
