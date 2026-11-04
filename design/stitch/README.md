# Approved Stitch designs

Approved Stitch exports that implemented screens are compared against (design parity in the visual QA loop). Proposed designs are exported here too so implementation can start early: their `meta.json` entries have `"approved": null` and `"status": "proposed - awaiting user review"` until the user approves them (see `docs/ux/review-log.md`). Light theme only for now; dark theme is deferred.

## Layout
```text
design/stitch/
  004-budget-hierarchy/              <NNN>-<slug>: screen number from the screen inventory, then a slug
    default--desktop--light.png      <state>--<viewport>--<theme>.png
    set-to-zero-dialog--desktop--light.png
    default--mobile.png              theme omitted = compared with the light capture
    meta.json                        source Stitch screen and approval date per file
```
- The folder name equals the screen `id` in `apps/web-e2e/visual/screens.json`; the state names match its `states`.
- Viewports: `desktop` (1440), `tablet` (834), `mobile` (412). Themes: `light`, `dark`.
- Lettered screens added after the inventory keep their letter (`056a-inter-director-contribution-request`).

## Export from the Stitch MCP
1. `list_screens` (or `get_screen`) on the BudgetFlow Stitch project to find the approved screen; note its `screenshot.name` (`projects/<project>/files/<file>`).
2. `download_file` with that name. The result has `image` (base64) and `image_metadata` (`mime_type`, `width`, `height`). Do not fetch `download_url` directly; it needs credentials.
3. Save it with the naming convention. When the client stores the tool result in a file, pass that file:
   ```bash
   node scripts/visual/stitch-save.mjs --from <download_file result.json> \
     --out design/stitch/004-budget-hierarchy/default--desktop--light.png \
     --screen-name projects/<project>/screens/<screen> --approved 2026-11-04
   ```
   Otherwise export the PNG from the Stitch web app and save it under the same name. JPEG input is converted to PNG.
4. Commit the PNG and `meta.json` with the screen's approval.

## Comparison
`node scripts/visual/design-parity.mjs --captures <capture dir>` pairs each design with the matching capture and writes side-by-side and diff images. The pixel ratio is advisory; the agent's inspection (and the `ux-reviewer`) decides. Stitch cannot render Figtree, so headline font differences are expected.
