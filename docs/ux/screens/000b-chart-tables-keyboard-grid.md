# 000b Chart table alternatives and keyboard-first grid

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 14 batch. Build phase P14. Review-added shared pattern (catalog section L: "charts with table alternatives; keyboard-first allocation grid"; P14 gate: charts with table alternatives, keyboard-only grid). Applies to every chart from `libs/web/ui/charts` and every editable grid (22b allocation grid, 32a period phasing, 20a plan import preview, 87a forecast entry, 80g tax rules editor).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a); samples use the 015 utilization chart and the 22b grid. Planned Stitch states, to be generated in a later session:

| State                                  | Planned image                                                             |
| -------------------------------------- | ------------------------------------------------------------------------- |
| chart with summary and table toggle    | `design/stitch/000b-chart-tables-keyboard-grid/chart--desktop--light.png` |
| same data as a table                   | `table--desktop--light.png`                                               |
| grid: focused cell and range selection | `grid-keyboard--desktop--light.png`                                       |
| grid: error navigation                 | `grid-errors--desktop--light.png`                                         |
| keyboard shortcuts sheet               | `shortcuts--desktop--light.png`                                           |

## Purpose

Make the dense financial views usable without a mouse and without reading a chart: every chart can be switched to an equivalent table and carries a one-sentence summary, and every editable grid works fully from the keyboard with spreadsheet conventions, so finance users who live in Excel can allocate 40 locations quickly and nobody depends on colour or pointing to understand a number.

## Roles

Every role that sees a chart (dashboards 011-018, reports 079-091, 15a, 15b, 16b, 54b) or edits a grid (owners and Finance Admin in 22b, 32a, 20a, 87a; Finance Admin in 80g).

## Entry points

The "View as table" switch on every chart card; profile preference "Show tables instead of charts" (124); every editable grid; the "?" key or "Keyboard shortcuts" button in grid toolbars; Help and shortcuts in the user menu (000a).

## Content and actions

Charts:

- Card header: title, one-sentence summary written from the data (sample 015: "Utilization by region, FY2026 to date: India 72.4%, United States 64.1%, Europe 58.0%; company 66.3%."), "View as table" switch (chart and table swap in place, same size), Export menu (CSV of the table data, XLSX, PDF with chart and table).
- Table view: one row per category, one column per series, units in the header ("Utilization %", "Committed, USD"), totals row, `bf-money` for amounts, hatched or dashed series named in words ("Pending (not yet approved)", "Forecast").
- Chart keyboard use: the chart is one tab stop; arrow keys move between points or bars and announce "Europe, utilization 58.0%, USD 15,660.00 of USD 27,000.00"; legend items are buttons that show or hide a series and say so.
- Preference: "Show tables instead of charts" in 124 makes every chart open in table view.

Keyboard-first grid (sample 22b, India Region children):

- One tab stop for the grid; the focused cell has a visible focus outline (`satFocusIndicator`).
- Movement: arrows; Home and End within a row; Ctrl Home and Ctrl End for the first and last cell; Page Up and Page Down by 10 rows; Tab and Shift Tab to the next or previous editable cell; read-only cells (per-head rows "Driven by headcount", totals) are reachable by arrows but skipped by Tab.
- Editing: typing replaces the value; Enter or F2 edits in place; Enter confirms and moves down; Esc cancels; Delete clears editable cells.
- Ranges: Shift plus arrows selects; Ctrl C copies as tab-separated text; Ctrl V pastes a range from Excel into the preview (22b paste flow); Ctrl Z and Ctrl Y undo and redo within the draft.
- Errors: cells with errors show the outline and message; F8 jumps to the next error and Shift F8 to the previous; the footer reads "2 cells need fixing" with "Go to first".
- Totals: the sticky footer (total change, available under the parent's rules, remaining) updates as you type and is announced politely after each confirmed edit.
- Submitting: Ctrl Enter opens the review step ("Submit as one change"); it never submits directly.
- Shortcuts sheet (dialog): the keys above in two columns, opened by "?" and from the toolbar.

## Data and permissions

No new data: the table view renders the same API response as the chart, and grid editing uses each screen's existing endpoints (22b change sets, 32a allotments, 87a forecast drafts) with their permissions and checks. The "Show tables instead of charts" preference is stored with the user's profile preferences (124). Chart summaries are generated in the client from the data with fixed templates, not by AI.

## States

| State           | Behaviour                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------- |
| Chart           | summary, chart, switch off                                                                        |
| Table           | switch on; table with totals; switch remembered for the session per chart                         |
| Empty data      | summary "No data for FY2026 yet"; both views show the screen's empty state                        |
| Grid focused    | outline on the active cell; status line "Row 3 of 6, New amount, editable"                        |
| Range selected  | selection tint and "3 x 2 cells selected" in the status line                                      |
| Editing         | in-place field; Esc restores the previous value                                                   |
| Errors          | outlined cells; F8 navigation; submit disabled with "Fix 2 cells to submit"                       |
| Shortcuts sheet | dialog as above; Esc closes and returns focus to the cell                                         |
| Read-only grid  | tablet and read-only roles: navigation and copy work, editing keys do nothing and say "Read only" |

## Budget safety and audit

Tables keep every budget-safety distinction of the chart in words and columns: allocated and available, pending (labelled "not yet approved") versus committed versus actual, current versus forecast, company-wide Available versus "Available under this budget's rules". Grid keys never bypass checks: pasted or typed values go through the same validation, and Ctrl Enter only opens the review. Audit entries come from the grid's submit, unchanged.

## Responsive and accessibility

Charts on mobile default to table cards. Grids are editable on desktop only (tablet read-only, as in 22b). Grid uses `role="grid"` with row and column headers announced; one live region for totals; focus is never lost after paste or undo.

## Satori components

`satFocusIndicator`, `sat-rich-tooltip` (cell error details), `sat-banner`, `sat-empty-state`; Angular Material slide toggle (View as table), table, dialog (shortcuts sheet); chart wrapper in `libs/web/ui/charts`; custom `bf-grid` in `libs/web/ui` (no Satori or Material spreadsheet grid) built on CDK and `--mat-sys-*` tokens; `bf-money`.

## Related screens and navigation

000 design system (chart sample), 22b allocation grid, 32a period phasing, 20a plan import, 87a forecast cycle, 80g tax rules, 011-018 dashboards, 079 report frame, 124 profile and preferences.

## Decisions taken

- Every chart has an in-place "View as table" switch and a written one-sentence summary, rather than a separate accessible page. Recommended so the table is always one keystroke away and never out of date.
- A profile preference can make tables the default everywhere.
- Grids follow spreadsheet conventions (arrows, Enter, F2, Esc, Ctrl C and V, Ctrl Z and Y), so people coming from Excel need no training.
- Ctrl Enter opens the review step and never submits money changes directly.
- One shared grid component serves every editable grid, so keys behave the same everywhere.
- Chart summaries come from fixed templates over the data, not from AI, so they are always exact.
