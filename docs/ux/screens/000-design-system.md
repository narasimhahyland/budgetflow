# 000 Design system reference

Status: proposed - awaiting user review. Start screen 1 (todo `ux-s01-design-system`).

| State | Image | Stitch screen |
| --- | --- | --- |
| Default, light | `design/stitch/000-design-system/default--desktop--light.png` | `5d02c6a4235a47d7968986b9629e76b9` |
| Default, dark | `design/stitch/000-design-system/default--desktop--dark.png` | `676c8738415e4f4dbdfcbcb58d847ab3` |

## Purpose
One reference page for every shared visual decision: color and status tokens, type scale and money formatting, spacing, radii and grid, buttons, the full status-tag set, dense tables with row states, form fields with validation, banners, KPI cards, the budget bar legend, dialog, drawer and toast, empty and error states, and charts. Every later screen reuses these pieces. Token mapping and rules: [design-system.md](../design-system.md).

## Roles
Designers and implementers. It is not an in-app screen; no product role sees it.

## Entry points and navigation
None in the product. Implementers open it from this spec and the Stitch project.

## Actions, data, permissions
Not applicable (reference only). Sample values use the fictional Acme Global data from [design-system.md](../design-system.md).

## States shown
Light and dark versions of every component; component-level states on the page: disabled button with reason tooltip ("Budget is frozen"), field error ("Reason is required"), soft warning vs hard block banners, frozen vs set-to-zero table rows, empty state and error state cards, chart with "View as table".

## Audit behaviour
Not applicable. The dialog sample shows the pattern every financial dialog uses: impact summary, reason code, typed reason, and a note that the action is audited.

## Responsive behaviour
Grid: 12 columns at desktop (1440), 8 at tablet (834), 4 at mobile (412). Tables keep their columns at desktop, hide low-priority columns at tablet, and become stacked cards at mobile. Dialogs become full-screen sheets at mobile.

## Accessibility
Status is never color alone (icon plus text). Text on containers uses the `on-*-container` tokens (all pairs meet 4.5:1 on their container). Focus ring uses primary. Charts have a table alternative. Money uses tabular numerals and an explicit currency code so screen readers announce the currency.

## Related screens
[000a app shell](000a-app-shell.md) and every screen that follows.

## Notes on the Stitch render
Stitch renders at 1280 CSS px. Headlines use Plus Jakarta Sans as a stand-in for Figtree. The dark page derives its tokens (see open questions).

## Open questions
- Dark tokens are derived from Material 3 tonal palettes, not read from Satori's dark theme (the Satori package is not installed yet). Confirm or replace once `node_modules/@hylandsoftware/satori-ui` is available.
- Satori status tags: confirm the exact shapes (rounded 8px vs pill) against `sat-status-tag`.
