# BudgetFlow Satori design system (Stitch)

Status: proposed - awaiting user review. Theme: **light only; dark theme deferred** (no dark designs are exported or specified).

The Stitch designs are a visual reference for the Angular build. The build itself uses `@hylandsoftware/satori-ui` components and `--mat-sys-*` / `--sat-sys-*` tokens only (`.cursor/rules/frontend-satori-styling.mdc`); hex values below exist to brief Stitch and must never appear in app styles.

## Where it lives

| Item | Value |
| --- | --- |
| Stitch project | `1643421514270618068` (BudgetFlow Enterprise UI) |
| Design system asset (canonical) | `assets/8229316405357604751` "BudgetFlow Satori" |
| Source DESIGN.md | [`stitch/budgetflow-satori.design.md`](stitch/budgetflow-satori.design.md) |
| Reference screen | 000 design system, Stitch screen `5d02c6a4235a47d7968986b9629e76b9` |
| Original 24 screens | untouched; Satori screens are new screens or variants of them |

Notes on the Stitch assets:
- A first import of the DESIGN.md (`assets/4795dfe8fa07476f9b5e5e3b45d1049c`, same display name) was normalised by Stitch (primary shifted to `#3e3b92`, sections dropped). It is superseded; do not use it. The MCP cannot delete or update design systems (`update_design_system` rejects every payload), so it stays in the project.
- The canonical asset's stored DESIGN.md still carries a short dark-token paragraph written before the light-only decision. Stitch cannot update it; the repo copy is authoritative and is light only.

## Color (light)

| Role | Token | Hex |
| --- | --- | --- |
| Primary (buttons, links, focus, selection) | `--mat-sys-primary` | `#5654ac` |
| On primary | `--mat-sys-on-primary` | `#ffffff` |
| Primary container (selected rows, active chips) | `--mat-sys-primary-container` | `#e2dfff` |
| Primary loud (emphasis text) | `--sat-sys-primary-loud` | `#322f86` |
| Tertiary (charts, accents only) | `--mat-sys-tertiary` | `#006b61` |
| Error (hard block, validation) | `--mat-sys-error` | `#b02b36` |
| Surface | `--mat-sys-surface` | `#f9f9fc` |
| Page background | `--mat-sys-surface-container-low` | `#f4f3f7` |
| Tables, toolbars, cards | `--mat-sys-surface-container-lowest` | `#ffffff` |
| Text | `--mat-sys-on-surface` | `#1a1c1e` |
| Secondary text | `--mat-sys-on-surface-variant` | `#474551` |
| Borders | `--mat-sys-outline` / `--mat-sys-outline-variant` | `#777683` / `#c8c5d3` |

Status tones (`--sat-sys-<tone>-icon`, `--sat-sys-<tone>-container`, `--sat-sys-on-<tone>-container`):

| Tone | Icon | Container | Text | Used for |
| --- | --- | --- | --- | --- |
| success | `#4d9c4c` | `#eef6e8` | `#3d7231` | approved, active, matched |
| warning | `#967c39` | `#fbf3db` | `#7e651b` | pending, soft warning, near threshold |
| info | `#5384f1` | `#e5f3fc` | `#3060c6` | frozen (with lock icon), informational |
| important | `#c74f54` | `#faeae9` | `#ac4848` | set to zero, rejected |
| neutral | grey | grey | grey | draft, closed, expired, cancelled |

Derived values not supplied by Satori (secondary `#5d5c72`, tertiary container `#9df2e4`, error container `#ffdad9`, surface-container ramps) were chosen for Stitch only; the build takes the real values from the Satori theme.

## Typography

- Headlines: Figtree in the build; Stitch has no Figtree, so designs use **Plus Jakarta Sans**. Expect headline font differences in design parity.
- Body, labels, tables and forms: **Noto Sans**.
- Scale (Material 3): headline 32/28/24, title 22/16/14, body 16/14/12, label 14/12/11.
- Money and numbers: tabular numerals, right aligned in tables, always with the ISO 4217 code (`USD 30,000.00`, `EUR 25,000.00`, `INR 8,30,000.00` with lakh grouping where INR is shown).

## Layout, shape, elevation

- Desktop 1440 (Stitch renders at 1280 CSS px, exported at 2x), tablet 834, mobile 412.
- Shell: violet platform navigation sidebar 240px (72px collapsed) with white text and Material Icons; white app header 64px; content on the page background with 24px margins and 16px gutters; 12-column grid; 4px base unit.
- Radii: 4 (inputs, menus, table containers), 8 (chips, status tags), 12 (cards), 16 (drawers, large cards), 28 (dialogs); buttons are pills.
- Material 3 elevation: 0 page, 1 cards and tables, 2 menus and drawers, 3 dialogs.
- Icons: Material Icons (classic, filled). Never Material Symbols.

## Shared components and their Satori mapping

| Component | Build with |
| --- | --- |
| Shell, sidebar, tenant/org switcher, user menu | `sat-platform-nav-container`, `sat-platform-nav` (+ `-menu`, `-switcher`, `-user`), `sat-platform-nav-main-content` |
| App header, breadcrumbs, skip link | `sat-app-header`, `sat-breadcrumbs`, `sat-skip-to-content` |
| Page header bar and actions | `sat-header-bar`, `sat-action-bar`, `sat-split-button`, `satImportantButton` for the primary financial action |
| Dense table with row states, bulk actions | `mat-table` + `satTableWithRowStates`, `satRowState`, `sat-selection-bar`, `mat-sort`, `mat-paginator` |
| Status tags (all 15 budget states and request, commitment, event states) | `sat-status-tag` (icon + text, never color alone) |
| Filter chips, saved filters | `sat-tag`, `satInteractiveTag`, `satInlineChip` |
| KPI cards | `sat-interactive-card`, `satCardSurfaceContainerLowest` |
| Banners (frozen, zero, soft warning, hard block, success) | `sat-banner` |
| Empty, error, forbidden, loading | `sat-empty-state`, `sat-500-error-state`, `sat-403-error-state`, `sat-ghost` |
| Money breakdown and rule explanations | `sat-rich-tooltip` |
| Dialogs (financial confirmation with reason code and typed reason) | Material dialog |
| Drawers / side sheets | Material side sheet |
| Toasts | Material snackbar |
| Charts | one charting library wrapped in `libs/web/ui/charts`, Satori dataviz tokens, always with a "View as table" alternative |

## Budget-safety visuals

| Pair | Treatment |
| --- | --- |
| Allocated vs available | separate bar segments and labels; available in success tone when healthy |
| Held / pre-encumbered / encumbered / actual / accrued | one swatch each in the stacked budget bar and legend (design-system screen, section 10) |
| Current vs forecast | forecast dashed or hatched |
| Soft warning vs hard block | warning container, user can proceed / error container, action disabled with the reason |
| Frozen vs set to zero | info tone with lock icon / important tone |
| Pending vs approved | warning tag / success tag |
| Budget vs reporting currency | both shown; FX effect on its own line, never folded into consumption |

## Sample data (fictional, used in every design)

Tenant **Acme Global**, fiscal year FY2026 (January to December), reporting currency USD, plan rates locked for FY2026 (illustrative: EUR 1 = USD 1.08, USD 1 = INR 83.50).

| Budget | Owner | Budget currency | Amount |
| --- | --- | --- | --- |
| Employee Experience | Daniel Brooks (Department Head) | USD | 100,000.00 |
| India Region | Meera Iyer (Regional Manager) | INR (shown in USD) | USD 30,000.00 |
| Bengaluru Events | Anand Kumar (Location Manager) | INR | USD 10,000.00 |
| Hyderabad Events | Suresh Menon (Location Manager) | INR | USD 8,000.00 (per-head driver) |
| United States Region | Jordan Lee (Regional Manager) | USD | 40,000.00 |
| Europe Region | Sophie Laurent (Regional Manager) | EUR | EUR 25,000.00 (USD 27,000.00) |

Other people: Olivia Grant (CEO), Priya Raman (Finance Controller), Marco Bianchi (Finance Admin), Rahul Verma (Event Organizer, Bengaluru), Kavya Shah (Employee, Bengaluru), Hannah Cole (Auditor). Events: Bengaluru Diwali celebration (14 Nov 2026), Offsite 2026 (cross-location, co-funded), Hyderabad townhall.

## Screen numbering

`NNN` is the number from the original 124-screen specification; review-added screens get a letter (`056a`). Two start screens have no spec number: `000` design system and `000a` application shell. Exports follow `design/stitch/README.md`; specs live in `docs/ux/screens/NNN-slug.md`; review status in [`review-log.md`](review-log.md).

## Stitch workflow notes

- Restyle an original screen with `generate_variants` and then `apply_design_system`; the apply step creates a new screen id (the original and the intermediate variant stay).
- `edit_screens` only emits canvas edits; the exported screenshot does not change. Fixes are therefore made as REFINE variants, which produce a new screen and screenshot.
- Known render artifacts to ignore in parity: Plus Jakarta Sans instead of Figtree; occasional invented decoration (for example a "Live" tag) removed in later variants.
