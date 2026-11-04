# Design parity (advisory)

Approved designs: `design/stitch`. Pixel threshold 0.1; rows above 15% mismatch or with a different aspect ratio are marked to inspect closely. The ratio never decides parity on its own: open each side-by-side image and judge layout, hierarchy, component choice, copy and the budget-safety visual rules.

| Screen         | State              | Viewport | Theme | Mismatch | Inspect closely | Side by side                                                        |
| -------------- | ------------------ | -------- | ----- | -------- | --------------- | ------------------------------------------------------------------- |
| 000a-app-shell | default            | desktop  | light | 23.12%   | yes             | 000a-app-shell--default--desktop--light.side-by-side.png            |
| 000a-app-shell | employee-forbidden | desktop  | light | 19.06%   | yes             | 000a-app-shell--employee-forbidden--desktop--light.side-by-side.png |
| 000a-app-shell | nav-drawer-open    | mobile   | light | 38.98%   | yes             | 000a-app-shell--nav-drawer-open--mobile--light.side-by-side.png     |
| 000a-app-shell | notifications-open | desktop  | light | 23.11%   | yes             | 000a-app-shell--notifications-open--desktop--light.side-by-side.png |

Designs without a matching capture: design/stitch/000a-app-shell/search-open--desktop--light.png, design/stitch/000a-app-shell/switcher-open--desktop--light.png.
Captured screens without an approved design: 000b-sign-in-pages.
