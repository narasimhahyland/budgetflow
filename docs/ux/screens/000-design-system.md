# 000 Design system reference

Status: proposed - awaiting user review. Light theme only (dark deferred).

Note 2026-11-04: the reference sheet was not regenerated. Where it shows a Share button, use the Export menu (CSV, XLSX, PDF) instead; budgets are USD, and INR/EUR appear only on transactions with the USD amount beside them.

## Design

| State   | Image                                                         | Stitch screen                      |
| ------- | ------------------------------------------------------------- | ---------------------------------- |
| default | `design/stitch/000-design-system/default--desktop--light.png` | `5d02c6a4235a47d7968986b9629e76b9` |

## Purpose

One reference sheet for every shared visual decision, so feature screens reuse the same tokens and components. Not a product screen; it is not routed in the app. Tokens, mapping to Satori and the budget-safety rules are written up in [`../design-system.md`](../design-system.md).

## Sections on the sheet

1. Color tokens with hex and status triads (success, warning, info, important).
2. Typography scale with money samples in USD, INR (lakh grouping) and EUR.
3. Spacing (4/8/16/24/32), radii (4/8/12/16/28, pill) and the 12-column grid.
4. Buttons: filled pill, outlined pill, text, tonal icon, destructive "Set to zero", disabled with reason tooltip.
5. Status tags for all 15 budget states (Draft, Submitted, Pending approval, Approved, Active, Partially allocated, Fully allocated, Frozen, Reduced, Set to zero, Exhausted, Expired, Closed, Revised, Cancelled).
6. Dense table with row-state stripes (frozen row info, set-to-zero row important), right-aligned tabular money, paginator.
7. Outlined form fields with currency prefix, reason code select, required reason with error text.
8. Banners: frozen (info), soft warning, hard block (error), success.
9. KPI cards with progress bars.
10. Budget bar legend: allocated out, held, pre-encumbered, encumbered, actual, accrued, available, forecast dashed.
11. Overlays: set-to-zero dialog preview (28px radius), right drawer, snackbar with Undo.
12. Empty and error states.
13. Chart sample with "View as table".

## Accessibility

- Status is never color alone: every tag has an icon and text.
- Text on status containers uses the darker `on-*-container` tone; contrast is checked in the visual QA loop.
- Focus ring uses primary; disabled controls carry a tooltip that states why.

## Open questions

- Request, commitment and event state sets need their own tag rows (only budget states are drawn); add when those screens are designed.
- Exact Satori status-tag shape (8px vs pill) to be confirmed against the installed `@hylandsoftware/satori-ui` types.
