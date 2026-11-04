# 000a Application shell

Status: proposed - awaiting user review. Start screen 2 (todo `ux-s02-shell`). Lettered because the shell is not one of the 124 numbered screens.

| State | Image | Stitch screen |
| --- | --- | --- |
| Default, light | `design/stitch/000a-app-shell/default--desktop--light.png` | `fd62ca975f5b497e960db74a6f608b2c` |
| Default, dark | `design/stitch/000a-app-shell/default--desktop--dark.png` | `cdd3e3dcf1c3481ab25d718c88cc8967` |
| Tenant and organization switcher open | `design/stitch/000a-app-shell/switcher-open--desktop--light.png` | `7e6e2b1ce7ec4f3e9e120bb79b5b31e4` |
| Notifications panel open | `design/stitch/000a-app-shell/notifications-open--desktop--light.png` | `662a5cd63a644fcaa4c9882f2913de9e` |
| Global search open | `design/stitch/000a-app-shell/search-open--desktop--light.png` | `d177aebf5cf74c9697a652d447a2b61c` |
| Employee role, forbidden page (403) | `design/stitch/000a-app-shell/employee-forbidden--desktop--light.png` | `9000745aaecd460a82511a8d60739e71` |
| Mobile, navigation drawer open | `design/stitch/000a-app-shell/nav-drawer-open--mobile--light.png` | `7ece71aa70904a62a3ea5d9d92c8a3a2` |

## Purpose
The frame around every signed-in page: navigation by role, tenant and organization scope, global search, notifications and tasks, fiscal year and reporting currency context, and the user menu.

## Roles
All 14 roles. Navigation items come from the permissions the API returns for the current user and tenant. Super Admin sees platform administration only (no tenant financial data without a break-glass grant).

## Entry points
After sign-in (screens 001-003) and on every route. Deep links open inside the shell.

## Layout
- Sidebar (`sat-platform-nav`, 240px, violet): logo; tenant switcher (`sat-platform-nav-switcher`) with organization scope below it; grouped items: Home; Budgets (Budget hierarchy, Allocation workspace, Budget list); Events; Requests (Approval inbox with count, My requests); Finance (Actuals and matching, GL tie-out); Insights (Reports, Audit log); Admin (Rules and policies, Integrations, Settings); collapse control; user row.
- Header (`sat-app-header`, 64px, white): breadcrumbs (`sat-breadcrumbs`), global search with Ctrl K, fiscal-year chip, reporting-currency chip, notifications bell with unread count, help, avatar menu.
- Content: page header bar (`sat-header-bar`) with title, scope subtitle and actions; optional page-level banner; content slot. `sat-skip-to-content` is the first focusable element.

## Main actions
- Switch tenant (radio list; sandbox tenants tagged "Sandbox").
- Change organization scope (searchable tree with each unit's currency; footer explains that scope limits what you see and shows the role).
- Search across budgets, events, people and requests within scope; results grouped, keyboard navigable, status tags inline.
- Open notifications (tabs All and Tasks; items for thresholds, approvals with an inline Review button, freezes, Inter-Director Budget Contribution Request outcomes; Mark all as read).
- User menu: profile and preferences (124), timezone, theme (light, dark, system), sign out.

## Data
Current user (name, role, location, timezone), memberships (tenants), org scope tree with unit currency, fiscal year, reporting currency, unread notification and task counts, navigation permissions.

## Permissions
- Navigation items render only when the user has at least read access to that area; the API remains the enforcement point.
- Tenant switcher shows only tenants with a membership. Organization scope shows only the subtree the user is scoped to.
- Search results are limited to the user's scope (stated in the results footer).

## States
| State | Treatment |
| --- | --- |
| Loading | Shell renders immediately; content slot uses `sat-ghost` skeletons (default image) |
| Empty | Per page (`sat-empty-state`) |
| Error | Per page; shell-level failures (for example notifications unavailable) show an inline message in the panel |
| Forbidden | `sat-403-error-state` in the content slot with "Go to Home" and "Request access" (employee image) |
| Session expired | Dialog prompting to sign in again; unsaved form data kept in memory |
| Tenant switched | Snackbar "Switched to Acme Labs (sandbox)"; content reloads |

## Audit behaviour
Tenant switches, break-glass access and role changes are audited server-side. Navigation and search are recorded only in product analytics, not in the audit trail.

## Responsive behaviour
Desktop 1440: expanded sidebar. Tablet 834: sidebar collapses to a 72px icon rail with tooltips. Mobile 412: top app bar with menu, title, search, bell and avatar; navigation in a left drawer over a scrim (mobile image); breadcrumbs collapse to a back link; primary page actions become full-width buttons.

## Accessibility
Skip-to-content link; landmarks (navigation, banner, main); Ctrl K opens search, Esc closes overlays, focus returns to the trigger; badge counts have text equivalents ("7 approvals waiting"); the active nav item has `aria-current="page"`; contrast of white on `#5654ac` is above 4.5:1.

## Related screens
[000 design system](000-design-system.md), [011 executive dashboard](011-executive-dashboard.md), 123 notifications and tasks, 124 profile and preferences, 001-003 sign-in.

## Navigation
Breadcrumbs reflect the route; the sidebar item for the current area is active; browser back works across tenant and scope changes (scope is part of the URL).

## Data-model assumptions
Organization scope is a node in the effective-dated org closure table; switching scope changes a query parameter, not the user's permissions.

## Open questions
- Should the organization scope live in the sidebar (as designed) or in the header next to the FY chip?
- Is the reporting-currency chip user-switchable (USD, EUR, INR) or fixed per tenant?
- Stitch artifacts to ignore: the "Live Mode" tag next to the page title in the default light image.
