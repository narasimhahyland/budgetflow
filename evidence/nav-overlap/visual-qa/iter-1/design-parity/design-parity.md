# Design parity (advisory)

Approved designs: `design/stitch`. Pixel threshold 0.1; rows above 15% mismatch or with a different aspect ratio are marked to inspect closely. The ratio never decides parity on its own: open each side-by-side image and judge layout, hierarchy, component choice, copy and the budget-safety visual rules.

| Screen               | State              | Viewport | Theme | Mismatch | Inspect closely | Side by side                                                              |
| -------------------- | ------------------ | -------- | ----- | -------- | --------------- | ------------------------------------------------------------------------- |
| 000a-app-shell       | default            | desktop  | light | 23.63%   | yes             | 000a-app-shell--default--desktop--light.side-by-side.png                  |
| 000a-app-shell       | employee-forbidden | desktop  | light | 19.09%   | yes             | 000a-app-shell--employee-forbidden--desktop--light.side-by-side.png       |
| 000a-app-shell       | nav-drawer-open    | mobile   | light | 35.18%   | yes             | 000a-app-shell--nav-drawer-open--mobile--light.side-by-side.png           |
| 000a-app-shell       | notifications-open | desktop  | light | 24.35%   | yes             | 000a-app-shell--notifications-open--desktop--light.side-by-side.png       |
| 023-budget-hierarchy | default            | desktop  | light | 26.28%   | yes             | 023-budget-hierarchy--default--desktop--light.side-by-side.png            |
| 023-budget-hierarchy | set-to-zero-dialog | desktop  | light | 65.15%   | yes             | 023-budget-hierarchy--set-to-zero-dialog--desktop--light.side-by-side.png |

Designs without a matching capture: design/stitch/000a-app-shell/search-open--desktop--light.png, design/stitch/000a-app-shell/user-menu-open--desktop--light.png.
Captured screens without an approved design: none.
