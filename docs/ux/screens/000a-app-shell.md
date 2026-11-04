# 000a Application shell

Status: proposed - awaiting user review. Light theme only (dark deferred).

## Design
| State | Image | Stitch screen |
| --- | --- | --- |
| default (Finance Controller) | `design/stitch/000a-app-shell/default--desktop--light.png` | `fd62ca975f5b497e960db74a6f608b2c` |
| tenant and organization switcher open | `switcher-open--desktop--light.png` | `7e6e2b1ce7ec4f3e9e120bb79b5b31e4` |
| notifications panel open | `notifications-open--desktop--light.png` | `662a5cd63a644fcaa4c9882f2913de9e` |
| global search open | `search-open--desktop--light.png` | `d177aebf5cf74c9697a652d447a2b61c` |
| Employee role, forbidden page (403) | `employee-forbidden--desktop--light.png` | `9000745aaecd460a82511a8d60739e71` |
| mobile, navigation drawer open | `nav-drawer-open--mobile--light.png` | `7ece71aa70904a62a3ea5d9d92c8a3a2` |

## Purpose
The frame around every signed-in screen: navigation scoped to the user's role, tenant and organization scope switching, global search, notifications and tasks, user menu, breadcrumbs, and the content slot.

## Roles
- Primary: every signed-in role (14 roles).
- Navigation differs by role: the API returns the menu the user may see. Finance Controller sees all groups; Employee sees Home, My budgets, Request funds, My requests, Events, Notifications.
- Super Admin sees platform administration only; tenant financial data needs an audited break-glass grant.

## Entry points
Sign-in completion (Keycloak OIDC), any deep link, switching tenant or scope.

## Regions and actions
- Sidebar (`sat-platform-nav`): logo, tenant switcher (`-switcher`), organization scope, grouped menu (Home; Budgets; Events; Requests with Approval inbox count; Finance; Insights; Admin), collapse toggle, user row (`-user`) with menu (profile and preferences, sign out).
- Header (`sat-app-header`): breadcrumbs (`sat-breadcrumbs`), global search (Ctrl K), fiscal-year chip, reporting-currency chip, notifications bell with unread count, help, avatar menu.
- Switcher menu: tenant radio list (sandbox tenants tagged), organization scope tree with search and currency tag per unit, footer stating scope and role. Selecting reloads data for the new scope and keeps the current route when the user has access to it.
- Notifications panel: tabs All and Tasks, unread dots, inline primary action on tasks ("Review"), "Mark all as read", link to the full notifications page (123).
- Global search: grouped results (Budgets, Events, People, Requests) limited to the user's scope, status tags on results, keyboard navigation (arrows, Enter, Esc).
- Skip to content link (`sat-skip-to-content`) first in tab order.

## Data
Current user (name, role, location, avatar initials), tenant list, organization scope tree with budget currency per unit, active fiscal year, reporting currency, unread notification count, approval inbox count, search results from the API.

## Permissions
- Menu items, counts and search results come from the API for the current user and tenant; hiding is convenience, the API enforces (`PolicyService.can`).
- Scope switching only offers units in the user's grant; tenant isolation is by RLS.
- Routes the user cannot open show the forbidden state inside the shell (`sat-403-error-state`) with "Go to Home" and "Request access".

## States
| State | Behaviour |
| --- | --- |
| Loading | shell renders immediately; content slot shows `sat-ghost` skeletons |
| Empty | per page (the shell itself is never empty) |
| Error | page-level `sat-500-error-state` in the content slot; shell stays usable |
| Forbidden | `sat-403-error-state` in the content slot (Employee example) |
| Unauthenticated | redirect to sign-in (screens 001-003) |
| Notifications empty | "You are all caught up" in the panel |
| Search no results | "No results in your scope" with a hint to change scope |
| Success | snackbar at bottom center; focus returns to the trigger |

## Audit
Tenant and scope switches are recorded as product analytics events, not audit entries. Break-glass access by Super Admin is audited.

## Responsive
- Desktop: sidebar expanded (240px), collapsible to 72px icons.
- Tablet (834): sidebar collapsed to icons by default; expands as an overlay.
- Mobile (412): top app bar with menu, title, search icon, bell and avatar; navigation in a left drawer over a scrim (see mobile image); breadcrumbs collapse to a back link; primary page action becomes full width.

## Accessibility
Landmarks (nav, banner, main); skip link; switcher, notifications and search are menus or dialogs with focus trap and Esc to close; counts announced ("7 approvals waiting"); keyboard shortcut Ctrl K documented in help.

## Related screens and navigation
All screens render inside the shell. Search results deep-link to budget details (021), event details (046), employee profile (039) and request details (060). Notifications link to the approval inbox (059) and notifications page (123).

## Assumptions and open questions
- Organization scope: is it a filter of what you see (as designed) or also the default parent for new budgets? Assumed filter only.
- Fiscal-year chip: switchable from the header, or display only? Assumed switchable for Finance roles, display only for others.
- Should the sidebar group labels (BUDGETS, EVENTS, ...) be shown for roles with few items? Hidden for Employee in the design.
- The Stitch default shows a decorative "Live Mode" tag next to the page title; it is not part of the design.
