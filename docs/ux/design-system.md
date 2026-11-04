# BudgetFlow Satori design system (Stitch)

Status: proposed - awaiting user review. Designs are generated in Stitch to look like Satori UI on Angular Material 3; the build uses the real `@hylandsoftware/satori-ui` components and `--mat-sys-*` / `--sat-sys-*` tokens, never the hex values below.

## Stitch assets
| Item | Value |
| --- | --- |
| Project | `projects/1643421514270618068` ("BudgetFlow Enterprise UI") |
| Design system (canonical) | `assets/8229316405357604751` "BudgetFlow Satori" (exact Satori tokens in its DESIGN.md) |
| Design system (superseded) | `assets/4795dfe8fa07476f9b5e5e3b45d1049c` "BudgetFlow Satori", created by `create_design_system_from_design_md`; Stitch rewrote the tokens on import (primary `#3e3b92`), so it is not used. Stitch cannot delete or update it through the MCP. |
| Original design system | `assets/818051b3b3fd408f973ed385cba2cf2b` "Financial Allocation Platform" (navy, Inter) - used only by the 24 original screens, which stay untouched |
| DESIGN.md source | [`docs/ux/stitch/budgetflow-satori.design.md`](stitch/budgetflow-satori.design.md) (full version; the canonical asset holds a condensed copy with the same tokens) |
| Reference screens | [000 design system](screens/000-design-system.md) light and dark |

Fonts: Noto Sans for body and labels. Stitch has no Figtree, so Plus Jakarta Sans stands in for headlines in Stitch only; the build uses Figtree. Icons: Material Icons (classic, filled), never Material Symbols.

## Tokens (light)
| Role | Satori token | Hex in Stitch |
| --- | --- | --- |
| Primary | `--mat-sys-primary` | `#5654ac` |
| On primary | `--mat-sys-on-primary` | `#ffffff` |
| Primary container | `--mat-sys-primary-container` | `#e2dfff` |
| Primary loud | `--sat-sys-primary-loud` | `#322f86` |
| Tertiary (charts only) | `--mat-sys-tertiary` | `#006b61` |
| Error (hard block) | `--mat-sys-error` | `#b02b36` |
| Surface | `--mat-sys-surface` | `#f9f9fc` |
| Page background | `--mat-sys-surface-container-low` | `#f4f3f7` |
| Tables, toolbars, cards | `--mat-sys-surface-container-lowest` | `#ffffff` |
| Text | `--mat-sys-on-surface` | `#1a1c1e` |
| Secondary text | `--mat-sys-on-surface-variant` | `#474551` |
| Outline / outline variant | `--mat-sys-outline` / `-outline-variant` | `#777683` / `#c8c5d3` |
| Success icon / container / text | `--sat-sys-success*` | `#4d9c4c` / `#eef6e8` / `#3d7231` |
| Warning | `--sat-sys-warning*` | `#967c39` / `#fbf3db` / `#7e651b` |
| Info | `--sat-sys-info*` | `#5384f1` / `#e5f3fc` / `#3060c6` |
| Important | `--sat-sys-important*` | `#c74f54` / `#faeae9` / `#ac4848` |

Dark theme (derived from the Material 3 tonal palettes for these seeds; confirm against Satori's dark tokens when the workspace has `node_modules`): surface `#121316`, surface-container-low `#1a1b1f`, surface-container `#1f1f23`, surface-container-high `#292a2d`, on-surface `#e3e2e6`, on-surface-variant `#c8c5d3`, outline-variant `#474551`, primary `#c4c1ff`, on-primary `#272377`, primary-container `#3e3b92`; the sidebar stays violet (`#3e3b92`).

Shape: 4px inputs, menus and table containers; 8px chips and status tags; 12px cards; 16px drawers; 28px dialogs; pill buttons. Elevation: Material levels 0 (page), 1 (cards, tables), 2 (menus, drawers), 3 (dialogs). Spacing: 4px base unit, 24px page margin, 16px gutter, 12-column grid at 1440px.

## Shared components (and the Satori piece each maps to)
| Pattern | Build with |
| --- | --- |
| Violet platform sidebar, tenant and org switcher, user row | `sat-platform-nav` (+ `-menu`, `-switcher`, `-user`) |
| White app header: breadcrumbs, search, FY and reporting-currency chips, bell, help, avatar | `sat-app-header`, `sat-breadcrumbs` |
| Page header bar with primary and secondary actions | `sat-header-bar`, `sat-action-bar` |
| Dense table with row-state stripe, sort, paginator, bulk bar | `mat-table` + `satTableWithRowStates`, `sat-selection-bar` |
| Status tags (icon plus text, never color alone) | `sat-status-tag` |
| Banners (info, warning, error, important, success) | `sat-banner` |
| KPI card | `sat-interactive-card` / `satCardSurfaceContainerLowest` |
| Empty, forbidden, error states | `sat-empty-state`, `sat-403-error-state`, `sat-500-error-state` |
| Loading | `sat-ghost` skeletons |
| Dialog with impact summary, reason code and typed reason | Material dialog |
| Right drawer (480px) | Material side sheet |
| Toast | Material snackbar (inverse surface) |
| Money | shared `bf-money` component: currency code, tabular numerals, sign, triplet tooltip, lakh/crore grouping for INR |
| Charts | one chart library in `libs/web/ui/charts`, Satori dataviz palette, always with a "View as table" alternative |

## Status tags
Budget states: Draft, Submitted, Revised, Closed, Expired, Cancelled, Fully allocated (neutral); Pending approval, Reduced (warning); Approved, Active (success); Partially allocated (info); Frozen (info with lock icon); Set to zero (important); Exhausted (error). Request, commitment and event states reuse the same tones: pending = warning, approved = success, rejected = important, blocked = error.

## Budget-safety visuals
- Allocated vs available: separate bar segments and labels; available is never the same color as allocated.
- Held, pre-encumbered, encumbered, actual, accrued: one swatch each in the budget bar legend (design-system screen, section 10). Forecast is a dashed outline or dashed line.
- Soft warning: warning banner, the action stays enabled. Hard block: error banner, the action is disabled and the reason is shown next to it.
- Frozen: lock icon, info tone. Set to zero: important tone.
- Pending: warning tag. Approved: success tag.
- Budget currency and reporting currency side by side (for example `EUR 25,000.00 (USD 27,000.00)`); the FX effect is a separate line and is never folded into consumption.

## Sample data used in every design (fictional)
Tenant Acme Global, fiscal year FY2026 (January to December), reporting currency USD, plan rates locked for FY2026 (EUR 1.08 USD, USD 1 = INR 83.50).

| Budget | Owner | Currency | Amount |
| --- | --- | --- | --- |
| Employee Experience | Daniel Brooks (Department Head) | USD | 100,000.00 |
| India Region | Meera Iyer (Regional Manager) | INR budget, USD 30,000.00 at plan rate | INR 25,05,000 |
| Bengaluru Events | Anand Kumar (Location Manager) | INR | USD 10,000.00 |
| Hyderabad Events | Suresh Menon (Location Manager) | INR | USD 8,000.00 |
| United States Region | Jordan Lee (Regional Manager) | USD | 40,000.00 |
| Europe Region | Sophie Laurent (Regional Manager) | EUR | EUR 25,000.00 (USD 27,000.00) |

Other people: Olivia Grant (CEO), Priya Raman (Finance Controller), Marco Bianchi (Finance Admin), Rahul Verma (Event Organizer, Bengaluru), Kavya Shah (Employee, Bengaluru), Hannah Cole (Auditor). Events: Bengaluru Diwali celebration (14 Nov 2026), Offsite 2026 (cross-location). Request example: REQ-2026-0142, additional funds USD 2,500.00.

## Known Stitch limitations
- Stitch renders at 1280 CSS px (exports are 2x, 2560 px wide), not 1440; layouts scale.
- Stitch sometimes adds decorative tags ("Live Mode", "Live System Sync") or leaks an icon ligature as text; these are not part of the design and are listed per screen.
- `edit_screens` changes are not reflected in exported screenshots, so fixes are made as REFINE variants (new screen ids).
- `update_design_system` returns "invalid argument" for every payload, so the project-level theme still shows the original navy system; every BudgetFlow Satori screen carries the Satori asset explicitly.
