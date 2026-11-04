# Clickable design preview

A click-through version of the Stitch designs in `design/stitch/`, for design review only (not app code).

- Live site: https://narasimhahyland.github.io/budgetflow/
- Guided flow: https://narasimhahyland.github.io/budgetflow/screens/000a-app-shell--default.html

Every exported screen state is one page. Sidebar items, header links, primary buttons, table rows and dialog triggers open the matching screen or state; items without a design yet lead to the index with a "not designed yet" notice (unlinked buttons show the notice in place). A bar at the bottom of every page shows the screen number and title, switches between the screen's states, steps Previous/Next along the guided flow (also the ← → keys), highlights links (L) and returns to the index.

## How it is built

| File | Purpose |
| --- | --- |
| `build.mjs` | Builds `dist/` (gitignored): `index.html`, `screens/<NNN-slug>--<state>.html`, thumbnails, overlay assets |
| `links.json` | Guided flow (`journey`), index areas, titles, the label-to-screen link map and extra hotspots |
| `html/<NNN-slug>/<state>.html` | Stitch HTML saved through the Stitch MCP, kept as exported (Tailwind CDN included) |
| `ocr/<NNN-slug>--<state>.json` | Text positions for states without saved HTML (written by `ocr.swift`, macOS Vision) |
| `assets/` | Navigation overlay and index styles injected by the build |
| `deploy.sh` | Builds and publishes only `dist/` to the `gh-pages` branch, then enables Pages |

A state with saved HTML is served as that HTML with its links rewritten by visible text. Any other state is served as its exported PNG with hotspots on the labels `links.json` knows about, placed from the OCR positions.

`links.json` link keys are visible labels, matched case-insensitively (`&` and "and" are equivalent):

- `"*"` applies to every page, `"<NNN-slug>"` to a screen, `"<NNN-slug>/<state>"` to one state; later scopes win.
- The target is `"<NNN-slug>"` (default state) or `"<NNN-slug>/<state>"`; `null` means "not designed yet"; `""` removes an inherited label.
- `row:<text>` also matches inside longer rows (table rows, search results); `icon:<name>` matches icon-only buttons by their Material icon name.
- `hotspots` adds boxes (CSS pixels of the 1x design) for icon-only controls on image pages.

## Rebuild and redeploy when new screens merge

1. For each new exported state, fetch its HTML with the Stitch MCP (`get_screen`, then `download_file` on `htmlCode.name`) and save it:
   `node design/preview/build.mjs import --from <download_file result> --screen <NNN-slug> --state <state>`.
   If the MCP returns the HTML inline instead of as a file, skip this step; the state falls back to its PNG.
2. For states without HTML, record text positions (macOS): `swift design/preview/ocr.swift design/stitch/<NNN-slug>/<state>--desktop--light.png design/preview/ocr/<NNN-slug>--<state>.json`.
3. Add the screen to `areas`, `journey` and `links` in `links.json`. Check coverage with `node design/preview/build.mjs report`.
4. Publish: `design/preview/deploy.sh` (use `--dry-run` to build and commit locally without pushing).
